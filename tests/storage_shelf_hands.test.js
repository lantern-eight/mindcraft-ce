// SPDX-License-Identifier: CC0-1.0
// Taking things off a shelf: the hand clicks the slot, the whole stack comes off, and what wasn't wanted
// goes back. A fake shelf here does what a live one does with a click: an empty hand takes the stack, a
// held stack goes into an empty slot, and two stacks swap whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frontOf, inFrontOf, shelfHands } from '../src/agent/storage/shelf_hands.js';
import { fetchItem } from '../src/agent/storage/stow.js';

const SHELF = { x: 0, y: 64, z: 0 };

/**
 * A bot standing in front of a south-facing shelf. `bag` is its slots by number (9 to 44), `shelf` the
 * shelf's three slots.
 */
function scene({ bag = {}, shelf = [null, null, null], powered = false, at = { x: 0.5, y: 64, z: 2.5 } } = {}) {
    const slots = Array(46).fill(null);
    for (const [slot, stack] of Object.entries(bag)) slots[slot] = stack && { ...stack };
    const onShelf = shelf.map(stack => stack && { ...stack });
    const walks = [];
    const bot = {
        entity: { position: { ...at }, eyeHeight: 1.62 },
        inventory: { slots },
        quickBarSlot: 0,
        setQuickBarSlot(n) { this.quickBarSlot = n; },
    };
    const edition = {
        shelfOf: () => ({ facing: 'south', powered, slots: onShelf.map(stack => stack && { ...stack }) }),
        async clickShelfSlot(b, block, slot) {
            const hand = 36 + b.quickBarSlot;
            [slots[hand], onShelf[slot]] = [onShelf[slot], slots[hand]];
        },
        async moveInBag(b, from, to, count) {
            const stack = slots[from];
            if (!stack) return;
            if (slots[to] && slots[to].name !== stack.name) { [slots[from], slots[to]] = [slots[to], stack]; return; }
            const n = Math.min(count, stack.count);
            slots[to] = { name: stack.name, count: (slots[to]?.count ?? 0) + n };
            stack.count -= n;
            if (!stack.count) slots[from] = null;
        },
    };
    const hands = shelfHands(bot, {
        edition,
        blockAt: pos => (pos.x === SHELF.x && pos.y === SHELF.y && pos.z === SHELF.z ? { name: 'oak_shelf' } : null),
        goTo: async cell => { walks.push(cell); bot.entity.position = { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }; },
        answerMs: 50, wait: async () => {},
    });
    return { bot, slots, onShelf, hands, walks };
}
const count = (slots, name) => slots.reduce((n, stack) => n + (stack?.name === name ? stack.count : 0), 0);

test('the front of a shelf is the side it faces, past the plane of its face', () => {
    assert.equal(inFrontOf(SHELF, 'south', { x: 0.5, z: 1.2 }), true);
    assert.equal(inFrontOf(SHELF, 'south', { x: 0.5, z: 0.9 }), false, 'level with it is not in front');
    assert.equal(inFrontOf(SHELF, 'north', { x: 0.5, z: -0.5 }), true);
    assert.equal(inFrontOf(SHELF, 'east', { x: 1.5, z: 0.5 }), true);
    assert.equal(inFrontOf(SHELF, 'west', { x: 1.5, z: 0.5 }), false);
    assert.deepEqual(frontOf(SHELF, 'west'), { x: -1, y: 64, z: 0 });
    assert.equal(frontOf(SHELF, 'up'), null);
});

test('a whole stack comes off into an empty hand, and the slot the bot held is held again after', async () => {
    const { bot, slots, onShelf, hands } = scene({ bag: { 36: { name: 'stone_pickaxe', count: 1 } }, shelf: [null, { name: 'iron_ingot', count: 7 }, null] });
    const shelf = await hands.open(SHELF);
    assert.deepEqual(shelf.slots()[1], { name: 'iron_ingot', count: 7, key: 'iron_ingot' });
    await shelf.takeOut('iron_ingot', 7);
    await shelf.close();
    assert.equal(count(slots, 'iron_ingot'), 7);
    assert.equal(onShelf[1], null);
    assert.equal(slots[36].name, 'stone_pickaxe', 'the pickaxe never left its slot');
    assert.equal(bot.quickBarSlot, 0);
});

test('part of a stack: all of it comes off, the part wanted is split off, and the rest goes back to its slot', async () => {
    const { slots, onShelf, hands } = scene({ shelf: [{ name: 'torch', count: 64 }, null, { name: 'torch', count: 5 }] });
    const shelf = await hands.open(SHELF);
    await shelf.takeOut('torch', 10);
    assert.equal(count(slots, 'torch'), 10);
    assert.deepEqual(onShelf, [{ name: 'torch', count: 54 }, null, { name: 'torch', count: 5 }]);
    // More than one slot holds it: the first is emptied before the next is touched.
    await shelf.takeOut('torch', 56);
    assert.equal(count(slots, 'torch'), 66);
    assert.deepEqual(onShelf, [null, null, { name: 'torch', count: 3 }]);
});

test('with the hotbar full, a slot of it is emptied into the bag for the take and filled again after', async () => {
    const bag = {};
    for (let slot = 36; slot < 45; slot++) bag[slot] = { name: `item${slot}`, count: 1 };
    const { slots, onShelf, hands } = scene({ bag, shelf: [{ name: 'diamond', count: 3 }, null, null] });
    const shelf = await hands.open(SHELF);
    await shelf.takeOut('diamond', 3);
    for (let slot = 36; slot < 45; slot++) assert.equal(slots[slot]?.name, `item${slot}`, `hotbar slot ${slot} is as it was`);
    assert.equal(count(slots, 'diamond'), 3);
    assert.equal(onShelf[0], null);
});

test('a full bag takes nothing, and a stack it could not split goes back whole', async () => {
    const bag = {};
    for (let slot = 9; slot < 45; slot++) bag[slot] = { name: 'dirt', count: 64 };
    const full = scene({ bag, shelf: [{ name: 'diamond', count: 3 }, null, null] });
    const shelf = await full.hands.open(SHELF);
    await assert.rejects(shelf.takeOut('diamond', 3), /inventory is full/);
    assert.deepEqual(full.onShelf[0], { name: 'diamond', count: 3 });

    // One free slot: it holds the whole stack, but there is nowhere to split the part wanted into.
    delete bag[40];
    const one = scene({ bag, shelf: [{ name: 'torch', count: 64 }, null, null] });
    const again = await one.hands.open(SHELF);
    await assert.rejects(again.takeOut('torch', 10), /inventory is full/);
    assert.deepEqual(one.onShelf[0], { name: 'torch', count: 64 }, 'all of it went back');
    assert.equal(count(one.slots, 'torch'), 0);
});

test('a powered shelf is never clicked, and one out of reach is walked up to from in front', async () => {
    await assert.rejects(scene({ powered: true }).hands.open(SHELF), /powered: a click on it would swap your whole hotbar/);
    const far = scene({ shelf: [{ name: 'apple', count: 2 }, null, null], at: { x: 0.5, y: 64, z: -4.5 } });
    const shelf = await far.hands.open(SHELF);
    assert.deepEqual(far.walks, [{ x: 0, y: 64, z: 1 }], 'to the cell in front of it, not behind it');
    await shelf.takeOut('apple', 2);
    assert.equal(count(far.slots, 'apple'), 2);
});

test('fetching takes from a shelf as from a chest, through its hands', async () => {
    const { slots, onShelf, hands } = scene({ shelf: [{ name: 'string', count: 10 }, { name: 'iron_ingot', count: 7 }, null] });
    const report = await fetchItem([{ id: '0,64,0', ...SHELF, also: null, name: 'oak_shelf', shelf: true, items: { string: 10, iron_ingot: 7 }, free: 1, distance: 2 }],
        { name: 'iron_ingot', count: 4, hands, from: { x: 0, y: 64, z: 2 } });
    assert.equal(report.total, 4);
    assert.equal(count(slots, 'iron_ingot'), 4);
    assert.deepEqual(onShelf[1], { name: 'iron_ingot', count: 3 });
});

test('putting: a stack from the bag goes into an empty slot, the hotbar is left as it was, and a part is split off first', async () => {
    const bag = { 9: { name: 'torch', count: 40 } };
    for (let slot = 36; slot < 45; slot++) bag[slot] = { name: `item${slot}`, count: 1 };
    const { slots, onShelf, hands, bot } = scene({ bag, shelf: [{ name: 'torch', count: 64 }, null, null] });
    const shelf = await hands.open(SHELF);
    assert.equal(shelf.pockets()[0].name, 'torch');
    await shelf.putSlot(9, 40);
    assert.deepEqual(onShelf, [{ name: 'torch', count: 64 }, { name: 'torch', count: 40 }, null], 'into the empty slot, never onto the full one');
    for (let slot = 36; slot < 45; slot++) assert.equal(slots[slot]?.name, `item${slot}`, `hotbar slot ${slot} is as it was`);
    assert.equal(count(slots, 'torch'), 0);

    // Part of a stack: the rest stays in the bag. With a free slot to split into, the hotbar is not needed.
    slots[37] = null;
    slots[10] = { name: 'apple', count: 10 };
    await shelf.putSlot(10, 4);
    assert.deepEqual(onShelf[2], { name: 'apple', count: 4 });
    assert.equal(count(slots, 'apple'), 6);
    // Full now: nothing more goes on, and nothing is clicked.
    await assert.rejects(shelf.putSlot(10, 6), /the shelf is full/);
    assert.equal(count(slots, 'apple'), 6);
    await shelf.close();
    assert.equal(bot.quickBarSlot, 0);
});
