// SPDX-License-Identifier: CC0-1.0
// Putting away and fetching, done with the real hands in a fake room of chests (tests/helpers/fake_chest_bot.js),
// which moves items the way the game does. No game and no model. Every test checks that nothing was gained or
// lost and that no chest was left open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { botHands } from '../src/agent/storage/bot_hands.js';
import { keepPlan } from '../src/agent/storage/keep_plan.js';
import { fetchItem, putAway } from '../src/agent/storage/stow.js';
import { fakeChestBot, stack } from './helpers/fake_chest_bot.js';

const SIZES = { iron_pickaxe: 1, stone_pickaxe: 1, ender_pearl: 16 };
const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);
const HERE = { x: 0, y: 64, z: -3 };

/** A fake room, the hands on it, and the chests as putAway and fetchItem are handed them. */
function room({ chests, pockets = [], unseen = [], arrange = () => {} }) {
    const made = fakeChestBot({ chests, pockets, sizes: SIZES });
    arrange(made.room);
    const hands = botHands(made.bot, { goTo: made.room.goTo, blockAt: made.room.blockAt, pauseMs: 0, settleMs: 0, openTimeoutMs: 40 });
    const believed = id => {
        if (unseen.includes(id)) return { items: null, free: null };
        const items = {};
        for (const s of made.room.contents(id)) if (s) items[s.name] = (items[s.name] ?? 0) + s.count;
        return { items, free: made.room.contents(id).filter(s => !s).length };
    };
    const descriptors = made.room.descriptors().map(chest => ({ ...chest, rank: 0, distance: chest.x, ...believed(chest.id) }));
    const before = made.room.totals();
    const check = () => {
        assert.deepEqual(made.room.totals(), before, 'nothing gained or lost');
        assert.equal(made.bot.currentWindow, null, 'no chest is left open');
    };
    const sizeOf = name => SIZES[name] ?? 64;
    return { ...made, hands, descriptors, check, sizeOf };
}
/** The bag as the keep plan reads it, from the fake bot's own slots. */
const bag = bot => bot.inventory.slots.map((item, slot) => (item ? { name: item.name, count: item.count, slot } : null)).filter(Boolean);

test('put away: each kind goes to the chest that holds it, a new kind to an empty chest, the kept things stay', async () => {
    const r = room({
        chests: { '0,64,0': row(27, ['cobblestone x60', 'stone x64']), '2,64,0': row(27), '4,64,0': row(27, ['oak_log x10']) },
        pockets: ['cobblestone x64', 'cobblestone x20', 'oak_log x30', 'wheat x12', 'iron_pickaxe', 'stone_pickaxe', 'stone_pickaxe', 'bread x5'],
    });
    const plan = keepPlan(bag(r.bot));
    const report = await putAway(r.descriptors, { items: plan.store, hands: r.hands, from: HERE, stackSize: r.sizeOf });
    r.check();
    assert.deepEqual(report.left, []);
    assert.equal(count(r.room.contents('0,64,0'), 'cobblestone'), 60 + 52, 'all but the 32 kept');
    assert.equal(count(r.room.contents('4,64,0'), 'oak_log'), 40);
    assert.equal(count(r.room.contents('2,64,0'), 'wheat'), 12, 'a new group starts the empty chest');
    // The bot keeps its pickaxes (the iron one and a spare), its bread and 32 cobblestone.
    assert.equal(count(r.room.pockets, 'stone_pickaxe'), 1, 'one stone pickaxe was stored: the bot keeps the iron one and one spare');
    assert.equal(count(r.room.pockets, 'iron_pickaxe'), 1);
    assert.equal(count(r.room.pockets, 'cobblestone'), 32);
    assert.equal(count(r.room.pockets, 'bread'), 5);
});

test('put away: a chest that filled up since the bot looked is found out on opening, and the rest goes on', async () => {
    const r = room({
        chests: { '0,64,0': row(27, ['dirt x10']), '2,64,0': row(27) },
        pockets: ['dirt x60'],
        // Someone fills the first chest with stone after the bot last saw it.
        arrange: rm => rm.chests.set('0,64,0', row(27, Array.from({ length: 26 }, () => 'stone x64').concat(['dirt x10'])).map(stack)),
    });
    // The bot still believes the first chest has dirt and room.
    r.descriptors[0].items = { dirt: 10 };
    r.descriptors[0].free = 26;
    const report = await putAway(r.descriptors, { items: [{ name: 'dirt', count: 60, slots: [9] }], hands: r.hands, from: HERE, stackSize: r.sizeOf });
    r.check();
    assert.deepEqual(report.left, []);
    assert.equal(count(r.room.contents('0,64,0'), 'dirt'), 64, 'the part stack was topped up');
    assert.equal(count(r.room.contents('2,64,0'), 'dirt'), 6, 'the rest went on to the next chest');
});

test('put away: with no room anywhere, what is left stays in the bag and is named', async () => {
    const full = row(27, Array.from({ length: 27 }, () => 'stone x64'));
    const r = room({ chests: { '0,64,0': full }, pockets: ['dirt x20'] });
    const report = await putAway(r.descriptors, { items: [{ name: 'dirt', count: 20, slots: [9] }], hands: r.hands, from: HERE, stackSize: r.sizeOf });
    r.check();
    assert.deepEqual(report.left, [{ name: 'dirt', count: 20 }]);
    assert.equal(report.full, true);
    assert.equal(count(r.room.pockets, 'dirt'), 20);
});

test('put away: a chest that will not open is left out and named, and another takes the things', async () => {
    const r = room({ chests: { '0,64,0': row(27, ['sand x5']), '2,64,0': row(27) }, pockets: ['sand x30'], arrange: rm => rm.blocked.add('0,64,0') });
    const report = await putAway(r.descriptors, { items: [{ name: 'sand', count: 30, slots: [9] }], hands: r.hands, from: HERE, stackSize: r.sizeOf });
    r.check();
    assert.deepEqual(report.skipped.map(s => s.chest.id), ['0,64,0']);
    assert.equal(count(r.room.contents('2,64,0'), 'sand'), 30);
});

test('put away: a chest never looked into is opened and used when the known ones are full', async () => {
    const full = row(27, Array.from({ length: 27 }, () => 'stone x64'));
    const r = room({ chests: { '0,64,0': full, '2,64,0': row(27, ['gravel x3']) }, pockets: ['gravel x10'], unseen: ['2,64,0'] });
    const report = await putAway(r.descriptors, { items: [{ name: 'gravel', count: 10, slots: [9] }], hands: r.hands, from: HERE, stackSize: r.sizeOf });
    r.check();
    assert.deepEqual(report.left, []);
    assert.equal(count(r.room.contents('2,64,0'), 'gravel'), 13);
});

test('fetch: from the one chest that has enough, and then from several when one is not enough', async () => {
    const r = room({ chests: { '0,64,0': row(27, ['iron_ingot x4']), '2,64,0': row(27, ['iron_ingot x20']) } });
    const one = await fetchItem(r.descriptors, { name: 'iron_ingot', count: 10, hands: r.hands, from: HERE });
    assert.equal(one.total, 10);
    assert.deepEqual(one.taken.map(t => [t.chest.id, t.count]), [['2,64,0', 10]]);
    const fresh = room({ chests: { '0,64,0': row(27, ['iron_ingot x4']), '2,64,0': row(27, ['iron_ingot x20']) } });
    const more = await fetchItem(fresh.descriptors, { name: 'iron_ingot', count: 22, hands: fresh.hands, from: HERE });
    fresh.check();
    assert.equal(more.total, 22);
    assert.deepEqual(more.taken.map(t => [t.chest.id, t.count]), [['0,64,0', 4], ['2,64,0', 18]]);
    assert.equal(count(fresh.room.pockets, 'iron_ingot'), 22);
});

test('fetch: a chest emptied since the bot looked gives nothing, and it goes on to the next', async () => {
    const r = room({ chests: { '0,64,0': row(27, ['coal x30']), '2,64,0': row(27, ['coal x10']) },
        arrange: rm => rm.chests.set('0,64,0', row(27).map(stack)) });
    r.descriptors[0].items = { coal: 30 };
    const report = await fetchItem(r.descriptors, { name: 'coal', count: 8, hands: r.hands, from: HERE });
    r.check();
    assert.equal(report.total, 8);
    assert.deepEqual(report.taken.map(t => t.chest.id), ['2,64,0']);
});

test('fetch: chests never looked into are opened, nearest first, until it is found', async () => {
    const r = room({ chests: { '0,64,0': row(27, ['dirt x3']), '2,64,0': row(27, ['torch x40']) }, unseen: ['0,64,0', '2,64,0'] });
    const report = await fetchItem(r.descriptors, { name: 'torch', count: 16, hands: r.hands, from: HERE });
    r.check();
    assert.equal(report.total, 16);
    assert.deepEqual(r.room.opens, ['0,64,0', '2,64,0']);
});

test('fetch: a full bag with room on a stack still takes what fits, and says the bag is full', async () => {
    const pockets = ['torch x60', ...Array.from({ length: 35 }, () => 'dirt x64')];
    const r = room({ chests: { '0,64,0': row(27, ['torch x30']) }, pockets });
    const report = await fetchItem(r.descriptors, { name: 'torch', count: 20, hands: r.hands, from: HERE });
    r.check();
    assert.equal(report.total, 4);
    assert.equal(report.bagFull, true);
});

test('fetch: nothing anywhere takes nothing and opens nothing it knows to be without it', async () => {
    const r = room({ chests: { '0,64,0': row(27, ['dirt x3']) } });
    const report = await fetchItem(r.descriptors, { name: 'diamond', count: 1, hands: r.hands, from: HERE });
    assert.equal(report.total, 0);
    assert.deepEqual(r.room.opens, []);
});
