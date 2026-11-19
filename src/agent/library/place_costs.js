// SPDX-License-Identifier: CC0-1.0
// Costs on places: some places cost more to walk through, in every route the bot plans.
//
// A player who saw pillagers by a tower walks round it the next time they pass, and doesn't walk into the
// spot a skeleton kept shooting from. The pathfinder knows nothing of that: it prices a step by the
// blocks, so its route goes straight through. This module lets a feature put a price on places, per bot,
// and every route search for that bot pays it, whichever skill, plugin or piece of generated code asked
// for the route.
//
// **Only steps that go deeper pay.** A place is priced as a slope: so much at its middle, less toward its
// edge, nothing outside. A step pays by how much the price rises from where it starts to where it ends, and
// a step that keeps level or goes down the slope pays nothing. So:
//   - a route that crosses a place pays for going in as far as it goes, once, and leaving is free;
//   - a bot standing inside one can always walk out, at the price of plain ground. Priced the obvious way,
//     by where a step ends, every step inside costs more, a big enough price drops the step altogether
//     (the pathfinder leaves out a step that costs over 100), and a bot that found itself inside had no
//     way out;
//   - a goal inside one is still reached; the route only comes in from the cheapest side.
// The price is added to the step's cost, never a reason to leave a step out, so nothing a route could do
// before becomes impossible: places bend routes, they don't wall them off.
//
// How it hooks in: no file of Mindcraft-CE's or of the pathfinder's is edited. Every route search asks the
// pathfinder's `Movements` class for the steps from a cell (`getNeighbors`), and this wraps that method on
// the class, once, at run time, adding each step's price for bots that have places priced. Any other bot
// gets the steps exactly as before. Fair legs (src/agent/fairplay/fair_legs.js) wraps the same method to
// add steps of its own, so it calls patchRoutePricing() again after its own wrap: the pricing stays the
// outermost layer and prices those steps too, and a copy of it further in lets the call through unpriced,
// so no step is priced twice.
import pf from 'mineflayer-pathfinder';

const sourcesOf = new WeakMap(); // bot -> Set of price sources
let outermost = null;            // the wrapper that is on the class now
let pricing = 0;                 // > 0 while a priced call runs: a wrapper further in passes the call through

/** The price of a cell for a bot: the sum of what its sources ask. */
function priceAt(sources, x, y, z) {
    let price = 0;
    for (const source of sources) price += source.priceAt(x, y, z) || 0;
    return price;
}

/**
 * Puts the pricing on the pathfinder's `Movements` class, as its outermost layer. Safe to call again: it
 * does nothing while it is already outermost, and wraps again when another layer was put over it since.
 */
export function patchRoutePricing() {
    const proto = pf.Movements.prototype;
    if (proto.getNeighbors === outermost) return;
    const inner = proto.getNeighbors;
    const wrapper = function (node) {
        const sources = pricing === 0 ? sourcesOf.get(this.bot) : null;
        if (!sources?.size) return inner.call(this, node);
        let neighbors;
        pricing++;
        try { neighbors = inner.call(this, node); } finally { pricing--; }
        const here = priceAt(sources, node.x, node.y, node.z);
        for (const move of neighbors) {
            const rise = priceAt(sources, move.x, move.y, move.z) - here;
            if (rise > 0) move.cost += rise;
        }
        return neighbors;
    };
    outermost = wrapper;
    proto.getNeighbors = wrapper;
}

/**
 * Prices places for every route one bot plans from now on.
 * @param {object} bot - the mineflayer bot
 * @param {{priceAt: (x: number, y: number, z: number) => number}} source - what a cell costs to be in, by
 *   its whole-block coordinates: 0 outside every place, more toward the middle of one. Asked many times a
 *   search, so it must be quick
 * @returns {() => void} stops pricing that source
 */
export function addPlaceCosts(bot, source) {
    if (typeof source?.priceAt !== 'function') throw new Error('addPlaceCosts needs a source with priceAt(x, y, z)');
    patchRoutePricing();
    let sources = sourcesOf.get(bot);
    if (!sources) sourcesOf.set(bot, sources = new Set());
    sources.add(source);
    return () => sources.delete(source);
}

/** What a cell costs one bot to be in, from all its sources: 0 where nothing is priced. */
export function placeCostAt(bot, x, y, z) {
    const sources = sourcesOf.get(bot);
    return sources?.size ? priceAt(sources, Math.floor(x), Math.floor(y), Math.floor(z)) : 0;
}
