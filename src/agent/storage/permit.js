// SPDX-License-Identifier: CC0-1.0
// Which chests a request to sort may touch, and why the others are left alone.
//
// The rule a player would expect in a shared base: nothing is sorted unless that was approved for the
// chest. Approval is either a player asking now ("sort my chests", "sort this chest") or a standing
// "always sort it" kept in the chest book. On top of that:
//   - Chests are sorted in pools, and a pool has one owner. Items never move between the chests of
//     different owners, or sorting a room two people share would mix their things.
//   - A chest marked "never" is left out of every pool, even when it is asked for by where it is.
//   - A pool holds only chests the bot can see from where it stands. "Sort my chests" means the ones
//     in this room, not every chest the player owns across the world.
//   - Chests nobody owns are never pooled together: they may be different people's.
//
// This is a pure function. It is handed the chests the bot found, the book and the request, and
// decides. Nothing here touches the game or moves an item.
import { ME, SHARED, sameOwner } from './chest_book.js';

/** The word for "every chest that may always be sorted". */
export const APPROVED = 'approved';

const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const sameCell = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The bot's own chests first, then the shared ones, then each player's by name, then chests nobody owns.
const rank = owner => (owner === ME ? 0 : owner === SHARED ? 1 : owner === null ? 3 : 2);

/**
 * @param {object[]} chests - the chests the bot found (see chestsFrom), nearest first. `inView: false`
 *   marks one it cannot see from where it stands; left out, a chest counts as in view
 * @param {object} book - the chest book
 * @param {object} request
 * @param {string} [request.whose] - a pool: a player's name, "shared", "me", or "approved" for every
 *   chest that may always be sorted
 * @param {{x: number, y: number, z: number}} [request.chest] - or one chest, by where it is
 * @param {boolean|null} [request.asked] - false when the bot knows no player is behind the request.
 *   It then sorts only chests that may always be sorted. True, or null when it cannot tell, sorts
 *   what was asked for: it never refuses on a guess
 * @returns {{pools: {owner: string|null, chests: object[]}[], left: {chest: object, owner: string|null, why: string}[],
 *   hidden: number, missing?: boolean}} `left` are the chests in view that are not sorted, each with
 *   `why`: "never", "other" (someone else's), "unknown" (nobody's), "not_always" or "not_asked".
 *   `hidden` counts the chests that would have been sorted but are out of sight. `missing` is set
 *   when the one chest asked for is not a chest the bot knows of
 */
export function poolsFor(chests, book, { whose, chest: where, asked = null } = {}) {
    if (where === undefined && !whose) throw new Error('A request names whose chests to sort, or one chest.');
    const pools = [], left = [];
    let hidden = 0;
    const leave = (chest, why) => left.push({ chest, owner: book.ownerOf(chest), why });
    // The bot acting on its own idea may only sort what has standing approval.
    const mayNow = chest => asked !== false || book.sortingOf(chest) === 'always';

    if (where !== undefined) {
        const cell = cellOf(where);
        const chest = chests.find(found => sameCell(cellOf(found), cell) || sameCell(found.also ? cellOf(found.also) : null, cell));
        if (!chest) return { pools, left, hidden, missing: true };
        if (book.sortingOf(chest) === 'never') leave(chest, 'never');
        else if (!mayNow(chest)) leave(chest, 'not_asked');
        else pools.push({ owner: book.ownerOf(chest), chests: [chest] });
        return { pools, left, hidden };
    }

    const everyApproved = sameOwner(whose, APPROVED);
    const byOwner = new Map();      // the pool each chest goes in, keyed so that chests nobody owns stay apart
    for (const chest of chests) {
        const owner = book.ownerOf(chest), sorting = book.sortingOf(chest);
        const wanted = everyApproved ? sorting === 'always' : sameOwner(owner, whose) && sorting !== 'never' && mayNow(chest);
        if (wanted && chest.inView === false) { hidden++; continue; }
        if (chest.inView === false) continue;       // out of sight and not asked for: not this request's business
        if (wanted) {
            const key = owner === null ? `?${chest.id}` : owner.toLowerCase();
            if (!byOwner.has(key)) byOwner.set(key, { owner, chests: [] });
            byOwner.get(key).chests.push(chest);
        } else if (sorting === 'never') leave(chest, 'never');
        else if (everyApproved) leave(chest, 'not_always');
        else if (!sameOwner(owner, whose)) leave(chest, owner === null ? 'unknown' : 'other');
        else leave(chest, 'not_asked');
    }
    pools.push(...[...byOwner.values()].sort((a, b) => rank(a.owner) - rank(b.owner) || compare(a.owner ?? '', b.owner ?? '')));
    return { pools, left, hidden };
}
