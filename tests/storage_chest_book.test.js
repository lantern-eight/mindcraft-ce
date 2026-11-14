// SPDX-License-Identifier: CC0-1.0
// The chest book: whose each chest is, and whether the bot may sort it without being asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChestBook, defaultSorting, loadChestBook, sameOwner } from '../src/agent/storage/chest_book.js';

const SCOPE = 'localhost:25565/test/overworld';
const chest = (x, y, z, extra = {}) => ({ id: `${x},${y},${z}`, x, y, z, also: null, name: 'chest', ...extra });
const clock = (start = 1000) => { let t = start; const now = () => t; now.tick = (ms = 1000) => { t += ms; }; return now; };

test('a chest nobody has spoken about has no entry: owner unknown, sorted only when asked', () => {
    const book = createChestBook({ scope: SCOPE });
    assert.equal(book.size, 0);
    assert.equal(book.of(chest(1, 64, 1)), null);
    assert.equal(book.ownerOf(chest(1, 64, 1)), null);
    assert.equal(book.sortingOf(chest(1, 64, 1)), 'asked');
    assert.throws(() => createChestBook(), /scope/);
});

test('marking a chest records whose it is; the bot\'s own chests may always be sorted, anyone else\'s only when asked', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(1, 64, 1), { owner: 'Alice' });
    book.mark(chest(3, 64, 1), { owner: 'shared' });
    book.mark(chest(5, 64, 1), { owner: 'me' });
    assert.equal(book.ownerOf(chest(1, 64, 1)), 'Alice');
    assert.equal(book.sortingOf(chest(1, 64, 1)), 'asked');
    assert.equal(book.sortingOf(chest(3, 64, 1)), 'asked', 'a shared chest belongs to people who did not ask, too');
    assert.equal(book.sortingOf(chest(5, 64, 1)), 'always');
    assert.equal(defaultSorting('me'), 'always');
    assert.equal(defaultSorting('Alice'), 'asked');
    assert.equal(defaultSorting(null), 'asked');
    assert.equal(book.size, 3);
    assert.equal(book.dirty, true);
});

test('permission is kept per chest, and one that is only the default is not written down', () => {
    const book = createChestBook({ scope: SCOPE });
    const c = chest(1, 64, 1);
    book.mark(c, { owner: 'Alice', sorting: 'always' });
    assert.equal(book.sortingOf(c), 'always');
    book.mark(c, { sorting: 'never' });
    assert.equal(book.sortingOf(c), 'never');
    assert.equal(book.ownerOf(c), 'Alice', 'saying how it may be sorted does not change whose it is');
    book.mark(c, { sorting: 'asked' });
    assert.equal(book.of(c).sorting, undefined);
    assert.throws(() => book.mark(c, { sorting: 'sometimes' }), /always, asked or never/);

    // A chest with no known owner can still be marked.
    const stray = chest(9, 64, 1);
    book.mark(stray, { sorting: 'never' });
    assert.equal(book.ownerOf(stray), null);
    assert.equal(book.sortingOf(stray), 'never');
});

test('the latest word on whose a chest is wins, and the book remembers who said what', () => {
    const now = clock();
    const book = createChestBook({ scope: SCOPE, now });
    const c = chest(1, 64, 1);
    book.mark(c, { owner: 'Alice', by: 'Alice' });
    now.tick();
    const result = book.mark(c, { owner: 'Bob', by: 'Carol' });
    assert.equal(book.ownerOf(c), 'Bob');
    assert.deepEqual(result.was, { owner: 'Alice', sorting: 'asked' });
    assert.equal(result.changed, true);
    assert.deepEqual(book.of(c).said, [
        { at: 1000, by: 'Alice', owner: 'Alice' },
        { at: 2000, by: 'Carol', owner: 'Bob' },
    ]);
    // Saying the same thing again changes nothing and is not written down twice.
    assert.equal(book.mark(c, { owner: 'bob', by: 'Carol' }).changed, false);
    assert.equal(book.of(c).said.length, 2);
    // Only the last few changes are kept.
    for (let i = 0; i < 10; i++) { now.tick(); book.mark(c, { owner: `Player${i}` }); }
    assert.equal(book.of(c).said.length, 5);
    assert.equal(book.of(c).said.at(-1).owner, 'Player9');
});

test('a change of owner sets the permission back, unless the same word gives a new one', () => {
    const book = createChestBook({ scope: SCOPE });
    const c = chest(1, 64, 1);
    book.mark(c, { owner: 'Alice', sorting: 'always' });
    book.mark(c, { owner: 'Bob' });
    assert.equal(book.sortingOf(c), 'asked', '"always" was Alice\'s word, not Bob\'s');
    book.mark(c, { owner: 'Carol', sorting: 'never' });
    assert.equal(book.sortingOf(c), 'never');
    book.mark(c, { owner: 'me' });
    assert.equal(book.sortingOf(c), 'always');
    // Naming the same owner again is not a change of owner.
    book.mark(c, { owner: 'me', sorting: 'never' });
    book.mark(c, { owner: 'me' });
    assert.equal(book.sortingOf(c), 'never');
});

test('names are matched without regard to capitals, and keep the spelling first used', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(1, 64, 1), { owner: 'Alice' });
    book.mark(chest(3, 64, 1), { owner: 'ALICE' });
    assert.equal(book.ownerOf(chest(3, 64, 1)), 'Alice');
    assert.equal(book.spell('alice'), 'Alice');
    assert.equal(book.spell('Dave'), 'Dave');
    assert.deepEqual(book.owners(), ['Alice']);
    assert.equal(sameOwner('Alice', 'alice'), true);
    assert.equal(sameOwner('Alice', null), false);
    assert.equal(sameOwner(null, null), true);
    assert.equal(book.list({ owner: 'alice' }).length, 2);
    assert.equal(book.list().length, 2);
});

test('a double chest is one entry, found by either half', () => {
    const book = createChestBook({ scope: SCOPE });
    const double = chest(4, 70, 0, { also: { x: 4, y: 70, z: 1 } });
    book.mark(double, { owner: 'Alice' });
    assert.equal(book.size, 1);
    assert.equal(book.at(4, 70, 0).owner, 'Alice');
    assert.equal(book.at(4, 70, 1).owner, 'Alice');
    assert.equal(book.ownerOf(chest(4, 70, 1)), 'Alice', 'seen as a single chest from its other half');
});

test('a single chest that became a double one keeps its owner, and so does a double one that lost a half', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(4, 70, 1), { owner: 'Alice' });
    // A second chest is put beside it; the pair is now named for the half that comes first.
    const double = chest(4, 70, 0, { also: { x: 4, y: 70, z: 1 } });
    assert.equal(book.ownerOf(double), 'Alice');
    book.mark(double, { sorting: 'always' });
    assert.equal(book.size, 1);
    assert.deepEqual(book.at(4, 70, 0).also, { x: 4, y: 70, z: 1 });

    // One half is dug away: the other is still Alice's chest.
    assert.equal(book.dropCell(4, 70, 0), true);
    assert.equal(book.size, 1);
    assert.equal(book.at(4, 70, 0), null);
    assert.equal(book.at(4, 70, 1).owner, 'Alice');
    assert.equal(book.at(4, 70, 1).also, null);
    // And the last of it: the entry goes.
    assert.equal(book.dropCell(4, 70, 1), true);
    assert.equal(book.size, 0);
    assert.equal(book.dropCell(4, 70, 1), false);
});

test('a chest that is filed somewhere new is worth saving, even with nothing else to say about it', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(1, 64, 1), { owner: 'Alice' });
    book.save(mkdtempSync(path.join(tmpdir(), 'chest-book-')));
    assert.equal(book.dirty, false);
    assert.equal(book.mark(chest(1, 64, 1), {}).changed, false);
    assert.equal(book.dirty, false, 'found where it was: nothing to save');
    // A second chest was put beside it, and the two are one chest now.
    assert.equal(book.mark(chest(1, 64, 1, { also: { x: 2, y: 64, z: 1 } }), {}).changed, false);
    assert.equal(book.at(2, 64, 1).owner, 'Alice');
    assert.equal(book.dirty, true);
});

test('a different kind of container at the same spot is a new chest', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(1, 64, 1), { owner: 'Alice', sorting: 'always' });
    const barrel = chest(1, 64, 1, { name: 'barrel' });
    assert.equal(book.ownerOf(barrel), null);
    book.mark(barrel, { owner: 'Bob' });
    assert.equal(book.size, 1);
    assert.equal(book.at(1, 64, 1).name, 'barrel');
    assert.equal(book.sortingOf(barrel), 'asked');
});

test('a chest the bot made is remembered as made by it, whoever owns it later', () => {
    const book = createChestBook({ scope: SCOPE });
    const c = chest(1, 64, 1);
    book.mark(c, { owner: 'me', madeBy: 'me' });
    book.mark(c, { owner: 'Alice', by: 'Alice' });
    assert.equal(book.of(c).madeBy, 'me');
    assert.equal(book.ownerOf(c), 'Alice');
    // With the owner taken back to unknown, it still has something to say.
    book.mark(c, { owner: null });
    assert.equal(book.ownerOf(c), null);
    assert.equal(book.of(c).madeBy, 'me');
});

test('an entry with nothing left to say is dropped', () => {
    const book = createChestBook({ scope: SCOPE });
    const c = chest(1, 64, 1);
    book.mark(c, { owner: 'Alice' });
    book.mark(c, { owner: null });
    assert.equal(book.size, 0);
    assert.equal(book.of(c), null);
});

test('when a chest was last sorted, and for whom, is kept', () => {
    const now = clock(5000);
    const book = createChestBook({ scope: SCOPE, now });
    const c = chest(1, 64, 1);
    book.sorted(c, { by: 'Alice' });
    assert.deepEqual(book.of(c).lastSorted, { at: 5000, by: 'Alice' });
    assert.equal(book.ownerOf(c), null, 'sorting a chest for someone does not make it theirs');
});

test('the book is saved per world and comes back the same', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chest-book-'));
    const now = clock();
    const book = createChestBook({ scope: SCOPE, now });
    book.mark(chest(1, 64, 1), { owner: 'Alice', sorting: 'always', by: 'Alice' });
    book.mark(chest(4, 70, 0, { also: { x: 4, y: 70, z: 1 }, name: 'trapped_chest' }), { owner: 'shared' });
    book.mark(chest(9, 64, 1, { name: 'barrel' }), { owner: 'me', madeBy: 'me' });
    const file = book.save(dir);
    assert.equal(existsSync(file), true);
    assert.equal(book.dirty, false);

    const again = loadChestBook(dir, { scope: SCOPE, now });
    assert.deepEqual(again.list(), book.list());
    assert.equal(again.at(4, 70, 1).owner, 'shared');
    assert.equal(again.sortingOf(chest(9, 64, 1, { name: 'barrel' })), 'always');
    assert.equal(again.dirty, false);
    assert.equal(loadChestBook(mkdtempSync(path.join(tmpdir(), 'chest-book-')), { scope: SCOPE }).size, 0, 'no file yet: an empty book');
});

test('a damaged file, or one from another world, is set aside and the book starts empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chest-book-'));
    const book = createChestBook({ scope: SCOPE });
    book.mark(chest(1, 64, 1), { owner: 'Alice' });
    book.save(dir);
    const warnings = [];
    const other = loadChestBook(dir, { scope: 'localhost:25565/other/overworld', warn: message => warnings.push(message) });
    assert.equal(other.size, 0);
    assert.equal(warnings.length, 1);
    assert.ok(readdirSync(dir).some(name => name.includes('.damaged-')), 'the file is kept for a look, not deleted');

    writeFileSync(path.join(dir, 'chests.json'), '{ not json');
    assert.equal(loadChestBook(dir, { scope: SCOPE, warn: () => {} }).size, 0);
});
