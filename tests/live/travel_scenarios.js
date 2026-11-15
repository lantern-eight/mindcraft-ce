// SPDX-License-Identifier: CC0-1.0
// Live checks of ordinary travel, goToGoal, against a real server (no model calls, free to run).
//   node tests/live/travel_scenarios.js [--port=55930]
// Needs Node 22, Java 21 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The scene is a tunnel one block wide cut into solid stone, shaped like a U: east along z = 0, north along
// x = ARM, then back west along z = ARM. Its two ends are ARM blocks apart through the stone and three times
// that on foot. Walking it means turning two inside corners, where the stock pathfinder plans a diagonal step
// it cannot take and stands still. And with digging dear (as goToGoal's first choice of settings makes it)
// the walk is cheaper than tunnelling, but the route is long enough that finding it takes the pathfinder more
// than one 40 ms slice.
//
// No world memory and no fair play here: this is the travel every command ends in, as Mindcraft-CE has it.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55930);
const NAME = 'Walker';
const results = [];
const step = async (name, fn) => {
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

const ARM = 32;
const Y = 70;
const START = { x: 0, y: Y, z: 0 };   // the open end of the first arm
const END = { x: 0, y: Y, z: ARM };   // the open end of the last arm: ARM blocks away through stone
const inTunnel = (x, y, z) => (y === Y || y === Y + 1) && (
    (z === 0 && x >= 0 && x <= ARM) || (x === ARM && z >= 0 && z <= ARM) || (z === ARM && x >= 0 && x <= ARM));

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline', fair_play: 'off', world_memory: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name;
    const goal = spot => new pf.goals.GoalNear(spot.x, spot.y, spot.z, 1);
    const distanceTo = spot => bot.entity.position.distanceTo(new Vec3(spot.x + 0.5, spot.y, spot.z + 0.5));
    // Counts the pathfinder's "stuck" resets: it stood still for a few seconds and planned again.
    const stuckCounter = () => {
        let count = 0;
        const onReset = reason => { if (reason === 'stuck') count++; };
        bot.on('path_reset', onReset);
        return { get count() { return count; }, stop: () => bot.off('path_reset', onReset) };
    };
    // Gives up on a walk after `ms`, so a hang is measured instead of waited out.
    const withDeadline = async (walk, ms) => {
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { bot.pathfinder.setGoal(null); resolve('deadline'); }, ms); });
        try { return await Promise.race([walk().then(() => 'arrived', error => `error: ${error.message}`), deadline]); }
        finally { clearTimeout(timer); }
    };

    const build = async () => {
        await cmd(`fill -3 ${Y - 1} -3 ${ARM + 3} ${Y + 3} ${ARM + 3} stone`);
        await cmd(`fill 0 ${Y} 0 ${ARM} ${Y + 1} 0 air`);
        await cmd(`fill ${ARM} ${Y} 0 ${ARM} ${Y + 1} ${ARM} air`);
        await cmd(`fill 0 ${Y} ${ARM} ${ARM} ${Y + 1} ${ARM} air`);
        await cmd('kill @e[type=item]');
    };
    /** Every cell of the scene that is not as built. */
    const changed = () => {
        const cells = [];
        for (let x = -3; x <= ARM + 3; x++) for (let y = Y - 1; y <= Y + 3; y++) for (let z = -3; z <= ARM + 3; z++) {
            const name = rawName(x, y, z);
            if (name !== (inTunnel(x, y, z) ? 'air' : 'stone')) cells.push(`${x},${y},${z}:${name}`);
        }
        return cells;
    };
    const placeAt = async spot => {
        await cmd(`tp ${NAME} ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}`);
        await delay(1500);
    };

    await build();
    await placeAt(START);
    assert.deepEqual(changed(), [], 'the scene is as built');

    await step('for comparison: the old check reads one 40 ms slice of the search', async () => {
        // What goToGoal used to ask. Recorded, not asserted: whether this route fits in one slice depends on
        // the machine. When it does not, the old goToGoal fell back to digging.
        const movements = new pf.Movements(bot);
        movements.digCost = 10;
        movements.placeCost = 2;
        const started = Date.now();
        const firstSlice = bot.pathfinder.getPathTo(movements, goal(END), 1000).status;
        return { firstSlice, ms: Date.now() - started };
    });

    await step('for comparison: the stock pathfinder in the same tunnel, no digging', async () => {
        // The step goToGoal now avoids. Recorded, not asserted, so a change in the pathfinder shows up here
        // as a number instead of a failure.
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        const stuck = stuckCounter();
        const started = Date.now();
        const outcome = await withDeadline(() => bot.pathfinder.goto(goal(END)), 30000);
        stuck.stop();
        const result = { outcome, stuck: stuck.count, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), left: Number(distanceTo(END).toFixed(1)) };
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        return result;
    });

    await placeAt(START);
    await build();

    await step('goToGoal walks the tunnel round both corners, never stuck, breaking nothing', async () => {
        bot.output = '';
        const stuck = stuckCounter();
        const started = Date.now();
        const outcome = await withDeadline(() => skills.goToGoal(bot, goal(END)), 60000);
        stuck.stop();
        const said = bot.output.trim().split('\n');
        const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
        assert.equal(outcome, 'arrived', `goToGoal ended with ${outcome}; it said ${JSON.stringify(said)}`);
        assert.ok(distanceTo(END) <= 2, `it stopped ${distanceTo(END).toFixed(1)} blocks from the end`);
        assert.ok(said.includes('Found non-destructive path.'), `it found the walk: ${JSON.stringify(said)}`);
        assert.equal(stuck.count, 0, 'the pathfinder never stood still at a corner');
        assert.deepEqual(changed(), [], 'nothing was dug or placed');
        return { seconds, said };
    });

    console.log(JSON.stringify({ status: 'passed', steps: results.length }));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', steps: results.length, error: error.message }));
    process.exitCode = 1;
} finally {
    bot?.quit?.();
    await delay(500);
    await server.stop();
    process.exit(process.exitCode ?? 0);
}
