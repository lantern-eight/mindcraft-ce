// SPDX-License-Identifier: CC0-1.0
// The stow plan: where each thing the bot puts away should go, and which chests to fetch a thing from.
//
// This is the thinking half of putting away and fetching, kept apart from the doing half (stow.js) the
// same way the sort plan is: a pure function, no game, no bot. It works from what the bot believes is
// in each chest, which is what it saw the last time it looked. The doing half finds out on opening
// whether that is still so, and asks again with what it learned.
//
// Where a thing goes, the way a player puts things away in a storage room:
//   1. into a chest that already holds that kind of thing, the one holding most of it;
//   2. else into the chest that holds most of its group (tools with tools, wood with wood), the group's
//      home in the sort plan's words, so a base somebody organized stays organized;
//   3. else into an empty chest, which starts a new group's home instead of mixing one into another;
//   4. else into the chest with the most room, and last, a chest it has not looked into.
// Among equals the bot's own chests come before shared ones, then the nearest. A kind that does not fit
// in one chest goes on into the next by the same rules. Room is counted in slots, with each kind's real
// stack size, because a chest is full when its slots are, not at a number of items.
//
// Fetching takes from the chests it may take from, in the order take_put.js ranks them (the bot's own
// and shared, the asker's, other players'), and within a rank from one chest that has all of it if
// there is one, else the nearest first.
import { groupOf as groupByName } from './item_groups.js';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * How many more of an item a chest can take, believed from its totals: the room left on its last part
 * stack of that item (stacks are taken to be merged, as a sorted chest is) and its empty slots.
 */
export function roomFor(chest, name, stackSize) {
    if (!chest.items) return 0;
    const size = Math.max(1, stackSize(name));
    const have = chest.items[name] ?? 0;
    const partial = have % size === 0 ? 0 : size - (have % size);
    return partial + Math.max(0, chest.free ?? 0) * size;
}

/** Takes `count` of an item into a chest's belief, as it would sit after a put: part stack topped up, then new slots. */
function add(chest, name, count, stackSize) {
    const size = Math.max(1, stackSize(name));
    const have = chest.items[name] ?? 0;
    const partial = have % size === 0 ? 0 : size - (have % size);
    const intoNew = Math.max(0, count - partial);
    chest.items[name] = have + count;
    chest.free -= Math.ceil(intoNew / size);
}

/**
 * Plans where each item goes.
 * @param {{name: string, count: number}[]} items - what to put away
 * @param {{id: string, rank: number, distance: number, items: Object<string, number>|null, free: number|null}[]} chests -
 *   the chests that may be used, with what the bot believes each holds (`items` and `free` null for one it
 *   has not looked into), its rank from take_put.js and its distance from the bot
 * @param {object} [options]
 * @param {(name: string) => number} [options.stackSize]
 * @param {(name: string) => string} [options.groupOf]
 * @returns {{into: {id: string, items: {name: string, count: number}[]}[], unplaced: {name: string, count: number}[]}}
 *   `into` lists the chests to visit in the order of the plan's choices, each once; `unplaced` is what no
 *   chest the bot knows has room for
 */
export function planPutAway(items, chests, { stackSize = () => 64, groupOf = groupByName } = {}) {
    // A copy of each belief, so the plan can fill it up as it goes.
    const known = chests.filter(chest => chest.items).map(chest => ({ ...chest, items: { ...chest.items }, free: chest.free ?? 0 }));
    const unseen = chests.filter(chest => !chest.items);
    const byNear = (a, b) => a.rank - b.rank || a.distance - b.distance || compare(a.id, b.id);
    const groupCount = (chest, group) => Object.entries(chest.items).reduce((n, [name, count]) => n + (groupOf(name) === group ? count : 0), 0);
    const isEmpty = chest => Object.values(chest.items).every(count => !count);

    const into = new Map();     // chest id -> { name -> count }
    const unplaced = [];
    const put = (chest, name, count) => {
        if (!into.has(chest.id)) into.set(chest.id, new Map());
        const there = into.get(chest.id);
        there.set(name, (there.get(name) ?? 0) + count);
    };

    for (const { name, count } of [...items].sort((a, b) => b.count - a.count || compare(a.name, b.name))) {
        let left = count;
        const group = groupOf(name);
        while (left > 0) {
            const roomy = known.filter(chest => roomFor(chest, name, stackSize) > 0);
            const holding = roomy.filter(chest => chest.items[name] > 0)
                .sort((a, b) => b.items[name] - a.items[name] || byNear(a, b));
            const home = roomy.filter(chest => groupCount(chest, group) > 0)
                .sort((a, b) => groupCount(b, group) - groupCount(a, group) || byNear(a, b));
            const empty = roomy.filter(isEmpty).sort(byNear);
            const most = [...roomy].sort((a, b) => b.free - a.free || byNear(a, b));
            const chest = holding[0] ?? home[0] ?? empty[0] ?? most[0];
            if (!chest) break;
            const n = Math.min(left, roomFor(chest, name, stackSize));
            add(chest, name, n, stackSize);
            put(chest, name, n);
            left -= n;
        }
        if (left > 0) {
            // No chest the bot has looked into has room: the nearest one it has not looked into may.
            const maybe = [...unseen].sort(byNear)[0];
            if (maybe) put(maybe, name, left);
            else unplaced.push({ name, count: left });
        }
    }
    return {
        into: [...into].map(([id, there]) => ({ id, items: [...there].map(([name, n]) => ({ name, count: n })) })),
        unplaced,
    };
}

/**
 * Orders chests to visit as a walk: the nearest to where the bot stands, then the nearest to that one.
 * @param {{x: number, y: number, z: number}} from
 * @param {object[]} chests - each with x, y, z
 */
export function walkOrder(from, chests) {
    const left = [...chests], out = [];
    let here = from;
    while (left.length) {
        left.sort((a, b) => dist(here, a) - dist(here, b) || compare(String(a.id), String(b.id)));
        here = left.shift();
        out.push(here);
    }
    return out;
}

/**
 * Plans where to take an item from.
 * @param {string} name
 * @param {number} count - how many are wanted
 * @param {{id: string, rank: number, distance: number, items: Object<string, number>|null}[]} chests - the chests
 *   that may be taken from, as for planPutAway
 * @returns {{from: {id: string, count: number}[], short: number}} the chests to take from in order and how
 *   many from each, and how many the chests the bot knows of are short of the count
 */
export function planFetch(name, count, chests) {
    const holders = chests.filter(chest => (chest.items?.[name] ?? 0) > 0);
    const enough = chest => chest.items[name] >= count;
    holders.sort((a, b) => a.rank - b.rank || Number(enough(b)) - Number(enough(a)) || a.distance - b.distance || compare(a.id, b.id));
    const from = [];
    let left = count;
    for (const chest of holders) {
        if (left <= 0) break;
        const n = Math.min(left, chest.items[name]);
        from.push({ id: chest.id, count: n });
        left -= n;
    }
    return { from, short: Math.max(0, left) };
}
