// SPDX-License-Identifier: CC0-1.0
// Farming's decisions, with no world: the crop table, the jobs of a cell, which seed to sow, the order the
// cells are visited in, the field search over what the bot knows, the step cost that keeps the bot off the
// farmland, and the field book's word on whose a field is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CROPS, bestHoe, cellPlan, cropOf, cropOfBlock, cropOfSeed, keepHarvesting, seedToSow, seedsOwed } from '../src/agent/farming/crops.js';
import { visitOrder } from '../src/agent/farming/visit_order.js';
import { NO_STEP, fieldBox, findField, stepCost } from '../src/agent/farming/field.js';
import { ME, SHARED, createFieldBook, loadFieldBook, mayTend } from '../src/agent/farming/field_book.js';
import { isCrop, isRipe } from '../src/agent/memory/kinds.js';

// ---- The crops ----

test('every crop farming sows is a crop world memory knows the ripe age of', () => {
    for (const row of CROPS) {
        assert.ok(isCrop(row.block), row.block);
        assert.equal(isRipe(row.block, { age: 0 }), false, `${row.block} at age 0`);
    }
    assert.equal(isRipe('wheat', { age: 7 }), true);
    assert.equal(isRipe('beetroots', { age: 3 }), true, 'beetroot is ripe at 3, not 7');
    assert.equal(isRipe('wheat', {}), false, 'no age known is not ripe');
});

test('crops are found by exact names, never by part of a name', () => {
    assert.equal(cropOf('carrot').block, 'carrots');
    assert.equal(cropOf('minecraft:wheat_seeds').block, 'wheat');
    assert.equal(cropOf('poisonous_potato'), null);
    assert.equal(cropOf('baked_potato'), null);
    assert.equal(cropOfSeed('wheat'), null, 'wheat is the produce, not the seed');
    assert.equal(cropOfSeed('potato').block, 'potatoes', 'potatoes are planted with a potato');
    assert.equal(cropOfBlock('attached_melon_stem'), null);
});

test('the best hoe goes by material, and an empty stack is no hoe', () => {
    assert.equal(bestHoe([{ name: 'wooden_hoe', count: 1 }, { name: 'iron_hoe', count: 1 }]), 'iron_hoe');
    assert.equal(bestHoe([{ name: 'diamond_hoe', count: 0 }, { name: 'stone_hoe', count: 1 }]), 'stone_hoe');
    assert.equal(bestHoe([{ name: 'iron_pickaxe', count: 1 }]), null);
});

// ---- The jobs of one cell ----

test('a crop is cut only when it was seen to be ripe; one not seen is looked at first', () => {
    const seeds = { seeds: { wheat_seeds: 3 } };
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', ripe: true }, seeds), ['harvest', 'plant']);
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', ripe: false }, seeds), []);
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'wheat', ripe: null }, seeds), ['look'], 'remembered: age unknown');
    assert.deepEqual(cellPlan({ ground: 'farmland', above: null }, seeds), ['look'], 'never seen what stands there');
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, seeds), ['plant']);
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'air' }, { seeds: {} }), [], 'nothing to sow');
    assert.deepEqual(cellPlan({ ground: 'farmland', above: 'torch' }, seeds), []);
    assert.deepEqual(cellPlan({ ground: 'dirt', above: 'air' }, seeds), [], 'tilling is not part of tending');
});

test('an empty cell gets the seed asked for, else what grows beside it, else the seed held most of', () => {
    const cell = { x: 0, z: 0, above: 'air' };
    const field = [cell, { x: 1, z: 0, above: 'carrots' }, { x: -1, z: 0, above: 'carrots' }, { x: 0, z: 1, above: 'wheat' }, { x: 5, z: 5, above: 'wheat' }];
    const held = { wheat_seeds: 20, carrot: 2, beetroot_seeds: 40 };
    assert.equal(seedToSow(cell, field, held, 'wheat'), 'wheat_seeds', 'a crop name means its seed');
    assert.equal(seedToSow(cell, field, held, 'potato'), null, 'asked for what the bag lacks: sow nothing, not something else');
    assert.equal(seedToSow(cell, field, held), 'carrot', 'two carrot neighbours beat one wheat');
    assert.equal(seedToSow(cell, field, { wheat_seeds: 20, beetroot_seeds: 40 }), 'wheat_seeds', 'only neighbours whose seed is held count');
    assert.equal(seedToSow({ x: 9, z: 9 }, field, held), 'beetroot_seeds', 'no neighbours: the seed held most of');
    assert.equal(seedToSow(cell, field, {}), null);
});

test('a seed is held back for each ripe crop still to be replanted', () => {
    assert.deepEqual(seedsOwed([
        { above: 'wheat', ripe: true }, { above: 'wheat', ripe: true }, { above: 'carrots', ripe: true },
        { above: 'wheat', ripe: false }, { above: 'wheat', ripe: null }, { above: 'air' },
    ]), { wheat_seeds: 2, carrot: 1 });
});

test('breaking stops when crops keep giving nothing', () => {
    assert.equal(keepHarvesting(0), true);
    assert.equal(keepHarvesting(1), true, 'one drop can roll away');
    assert.equal(keepHarvesting(2), false);
});

test('the cells are visited like a plough: rows along the long side, turning at each end', () => {
    const cells = [];
    for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) cells.push({ x, z });
    const order = visitOrder(cells, { x: 0, z: 0 }).map(c => `${c.x},${c.z}`);
    assert.deepEqual(order, ['0,0', '1,0', '2,0', '3,0', '3,1', '2,1', '1,1', '0,1']);
    const fromFar = visitOrder(cells, { x: 3.7, z: 1.2 }).map(c => `${c.x},${c.z}`);
    assert.deepEqual(fromFar, ['3,1', '2,1', '1,1', '0,1', '0,0', '1,0', '2,0', '3,0'], 'starts at the corner nearest the bot');
    assert.deepEqual(visitOrder([], null), []);
});

// ---- The field ----

// A world as the bot knows it: a map of cells, and anything else unknown.
function known(cells) {
    const map = new Map(Object.entries(cells));
    return (x, y, z) => map.get(`${x},${y},${z}`) ?? null;
}
function grid(xs, zs, y, fn) {
    const out = {};
    for (let x = xs[0]; x <= xs[1]; x++) for (let z = zs[0]; z <= zs[1]; z++) Object.assign(out, fn(x, z, y));
    return out;
}

test('a field is the farmland joined to the start, across the water between its rows, and stops at cells never seen', () => {
    const world = grid([0, 4], [0, 2], 0, (x, z, y) => ({
        [`${x},${y},${z}`]: { name: x === 2 ? 'water' : 'farmland' },
        [`${x},${y + 1},${z}`]: x === 2 ? { name: 'air' } : { name: 'wheat', ripe: x === 0 },
    }));
    // A river beside the field (wider than one row of water) is not crossed to the farmland beyond it.
    Object.assign(world, { '-1,0,0': { name: 'water' }, '-2,0,0': { name: 'water' }, '-3,0,0': { name: 'farmland' } });
    // The row beyond z = 2 was never seen.
    const field = findField(known(world), { x: 0, y: 0, z: 0 });
    assert.equal(field.cells.length, 12, 'both sides of the water channel');
    assert.equal(field.between.length, 4, 'the channel, and the river\'s near edge');
    assert.ok(!field.cells.some(c => c.x < 0), 'the farmland across the river is not part of it');
    assert.ok(field.unknownEdge > 0, 'the unseen row is reported, not taken for the end of the field');
    const ripe = field.cells.filter(c => c.ripe === true);
    assert.equal(ripe.length, 3);
    assert.deepEqual(fieldBox(field.cells), { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 0, z: 2 } });
});

test('a field on a slope keeps the farmland one level up or down, and an unseen crop is unknown', () => {
    const world = {
        '0,0,0': { name: 'farmland' }, '0,1,0': { name: 'air' },
        '1,1,0': { name: 'farmland' }, // one up: what stands on it never seen
        '2,3,0': { name: 'farmland' }, // two up: not the same field
    };
    const field = findField(known(world), { x: 0, y: 0, z: 0 });
    assert.deepEqual(field.cells.map(c => [c.x, c.y, c.above]), [[0, 0, 'air'], [1, 1, null]]);
    assert.deepEqual(findField(known(world), { x: 5, y: 5, z: 5 }).cells, [], 'no field where the start is not farmland');
});

test('the step cost keeps the bot off the farmland: no jump from it, no step down onto it, walking on it is free', () => {
    const cost = stepCost([{ x: 0, y: 64, z: 0 }]);
    assert.equal(cost({ position: { x: 0, y: 65, z: 0 } }), 0, 'feet among the plants');
    assert.equal(cost({ position: { x: 0, y: 66, z: 0 } }), 0, 'head among the plants');
    assert.equal(cost({ position: { x: 0.5, y: 67, z: 0.5 } }), NO_STEP, 'a jump or a step down onto it');
    assert.equal(cost({ x: 0, y: 69, z: 0 }), NO_STEP);
    assert.equal(cost({ x: 0, y: 70, z: 0 }), 0, 'far above: some other floor');
    assert.equal(cost({ x: 1, y: 67, z: 0 }), 0, 'beside the field');
});

// ---- Whose a field is ----

test('the field book goes by the latest word, keeps a permission per owner, and is kept between runs', () => {
    let t = 0;
    const book = createFieldBook({ scope: 'world:test/overworld', now: () => ++t });
    const field = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
    assert.deepEqual(book.whose(field), { owner: null, tending: 'asked', known: 0, mixed: false });
    book.mark(field, { owner: 'Alice' });
    assert.equal(book.whose(field).tending, 'asked', 'a player\'s field waits to be asked');
    book.mark(field, { tending: 'always' });
    assert.deepEqual(book.whose(field), { owner: 'Alice', tending: 'always', known: 3, mixed: false });
    book.mark(field.slice(0, 1), { owner: 'alice' });
    assert.equal(book.whose(field).tending, 'always', 'the same owner in other capitals keeps the permission');
    book.mark(field.slice(0, 1), { owner: 'Bob' });
    assert.equal(book.whose(field).owner, 'Alice', 'most of the cells');
    assert.equal(book.whose(field).mixed, true);
    // A new row next to the field: the tending notes its owner; what was said stays said.
    assert.equal(book.claimUnknown([...field, { x: 3, y: 0, z: 0 }], 'Carol'), 1);
    assert.equal(book.whose([{ x: 0, y: 0, z: 0 }]).owner, 'Bob');
    book.mark([{ x: 3, y: 0, z: 0 }], { owner: null });
    assert.equal(book.whose([{ x: 3, y: 0, z: 0 }]).owner, null, 'unknown again');
    assert.throws(() => book.mark(field, { tending: 'never' }), /always, asked/);

    const dir = mkdtempSync(path.join(tmpdir(), 'field-book-'));
    book.save(dir);
    const again = loadFieldBook(dir, { scope: 'world:test/overworld' });
    assert.deepEqual(again.whose(field), book.whose(field));
    assert.equal(loadFieldBook(dir, { scope: 'world:other/overworld', warn: () => {} }).whose(field).known, 0, 'another world has its own fields');
});

test('the bot\'s own and shared fields may be tended whenever; others only when a player asks', () => {
    const book = createFieldBook({ scope: 's' });
    const mine = [{ x: 0, y: 0, z: 0 }], shared = [{ x: 1, y: 0, z: 0 }], alice = [{ x: 2, y: 0, z: 0 }], stranger = [{ x: 9, y: 0, z: 0 }];
    book.mark(mine, { owner: ME });
    book.mark(shared, { owner: SHARED });
    book.mark(alice, { owner: 'Alice' });
    const ownIdea = { asked: false };
    assert.equal(mayTend(book.whose(mine), ownIdea).ok, true);
    assert.equal(mayTend(book.whose(shared), ownIdea).ok, true);
    assert.deepEqual(mayTend(book.whose(alice), ownIdea), { ok: false, why: 'theirs' });
    assert.deepEqual(mayTend(book.whose(stranger), ownIdea), { ok: false, why: 'unknown' });
    assert.equal(mayTend(book.whose(alice), { asked: true, by: 'Bob' }).ok, true, 'a player is never refused');
    assert.equal(mayTend(book.whose(stranger), { asked: null }).ok, true, 'when who asked cannot be told, the bot does not refuse');
    book.mark(alice, { tending: 'always' });
    assert.equal(mayTend(book.whose(alice), ownIdea).ok, true, 'Alice said it may always be tended');
});
