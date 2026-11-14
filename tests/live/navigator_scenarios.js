// SPDX-License-Identifier: CC0-1.0
// Live travel scenarios against a real server (no model calls, free to run).
//   node tests/live/navigator_scenarios.js [--port=55926]
// Needs Node 22, Java 21 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check the navigator's choices with pretend legs. These check it with the real
// pathfinder, the real recorder laying the trail, and the real travel skill a command would call.
//
// The scene is a U-shaped corridor cut into solid stone. Its two arms run side by side with a wall of
// dirt one block thick between them, so the far end of the corridor is two blocks from the near end
// through the wall, and 84 on foot. Dirt is quick to dig by hand, so without a known way travel finds
// it cheaper to go straight through. The last step shows that, for comparison.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55926);
const NAME = 'Wayfinder';
const results = [];
const step = async (name, fn) => {
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

// The corridor. Arm A runs east along z = 0, the link joins the arms at its east end, arm B runs back
// west along z = 2. The dirt wall is everything between the arms.
const LENGTH = 40;
const START = { x: 0, y: 70, z: 0 };  // the west end of arm A
const FAR = { x: 0, y: 70, z: 2 };    // the west end of arm B: two blocks away, through the wall
const inCorridor = (x, y, z) => (y === 70 || y === 71) && x >= 0 && x <= LENGTH && (z === 0 || z === 2 || (z === 1 && x === LENGTH));
const inWall = (x, y, z) => (y === 70 || y === 71) && z === 1 && x >= 0 && x < LENGTH;

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline', fair_play: 'strict', world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { setTravelGuide } = await import('../../src/agent/library/travel_guide.js');
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'navigator-live-')) });
    assert.ok(handle?.navigator, 'world memory is on, with a navigator');
    const trail = () => handle.memory.trail;
    // What the navigator did on each trip, for the checks below and for the record.
    const trips = [];
    const follow = handle.navigator.follow;
    handle.navigator.follow = async (...args) => {
        const started = Date.now();
        const result = await follow(...args);
        trips.push({ ...result, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
        return result;
    };
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 2 });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek at the truth
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const walkTo = async (spot, near = 0) => {
        const result = await act('test:walk', () => skills.goToPosition(bot, spot.x, spot.y, spot.z, near));
        return result.text ?? result.message ?? '';
    };
    const distanceTo = spot => bot.entity.position.distanceTo(new Vec3(spot.x + 0.5, spot.y, spot.z + 0.5));

    /** Builds the corridor afresh. */
    const build = async () => {
        await cmd(`fill -3 69 -3 ${LENGTH + 3} 73 5 stone`);
        await cmd(`fill 0 70 0 ${LENGTH} 71 0 air`);
        await cmd(`fill 0 70 2 ${LENGTH} 71 2 air`);
        await cmd(`fill ${LENGTH} 70 1 ${LENGTH} 71 1 air`);
        await cmd(`fill 0 70 1 ${LENGTH - 1} 71 1 dirt`);
        await cmd('kill @e[type=item]');
    };
    /** Every cell of the scene that is not what was built, apart from the ones the test changed itself. */
    const changed = (allowed = () => false) => {
        const cells = [];
        for (let x = -3; x <= LENGTH + 3; x++) for (let y = 69; y <= 73; y++) for (let z = -3; z <= 5; z++) {
            const expected = inCorridor(x, y, z) ? 'air' : inWall(x, y, z) ? 'dirt' : 'stone';
            const name = rawName(x, y, z);
            if (name !== expected && !allowed(x, y, z)) cells.push(`${x},${y},${z}:${name}`);
        }
        return cells;
    };

    await build();
    await cmd(`tp ${NAME} ${START.x + 0.5} ${START.y} ${START.z + 0.5} -90 0`);
    await delay(2500);
    await settled();
    assert.deepEqual(changed(), [], 'the scene is as built');

    await step('it walks the corridor once, end to end, and back', async () => {
        // In stages, each a straight walk, so this first trip is ordinary travel and nothing else.
        const corners = [{ x: LENGTH, y: 70, z: 0 }, { x: LENGTH, y: 70, z: 2 }, FAR];
        for (const corner of corners) await walkTo(corner);
        assert.ok(distanceTo(FAR) <= 1.5, 'it reached the far end');
        for (const corner of [corners[1], corners[0], START]) await walkTo(corner);
        assert.ok(distanceTo(START) <= 1.5, 'and came back');
        assert.deepEqual(changed(), [], 'walking it broke nothing');
        // The way back was already known, so those walks followed the trail. The last one, the length
        // of an arm, is too far for one hop.
        const back = trips.at(-1);
        assert.equal(back.reached, 'end');
        assert.ok(back.hops >= 2, `the walk back down the arm took ${back.hops} hop`);
        const from = trail().nearest(START, { maxDistance: 3 }), to = trail().nearest(FAR, { maxDistance: 3 });
        const route = trail().route(from.id, to.id);
        assert.ok(route && route.ids.length >= 8, 'the trail joins the two ends the long way');
        return { crumbs: trail().size, routeStops: route.ids.length, routeSeconds: Number(route.seconds.toFixed(1)), lastWalkBack: back };
    });

    await step('L1: sent to the far end, two blocks away through the wall, it walks round and breaks nothing', async () => {
        let farthestEast = -Infinity;
        const watch = () => { farthestEast = Math.max(farthestEast, bot.entity.position.x); };
        bot.on('move', watch);
        const started = Date.now();
        const text = await walkTo(FAR);
        bot.off('move', watch);
        assert.ok(distanceTo(FAR) <= 1.5, `it stopped ${distanceTo(FAR).toFixed(1)} blocks short: ${text}`);
        assert.deepEqual(changed(), [], 'no block was broken or placed');
        assert.ok(farthestEast >= LENGTH - 1, `it went round by the far corner (x reached ${farthestEast.toFixed(1)})`);
        assert.match(text, /Following a way you have walked before/);
        assert.equal(trips.at(-1).reached, 'end', 'the navigator took it all the way');
        return { seconds: Number(((Date.now() - started) / 1000).toFixed(1)), text: text.trim().split('\n')[0], trip: trips.at(-1) };
    });

    await step('L2: with the corridor walled up halfway, it says so and still gets back', async () => {
        await cmd('fill 20 70 2 20 71 2 stone'); // across arm B, between the bot and the corner
        await delay(800);
        const walled = (x, y, z) => x === 20 && z === 2 && (y === 70 || y === 71);
        const text = await walkTo(START);
        assert.match(text, /The way you walked before is blocked near \d+, 70, 2\./);
        assert.ok(distanceTo(START) <= 1.5, `it stopped ${distanceTo(START).toFixed(1)} blocks short: ${text}`);
        const dug = changed(walled);
        return { said: text.split('\n').filter(line => /blocked|Going around/.test(line)), dug, trip: trips.at(-1), wallStillThere: rawName(20, 70, 2) === 'stone' && rawName(20, 71, 2) === 'stone' };
    });

    await step('for comparison: the same trip with no known way goes straight through the wall', async () => {
        // The scene is rebuilt and the guide taken away, so this is travel as it is without the trail.
        // What it does is reported, not asserted: it is here to show what L1 changes.
        setTravelGuide(null);
        await build();
        await cmd(`tp ${NAME} ${START.x + 0.5} ${START.y} ${START.z + 0.5} -90 0`);
        await delay(1500);
        await settled();
        let farthestEast = -Infinity;
        const watch = () => { farthestEast = Math.max(farthestEast, bot.entity.position.x); };
        bot.on('move', watch);
        await walkTo(FAR);
        bot.off('move', watch);
        return { reached: distanceTo(FAR) <= 1.5, dug: changed(), farthestEast: Number(farthestEast.toFixed(1)) };
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
