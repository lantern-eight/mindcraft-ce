// SPDX-License-Identifier: CC0-1.0
// What of a field's harvest goes into the field's chest, and what the bot keeps. Pure: no bot, no world.
//
// A player who farms keeps seed in their pocket to sow the field again and something to eat, and leaves the
// rest of the harvest in the chest by the field. So does the bot:
//   - seed: as many of each as the field has cells of that crop, so the whole field could be sown again
//     (at most a stack). Carrots and potatoes are their own seed;
//   - food: of the crops that can be eaten (carrots, potatoes, beetroot), enough that the bag holds
//     FOOD_RESERVE pieces of food in all, counting the other food it carries, the most filling first;
//   - everything else of the harvest goes: wheat, more seed than that, a poisonous potato.
// Only what a field gives is planned: the bot's other things are not the harvest, and stay where they are.
import { CROPS, cropOfBlock } from './crops.js';

/** Pieces of food the bot keeps in all, counting what it already carries. */
export const FOOD_RESERVE = 16;
/** The most of one seed it keeps: a stack. */
export const SEED_KEEP_MAX = 64;

// What a field gives: every crop's seed and produce, and the potato that came up poisonous.
const HARVEST = new Set([...CROPS.flatMap(row => [row.seed, row.produce]), 'poisonous_potato']);
// How filling each crop is (the game's food points), to keep the best first.
// Beetroot and potatoes give 1 each; beetroot fills a little more (saturation), and comes first by name too.
const POINTS = Object.freeze({ carrot: 3, potato: 1, beetroot: 1 });

const countOf = (bag, name) => (Number.isFinite(bag?.[name]) && bag[name] > 0 ? bag[name] : 0);

/** True for an item a field gives. */
export const isHarvest = name => HARVEST.has(name);

/**
 * @param {Object<string, number>} bag - what the bot carries, counted by item name
 * @param {{above?: string|null}[]} cells - the field's cells after the round, with what stands on each
 *   (Java's crop block names)
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.isFood] - whether an item is something to eat (the game's food
 *   table); a poisonous potato never counts
 * @returns {{store: {name: string, count: number}[], keep: {name: string, count: number}[]}} the harvest to put
 *   away and the harvest kept, both in name order
 */
export function harvestPlan(bag, cells, { isFood = name => name in POINTS } = {}) {
    const keep = {};
    // Seed to sow the field again: a cell of each crop as it stands now.
    for (const cell of cells ?? []) {
        const row = cropOfBlock(cell?.above);
        if (row) keep[row.seed] = (keep[row.seed] ?? 0) + 1;
    }
    for (const seed of Object.keys(keep)) keep[seed] = Math.min(keep[seed], SEED_KEEP_MAX, countOf(bag, seed));

    // Food: what else the bag holds to eat counts towards the reserve, then the crops make up the rest.
    const eatable = name => name !== 'poisonous_potato' && isFood(name);
    const otherFood = Object.keys(bag ?? {}).filter(name => !HARVEST.has(name) && eatable(name)).reduce((n, name) => n + countOf(bag, name), 0);
    const foods = Object.keys(POINTS).filter(name => eatable(name) && countOf(bag, name) > 0)
        .sort((a, b) => POINTS[b] - POINTS[a] || (a < b ? -1 : 1));
    let short = FOOD_RESERVE - otherFood - foods.reduce((n, name) => n + (keep[name] ?? 0), 0);
    for (const name of foods) {
        if (short <= 0) break;
        const more = Math.min(short, countOf(bag, name) - (keep[name] ?? 0));
        if (more > 0) { keep[name] = (keep[name] ?? 0) + more; short -= more; }
    }

    const store = [], kept = [];
    for (const name of [...HARVEST].sort()) {
        const have = countOf(bag, name), held = Math.min(keep[name] ?? 0, have);
        if (have - held > 0) store.push({ name, count: have - held });
        if (held > 0) kept.push({ name, count: held });
    }
    return { store, keep: kept };
}
