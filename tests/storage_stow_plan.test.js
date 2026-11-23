// SPDX-License-Identifier: CC0-1.0
// The stow plan: where each thing put away goes, and which chests a fetch takes from. Pure, no game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFetch, planPutAway, roomFor, walkOrder } from '../src/agent/storage/stow_plan.js';

const SIZES = { ender_pearl: 16, iron_pickaxe: 1 };
const stackSize = name => SIZES[name] ?? 64;
/** A chest believed to hold `items` with `free` empty slots. Rank 0 is the bot's own, 1 shared. */
const chest = (id, items, free, { rank = 0, distance = 5 } = {}) => ({ id, rank, distance, items, free });
const plan = (items, chests) => planPutAway(items, chests, { stackSize });
const where = result => Object.fromEntries(result.into.map(({ id, items }) => [id, Object.fromEntries(items.map(i => [i.name, i.count]))]));

test('room for an item: the rest of its part stack and every empty slot', () => {
    assert.equal(roomFor(chest('a', { cobblestone: 70 }, 2), 'cobblestone', stackSize), 58 + 128);
    assert.equal(roomFor(chest('a', { ender_pearl: 16 }, 1), 'ender_pearl', stackSize), 16);
    assert.equal(roomFor(chest('a', null, null), 'dirt', stackSize), 0);
});

test('a kind goes to the chest that already holds most of it, before a nearer one with less', () => {
    const result = plan([{ name: 'cobblestone', count: 20 }],
        [chest('near', { cobblestone: 10 }, 20, { distance: 2 }), chest('far', { cobblestone: 300 }, 5, { distance: 9 })]);
    assert.deepEqual(where(result), { far: { cobblestone: 20 } });
    assert.deepEqual(result.unplaced, []);
});

test('a kind no chest holds goes to the home of its group', () => {
    const result = plan([{ name: 'birch_log', count: 30 }],
        [chest('stone', { cobblestone: 64 }, 20), chest('wood', { oak_planks: 64, oak_log: 12 }, 20), chest('empty', {}, 27)]);
    assert.deepEqual(where(result), { wood: { birch_log: 30 } });
});

test('a group with no home starts one in an empty chest, the bot\'s own before a shared one', () => {
    const result = plan([{ name: 'wheat', count: 30 }],
        [chest('stone', { cobblestone: 64 }, 26), chest('shared', {}, 27, { rank: 1, distance: 1 }), chest('mine', {}, 27, { distance: 8 })]);
    assert.deepEqual(where(result), { mine: { wheat: 30 } });
});

test('with no empty chest, the one with the most room; then a chest never looked into', () => {
    assert.deepEqual(where(plan([{ name: 'wheat', count: 10 }], [chest('a', { dirt: 64 }, 3), chest('b', { sand: 64 }, 9)])), { b: { wheat: 10 } });
    const result = plan([{ name: 'wheat', count: 10 }], [chest('full', { dirt: 27 * 64 }, 0), chest('unseen', null, null)]);
    assert.deepEqual(where(result), { unseen: { wheat: 10 } });
});

test('too much for one chest goes on into the next by the same rules', () => {
    const result = plan([{ name: 'cobblestone', count: 200 }],
        [chest('stone', { cobblestone: 60, stone: 64 }, 2), chest('empty', {}, 27, { distance: 9 }), chest('wood', { oak_log: 64 }, 20)]);
    // 4 tops up the part stack, 128 fill the two free slots; the stone chest is then full and the rest starts the empty one.
    assert.deepEqual(where(result), { stone: { cobblestone: 132 }, empty: { cobblestone: 68 } });
});

test('what fits nowhere is named, and nothing is planned past the room there is', () => {
    const result = plan([{ name: 'ender_pearl', count: 40 }, { name: 'dirt', count: 10 }], [chest('a', { dirt: 60 }, 1)]);
    // The larger count is placed first: the pearls take the free slot (16), and the dirt fills its part stack (4).
    assert.deepEqual(where(result), { a: { ender_pearl: 16, dirt: 4 } });
    assert.deepEqual(result.unplaced, [{ name: 'ender_pearl', count: 24 }, { name: 'dirt', count: 6 }]);
});

test('unstackable things take a slot each', () => {
    const result = plan([{ name: 'iron_pickaxe', count: 3 }], [chest('tools', { iron_axe: 1 }, 2)]);
    assert.deepEqual(where(result), { tools: { iron_pickaxe: 2 } });
    assert.deepEqual(result.unplaced, [{ name: 'iron_pickaxe', count: 1 }]);
});

test('a walk visits the nearest chest first, then the nearest to that', () => {
    const order = walkOrder({ x: 0, y: 64, z: 0 }, [{ id: 'c', x: 10, y: 64, z: 0 }, { id: 'a', x: 2, y: 64, z: 0 }, { id: 'b', x: 2, y: 64, z: 8 }]);
    assert.deepEqual(order.map(c => c.id), ['a', 'b', 'c']);
});

test('fetching: own and shared before a player\'s, one chest with all of it before nearer ones with some', () => {
    const chests = [
        chest('alices', { iron_ingot: 50 }, 0, { rank: 2, distance: 1 }),
        chest('near', { iron_ingot: 4 }, 0, { distance: 2 }),
        chest('enough', { iron_ingot: 20 }, 0, { distance: 6 }),
        chest('none', { dirt: 5 }, 0, { distance: 1 }),
        chest('unseen', null, null, { distance: 1 }),
    ];
    assert.deepEqual(planFetch('iron_ingot', 10, chests), { from: [{ id: 'enough', count: 10 }], short: 0 });
    assert.deepEqual(planFetch('iron_ingot', 30, chests), { from: [{ id: 'near', count: 4 }, { id: 'enough', count: 20 }, { id: 'alices', count: 6 }], short: 0 });
    assert.deepEqual(planFetch('iron_ingot', 100, chests).short, 26);
    assert.deepEqual(planFetch('gold_ingot', 3, chests), { from: [], short: 3 });
});
