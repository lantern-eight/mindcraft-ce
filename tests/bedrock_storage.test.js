// SPDX-License-Identifier: CC0-1.0
// Chest sorting's two edition questions, answered for Bedrock (src/agent/bedrock/edition.js and
// window_moves.js): which block is the other half of a double chest, and how a stack moves in an open
// chest. Hand-built windows and a stand-in for the server; tests/live/bedrock_storage.js runs the same on
// a real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bedrockEdition } from '../src/agent/bedrock/edition.js';
import { bedrockSlotOf, containerSideOf, moveStack, planMove, stacksWith } from '../src/agent/bedrock/window_moves.js';
import { botHands } from '../src/agent/storage/bot_hands.js';

// ---- The other half of a double chest ----

// A chest's block entity as the bot gets it from a Bedrock server: an NBT compound, each field typed.
const entity = fields => ({ type: 'compound', name: '', value: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { type: 'int', value: v }])) });

test('a Bedrock chest names the other half of its double chest in its block entity', () => {
    const block = { position: { x: 2, y: -19, z: -2 }, entity: entity({ x: 2, y: -19, z: -2, pairx: 3, pairz: -2, pairlead: 1 }) };
    assert.deepEqual(bedrockEdition.otherHalfOf(block), { x: 3, y: -19, z: -2 });
    // The same, read from fields already stripped of their types, from a position inside the block.
    assert.deepEqual(bedrockEdition.otherHalfOf({ position: { x: 3.5, y: -19, z: -1.5 }, entity: { pairx: 2, pairz: -2 } }), { x: 2, y: -19, z: -2 });
});

test('a single chest, a chest the bot only remembers, and a pairing that cannot be one name no other half', () => {
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ x: 2, y: 0, z: 0 }) }), null, 'no pairing');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 } }), null, 'remembered: no block entity');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ pairx: 4, pairz: 0 }) }), null, 'two blocks away');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ pairx: 3, pairz: 1 }) }), null, 'corner to corner');
    assert.equal(bedrockEdition.otherHalfOf(null), null);
});

// ---- Moving a stack ----

const item = (name, count, extra = {}) => ({ name, type: { cobblestone: 1, oak_log: 2, dirt: 3, iron_pickaxe: 4 }[name], count, metadata: 0, nbt: null, stackSize: name === 'iron_pickaxe' ? 1 : 64, ...extra });

/** A chest window of 27 slots, the bot's 36 after them, as the adapter lays it out, with a bot around it. */
function scene(chest = {}, bag = {}, { answer = 'ok' } = {}) {
    const slots = new Array(27 + 36).fill(null);
    for (const [slot, it] of Object.entries(chest)) slots[slot] = it;
    const window = { inventoryStart: 27, slots, updateSlot(slot, it) { this.slots[slot] = it; } };
    const inventory = { slots: new Array(45).fill(null) };
    // The adapter keeps the window's copy of the bot's own slots in step with its inventory.
    inventory.updateSlot = (slot, it) => {
        inventory.slots[slot] = it;
        const at = slot >= 36 ? 27 + 27 + (slot - 36) : 27 + (slot - 9);
        window.slots[at] = it;
    };
    for (const [slot, it] of Object.entries(bag)) inventory.updateSlot(9 + Number(slot), it);
    const requests = [];
    let nextId = 900;
    const bot = {
        registry: { version: { type: 'bedrock' } },
        inventory,
        _stack: {
            async stackReq(actions) {
                requests.push(...actions);
                // The server answers with new stack ids for the slots it touched.
                const touched = actions.flatMap(a => [a.source, a.destination]).filter(Boolean);
                const containers = touched.map(t => ({ slot_type: t.slot_type, slots: [{ slot: t.slot, item_stack_id: nextId++ }] }));
                return { status: answer, response: { status: answer, containers } };
            },
        },
    };
    return { bot, window, requests };
}
const names = (window, from, to) => window.slots.slice(from, to).map(s => (s ? `${s.name} ${s.count}` : null));

test('the window\'s slots are the chest\'s, then the bot\'s main inventory, then its hotbar', () => {
    const window = { inventoryStart: 54 };
    assert.deepEqual(bedrockSlotOf(window, 53), { container: 'container', slot: 53 });
    assert.deepEqual(bedrockSlotOf(window, 54), { container: 'inventory', slot: 9 });
    assert.deepEqual(bedrockSlotOf(window, 80), { container: 'inventory', slot: 35 });
    assert.deepEqual(bedrockSlotOf(window, 81), { container: 'hotbar', slot: 0 });
    assert.deepEqual(bedrockSlotOf(window, 89), { container: 'hotbar', slot: 8 });
    assert.equal(bedrockSlotOf(window, 90), null);
});

test('a move is one request: put down, poured in up to what fits, or swapped', async () => {
    const { bot, window, requests } = scene({ 0: item('cobblestone', 40, { stackId: 1 }), 1: item('cobblestone', 50, { stackId: 2 }), 2: item('oak_log', 10, { stackId: 3 }) });
    await moveStack(bot, window, 2, 10);
    assert.deepEqual(names(window, 0, 11), ['cobblestone 40', 'cobblestone 50', null, null, null, null, null, null, null, null, 'oak_log 10']);
    await moveStack(bot, window, 1, 0);
    assert.deepEqual(names(window, 0, 2), ['cobblestone 64', 'cobblestone 26'], 'what does not fit stays where it was');
    await moveStack(bot, window, 10, 0);
    assert.deepEqual(names(window, 0, 11), ['oak_log 10', 'cobblestone 26', null, null, null, null, null, null, null, null, 'cobblestone 64']);
    assert.deepEqual(requests.map(r => [r.type_id, r.legacy_type_id, r.count]), [['place', 1, 10], ['place', 1, 24], ['swap', 2, undefined]]);
    // Each slot is named by its container and the stack's id, as the server checks them.
    assert.deepEqual(requests[1].source, { slot_type: { container_id: 'container' }, slot: 1, stack_id: 2 });
    assert.deepEqual(requests[1].destination, { slot_type: { container_id: 'container' }, slot: 0, stack_id: 1 });
    // And the stacks carry the ids the server gave them, for the next request.
    assert.ok(window.slots[0].stackId >= 900 && window.slots[10].stackId >= 900);
});

test('into the bot\'s own slots it is a take, back out a place, and the bot\'s inventory follows', async () => {
    const { bot, window, requests } = scene({ 4: item('dirt', 7, { stackId: 5 }) }, { 0: item('cobblestone', 20, { stackId: 6 }) });
    await moveStack(bot, window, 4, 28); // the bot's second main slot
    assert.equal(bot.inventory.slots[10].name, 'dirt');
    assert.equal(window.slots[4], null);
    await moveStack(bot, window, 27, 4); // its first main slot, into the chest
    assert.equal(bot.inventory.slots[9], null);
    assert.equal(window.slots[4].name, 'cobblestone');
    assert.deepEqual(requests.map(r => [r.type_id, r.source.slot_type.container_id, r.source.slot, r.destination.slot_type.container_id, r.destination.slot]),
        [['take', 'container', 4, 'inventory', 10], ['place', 'inventory', 9, 'container', 4]]);
});

test('a barrel\'s slots and a shulker box\'s are named as Bedrock names them, or the server refuses the move', async () => {
    assert.equal(containerSideOf('chest'), 'container');
    assert.equal(containerSideOf('trapped_chest'), 'container');
    assert.equal(containerSideOf('barrel'), 'barrel');
    assert.equal(containerSideOf('red_shulker_box'), 'shulker');
    assert.equal(containerSideOf(undefined), 'container');
    const { bot, window, requests } = scene({ 0: item('dirt', 5, { stackId: 1 }) });
    window.position = { x: 7, y: -19, z: 9 };
    bot.blockAt = pos => (pos.x === 7 && pos.y === -19 && pos.z === 9 ? { name: 'barrel' } : null);
    await moveStack(bot, window, 0, 27);
    assert.equal(requests[0].source.slot_type.container_id, 'barrel');
    assert.equal(requests[0].type_id, 'take');
    assert.equal(bot.inventory.slots[9].name, 'dirt', 'the stack id the server gave the barrel\'s side is read back too');
});

test('two stacks of one item that differ (a worn tool and a new one) are swapped, never poured', () => {
    const worn = item('iron_pickaxe', 1, { nbt: { type: 'compound', value: { Damage: { type: 'int', value: 25 } } } });
    const fresh = item('iron_pickaxe', 1, { nbt: { type: 'compound', value: { Damage: { type: 'int', value: 0 } } } });
    assert.equal(stacksWith(worn, fresh), false);
    assert.equal(stacksWith(item('dirt', 3), item('dirt', 60)), true);
    const window = { inventoryStart: 27, slots: [worn, fresh] };
    assert.equal(planMove(window, 0, 1).action.type_id, 'swap');
});

test('nothing is asked for when there is nothing to move or no room, and a refused move changes nothing', async () => {
    const full = scene({ 0: item('cobblestone', 64), 1: item('cobblestone', 10) });
    await moveStack(full.bot, full.window, 1, 0);
    await moveStack(full.bot, full.window, 5, 0);
    assert.deepEqual(full.requests, [], 'nothing sent');
    const refused = scene({ 0: item('dirt', 3, { stackId: 4 }) }, {}, { answer: 'error' });
    await moveStack(refused.bot, refused.window, 0, 1);
    assert.equal(refused.requests.length, 1);
    assert.deepEqual(names(refused.window, 0, 2), ['dirt 3', null], 'as it was: the sort sees the move did not happen');
});

test('chest sorting\'s hands on a Bedrock bot make each move as a request, not as clicks', async () => {
    const { bot, window, requests } = scene({ 0: item('dirt', 5, { stackId: 1 }), 3: item('dirt', 9, { stackId: 2 }) });
    bot.clickWindow = () => { throw new Error('a Bedrock bot has no clicks'); };
    bot.openContainer = async () => window;
    bot.entity = { position: { x: 0.5, y: 0, z: 0.5 }, eyeHeight: 1.62 };
    bot.currentWindow = window;
    window.close = () => {};
    const hands = botHands(bot, { goTo: async () => {}, blockAt: () => ({ name: 'chest' }), wait: async () => {} });
    const chest = await hands.open({ x: 1, y: 0, z: 0 });
    await chest.move('move', 3, 0);
    assert.deepEqual(chest.slots().slice(0, 4).map(s => s && s.count), [14, null, null, null]);
    await chest.move('take', 0, 0);
    assert.deepEqual(chest.bag()[0], { name: 'dirt', count: 14, key: 'dirt' });
    await chest.settle();
    await chest.close();
    assert.deepEqual(requests.map(r => r.type_id), ['place', 'take']);
});
