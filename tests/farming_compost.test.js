// SPDX-License-Identifier: CC0-1.0
// The composter and bone meal: only when a player asks, only what the player named, and the bone meal taken
// out once the composter is full.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { composting, compostChance } from '../src/agent/farming/compost.js';
import { boneMealField } from '../src/agent/farming/bone_meal.js';

test('what a composter takes, and the chance each item fills it', () => {
    assert.equal(compostChance('wheat_seeds'), 30);
    assert.equal(compostChance('oak_leaves'), 30);
    assert.equal(compostChance('birch_sapling'), 30);
    assert.equal(compostChance('melon_slice'), 50);
    assert.equal(compostChance('carrot'), 65);
    assert.equal(compostChance('red_tulip'), 65);
    assert.equal(compostChance('bread'), 85);
    assert.equal(compostChance('pumpkin_pie'), 100);
    assert.equal(compostChance('cobblestone'), 0);
    assert.equal(compostChance('bone_meal'), 0);
});

// A composter at 1, 0, 0 that rises a level with every second item put in, turns ready a moment after it
// reaches 7, and drops one bone meal into the bag when clicked ready.
function scene({ seeds = 40, level = 0, composter = true } = {}) {
    const bag = { wheat_seeds: seeds };
    const pos = new Vec3(1, 0, 0);
    const state = { level, taken: 0, clicks: 0 };
    const bot = {
        registry: { version: { minecraftVersion: '1.21.6' } },
        entity: { position: new Vec3(0, 0, 0) },
        inventory: { items: () => Object.entries(bag).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })) },
        equip: async item => { bot.held = item.name; },
        lookAt: async () => {},
        activateBlock: async () => {
            state.clicks++;
            if (state.level === 8) { state.level = 0; bag.bone_meal = (bag.bone_meal ?? 0) + 1; return; }
            if (state.level === 7 || !bag[bot.held]) return;
            bag[bot.held]--; state.taken++;
            if (state.taken % 2 === 0) state.level++;
            if (state.level === 7) setTimeout(() => { state.level = 8; }, 50);
        },
    };
    const deps = {
        world: {
            getInventoryCounts: () => ({ ...bag }),
            getNearestBlocksWhere: (b, predicate) => [{ name: 'composter', position: pos }].filter(predicate).slice(0, composter ? 1 : 0),
        },
        skills: { goToPosition: async () => {}, pickupNearbyItems: async () => {} },
        blockAt: () => ({ name: 'composter', getProperties: () => ({ level: state.level }) }),
        sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))),
    };
    return { bot, bag, state, compost: composting(deps).compost };
}

test('composting fills the composter with what was named and takes out the bone meal', async () => {
    const { bot, bag, state, compost } = scene({ seeds: 20 });
    const result = await compost(bot, 'wheat_seeds', 16, { behind: { asked: true } });
    assert.equal(result.status, 'ok', result.text);
    assert.equal(bag.wheat_seeds, 4, 'sixteen went in, no more');
    assert.equal(bag.bone_meal, 1, 'fourteen filled it to 7, and the ripe composter gave its bone meal');
    assert.equal(state.level, 1);
    assert.match(result.text, /Put 16 wheat_seeds in the composter at 1, 0, 0 and took 1 bone_meal out/);
    assert.match(result.text, /level 1 of 7/);
});

test('a composter already ready gives its bone meal first, even with nothing to put in after', async () => {
    const { bot, bag, compost } = scene({ seeds: 1, level: 8 });
    const result = await compost(bot, 'wheat_seeds', 1, { behind: { asked: true } });
    assert.equal(bag.bone_meal, 1, result.text);
    assert.equal(bag.wheat_seeds, 0);
});

test('the composter is used only when a player asks, only for what it takes, and only with one in sight', async () => {
    let { bot, bag, state, compost } = scene();
    const unasked = await compost(bot, 'wheat_seeds', 5, { behind: { asked: false } });
    assert.equal(unasked.status, 'blocked');
    assert.equal(state.clicks, 0);
    const stone = await compost(bot, 'cobblestone', 5, { behind: { asked: true } });
    assert.match(stone.text, /doesn't take cobblestone/);
    const none = await compost(bot, 'carrot', 5, { behind: { asked: true } });
    assert.match(none.text, /no carrot/);
    assert.equal(bag.wheat_seeds, 40);
    ({ bot, compost } = scene({ composter: false }));
    const away = await compost(bot, 'wheat_seeds', 5, { behind: { asked: true } });
    assert.match(away.text, /no composter within 16 blocks/);
});

test('bone meal goes on a field only when a player asks, and only with bone meal to use', async () => {
    const bot = { inventory: { items: () => [], slots: [] } };
    const unasked = await boneMealField(bot, { behind: { asked: false }, book: {} });
    assert.equal(unasked.status, 'blocked');
    assert.match(unasked.text, /only when a player asks/);
    const empty = await boneMealField(bot, { behind: { asked: true }, book: {} });
    assert.equal(empty.status, 'failed');
    assert.match(empty.text, /no bone_meal. !compost makes it/);
});
