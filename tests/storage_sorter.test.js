// SPDX-License-Identifier: CC0-1.0
// Carrying a sort out: the bot looks in each chest, has a plan made, and makes the moves with its own
// clicks. No game and no model here. The chests are a fake room behind the handful of bot calls that
// sorting uses (tests/helpers/fake_chest_bot.js), which clicks the way the game does.
//
// Every test checks the same things at the end: nothing gained or lost, no chest left open, and, unless
// the test is about stopping early, chests that a second sort would not touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSort } from '../src/agent/storage/sorter.js';
import { botHands, stackOf } from '../src/agent/storage/bot_hands.js';
import { planSort } from '../src/agent/storage/sort_plan.js';
import { GROUPS, groupOf } from '../src/agent/storage/item_groups.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const SIZES = { ender_pearl: 16, egg: 16, snowball: 16, iron_pickaxe: 1, diamond_sword: 1, bow: 1, water_bucket: 1 };
const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const names = slots => slots.map(s => (s ? `${s.name} x${s.count}` : null));
const trimmed = list => { const out = [...list]; while (out.length && out.at(-1) === null) out.pop(); return out; };

/** What is really in every chest of a fake room, read the way the bot's hands read a window. */
const asChests = room => [...room.chests.keys()].map(id => ({ id, slots: room.items(id).map(stackOf) }));

/** Sorts a fake room with the real sorter and the real hands, and checks what must always hold. */
async function sortRoom(setup, { arrange = () => {}, sorter = {}, hands: handOptions = {}, totals: expected } = {}) {
    const { bot, room } = fakeChestBot({ sizes: SIZES, ...setup });
    const before = room.totals();
    arrange(room, bot);
    const stackSize = name => bot.registry.itemsByName[name].stackSize;
    const hands = botHands(bot, { goTo: room.goTo, blockAt: room.blockAt, pauseMs: 0, openTimeoutMs: 40, ...handOptions });
    const options = { stackSize, groupOf, groupOrder: GROUPS, carry: hands.free() };
    const report = await runSort(room.descriptors(), { hands, ...options, ...sorter });
    // `totals: false` is for a test where someone adds things half way: it counts for itself.
    if (expected !== false) assert.deepEqual(room.totals(), expected ?? before, 'nothing gained or lost');
    assert.equal(bot.currentWindow, null, 'no chest is left open');
    assert.deepEqual(room.dropped, [], 'nothing ended up on the floor');
    /** Would a second sort leave these chests alone? That is what "sorted" means. */
    const sorted = (ids = [...room.chests.keys()]) => planSort(asChests(room).filter(c => ids.includes(c.id)), options).moves.length === 0;
    return { bot, room, report, sorted, options };
}

test('S1: one chest, two kinds in part stacks: the real clicks merge them and put each kind together', async () => {
    const { room, report, sorted } = await sortRoom({
        chests: { '0,64,0': row(27, ['cobblestone x40', 'oak_log x10', null, 'cobblestone x30', 'oak_log x60', null, 'cobblestone x5']) },
    });
    assert.deepEqual(trimmed(names(room.contents('0,64,0'))), ['oak_log x64', 'oak_log x6', 'cobblestone x64', 'cobblestone x11']);
    assert.equal(report.done, true);
    assert.equal(sorted(), true);
    assert.deepEqual([report.stacksBefore, report.stacksAfter, report.replans], [5, 4, 0]);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(room.opens, ['0,64,0', '0,64,0'], 'opened once to look and once to sort');
});

test('S3: four chests, many kinds, mixed up: each kind ends in one chest, by the plan, with nothing in hand', async () => {
    const chests = {
        '0,64,0': row(27, ['iron_ingot x20', 'oak_log x30', 'bread x5', 'cobblestone x64', 'iron_pickaxe', 'dirt x12']),
        '2,64,0': row(27, ['oak_planks x40', 'iron_ingot x50', 'stone x33', 'diamond_sword', 'bread x10', 'ender_pearl x7']),
        '4,64,0': row(27, ['cobblestone x20', 'oak_log x50', 'gold_ingot x9', 'dirt x60', 'ender_pearl x12', 'bow']),
        '6,64,0': row(27, ['stone x40', 'oak_planks x30', 'coal x44', 'iron_pickaxe', 'bread x3', 'gold_ingot x8']),
    };
    const { bot, room, report, sorted, options } = await sortRoom({ chests });
    const plan = planSort(asChests(fakeChestBot({ sizes: SIZES, chests }).room), options);
    assert.equal(report.done, true);
    assert.equal(sorted(), true);
    assert.deepEqual(asChests(room), plan.target, 'the chests are exactly as the plan meant them');
    assert.deepEqual([report.moves, report.visits, report.replans], [plan.moves.length, plan.visits, 0]);
    assert.equal(room.opens.length, 4 + plan.visits, 'each chest is looked in once, then opened as the plan visits it');
    assert.ok(bot.inventory.slots.every(item => item === null), 'the bot carries nothing afterwards');
    assert.deepEqual(room.walks, room.opens, 'it walks to a chest before each time it opens one');
});

test('chests that are already sorted are looked in and left alone', async () => {
    const { room, report } = await sortRoom({
        chests: { '0,64,0': row(27, ['iron_ingot x64', 'iron_ingot x3', 'oak_log x9']), '2,64,0': row(27, ['cobblestone x64']) },
    });
    assert.deepEqual([report.done, report.moves, report.visits], [true, 0, 0]);
    assert.deepEqual(room.opens, ['0,64,0', '2,64,0']);
    assert.equal(room.clicks, 0);
});

test('full chests are sorted by swapping, and the bot\'s own things stay where they were', async () => {
    const mixed = (a, b) => row(27, Array.from({ length: 27 }, (_, i) => (i % 2 ? a : b)));
    const pockets = [...row(27, ['torch x12', null, 'cooked_beef x4']), ...row(9, ['stone_axe'])];
    const { bot, room, report, sorted } = await sortRoom({
        chests: { '0,64,0': mixed('cobblestone x64', 'oak_log x64'), '2,64,0': mixed('oak_log x64', 'cobblestone x64') },
        pockets,
    });
    assert.equal(report.done, true);
    assert.equal(sorted(), true);
    for (const id of room.chests.keys()) assert.equal(new Set(room.contents(id).map(s => s.name)).size, 1, `chest ${id} holds one kind`);
    assert.deepEqual(names(room.pockets), names(pockets.map(p => (p ? { name: p.split(' x')[0], count: Number(p.split(' x')[1] ?? 1) } : null))),
        'what the bot was carrying before is untouched, slot for slot');
    assert.equal(bot.inventory.slots[36].name, 'stone_axe', 'the hotbar is never used to carry chest items');
});

test('with no free slot of its own the bot still tidies each chest where it stands', async () => {
    const { room, report, sorted } = await sortRoom({
        chests: { '0,64,0': row(9, ['dirt x10', 'oak_log x3', 'dirt x10']), '2,64,0': row(9, ['oak_log x5', 'dirt x1']) },
        pockets: row(36, Array(36).fill('cobblestone x64')),
    });
    assert.equal(report.done, true);
    assert.equal(sorted(), true);
    assert.deepEqual(trimmed(names(room.contents('0,64,0'))), ['oak_log x3', 'dirt x20']);
    assert.deepEqual(trimmed(names(room.contents('2,64,0'))), ['oak_log x5', 'dirt x1'], 'nothing could travel, so each chest keeps its own');
});

test('a chest that will not open is left out and named, and the rest are sorted', async () => {
    const { room, report, sorted } = await sortRoom({
        chests: { '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']), '2,64,0': row(27, ['oak_log x5', 'dirt x1']), '4,64,0': row(27, ['dirt x7']) },
    }, { arrange: room => { room.blocked.add('2,64,0'); room.stuck.add('4,64,0'); } });
    assert.equal(report.done, true);
    assert.deepEqual(report.skipped.map(s => s.id), ['2,64,0', '4,64,0']);
    assert.match(report.skipped[0].reason, /did not open/);
    assert.match(report.skipped[1].reason, /did not open/, 'a chest that never answers is given up on after a moment');
    assert.equal(sorted(['0,64,0']), true);
    assert.deepEqual(trimmed(names(room.contents('2,64,0'))), ['oak_log x5', 'dirt x1'], 'the chest it could not open is untouched');
    assert.deepEqual(report.chests.map(c => c.id), ['0,64,0']);
});

test('a chest someone changed after the bot looked is noticed, and the bot plans again from what is there', async () => {
    const chests = {
        '0,64,0': row(27, ['iron_ingot x20', 'oak_log x30', 'cobblestone x10', 'iron_ingot x5']),
        '2,64,0': row(27, ['oak_log x20', 'cobblestone x50', 'iron_ingot x1']),
    };
    const { room, report, sorted } = await sortRoom({ chests }, {
        // The second time the second chest is opened, a player has been by: took the logs, left bread.
        arrange: room => {
            room.onOpen = (id, times) => {
                if (id !== '2,64,0' || times !== 2) return;
                const slots = room.chests.get(id);
                slots[slots.findIndex(s => s?.name === 'oak_log')] = { name: 'bread', count: 4 };
            };
        },
        totals: { iron_ingot: 26, oak_log: 30, cobblestone: 60, bread: 4 },
    });
    assert.equal(report.done, true);
    assert.equal(report.replans, 1);
    assert.equal(sorted(), true, 'the chests are in order, counting what the player did');
    assert.ok(room.pockets.every(s => s === null), 'nothing is left in hand');
});

test('a move the server will not make as planned is caught, and the bot stops instead of going round for ever', async () => {
    // The bot's item data says eggs stack to 64. This server says 16, so two tens will not merge.
    const { room, report } = await sortRoom({
        chests: { '0,64,0': row(9, ['egg x10', 'egg x10']) },
        sizes: { egg: 64 }, serverSizes: { egg: 16 },
    }, { sorter: { maxReplans: 2 } });
    assert.equal(report.done, false);
    assert.equal(report.replans, 2);
    assert.deepEqual(trimmed(names(room.contents('0,64,0'))), ['egg x16', 'egg x4'], 'the server\'s answer stands');
    assert.deepEqual(report.carrying, []);
});

test('when the bot guesses a click wrong, it asks the server and carries on without planning again', async () => {
    // Two kinds of tipped arrow share a name. The bot's side takes a click of one on the other for a
    // merge; the server swaps them. Either starting order is tried, so one of the two needs that swap.
    let moved = 0;
    for (const order of [['slow', 'fast'], ['fast', 'slow']]) {
        const arrows = order.map(tag => ({ name: 'tipped_arrow', count: 10, tag }));
        const { room, report, sorted } = await sortRoom({ chests: { '0,64,0': row(9, arrows) }, clientIgnoresTags: true });
        assert.deepEqual([report.done, report.replans], [true, 0]);
        assert.equal(sorted(), true);
        assert.deepEqual(room.contents('0,64,0').filter(Boolean).map(s => s.count), [10, 10], 'the two kinds were never merged');
        moved += report.moves;
    }
    assert.equal(moved, 1, 'one of the two orders needed the swap');
});

test('a chest that stops opening half way is dropped, what the bot was carrying is put back, and the rest is sorted', async () => {
    const chests = {
        '0,64,0': row(27, ['iron_ingot x20', 'oak_log x30', 'cobblestone x10']),
        '2,64,0': row(27, ['oak_log x20', 'cobblestone x50', 'iron_ingot x1']),
    };
    const { room, report, sorted } = await sortRoom({ chests }, {
        arrange: room => { room.onOpen = (id, times) => { if (id === '2,64,0' && times === 2) room.blocked.add(id); }; },
    });
    assert.deepEqual(report.skipped.map(s => s.id), ['2,64,0']);
    assert.equal(report.done, true, 'the chests it could still open are sorted');
    assert.equal(sorted(['0,64,0']), true);
    assert.ok(room.pockets.every(s => s === null), 'nothing is left in hand');
    assert.deepEqual(report.carrying, []);
});

test('with nowhere to put what it carries, the bot stops and says what it is holding', async () => {
    // Two full chests. The bot empties part of the first, then finds the second will not open, and
    // meanwhile someone has filled the gaps it left in the first.
    const full = kinds => row(9, Array.from({ length: 9 }, (_, i) => `${kinds[i % kinds.length]} x64`));
    const { room, report } = await sortRoom({
        chests: { '0,64,0': full(['cobblestone', 'oak_log']), '2,64,0': full(['oak_log', 'cobblestone']) },
    }, {
        arrange: room => {
            room.onOpen = (id, times) => {
                if (id === '2,64,0' && times === 2) {
                    room.blocked.add(id);
                    room.chests.set('0,64,0', room.chests.get('0,64,0').map(s => s ?? { name: 'gravel', count: 64 }));
                }
            };
        },
        totals: false,
    });
    assert.equal(report.done, false);
    assert.ok(report.carrying.length > 0, 'it says what it is still holding');
    assert.deepEqual(names(report.carrying), names(room.pockets.filter(Boolean)), 'and that is exactly what is in its inventory');
    const { cobblestone, oak_log } = room.totals();
    assert.deepEqual([cobblestone, oak_log], [9 * 64, 9 * 64], 'nothing that was in the chests is lost');
});

test('a cancelled sort stops at once, closes the chest, and loses nothing', async () => {
    const chests = { '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10', 'oak_log x9', 'stone x4', 'dirt x3']) };
    for (const where of ['between moves', 'in the middle of a move']) {
        let cancelled = false;
        const cancel = () => { cancelled = true; throw new Error('Action cancelled'); };
        const { bot, room } = fakeChestBot({ sizes: SIZES, chests });
        const before = room.totals();
        room.onClick = clicks => {
            if (where === 'in the middle of a move' && clicks === 2) cancel();   // one stack is on the cursor
            if (clicks === 4) cancelled = true;
        };
        const hands = botHands(bot, { goTo: room.goTo, blockAt: room.blockAt, pauseMs: 0 });
        const checkpoint = () => { if (cancelled) throw new Error('Action cancelled'); };
        await assert.rejects(runSort(room.descriptors(), { hands, stackSize: () => 64, groupOf, groupOrder: GROUPS, checkpoint }), /cancelled/, where);
        assert.equal(bot.currentWindow, null, `${where}: the chest is closed`);
        assert.deepEqual(room.totals(), before, `${where}: nothing gained or lost`);
        assert.deepEqual(room.dropped, [], `${where}: nothing on the floor`);
    }
});

test('either half of a double chest opens it', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(54, ['dirt x10', null, 'dirt x10']) } });
    room.halves.set('0,64,1', '0,64,0');
    const seen = [];
    // The first half is out of reach or hidden; the hands try the other one.
    const blockAt = pos => { seen.push(pos.z); return pos.z === 0 ? null : room.blockAt(pos); };
    const hands = botHands(bot, { goTo: room.goTo, blockAt, pauseMs: 0 });
    const report = await runSort(room.descriptors(), { hands, stackSize: () => 64, groupOf, groupOrder: GROUPS });
    assert.equal(report.done, true);
    assert.deepEqual(seen.slice(0, 2), [0, 1]);
    assert.deepEqual(trimmed(names(room.contents('0,64,0'))), ['dirt x20']);
});

test('a chest within reach is opened from where the bot stands; it walks only to one it cannot reach', async () => {
    const chests = { '2,64,0': row(9, ['dirt x3', null, 'dirt x4']), '9,64,0': row(9, ['oak_log x3', null, 'oak_log x4']) };
    const { bot, room } = fakeChestBot({ chests });
    bot.entity = { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 };
    const hands = botHands(bot, { goTo: room.goTo, blockAt: room.blockAt, pauseMs: 0 });
    const report = await runSort(room.descriptors(), { hands, stackSize: () => 64, groupOf, groupOrder: GROUPS });
    assert.equal(report.done, true);
    assert.deepEqual([...new Set(room.walks)], ['9,64,0'], 'the near chest was never walked to');
    assert.ok(room.opens.includes('2,64,0'));
});

test('a chest in reach that will not open from where the bot stands is walked up to and tried once more', async () => {
    const { bot, room } = fakeChestBot({ chests: { '2,64,0': row(9, ['dirt x3', null, 'dirt x4']) } });
    bot.entity = { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 };
    // Out of sight from here: the first try fails, and after the walk it opens.
    room.onOpen = (id, times) => { if (times === 1) room.blocked.add(id); else room.blocked.delete(id); };
    const hands = botHands(bot, { goTo: room.goTo, blockAt: room.blockAt, pauseMs: 0 });
    const report = await runSort(room.descriptors(), { hands, stackSize: () => 64, groupOf, groupOrder: GROUPS });
    assert.deepEqual([report.done, report.skipped.length], [true, 0]);
    assert.deepEqual(room.walks, ['2,64,0'], 'one walk, when the first try failed');
    assert.deepEqual(trimmed(names(room.contents('2,64,0'))), ['dirt x7']);
});

test('a walk that fails leaves the chest out, unless it brought the chest within reach anyway', async () => {
    const chests = { '9,64,0': row(9, ['dirt x3', null, 'dirt x4']) };
    for (const [stopsAt, opened] of [[1.5, false], [6.5, true]]) {
        const { bot, room } = fakeChestBot({ chests });
        bot.entity = { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 };
        const goTo = async () => { bot.entity.position.x = stopsAt; throw new Error('the way is blocked'); };
        const hands = botHands(bot, { goTo, blockAt: room.blockAt, pauseMs: 0 });
        const report = await runSort(room.descriptors(), { hands, stackSize: () => 64, groupOf, groupOrder: GROUPS });
        assert.equal(report.chests.length, opened ? 1 : 0, `a walk that stops at x = ${stopsAt}`);
        if (!opened) assert.match(report.skipped[0].reason, /the way is blocked/);
    }
});

test('stackOf: plain stacks go by name, and anything that would not stack in the game gets its own key', () => {
    const item = (name, count, extra = {}) => ({ name, count, metadata: 0, nbt: null, components: [], removedComponents: [], ...extra });
    assert.deepEqual(stackOf(item('dirt', 12)), { name: 'dirt', count: 12, key: 'dirt' });
    assert.equal(stackOf(null), null);
    assert.equal(stackOf(item('dirt', 0)), null);
    const worn = stackOf(item('iron_pickaxe', 1, { components: [{ type: 'damage', data: 30 }] }));
    const moreWorn = stackOf(item('iron_pickaxe', 1, { components: [{ type: 'damage', data: 31 }] }));
    assert.notEqual(worn.key, 'iron_pickaxe');
    assert.notEqual(worn.key, moreWorn.key);
    assert.match(worn.key, /^iron_pickaxe#/);
    // The same thing described in another order is still the same thing.
    const a = stackOf(item('bow', 1, { components: [{ type: 'damage', data: 3 }, { type: 'custom_name', data: 'Old' }] }));
    const b = stackOf(item('bow', 1, { components: [{ type: 'custom_name', data: 'Old' }, { type: 'damage', data: 3 }] }));
    assert.equal(a.key, b.key);
    // Older game versions have no components and keep the difference in nbt.
    assert.notEqual(stackOf(item('potion', 1, { components: undefined, removedComponents: undefined, nbt: { value: { Potion: 'swiftness' } } })).key, 'potion');
    // Newer ones say it all in components. There the bot's item code adds an nbt of its own to every
    // tool, which says nothing the server said: a new pickaxe is still a plain one.
    assert.equal(stackOf(item('iron_pickaxe', 1, { nbt: { value: { Damage: { type: 'int', value: 0 } } } })).key, 'iron_pickaxe');
    // Item data can hold numbers too big for JSON.
    assert.match(stackOf(item('map', 1, { components: [{ type: 'map_id', data: 12n }] })).key, /^map#/);
});

// A small seeded generator, so a failure can be run again exactly.
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('seeded random rooms: whatever the mess and however full, the real clicks reach a sorted room', async () => {
    const KINDS = ['cobblestone', 'oak_log', 'dirt', 'iron_ingot', 'bread', 'ender_pearl', 'egg', 'iron_pickaxe', 'bow', 'stone', 'coal', 'oak_planks'];
    for (let seed = 1; seed <= 120; seed++) {
        const random = seeded(seed);
        const pick = n => Math.floor(random() * n);
        const chests = {};
        const count = 1 + pick(4);
        for (let c = 0; c < count; c++) {
            const size = [9, 27, 54][pick(3)];
            const fill = [0.3, 0.7, 1][pick(3)];
            chests[`${c * 2},64,0`] = row(size, Array.from({ length: size }, () => {
                if (random() >= fill) return null;
                const name = KINDS[pick(KINDS.length)];
                const max = SIZES[name] ?? 64;
                return `${name} x${random() < 0.4 ? max : 1 + pick(max)}`;
            }));
        }
        // Sometimes the bot's own inventory is partly or wholly full, so it can carry little or nothing.
        const used = [0, 0, 20, 27][pick(4)];
        const pockets = row(36, Array.from({ length: used }, () => 'torch x3'));
        const { report, sorted, room } = await sortRoom({ chests, pockets });
        assert.equal(report.done, true, `seed ${seed}`);
        assert.equal(report.replans, 0, `seed ${seed}: nothing surprised it`);
        assert.equal(sorted(), true, `seed ${seed}`);
        assert.equal(room.pockets.filter(Boolean).length, used, `seed ${seed}: it carries only what it came with`);
    }
});
