// SPDX-License-Identifier: CC0-1.0
// Choosing where to make a field: wet, free soil the bot knows of, grown from the field being made bigger,
// and kept off fields it may not tend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseGround, WET_REACH } from '../src/agent/farming/ground.js';

/** A little world as a map of names, with everything else unknown unless `fill` says otherwise. */
function world({ fill = null } = {}) {
    const cells = new Map();
    const k = (x, y, z) => `${x},${y},${z}`;
    return {
        set(name, x, y, z) { cells.set(k(x, y, z), name); },
        box(name, [x0, y0, z0], [x1, y1, z1]) {
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells.set(k(x, y, z), name);
        },
        read: (x, y, z) => {
            const name = cells.get(k(x, y, z)) ?? (fill ? fill(x, y, z) : null);
            return name ? { name } : null;
        },
    };
}

// Flat grass at y 0 with air above, as far as the bot can see; water placed by each test.
const meadow = () => world({ fill: (x, y) => (y === 0 ? 'grass_block' : y > 0 ? 'air' : 'dirt') });
const FROM = { x: 0, y: 1, z: 0 };
const key = c => `${c.x},${c.y},${c.z}`;

test('no water the bot knows of, no field: it says so', () => {
    const w = meadow();
    const plan = chooseGround(w.read, { from: FROM, size: 9 });
    assert.deepEqual(plan.cells, []);
    assert.equal(plan.why, 'no_water');
});

test('a plot grows round the cell nearest the bot, all of it kept wet by the water', () => {
    const w = meadow();
    w.set('water', 6, 0, 0);
    const plan = chooseGround(w.read, { from: FROM, size: 9 });
    assert.equal(plan.why, null);
    assert.equal(plan.cells.length, 9);
    for (const c of plan.cells) {
        assert.equal(c.y, 0, 'on the ground\'s level');
        assert.ok(Math.abs(c.x - 6) <= WET_REACH && Math.abs(c.z) <= WET_REACH, `${key(c)} is within reach of the water`);
        assert.ok(!(c.x === 6 && c.z === 0), 'never the water itself');
    }
    assert.ok(plan.cells.every(c => c.x <= 4), `close to the bot first: ${plan.cells.map(key).join(' ')}`);
    assert.deepEqual(plan.water, [{ x: 6, y: 0, z: 0 }]);
});

test('water one level up keeps the soil below it wet; water one level down does not', () => {
    const up = world({ fill: (x, y) => (y === 0 ? 'grass_block' : y > 0 ? 'air' : 'stone') });
    up.set('water', 3, 1, 0);
    assert.ok(chooseGround(up.read, { from: FROM, size: 4 }).cells.length > 0);
    const down = world({ fill: (x, y) => (y === 0 ? 'grass_block' : y > 0 ? 'air' : 'stone') });
    down.set('water', 3, -1, 0);
    assert.equal(chooseGround(down.read, { from: FROM, size: 4 }).why, 'no_ground');
});

test('paths, stone, someone\'s soil and blocked tops are left; wild grass on top is fine', () => {
    const w = meadow();
    w.set('water', 0, 0, 0);
    w.box('dirt_path', [-4, 0, -4], [4, 0, -1]);   // a path south
    w.box('stone', [-4, 1, 1], [-1, 1, 4]);         // a wall on the soil to the west, north
    w.box('short_grass', [1, 1, 1], [4, 1, 4]);     // wild grass to the east, north
    const built = new Set(['1,0,0', '-2,0,0']);
    const plan = chooseGround(w.read, { from: FROM, size: 81, mayTill: (x, y, z) => !built.has(`${x},${y},${z}`) });
    const chosen = new Set(plan.cells.map(key));
    assert.ok(![...chosen].some(k => k.split(',')[2] < 0), 'no path');
    assert.ok(!chosen.has('-2,0,2'), 'nothing under the stone');
    assert.ok(!chosen.has('1,0,0') && !chosen.has('-2,0,0'), 'nothing someone built');
    assert.ok(chosen.has('2,0,2'), 'soil under wild grass is chosen');
    assert.equal(plan.cells.find(c => key(c) === '2,0,2').above, 'short_grass', 'and the grass is named, to be cut first');
});

test('ground the bot has never seen is never chosen, and water it has never seen keeps nothing wet', () => {
    const w = world();
    w.box('grass_block', [-3, 0, -3], [3, 0, 3]);
    w.box('air', [-3, 1, -3], [3, 1, 3]);
    w.set('water', 0, 0, 0);
    const plan = chooseGround(w.read, { from: FROM, size: 100 });
    assert.ok(plan.cells.every(c => Math.abs(c.x) <= 3 && Math.abs(c.z) <= 3), 'only seen ground');
    const dry = world();
    dry.box('grass_block', [-3, 0, -3], [3, 0, 3]);
    dry.box('air', [-3, 1, -3], [3, 1, 3]);
    assert.equal(chooseGround(dry.read, { from: FROM, size: 4 }).why, 'no_water');
});

test('a field made bigger grows from its own edge', () => {
    const w = meadow();
    w.set('water', 8, 0, 0);
    const field = [];
    for (let x = 6; x <= 7; x++) for (let z = -1; z <= 1; z++) { w.set('farmland', x, 0, z); field.push({ x, y: 0, z }); }
    const plan = chooseGround(w.read, { from: FROM, size: 6, field });
    assert.equal(plan.cells.length, 6);
    for (const c of plan.cells) {
        const touching = field.some(f => Math.abs(f.x - c.x) <= 2 && Math.abs(f.z - c.z) <= 2);
        assert.ok(touching, `${key(c)} grows from the field`);
    }
    assert.ok(plan.cells.some(c => field.some(f => Math.abs(f.x - c.x) <= 1 && Math.abs(f.z - c.z) <= 1)), 'starting at its edge');
});

test('a field the bot may not tend is kept clear of, so the new one does not join it', () => {
    const w = meadow();
    w.set('water', 2, 0, 0);
    const theirs = [];
    for (let z = -3; z <= 3; z++) { w.set('farmland', 3, 0, z); theirs.push({ x: 3, y: 0, z }); }
    const plan = chooseGround(w.read, { from: FROM, size: 20, avoid: theirs });
    assert.ok(plan.cells.length > 0);
    assert.ok(plan.cells.every(c => c.x <= 1), `never next to their field: ${plan.cells.map(key).join(' ')}`);
});
