// SPDX-License-Identifier: CC0-1.0
// Getting a tool (src/agent/storage/tool_kit.js and !getTool): the bag first, then the chests, then the
// crafting table, fetching what the recipe is short of. The plan alone, then the command in a fake room of
// chests with a stand-in for crafting that uses up what a recipe takes. No game and no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand } from '../src/agent/commands/index.js';
import { installStorage } from '../src/agent/storage/install.js';
import { carriedTool, craftPlan, planksOf, readKind, readMaterial } from '../src/agent/storage/tool_kit.js';
import { fakeChestBot, stack } from './helpers/fake_chest_bot.js';

test('a tool and a material are read as a player says them', () => {
    assert.deepEqual(['pickaxe', 'Pick', 'axes', 'spade', 'trident'].map(readKind), ['pickaxe', 'pickaxe', 'axe', 'shovel', null]);
    assert.deepEqual(['iron', 'wood', 'gold', 'best', '', 'cobble', 'paper'].map(readMaterial), ['iron', 'wooden', 'golden', 'any', 'any', 'stone', null]);
    assert.deepEqual(['oak_log', 'stripped_birch_wood', 'crimson_stem'].map(planksOf), ['oak_planks', 'birch_planks', 'crimson_planks']);
});

test('a tool carried counts when it is the material asked for or better, gold only when asked for', () => {
    const bag = names => names.map(name => ({ name }));
    assert.equal(carriedTool(bag(['diamond_pickaxe', 'stone_axe']), 'pickaxe', 'iron'), 'diamond_pickaxe');
    assert.equal(carriedTool(bag(['golden_pickaxe']), 'pickaxe', 'iron'), null, 'gold is no better than iron');
    assert.equal(carriedTool(bag(['golden_pickaxe']), 'pickaxe', 'golden'), 'golden_pickaxe');
    assert.equal(carriedTool(bag(['stone_pickaxe', 'iron_pickaxe']), 'pickaxe', 'any'), 'iron_pickaxe');
    assert.equal(carriedTool(bag(['iron_sword']), 'pickaxe', 'any'), null);
});

test('crafting plans what to fetch: the head, then planks or logs for the sticks and a table', () => {
    // One iron ingot carried and five in the chests; logs in the chests; no sticks, no table near.
    const plan = craftPlan('pickaxe', 'iron', { iron_ingot: 1 }, { iron_ingot: 5, oak_log: 10, dirt: 3 });
    assert.equal(plan.possible, true);
    // Two planks make the sticks and four the table: six planks, two logs.
    assert.deepEqual(plan.fetch, [{ name: 'iron_ingot', count: 2 }, { name: 'oak_log', count: 2 }]);
    // With a table near and sticks in a chest, only the iron.
    assert.deepEqual(craftPlan('pickaxe', 'iron', {}, { iron_ingot: 5, stick: 9 }, { table: true }).fetch,
        [{ name: 'stick', count: 2 }, { name: 'iron_ingot', count: 3 }]);
    // A wooden one from planks carried: nothing to fetch.
    assert.deepEqual(craftPlan('axe', 'wooden', { birch_planks: 9 }, {}, { table: true }), { possible: true, fetch: [], missing: null });
    const short = craftPlan('pickaxe', 'diamond', { diamond: 1 }, { diamond: 1, stick: 4 }, { table: true });
    assert.equal(short.possible, false);
    assert.match(short.missing, /3 diamond/);
});

// ---- The command, in a fake room ----

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);
const { bot, room } = fakeChestBot({
    chests: { '0,64,0': row(27, ['stone_pickaxe', 'iron_ingot x2', 'oak_log x4']), '2,64,0': row(27, ['iron_ingot x5']) },
    pockets: ['bread x4'],
    sizes: { stone_pickaxe: 1, iron_pickaxe: 1, iron_axe: 1, crafting_table: 64 },
});
bot.emit = () => {};
const agent = { name: 'Smith', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false },
    async handleMessage(source, run) { return run(); } };
agent.actions = new ActionManager(agent);

// Crafting as the game does it, on the fake bag: what each recipe takes and makes.
const take = (test, n) => {
    let left = n;
    room.pockets = room.pockets.map(s => {
        if (!s || !test(s.name) || left <= 0) return s;
        const k = Math.min(left, s.count);
        left -= k;
        return s.count === k ? null : { ...s, count: s.count - k };
    });
    if (left > 0) throw new Error(`not enough to craft: ${left} short`);
};
const add = (name, n) => {
    const at = room.pockets.findIndex(s => s?.name === name);
    if (at >= 0) room.pockets[at] = { ...room.pockets[at], count: room.pockets[at].count + n };
    else room.pockets[room.pockets.findIndex(s => !s)] = stack(`${name} x${n}`);
};
const crafted = [];
let tableNear = false;
const craft = async (b, name, times) => {
    crafted.push(name);
    if (name.endsWith('_planks')) { take(s => planksOf(s) === name, times); add(name, 4 * times); }
    else if (name === 'stick') { take(s => s.endsWith('_planks'), 2); add('stick', 4); }
    else if (name === 'crafting_table') { take(s => s.endsWith('_planks'), 4); add('crafting_table', 1); }
    else if (name === 'iron_axe') { take(s => s === 'iron_ingot', 3); take(s => s === 'stick', 2); add('iron_axe', 1); }
    else throw new Error(`no recipe for ${name} here`);
    return true;
};
installStorage(agent, {
    config: { chest_sorting: true, store_and_fetch: true, host: 'localhost', port: 25565, world_id: 'test' },
    bookDir: mkdtempSync(path.join(tmpdir(), 'tool-kit-')),
    deps: {
        nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
        blockAt: (b, pos) => room.blockAt(pos), goTo: async (b, chest) => room.goTo(chest), inView: () => true,
        hands: { pauseMs: 0, settleMs: 0 }, craft, tableNear: () => tableNear,
    },
});
const during = (command, ...args) => agent.handleMessage('Alice', () => getCommand(command).perform(agent, ...args));

test('a tool in the chests is fetched, not crafted', async () => {
    await during('!markChests', 'unknown', 16, 'Smith', 'same');
    const text = await during('!getTool', 'pickaxe', 'stone');
    assert.match(text, /^Took 1 stone_pickaxe:/, text);
    assert.equal(count(room.pockets, 'stone_pickaxe'), 1);
    assert.deepEqual(crafted, []);
    assert.equal(await during('!getTool', 'pick', 'wood'), 'You already have a stone_pickaxe.', 'stone is better than wood');
});

test('a tool no chest holds is crafted: the iron fetched, logs to planks to sticks and a table, then the axe', async () => {
    const text = await during('!getTool', 'axe', 'iron');
    assert.match(text, /Crafted an iron_axe\.$/, text);
    assert.equal(count(room.pockets, 'iron_axe'), 1);
    assert.deepEqual(crafted, ['oak_planks', 'stick', 'crafting_table', 'iron_axe']);
    assert.equal(count(room.pockets, 'iron_ingot'), 0, 'three fetched and used');
    assert.equal(count(room.pockets, 'bread'), 4);
});

test('nothing to make it from says what it needs', async () => {
    const text = await during('!getTool', 'sword', 'diamond');
    assert.match(text, /^No diamond sword in your bag or the chests you may use, and not enough to craft one: it needs 2 diamond\.$/, text);
    assert.match(await during('!getTool', 'pickaxe', 'netherite'), /netherite is made at a smithing table/);
    assert.match(await during('!getTool', 'trident', 'any'), /is not a tool/);
});
