// SPDX-License-Identifier: CC0-1.0
// Live checks of work that a player's turning could slow or spoil (no model calls, free to run).
//   node tests/live/turning_scenarios.js [--port=55936]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// Strict fair play turns the bot's head as a player on a controller does, a half turn in a second, and sees
// through a player's screen. Every look takes time, and what is beside or behind the bot is unknown until it
// turns. These scenes do ordinary work that turns a lot, and say how long it took and whether anything went
// wrong on the way:
//
//   1. Gathering: logs from two small trees, one ahead and one behind, then stone from a boulder to the side.
//   2. A bridge one block wide over a drop.
//   3. A ladder up a tower.
//   4. A gap of two blocks to jump, high up.
//
// Each must succeed in any view and at any turn speed: slower is fine, a fall or a stall is not. Run it with
// MC_TEST_TURN=instant (and MC_TEST_VIEW=all) to compare: tests/helpers/live_view.js reads both. Each scene is
// in a place of its own, built while the bot is elsewhere, and the bot is put down facing its work, as a
// player who walked up to it would be.
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
import { fairPlaySettings, LIVE_VIEW, LIVE_TURN } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55936);
const NAME = 'Turner';
const results = [];
// A scene that fails is recorded and the next one runs: they are measurements as much as checks, and each is
// built in a place of its own.
const step = async (name, fn) => {
    const started = Date.now();
    let result;
    try {
        result = { name, status: 'passed', durationMs: Date.now() - started, ...((await fn()) || {}) };
    } catch (error) {
        result = { name, status: 'failed', durationMs: Date.now() - started, error: error.message };
    }
    result.durationMs = Date.now() - started;
    results.push(result);
    console.log(JSON.stringify(result));
};

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        ...fairPlaySettings(), world_memory: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [], memory_bank: new MemoryBank(),
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'turning-live-')) });
    assert.ok(handle, 'fair play is on');
    console.log(JSON.stringify({ view: LIVE_VIEW, turn: LIVE_TURN, turnSpeed: handle.policy?.turn_speed ?? null }));

    const act = (label, fn, minutes = 4) => agent.actions.runAction(label, fn, { timeout: minutes });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek at the truth
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
    const health = () => bot.health;

    // The flat world's ground: the bot stands on grass, with two blocks of dirt and then bedrock under it.
    await cmd(`tp ${NAME} 0.5 -60 0.5 -90 0`);
    await delay(2500);
    const G = Math.floor(bot.entity.position.y + 0.01);
    assert.equal(rawName(0, G - 1, 0), 'grass_block', `the bot stands on grass (feet at y ${G})`);

    /** Puts the bot down at a spot facing a way (yaw in the game's degrees: -90 is east), on a clean slate. */
    const placeAt = async (x, y, z, yaw = -90) => {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await cmd(`tp ${NAME} ${x + 0.5} ${y} ${z + 0.5} ${yaw} 0`);
        await cmd(`effect give ${NAME} instant_health 1 10 true`);
        await delay(2500);
    };
    /** Builds a scene while the bot is somewhere else: flat ground over the box, then the scene's blocks. */
    const build = async (x0, z0, x1, z1, commands) => {
        await cmd(`forceload add ${x0} ${z0} ${x1} ${z1}`);
        await delay(2000);
        await cmd(`fill ${x0} ${G} ${z0} ${x1} ${G + 14} ${z1} air`);
        await cmd(`fill ${x0} ${G - 1} ${z0} ${x1} ${G - 1} ${z1} grass_block`);
        for (const command of commands) await cmd(command);
        // Twice: the second takes the loot the mobs the first killed dropped, which the bot would go and pick up.
        await cmd('kill @e[type=!player]');
        await delay(300);
        await cmd('kill @e[type=!player]');
        await cmd('forceload remove all');
    };
    /**
     * Walks the bot to a spot with the travel skill, and says what happened on the way: how long it took, how
     * often the route was planned again, the lowest the bot got and the damage it took.
     */
    const walk = async (spot, { deadlineMs = 90000 } = {}) => {
        let lowest = Infinity;
        const onMove = () => { lowest = Math.min(lowest, bot.entity.position.y); };
        bot.on('move', onMove);
        const replansBefore = handle.legs?.replans ?? 0;
        const healthBefore = health();
        const started = Date.now();
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ text: 'deadline' }); }, deadlineMs); });
        const result = await Promise.race([act('test:walk', () => skills.goToPosition(bot, spot.x, spot.y, spot.z, 0.5)), deadline]);
        clearTimeout(timer);
        bot.off('move', onMove);
        const at = bot.entity.position;
        return {
            text: (result.text ?? result.message ?? '').trim().slice(0, 200), seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            replans: (handle.legs?.replans ?? 0) - replansBefore, lowest: Number(lowest.toFixed(2)), damage: Math.max(0, healthBefore - health()),
            left: Number(at.distanceTo(new Vec3(spot.x + 0.5, spot.y, spot.z + 0.5)).toFixed(1)),
        };
    };

    // ---- 1. Gathering ----
    {
        const Z = 100;
        // A tree of three logs under a cap of leaves, as a small oak is: every log within reach from the ground.
        const tree = (x, z) => [
            `fill ${x} ${G} ${z} ${x} ${G + 2} ${z} oak_log`,
            `fill ${x - 1} ${G + 3} ${z - 1} ${x + 1} ${G + 3} ${z + 1} oak_leaves[persistent=true]`,
            `setblock ${x} ${G + 4} ${z} oak_leaves[persistent=true]`,
        ];
        await build(-16, Z - 16, 16, Z + 16, [
            ...tree(6, Z), // ahead, to the east
            ...tree(-7, Z + 1), // behind
            `fill -1 ${G} ${Z - 9} 1 ${G + 1} ${Z - 7} stone`, // a boulder to the north, beside the bot
        ]);
        await placeAt(0, G, Z);
        await cmd(`clear ${NAME}`);
        await cmd(`give ${NAME} wooden_pickaxe`);
        await settled();

        await step('1: gathering six logs from a tree ahead and one behind, then four stone from beside: all of it', async () => {
            const startedLogs = Date.now();
            const logs = await act('test:logs', () => skills.collectBlock(bot, 'oak_log', 6));
            const logSeconds = Number(((Date.now() - startedLogs) / 1000).toFixed(1));
            await skills.pickupNearbyItems(bot).catch(() => {});
            const gotLogs = count('oak_log');
            const startedStone = Date.now();
            const stone = await act('test:stone', () => skills.collectBlock(bot, 'stone', 4));
            const stoneSeconds = Number(((Date.now() - startedStone) / 1000).toFixed(1));
            await skills.pickupNearbyItems(bot).catch(() => {});
            const gotStone = count('cobblestone');
            // Whether world memory ever had the tree behind: a search answers from memory for what is out of view.
            const behind = [0, 1, 2].map(dy => handle.memory?.cells.read(-7, G + dy, Z + 1) ?? null);
            const details = { logs: gotLogs, logSeconds, stone: gotStone, stoneSeconds, treeBehindInMemory: behind,
                logText: (logs?.message ?? '').trim().slice(-400), stoneText: (stone?.message ?? '').trim().slice(-400) };
            assert.ok(gotLogs >= 6, `six logs gathered: ${JSON.stringify(details)}`);
            assert.ok(gotStone >= 4, `four stone gathered: ${JSON.stringify(details)}`);
            return details;
        });
    }

    // Hard ground is built in the air, H blocks up, so a step wrong is a fall.
    const H = G + 8;

    // ---- 2. A bridge one block wide ----
    {
        const Z = 200;
        await build(-4, Z - 6, 30, Z + 6, [
            `fill 0 ${H} ${Z - 2} 4 ${H} ${Z + 2} stone`,
            `fill 5 ${H} ${Z} 18 ${H} ${Z} stone`,
            `fill 19 ${H} ${Z - 2} 23 ${H} ${Z + 2} stone`,
        ]);
        await placeAt(2, H + 1, Z);
        await settled();

        await step('2: across a bridge one block wide, high up: no fall', async () => {
            const trip = await walk({ x: 21, y: H + 1, z: Z });
            assert.ok(trip.left <= 1.5, `it stopped ${trip.left} blocks short: ${JSON.stringify(trip)}`);
            assert.ok(trip.lowest >= H + 0.9, `it never left the bridge: ${JSON.stringify(trip)}`);
            return trip;
        });
    }

    // ---- 3. A ladder up a tower ----
    {
        const Z = 300;
        await build(-4, Z - 6, 20, Z + 6, [
            `fill 10 ${G} ${Z - 1} 12 ${G + 5} ${Z + 1} stone`,
            `fill 9 ${G} ${Z} 9 ${G + 5} ${Z} ladder[facing=west]`,
        ]);
        await placeAt(2, G, Z);
        await settled();

        await step('3: up a ladder to the top of a tower', async () => {
            const trip = await walk({ x: 11, y: G + 6, z: Z });
            assert.ok(trip.left <= 1.5, `it stopped ${trip.left} blocks short: ${JSON.stringify(trip)}`);
            return trip;
        });
    }

    // ---- 4. A gap to jump ----
    {
        const Z = 400;
        await build(-4, Z - 6, 24, Z + 6, [
            `fill 0 ${H} ${Z - 1} 6 ${H} ${Z + 1} stone`,
            `fill 9 ${H} ${Z - 1} 15 ${H} ${Z + 1} stone`,
        ]);
        await placeAt(3, H + 1, Z);
        await settled();

        await step('4: over a gap of two blocks, high up: no fall', async () => {
            const trip = await walk({ x: 12, y: H + 1, z: Z });
            assert.ok(trip.left <= 1.5, `it stopped ${trip.left} blocks short: ${JSON.stringify(trip)}`);
            assert.ok(trip.lowest >= H + 0.5, `it made the jump: ${JSON.stringify(trip)}`);
            return trip;
        });
    }

    await step('after all of that, the server log shows no command issued by the bot', () => {
        assert.doesNotMatch(server.log, new RegExp(`${NAME} issued server command`));
    });

    const failed = results.filter(r => r.status === 'failed').map(r => r.name);
    console.log(JSON.stringify({ status: failed.length ? 'failed' : 'passed', steps: results.length, failed, view: LIVE_VIEW, turn: LIVE_TURN }));
    if (failed.length) process.exitCode = 1;
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, passedSteps: results.length, view: LIVE_VIEW, turn: LIVE_TURN }));
    process.exitCode = 1;
} finally {
    bot?.quit();
    await server.stop();
}
