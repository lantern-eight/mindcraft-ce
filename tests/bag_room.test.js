// SPDX-License-Identifier: CC0-1.0
// Room in the bag while gathering (src/agent/library/bag_room.js, and its hook in mining.js): a full bag
// stops the job, or room is made first when a way of making it is installed. No game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';
import { FULL_TEXT, hasRoomFor, makeRoomFor, setRoomMaker, takeRoomNotes } from '../src/agent/library/bag_room.js';
import { collectBlocks } from '../src/agent/library/mining.js';

const registry = { blocksByName: { oak_log: { drops: [1] }, stone: { drops: [2] } }, items: { 1: { name: 'oak_log' }, 2: { name: 'cobblestone' } } };
/** A bag with `free` empty slots holding these stacks. */
const bagOf = (free, stacks) => ({ emptySlotCount: () => free, items: () => stacks });

test('the bag has room with an empty slot, or a stack of the drop with room; otherwise not', () => {
    const log = { name: 'oak_log' };
    assert.equal(hasRoomFor({ registry, inventory: bagOf(1, []) }, log), true);
    assert.equal(hasRoomFor({ registry, inventory: bagOf(0, [{ name: 'oak_log', count: 40, stackSize: 64 }]) }, log), true);
    assert.equal(hasRoomFor({ registry, inventory: bagOf(0, [{ name: 'oak_log', count: 64, stackSize: 64 }]) }, log), false);
    assert.equal(hasRoomFor({ registry, inventory: bagOf(0, [{ name: 'cobblestone', count: 3, stackSize: 64 }]) }, { name: 'stone' }), true, 'stone drops cobblestone');
    assert.equal(hasRoomFor({ registry, inventory: bagOf(0, []) }, { name: 'mystery' }), false, 'no known drop and no empty slot');
    assert.equal(hasRoomFor({ registry, inventory: { items: () => [] } }, log), true, 'a bag that cannot say counts as roomy');
});

test('making room: tried once, and the job is told whether the bot moved and whether to stop', async () => {
    const bot = { registry, inventory: bagOf(0, []) };
    assert.deepEqual(await makeRoomFor(bot, { name: 'oak_log' }), { stop: FULL_TEXT, moved: false }, 'nothing installed');
    let calls = 0;
    setRoomMaker(bot, async () => { calls++; bot.inventory = bagOf(5, []); return 'put away'; });
    assert.deepEqual(await makeRoomFor(bot, { name: 'oak_log' }), { stop: null, moved: true });
    assert.deepEqual(await makeRoomFor(bot, { name: 'oak_log' }), { stop: null, moved: false }, 'room now: nothing to do');
    assert.equal(calls, 1);
    bot.inventory = bagOf(0, []);
    setRoomMaker(bot, async () => 'nothing to put away');
    assert.deepEqual(await makeRoomFor(bot, { name: 'oak_log' }), { stop: FULL_TEXT, moved: true });
    setRoomMaker(bot, null);
});

/** Three logs in a row, and a bag that fills after `room` more logs. */
function logs(room) {
    const bot = Object.assign(new EventEmitter(), { interrupt_code: false, game: { gameMode: 'survival' }, world: {}, heldItem: { type: 1 }, registry });
    const blocks = [0, 1, 2].map(x => ({ name: 'oak_log', type: 1, metadata: 0, position: new Vec3(x, 64, 0), canHarvest: () => true }));
    const remaining = new Set(blocks), items = [];
    let free = room;
    bot.inventory = { items: () => items, emptySlotCount: () => free };
    bot.blockAt = pos => blocks.find(b => remaining.has(b) && b.position.equals(pos)) || { type: 0, name: 'air' };
    bot.pathfinder = { goto: () => Promise.resolve(), setGoal: () => {} };
    bot.tool = { equipForBlock: () => Promise.resolve() };
    bot.digTime = () => 10; bot.stopDigging = () => {};
    let dug = 0;
    bot.dig = block => { dug++; remaining.delete(block); items.push({ name: 'oak_log', count: 64, stackSize: 64 }); free--; return Promise.resolve(); };
    return { bot, options: { find: predicate => blocks.filter(b => remaining.has(b) && predicate(b)), pickup: () => Promise.resolve() }, dug: () => dug, empty: n => { free = n; } };
}

test('gathering stops when the bag is full, instead of breaking blocks for drops that stay on the ground', async () => {
    const { bot, options, dug } = logs(1);
    const result = await collectBlocks(bot, 'oak_log', 3, options);
    assert.equal(dug(), 1, 'one log, and then no more');
    assert.equal(result.status, 'partial');
    assert.match(result.text, /Blocker: Inventory full: nothing more fits in your bag/);
});

test('gathering with chests near: the bag is emptied once, and the job goes on to the end', async () => {
    const { bot, options, dug, empty } = logs(1);
    let trips = 0;
    setRoomMaker(bot, async () => { trips++; empty(10); return 'put away'; });
    const result = await collectBlocks(bot, 'oak_log', 3, options);
    assert.equal(result.status, 'ok', result.text);
    assert.equal(dug(), 3);
    assert.equal(trips, 1);
    assert.match(result.text, /^Broke 3\/3 oak_log; acquired \d+ oak_log\.\nput away$/, 'the trip is said in the result');
    assert.equal(takeRoomNotes(bot), '', 'and said once');
});
