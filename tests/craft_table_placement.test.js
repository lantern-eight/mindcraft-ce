// SPDX-License-Identifier: CC0-1.0
// craftRecipe places the crafting table it carries when a recipe needs one and none is near. When there is
// no free spot for the table, or the table can't be placed, it must say so and craft nothing. It used to
// read the missing spot's coordinates and crash, or carry on and try a table recipe with no table.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import rootSettings from '../settings.js';
import { setSettings } from '../src/agent/settings.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { GAME_VERSION } from './helpers/game_version.js';

// craftRecipe reads recipes from mcdata.js, which loads its game data when a bot logs in. A bot pointed at
// a closed port never connects; telling it that it logged in loads the data all the same.
async function loadGameData() {
    setSettings({ ...rootSettings, host: '127.0.0.1', port: 1, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline' });
    const mc = await import('../src/utils/mcdata.js');
    const bot = mc.initBot('GameData');
    bot.on('error', () => {});
    bot.emit('login');
    bot.end();
    return mc;
}

/**
 * A bot carrying planks and a crafting table, with no table nearby. The chest recipe needs a table.
 * `freeSpot` is where the world says a table could go (or null for nowhere). The live block there is
 * missing, as for a spot in a chunk that isn't loaded, so a placement there fails.
 */
function tableCrafter(mc, { freeSpot }) {
    const slots = [{ name: 'oak_planks', count: 8, type: mc.getItemId('oak_planks') },
        { name: 'crafting_table', count: 1, type: mc.getItemId('crafting_table') }];
    const crafted = [];
    const bot = {
        output: '', interrupt_code: false,
        entity: { position: new Vec3(0, 64, 0) },
        inventory: { slots, items: () => slots, findInventoryItem: name => slots.find(s => s.name === name) ?? null },
        modes: { isOn: () => false },
        game: { gameMode: 'survival' },
        recipesFor: (_id, _meta, _count, table) => (table ? [{ id: mc.getItemId('chest'), inShape: [] }] : []),
        craft: async (...args) => { crafted.push(args); },
        blockAt: () => null,
    };
    const air = position => ({ name: 'air', position, drops: [], diggable: false });
    const ground = position => ({ name: 'stone', position, drops: [1], diggable: true });
    setWorldQueries({
        // Searches for air (a free spot) find the spot; a search for a crafting table finds none.
        findBlocks: (_bot, { matching }) => (typeof matching === 'function' && freeSpot ? [freeSpot] : []),
        blockAt: (_bot, position) => (freeSpot && position.y < freeSpot.y ? ground(position) : air(position)),
    });
    return { bot, crafted };
}

test('with no free spot for its crafting table, craftRecipe says so and crafts nothing', async () => {
    const mc = await loadGameData();
    const { craftRecipe } = await import('../src/agent/library/skills.js');
    const { bot, crafted } = tableCrafter(mc, { freeSpot: null });
    try {
        assert.equal(await craftRecipe(bot, 'chest', 1), false);
        assert.match(bot.output, /Could not find a free space to place a crafting table for chest\./);
        assert.deepEqual(crafted, []);
    } finally {
        setWorldQueries(null);
    }
});

test('when its crafting table can\'t be placed, craftRecipe says so and crafts nothing', async () => {
    const mc = await loadGameData();
    const { craftRecipe } = await import('../src/agent/library/skills.js');
    const { bot, crafted } = tableCrafter(mc, { freeSpot: new Vec3(2, 64, 0) });
    try {
        assert.equal(await craftRecipe(bot, 'chest', 1), false);
        assert.match(bot.output, /Could not place a crafting table for chest\./);
        assert.deepEqual(crafted, [], 'no table recipe was tried without a table');
    } finally {
        setWorldQueries(null);
    }
});
