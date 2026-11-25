// SPDX-License-Identifier: CC0-1.0
// Filing the inbox, done with the real hands in a fake room of chests (tests/helpers/fake_chest_bot.js).
// No game and no model. Every test checks that nothing was gained or lost, that no chest was left open,
// and that the bot ends with exactly what it carried before: only the inbox's things are filed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { botHands } from '../src/agent/storage/bot_hands.js';
import { fileInbox } from '../src/agent/storage/inbox.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const SIZES = { iron_pickaxe: 1, ender_pearl: 16 };
const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);
const totals = slots => slots.reduce((acc, s) => (s ? { ...acc, [s.name]: (acc[s.name] ?? 0) + s.count } : acc), {});
const HERE = { x: 0, y: 64, z: -3 };
const INBOX = '0,64,0';

/** A room with an inbox at 0,64,0 and the other chests as given, and the hands on it. */
function room({ chests, pockets = [], holds = {} }) {
    const made = fakeChestBot({ chests, pockets, sizes: SIZES });
    const hands = botHands(made.bot, { goTo: made.room.goTo, blockAt: made.room.blockAt, pauseMs: 0, settleMs: 0, openTimeoutMs: 40 });
    const all = made.room.descriptors().map(chest => ({ ...chest, rank: 0, distance: chest.x, items: null, free: null, holds: holds[chest.id] }));
    const inboxes = all.filter(chest => chest.id === INBOX);
    const others = all.filter(chest => chest.id !== INBOX).map(chest => ({ ...chest, holds: chest.holds ?? [] }));
    const before = made.room.totals();
    const bagBefore = totals(made.room.pockets);
    const check = () => {
        assert.deepEqual(made.room.totals(), before, 'nothing gained or lost');
        assert.equal(made.bot.currentWindow, null, 'no chest is left open');
        assert.deepEqual(totals(made.room.pockets), bagBefore, 'the bot carries what it carried before');
    };
    const sizeOf = name => SIZES[name] ?? 64;
    return { ...made, hands, inboxes, others, check, sizeOf };
}
const file = (r, options = {}) => fileInbox(r.inboxes, r.others, { hands: r.hands, from: HERE, stackSize: r.sizeOf, ...options });

test('each thing in the inbox goes to the chest for it, or with its kind, or to an empty chest, and the inbox ends empty', async () => {
    const r = room({
        chests: {
            [INBOX]: row(27, ['iron_ingot x9', 'oak_log x20', 'wheat x5', 'iron_ingot x3']),
            '2,64,0': row(27), '4,64,0': row(27, ['oak_log x2']), '6,64,0': row(27),
        },
        holds: { '2,64,0': ['minerals'] },
    });
    const report = await file(r);
    r.check();
    assert.deepEqual(r.room.contents(INBOX).filter(Boolean), [], 'the inbox is empty');
    assert.equal(count(r.room.contents('2,64,0'), 'iron_ingot'), 12, 'iron into the chest for minerals');
    assert.equal(count(r.room.contents('4,64,0'), 'oak_log'), 22, 'logs with the logs');
    assert.equal(count(r.room.contents('6,64,0'), 'wheat'), 5, 'wheat starts the empty chest');
    assert.deepEqual(report.back, []);
    assert.equal(report.more, false);
    assert.deepEqual(Object.fromEntries(report.filed.map(f => [f.chest.id, f.items])),
        { '2,64,0': { iron_ingot: 12 }, '4,64,0': { oak_log: 20 }, '6,64,0': { wheat: 5 } });
});

test('the bot\'s own things stay with it, even of a kind it is filing', async () => {
    const r = room({
        chests: { [INBOX]: row(27, ['cobblestone x40', 'iron_pickaxe']), '2,64,0': row(27) },
        pockets: ['cobblestone x32', 'iron_pickaxe', 'bread x6'],
    });
    await file(r);
    r.check();
    assert.equal(count(r.room.contents('2,64,0'), 'cobblestone'), 40);
    assert.equal(count(r.room.contents('2,64,0'), 'iron_pickaxe'), 1, 'the inbox\'s pickaxe is filed');
    assert.equal(count(r.room.pockets, 'cobblestone'), 32, 'its own cobblestone is kept');
    assert.equal(count(r.room.pockets, 'iron_pickaxe'), 1, 'its own pickaxe is kept');
});

test('what fits nowhere goes back into the inbox, and the rest is still filed', async () => {
    const full = row(27, Array.from({ length: 27 }, () => 'stone x64'));
    const r = room({
        chests: { [INBOX]: row(27, ['dirt x30', 'iron_ingot x5']), '2,64,0': full, '4,64,0': row(27) },
        // The only chest with room is for minerals: the dirt has nowhere to go.
        holds: { '4,64,0': ['minerals'] },
    });
    const report = await file(r);
    r.check();
    assert.equal(count(r.room.contents('4,64,0'), 'iron_ingot'), 5);
    assert.equal(count(r.room.contents(INBOX), 'dirt'), 30, 'the dirt is back in the inbox');
    assert.deepEqual(report.back.map(b => [b.chest.id, b.items]), [[INBOX, { dirt: 30 }]]);
    assert.deepEqual(report.carrying, {});
});

test('an inbox holding more than the bag is filed in several trips', async () => {
    // A bag with four free slots, and nine stacks in the inbox.
    const pockets = Array.from({ length: 32 }, () => 'ender_pearl x16');
    const r = room({
        chests: { [INBOX]: row(27, Array.from({ length: 9 }, () => 'sand x64')), '2,64,0': row(27) },
        pockets,
    });
    const report = await file(r);
    r.check();
    assert.equal(count(r.room.contents('2,64,0'), 'sand'), 9 * 64);
    assert.deepEqual(r.room.contents(INBOX).filter(Boolean), []);
    assert.equal(report.more, false);
    assert.ok(r.room.opens.filter(id => id === INBOX).length >= 3, `went back to the inbox: ${r.room.opens}`);
});

test('a bag with no room for anything files nothing and says there is more', async () => {
    const pockets = Array.from({ length: 36 }, () => 'ender_pearl x16');
    const r = room({ chests: { [INBOX]: row(27, ['sand x10']), '2,64,0': row(27) }, pockets });
    const report = await file(r);
    r.check();
    assert.deepEqual(report.filed, []);
    assert.equal(report.more, true);
    assert.equal(count(r.room.contents(INBOX), 'sand'), 10);
});
