// SPDX-License-Identifier: CC0-1.0
// Under fair play digDown digs a staircase (stairs_down.js): each block the bot will stand on is in view
// before it steps onto it, and what it uncovers on the way (lava, water, a drop) stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { knownBlockAt } from '../src/agent/library/look_first.js';
import { digStairsDown, headingOf } from '../src/agent/library/stairs_down.js';
import { setDigDownWay } from '../src/agent/library/dig_down_way.js';
import { digDown, log } from '../src/agent/library/skills.js';
import { namedCells, key, EMPTY, plainMovements } from './helpers/named_cells.js';

let restoreMovements;
test.beforeEach(() => { restoreMovements = plainMovements(); });
test.afterEach(() => { restoreMovements(); setWorldQueries(null); });

test('the heading follows the way the bot faces', () => {
    assert.equal(headingOf(0), 'north');
    assert.equal(headingOf(Math.PI), 'south');
    assert.equal(headingOf(Math.PI / 2), 'west');
    assert.equal(headingOf(-Math.PI / 2), 'east');
});

/**
 * Solid stone from y 63 down, the bot standing on it at 0, 64, 0 facing north. The provider knows a cell
 * when it is touched or has an open side facing an open cell the bot knows: a rough stand-in for sight
 * that is enough to tell a staircase from a probe. Digging and stepping change the world.
 */
function stoneScene(extra = {}) {
    const cells = {};
    for (let y = 40; y <= 63; y++) for (let x = -2; x <= 2; x++) for (let z = -12; z <= 2; z++) cells[`${x},${y},${z}`] = 'stone';
    Object.assign(cells, extra);
    const world = namedCells({ cells });
    const { bot, names } = world;
    const isOpen = k => !names.has(k) || EMPTY.has(names.get(k));
    const seeable = new Set();
    const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    // Sight, roughly: the open cells joined to the bot's own through open space, a few blocks around,
    // and every block that borders one of them. A pocket sealed off in the rock stays out of view.
    const look = () => {
        seeable.clear();
        const f = bot.entity.position.floored();
        const near = (x, y, z) => Math.abs(x - f.x) <= 4 && Math.abs(z - f.z) <= 4 && y >= f.y - 6 && y <= f.y + 4;
        const queue = [[f.x, f.y, f.z], [f.x, f.y + 1, f.z]];
        const open = new Set(queue.map(c => c.join(',')));
        while (queue.length) {
            const [x, y, z] = queue.pop();
            for (const [dx, dy, dz] of SIDES) {
                const c = [x + dx, y + dy, z + dz], k = c.join(',');
                if (open.has(k) || !near(...c) || !isOpen(k)) continue;
                open.add(k);
                queue.push(c);
            }
        }
        for (const k of open) {
            seeable.add(k);
            const [x, y, z] = k.split(',').map(Number);
            for (const [dx, dy, dz] of SIDES) seeable.add(`${x + dx},${y + dy},${z + dz}`);
        }
    };
    look();
    setWorldQueries({
        blockAt: (_bot, pos) => (seeable.has(key(pos)) ? bot.blockAt(pos) : null),
    });
    const dug = [];
    const breakAt = async (_bot, x, y, z) => { dug.push(`${x},${y},${z}`); names.delete(`${x},${y},${z}`); look(); return true; };
    bot.pathfinder = {
        setMovements() {},
        goto: async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); look(); },
    };
    bot.registry = null;
    return { bot, names, dug, breakAt, seeable };
}

test('the staircase digs three cells a step, ahead and down, and gets all the way', async () => {
    const { bot, dug, breakAt } = stoneScene();
    assert.equal(await digStairsDown(bot, 3, { breakBlockAt: breakAt, log }), true, bot.output);
    assert.equal(Math.floor(bot.entity.position.y), 61);
    assert.equal(Math.floor(bot.entity.position.z), -3, 'it went north, one block per step');
    // Never a block under where the bot stood: only cells ahead of it.
    for (const cell of dug) assert.ok(Number(cell.split(',')[2]) < 0, `dug ${cell}`);
    assert.match(bot.output, /Dug down 3 blocks as a staircase heading north/);
});

test('lava under the floor it cannot see does not stop the staircase until the step that uncovers it', async () => {
    // Lava three blocks down, right under where the bot stands: a straight shaft would fall in.
    const { bot, breakAt } = stoneScene({ '0,61,0': 'lava' });
    assert.equal(await digStairsDown(bot, 1, { breakBlockAt: breakAt, log }), true, bot.output);
    assert.doesNotMatch(bot.output, /lava/);
});

test('lava uncovered beside the staircase stops it, and it says where', async () => {
    // Lava right beside the second step's floor cell.
    const { bot, breakAt } = stoneScene({ '1,62,-2': 'lava' });
    assert.equal(await digStairsDown(bot, 4, { breakBlockAt: breakAt, log }), false);
    assert.match(bot.output, /stopped: there is lava at 1, 62, -2/);
    assert.ok(bot.entity.position.y >= 63, 'it did not step down next to the lava');
});

test('lava under the next step stops it before it steps', async () => {
    const { bot, breakAt } = stoneScene({ '0,62,-1': 'lava' });
    assert.equal(await digStairsDown(bot, 3, { breakBlockAt: breakAt, log }), false);
    assert.match(bot.output, /stopped: there is lava.* 0, 62, -1/);
    assert.equal(Math.floor(bot.entity.position.y), 64);
});

test('a deep drop under the next step stops it', async () => {
    const extra = {};
    for (let y = 55; y <= 62; y++) extra[`0,${y},-1`] = 'air';
    const { bot, breakAt } = stoneScene(extra);
    assert.equal(await digStairsDown(bot, 3, { breakBlockAt: breakAt, log }), false);
    assert.match(bot.output, /a drop of more than 2 blocks under the next step/);
});

test('a block it fails to dig stops it, and it says which', async () => {
    const { bot } = stoneScene();
    assert.equal(await digStairsDown(bot, 2, { breakBlockAt: async () => false, log }), false);
    assert.match(bot.output, /could not dig the stone at 0, 63, -1/);
});

test('digDown uses the installed way, and the stock one without', async () => {
    const { bot } = namedCells();
    const calls = [];
    setDigDownWay(bot, async (_bot, distance) => { calls.push(distance); return true; });
    assert.equal(await digDown(bot, 5), true);
    assert.deepEqual(calls, [5]);
    setDigDownWay(bot, null);
    assert.equal(knownBlockAt(bot, new Vec3(0, 63, 0)).name, 'air'); // the stock one would read this raw
});
