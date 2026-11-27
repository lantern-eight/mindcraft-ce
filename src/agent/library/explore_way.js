// SPDX-License-Identifier: CC0-1.0
// Where the NPC's item goals ask how to go and look for something that isn't near.
//
// Mindcraft's item goal, when what it needs isn't in sight a second time, steps 8 blocks away in any direction
// and tries again, so a bot that needs sand walks round where it started. A module can install a way of
// exploring for a thing for a bot; the exploring module installs one that keeps a heading from one call to the
// next and stops when the thing is in view (src/agent/explore/). With nothing installed, the stock step runs.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so a
// setter there would let that code swap the way back.

const ways = new WeakMap(); // bot -> async (what: string) => void

/**
 * Installs the way for one bot, or removes it with null.
 * @param {object} bot
 * @param {((what: string) => Promise<unknown>)|null} way - explores for a block or mob, by the game's name
 */
export function setExploreWay(bot, way) {
    if (way) ways.set(bot, way);
    else ways.delete(bot);
}

/** The way installed for this bot, or null for the stock step. */
export function exploreWayOf(bot) {
    return ways.get(bot) ?? null;
}
