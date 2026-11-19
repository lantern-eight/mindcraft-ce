// SPDX-License-Identifier: CC0-1.0
// backOffFrom's first step: straight away from the threat when that is safe, never into lava or fire or
// off a drop of more than 2 blocks, and only over cells the bot knows. Blocks come from a map, as they
// would from world.js's provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstStep, safeCell } from '../src/agent/reflexes/moves.js';

// A flat stone floor with its top at y 63, air above, and whatever `cells` changes. "x,y,z" -> name;
// null in `cells` means the bot doesn't know that cell.
function world(cells = {}) {
    return pos => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (key in cells) return cells[key] === null ? null : { name: cells[key], boundingBox: /air|lava|fire|water/.test(cells[key]) ? 'empty' : 'block' };
        return pos.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
    };
}
const feet = { x: 0.5, y: 64, z: 0.5 };
const creeperWest = { x: -2.5, y: 64, z: 0.5 };

test('on open ground the first step is straight away from the threat', () => {
    const step = firstStep(world(), feet, creeperWest);
    assert.ok(step.x > 0.99 && Math.abs(step.z) < 0.01, JSON.stringify(step));
});

test('lava straight ahead turns the step aside', () => {
    const step = firstStep(world({ '2,63,0': 'lava' }), feet, creeperWest);
    assert.ok(step, 'a way aside is open');
    assert.ok(Math.abs(step.z) > 0.5, 'it goes aside');
    assert.equal(safeCell(world({ '2,63,0': 'lava' }), { x: 2, y: 64, z: 0 }), false, 'lava under the cell');
    assert.equal(safeCell(world({ '1,64,0': 'fire' }), { x: 1, y: 64, z: 0 }), false, 'fire in the cell');
});

test('a drop of 2 is fine, a drop of 3 is not', () => {
    const pit = depth => {
        const cells = {};
        for (let y = 63; y > 63 - depth; y--) cells[`1,${y},0`] = 'air';
        return world(cells);
    };
    assert.equal(safeCell(pit(2), { x: 1, y: 64, z: 0 }), true);
    assert.equal(safeCell(pit(3), { x: 1, y: 64, z: 0 }), false);
});

test('a wall or an unknown cell is no step', () => {
    assert.equal(safeCell(world({ '1,64,0': 'stone' }), { x: 1, y: 64, z: 0 }), false);
    assert.equal(safeCell(world({ '1,65,0': 'stone' }), { x: 1, y: 64, z: 0 }), false, 'no head room');
    assert.equal(safeCell(world({ '1,63,0': null }), { x: 1, y: 64, z: 0 }), false, 'the floor is unknown');
    assert.equal(safeCell(world({ '1,64,0': null }), { x: 1, y: 64, z: 0 }), false);
});

test('walled in on every side away from the threat: no first step, the pathfinder decides', () => {
    const cells = {};
    for (const [x, z] of [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1]]) cells[`${x},64,${z}`] = 'stone';
    assert.equal(firstStep(world(cells), feet, creeperWest), null);
});
