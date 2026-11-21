// SPDX-License-Identifier: CC0-1.0
// The mob reflex's moves that need no bot: the way away from several mobs at once, whether a wall the bot
// has seen hides it from a mob's eye, and where the nearest such cover is. Blocks come from a map, as they
// would from world.js's provider. Taking cover runs on a stand-in bot whose pathfinder is told what to say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { awayFrom, lineBlocked, hiddenFrom, coverSpots, takeCover } from '../src/agent/reflexes/moves.js';
import { GAME_VERSION } from './helpers/game_version.js';

// A flat stone floor with its top at y 63, air above, and whatever `cells` changes. "x,y,z" -> name;
// null in `cells` means the bot doesn't know that cell.
function world(cells = {}) {
    return pos => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (key in cells) return cells[key] === null ? null : { name: cells[key], boundingBox: /air|lava|water/.test(cells[key]) ? 'empty' : 'block' };
        return pos.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
    };
}
// A wall two high along x = 3, from z = -1 to z = 1.
const wall = {};
for (let z = -1; z <= 1; z++) for (let y = 64; y <= 65; y++) wall[`3,${y},${z}`] = 'cobblestone';
const skeletonEye = { x: 10.5, y: 65.74, z: 0.5 };

test('away from two zombies at once is away from both, not from the nearer only', () => {
    const way = awayFrom({ x: 0, z: 0 }, [{ x: 3, z: 0 }, { x: 0, z: 3 }]);
    assert.ok(way.x < -0.6 && way.z < -0.6, JSON.stringify(way));
    assert.equal(awayFrom({ x: 0, z: 0 }, [{ x: 0, z: 0 }]), null, 'standing on it: no way away');
});

test('a wall the bot has seen blocks the line; air, or a cell never seen, does not', () => {
    const feet = { x: 0.5, y: 64, z: 0.5 };
    assert.equal(lineBlocked(world(wall), skeletonEye, { ...feet, y: 65.5 }), true);
    assert.equal(lineBlocked(world(), skeletonEye, { ...feet, y: 65.5 }), false, 'open ground');
    const unknown = Object.fromEntries(Object.keys(wall).map(key => [key, null]));
    assert.equal(lineBlocked(world(unknown), skeletonEye, { ...feet, y: 65.5 }), false, 'a wall it never saw is no cover');
    assert.equal(hiddenFrom(world(wall), skeletonEye, feet), true);
    // A wall one block high hides the chest, not the head.
    const low = Object.fromEntries(Object.entries(wall).filter(([key]) => key.includes(',64,')));
    assert.equal(hiddenFrom(world(low), skeletonEye, feet), false);
});

test('the nearest cover is just behind the wall, on the far side from the skeleton', () => {
    const spots = coverSpots(world(wall), { x: 4.5, y: 64, z: 3.5 }, skeletonEye);
    assert.ok(spots.length > 0, 'some cover');
    const best = spots[0];
    assert.ok(best.x < 3, `behind the wall: ${JSON.stringify(best)}`);
    assert.ok(Math.abs(best.z) <= 1, `in its shadow: ${JSON.stringify(best)}`);
    assert.deepEqual(coverSpots(world(), { x: 4.5, y: 64, z: 3.5 }, skeletonEye), [], 'open ground: none');
});

test('cover is never a spot over lava', () => {
    const lava = { ...wall };
    for (let z = -1; z <= 1; z++) for (let x = -3; x <= 2; x++) lava[`${x},63,${z}`] = 'lava';
    const spots = coverSpots(world(lava), { x: 4.5, y: 64, z: 3.5 }, skeletonEye);
    assert.ok(spots.every(cell => !(cell.x <= 2 && cell.x >= -3 && Math.abs(cell.z) <= 1)), JSON.stringify(spots));
});

test('cover the pathfinder finds no way to ends the move at once, for the caller to back out instead', async () => {
    // Behind the wall, as the bot knows it, but with no way there (the far side of a pen wall, say): the
    // pathfinder says so and keeps its goal. Waiting on it ran the move out of time while a skeleton shot.
    const blocks = world(wall);
    const bot = Object.assign(new EventEmitter(), {
        registry: minecraftData(GAME_VERSION), entity: { position: new Vec3(4.5, 64, 3.5), height: 1.8 },
        blockAt: pos => blocks({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }),
        world: { getBlock: () => null }, inventory: { items: () => [] }, interrupt_code: false,
        clearControlStates() {},
        pathfinder: {
            goal: null, isMoving: () => false, setMovements() {},
            setGoal(goal) { this.goal = goal; if (goal) setImmediate(() => bot.emit('path_update', { status: 'noPath', path: [] })); },
        },
    });
    const started = Date.now();
    const { ended } = await takeCover(bot, { eye: () => skeletonEye, maxMs: 6000 });
    assert.equal(ended, 'no way there');
    assert.ok(Date.now() - started < 1000, `it gave up in ${Date.now() - started} ms`);
    assert.equal(bot.pathfinder.goal, null, 'and left the pathfinder with no goal');
});
