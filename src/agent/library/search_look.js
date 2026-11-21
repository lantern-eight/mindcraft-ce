// SPDX-License-Identifier: CC0-1.0
// Where a skill that searches asks whether to look around first.
//
// collectBlocks, goToNearestBlock, goToNearestEntity and attackNearest each search for the nearest thing of a
// kind and act on it. A player who can see only what is in front of them turns round before giving up, or
// before walking off to a far one when a near one may be behind them. A module can install, for a bot, a way
// of looking around at that moment: fair play does, under a narrowed field of view (fairplay/look_around.js).
// With nothing installed nothing happens, so stock behavior is unchanged.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so a
// setter there would let that code change the answer.

const lookers = new WeakMap(); // bot -> async (bot, nearest) => boolean

/**
 * Installs a way of looking around before a search, for one bot, or removes it with null.
 * @param {object} bot
 * @param {((bot: object, nearest: {x:number,y:number,z:number}|null) => Promise<boolean>)|null} fn - looks
 *   around if it should, given the nearest thing the search found (null for none), and says whether it did
 */
export function setSearchLook(bot, fn) {
    if (fn) lookers.set(bot, fn);
    else lookers.delete(bot);
}

/**
 * Before a skill acts on what its search found: looks around first when the installed way says to.
 * @param {object} bot
 * @param {{x:number,y:number,z:number}|null|undefined} nearest - where the nearest find is, if any
 * @returns {Promise<boolean>} true when the bot looked around, so the skill should search again
 */
export async function lookBeforeSearch(bot, nearest) {
    const look = lookers.get(bot);
    if (!look) return false;
    return Boolean(await look(bot, nearest ?? null));
}
