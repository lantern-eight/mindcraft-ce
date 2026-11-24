// SPDX-License-Identifier: CC0-1.0
// Which chests putting away and fetching may use, and why the others are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChestBook } from '../src/agent/storage/chest_book.js';
import { ANY, putInto, takeFrom } from '../src/agent/storage/take_put.js';

const chest = x => ({ id: `${x},64,0`, x, y: 64, z: 0, also: null, name: 'chest' });

/** Chests of Alice's (0), Bob's (2), a shared one (4), the bot's own (6) and one nobody claimed (8). */
function room() {
    const chests = [0, 2, 4, 6, 8].map(chest);
    const book = createChestBook({ scope: 'test' });
    book.mark(chests[0], { owner: 'Alice' });
    book.mark(chests[1], { owner: 'Bob' });
    book.mark(chests[2], { owner: 'shared' });
    book.mark(chests[3], { owner: 'me' });
    return { chests, book };
}
const used = result => result.usable.map(({ chest: c, rank }) => `${c.x}:${rank}`);
const why = result => Object.fromEntries(result.left.map(({ chest: c, why: reason }) => [c.x, reason]));

test('taking, when a player asks: own and shared first, then the asker\'s, then other players\'; never an unknown chest', () => {
    const { chests, book } = room();
    const result = takeFrom(chests, book, { asked: true, by: 'alice' });
    assert.deepEqual(used(result), ['0:1', '2:2', '4:0', '6:0']);
    assert.deepEqual(why(result), { 8: 'unknown' });
});

test('taking on the bot\'s own idea: only its own and the shared chests', () => {
    const { chests, book } = room();
    const result = takeFrom(chests, book, { asked: false });
    assert.deepEqual(used(result), ['4:0', '6:0']);
    assert.deepEqual(why(result), { 0: 'not_asked', 2: 'not_asked', 8: 'unknown' });
});

test('taking when nobody can tell who asked: a player is never refused on a guess', () => {
    const { chests, book } = room();
    assert.deepEqual(used(takeFrom(chests, book, {})), ['0:2', '2:2', '4:0', '6:0']);
});

test('putting away by default fills the bot\'s own chests, then the shared ones, and nobody else\'s', () => {
    const { chests, book } = room();
    const result = putInto(chests, book, { whose: ANY, asked: true });
    assert.deepEqual(used(result), ['4:1', '6:0']);
    assert.deepEqual(why(result), { 0: 'other', 2: 'other', 8: 'unknown' });
});

test('putting into one player\'s chests needs a player to ask, and names only theirs', () => {
    const { chests, book } = room();
    assert.deepEqual(used(putInto(chests, book, { whose: 'ALICE', asked: true })), ['0:2']);
    const unasked = putInto(chests, book, { whose: 'Alice', asked: false });
    assert.deepEqual(unasked.usable, []);
    assert.equal(why(unasked)[0], 'not_asked');
});

test('putting into the shared chests alone, or the bot\'s own alone', () => {
    const { chests, book } = room();
    assert.deepEqual(used(putInto(chests, book, { whose: 'shared', asked: false })), ['4:1']);
    assert.deepEqual(used(putInto(chests, book, { whose: 'me', asked: false })), ['6:0']);
});
