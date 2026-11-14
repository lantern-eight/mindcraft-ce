// SPDX-License-Identifier: CC0-1.0
// What a person or the model sees of chest sorting: which blocks count as a chest to sort, the chest
// commands and what they report, whose chests a sort touches, and the `chest_sorting` setting that
// turns it all on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import settings from '../settings.js';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand, getCommands, isAction, parseCommandMessage } from '../src/agent/commands/index.js';
import { createChestBook, loadChestBook } from '../src/agent/storage/chest_book.js';
import { chestsFrom, isSortable } from '../src/agent/storage/chests.js';
import { chestsText, leftText, markChest, markChests, readOwner, readSorting, sortChestAt, sortChestsHere, sortText } from '../src/agent/storage/commands.js';
import { scopeDir } from '../src/agent/memory/files.js';
import { installStorage } from '../src/agent/storage/install.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const block = (name, x, y, z, props = null) => ({ name, position: { x, y, z }, getProperties: () => props });

test('chests, trapped chests and barrels are sorted; other containers are not', () => {
    for (const name of ['chest', 'trapped_chest', 'barrel']) assert.equal(isSortable(name), true, name);
    // An ender chest is one player's own, a hopper empties itself, a furnace is not storage, and a
    // shulker box cannot hold another shulker box, which a sort might try to put in it.
    for (const name of ['ender_chest', 'hopper', 'furnace', 'shulker_box', 'red_shulker_box', 'dispenser', 'stone']) assert.equal(isSortable(name), false, name);
});

test('the two halves of a double chest are one chest, whichever half is seen', () => {
    // A double chest facing west: seen from the front, the half marked left is the southern one.
    const north = block('chest', 4, 70, 0, { facing: 'west', type: 'right' });
    const south = block('chest', 4, 70, 1, { facing: 'west', type: 'left' });
    const single = block('chest', 8, 70, 0, { facing: 'north', type: 'single' });
    const barrel = block('barrel', 9, 70, 0, { facing: 'up' });
    const found = chestsFrom([south, north, single, barrel, block('furnace', 1, 70, 1), null]);
    assert.deepEqual(found, [
        { id: '4,70,0', x: 4, y: 70, z: 0, also: { x: 4, y: 70, z: 1 }, name: 'chest' },
        { id: '8,70,0', x: 8, y: 70, z: 0, also: null, name: 'chest' },
        { id: '9,70,0', x: 9, y: 70, z: 0, also: null, name: 'barrel' },
    ]);
    // Only one half in view: still the same chest, and the hands know where the other half is.
    assert.deepEqual(chestsFrom([south]), [found[0]]);
    assert.deepEqual(chestsFrom([north]), [found[0]]);
    // A remembered block that cannot say how it is turned is taken as a single chest.
    assert.deepEqual(chestsFrom([{ name: 'chest', position: { x: 1, y: 2, z: 3 } }])[0].also, null);
});

const chest = (x, slots, extra = {}) => ({ id: `${x},64,0`, x, y: 64, z: 0, also: null, name: 'chest', slots, ...extra });
const s = (name, count) => ({ name, count, key: name });

test('the report of a sort says what was done and what is in each chest now', () => {
    const report = {
        chests: [chest(0, row(27, [s('iron_pickaxe', 1), s('iron_ingot', 64), s('iron_ingot', 7)])), chest(2, row(27, [s('oak_log', 40)]), { also: { x: 2, y: 64, z: 1 } }), chest(4, row(27))],
        skipped: [], moves: 31, visits: 5, replans: 0, stacksBefore: 12, stacksAfter: 4, carrying: [], done: true,
    };
    assert.equal(sortText(report), [
        'Sorted 3 chests in 31 moves: 12 stacks are now 4.',
        '- chest at 0, 64, 0: tools, minerals (3 of 27 slots used)',
        '- double chest at 2, 64, 0: wood (1 of 27 slots used)',
        '- chest at 4, 64, 0: empty',
    ].join('\n'));
});

test('the report says so when nothing needed moving, when a chest was left out, and when it had to stop', () => {
    const tidy = { chests: [chest(0, row(27, [s('dirt', 3)]))], skipped: [], moves: 0, visits: 0, replans: 0, stacksBefore: 1, stacksAfter: 1, carrying: [], done: true };
    assert.match(sortText(tidy), /^The chest here is already in order\. Nothing was moved\.\n- chest at 0, 64, 0: earth/);

    const leftOut = { ...tidy, moves: 4, skipped: [{ ...chest(6, []), name: 'barrel', reason: 'it did not open' }] };
    assert.match(sortText(leftOut), /^Sorted 1 chest in 4 moves/);
    assert.match(sortText(leftOut), /\n- barrel at 6, 64, 0 was left out: it did not open$/);

    const stopped = { ...tidy, moves: 9, replans: 3, done: false, carrying: [s('oak_log', 64), s('oak_log', 20), s('dirt', 5)] };
    const text = sortText(stopped);
    assert.match(text, /^Stopped before the chest was in order/);
    assert.match(text, /You are still carrying what you took out and could not put back: oak_log 84, dirt 5\./);

    const none = { chests: [], skipped: [{ ...chest(6, []), reason: 'it did not open' }], moves: 0, visits: 0, replans: 0, stacksBefore: 0, stacksAfter: 0, carrying: [], done: false };
    assert.match(sortText(none), /^Could not open the chest here\.\n- chest at 6, 64, 0 was left out: it did not open$/);
});

test('the report says whose chests were sorted when that is worth saying', () => {
    const tidy = { chests: [chest(0, row(27, [s('dirt', 3)])), chest(2, row(27))], skipped: [], moves: 6, visits: 2, replans: 0, stacksBefore: 4, stacksAfter: 1, carrying: [], done: true };
    assert.match(sortText(tidy, { label: "Alice's" }), /^Sorted 2 chests \(Alice's\) in 6 moves: 4 stacks are now 1\./);
    assert.match(sortText({ ...tidy, moves: 0 }, { label: 'your own' }), /^The 2 chests here \(your own\) are already in order\./);
});

test('what was left alone is said, one line per reason, so doing nothing is never silent', () => {
    const c = x => chest(x, []);
    const left = [
        { chest: c(20), owner: 'Alice', why: 'never' },
        { chest: c(4), owner: 'Bob', why: 'other' }, { chest: c(6), owner: 'bob', why: 'other' },
        { chest: c(8), owner: 'shared', why: 'other' },
        { chest: c(10), owner: 'me', why: 'other' },
        { chest: c(12), owner: null, why: 'unknown' }, { chest: c(14), owner: null, why: 'unknown' },
    ];
    assert.equal(leftText({ left, hidden: 2 }, { whose: 'Alice' }), [
        "- 1 chest of Alice's marked never sort: 20, 64, 0",
        "- 2 chests of Bob's",
        '- 1 shared chest',
        '- 1 chest of your own',
        '- 2 chests with no known owner: 12, 64, 0; 14, 64, 0. Ask whose they are before sorting them.',
        "- 2 more Alice's are nearby but out of sight from here. Only chests you can see from where you stand are sorted.",
    ].join('\n'));
    assert.match(leftText({ left: [{ chest: c(2), owner: 'Alice', why: 'not_always' }], hidden: 1 }, { whose: 'approved' }),
        /^- 1 chest of Alice's, sorted only when asked\n- 1 more that may always be sorted is nearby but out of sight/);
    assert.match(leftText({ left: [{ chest: c(2), owner: 'Alice', why: 'not_asked' }] }), /nobody asked for this to be sorted/);
    assert.equal(leftText({ left: [], hidden: 0 }), '');
});

test('an owner is read as the model gives it, and "mine" is never guessed at', () => {
    const book = createChestBook({ scope: 'test' });
    book.mark(chest(0, []), { owner: 'Alice' });
    const read = text => readOwner(text, { name: 'Sorter', book, players: ['Bob_42'] });
    assert.deepEqual(read('alice'), { owner: 'Alice' }, 'spelled the way the book has it');
    assert.deepEqual(read('bob_42'), { owner: 'Bob_42' }, 'or the way the player list has it');
    assert.deepEqual(read('Carol'), { owner: 'Carol' }, 'a player who is offline can still own a chest');
    assert.deepEqual(read('"shared"'), { owner: 'shared' });
    assert.deepEqual(read('Sorter'), { owner: 'me' }, 'the bot\'s own chests go by its own name');
    assert.deepEqual(read('yourself'), { owner: 'me' });
    assert.deepEqual(read('unknown'), { owner: null });
    assert.deepEqual(read('same'), { same: true });
    // The model speaks for several people: "mine" could be the player talking, or the bot.
    for (const word of ['me', 'mine', 'my']) assert.match(read(word).error, /could be you or the player/);
    assert.match(read('').error, /Whose\?/);

    assert.deepEqual(readSorting('Always'), { sorting: 'always' });
    assert.deepEqual(readSorting('ask'), { sorting: 'asked' });
    assert.deepEqual(readSorting('never'), { sorting: 'never' });
    assert.deepEqual(readSorting('same'), { same: true });
    assert.match(readSorting('sometimes').error, /always.*asked.*never/);
});

/** The parts of an agent that an action needs, around a fake bot in a room of chests. */
function agentIn(room, bot) {
    const agent = { name: 'Sorter', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false } };
    bot.emit = () => {};
    agent.actions = new ActionManager(agent);
    return agent;
}
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
/** How the commands find and reach chests in a fake room, with a chest book. `hidden` are chests out of sight. */
const deps = (room, { book = createChestBook({ scope: 'test' }), hidden = [], ...rest } = {}) => ({
    nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
    blockAt: (bot, pos) => room.blockAt(pos),
    goTo: async (bot, chest) => room.goTo(chest),
    inView: (bot, found) => !hidden.includes(found.id),
    hands: { pauseMs: 0 },
    book, name: 'Sorter',
    ...rest,
});
const found = id => ({ id, ...posOf(id), also: null, name: 'chest' });
const stacks = (room, id) => room.contents(id).filter(Boolean);

/** A room shared by two players: two chests of Alice's, one of Bob's, one nobody has claimed. All in a mess. */
function sharedRoom() {
    const made = fakeChestBot({ chests: {
        '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']), '2,64,0': row(27, ['oak_log x5', 'dirt x1']),
        '4,64,0': row(27, ['dirt x7', null, 'dirt x7', 'oak_log x2']), '6,64,0': row(27, ['stone x3', null, 'stone x4']),
    } });
    const book = createChestBook({ scope: 'test' });
    book.mark(found('0,64,0'), { owner: 'Alice' });
    book.mark(found('2,64,0'), { owner: 'Alice' });
    book.mark(found('4,64,0'), { owner: 'Bob' });
    return { ...made, book };
}

test('"sort my chests": that player\'s chests are sorted together, and nobody else\'s is touched', async () => {
    const { bot, room, book } = sharedRoom();
    const bobBefore = room.contents('4,64,0'), strayBefore = room.contents('6,64,0');
    const result = await sortChestsHere(bot, 'alice', 8, deps(room, { book, by: 'Alice' }));
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Sorted 2 chests \(Alice's\) in \d+ moves: 5 stacks are now 2\./);
    assert.deepEqual(stacks(room, '0,64,0'), [{ name: 'dirt', count: 21 }]);
    assert.deepEqual(stacks(room, '2,64,0'), [{ name: 'oak_log', count: 8 }]);
    assert.deepEqual(room.contents('4,64,0'), bobBefore, 'Bob\'s chest is slot for slot as it was');
    assert.deepEqual(room.contents('6,64,0'), strayBefore);
    assert.ok(!room.opens.includes('4,64,0') && !room.opens.includes('6,64,0'), 'and was never even opened');
    assert.match(result.text, /\nLeft alone within 8 blocks:\n- 1 chest of Bob's\n- 1 chest with no known owner: 6, 64, 0\. Ask whose it is before sorting it\.$/);
    assert.deepEqual(book.of(found('0,64,0')).lastSorted.by, 'Alice');
});

test('by default nothing is sorted: a room nobody has spoken about is left alone, and the bot is told to ask', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['dirt x10', null, 'dirt x10']), '2,64,0': row(27, ['oak_log x5']) } });
    for (const whose of ['approved', 'Sorter', 'Alice', 'shared']) {
        const result = await sortChestsHere(bot, whose, 8, deps(room));
        assert.equal(result.status, 'failed', whose);
        assert.match(result.text, /Nothing was sorted\.\nLeft alone within 8 blocks:\n- 2 chests with no known owner/, whose);
    }
    assert.equal(room.opens.length, 0);
    assert.equal(room.clicks, 0);

    const nothing = await sortChestsHere(bot, 'approved', 8, { ...deps(room), nearestBlocks: () => [] });
    assert.equal(nothing.status, 'failed');
    assert.match(nothing.text, /don't see or remember a chest or barrel within 8 blocks/);
    // Whose is never guessed, and chests nobody owns are not thrown together.
    assert.match((await sortChestsHere(bot, 'mine', 8, deps(room))).text, /^Whose chests\?/);
    assert.match((await sortChestsHere(bot, 'unknown', 8, deps(room))).text, /not sorted together/);
});

test('"approved" sorts what may always be sorted, each owner\'s chests by themselves', async () => {
    const { bot, room, book } = sharedRoom();
    book.mark(found('6,64,0'), { owner: 'me' });                // the bot's own: always
    book.mark(found('4,64,0'), { sorting: 'always' });          // Bob said his may always be sorted
    const aliceBefore = [room.contents('0,64,0'), room.contents('2,64,0')];
    const result = await sortChestsHere(bot, 'approved', 8, deps(room, { book }));
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Sorted 1 chest \(your own\) in \d+ moves?/);
    assert.match(result.text, /\nSorted 1 chest \(Bob's\) in \d+ moves?/);
    assert.deepEqual(stacks(room, '6,64,0'), [{ name: 'stone', count: 7 }]);
    assert.deepEqual(stacks(room, '4,64,0'), [{ name: 'oak_log', count: 2 }, { name: 'dirt', count: 14 }]);
    assert.deepEqual([room.contents('0,64,0'), room.contents('2,64,0')], aliceBefore);
    assert.match(result.text, /\nLeft alone within 8 blocks:\n- 2 chests of Alice's, sorted only when asked$/);
});

test('items never move between the chests of different owners, in random rooms', async () => {
    let seed = 7;
    const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const kinds = ['dirt', 'oak_log', 'stone', 'iron_ingot', 'bread', 'bone'];
    for (let round = 0; round < 40; round++) {
        const owners = ['Alice', 'Bob', 'me', 'shared'];
        const chests = {}, whose = {};
        for (let i = 0; i < 2 + random(5); i++) {
            const id = `${i * 2},64,0`;
            chests[id] = row(27, Array.from({ length: 27 }, () => (random(3) ? `${kinds[random(kinds.length)]} x${1 + random(40)}` : null)));
            whose[id] = owners[random(owners.length)];
        }
        const { bot, room } = fakeChestBot({ chests });
        const book = createChestBook({ scope: 'test' });
        for (const [id, owner] of Object.entries(whose)) book.mark(found(id), { owner, sorting: 'always' });
        const totalsOf = owner => {
            const sum = {};
            for (const [id, o] of Object.entries(whose)) if (o === owner) for (const st of stacks(room, id)) sum[st.name] = (sum[st.name] ?? 0) + st.count;
            return sum;
        };
        const before = Object.fromEntries(owners.map(owner => [owner, totalsOf(owner)]));
        const result = await sortChestsHere(bot, 'approved', 8, deps(room, { book }));
        assert.equal(result.status, 'ok', `round ${round}: ${result.text}`);
        for (const owner of owners) assert.deepEqual(totalsOf(owner), before[owner], `round ${round}: ${owner}'s items stayed in ${owner}'s chests`);
    }
});

test('only chests in view are sorted: one of the player\'s behind a wall is left as it is', async () => {
    const { bot, room, book } = sharedRoom();
    const before = room.contents('2,64,0');
    const result = await sortChestsHere(bot, 'Alice', 8, deps(room, { book, hidden: ['2,64,0', '4,64,0'] }));
    assert.equal(result.status, 'ok');
    assert.deepEqual(stacks(room, '0,64,0'), [{ name: 'oak_log', count: 3 }, { name: 'dirt', count: 20 }]);
    assert.deepEqual(room.contents('2,64,0'), before);
    assert.deepEqual(room.opens.filter(id => id !== '0,64,0'), []);
    assert.match(result.text, /- 1 more Alice's is nearby but out of sight from here\./);
    assert.doesNotMatch(result.text, /2, 64, 0/, 'it is not pointed to, so nobody is sent looking for it');
    assert.doesNotMatch(result.text, /Bob/);
});

test('one chest asked for by where it is, is sorted by itself, whoever\'s it is', async () => {
    const { bot, room, book } = sharedRoom();
    const result = await sortChestAt(bot, { x: 6, y: 64, z: 0 }, deps(room, { book, hidden: ['6,64,0'] }));
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Sorted 1 chest in \d+ moves?: 2 stacks are now 1\.\n- chest at 6, 64, 0: stone/);
    assert.deepEqual(room.opens.filter(id => id !== '6,64,0'), []);

    book.mark(found('4,64,0'), { sorting: 'never' });
    const never = await sortChestAt(bot, { x: 4, y: 64, z: 0 }, deps(room, { book }));
    assert.equal(never.status, 'failed');
    assert.match(never.text, /marked never sort, so it was left as it is/);
    const missing = await sortChestAt(bot, { x: 99, y: 64, z: 0 }, deps(room, { book }));
    assert.match(missing.text, /don't know of a chest or barrel at 99, 64, 0/);
});

test('when the bot knows nobody asked, it leaves other people\'s chests alone and says why', async () => {
    const { bot, room, book } = sharedRoom();
    const result = await sortChestsHere(bot, 'Alice', 8, deps(room, { book, asked: false }));
    assert.equal(result.status, 'failed');
    assert.match(result.text, /- 2 chests of Alice's: nobody asked for these to be sorted\./);
    assert.match((await sortChestAt(bot, { x: 4, y: 64, z: 0 }, deps(room, { book, asked: false }))).text, /Nobody asked for the chest at 4, 64, 0 to be sorted/);
    assert.equal(room.opens.length, 0);
});

test('a chest that would not open makes the result partial, and none opening makes it a failure', async () => {
    const { bot, room, book } = sharedRoom();
    room.blocked.add('2,64,0');
    const partial = await sortChestsHere(bot, 'Alice', 8, deps(room, { book }));
    assert.equal(partial.status, 'partial');
    assert.match(partial.text, /chest at 2, 64, 0 was left out/);
    room.blocked.add('0,64,0');
    assert.equal((await sortChestsHere(bot, 'Alice', 8, deps(room, { book }))).status, 'failed');
});

test('a player says whose a chest is and how it may be sorted; the latest word wins', () => {
    const { bot, room, book } = sharedRoom();
    bot.players = { Alice: {}, Bob: {} };
    const d = deps(room, { book, by: 'Bob' });
    const first = markChest(bot, { x: 6, y: 64, z: 0 }, 'bob', 'same', d);
    assert.equal(first.status, 'ok');
    assert.equal(first.text, "The chest at 6, 64, 0 is now Bob's, sorted only when asked. It was owner unknown, sorted only when asked.");
    assert.equal(book.of(found('6,64,0')).said[0].by, 'Bob');
    assert.match(markChest(bot, { x: 6, y: 64, z: 0 }, 'Alice', 'always', d).text, /is now Alice's, may always be sorted\. It was Bob's, sorted only when asked\.$/);
    assert.match(markChest(bot, { x: 6, y: 64, z: 0 }, 'same', 'always', d).text, /was already Alice's, may always be sorted\. Nothing changed\./);
    assert.match(markChest(bot, { x: 6, y: 64, z: 0 }, 'Sorter', 'same', d).text, /is now your own, may always be sorted/);
    // A name nobody has heard of is taken, since an owner may be offline, but pointed out.
    assert.match(markChest(bot, { x: 6, y: 64, z: 0 }, 'Alcie', 'same', d).text, /Nobody called "Alcie" is online or owns another chest you know of: check the name\.$/);
    for (const [owner, sorting, problem] of [['mine', 'same', /could be you or the player/], ['Alice', 'often', /"always", "asked" or "never"/], ['same', 'same', /Nothing to change/]]) {
        const refused = markChest(bot, { x: 6, y: 64, z: 0 }, owner, sorting, d);
        assert.equal(refused.status, 'failed');
        assert.match(refused.text, problem);
    }
    assert.match(markChest(bot, { x: 99, y: 64, z: 0 }, 'Alice', 'same', d).text, /don't know of a chest or barrel at 99, 64, 0/);
});

test('"these are all mine": every chest in view with no owner yet is marked, and no known owner is overwritten', () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27), '2,64,0': row(27), '4,64,0': row(27), '6,64,0': row(27) } });
    bot.players = { Alice: {} };
    const book = createChestBook({ scope: 'test' });
    book.mark(found('4,64,0'), { owner: 'Bob' });
    const d = deps(room, { book, hidden: ['6,64,0'] });
    const result = markChests(bot, 'unknown', 8, 'Alice', 'same', d);
    assert.equal(result.status, 'ok');
    assert.equal(result.text, "Marked 2 chests as Alice's, sorted only when asked: 0, 64, 0; 2, 64, 0. 1 more is out of sight from here and was not marked.");
    assert.equal(book.ownerOf(found('4,64,0')), 'Bob');
    assert.equal(book.ownerOf(found('6,64,0')), null);
    // "Keep my chests tidy": the ones that are hers now, by owner.
    assert.match(markChests(bot, 'Alice', 8, 'same', 'always', d).text, /^Marked 2 chests as Alice's, may always be sorted/);
    assert.equal(book.sortingOf(found('4,64,0')), 'asked');
    const none = markChests(bot, 'unknown', 8, 'Alice', 'same', d);
    assert.equal(none.status, 'failed');
    assert.match(none.text, /^You see no chest with no known owner within 8 blocks\. 1 more is out of sight/);
});

test('the list of chests says whose each is, how it may be sorted, and which are out of sight', () => {
    const { bot, room, book } = sharedRoom();
    book.mark(found('2,64,0'), { sorting: 'always' });
    book.mark(found('6,64,0'), { owner: 'me', madeBy: 'me' });
    book.sorted(found('0,64,0'));
    const text = chestsText(bot, 16, deps(room, { book, hidden: ['4,64,0'], now: () => Date.now() + 2 * 86_400_000, signNear: (b, c) => (c.id === '4,64,0' ? 'Bob  keep out' : null) }));
    assert.equal(text, [
        'CHESTS YOU KNOW WITHIN 16 BLOCKS (nearest first)',
        "- chest at 0, 64, 0: Alice's. Sorted only when asked. Last sorted 2 days ago",
        "- chest at 2, 64, 0: Alice's. May always be sorted",
        "- chest at 4, 64, 0: Bob's. Sorted only when asked. Out of sight from here. A sign beside it says \"Bob keep out\"",
        '- chest at 6, 64, 0: your own (you placed it). May always be sorted',
    ].join('\n'));
    assert.match(chestsText(bot, 16, { ...deps(room, { book }), nearestBlocks: () => [] }), /don't see or remember a chest/);
});

test('what was said about a chest is forgotten once the bot sees the chest is gone', () => {
    const { bot, room, book } = sharedRoom();
    room.chests.delete('4,64,0');
    // Its spot is out of sight: the bot cannot know, so Bob's chest is still Bob's.
    chestsText(bot, 16, deps(room, { book }));
    assert.equal(book.ownerOf(found('4,64,0')), 'Bob');
    // It looks, and there is only air there.
    chestsText(bot, 16, deps(room, { book, blockAt: (b, pos) => room.blockAt(pos) ?? { name: 'air', position: pos } }));
    assert.equal(book.of(found('4,64,0')), null);
    assert.equal(book.ownerOf(found('0,64,0')), 'Alice');
});

test('chest sorting is listed in MindServer\'s settings with the same default, or an agent made there would lose it', () => {
    const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));
    assert.ok(spec.chest_sorting, 'chest_sorting is missing from settings_spec.json');
    assert.equal(spec.chest_sorting.default, settings.chest_sorting);
    assert.equal(settings.chest_sorting, true);
});

test('the setting turns the chest commands on, and what the bot is told about chests is kept between runs', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']) } });
    const agent = agentIn(room, bot);
    assert.equal(installStorage(agent, { config: { chest_sorting: false } }), null);
    assert.equal(installStorage(agent, { config: {} }), null, 'a config that leaves the key out gets nothing new');
    assert.equal(getCommand('!sortChests'), undefined);

    const bookDir = mkdtempSync(path.join(tmpdir(), 'chest-install-'));
    const config = { chest_sorting: true, host: 'localhost', port: 25565, world_id: 'test' };
    const { book: _, name: __, ...finding } = deps(room);
    const installed = installStorage(agent, { config, deps: finding, bookDir });
    assert.deepEqual(installed.commands, ['!chests', '!markChest', '!markChests', '!sortChest', '!sortChests']);
    for (const name of installed.commands) assert.ok(getCommands().includes(getCommand(name)), name);
    // Sorting takes over from what the bot is doing; listing and marking answer at once.
    assert.deepEqual(installed.commands.map(isAction), [false, false, false, true, true]);
    assert.deepEqual(parseCommandMessage('!sortChests("Alice", 8)'), { commandName: '!sortChests', args: ['Alice', 8] });
    assert.match(parseCommandMessage('!sortChests("Alice", 200)'), /must be an element of/);
    assert.deepEqual(parseCommandMessage('!markChest(0, 64, 0, "Alice", "always")'), { commandName: '!markChest', args: [0, 64, 0, 'Alice', 'always'] });

    // Nothing is approved yet, so nothing is sorted.
    assert.match(await getCommand('!sortChests').perform(agent, 'approved', 8), /Nothing was sorted/);
    assert.match(getCommand('!markChest').perform(agent, 0, 64, 0, 'Alice', 'same'), /is now Alice's/);
    assert.match(getCommand('!chests').perform(agent, 8), /chest at 0, 64, 0: Alice's\. Sorted only when asked/);
    // With world memory on, a sign the bot remembers next to a chest is shown as a hint.
    const asked = [];
    agent.fairPlay = { memory: { things: { within: (min, max, options) => { asked.push({ min, max, options }); return [{ name: 'oak_wall_sign', text: 'Alice' }]; } } } };
    assert.match(getCommand('!chests').perform(agent, 8), /A sign beside it says "Alice"$/);
    assert.deepEqual(asked[0], { min: { x: -1, y: 63, z: -1 }, max: { x: 1, y: 65, z: 1 }, options: { kinds: ['sign'] } });
    assert.equal(installed.book().ownerOf(found('0,64,0')), 'Alice', 'a sign is shown, never taken as the owner');
    agent.fairPlay = null;
    const said = await getCommand('!sortChests').perform(agent, 'Alice', 8);
    assert.match(said, /^Sorted 1 chest \(Alice's\) in \d+ moves: 3 stacks are now 2\./);
    const structured = await getCommand('!sortChest').perform.structured(agent, 0, 64, 0);
    assert.equal(structured.status, 'ok');
    assert.match(structured.text, /already in order/);
    assert.equal(agent.actions.executing, false);

    // It was written down as it happened, in a folder for this server, world and dimension.
    const scope = 'localhost:25565/test/unknown';
    assert.equal(installed.book().scope, scope);
    const kept = loadChestBook(scopeDir(bookDir, scope), { scope });
    assert.equal(kept.ownerOf(found('0,64,0')), 'Alice');
    assert.ok(kept.of(found('0,64,0')).lastSorted);
    // Somewhere else (another dimension) is another book.
    bot.game = { dimension: 'the_nether' };
    assert.equal(installed.book().ownerOf(found('0,64,0')), null);
});
