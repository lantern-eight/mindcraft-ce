// SPDX-License-Identifier: CC0-1.0
// Chests the bot places or digs up itself: whose a new chest is, and forgetting one it removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createChestBook } from '../src/agent/storage/chest_book.js';
import { chestDug, chestPlaced, watchMadeChests } from '../src/agent/storage/made_chests.js';

const SCOPE = 'localhost:25565/test/overworld';
const OWN_IDEA = { asked: false, by: null }, UNKNOWN = { asked: null, by: null };
const asked = by => ({ asked: true, by });
/** A block as the bot is handed it when it places one. */
const block = (name, x, y, z, state = { facing: 'north', type: 'single' }) => ({ name, position: { x, y, z }, getProperties: () => state });
const found = (x, y, z, extra = {}) => ({ x, y, z, also: null, name: 'chest', ...extra });

test('a chest the bot places on its own idea is its own, and may always be sorted', () => {
    const book = createChestBook({ scope: SCOPE });
    const note = chestPlaced(book, block('chest', 3, 70, 9), OWN_IDEA);
    const entry = book.of(found(3, 70, 9));
    assert.equal(entry.owner, 'me');
    assert.equal(entry.madeBy, 'me');
    assert.equal(book.sortingOf(found(3, 70, 9)), 'always');
    assert.match(note, /^The chest at 3, 70, 9 is noted as your own, because you placed it on your own idea: it may always be sorted\./);
    assert.match(note, /!markChest/, 'and how to say it is for someone else');
});

test('a chest placed while doing what a player asked is that player\'s, sorted only when asked', () => {
    const book = createChestBook({ scope: SCOPE });
    const note = chestPlaced(book, block('barrel', 3, 70, 9, { facing: 'up' }), asked('Alice'));
    const entry = book.of(found(3, 70, 9, { name: 'barrel' }));
    assert.equal(entry.owner, 'Alice');
    assert.equal(entry.madeBy, 'me', 'that the bot made it is a fact, kept whoever owns it');
    assert.equal(entry.said[0].by, 'Alice');
    assert.equal(book.sortingOf(found(3, 70, 9, { name: 'barrel' })), 'asked');
    assert.match(note, /^The barrel at 3, 70, 9 is noted as Alice's, because you placed it while doing what Alice asked: it is sorted only when asked\./);
    assert.match(note, /If Alice meant it for you or for someone else, say so with !markChest/);
});

test('a player\'s name is spelled the way the book already has it', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(found(0, 70, 0), { owner: 'Alice' });
    chestPlaced(book, block('chest', 3, 70, 9), asked('alice'));
    assert.equal(book.ownerOf(found(3, 70, 9)), 'Alice');
    assert.deepEqual(book.owners(), ['Alice']);
});

test('when it cannot tell who is behind it, the chest is the bot\'s making with no owner, and the model is asked', () => {
    const book = createChestBook({ scope: SCOPE });
    const note = chestPlaced(book, block('chest', 3, 70, 9), UNKNOWN);
    const entry = book.of(found(3, 70, 9));
    assert.equal(entry.owner, undefined);
    assert.equal(entry.madeBy, 'me');
    assert.equal(book.sortingOf(found(3, 70, 9)), 'asked', 'not sorted unasked on a guess');
    assert.match(note, /^You placed the chest at 3, 70, 9, and it has no owner yet\. Say whose it is with !markChest/);
});

test('a block that is not a chest to sort is nothing to the book', () => {
    const book = createChestBook({ scope: SCOPE });
    for (const name of ['cobblestone', 'ender_chest', 'furnace', 'hopper']) assert.equal(chestPlaced(book, block(name, 3, 70, 9), OWN_IDEA), null, name);
    assert.equal(chestPlaced(book, null, OWN_IDEA), null);
    assert.equal(book.size, 0);
    assert.equal(book.dirty, false);
});

test('what was said about a chest that used to stand there does not pass to the new one', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(found(3, 70, 9), { owner: 'Bob', sorting: 'never' });    // broken while the bot was away
    chestPlaced(book, block('chest', 3, 70, 9), OWN_IDEA);
    assert.equal(book.ownerOf(found(3, 70, 9)), 'me');
    assert.equal(book.sortingOf(found(3, 70, 9)), 'always');
    assert.equal(book.size, 1);
});

test('a second chest placed beside the bot\'s own makes one double chest, still its own, and says nothing more', () => {
    const book = createChestBook({ scope: SCOPE });
    chestPlaced(book, block('chest', 3, 70, 9), OWN_IDEA);
    // Facing north, the half marked "left" has its partner one block east.
    const note = chestPlaced(book, block('chest', 2, 70, 9, { facing: 'north', type: 'left' }), asked('Alice'));
    assert.equal(note, null);
    assert.equal(book.size, 1);
    const entry = book.of(found(2, 70, 9, { also: { x: 3, y: 70, z: 9 } }));
    assert.equal(entry.owner, 'me', 'the chest it grew from decides, not who is asking now');
    assert.deepEqual([entry.x, entry.also.x], [2, 3], 'filed under both halves');
    assert.equal(book.at(2, 70, 9).owner, 'me');
});

test('a chest placed beside someone\'s chest joins it: the double chest stays theirs', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(found(3, 70, 9), { owner: 'Bob', sorting: 'never' });
    const note = chestPlaced(book, block('chest', 2, 70, 9, { facing: 'north', type: 'left' }), OWN_IDEA);
    const entry = book.at(2, 70, 9);
    assert.equal(entry.owner, 'Bob');
    assert.equal(entry.sorting, 'never');
    assert.equal(entry.madeBy, undefined, 'the bot made only half of it');
    assert.equal(book.size, 1);
    assert.match(note, /^The chest you placed at 2, 70, 9 joined the chest next to it\. The double chest is still Bob's, never sorted\.$/);
});

test('a chest placed beside one nobody has spoken about is not taken as the bot\'s own', () => {
    const book = createChestBook({ scope: SCOPE });
    const note = chestPlaced(book, block('chest', 2, 70, 9, { facing: 'north', type: 'left' }), OWN_IDEA);
    assert.equal(book.size, 0, 'the other half was somebody\'s before the bot came');
    assert.equal(book.dirty, false);
    assert.match(note, /^The chest you placed at 2, 70, 9 joined the chest next to it, which has no known owner\. Ask whose the double chest is, and say so with !markChest/);
});

test('a chest the bot digs up is forgotten; half of a double chest leaves the other half\'s entry', () => {
    const book = createChestBook({ scope: SCOPE });
    book.mark(found(3, 70, 9), { owner: 'Alice' });
    book.mark(found(5, 70, 9, { also: { x: 6, y: 70, z: 9 } }), { owner: 'Bob' });
    assert.equal(chestDug(book, { name: 'air', position: { x: 3, y: 70, z: 9 } }), true);
    assert.equal(book.at(3, 70, 9), null);
    assert.equal(chestDug(book, { name: 'air', position: { x: 5, y: 70, z: 9 } }), true);
    assert.equal(book.at(6, 70, 9).owner, 'Bob');
    assert.equal(book.at(6, 70, 9).also, null);
    assert.equal(chestDug(book, { name: 'air', position: { x: 9, y: 70, z: 9 } }), false, 'stone, say: nothing was filed there');
    assert.equal(chestDug(book, null), false);
});

// ---- On a bot ----

/** A bot that is only its events, with mineflayer's habit of dropping every digging listener when it dies. */
function eventBot() {
    const bot = new EventEmitter();
    bot.on('death', () => bot.removeAllListeners('diggingCompleted'));
    return bot;
}

test('watching a bot: placing a chest is written down, saved, and said in the result of what the bot is doing', () => {
    const bot = eventBot(), book = createChestBook({ scope: SCOPE });
    const said = [];
    let saves = 0, behind = asked('Alice');
    watchMadeChests(bot, { book: () => book, behind: () => behind, save: () => { saves++; }, say: text => said.push(text) });

    bot.emit('blockPlaced', { name: 'air', position: { x: 3, y: 70, z: 9 } }, block('chest', 3, 70, 9));
    assert.equal(book.ownerOf(found(3, 70, 9)), 'Alice');
    assert.equal(saves, 1);
    assert.equal(said.length, 1);
    assert.match(said[0], /noted as Alice's/);

    behind = OWN_IDEA;
    bot.emit('blockPlaced', { name: 'air', position: { x: 8, y: 70, z: 9 } }, block('cobblestone', 8, 70, 9));
    assert.equal(saves, 1, 'nothing to save for a block that is not a chest');
    assert.equal(said.length, 1);

    bot.emit('diggingCompleted', { name: 'air', position: { x: 3, y: 70, z: 9 } });
    assert.equal(book.size, 0);
    assert.equal(saves, 2);
});

test('watching a bot: it still notices a chest it digs up after it has died', async () => {
    const bot = eventBot(), book = createChestBook({ scope: SCOPE });
    const stop = watchMadeChests(bot, { book: () => book, behind: () => OWN_IDEA });
    book.mark(found(3, 70, 9), { owner: 'Alice' });
    bot.emit('death');
    await new Promise(resolve => setImmediate(resolve));
    bot.emit('diggingCompleted', { name: 'air', position: { x: 3, y: 70, z: 9 } });
    assert.equal(book.size, 0);

    stop();
    book.mark(found(3, 70, 9), { owner: 'Alice' });
    bot.emit('diggingCompleted', { name: 'air', position: { x: 3, y: 70, z: 9 } });
    bot.emit('blockPlaced', null, block('chest', 5, 70, 9));
    bot.emit('death');
    await new Promise(resolve => setImmediate(resolve));
    bot.emit('diggingCompleted', { name: 'air', position: { x: 3, y: 70, z: 9 } });
    assert.equal(book.size, 1, 'once stopped it listens to nothing');
});

test('watching a bot: a book that cannot be opened does not break placing a block', () => {
    const bot = eventBot();
    watchMadeChests(bot, { book: () => { throw new Error('no world yet'); }, behind: () => OWN_IDEA, warn: () => {} });
    assert.doesNotThrow(() => bot.emit('blockPlaced', null, block('chest', 3, 70, 9)));
    assert.doesNotThrow(() => bot.emit('diggingCompleted', { name: 'air', position: { x: 3, y: 70, z: 9 } }));
});
