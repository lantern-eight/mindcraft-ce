// SPDX-License-Identifier: CC0-1.0
// What burns in a furnace, how far each piece goes, and which fuel to use for a smelt. Pure: no game.
//
// A piece of fuel smelts a number of items: coal 8, a plank 1.5, a log 1.5, and so on (the game counts
// burn time in ticks: 200 an item, 1600 for coal, 300 for a plank). Two things shape the plan:
//
// - The fuel slot holds one kind at a time. When it burns empty another kind can go in, so a plan is a
//   list of stages, each one kind, loaded one after another: 5 coal and then 14 planks smelt 60 sand.
// - A log is worth four times as much made into planks first: one log burns for 1.5 items, its four
//   planks for 6. Planks are made in the inventory's own 2x2 grid, with no crafting table, so the plan
//   says which logs to make into planks rather than burning them.
//
// It never burns what is being smelted (logs on their way to charcoal), nor the product (making charcoal
// doesn't burn charcoal), nor Nether wood, which doesn't burn at all. Coal blocks, blaze rods, dried kelp
// blocks and lava buckets go only where nothing else covers it: a coal block burned for three items wastes
// the rest of it.
import { cleanName, isBurningLog, isBurningPlanks, planksOf } from './recipes.js';

/** How long a furnace takes to smelt one item, in ms. */
export const SMELT_MS = 10000;

// Fuel that is used before planks and logs, best first.
const RICH = Object.freeze({ coal: 8, charcoal: 8 });
// Fuel that is used only when nothing above covers the smelt.
const LAST_RESORT = Object.freeze({ blaze_rod: 12, dried_kelp_block: 20, coal_block: 80, lava_bucket: 100 });
const WOOD_PER = 1.5;
// A log crafted into planks gives this many.
const PLANKS_PER_LOG = 4;

/**
 * How many items one piece of a fuel smelts; 0 for anything this module doesn't burn.
 * @param {string} name
 * @returns {number}
 */
export function fuelPer(name) {
    const n = cleanName(name);
    if (n === null) return 0;
    if (Object.hasOwn(RICH, n)) return RICH[n];
    if (isBurningPlanks(n) || isBurningLog(n)) return WOOD_PER;
    if (Object.hasOwn(LAST_RESORT, n)) return LAST_RESORT[n];
    return 0;
}

/** The pieces of a fuel that smelt `count` items (a fraction of a piece still takes a whole one). */
export function unitsFor(per, count) {
    if (!(per > 0) || !(count > 0)) return 0;
    return Math.ceil(count / per - 1e-9);
}

/** How many whole items `units` pieces of a fuel smelt. */
export function itemsFrom(per, units) {
    if (!(per > 0) || !(units > 0)) return 0;
    return Math.floor(units * per + 1e-9);
}

/** Counts by name from an inventory given as `{name: count}` or as a list of `{name, count}`. */
export function countsOf(inventory) {
    const out = {};
    const add = (name, count) => {
        const n = cleanName(name);
        if (n !== null && Number.isFinite(count) && count > 0) out[n] = (out[n] ?? 0) + count;
    };
    if (Array.isArray(inventory)) for (const item of inventory) add(item?.name, item?.count);
    else if (inventory && typeof inventory === 'object') for (const [name, count] of Object.entries(inventory)) add(name, count);
    return out;
}

// Names in `have` that pass `test`, most first, then by name so the plan is the same every time.
const namesWhere = (have, test) => Object.keys(have).filter(test)
    .sort((a, b) => have[b] - have[a] || (a < b ? -1 : a > b ? 1 : 0));

/**
 * The fuel for smelting `count` items.
 *
 * @param {Object<string, number>|{name: string, count: number}[]} inventory - what the bot carries
 * @param {number} count - items to smelt
 * @param {object} [options]
 * @param {string} [options.input] - what is being smelted: this many of it are not fuel
 * @param {string} [options.product] - what the smelt makes: never burned
 * @param {boolean} [options.craftPlanks] - make logs into planks rather than burn them (default true)
 * @returns {{stages: {name: string, units: number, covers: number}[], crafts: {log: string, planks: string,
 *   times: number}[], covers: number}} stages to load in order, each one kind of fuel; logs to make into
 *   planks first (each time, one log into four planks); and how many items it all smelts, which is less
 *   than `count` when there isn't enough fuel
 */
export function planFuel(inventory, count, { input = null, product = null, craftPlanks = true } = {}) {
    const wanted = Number.isFinite(count) && count > 0 ? Math.ceil(count) : 0;
    const have = countsOf(inventory);
    const inputName = cleanName(input), productName = cleanName(product);
    if (inputName && have[inputName]) have[inputName] = Math.max(0, have[inputName] - wanted);
    if (productName) delete have[productName];

    const stages = [], crafts = [];
    let left = wanted;
    const burn = (name, per, available) => {
        if (left <= 0 || !(available > 0)) return;
        const units = Math.min(available, unitsFor(per, left));
        const covers = Math.min(left, itemsFrom(per, units));
        if (covers <= 0) return;
        const same = stages.find(stage => stage.name === name);
        if (same) { same.units += units; same.covers += covers; }
        else stages.push({ name, units, covers });
        have[name] = (have[name] ?? 0) - units;
        left -= covers;
    };

    for (const name of Object.keys(RICH)) burn(name, RICH[name], have[name]);
    for (const name of namesWhere(have, isBurningPlanks)) burn(name, WOOD_PER, have[name]);
    for (const log of namesWhere(have, isBurningLog)) {
        if (left <= 0) break;
        if (!craftPlanks) { burn(log, WOOD_PER, have[log]); continue; }
        // Only as many logs as the rest of the smelt needs; the planks left over stay in the bag.
        const times = Math.min(have[log], Math.ceil(left / (PLANKS_PER_LOG * WOOD_PER) - 1e-9));
        if (times <= 0) continue;
        const planks = planksOf(log);
        crafts.push({ log, planks, times });
        have[log] -= times;
        burn(planks, WOOD_PER, times * PLANKS_PER_LOG);
    }
    for (const name of Object.keys(LAST_RESORT)) burn(name, LAST_RESORT[name], have[name]);

    return { stages, crafts, covers: wanted - left };
}

/**
 * What to put in the fuel slot now, for `need` more items, when the slot already holds `inSlot` (or
 * nothing). Only fuel of the same kind can join what is in the slot. Null when nothing fits or nothing is
 * needed.
 *
 * @param {Object<string, number>|{name: string, count: number}[]} inventory - what the bot carries now
 * @param {number} need - items still to be covered beyond what the slot already covers
 * @param {{name: string, count: number}|null} inSlot
 * @param {{input?: string, product?: string, slotSize?: number}} [options]
 * @returns {{name: string, units: number, covers: number}|null}
 */
export function nextFuel(inventory, need, inSlot, { input = null, product = null, slotSize = 64 } = {}) {
    if (!(need > 0)) return null;
    // What is left of the input in the bag is still to be smelted, so none of it is fuel.
    const bag = countsOf(inventory);
    const inputName = cleanName(input);
    if (inputName) delete bag[inputName];
    // With fuel in the slot, only more of the same can go in; with none, whatever the plan starts with.
    const slotName = inSlot?.count > 0 ? cleanName(inSlot.name) : null;
    const pool = slotName ? { [slotName]: bag[slotName] ?? 0 } : bag;
    const stage = planFuel(pool, need, { product, craftPlanks: false }).stages[0];
    if (!stage) return null;
    const room = slotSize - (slotName ? inSlot.count : 0);
    const units = Math.min(stage.units, room);
    if (units <= 0) return null;
    return { name: stage.name, units, covers: Math.min(need, itemsFrom(fuelPer(stage.name), units)) };
}
