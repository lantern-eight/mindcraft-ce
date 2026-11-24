// SPDX-License-Identifier: CC0-1.0
// Where smeltItem and clearNearestFurnace ask how to smelt.
//
// Mindcraft's smeltItem stands at an open furnace until it is done, can wait for ever on one that never
// opens, and afterwards digs up "the nearest furnace", which may not be the one it placed. A module can
// install another way of smelting for a bot; the smelting module installs one that loads a free furnace,
// shuts it and comes back (src/agent/smelting/). With nothing installed, the stock skills run.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so a
// setter there would let that code swap the way back.

const ways = new WeakMap(); // bot -> { smeltItem(bot, itemName, num), clearFurnace(bot) }

/**
 * Installs the way for one bot, or removes it with null.
 * @param {object} bot
 * @param {{smeltItem: Function, clearFurnace: Function}|null} way
 */
export function setSmeltWay(bot, way) {
    if (way) ways.set(bot, way);
    else ways.delete(bot);
}

/** The way installed for this bot, or null for the stock one. */
export function smeltWayOf(bot) {
    return ways.get(bot) ?? null;
}
