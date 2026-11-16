// SPDX-License-Identifier: CC0-1.0
// Live checks of ordinary travel (goToGoal) and of fetching dropped items, against a real server (no model
// calls, free to run).
//   node tests/live/travel_scenarios.js [--port=55930]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The travel scene is a tunnel one block wide cut into solid stone, shaped like a U: east along z = 0, north along
// x = ARM, then back west along z = ARM. Its two ends are ARM blocks apart through the stone and three times
// that on foot. Walking it means turning two inside corners, where the stock pathfinder plans a diagonal step
// it cannot take and stands still. And with digging dear (as goToGoal's first choice of settings makes it)
// the walk is cheaper than tunnelling, but the route is long enough that finding it takes the pathfinder more
// than one 40 ms slice.
//
// The pickup scene is a flat stone floor with one dropped item on it, either on top of a lone block (as a drop
// comes to rest on the lip of the hole its ore left) or down in a pit one block deep. The bot should fetch it
// by walking to where it can reach it, without placing a block to climb into the item's own cell or digging.
// These steps check that "near enough to pick up" matches the server (the lip case ends with the bot one block
// over and one below the item) and that a pit still means stepping down. They do not reproduce the old fault
// itself: here the older pickup also got the item, handed over by the server as the bot walked past. The unit
// tests in tests/pickup_items_from_beside.test.js cover that.
//
// No world memory and no fair play here: this is the travel every command ends in, as Mindcraft-CE has it.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';

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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', fair_play: 'off', world_memory: false });
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

    // The pickup scene, well away from the tunnel: a floor at Y - 1 with open air above it.
    const PX = 60, PZ = 60;
    const LIP = { x: PX + 4, y: Y, z: PZ };     // a lone block standing on the floor
    const pickupScene = async ({ pit }) => {
        await cmd(`fill ${PX - 4} ${Y - 3} ${PZ - 4} ${PX + 8} ${Y - 1} ${PZ + 4} stone`);
        await cmd(`fill ${PX - 4} ${Y} ${PZ - 4} ${PX + 8} ${Y + 4} ${PZ + 4} air`);
        if (pit) await cmd(`setblock ${LIP.x} ${Y - 1} ${LIP.z} air`);
        else await cmd(`setblock ${LIP.x} ${LIP.y} ${LIP.z} stone`);
        await cmd('kill @e[type=item]');
        await cmd(`clear ${NAME}`);
        // Blocks the bot could place to climb, so "it placed nothing" means something.
        await cmd(`give ${NAME} dirt 16`);
        await placeAt({ x: PX, y: Y, z: PZ });
    };
    // Every cell of the pickup scene that is not as built.
    const pickupChanged = ({ pit }) => {
        const cells = [];
        for (let x = PX - 4; x <= PX + 8; x++) for (let y = Y - 3; y <= Y + 4; y++) for (let z = PZ - 4; z <= PZ + 4; z++) {
            const isPit = pit && x === LIP.x && y === Y - 1 && z === LIP.z;
            const isLip = !pit && x === LIP.x && y === LIP.y && z === LIP.z;
            const expected = isLip || (y < Y && !isPit) ? 'stone' : 'air';
            const name = rawName(x, y, z);
            if (name !== expected) cells.push(`${x},${y},${z}:${name}`);
        }
        return cells;
    };
    const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
    // Drops one diamond at the spot and waits for it to land, the way a mined block's drop appears.
    const dropDiamond = async (x, y, z) => {
        await cmd(`summon item ${x} ${y} ${z} {Item:{id:"minecraft:diamond",count:1}}`);
        await delay(1200);
    };

    for (const pit of [false, true]) {
        const where = pit ? 'down in a pit one block deep' : 'on top of a lone block, one up';
        await step(`an item ${where} is fetched by walking, nothing dug or placed`, async () => {
            await pickupScene({ pit });
            assert.equal(count('diamond'), 0);
            await dropDiamond(LIP.x + 0.5, pit ? Y - 1 : Y + 1, LIP.z + 0.5);
            const item = Object.values(bot.entities).find(entity => entity.name === 'item');
            assert.ok(item, 'the item is there to fetch');
            const lying = item.position.clone();
            bot.output = '';
            const started = Date.now();
            // Digging allowed, as after mining: it should still not be needed.
            const outcome = await withDeadline(() => skills.pickupNearbyItems(bot, true), 20000);
            assert.equal(outcome, 'arrived', `pickup ended with ${outcome}`);
            await delay(500);
            const said = bot.output.trim();
            assert.equal(count('diamond'), 1, `it picked the diamond up; it said ${JSON.stringify(said)}`);
            assert.equal(count('dirt'), 16, 'it placed no blocks');
            assert.deepEqual(pickupChanged({ pit }), [], 'nothing was dug or placed');
            const at = bot.entity.position;
            return {
                said, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
                item: [lying.x, lying.y, lying.z].map(n => Number(n.toFixed(2))),
                botEndedAt: [at.x, at.y, at.z].map(n => Number(n.toFixed(2))),
            };
        });
    }

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
