// SPDX-License-Identifier: CC0-1.0
// Where digDown asks how to dig down.
//
// Mindcraft's digDown digs the column under the bot's feet, and before each block reads the two below it
// for lava, water or a drop. A player standing there can't see those: they are still inside the ground.
// A module can install another way of digging down for a bot; fair play installs a staircase, which sees
// each block it will stand on before stepping onto it (stairs_down.js). With nothing installed, digDown is
// the stock one.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so a
// setter there would let that code swap the way back.

const ways = new WeakMap(); // bot -> (bot, distance) => Promise<boolean>

/**
 * Installs the way for one bot, or removes it with null.
 * @param {object} bot
 * @param {((bot: object, distance: number) => Promise<boolean>)|null} fn
 */
export function setDigDownWay(bot, fn) {
    if (fn) ways.set(bot, fn);
    else ways.delete(bot);
}

/** The way installed for this bot, or null for the stock one. */
export function digDownWayOf(bot) {
    return ways.get(bot) ?? null;
}
