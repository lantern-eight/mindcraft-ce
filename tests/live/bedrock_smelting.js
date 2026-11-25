// SPDX-License-Identifier: CC0-1.0
// Smelting on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_smelting.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of smelting_scenarios.js, for what depends on the edition: putting into and taking out of
// a furnace are item stack requests on Bedrock, and a burning furnace is another block (`lit_furnace`), so
// a bot that looks for "furnace" by name can't find its own furnace again once it is working.
//
// The console can't read a furnace back on Bedrock, so the furnace a scene must leave alone is read by
// opening it with the bot's own hands from before fair play was installed.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const NAME = 'BedrockSmelter';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, smelting: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installSmelting } = await import('../../src/agent/smelting/install.js');
    const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { editionOf } = await import('../../src/agent/edition/index.js');
    const skills = await import('../../src/agent/library/skills.js');
    const world = await import('../../src/agent/library/world.js');

    let agent, rawOpenFurnace, smelting;
    const counts = () => world.getInventoryCounts(bot);
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 6 });

    /** Each scene on a bare stone platform, the bot in the middle facing +x, carrying only what it is given. */
    async function reset(...gifts) {
        await fill([-10, 1, -10], [10, 6, 10], 'air');
        await fill([-10, 0, -10], [10, 0, 10], 'stone');
        await cmd(`clear ${NAME}`);
        await cmd(`tp ${NAME} ${at(0, 1, 0).x + 0.5} ${at(0, 1, 0).y} ${at(0, 1, 0).z + 0.5} -90 20`, 1500);
        for (const gift of gifts) await cmd(`give ${NAME} ${gift}`, 600);
        await delay(800);
    }
    /** Walking up to a furnace, a player looks at it: the bot does the same before a scene asks anything of it. */
    const lookAt = async (...cells) => {
        for (const cell of cells) { await bot.lookAt(at(...cell).offset(0.5, 0.5, 0.5), true); await delay(600); }
    };
    /** What is in a furnace, read with the test's own hands: `[input, fuel, output]` as 'name xN' or null. */
    const read = async cell => {
        const window = await rawOpenFurnace(bot.blockAt(at(...cell)));
        await delay(400);
        const show = item => (item ? `${item.name} x${item.count}` : null);
        const slots = [0, 1, 2].map(i => show(window.slots[i]));
        bot.closeWindow(window);
        await delay(400);
        return slots;
    };

    await step('the bot joins, and smelting is installed with fair play and world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]);
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await cmd('time set noon');
        rawOpenFurnace = bot.openFurnace.bind(bot);
        agent = {
            name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
            prompter: { profile: {}, getInitModes: () => ({}) },
            self_prompter: { isActive: () => false, stopLoop: () => {} },
            openChat: () => {}, handleMessage: async (source, run) => (typeof run === 'function' ? run() : undefined),
            clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
            requestInterrupt: () => {
                bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
            },
            isIdle: () => !agent.actions.executing,
        };
        agent.actions = new ActionManager(agent);
        initModes(agent);
        const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-smelting-')) });
        assert.ok(handle?.memory, 'fair play and world memory are on');
        smelting = installSmelting(agent, { jobsDir: mkdtempSync(path.join(tmpdir(), 'bedrock-smelting-jobs-')) });
        assert.ok(smelting, 'smelting is on');
        // As in a real bot, where both are on by default: the furnace the bot placed is its own to pick up again.
        assert.ok(installGoodNeighbor(agent), 'good-neighbor rules installed');
        // Chest storage, for an empty bucket fetched from the bot's own chest or shelf for a lava farm.
        assert.ok(installStorage(agent, { bookDir: mkdtempSync(path.join(tmpdir(), 'bedrock-smelting-book-')) })?.commands.includes('!fetchItem'), 'fetching is on');
    });

    await step('sand and coal make glass, and the bot finds its furnace again while it burns', async () => {
        await reset('sand 4', 'coal 2');
        await set([3, 1, 0], 'furnace');
        await delay(1200);
        await lookAt([3, 1, 0]);
        let sawLit = false;
        const watch = setInterval(() => { if (bot.blockAt(at(3, 1, 0))?.name === 'lit_furnace') sawLit = true; }, 500);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 4));
        clearInterval(watch);
        assert.equal(result.status, 'ok', result.text);
        assert.ok(sawLit, 'the furnace burned as lit_furnace');
        assert.equal(counts().glass, 4, JSON.stringify(counts()));
        assert.equal(counts().coal, 1, 'one coal burned, the other kept');
        assert.equal(bot.currentWindow ?? null, null);
        return { text: result.text.trim() };
    });

    await step('a furnace in use is left alone, and a free one used', async () => {
        await reset('sand 2', 'coal 1');
        await set([2, 1, -1], 'furnace');
        await cmd(`replaceitem block ${xyz(at(2, 1, -1))} slot.container 0 raw_iron 3`);
        await set([4, 1, 2], 'furnace');
        await delay(1200);
        await lookAt([2, 1, -1], [4, 1, 2]);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        assert.equal(counts().glass, 2);
        assert.match(result.text, /is in use \(3 raw_iron in it\)/);
        assert.deepEqual(await read([2, 1, -1]), ['raw_iron x3', null, null], 'their iron is untouched');
        return { text: result.text.trim() };
    });

    await step('with no furnace about, the bot places its own and picks it back up with its pickaxe', async () => {
        await reset('sand 2', 'coal 1', 'furnace 1', 'stone_pickaxe 1');
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        await delay(1000);
        assert.equal(counts().glass, 2, JSON.stringify(counts()));
        assert.equal(counts().furnace, 1, 'the furnace is back in the bag');
        return { text: result.text.trim() };
    });

    await step('clearFurnace takes everything out of a furnace the bot remembers', async () => {
        await reset();
        await set([3, 1, 0], 'furnace');
        await cmd(`replaceitem block ${xyz(at(3, 1, 0))} slot.container 0 raw_iron 3`);
        await delay(1200);
        await lookAt([3, 1, 0]);
        // Turned away, the furnace is known only from memory: what the bot saw of it, not the world.
        await lookAt([-5, 1, 0]);
        await delay(1000);
        const result = await act('test:clear', () => skills.clearNearestFurnace(bot));
        assert.equal(result.status, 'ok', result.text);
        await delay(500);
        assert.equal(counts().raw_iron, 3, result.text);
        return { text: result.text.trim() };
    });

    await step('loaded and left: the bot walks off, is told when it is done, and collects', async () => {
        await reset('sand 3', 'coal 1');
        await set([3, 1, 0], 'furnace');
        await delay(1200);
        await lookAt([3, 1, 0]);
        const loaded = await act('test:load', () => smelting.loadFurnace(bot, 'sand', 3));
        assert.equal(loaded.status, 'ok', loaded.text);
        assert.match(loaded.text, /put 3 sand and 1 coal in the furnace/);
        await cmd(`tp ${NAME} ${at(-6, 1, 0).x + 0.5} ${at(-6, 1, 0).y} ${at(-6, 1, 0).z + 0.5} 90 20`, 1500);
        await delay(32000);
        const busy = await act('test:other', async () => {});
        assert.match(busy.message, /The glass in the furnace at .* should be done \(!collectFurnace\)/);
        const collected = await act('test:collect', () => smelting.collectFurnace(bot));
        assert.equal(collected.status, 'ok', collected.text);
        assert.match(collected.text, /I took 3 glass/);
        await delay(500);
        assert.equal(counts().glass, 3, JSON.stringify(counts()));
        return { text: collected.text.trim() };
    });

    await step('a lava farm near: the bot fills its bucket and smelts on the lava, keeping its coal', async () => {
        await reset('sand 2', 'coal 2', 'lava_bucket 1');
        await set([3, 1, -1], 'furnace');
        // Bedrock has one cauldron block, with the liquid and how full it is as states, and the console here
        // takes no state list. So the lava goes in as a player's would: poured from a bucket, which leaves
        // the bot the empty bucket the smelt fills again.
        await set([3, 1, 1], 'cauldron');
        await delay(1200);
        await lookAt([3, 1, 1]);
        await bot.equip(bot.inventory.items().find(item => item.name === 'lava_bucket'), 'hand');
        await bot.activateBlock(bot.blockAt(at(3, 1, 1)));
        await delay(1000);
        assert.equal(counts().bucket, 1, `poured: ${JSON.stringify(counts())}`);
        await lookAt([3, 1, -1], [3, 1, 1]);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /filled a bucket with lava from the cauldron/);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 2, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1, 'its bucket came back');
        return { text: result.text.trim() };
    });

    /** A player tells the bot that a chest or shelf is its own. */
    const ownChest = async cell => {
        const c = at(...cell);
        assert.match(await agent.handleMessage('Alice', () => getCommand('!markChest').perform(agent, c.x, c.y, c.z, NAME, 'same')), /is now|was already/);
    };
    const stock = (cell, slot, item) => cmd(`replaceitem block ${xyz(at(...cell))} slot.container ${slot} ${item} 1 0`, 300);
    /** A full lava cauldron, poured as a player would (the console takes no state list), and the empty bucket that leaves taken away. */
    async function lavaFarm(cell) {
        await reset('sand 2', 'coal 2', 'lava_bucket 1');
        await set([3, 1, -1], 'furnace');
        await set(cell, 'cauldron');
        await delay(1200);
        await lookAt(cell);
        await bot.equip(bot.inventory.items().find(item => item.name === 'lava_bucket'), 'hand');
        await bot.activateBlock(bot.blockAt(at(...cell)));
        await delay(1000);
        await cmd(`clear ${NAME} bucket`, 800);
        assert.equal(counts().bucket ?? 0, 0, `no bucket left on it: ${JSON.stringify(counts())}`);
    }

    // No bucket on it and none in a furnace: a player goes and gets one from their chests.
    await step('a lava farm near and no bucket: the bot takes one from its own chest and smelts on the lava', async () => {
        await lavaFarm([3, 1, 1]);
        await set([4, 1, 3], 'chest');
        await stock([4, 1, 3], 0, 'bucket');
        await lookAt([3, 1, -1], [4, 1, 3], [3, 1, 1]);
        await ownChest([4, 1, 3]);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        const chest = at(4, 1, 3);
        assert.ok(result.text.includes(`took an empty bucket from the chest at ${chest.x}, ${chest.y}, ${chest.z} (your own). I filled a bucket with lava`), result.text);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 2, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1, 'the bucket came back out of the fuel slot');
        return { text: result.text.trim() };
    });

    // The same from a shelf, which shows its bucket on its front (a shelf placed here faces south, toward the bot).
    await step('a lava farm near and a bucket on the bot\'s shelf: it takes the bucket off the shelf and smelts on the lava', async () => {
        await lavaFarm([3, 1, 1]);
        await set([2, 1, -3], 'oak_shelf');
        await stock([2, 1, -3], 1, 'bucket');
        await lookAt([3, 1, -1], [2, 1, -3], [3, 1, 1]);
        await ownChest([2, 1, -3]);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        const shelf = at(2, 1, -3);
        assert.ok(result.text.includes(`took an empty bucket from the oak_shelf at ${shelf.x}, ${shelf.y}, ${shelf.z} (your own). I filled a bucket with lava`), result.text);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 2, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1);
        const onShelf = (editionOf(bot.registry).shelfOf(bot.blockAt(shelf))?.slots ?? []).filter(Boolean);
        assert.deepEqual(onShelf, [], 'the shelf is empty');
        return { text: result.text.trim() };
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        if (origin) await fill([-10, 0, -10], [10, 6, 10], 'air');
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
