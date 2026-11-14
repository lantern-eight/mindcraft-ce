// SPDX-License-Identifier: CC0-1.0
// Chests the bot places or digs up itself.
//
// Nobody has to tell the bot whose a chest is when the bot made it. Who it is for follows from why it
// was placed:
//   - on the bot's own idea: it is the bot's own, and may always be sorted;
//   - while doing what a player asked: it is that player's, and sorted only when asked;
//   - when the code cannot tell who is behind it: it has no owner yet, and the model is asked to say.
// The second is a guess, and it leans the safe way. If it is wrong, the bot will not tidy a chest it
// could have. Leaning the other way, it would rearrange a player's chest without being asked. Each
// time, the result of what the bot is doing says what was noted and how to change it.
//
// A chest that joins one already standing makes a double chest, which is one chest. That chest was
// someone's before the bot added to it, so it stays whose it was.
//
// A chest the bot digs up is forgotten there and then.
import { ME } from './chest_book.js';
import { chestsFrom, isSortable } from './chests.js';
import { labelOf, ownerLabel, SORTING_TEXT } from './commands.js';

const cellOf = pos => ({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
const SAY_SO = 'say so with !markChest';

/**
 * The bot has placed a block. When it is a chest, writes down whose it is.
 * @param {object} book - the chest book
 * @param {object} block - the block as it stands now, with `name`, `position` and `getProperties()`
 * @param {{asked?: boolean|null, by?: string|null}} [behind] - who is behind what the bot is doing
 *   (see asker.js)
 * @returns {string|null} what to tell the model, or null when there is nothing to tell
 */
export function chestPlaced(book, block, behind = {}) {
    if (!block?.position || !isSortable(block.name)) return null;
    const cell = cellOf(block.position), spot = `${cell.x}, ${cell.y}, ${cell.z}`;
    // The bot has just put a block where there was none. Anything filed under this spot is about a
    // chest that was broken while the bot was not looking, and must not pass to the new one.
    book.dropCell(cell.x, cell.y, cell.z);
    const chest = chestsFrom([block])[0];

    // The new block is half of a double chest: it joined a chest that was already there.
    const joined = book.of(chest);
    if (joined) {
        book.mark(chest, {});       // files what is known under both halves
        if (joined.madeBy === ME) return null;      // the bot building a double chest: nothing new to say
        if (joined.owner != null) {
            return `The ${block.name} you placed at ${spot} joined the chest next to it. The double chest is still `
                + `${ownerLabel(joined.owner)}, ${SORTING_TEXT[book.sortingOf(chest)]}.`;
        }
    }
    if (chest.also) {
        return `The ${block.name} you placed at ${spot} joined the chest next to it, which has no known owner. `
            + `Ask whose the double chest is, and ${SAY_SO}.`;
    }

    if (behind.asked === true && behind.by) {
        book.mark(chest, { owner: behind.by, by: behind.by, madeBy: ME });
        const owner = book.ownerOf(chest);
        return `The ${labelOf(chest)} is noted as ${ownerLabel(owner)}, because you placed it while doing what ${behind.by} asked: `
            + `it is ${SORTING_TEXT[book.sortingOf(chest)]}. If ${behind.by} meant it for you or for someone else, ${SAY_SO}.`;
    }
    if (behind.asked === false) {
        book.mark(chest, { owner: ME, madeBy: ME });
        return `The ${labelOf(chest)} is noted as your own, because you placed it on your own idea: it ${SORTING_TEXT[book.sortingOf(chest)]}. `
            + `If it is for a player, ${SAY_SO}.`;
    }
    book.mark(chest, { madeBy: ME });
    return `You placed the ${labelOf(chest)}, and it has no owner yet. Say whose it is with !markChest: your own name if it is yours.`;
}

/**
 * The bot has dug a block up. Forgets what was said about a chest that stood there.
 * @param {object} book - the chest book
 * @param {object} block - the block the bot dug, or what is there now: only its `position` is used
 * @returns {boolean} whether the book had anything filed under that spot
 */
export function chestDug(book, block) {
    if (!block?.position) return false;
    const cell = cellOf(block.position);
    return book.dropCell(cell.x, cell.y, cell.z);
}

/**
 * Keeps the chest book up to date with the chests a bot places and digs up, from the bot's own events.
 * @param {object} bot - the mineflayer bot
 * @param {object} options
 * @param {() => object} options.book - the chest book for the world the bot is in now
 * @param {() => {asked?: boolean|null, by?: string|null}} [options.behind] - who is behind what the bot is doing
 * @param {() => void} [options.save] - writes the book down after a change
 * @param {(text: string) => void} [options.say] - adds a line to the result of what the bot is doing
 * @param {(...args: any[]) => void} [options.warn]
 * @returns {() => void} stops watching
 */
export function watchMadeChests(bot, { book, behind = () => ({}), save = () => {}, say = () => {}, warn = console.warn } = {}) {
    if (typeof bot?.on !== 'function') return () => {};
    // These run inside the bot's own placing and digging. A problem here must never break those.
    const quietly = fn => (...args) => {
        try { fn(...args); }
        catch (error) { warn('[chest sorting] Could not note a chest the bot placed or dug up:', error.message); }
    };
    const onPlaced = quietly((oldBlock, newBlock) => {
        if (!isSortable(newBlock?.name)) return;
        const note = chestPlaced(book(), newBlock, behind());
        save();
        if (note) say(note);
    });
    const onDug = quietly(block => { if (block?.position && chestDug(book(), block)) save(); });
    // mineflayer drops every listener for a finished dig when the bot dies, this one included. It is
    // put back once the death has been dealt with, whichever of the two heard of the death first.
    let stopped = false;
    const listenForDigs = () => { bot.off('diggingCompleted', onDug); if (!stopped) bot.on('diggingCompleted', onDug); };
    const onDeath = () => queueMicrotask(listenForDigs);

    bot.on('blockPlaced', onPlaced);
    bot.on('death', onDeath);
    listenForDigs();
    return () => {
        stopped = true;
        bot.off('blockPlaced', onPlaced);
        bot.off('death', onDeath);
        bot.off('diggingCompleted', onDug);
    };
}
