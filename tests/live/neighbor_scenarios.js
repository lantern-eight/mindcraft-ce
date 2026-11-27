// SPDX-License-Identifier: CC0-1.0
// Live scenarios for good-neighbor rules: the bot doesn't break what other players built (no model calls, free to run).
//   node tests/live/neighbor_scenarios.js [--port=55939] [--only=<regex>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The scenes put a player's build in the bot's way (a plank wall, a dirt wall it watched go up, a log cabin
// beside a real tree) and check that the bot gets on with its job without breaking any of it. The test peeks
// at the real blocks to check; the bot never may.
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

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55939);
const NAME = 'Neighbor';
const results = [];
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
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
    const config = { ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        ...fairPlaySettings(), world_memory: true, good_neighbor: { protect_builds: true, protect_chests: true, protect_animals: true, protected_areas: [] } };
    setSettings(config);
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills, reflexes and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
        prompter: { profile: {}, getInitModes: () => ({}) },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        openChat: () => {}, handleMessage: () => {},
        clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt: () => {
            bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
        },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'neighbor-memory-')) });
    assert.ok(handle, 'fair play installed');
    const neighbor = installGoodNeighbor(agent, { config });
    assert.ok(neighbor, 'good-neighbor rules installed');
    const act = (label, fn, timeout = 3) => agent.actions.runAction(label, fn, { timeout });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek; the bot may not
    /** The cells of a box that no longer hold the block they should. */
    const missing = (name, [x0, y0, z0], [x1, y1, z1]) => {
        const gone = [];
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++)
            if (rawName(x, y, z) !== name) gone.push(`${x},${y},${z}`);
        return gone;
    };
    const count = (name, [x0, y0, z0], [x1, y1, z1]) => {
        let n = 0;
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (rawName(x, y, z) === name) n++;
        return n;
    };

    // A thick stone floor with its top at y 69 and open air above, the bot in the middle facing south.
    async function reset({ facing = 0 } = {}) {
        // A walk the last scene gave up on can leave the pathfinder a goal, which it would go on walking to.
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await cmd('fill -16 60 -16 16 69 16 stone');
        await cmd('fill -16 70 -16 16 95 16 air');
        await cmd('kill @e[type=item]');
        await cmd(`clear ${NAME}`);
        await cmd(`tp ${NAME} 0.5 70 0.5 ${facing} 0`);
        await cmd(`give ${NAME} iron_pickaxe`);
        await cmd(`give ${NAME} iron_axe`);
        await cmd(`give ${NAME} iron_shovel`);
        await waitFor(() => bot.entity.position.distanceTo(new Vec3(0.5, 70, 0.5)) < 0.6, 10000, () => `the bot is at ${bot.entity.position}`);
        await delay(2000);
    }
    await cmd('gamerule doDaylightCycle false');
    await cmd('gamerule doTileDrops true');
    await cmd('time set noon');
    await waitFor(() => handle.wiring && handle.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${handle.wiring?.reason}`);

    await step('a plank wall across the way is never dug through', async () => {
        await reset();
        // A closed room of bedrock, which nobody can dig, cut in two by a player's plank wall. The only way to
        // the far side is through the planks, which the stock bot takes. This one stays on its side.
        await cmd('fill -4 69 -1 4 73 11 bedrock');
        await cmd('fill -3 70 0 3 72 10 air');
        await cmd('fill -3 70 5 3 72 5 oak_planks');
        await cmd(`tp ${NAME} 0.5 70 1.5 0 0`); // put back in the room: building the room moved it
        await cmd(`give ${NAME} dirt 16`);
        await delay(1500);
        const result = await act('test:go', () => skills.goToPosition(bot, 0, 70, 9, 1), 2);
        assert.deepEqual(missing('oak_planks', [-3, 70, 5], [3, 72, 5]), [], `the wall is whole: ${result.text}`);
        assert.ok(bot.entity.position.z < 5, 'and the bot is still on its own side of it');
        assert.notEqual(result.status, 'ok', result.text);
        return { text: result.text.trim().slice(-300) };
    });

    await step('told to break a plank, the bot refuses and says why', async () => {
        await reset();
        await cmd('setblock 0 70 2 oak_planks');
        await delay(1500);
        const before = { at: bot.entity.position.toString(), yaw: bot.entity.yaw.toFixed(2) };
        const result = await act('test:break', () => skills.breakBlockAt(bot, 0, 70, 2));
        assert.equal(rawName(0, 70, 2), 'oak_planks', `the plank stands: ${result.text}`);
        // It saw the plank go up, so it knows someone put it there; otherwise planks are never natural ground.
        assert.match(result.text, /Breaking oak_planks at 0, 70, 2 refused: (I saw someone put it there|oak_planks isn't natural ground)/, JSON.stringify(before));
        return { text: result.text.trim() };
    });

    await step('a player lets it break one plank of two: it breaks that one, once, and the other stands', async () => {
        await reset();
        await cmd('setblock 0 70 2 oak_planks');
        await cmd('setblock 1 70 2 oak_planks');
        await delay(1500);
        // As a player's chat line comes in. It is taken before any model, and answered.
        const said = [];
        const openChat = agent.openChat;
        agent.openChat = text => said.push(text);
        try { await agent.handleMessage('Steve', '!allowBreak 0 70 2'); } finally { agent.openChat = openChat; }
        assert.match(said[0] ?? '', /^Okay, Steve: I may break the block at 0, 70, 2/);
        const result = await act('test:break', () => skills.breakBlockAt(bot, 0, 70, 2));
        assert.equal(rawName(0, 70, 2), 'air', `the granted plank is broken: ${result.text}`);
        const other = await act('test:break', () => skills.breakBlockAt(bot, 1, 70, 2));
        assert.equal(rawName(1, 70, 2), 'oak_planks', 'the one beside it stands');
        assert.match(other.text, /refused: .*!allowBreak 1, 70, 2/);
        // Put back, the granted spot is protected again: the grant was used up.
        await cmd('setblock 0 70 2 oak_planks');
        await delay(1500);
        const again = await act('test:break', () => skills.breakBlockAt(bot, 0, 70, 2));
        assert.equal(rawName(0, 70, 2), 'oak_planks', `used up: ${again.text}`);
        return { said: said[0], refused: other.text.trim() };
    });

    await step('a dirt wall the bot watched go up is someone\'s: tagged built, and not dug through', async () => {
        await reset();
        // The bot looks down a closed room of bedrock. Then someone walls it across with dirt, which the stock
        // bot would dig straight through: dirt is natural ground, until the bot sees someone put it there.
        await cmd('fill -4 69 -1 4 73 13 bedrock');
        await cmd('fill -3 70 0 3 72 12 air');
        await cmd(`tp ${NAME} 0.5 70 1.5 0 0`); // put back in the room, facing down it: building the room moved it
        await delay(3000); // a look or two at the open room
        await cmd('fill -3 70 6 3 72 6 dirt');
        await waitFor(() => handle.memory?.cells?.tagOf(0, 70, 6) === 'built', 15000,
            () => `memory has ${handle.memory?.cells?.read(0, 70, 6)} tagged ${handle.memory?.cells?.tagOf(0, 70, 6)}; the bot at ${bot.entity.position} yaw ${bot.entity.yaw.toFixed(2)}; really ${rawName(0, 70, 6)}`);
        const result = await act('test:go', () => skills.goToPosition(bot, 0, 70, 11, 1), 1);
        assert.deepEqual(missing('dirt', [-3, 70, 6], [3, 72, 6]), [], `the wall is whole: ${result.text}`);
        assert.ok(bot.entity.position.z < 6, 'and the bot is still on its own side of it');
        return { text: result.text.trim().slice(-300) };
    });

    await step('collecting logs fells the tree, and leaves the log cabin beside it standing', async () => {
        await reset({ facing: -90 }); // east
        // A real oak to the east, grown as the world grows them, on a patch of grass.
        await cmd('fill 5 69 -2 9 69 2 grass_block');
        await cmd('place feature minecraft:oak 7 70 0');
        // A log cabin to the west: log walls, a plank frame round a door.
        await cmd('fill -9 70 -3 -5 73 3 oak_log hollow');
        await cmd('fill -5 70 -1 -5 72 1 oak_planks');
        await cmd('setblock -5 70 0 oak_door[half=lower,facing=east]');
        await cmd('setblock -5 71 0 oak_door[half=upper,facing=east]');
        await delay(2000);
        const treeLogs = count('oak_log', [5, 70, -2], [9, 80, 2]);
        assert.ok(treeLogs >= 4, `the tree grew (${treeLogs} logs)`);
        const cabinLogs = count('oak_log', [-9, 70, -3], [-5, 73, 3]);
        const result = await act('test:collect', () => skills.collectBlock(bot, 'oak_log', 3), 5);
        assert.equal(count('oak_log', [-9, 70, -3], [-5, 73, 3]), cabinLogs, `the cabin is whole: ${result.text}`);
        const felled = treeLogs - count('oak_log', [5, 70, -2], [9, 80, 2]);
        assert.ok(felled >= 1, `some of the tree was felled: ${result.text}`);
        return { felled, text: result.text.trim().slice(-300) };
    });

    await step('after all of that, the server log shows no command issued by the bot', () => {
        assert.doesNotMatch(server.log, new RegExp(`${NAME} issued server command`));
    });
    console.log(JSON.stringify({ status: 'passed', steps: results.length }));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, passedSteps: results.length }));
    process.exitCode = 1;
} finally {
    bot?.quit();
    await server.stop();
}
