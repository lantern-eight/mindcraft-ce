// SPDX-License-Identifier: CC0-1.0
// Where gathering asks how to look for a drop that didn't come.
//
// collectBlocks breaks a block and picks up the drops it can find. Usually the drop is in the bag by then.
// When it isn't, a player who sees only what is in front of them looks where the block was, and goes over to
// the hole if the item is still nowhere to be seen: it may lie at the bottom, hidden by the rim or below the
// edge of the screen. A module can install, for a bot, a way of doing that: fair play does, under a narrowed
// field of view (fairplay/missing_drop.js). With nothing installed nothing happens, so stock behavior, which
// sees every drop, is unchanged.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so a
// setter there would let that code change the answer.

const lookers = new WeakMap(); // bot -> async (bot, cell) => boolean

/**
 * Installs a way of looking for a drop that didn't come, for one bot, or removes it with null.
 * @param {object} bot
 * @param {((bot: object, cell: {x:number,y:number,z:number}) => Promise<boolean>)|null} fn - looks for the
 *   drop of the block broken at `cell`, and says whether it did anything worth a second pickup
 */
export function setDropLook(bot, fn) {
    if (fn) lookers.set(bot, fn);
    else lookers.delete(bot);
}

/**
 * After a block's drop didn't reach the bag: looks for it, when a way is installed.
 * @param {object} bot
 * @param {{x:number,y:number,z:number}} cell - where the block was
 * @returns {Promise<boolean>} true when the bot looked, so the caller should pick up again
 */
export async function lookForDrop(bot, cell) {
    const look = lookers.get(bot);
    if (!look || !cell) return false;
    return Boolean(await look(bot, cell));
}
