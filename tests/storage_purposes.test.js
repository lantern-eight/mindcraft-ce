// SPDX-License-Identifier: CC0-1.0
// What a chest is for: a player's words and a sign's text read into groups, items or the inbox; a player's
// word before a sign; and how well a chest suits an item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPurpose, purposeOf, fitFor, purposeText, isInbox, INBOX } from '../src/agent/storage/purposes.js';
import { createChestBook } from '../src/agent/storage/chest_book.js';
import { groupOf } from '../src/agent/storage/item_groups.js';

const ITEMS = new Set(['iron_ingot', 'gold_ingot', 'cobblestone', 'oak_log', 'diamond', 'torch', 'stone']);
const isItem = name => ITEMS.has(name);

test('a player\'s words: groups, plain words for them, items, several at once', () => {
    assert.deepEqual(readPurpose('tools', { isItem }), { holds: ['tools'], unknown: [] });
    assert.deepEqual(readPurpose('Ores', { isItem }).holds, ['minerals']);
    assert.deepEqual(readPurpose('weapons and armor', { isItem }).holds, ['combat']);
    assert.deepEqual(readPurpose('iron_ingot, gold_ingot', { isItem }).holds, ['iron_ingot', 'gold_ingot']);
    assert.deepEqual(readPurpose('mob drops', { isItem }).holds, ['mob_drops']);
    assert.deepEqual(readPurpose('wood, sandcastles', { isItem }), { holds: ['wood'], unknown: ['sandcastles'] });
});

test('a sign\'s text: lines and plurals as a player writes them; a metal by name is its ingot', () => {
    assert.deepEqual(readPurpose('Iron ingots / Gold', { isItem }).holds, ['iron_ingot', 'gold_ingot']);
    assert.deepEqual(readPurpose('Building blocks', { isItem }).holds, ['building']);
    assert.deepEqual(readPurpose('Diamonds', { isItem }).holds, ['diamond']);
    assert.deepEqual(readPurpose('Torches', { isItem }).holds, ['torch']);
    assert.deepEqual(readPurpose("Alice's tools", { isItem }).holds, ['tools'], 'a known word in a longer line');
    assert.deepEqual(readPurpose("Alice's", { isItem }).holds, [], 'a name alone says nothing about what goes in');
    assert.deepEqual(readPurpose('Stone', { isItem }).holds, ['stone'], 'a group\'s word before an item of the same name');
});

test('the inbox comes alone: a chest that is the inbox is for nothing else', () => {
    assert.deepEqual(readPurpose('Inbox', { isItem }).holds, [INBOX]);
    assert.deepEqual(readPurpose('Drop off / tools', { isItem }).holds, [INBOX]);
    assert.equal(isInbox([INBOX]), true);
    assert.equal(isInbox(['tools']), false);
});

test('a player\'s word comes before a sign; "anything" overrides a sign too; forgetting the word brings the sign back', () => {
    const book = createChestBook({ scope: 's', now: () => 1 });
    const chest = { x: 1, y: 64, z: 1, name: 'chest' };
    const signText = () => 'Ores';
    assert.deepEqual(purposeOf(chest, { book, signText, isItem }), { holds: ['minerals'], from: 'sign' });
    book.mark(chest, { holds: ['tools'], by: 'Alice' });
    assert.deepEqual(purposeOf(chest, { book, signText, isItem }), { holds: ['tools'], from: 'said' });
    book.mark(chest, { holds: [], by: 'Alice' });
    assert.deepEqual(purposeOf(chest, { book, signText, isItem }), { holds: [], from: 'said' }, 'for anything');
    book.mark(chest, { holds: null, by: 'Alice' });
    assert.deepEqual(purposeOf(chest, { book, signText, isItem }), { holds: ['minerals'], from: 'sign' });
    assert.deepEqual(purposeOf(chest, { book, signText: () => "Alice's", isItem }), { holds: [], from: null }, 'a sign that names nothing is no label');
});

test('the book keeps what a chest is for, remembers who said it, and a chest with only that to say is kept', () => {
    const book = createChestBook({ scope: 's', now: () => 7 });
    const chest = { x: 1, y: 64, z: 1, name: 'chest' };
    const { changed } = book.mark(chest, { holds: ['wood', 'wood'], by: 'Bob' });
    assert.equal(changed, true);
    assert.deepEqual(book.holdsOf(chest), ['wood']);
    assert.deepEqual(book.of(chest).said, [{ at: 7, by: 'Bob', holds: ['wood'] }]);
    assert.equal(book.mark(chest, { holds: ['wood'], by: 'Bob' }).changed, false, 'the same word again changes nothing');
    assert.equal(book.ownerOf(chest), null, 'saying what a chest is for says nothing about whose it is');
    const again = createChestBook({ scope: 's' });
    again._restore(JSON.parse(JSON.stringify(book.toJSON())));
    assert.deepEqual(again.holdsOf(chest), ['wood'], 'kept across a save');
    book.mark(chest, { holds: null });
    assert.equal(book.of(chest), null, 'forgotten, with nothing else said, the chest has no entry');
});

test('how well a chest suits an item: for it, for its group, for anything, or for something else', () => {
    assert.equal(fitFor(['iron_ingot'], 'iron_ingot', groupOf), 2);
    assert.equal(fitFor(['minerals'], 'iron_ingot', groupOf), 1);
    assert.equal(fitFor([], 'iron_ingot', groupOf), 0);
    assert.equal(fitFor(undefined, 'iron_ingot', groupOf), 0);
    assert.equal(fitFor(['tools'], 'iron_ingot', groupOf), -1);
    assert.equal(fitFor([INBOX], 'iron_ingot', groupOf), -1, 'nothing is put away into the inbox');
    assert.equal(purposeText(['tools', 'iron_ingot']), 'tools and iron ingot');
    assert.equal(purposeText([]), 'anything');
    assert.equal(purposeText([INBOX]), 'the inbox');
});
