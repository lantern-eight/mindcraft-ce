// SPDX-License-Identifier: CC0-1.0
// Live checks of fair legs against a real server (no model calls, free to run).
//   node tests/live/legs_scenarios.js [--port=55932]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests run the pathfinder's search on hand-built worlds. These run the whole thing: real chunk
// data, the real recorder filling world memory on its own timer, the real travel skill a command would
// call, and the pathfinder actually walking. Four scenes on the flat ground of a fresh world, each in a
// place of its own so that what the bot remembers of one says nothing about the next:
//
//   1. A bank of dirt across the way, hollow or solid, which look alike from outside. The route the bot
//      plans must be the same for both. (Stock planning tells them apart; that is recorded for contrast.)
//   2. A stone wall across the way, too far off to have been seen when the bot sets out. It plans
//      straight at the goal, sees the wall as it comes near, plans again and walks round. Nothing is dug.
//   3. A trench across the way, the same. The bot must go round it without falling in.
//   4. A trip to somewhere well beyond the chunks the server has sent. Stock planning cannot plan into
//      chunks it has not been sent; fair legs treat them as what they are to the bot, country not seen yet.
//
// The trail is switched off here (no travel guide), so every walk is planned by the pathfinder and what is
// checked is the legs alone. tests/live/navigator_scenarios.js runs the trail and the legs together.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55932);
const NAME = 'Strider';
const results = [];
const step = async (name, fn) => {
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', ...fairPlaySettings(), world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installFairLegs, fairLegsOf } = await import('../../src/agent/fairplay/fair_legs.js');
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'legs-live-')) });
    assert.ok(handle?.legs && fairLegsOf(bot) === handle.legs, 'strict fair play gives the bot fair legs');
    setTravelGuide(null); // the legs alone: no walk here follows the trail

    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 3 });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek at the truth
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const distanceTo = spot => bot.entity.position.distanceTo(new Vec3(spot.x + 0.5, spot.y, spot.z + 0.5));

    // The flat world's ground: the bot stands on grass, with two blocks of dirt and then bedrock under it.
    await cmd(`tp ${NAME} 0.5 -60 0.5 -90 0`);
    await delay(2500);
    const G = Math.floor(bot.entity.position.y + 0.01);
    assert.equal(rawName(0, G - 1, 0), 'grass_block', `the bot stands on grass (feet at y ${G})`);

    /** Moves the bot to a scene's starting spot, facing east, and waits for the chunks there. */
    const placeAt = async (x, z) => {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await cmd(`tp ${NAME} ${x + 0.5} ${G} ${z + 0.5} -90 0`);
        await delay(2500);
    };
    /**
     * Builds a scene while the bot is somewhere else: bare flat ground over the box, whatever the world put
     * there, and then the scene's own blocks. The bot must not watch. A bot that saw the bare ground and then
     * the bank go up on it would remember the ground under the bank as open, and that memory, not the bank,
     * would be what the test measured. So the server is told to keep the scene's chunks loaded, which is
     * what lets the console build there with no player near.
     */
    const build = async (x0, z0, x1, z1, commands) => {
        await cmd(`forceload add ${x0} ${z0} ${x1} ${z1}`);
        await delay(2000);
        await cmd(`fill ${x0} ${G} ${z0} ${x1} ${G + 5} ${z1} air`);
        await cmd(`fill ${x0} ${G - 1} ${z0} ${x1} ${G - 1} ${z1} grass_block`);
        await cmd(`fill ${x0} ${G - 3} ${z0} ${x1} ${G - 2} ${z1} dirt`);
        for (const command of commands) await cmd(command);
        await cmd('kill @e[type=!player]');
        await cmd('forceload remove all');
    };
    /** The whole of a route search, as the cells of the route. */
    const plan = (goal, movements = new pf.Movements(bot)) => {
        let last = null;
        for (const { result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, { timeout: 5000, tickTimeout: 5000 })) last = result;
        return { status: last.status, cost: Number(last.cost.toFixed(1)), cells: last.path.map(node => node.hash), dug: last.path.flatMap(node => node.toBreak.map(p => `${p.x},${p.y},${p.z}`)) };
    };
    /**
     * Walks the bot to a spot with the travel skill, and says what happened on the way: the first route
     * the pathfinder took up, how often the route was planned again and why, how low the bot got.
     */
    const walk = async (spot, { deadlineMs = 90000 } = {}) => {
        let firstRoute = null, lowest = Infinity;
        const resets = {};
        const onUpdate = result => { firstRoute ??= result.path.map(node => node.hash); };
        const onReset = reason => { resets[reason] = (resets[reason] ?? 0) + 1; };
        const onMove = () => { lowest = Math.min(lowest, bot.entity.position.y); };
        bot.on('path_update', onUpdate); bot.on('path_reset', onReset); bot.on('move', onMove);
        const replansBefore = handle.legs?.replans ?? 0;
        const started = Date.now();
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ text: 'deadline' }); }, deadlineMs); });
        const result = await Promise.race([act('test:walk', () => skills.goToPosition(bot, spot.x, spot.y, spot.z, 1)), deadline]);
        clearTimeout(timer);
        bot.off('path_update', onUpdate); bot.off('path_reset', onReset); bot.off('move', onMove);
        return {
            text: (result.text ?? result.message ?? '').trim(), firstRoute, resets, lowest: Number(lowest.toFixed(2)),
            replans: (handle.legs?.replans ?? 0) - replansBefore, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            left: Number(distanceTo(spot).toFixed(1)),
        };
    };
    /** Every cell in a box that is not what `expected(x, y, z)` says was built. */
    const changed = (x0, z0, x1, z1, expected) => {
        const cells = [];
        for (let x = x0; x <= x1; x++) for (let y = G - 3; y <= G + 4; y++) for (let z = z0; z <= z1; z++) {
            const name = rawName(x, y, z), want = expected(x, y, z);
            // Grass under a wall turns to dirt by itself: not a change anyone made.
            if (name !== want && !(want === 'grass_block' && name === 'dirt')) cells.push(`${x},${y},${z}:${name}`);
        }
        return cells;
    };
    const ground = y => (y === G - 1 ? 'grass_block' : y < G - 1 ? 'dirt' : 'air');

    // ---- 1. The bank: hollow or solid, the plan is the same ----
    {
        const Z = 100;
        const inBank = (x, y, z) => x >= 6 && x <= 14 && z >= Z - 14 && z <= Z + 14 && y >= G && y <= G + 3;
        const inHollow = (x, y, z) => x >= 7 && x <= 13 && z >= Z - 13 && z <= Z + 13 && y >= G && y <= G + 2;
        const goal = new pf.goals.GoalNear(20, G, Z, 1);
        await build(-6, Z - 20, 26, Z + 20, [`fill 6 ${G} ${Z - 14} 14 ${G + 3} ${Z + 14} dirt`]);
        await placeAt(0, Z);
        await settled();

        await step('1: a solid bank and a hollow one look alike, and the bot plans the same way through both', async () => {
            const solid = plan(goal);
            await cmd(`fill 7 ${G} ${Z - 13} 13 ${G + 2} ${Z + 13} air`); // hollow it out, unseen
            await settled();
            assert.equal(rawName(10, G, Z), 'air', 'the bank really is hollow now');
            const hollow = plan(goal);
            assert.equal(solid.status, 'success');
            assert.deepEqual(hollow.cells, solid.cells, 'the same route');
            assert.equal(hollow.cost, solid.cost);
            assert.equal(handle.memory.cells.read(10, G, Z), null, 'the inside of the bank is not in memory');
            assert.ok(solid.dug.every(cell => !inBank(...cell.split(',').map(Number)) || cell.startsWith('6,')),
                `it plans to dig nothing but the face it sees: ${solid.dug}`);

            // For contrast, the same two searches as stock Mindcraft makes them, over every loaded block.
            handle.legs.stop();
            const stockHollow = plan(goal);
            await cmd(`fill 7 ${G} ${Z - 13} 13 ${G + 2} ${Z + 13} dirt`);
            await delay(800);
            const stockSolid = plan(goal);
            handle.legs = installFairLegs(bot, { getPerception: () => handle.perception });
            assert.notDeepEqual(stockHollow.cells, stockSolid.cells, 'stock planning knows which bank is hollow');
            return {
                fair: { cost: solid.cost, steps: solid.cells.length, dug: solid.dug },
                stock: { hollow: { cost: stockHollow.cost, steps: stockHollow.cells.length, throughBank: stockHollow.cells.some(cell => inHollow(...cell.split(',').map(Number))) },
                    solid: { cost: stockSolid.cost, steps: stockSolid.cells.length, throughBank: stockSolid.cells.some(cell => inHollow(...cell.split(',').map(Number))) } },
            };
        });
    }

    // ---- 2. A wall not seen from the start ----
    {
        const Z = 200;
        const inWall = (x, y, z) => x === 30 && z >= Z - 10 && z <= Z + 10 && y >= G && y <= G + 2;
        const expected = (x, y, z) => (inWall(x, y, z) ? 'stone' : ground(y));
        const goal = { x: 42, y: G, z: Z };
        await build(-6, Z - 16, 48, Z + 16, [`fill 30 ${G} ${Z - 10} 30 ${G + 2} ${Z + 10} stone`]);
        await placeAt(0, Z);
        await settled();

        await step('2: a wall too far off to see is planned straight through, then seen, and walked round', async () => {
            assert.deepEqual(changed(-6, Z - 16, 48, Z + 16, expected), [], 'the scene is as built');
            assert.equal(handle.memory.cells.read(30, G, Z), null, 'the bot has not seen the wall');
            const trip = await walk(goal);
            assert.ok(trip.left <= 2, `it stopped ${trip.left} blocks short: ${trip.text}`);
            assert.ok(trip.firstRoute?.includes(`30,${G},${Z}`), 'it set out straight for the goal, through where the wall is');
            assert.ok(trip.replans >= 1, 'and planned again when it saw the wall');
            assert.deepEqual(changed(-6, Z - 16, 48, Z + 16, expected), [], 'nothing was dug or placed');
            assert.equal(handle.memory.cells.read(30, G, Z), 'stone', 'the wall is in memory now');
            const { firstRoute, ...rest } = trip;
            return { ...rest, firstRouteSteps: firstRoute.length };
        });

        await step('2b: sent again from the start, it remembers the wall and plans round it from the first step', async () => {
            await placeAt(0, Z);
            await settled();
            const trip = await walk(goal);
            assert.ok(trip.left <= 2, `it stopped ${trip.left} blocks short: ${trip.text}`);
            assert.ok(!trip.firstRoute.some(cell => inWall(...cell.split(',').map(Number))), 'the first route does not cross the wall');
            assert.deepEqual(changed(-6, Z - 16, 48, Z + 16, expected), [], 'nothing was dug or placed');
            const { firstRoute, ...rest } = trip;
            return { ...rest, firstRouteSteps: firstRoute.length };
        });
    }

    // ---- 3. A trench not seen from the start ----
    {
        const Z = 300;
        const inTrench = (x, y, z) => x >= 30 && x <= 34 && z >= Z - 8 && z <= Z + 8 && y >= G - 3 && y <= G - 1;
        const expected = (x, y, z) => (inTrench(x, y, z) ? 'air' : ground(y));
        const goal = { x: 44, y: G, z: Z };
        await build(-6, Z - 16, 50, Z + 16, [`fill 30 ${G - 3} ${Z - 8} 34 ${G - 1} ${Z + 8} air`]);
        await placeAt(0, Z);
        await settled();

        await step('3: a trench across the way is seen in time and walked round, not fallen into', async () => {
            assert.deepEqual(changed(-6, Z - 16, 50, Z + 16, expected), [], 'the scene is as built');
            const trip = await walk(goal);
            assert.ok(trip.left <= 2, `it stopped ${trip.left} blocks short: ${trip.text}`);
            assert.ok(trip.firstRoute?.includes(`32,${G},${Z}`), 'it set out straight for the goal, over where the trench is');
            assert.ok(trip.replans >= 1, 'and planned again when it saw the trench');
            assert.ok(trip.lowest >= G - 0.1, `it never left the level ground (lowest y ${trip.lowest})`);
            assert.deepEqual(changed(-6, Z - 16, 50, Z + 16, expected), [], 'nothing was dug or placed');
            const { firstRoute, ...rest } = trip;
            return { ...rest, firstRouteSteps: firstRoute.length };
        });
    }

    // ---- 4. Beyond what the server has sent ----
    {
        const Z = 400;
        const goal = { x: 90, y: G, z: Z };
        await placeAt(0, Z);
        await settled();

        await step('4: a trip to beyond the loaded chunks is planned at once and walked', async () => {
            assert.equal(bot.blockAt(new Vec3(goal.x, G - 1, Z)), null, 'the goal is in a chunk the server has not sent');
            const trip = await walk(goal, { deadlineMs: 120000 });
            assert.ok(trip.left <= 2, `it stopped ${trip.left} blocks short: ${trip.text}`);
            assert.match(trip.text, /Found non-destructive path/);
            assert.ok(trip.firstRoute.length >= 80, `the first route already led to the goal (${trip.firstRoute.length} steps)`);
            const { firstRoute, ...rest } = trip;
            return { ...rest, firstRouteSteps: firstRoute.length };
        });

        await step('for comparison: the same trip as stock Mindcraft plans it', async () => {
            // Recorded, not asserted: it is here to show what scene 4 changes.
            handle.legs.stop();
            await placeAt(0, Z + 60);
            const trip = await walk({ x: 90, y: G, z: Z + 60 }, { deadlineMs: 120000 });
            handle.legs = installFairLegs(bot, { getPerception: () => handle.perception });
            const { firstRoute, ...rest } = trip;
            return { ...rest, firstRouteSteps: firstRoute?.length ?? 0 };
        });
    }

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
