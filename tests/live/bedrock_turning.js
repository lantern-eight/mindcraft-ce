// SPDX-License-Identifier: CC0-1.0
// Work that a player's turning could slow or spoil, on a real Bedrock Dedicated Server (no model calls, free
// to run). The Bedrock twin of turning_scenarios.js.
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_turning.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scenes are built and torn down from the console.
//
// Strict fair play turns the bot's head as a player on a controller does and sees through a player's screen.
// These scenes do ordinary work that turns a lot, and say how long it took and whether anything went wrong:
//
//   1. Gathering: logs from two small trees, one ahead and one behind, then stone from a boulder to the side.
//   2. A bridge one block wide over a pit.
//   3. A gap of two blocks to jump over a pit.
//
// (The Java scenes climb a ladder too. A ladder set from Bedrock's console needs its facing in brackets, which
// the fixture won't send, so it is left out here.) Each must succeed in any view and at any turn speed: slower
// is fine, a fall or a stall is not. MC_TEST_TURN=instant and MC_TEST_VIEW=all compare (live_view.js).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings, faceExactly, LIVE_VIEW, LIVE_TURN } from '../helpers/live_view.js';

const NAME = 'BedrockTurner';
const report = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);

async function waitFor(check, ms, why) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(why());
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const skills = await import('../../src/agent/library/skills.js');
    const world = await import('../../src/agent/library/world.js');

    let agent, fair;
    const act = (label, fn, minutes = 4) => agent.actions.runAction(label, fn, { timeout: minutes });
    const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);

    // A floor of stone five thick, its top 40 blocks above the bot's spawn: room under the top to cut pits a
    // fall into which shows, without a fall that kills.
    async function floor() {
        for (let x = -20; x <= 20; x += 10) await fill([x, -4, -20], [Math.min(x + 9, 20), 0, 20], 'stone');
        for (let x = -20; x <= 20; x += 10) await fill([x, 1, -20], [Math.min(x + 9, 20), 6, 20], 'air');
    }
    /** Puts the bot down at a cell facing a way (yaw in the game's degrees: -90 is east), on a clean slate. */
    async function placeAt(cell, yaw = -90) {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, 2500);
        await cmd(`effect ${NAME} instant_health 1 10 true`);
        await faceExactly(bot, (180 - yaw) * Math.PI / 180, 0);
        await delay(1000);
        await waitFor(() => !fair.recorder?.busy, 20000, () => 'the recorder never settled');
    }
    /** Walks to a cell with the travel skill, and says how it went: time, replans, the lowest the bot got. */
    async function walk(cell, deadlineMs = 90000) {
        let lowest = Infinity;
        const onMove = () => { lowest = Math.min(lowest, bot.entity.position.y); };
        bot.on('move', onMove);
        const replansBefore = fair.legs?.replans ?? 0;
        const started = Date.now();
        const spot = at(...cell);
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ message: 'deadline' }); }, deadlineMs); });
        const result = await Promise.race([act('test:walk', () => skills.goToPosition(bot, spot.x, spot.y, spot.z, 0.5)), deadline]);
        clearTimeout(timer);
        bot.off('move', onMove);
        const here = bot.entity.position;
        return {
            text: (result?.message ?? '').trim().slice(0, 200), seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            replans: (fair.legs?.replans ?? 0) - replansBefore, lowestBelowStart: Number((spot.y - lowest).toFixed(2)),
            left: Number(Math.hypot(here.x - spot.x - 0.5, here.z - spot.z - 0.5).toFixed(1)),
        };
    }

    await report.step('the bot joins, the floor is built, and fair play is installed', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        agent = {
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
        fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-turning-memory-')) });
        assert.ok(fair, 'fair play installed');
        await floor();
        await placeAt([0, 1, 0]);
        assert.equal(bot.blockAt(at(0, 0, 0))?.name, 'stone', 'the bot stands on the floor');
        return { view: LIVE_VIEW, turn: LIVE_TURN, turnSpeed: fair.policy?.turn_speed ?? null };
    });

    await report.attempt('1: gathering six logs from a tree ahead and one behind, then four stone from beside: all of it', async () => {
        await floor();
        // A tree of three logs under a cap of leaves, every log within reach from the ground.
        for (const [x, z] of [[6, 0], [-7, 1]]) {
            await fill([x, 1, z], [x, 3, z], 'oak_log');
            await fill([x - 1, 4, z - 1], [x + 1, 4, z + 1], 'oak_leaves');
        }
        await fill([-1, 1, -9], [1, 2, -7], 'stone'); // a boulder to the north, beside the bot
        await cmd(`clear ${NAME}`);
        await cmd(`give ${NAME} wooden_pickaxe`);
        await placeAt([0, 1, 0]);
        const startedLogs = Date.now();
        const logs = await act('test:logs', () => skills.collectBlock(bot, 'oak_log', 6));
        const logSeconds = Number(((Date.now() - startedLogs) / 1000).toFixed(1));
        const startedStone = Date.now();
        const stone = await act('test:stone', () => skills.collectBlock(bot, 'stone', 4));
        const stoneSeconds = Number(((Date.now() - startedStone) / 1000).toFixed(1));
        // Drops still lying about, as the server sent them, against what the bot could see: a drop that came
        // after the pickup had looked is told apart from one it never saw.
        const seenIds = new Set(world.getNearbyEntities(bot, 16).filter(e => e.lastSeenAt === undefined).map(e => e.id));
        const lying = Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 16)
            .map(e => ({ at: e.position.floored(), off: Number(e.position.distanceTo(bot.entity.position).toFixed(1)), seen: seenIds.has(e.id) }));
        const details = { logs: count('oak_log'), logSeconds, stone: count('cobblestone'), stoneSeconds, lying,
            logText: (logs?.message ?? '').trim().slice(-300), stoneText: (stone?.message ?? '').trim().slice(-300) };
        assert.ok(details.logs >= 6, `six logs gathered: ${JSON.stringify(details)}`);
        assert.ok(details.stone >= 4, `four stone gathered: ${JSON.stringify(details)}`);
        return details;
    });

    await report.attempt('2: across a bridge one block wide over a pit: no fall', async () => {
        await floor();
        await fill([4, -4, -3], [16, 0, 3], 'air');
        await fill([4, 0, 0], [16, 0, 0], 'stone');
        await placeAt([1, 1, 0]);
        const trip = await walk([19, 1, 0]);
        assert.ok(trip.left <= 1.5, `it stopped ${trip.left} blocks short: ${JSON.stringify(trip)}`);
        assert.ok(trip.lowestBelowStart <= 0.1, `it never left the bridge: ${JSON.stringify(trip)}`);
        return trip;
    });

    await report.attempt('3: over a gap of two blocks across a pit: no fall', async () => {
        await floor();
        await fill([5, -4, -3], [6, 0, 3], 'air');
        await placeAt([1, 1, 0]);
        const trip = await walk([10, 1, 0]);
        assert.ok(trip.left <= 1.5, `it stopped ${trip.left} blocks short: ${JSON.stringify(trip)}`);
        // Bedrock's jump across can dip a block or so below the far edge as it lands, at any turn speed; down in
        // the pit would be 5 below.
        assert.ok(trip.lowestBelowStart <= 2, `it made the jump: ${JSON.stringify(trip)}`);
        return trip;
    });
} catch (error) {
    console.error(error);
} finally {
    try {
        // Take the floor away, the bot first back down where it began (see bedrock_threats.js for why).
        if (origin) {
            await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y - 39} ${origin.z + 0.5}`, 1500);
            for (let x = -20; x <= 20; x += 10) await fill([x, -4, -20], [Math.min(x + 9, 20), 6, 20], 'air');
        }
    } catch { /* the console is gone */ }
    const result = report.summary();
    console.log(JSON.stringify(result));
    bot?.quit();
    // A second for the leave to reach the server: a bot of the same name joining straight after (this script
    // run again) is turned away while the server still holds the last one.
    process.exitCode = result.status === 'passed' ? 0 : 1;
    setTimeout(() => process.exit(), 1000).unref();
}
