// SPDX-License-Identifier: CC0-1.0
// Live checks of exploring against a real server (no model calls, free to run).
//   node tests/live/explore_scenarios.js [--port=55940] [--only=<part of a scene's name>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests run the exploring loop on a pretend world. These run !explore and !exploreFor as the model
// calls them, under strict fair play with world memory, on the flat ground of a fresh world: real legs, the
// real pathfinder planned by fair legs, the real look round. Each scene has a strip of the world of its own,
// built while the bot is elsewhere, so that it can't have seen it:
//
//   1. Told a direction, the bot walks that way; told "on", it carries on the same way.
//   2. A stone wall across the way, out of sight at the start: the bot goes round it, and digs none of it.
//   3. A lake across the way: the bot walks round it rather than swimming across.
//   4. Sand behind the bot as it sets out: exploring for sand finds it and stops.
//   5. Sand the bot remembers, farther than a search looks: it says where, and doesn't set out.
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
import { fairPlaySettings, LIVE_VIEW } from '../helpers/live_view.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55940);
const only = arg('only');
const NAME = 'Wayfarer';
const results = [];
const step = async (name, fn) => {
    if (only && !name.includes(only)) return;
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
        ...fairPlaySettings(), world_memory: true, explore: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { exploreCommands } = await import('../../src/agent/explore/commands.js');

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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'explore-live-')) });
    assert.ok(handle?.memory, 'world memory is on');
    const [exploreCommand, exploreForCommand] = exploreCommands({ memoryOf: () => handle.memory });

    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek at the truth
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };

    /** Runs a command as the model would, with a deadline, and notes where the bot went and how long it swam. */
    const run = async (command, args, { deadlineMs = 150000 } = {}) => {
        const start = bot.entity.position.clone();
        let maxX = -Infinity, swimMs = 0, longestSwimMs = 0, swimStart = null, last = Date.now();
        const wet = [];
        const onMove = () => {
            const now = Date.now();
            const p = bot.entity.position;
            if (/water/.test(rawName(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) ?? '')) {
                swimMs += now - last;
                swimStart ??= now;
                longestSwimMs = Math.max(longestSwimMs, now - swimStart);
                wet.push({ x: p.x, z: p.z });
            } else swimStart = null;
            last = now;
            maxX = Math.max(maxX, p.x);
        };
        bot.on('move', onMove);
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ status: 'deadline', text: 'deadline' }); }, deadlineMs); });
        const started = Date.now();
        const result = await Promise.race([command.perform.structured(agent, ...args), deadline]);
        clearTimeout(timer);
        bot.off('move', onMove);
        const end = bot.entity.position;
        const trip = { outcome: result.status, text: result.text, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            dx: Math.round(end.x - start.x), dz: Math.round(end.z - start.z), maxX: Math.round(maxX), swimSeconds: Number((swimMs / 1000).toFixed(1)),
            longestSwimSeconds: Number((longestSwimMs / 1000).toFixed(1)),
            endsWet: /water/.test(rawName(Math.floor(end.x), Math.floor(end.y), Math.floor(end.z)) ?? '') };
        Object.defineProperty(trip, 'wet', { value: wet }); // where it swam, for the lake scene; too long to print
        return trip;
    };

    // The flat world's ground: the bot stands on grass, with two blocks of dirt and then bedrock under it.
    await cmd(`tp ${NAME} 0.5 -60 0.5 -90 0`);
    await delay(2500);
    const G = Math.floor(bot.entity.position.y + 0.01);
    assert.equal(rawName(0, G - 1, 0), 'grass_block', `the bot stands on grass (feet at y ${G})`);

    /** Moves the bot to a scene's starting spot, facing the given yaw (-90 is east in commands), and waits for the chunks. */
    const placeAt = async (x, z, yaw = -90) => {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await cmd(`tp ${NAME} ${x + 0.5} ${G} ${z + 0.5} ${yaw} 0`);
        await delay(2500);
    };
    /** Builds a scene while the bot is far away, keeping the chunks loaded so the console can build there. */
    const build = async (x0, z0, x1, z1, commands) => {
        await cmd(`forceload add ${x0} ${z0} ${x1} ${z1}`);
        await delay(2000);
        for (const command of commands) await cmd(command);
        await cmd('kill @e[type=!player]');
        await cmd('forceload remove all');
    };

    // ---- 1. A heading kept from one call to the next ----
    await step('1: told east the bot walks east, and told "on" it carries on east', async () => {
        await placeAt(0, 0, 0); // facing south: the way it is told, not the way it faces, is the way it goes
        await settled();
        const first = await run(exploreCommand, ['east', 48]);
        assert.equal(first.outcome, 'ok', first.text);
        assert.ok(first.dx >= 40 && Math.abs(first.dz) <= 12, JSON.stringify(first));
        const second = await run(exploreCommand, ['on', 48]);
        assert.equal(second.outcome, 'ok', second.text);
        assert.ok(second.dx >= 40 && Math.abs(second.dz) <= 12, `still east: ${JSON.stringify(second)}`);
        assert.match(second.text, /heading east/);
        return { first, second };
    });

    // ---- 2. A wall across the way ----
    await step('2: a stone wall across the way is gone round, and none of it is dug', async () => {
        const Z = 300, X = 24;
        await build(X - 2, Z - 14, X + 2, Z + 14, [`fill ${X} ${G} ${Z - 10} ${X} ${G + 3} ${Z + 10} stone`]);
        await placeAt(0, Z);
        await settled();
        const trip = await run(exploreCommand, ['east', 64]);
        let wall = 0;
        for (let z = Z - 10; z <= Z + 10; z++) for (let y = G; y <= G + 3; y++) if (rawName(X, y, z) === 'stone') wall++;
        assert.equal(wall, 21 * 4, 'the wall is whole');
        assert.ok(trip.dx > X + 6, `got past the wall: ${JSON.stringify(trip)}`);
        assert.ok(['ok', 'blocked'].includes(trip.outcome), trip.text);
        return trip;
    });

    // ---- 3. A lake across the way ----
    await step('3: a lake across the way is walked round, not swum across', async () => {
        const Z = 600, X = 20;
        await build(X, Z - 50, X + 120, Z + 50, [
            `fill ${X} ${G - 3} ${Z - 50} ${X + 60} ${G - 1} ${Z + 50} water`,
            `fill ${X + 61} ${G - 3} ${Z - 50} ${X + 120} ${G - 1} ${Z + 50} water`,
        ]);
        await placeAt(0, Z);
        await settled();
        const trip = await run(exploreCommand, ['east', 96]);
        // Beyond what it plans over (24 blocks), the lake is ground the bot hasn't seen, so a stretch may wade in
        // before turning back. What must not happen: swimming on and on, out of reach of the shore, or ending the
        // walk in the water. Either it went round an end of the lake (fifty blocks to either side) or it turned
        // back saying so.
        const { wet } = trip, shown = { ...trip };
        const fromShore = Math.max(0, ...wet.map(p => Math.min(p.x - X, X + 120 - p.x, p.z - (Z - 50), Z + 50 - p.z)));
        shown.farthestFromShore = Math.round(fromShore);
        assert.ok(trip.longestSwimSeconds <= 7, `it swam on for ${trip.longestSwimSeconds} s: ${JSON.stringify(shown)}`);
        assert.ok(fromShore <= 14, `it swam ${Math.round(fromShore)} blocks out from the shore: ${JSON.stringify(shown)}`);
        assert.ok(!trip.endsWet, `it ended the walk in the water: ${JSON.stringify(shown)}`);
        const round = trip.dx > X + 20 && Math.abs(trip.dz) >= 50;
        assert.ok(round || /water to the/.test(trip.text), `round the lake or turned from it: ${JSON.stringify(shown)}`);
        return shown;
    });

    // ---- 4. Exploring for sand ----
    const SAND = { x: 60, z: 900 };
    await step('4: exploring for sand, it finds the sand and stops there', async () => {
        await build(SAND.x - 2, SAND.z - 2, SAND.x + 2, SAND.z + 2, [`setblock ${SAND.x} ${G - 1} ${SAND.z} sand`]);
        await placeAt(0, SAND.z, 90); // facing west: the sand is behind it
        await settled();
        const trip = await run(exploreForCommand, ['sand', 'east', 160]);
        assert.equal(trip.outcome, 'ok', trip.text);
        // Through a player's screen the sand is behind the bot, and it has to explore to see it. Seeing all
        // around it may be in view from the start, and then the bot says so without setting out; one block
        // flush with flat ground that far off may also not be, and then it is found on the way.
        const found = new RegExp(`^Found sand .* at ${SAND.x}, ${G - 1}, ${SAND.z}, after exploring`);
        if (LIVE_VIEW === 'narrow') assert.match(trip.text, found);
        else assert.ok(found.test(trip.text) || new RegExp(`^sand is .* at ${SAND.x}, ${G - 1}, ${SAND.z}\\. No need to explore`).test(trip.text), trip.text);
        assert.ok(trip.dx < SAND.x + 24, `stopped instead of walking on: ${JSON.stringify(trip)}`);
        return trip;
    });

    // ---- 5. Sand it remembers ----
    await step('5: sand it remembers farther off than a search looks is said, and it doesn\'t set out', async () => {
        await placeAt(SAND.x - 110, SAND.z);
        await settled();
        const trip = await run(exploreForCommand, ['sand', 'west', 200]);
        assert.equal(trip.outcome, 'ok', trip.text);
        assert.match(trip.text, new RegExp(`^You remember sand 1\\d\\d blocks east, at ${SAND.x}, ${G - 1}, ${SAND.z}`));
        assert.ok(Math.abs(trip.dx) <= 1 && Math.abs(trip.dz) <= 1, 'it stayed where it was');
        return trip;
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
