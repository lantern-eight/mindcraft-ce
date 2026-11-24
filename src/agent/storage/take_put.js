// SPDX-License-Identifier: CC0-1.0
// Which chests the bot may take things out of, or put things into, when it puts away or fetches.
//
// The rule a player in a shared base would expect, from what the chest book was told:
//
//   | Chest                  | Taking out                         | Putting in                              |
//   |------------------------|------------------------------------|-----------------------------------------|
//   | The bot's own, shared  | Free                               | Free                                    |
//   | A player's             | When a player asks                 | When a player asks for that player's    |
//   | Nobody has said        | No: it may be someone's            | No: it may be someone's                 |
//
// A player's chest may be taken from when any player asks, the way a friend fetching something for
// you would open another friend's chest: with good intentions, and saying whose it was. The asker's
// own chests come first, then other players'. Putting away is narrower: "put your things away" fills
// the bot's own and the shared chests, and a player's only when the request names that player, so a
// neighbour's chest never fills with the bot's cobblestone.
//
// A chest nobody has said anything about is left alone by both. It may be loot out in the world, free
// to take, or it may be in somebody's base. Telling the two apart is not built yet, so the bot asks,
// and the single-chest commands (!takeFromChestAt, !putInChestAt) are there when a player names one.
//
// This is a pure function: the chests, the book and the request in, a decision out.
import { ME, SHARED, sameOwner } from './chest_book.js';

/** The word for "the bot's own chests, then the shared ones". */
export const ANY = 'any';

// The order chests are taken from: the bot's own and the shared ones, then the asker's, then other players'.
const OWN_OR_SHARED = 0, ASKERS = 1, OTHERS = 2;

/**
 * The chests the bot may take things out of, and why the others are left.
 * @param {object[]} chests - chests as found (see chestsFrom)
 * @param {object} book - the chest book
 * @param {object} [request]
 * @param {boolean|null} [request.asked] - false when the bot knows no player is behind it; null when it cannot tell
 * @param {string|null} [request.by] - the player who asked, when known
 * @returns {{usable: {chest: object, owner: string, rank: number}[], left: {chest: object, owner: string|null, why: string}[]}}
 *   `rank` orders the usable ones (lower first). `why` is "unknown" (nobody has said whose it is) or
 *   "not_asked" (a player's chest, and no player asked)
 */
export function takeFrom(chests, book, { asked = null, by = null } = {}) {
    const usable = [], left = [];
    for (const chest of chests ?? []) {
        const owner = book.ownerOf(chest);
        if (owner === null) left.push({ chest, owner, why: 'unknown' });
        else if (owner === ME || owner === SHARED) usable.push({ chest, owner, rank: OWN_OR_SHARED });
        // A player's chest: when a player is behind the request, or when nobody can tell (a player is never refused on a guess).
        else if (asked === false) left.push({ chest, owner, why: 'not_asked' });
        else usable.push({ chest, owner, rank: by && sameOwner(owner, by) ? ASKERS : OTHERS });
    }
    return { usable, left };
}

/**
 * The chests the bot may put things into, and why the others are left.
 * @param {object[]} chests
 * @param {object} book
 * @param {object} [request]
 * @param {string} [request.whose] - ANY (the bot's own, then shared), ME, SHARED, or a player's name
 * @param {boolean|null} [request.asked]
 * @returns {{usable: {chest: object, owner: string, rank: number}[], left: {chest: object, owner: string|null, why: string}[]}}
 *   `rank`: the bot's own before shared, for ANY. `why`: "unknown", "other" (not whose was asked for),
 *   or "not_asked" (a player's chests, and no player asked)
 */
export function putInto(chests, book, { whose = ANY, asked = null } = {}) {
    const usable = [], left = [];
    const any = sameOwner(whose, ANY);
    for (const chest of chests ?? []) {
        const owner = book.ownerOf(chest);
        if (owner === null) left.push({ chest, owner, why: 'unknown' });
        else if (any ? owner !== ME && owner !== SHARED : !sameOwner(owner, whose)) left.push({ chest, owner, why: 'other' });
        else if (owner !== ME && owner !== SHARED && asked === false) left.push({ chest, owner, why: 'not_asked' });
        else usable.push({ chest, owner, rank: owner === ME ? 0 : owner === SHARED ? 1 : 2 });
    }
    return { usable, left };
}
