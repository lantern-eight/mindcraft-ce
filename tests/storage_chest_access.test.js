// SPDX-License-Identifier: CC0-1.0
// Looking in, taking from and putting into one chest, named by where it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChestBook } from '../src/agent/storage/chest_book.js';
import { putInChestAt, takeFromChestAt, viewChestAt } from '../src/agent/storage/commands.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
const found = id => ({ id, ...posOf(id), also: null, name: 'chest' });
const show = slots => slots.filter(Boolean).map(s => `${s.name} x${s.count}`);
/** How the commands find and reach chests in a fake room, with a chest book. */
const deps = (room, { book = createChestBook({ scope: 'test' }), ...rest } = {}) => ({
    nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
    blockAt: (bot, pos) => room.blockAt(pos),
    goTo: async (bot, chest) => room.goTo(chest),
    inView: () => true,
    hands: { pauseMs: 0, settleMs: 0 },
    book, name: 'Sorter',
    ...rest,
});
const AT = { x: 0, y: 64, z: 0 };

test('looking in a chest says what it holds, added up by kind, and whose it is', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x40', null, 'cobblestone x64', 'oak_log x30', 'cobblestone x11']), '2,64,0': row(27) } });
    const book = createChestBook({ scope: 'test' });
    book.mark(found('0,64,0'), { owner: 'Alice' });
    const result = await viewChestAt(bot, AT, deps(room, { book }));
    assert.equal(result.status, 'ok');
    assert.equal(result.text, 'The chest at 0, 64, 0, which is Alice\'s, holds (4 of 27 slots used):\n- oak_log 70\n- cobblestone 75');
    assert.equal(bot.currentWindow, null, 'the chest is closed again');
    assert.deepEqual(room.opens, ['0,64,0']);

    const empty = await viewChestAt(bot, { x: 2, y: 64, z: 0 }, deps(room, { book }));
    assert.equal(empty.text, 'The chest at 2, 64, 0, which has no known owner, is empty.');
    book.mark(found('2,64,0'), { owner: 'me' });
    assert.match((await viewChestAt(bot, { x: 2, y: 64, z: 0 }, deps(room, { book }))).text, /which is your own, is empty/);
    book.mark(found('2,64,0'), { owner: 'shared' });
    assert.match((await viewChestAt(bot, { x: 2, y: 64, z: 0 }, deps(room, { book }))).text, /which is shared, is empty/);
});

test('either half of a double chest names it', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(54, ['bread x5']) } });
    room.halves.set('0,64,1', '0,64,0');
    const blockAt = (b, pos) => {
        const block = room.blockAt(pos);
        // Facing west, the half marked "left" is the southern one.
        return block && { ...block, getProperties: () => ({ facing: 'west', type: pos.z === 1 ? 'left' : 'right' }) };
    };
    const result = await viewChestAt(bot, { x: 0, y: 64, z: 1 }, deps(room, { blockAt }));
    assert.match(result.text, /^The double chest at 0, 64, 0, which has no known owner, holds \(1 of 54 slots used\):\n- bread 5$/);
});

test('a spot with no chest the bot knows of, and a chest that will not open, are said plainly', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['bread x5']) } });
    for (const command of [viewChestAt, (...args) => takeFromChestAt(args[0], args[1], 'bread', 1, args[2])]) {
        const missing = await command(bot, { x: 9, y: 64, z: 9 }, deps(room));
        assert.equal(missing.status, 'failed');
        assert.match(missing.text, /^You don't know of a chest or barrel at 9, 64, 9\. Use !chests/);
    }
    room.blocked.add('0,64,0');
    const shut = await viewChestAt(bot, AT, deps(room));
    assert.equal(shut.status, 'failed');
    assert.match(shut.text, /^Could not open the chest at 0, 64, 0: /);
    assert.deepEqual(room.walks, ['0,64,0'], 'it walked up to it before giving up');
});

test('taking gathers the item from every slot that holds it, and no more than was asked for', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x40', 'cobblestone x64', 'oak_log x30']) }, pockets: ['oak_log x10'] });
    const book = createChestBook({ scope: 'test' });
    book.mark(found('0,64,0'), { owner: 'Alice' });
    const result = await takeFromChestAt(bot, AT, 'oak_log', 50, deps(room, { book }));
    assert.equal(result.status, 'ok');
    assert.equal(result.text, 'Took 50 oak_log from the chest at 0, 64, 0, which is Alice\'s.');
    assert.deepEqual(show(room.contents('0,64,0')), ['cobblestone x64', 'oak_log x20']);
    assert.deepEqual(show(room.pockets), ['oak_log x60'], 'onto the stack the bot already had');
    assert.equal(bot.currentWindow, null);
});

test('asking for more than there is takes all of it and says so; asking for what is not there takes nothing', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x12', 'bread x3']) } });
    const all = await takeFromChestAt(bot, AT, 'oak_log', 999, deps(room));
    assert.equal(all.status, 'ok');
    assert.equal(all.text, 'Took 12 oak_log from the chest at 0, 64, 0, which has no known owner. That was all of it.');
    const none = await takeFromChestAt(bot, AT, 'oak_log', 5, deps(room));
    assert.equal(none.status, 'failed');
    assert.equal(none.text, 'There is no oak_log in the chest at 0, 64, 0, which has no known owner. It holds: bread 3.');
    assert.deepEqual(show(room.pockets), ['oak_log x12']);
});

test('with no room left in its inventory the bot takes what fits, and says how much that was', async () => {
    // Every slot of its own is taken but one part stack of logs with room for four more.
    const pockets = Array.from({ length: 36 }, (_, i) => (i === 0 ? 'oak_log x60' : 'dirt x64'));
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x40']) }, pockets });
    const some = await takeFromChestAt(bot, AT, 'oak_log', 30, deps(room));
    assert.equal(some.status, 'partial');
    assert.equal(some.text, 'Took 4 of the 30 oak_log asked for from the chest at 0, 64, 0, which has no known owner: your inventory has no room for more.');
    assert.deepEqual(show(room.contents('0,64,0')), ['oak_log x36']);
    const none = await takeFromChestAt(bot, AT, 'oak_log', 30, deps(room));
    assert.equal(none.status, 'failed');
    assert.match(none.text, /^Could not take any oak_log from the chest at 0, 64, 0: your inventory has no room for it\./);
    assert.deepEqual(room.totals(), { oak_log: 100, dirt: 35 * 64 }, 'nothing gained or lost');
});

test('putting moves the item from the bot\'s inventory into the chest, from every stack it carries', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x60']) }, pockets: ['oak_log x10', 'bread x2', 'oak_log x20'] });
    const book = createChestBook({ scope: 'test' });
    book.mark(found('0,64,0'), { owner: 'shared' });
    const result = await putInChestAt(bot, AT, 'oak_log', 25, deps(room, { book }));
    assert.equal(result.status, 'ok');
    assert.equal(result.text, 'Put 25 oak_log in the chest at 0, 64, 0, which is shared.');
    assert.deepEqual(show(room.contents('0,64,0')), ['oak_log x64', 'oak_log x21']);
    assert.deepEqual(show(room.pockets), ['bread x2', 'oak_log x5']);

    const rest = await putInChestAt(bot, AT, 'oak_log', 999, deps(room, { book }));
    assert.equal(rest.text, 'Put 5 oak_log in the chest at 0, 64, 0, which is shared. That was all you had.');
});

test('the bot does not walk to a chest to put in something it does not have', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27) }, pockets: ['bread x2'] });
    const result = await putInChestAt(bot, AT, 'oak_log', 5, deps(room));
    assert.equal(result.status, 'failed');
    assert.equal(result.text, 'You have no oak_log to put in a chest.');
    assert.deepEqual(room.opens, []);
});

test('a chest with no room takes what fits, and the rest stays with the bot', async () => {
    const full = row(27).map((_, i) => (i === 0 ? 'oak_log x60' : 'dirt x64'));
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': full }, pockets: ['oak_log x30'] });
    const some = await putInChestAt(bot, AT, 'oak_log', 30, deps(room));
    assert.equal(some.status, 'partial');
    assert.equal(some.text, 'Put 4 of the 30 oak_log asked for in the chest at 0, 64, 0, which has no known owner: it has no room for more.');
    assert.deepEqual(show(room.pockets), ['oak_log x26']);
    const none = await putInChestAt(bot, AT, 'oak_log', 30, deps(room));
    assert.equal(none.status, 'failed');
    assert.match(none.text, /^Could not put any oak_log in the chest at 0, 64, 0: it has no room for it\./);
});

test('what moved is counted from what the server says is in the chest, not from the bot\'s guess', async () => {
    // The bot's item data says 64 logs fit in a slot; this server allows 16. Its guess of what the
    // "take" did is then wrong, and only asking the server again gives the true count.
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['oak_log x16', 'oak_log x16']) }, pockets: Array.from({ length: 36 }, (_, i) => (i === 0 ? 'oak_log x10' : 'dirt x64')),
        serverSizes: { oak_log: 16 } });
    const result = await takeFromChestAt(bot, AT, 'oak_log', 20, deps(room));
    assert.equal(result.status, 'partial');
    assert.match(result.text, /^Took 6 of the 20 oak_log asked for /);
    assert.equal(room.totals().oak_log, 42);
});

test('an older copy of the window still on its way is not taken for the server\'s answer', async () => {
    // What a real server did: after the clicks of a take, the bot asked what was there and the first
    // copy to arrive was one sent in the middle of them, with the rest of the stack still on the
    // cursor and its slot empty. Tidying that "stack on the cursor" away picked the real stack up.
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['stone x3', 'sand x30']) } });
    room.lateCopy = server => ({ slots: server.slots.map((s, i) => (i === 1 ? null : s)), cursor: { name: 'sand', count: 20 } });
    const result = await takeFromChestAt(bot, AT, 'sand', 10, { ...deps(room), hands: { pauseMs: 0, settleMs: 20 } });
    assert.equal(result.text, 'Took 10 sand from the chest at 0, 64, 0, which has no known owner.');
    assert.deepEqual(show(room.contents('0,64,0')), ['stone x3', 'sand x20']);
    assert.deepEqual(show(room.pockets), ['sand x10']);
    assert.equal(room.lateCopy, null, 'the late copy did arrive');
});
