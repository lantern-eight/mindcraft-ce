// SPDX-License-Identifier: CC0-1.0
// Which chests a request to sort may touch, and why the others are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChestBook } from '../src/agent/storage/chest_book.js';
import { poolsFor } from '../src/agent/storage/permit.js';

const chest = (x, extra = {}) => ({ id: `${x},64,0`, x, y: 64, z: 0, also: null, name: 'chest', ...extra });
const ids = list => list.map(entry => (entry.chest ?? entry).id);

/** A room with chests of Alice's (0, 2), Bob's (4), a shared one (6), the bot's own (8) and one nobody claimed (10). */
function room() {
    const chests = [0, 2, 4, 6, 8, 10].map(x => chest(x));
    const book = createChestBook({ scope: 'test' });
    book.mark(chests[0], { owner: 'Alice' });
    book.mark(chests[1], { owner: 'Alice' });
    book.mark(chests[2], { owner: 'Bob' });
    book.mark(chests[3], { owner: 'shared' });
    book.mark(chests[4], { owner: 'me' });
    return { chests, book };
}
const why = (result, id) => result.left.find(entry => entry.chest.id === id)?.why;

test('asked for one player\'s chests: theirs are one pool, and every other chest is left alone with the reason', () => {
    const { chests, book } = room();
    const result = poolsFor(chests, book, { whose: 'alice' });
    assert.equal(result.pools.length, 1);
    assert.equal(result.pools[0].owner, 'Alice');
    assert.deepEqual(ids(result.pools[0].chests), ['0,64,0', '2,64,0']);
    assert.equal(why(result, '4,64,0'), 'other');
    assert.equal(result.left.find(entry => entry.chest.id === '4,64,0').owner, 'Bob');
    assert.equal(why(result, '6,64,0'), 'other');
    assert.equal(why(result, '8,64,0'), 'other');
    assert.equal(why(result, '10,64,0'), 'unknown');
    assert.equal(result.left.length, 4);
    assert.equal(result.hidden, 0);
});

test('shared chests and the bot\'s own are pools of their own', () => {
    const { chests, book } = room();
    assert.deepEqual(ids(poolsFor(chests, book, { whose: 'shared' }).pools[0].chests), ['6,64,0']);
    assert.deepEqual(ids(poolsFor(chests, book, { whose: 'me' }).pools[0].chests), ['8,64,0']);
    // Somebody with no chest here: nothing to sort, and the room is still accounted for.
    const nobody = poolsFor(chests, book, { whose: 'Dave' });
    assert.deepEqual(nobody.pools, []);
    assert.equal(nobody.left.length, 6);
});

test('"approved" takes every chest marked always, each owner\'s as a separate pool, and nothing else', () => {
    const { chests, book } = room();
    book.mark(chests[0], { sorting: 'always' });
    book.mark(chests[2], { sorting: 'always' });
    book.mark(chests[5], { sorting: 'always' });     // nobody's, but someone said it may always be sorted
    const result = poolsFor(chests, book, { whose: 'approved' });
    assert.deepEqual(result.pools.map(pool => [pool.owner, ids(pool.chests)]), [
        ['me', ['8,64,0']],
        ['Alice', ['0,64,0']],
        ['Bob', ['4,64,0']],
        [null, ['10,64,0']],
    ]);
    assert.equal(why(result, '2,64,0'), 'not_always');
    assert.equal(why(result, '6,64,0'), 'not_always');
    // Items never move between owners: no chest is in two pools, and no pool has two owners.
    const seen = result.pools.flatMap(pool => ids(pool.chests));
    assert.equal(new Set(seen).size, seen.length);
});

test('two chests nobody owns are never sorted together, even when both may always be sorted', () => {
    const chests = [chest(0), chest(2)];
    const book = createChestBook({ scope: 'test' });
    book.mark(chests[0], { sorting: 'always' });
    book.mark(chests[1], { sorting: 'always' });
    const result = poolsFor(chests, book, { whose: 'approved' });
    assert.deepEqual(result.pools.map(pool => ids(pool.chests)), [['0,64,0'], ['2,64,0']], 'they may be two different people\'s');
});

test('a chest marked never is left out of every pool and named', () => {
    const { chests, book } = room();
    book.mark(chests[1], { sorting: 'never' });
    book.mark(chests[4], { sorting: 'never' });
    const alice = poolsFor(chests, book, { whose: 'Alice' });
    assert.deepEqual(ids(alice.pools[0].chests), ['0,64,0']);
    assert.equal(why(alice, '2,64,0'), 'never');
    assert.deepEqual(poolsFor(chests, book, { whose: 'me' }).pools, []);
    assert.equal(why(poolsFor(chests, book, { whose: 'approved' }), '8,64,0'), 'never');
    // Asking for that very chest does not lift the mark either.
    const one = poolsFor(chests, book, { chest: { x: 2, y: 64, z: 0 } });
    assert.deepEqual(one.pools, []);
    assert.equal(why(one, '2,64,0'), 'never');
});

test('one chest asked for by where it is: a pool of one, whoever\'s it is', () => {
    const { chests, book } = room();
    const unknown = poolsFor(chests, book, { chest: { x: 10, y: 64, z: 0 } });
    assert.deepEqual(unknown.pools.map(pool => [pool.owner, ids(pool.chests)]), [[null, ['10,64,0']]]);
    assert.deepEqual(unknown.left, [], 'the rest of the room is not this request\'s business');
    assert.equal(poolsFor(chests, book, { chest: { x: 4, y: 64, z: 0 } }).pools[0].owner, 'Bob');
    // Either half of a double chest names it.
    const double = chest(20, { also: { x: 20, y: 64, z: 1 } });
    assert.deepEqual(ids(poolsFor([double], book, { chest: { x: 20, y: 64, z: 1 } }).pools[0].chests), ['20,64,0']);
    // A spot with no chest the bot knows of.
    const none = poolsFor(chests, book, { chest: { x: 99, y: 64, z: 0 } });
    assert.equal(none.missing, true);
    assert.deepEqual(none.pools, []);
});

test('only chests in view are sorted; the owner\'s others nearby are counted, not touched', () => {
    const { chests, book } = room();
    const seen = chests.map(c => ({ ...c, inView: c.x !== 2 && c.x !== 4 }));      // one of Alice's and Bob's are behind a wall
    const result = poolsFor(seen, book, { whose: 'Alice' });
    assert.deepEqual(ids(result.pools[0].chests), ['0,64,0']);
    assert.equal(result.hidden, 1);
    assert.equal(why(result, '2,64,0'), undefined, 'a chest out of sight is not listed, so nobody is sent looking for it');
    assert.equal(why(result, '4,64,0'), undefined);
    assert.equal(result.left.length, 3);

    // "approved" counts the always-sort chests it could not see.
    book.mark(chests[2], { sorting: 'always' });
    const approved = poolsFor(seen, book, { whose: 'approved' });
    assert.deepEqual(approved.pools.map(pool => pool.owner), ['me']);
    assert.equal(approved.hidden, 1);

    // One chest asked for by where it is need not be in view: someone pointed at it on purpose.
    assert.deepEqual(ids(poolsFor(seen, book, { chest: { x: 2, y: 64, z: 0 } }).pools[0].chests), ['2,64,0']);
});

test('when the bot knows nobody asked, it sorts only chests that may always be sorted', () => {
    const { chests, book } = room();
    book.mark(chests[0], { sorting: 'always' });
    const alice = poolsFor(chests, book, { whose: 'Alice', asked: false });
    assert.deepEqual(ids(alice.pools[0].chests), ['0,64,0']);
    assert.equal(why(alice, '2,64,0'), 'not_asked');
    const one = poolsFor(chests, book, { chest: { x: 4, y: 64, z: 0 }, asked: false });
    assert.deepEqual(one.pools, []);
    assert.equal(why(one, '4,64,0'), 'not_asked');
    // Its own chests, and "approved", need nobody to ask.
    assert.equal(poolsFor(chests, book, { whose: 'me', asked: false }).pools.length, 1);
    assert.equal(poolsFor(chests, book, { whose: 'approved', asked: false }).pools.length, 2);
    // When it cannot tell whether anyone asked, it does not refuse on a guess.
    assert.deepEqual(ids(poolsFor(chests, book, { whose: 'Alice', asked: null }).pools[0].chests), ['0,64,0', '2,64,0']);
    assert.deepEqual(ids(poolsFor(chests, book, { whose: 'Alice' }).pools[0].chests), ['0,64,0', '2,64,0']);
});

test('no chests at all gives no pools and nothing left', () => {
    const book = createChestBook({ scope: 'test' });
    assert.deepEqual(poolsFor([], book, { whose: 'approved' }), { pools: [], left: [], hidden: 0 });
    assert.throws(() => poolsFor([], book, {}), /whose|chest/);
});
