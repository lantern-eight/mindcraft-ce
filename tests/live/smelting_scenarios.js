// SPDX-License-Identifier: CC0-1.0
// Live smelting scenarios against a real server (no model calls, free to run).
//   node tests/live/smelting_scenarios.js [--port=55940] [--only=<regex>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests run whole smelts against a pretend furnace. These check what only a real server can: that
// the furnace window really takes the input and the fuel, that a furnace really smelts while the bot keeps
// its window shut, and that what the bot says it smelted is what reached its inventory. The server console
// is the director: it builds each scene and afterwards reads the furnaces back itself.
//
// Scenes: the glass test (16 sand), fuel from logs made into planks, a carried furnace placed and picked
// back up, a furnace in use left alone for a free one, a furnace sealed behind a wall that the bot can't
// know of, a furnace cleared, a smelt stopped half way, which leaves the furnace working, and gone on with
// after; a furnace loaded and left, and collected; and lava from a lava cauldron as the fuel.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55940);
const NAME = 'Smelter';
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const results = [];
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        ...fairPlaySettings(), world_memory: true, smelting: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installSmelting } = await import('../../src/agent/smelting/install.js');
    const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const skills = await import('../../src/agent/library/skills.js');
    const world = await import('../../src/agent/library/world.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'smelting-memory-')) });
    assert.ok(handle, 'fair play installed');
    const smelting = installSmelting(agent, { jobsDir: mkdtempSync(path.join(tmpdir(), 'smelting-jobs-')) });
    assert.ok(smelting, 'smelting installed');
    // As in a real bot, where both are on by default: the furnace the bot placed is its own to pick up again.
    assert.ok(installGoodNeighbor(agent), 'good-neighbor rules installed');
    // Chest storage, for an empty bucket fetched from the bot's own chest or shelf for a lava farm.
    assert.ok(installStorage(agent, { bookDir: mkdtempSync(path.join(tmpdir(), 'smelting-book-')) })?.commands.includes('!fetchItem'), 'fetching is on');
    /** A player tells the bot that a chest or shelf is its own. */
    const ownChest = async (x, y, z) => assert.match(
        await agent.handleMessage('Alice', () => getCommand('!markChest').perform(agent, x, y, z, NAME, 'same')), /is now|was already/);
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 10 });
    const counts = () => world.getInventoryCounts(bot);
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek; the bot may not

    /** What is in a furnace, slot by slot, as the server tells its console: `{0: {name, count}, ...}`. */
    const furnaceHolds = async (x, y, z) => {
        const mark = server.log.length;
        await cmd(`data get block ${x} ${y} ${z} Items`);
        const answer = /has the following block data: (.*)/;
        await waitFor(() => answer.test(server.log.slice(mark)), 5000, () => `no answer about the block at ${x}, ${y}, ${z}: ${server.log.slice(mark)}`);
        const text = server.log.slice(mark).match(answer)[1];
        const slots = {};
        for (const entry of text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? []) {
            const slot = entry.match(/Slot: (\d+)b/)?.[1];
            if (slot === undefined) continue;
            slots[slot] = { name: entry.match(/id: "minecraft:([a-z0-9_]+)"/)[1], count: Number(entry.match(/count: (\d+)/)?.[1] ?? 1) };
        }
        return slots;
    };

    // A stone floor with its top at y 69 and open air above, the bot in the middle facing east (+x). Each
    // scene starts from this, so one scene's furnaces can't spoil the next.
    async function reset(...gifts) {
        await cmd('fill -12 56 -12 12 69 12 stone');
        await cmd('fill -12 70 -12 12 80 12 air');
        await cmd('kill @e[type=item]');
        await cmd(`clear ${NAME}`);
        await cmd(`tp ${NAME} 0.5 70 0.5 -90 20`);
        for (const gift of gifts) await cmd(`give ${NAME} ${gift}`);
        await delay(1500);
    }
    /** A furnace on the floor, facing the bot, optionally with something in it already. */
    const furnace = async (x, z, holds = {}) => {
        await cmd(`setblock ${x} 70 ${z} furnace[facing=west]`);
        for (const [slot, text] of Object.entries(holds)) {
            const [item, count] = text.split(' x');
            await cmd(`item replace block ${x} 70 ${z} container.${slot} with ${item} ${count}`);
        }
    };
    const settle = () => delay(1200); // for the bot to see what was just built

    await cmd('gamerule doDaylightCycle false');
    await cmd('time set noon');
    await waitFor(() => handle.wiring && handle.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${handle.wiring?.reason}`);

    await step('the glass test: 16 sand and coal make 16 glass, and the furnace is left empty', async () => {
        await reset('sand 16', 'coal 3');
        await furnace(3, 0);
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 16));
        assert.equal(result.status, 'ok', result.text);
        const have = counts();
        assert.equal(have.glass, 16, JSON.stringify(have));
        assert.equal(have.sand ?? 0, 0);
        assert.equal(have.coal, 1, 'two coal burned and the rest came back');
        assert.deepEqual(await furnaceHolds(3, 70, 0), {}, 'nothing of the bot\'s left in the furnace');
        assert.equal(bot.currentWindow, null);
        return { text: result.text.trim() };
    });

    await step('with only logs for fuel, the bot makes planks of one and smelts with them', async () => {
        await reset('sand 4', 'oak_log 2');
        await furnace(3, 0);
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 4));
        assert.equal(result.status, 'ok', result.text);
        const have = counts();
        assert.equal(have.glass, 4, JSON.stringify(have));
        assert.equal(have.oak_log, 1, 'one log made into planks, the other kept');
        assert.equal(have.oak_planks, 1, 'three planks burned, one left over');
        assert.match(result.text, /made 1 oak_log into oak_planks for fuel/);
        return { text: result.text.trim() };
    });

    await step('with no furnace about, the bot places the one it carries, and picks it back up with its pickaxe', async () => {
        await reset('sand 3', 'coal 1', 'furnace 1', 'stone_pickaxe 1');
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 3));
        assert.equal(result.status, 'ok', result.text);
        await delay(1000);
        const have = counts();
        assert.equal(have.glass, 3, JSON.stringify(have));
        assert.equal(have.furnace, 1, 'the furnace is back in the bag');
        assert.match(result.text, /placed my furnace at .*picked my furnace back up/);
        return { text: result.text.trim() };
    });

    await step('a furnace in use is left alone, and a free one used', async () => {
        await reset('sand 2', 'coal 1');
        await furnace(2, -1, { 0: 'raw_iron x3' });
        await furnace(4, 2);
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.equal(result.status, 'ok', result.text);
        assert.equal(counts().glass, 2);
        assert.deepEqual(await furnaceHolds(2, 70, -1), { 0: { name: 'raw_iron', count: 3 } }, 'their iron is untouched');
        assert.match(result.text, /furnace at 2, 70, -1 is in use \(3 raw_iron in it\)/);
        return { text: result.text.trim() };
    });

    await step('a furnace sealed inside stone is not known, so the bot says it knows of none', async () => {
        await reset('sand 2', 'coal 1');
        await cmd('fill 5 70 -1 7 72 1 stone');
        await cmd('setblock 6 71 0 furnace');
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 2));
        assert.notEqual(result.status, 'ok', result.text);
        assert.match(result.text, /There is no furnace nearby that I know of/);
        assert.equal(rawName(6, 71, 0), 'furnace', 'and it is there all the same');
        assert.equal(counts().sand, 2);
        return { text: result.text.trim() };
    });

    await step('clearFurnace takes everything out of the furnace', async () => {
        await reset();
        await furnace(3, 0, { 0: 'raw_iron x3', 2: 'iron_ingot x2' });
        await settle();
        const result = await act('test:clear', () => skills.clearNearestFurnace(bot));
        assert.equal(result.status, 'ok', result.text);
        assert.equal(counts().raw_iron, 3);
        assert.equal(counts().iron_ingot, 2);
        assert.deepEqual(await furnaceHolds(3, 70, 0), {});
        return { text: result.text.trim() };
    });

    await step('stopped half way, the bot leaves the furnace working, with no window left open', async () => {
        await reset('sand 8', 'coal 1');
        await furnace(3, 0);
        await settle();
        const running = act('test:smelt', () => skills.smeltItem(bot, 'sand', 8));
        await delay(25000);
        await agent.actions.stop();
        const result = await running;
        assert.notEqual(result.status, 'ok', result.text);
        // A stopped action's result is "Action cancelled", and what it says after that is dropped, so the
        // furnace itself is the check: still loaded and working, with no window left open.
        await delay(2500);
        const holds = await furnaceHolds(3, 70, 0);
        assert.equal(holds[0]?.name, 'sand', JSON.stringify(holds));
        assert.equal(bot.currentWindow, null);
        return { text: result.text.trim(), holds };
    });

    await step('stopped half way, smelting again goes on with it in the same furnace and finishes', async () => {
        await reset('sand 6', 'coal 1');
        await furnace(3, 0);
        await settle();
        const running = act('test:smelt', () => skills.smeltItem(bot, 'sand', 6));
        await delay(22000);
        await agent.actions.stop();
        await running;
        assert.equal(counts().sand ?? 0, 0, 'its sand is in the furnace');
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 6));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /went on with the sand I had left in the furnace at 3, 70, 0/);
        assert.equal(counts().glass, 6, JSON.stringify(counts()));
        assert.deepEqual(await furnaceHolds(3, 70, 0), {}, 'and left it empty');
        return { text: result.text.trim() };
    });

    await step('loaded and left: the bot walks off, is told when it is done, and collects', async () => {
        await reset('sand 4', 'coal 1');
        await furnace(3, 0);
        await settle();
        const loaded = await act('test:load', () => smelting.loadFurnace(bot, 'sand', 4));
        assert.equal(loaded.status, 'ok', loaded.text);
        assert.match(loaded.text, /put 4 sand and 1 coal in the furnace at 3, 70, 0\. The 4 sand in it will be glass in about 40 seconds/);
        assert.equal(bot.currentWindow, null);
        // Off doing something else, out of reach of the furnace.
        await cmd(`tp ${NAME} -8.5 70 0.5 90 20`);
        await delay(43000);
        const busy = await act('test:other', async () => {});
        assert.match(busy.message, /The glass in the furnace at 3, 70, 0 should be done \(!collectFurnace\)/, 'told once, on the next result');
        const collected = await act('test:collect', () => smelting.collectFurnace(bot));
        assert.equal(collected.status, 'ok', collected.text);
        assert.match(collected.text, /From the furnace at 3, 70, 0 I took 4 glass/);
        assert.equal(counts().glass, 4);
        assert.deepEqual(await furnaceHolds(3, 70, 0), {});
        return { text: collected.text.trim() };
    });

    await step('a lava farm near: the bot fills its bucket and smelts on the lava, keeping its coal', async () => {
        await reset('sand 4', 'coal 2', 'bucket 1');
        await furnace(3, -1);
        await cmd('setblock 3 70 1 lava_cauldron');
        await settle();
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 4));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /filled a bucket with lava from the cauldron at 3, 70, 1/);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 4, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1, 'its bucket came back');
        assert.equal(rawName(3, 70, 1), 'cauldron', 'the lava came out of the cauldron');
        assert.deepEqual(await furnaceHolds(3, 70, -1), {});
        return { text: result.text.trim() };
    });

    // No bucket on it and none in a furnace: a player goes and gets one from their chests. The cauldron is
    // left full, and the bucket comes back to the bag, not the chest: it is the bot's to keep using.
    await step('a lava farm near and no bucket: the bot takes one from its own chest and smelts on the lava', async () => {
        await reset('sand 4', 'coal 2');
        await furnace(3, -1);
        await cmd('setblock 3 70 1 lava_cauldron');
        await cmd('setblock 4 70 3 chest[facing=west]');
        await cmd('item replace block 4 70 3 container.0 with bucket 1');
        await settle();
        await ownChest(4, 70, 3);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 4));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /took an empty bucket from the chest at 4, 70, 3 \(your own\)\. I filled a bucket with lava/, result.text);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 4, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1, 'the bucket came back out of the fuel slot');
        assert.deepEqual(await furnaceHolds(4, 70, 3), {}, 'the bucket was taken out of the chest');
        return { text: result.text.trim() };
    });

    // The same from a shelf, which shows its bucket on its front: taken with the bot's hand, as fetching does.
    await step('a lava farm near and a bucket on the bot\'s shelf: it takes the bucket off the shelf and smelts on the lava', async () => {
        await reset('sand 4', 'coal 2');
        await furnace(3, -1);
        await cmd('setblock 3 70 1 lava_cauldron');
        await cmd('setblock 2 70 -3 oak_shelf[facing=south]');
        await cmd('item replace block 2 70 -3 container.1 with bucket 1');
        await bot.lookAt(new Vec3(2.5, 70.5, -2.5), true);
        await settle();
        await ownChest(2, 70, -3);
        const result = await act('test:smelt', () => skills.smeltItem(bot, 'sand', 4));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /took an empty bucket from the oak_shelf at 2, 70, -3 \(your own\)\. I filled a bucket with lava/, result.text);
        await delay(500);
        const have = counts();
        assert.equal(have.glass, 4, JSON.stringify(have));
        assert.equal(have.coal, 2, 'no coal burned');
        assert.equal(have.bucket, 1);
        assert.deepEqual(await furnaceHolds(2, 70, -3), {}, 'the shelf is empty');
        return { text: result.text.trim() };
    });

    console.log(JSON.stringify({ summary: 'smelting scenarios', passed: results.length }));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try { bot?.quit(); } catch { /* already gone */ }
    await server.stop();
}
