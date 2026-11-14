// SPDX-License-Identifier: CC0-1.0
// Which blocks are chests to sort, and which two blocks are one chest.
//
// Sorting is for the containers a player keeps things in and tidies: chests, trapped chests and
// barrels. The others are left alone on purpose. An ender chest is one player's own. A hopper empties
// itself. A furnace, a dispenser and a brewing stand hold what they are working with. A shulker box
// cannot hold another shulker box, which a sort might well try to put in it.
import { partnerOffset } from '../memory/kinds.js';

/** The block names that are sorted. */
export const SORTABLE = Object.freeze(['chest', 'trapped_chest', 'barrel']);
export const isSortable = name => SORTABLE.includes(name);

const cell = pos => ({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
const comesFirst = (a, b) => a.x - b.x || a.y - b.y || a.z - b.z;

/**
 * Turns chest blocks into chests: one entry per chest, in the order the blocks came (nearest first, as
 * a search gives them). A double chest is two blocks and one chest, so it is one entry, named for
 * whichever half comes first in a fixed order; both halves, and either half alone, give the same entry.
 *
 * @param {object[]} blocks - blocks as the bot knows them, each with `name`, `position` and, when it
 *   can say how it is turned, `getProperties()`
 * @returns {{id: string, x: number, y: number, z: number, also: {x: number, y: number, z: number}|null, name: string}[]}
 *   `also` is the other half of a double chest
 */
export function chestsFrom(blocks) {
    const chests = new Map();
    for (const block of blocks ?? []) {
        if (!block?.position || !isSortable(block.name)) continue;
        const here = cell(block.position);
        // How the block is turned says whether it is half of a double chest, and where the other half
        // is. A block the bot only remembers may not be able to say; it is then taken as a single one.
        let state = null;
        try { state = block.getProperties?.() ?? null; } catch { /* a single chest, then */ }
        const offset = partnerOffset(block.name, state);
        const other = offset ? { x: here.x + offset.x, y: here.y + offset.y, z: here.z + offset.z } : null;
        const [first, second] = other && comesFirst(other, here) < 0 ? [other, here] : [here, other];
        const id = `${first.x},${first.y},${first.z}`;
        if (!chests.has(id)) chests.set(id, { id, ...first, also: second, name: block.name });
    }
    return [...chests.values()];
}
