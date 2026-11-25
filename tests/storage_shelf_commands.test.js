// SPDX-License-Identifier: CC0-1.0
// Shelves in !putAway and !fetchItem, as installed on an agent. Things go onto a shelf only when a player
// has said what it is for, and only into an empty slot; fetching takes from shelves by the same rules of
// whose they are as from chests. The shelves here do what a live one does with a click (see
// storage_shelf_hands.test.js), on the fake bot's own bag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand } from '../src/agent/commands/index.js';
import { installStorage } from '../src/agent/storage/install.js';
import { fakeChestBot, stack } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
const keyOf = pos => `${pos.x},${pos.y},${pos.z}`;
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);

// The bot's own chest, and three shelves along the same wall, all facing south: the bot's torch shelf,
// a shelf of its own nobody has said anything about, and Alice's.
const TORCHES = '2,64,0', BARE = '4,64,0', ALICES = '6,64,0';
const { bot, room } = fakeChestBot({
    chests: { '0,64,0': row(27, ['cobblestone x10']) },
    pockets: ['torch x30', 'cobblestone x20', 'bread x4'],
});
const shelves = new Map([[TORCHES, [stack('torch x10'), null, null]], [BARE, [null, null, null]], [ALICES, [stack('iron_ingot x5'), null, stack('apple x2')]]]);
bot.entity = { position: { x: 3.5, y: 64, z: 3.5 }, eyeHeight: 1.62 };
bot.quickBarSlot = 0;
bot.setQuickBarSlot = n => { bot.quickBarSlot = n; };
const pocketOf = slot => slot - 9;
const edition = {
    shelfOf: block => (shelves.has(keyOf(block.position)) ? { facing: 'south', powered: false, slots: shelves.get(keyOf(block.position)).map(stack) } : null),
    async clickShelfSlot(b, block, slot) {
        const on = shelves.get(keyOf(block.position)), hand = pocketOf(36 + b.quickBarSlot);
        [room.pockets[hand], on[slot]] = [on[slot], room.pockets[hand]];
    },
    async moveInBag(b, from, to, n) {
        const [a, z] = [pocketOf(from), pocketOf(to)], there = room.pockets[a], here = room.pockets[z];
        if (!there) return;
        if (here && here.name !== there.name) { [room.pockets[a], room.pockets[z]] = [here, there]; return; }
        const moved = Math.min(n, there.count);
        room.pockets[z] = { name: there.name, count: (here?.count ?? 0) + moved };
        room.pockets[a] = there.count === moved ? null : { ...there, count: there.count - moved };
    },
};
const listeners = {};
bot.on = (name, fn) => { (listeners[name] ??= []).push(fn); };
bot.off = (name, fn) => { listeners[name] = (listeners[name] ?? []).filter(listener => listener !== fn); };
bot.emit = (name, ...args) => { for (const fn of [...(listeners[name] ?? [])]) fn(...args); };
const agent = {
    name: 'Keeper', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false },
    async handleMessage(source, run) { return run(); },
};
agent.actions = new ActionManager(agent);
installStorage(agent, {
    config: { chest_sorting: true, store_and_fetch: true, host: 'localhost', port: 25565, world_id: 'test' },
    bookDir: mkdtempSync(path.join(tmpdir(), 'shelf-commands-')),
    deps: {
        nearestBlocks: (b, distance, { shelves: withShelves = false } = {}) => [
            ...[...room.chests.keys()].map(id => room.blockAt(posOf(id))),
            ...(withShelves ? [...shelves.keys()].map(id => ({ name: 'oak_shelf', position: posOf(id) })) : []),
        ],
        blockAt: (b, pos) => (shelves.has(keyOf(pos)) ? { name: 'oak_shelf', position: posOf(keyOf(pos)) } : room.blockAt(pos)),
        // A walk to a shelf's front puts the bot there; one to a chest is noted as the fake room notes it.
        goTo: async (b, target, within) => {
            if (within === 1) bot.entity.position = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
            else await room.goTo(target);
        },
        inView: () => true,
        hands: { pauseMs: 0, settleMs: 0 },
        shelfHands: { edition, answerMs: 50, wait: async () => {} },
    },
});
const during = (source, command, ...args) => agent.handleMessage(source, () => getCommand(command).perform(agent, ...args));

test('the shelves are marked: the torch shelf is for torches, the bare one only the bot\'s own', async () => {
    await during('Alice', '!markChest', 0, 64, 0, 'Keeper', 'same');
    for (const [id, owner] of [[TORCHES, 'Keeper'], [BARE, 'Keeper'], [ALICES, 'Alice']]) {
        assert.match(await during('Alice', '!markChest', ...Object.values(posOf(id)), owner, 'same'), /a shelf, never sorted/);
    }
    assert.match(await during('Alice', '!chestFor', 2, 64, 0, 'torch'), /For torch/);
    const inbox = await during('Alice', '!chestFor', 4, 64, 0, 'inbox');
    assert.match(inbox, /a shelf can't be the inbox/);
});

test('torches go onto the torch shelf, as a stack of their own in an empty slot; nothing goes on the bare shelf', async () => {
    const text = await during('Alice', '!putAway', 'torch', 'any', 16);
    assert.match(text, /^Put away torch 30 in 1 chest:\n- oak_shelf at 2, 64, 0 \(your own\): torch 30/, text);
    assert.deepEqual(shelves.get(TORCHES), [{ name: 'torch', count: 10 }, { name: 'torch', count: 30 }, null], 'not poured onto the 10, which a click would have swapped');
    assert.equal(count(room.pockets, 'torch'), 0);
    // Cobblestone has the bot's chest: the shelf nobody said anything about stays bare.
    const cobble = await during('Alice', '!putAway', 'cobblestone', 'any', 16);
    assert.match(cobble, /chest at 0, 64, 0 \(your own\): cobblestone 20/, cobble);
    assert.deepEqual(shelves.get(BARE), [null, null, null]);
    assert.equal(bot.quickBarSlot, 0, 'the bot holds the slot it held');
});

test('fetching takes from the shelves: part of a stack, the rest put back; Alice\'s when Alice asks', async () => {
    const torch = await during('Alice', '!fetchItem', 'torch', 5);
    assert.match(torch, /^Took 5 torch:\n- 5 from the oak_shelf at 2, 64, 0 \(your own\)/, torch);
    assert.equal(count(shelves.get(TORCHES), 'torch'), 35);
    assert.equal(count(room.pockets, 'torch'), 5);
    const iron = await during('Alice', '!fetchItem', 'iron_ingot', 3);
    assert.match(iron, /^Took 3 iron_ingot:\n- 3 from the oak_shelf at 6, 64, 0 \(Alice's\)/, iron);
    assert.deepEqual(shelves.get(ALICES), [{ name: 'iron_ingot', count: 2 }, null, { name: 'apple', count: 2 }]);
});
