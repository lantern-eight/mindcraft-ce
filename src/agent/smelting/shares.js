// SPDX-License-Identifier: CC0-1.0
// Sharing a big smelt between several furnaces. Pure: no game, no bot.
//
// Sixty glass take ten minutes in one furnace, and three and a half in three. A player with a row of
// furnaces splits the sand between them, more into a blast furnace or a smoker since it smelts twice as
// fast, so that all of them are done at about the same time. Each furnace needs its own fuel, though, and
// fuel comes in pieces: sixty glass take 8 coal in one furnace and 9 in three (3 each, for 20 apiece). So
// a furnace is added only when the bot's fuel still covers every share, and only when each share is worth
// a furnace of its own (at least what a piece of coal smelts).
import { SPEED } from './recipes.js';
import { countsOf, planFuel } from './fuel.js';

/** A furnace is worth adding only for at least this many items: what one piece of coal smelts. */
export const MIN_SHARE = 8;
/** At most this many furnaces at once, the first one counted. */
export const MAX_FURNACES = 4;
/** The furnaces shared with must be this near the first: a row of them, not a walk across the base. */
export const GROUP_RANGE = 8;

/**
 * Splits `total` into whole shares in proportion to `weights`, the largest remainders rounded up, so the
 * shares add up to `total` exactly. A weight of 2 gets twice the share of a weight of 1.
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]}
 */
export function shareOut(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0) || !(sum > 0)) return weights.map(() => 0);
    const exact = weights.map(w => (total * w) / sum);
    const shares = exact.map(Math.floor);
    let left = total - shares.reduce((a, b) => a + b, 0);
    // The largest remainders first; on a tie, the earlier one (the nearer furnace).
    const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
    for (const { i } of order) { if (left <= 0) break; shares[i]++; left--; }
    return shares;
}

/**
 * Whether the fuel the bot carries covers each share in a furnace of its own. Fuel is planned share by
 * share from what is left after the ones before, and what is being smelted is never fuel.
 */
function fuelCovers(shares, bag, { input, product, lavaFirst }) {
    const left = countsOf(bag);
    for (const share of shares) {
        const plan = planFuel(left, share, { input, product, craftPlanks: false, lavaFirst });
        if (plan.covers < share) return false;
        for (const stage of plan.stages) left[stage.name] = (left[stage.name] ?? 0) - stage.units;
        // The input this share takes isn't there for the next one's fuel either (logs made into charcoal).
        if (input && left[input]) left[input] = Math.max(0, left[input] - share);
    }
    return true;
}

/**
 * How many items each furnace gets: as many furnaces of `kinds` (the first is the one the smelt starts in,
 * the rest in the order they would be used) as are worth it and the fuel covers, the shares in proportion
 * to each one's speed. Gives one share per furnace used, the first one's first; `[total]` keeps it to one.
 * @param {number} total - items to smelt
 * @param {string[]} kinds - furnace blocks that could take a share, the first one first
 * @param {Object<string, number>} bag - what the bot carries
 * @param {object} [options]
 * @param {string} [options.input]
 * @param {string} [options.product]
 * @param {boolean} [options.lavaFirst]
 * @param {number} [options.now] - only this many of each share go in now (a load puts in a stack), so the
 *   fuel is checked for that many
 * @returns {number[]}
 */
export function planShares(total, kinds, bag, { input = null, product = null, lavaFirst = false, now = Infinity } = {}) {
    const n = Math.min(kinds.length, MAX_FURNACES);
    for (let k = n; k >= 2; k--) {
        const shares = shareOut(total, kinds.slice(0, k).map(kind => SPEED[kind] ?? 1));
        if (shares.some(share => share < MIN_SHARE)) continue;
        if (fuelCovers(shares.map(share => Math.min(share, now)), bag, { input, product, lavaFirst })) return shares;
    }
    return [total];
}
