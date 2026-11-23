// SPDX-License-Identifier: CC0-1.0
// Putting away and fetching, done: walking to chests, opening them, moving things, and checking.
//
// The plan (stow_plan.js) is made from what the bot believes is in each chest, which is what it saw the
// last time it looked. Someone may have used the chest since. So the bot never trusts the plan past the
// next chest: it opens one, reads what is really there, moves what it can, counts what really moved
// from what the server says, and plans the rest again with what it now knows. A chest that will not
// open, or turns out full, is left out of the next plan. The loop shape (one chest a round, the rest
// planned again) follows the store and fetch loops of the akarkin1/mindcraft-fk fork's storage pack.
//
// Nothing touches the game here directly. It is handed "hands" (bot_hands.js) that walk, open and move,
// so the same code runs on a real bot and in the fake room of the tests.
import { planFetch, planPutAway, walkOrder } from './stow_plan.js';

/** How many chests it opens just to see what is inside, at most, before or while it plans. */
export const LOOK_LIMIT = 12;

const countIn = (stacks, name) => stacks.reduce((n, stack) => n + (stack?.name === name ? stack.count : 0), 0);
/** What a chest's slots hold, as a plan believes it: totals by name, and how many slots are empty. */
const beliefOf = slots => {
    const items = {};
    for (const stack of slots) if (stack) items[stack.name] = (items[stack.name] ?? 0) + stack.count;
    return { items, free: slots.filter(stack => !stack).length };
};

/**
 * Opens a chest, hands it to `use`, and closes it again whatever happens.
 * @returns {Promise<{ok: boolean, reason?: string, value?: *}>}
 */
async function visit(hands, chest, checkpoint, use) {
    checkpoint();
    let opened;
    try { opened = await hands.open(chest); }
    catch (error) {
        checkpoint();       // a stopped action is not a chest that would not open
        return { ok: false, reason: error?.message ?? String(error) };
    }
    try { return { ok: true, value: await use(opened) }; }
    finally { await opened.close(); }
}

/**
 * Puts things away.
 * @param {object[]} chests - the chests it may put into (take_put.js), each as found plus `rank`, `distance`,
 *   and what the bot believes is in it: `items` and `free`, or null for one it has not looked into
 * @param {object} options
 * @param {{name: string, count: number, slots: number[]}[]} options.items - what to put away (the keep plan's store list)
 * @param {object} options.hands - see botHands
 * @param {{x: number, y: number, z: number}} options.from - where the bot stands, for the order of the walk
 * @param {(name: string) => number} [options.stackSize]
 * @param {(name: string) => string} [options.groupOf]
 * @param {() => void} [options.checkpoint] - throws when the action has been stopped
 * @returns {Promise<{stored: {chest: object, items: Object<string, number>}[], left: {name: string, count: number}[],
 *   skipped: {chest: object, reason: string}[], full: boolean}>} `left` is what is still in the bot's bag
 *   that was to go; `full` says the chests it may use had no room for it
 */
export async function putAway(chests, { items, hands, from, stackSize = () => 64, groupOf, checkpoint = () => {}, lookLimit = LOOK_LIMIT }) {
    const beliefs = new Map(chests.map(chest => [chest.id, { ...chest }]));
    const remaining = new Map(items.filter(item => item.count > 0).map(item => [item.name, { count: item.count, slots: [...item.slots] }]));
    const stored = new Map(), skipped = [];
    const out = new Set();          // chests left out of later plans
    let looked = 0, full = false;

    const note = (chest, name, n) => {
        if (!stored.has(chest.id)) stored.set(chest.id, { chest, items: {} });
        const items = stored.get(chest.id).items;
        items[name] = (items[name] ?? 0) + n;
    };

    // First, a look into the chests it has never seen inside, nearest first, as a player in a storage room
    // they don't know opens the chests before deciding where things go. Without that, every chest would
    // look alike to the plan and everything would land in the first.
    for (const chest of walkOrder(from, [...beliefs.values()].filter(c => !c.items))) {
        if (looked >= lookLimit) break;
        looked++;
        const result = await visit(hands, chest, checkpoint, async opened => Object.assign(chest, beliefOf(opened.slots())));
        if (!result.ok) { skipped.push({ chest, reason: result.reason }); out.add(chest.id); }
    }

    // One chest a round. Each round either moves something, or rules a chest out, so this ends.
    for (let round = 0; remaining.size && round < chests.length * 3 + 3; round++) {
        const usable = [...beliefs.values()].filter(chest => !out.has(chest.id) && (chest.items || looked < lookLimit));
        const wanted = [...remaining].map(([name, { count }]) => ({ name, count }));
        const plan = planPutAway(wanted, usable, { stackSize, groupOf });
        if (!plan.into.length) { full = true; break; }
        const planned = new Map(plan.into.map(entry => [entry.id, entry.items]));
        const chest = walkOrder(from, plan.into.map(entry => beliefs.get(entry.id)))[0];
        if (!chest.items) looked++;

        let movedHere = 0;
        const result = await visit(hands, chest, checkpoint, async opened => {
            // Whatever the plan believed, what is in the chest now is what counts. Everything the bot was
            // going to put away may go in, if it is where it belongs: the plan only chose the chest.
            Object.assign(chest, beliefOf(opened.slots()));
            const here = new Set(planned.get(chest.id).map(item => item.name));
            for (const [name, want] of remaining) {
                if (!here.has(name)) continue;
                const before = countIn(opened.slots(), name);
                let asked = 0;
                for (const slot of want.slots) {
                    if (asked >= want.count) break;
                    const stack = opened.pockets()[slot - 9];
                    if (stack?.name !== name) continue;
                    const n = Math.min(stack.count, want.count - asked);
                    asked += n;
                    try { await opened.putSlot(slot, n); }
                    catch { checkpoint(); break; }     // the chest is full: what fitted is counted below
                }
                await opened.settle();
                const moved = Math.max(0, countIn(opened.slots(), name) - before);
                if (moved) {
                    note(chest, name, moved);
                    movedHere += moved;
                    want.count -= moved;
                    if (want.count <= 0) remaining.delete(name);
                }
            }
            Object.assign(chest, beliefOf(opened.slots()));
        });
        if (!result.ok) {
            skipped.push({ chest, reason: result.reason });
            out.add(chest.id);
        } else if (!movedHere) {
            // Opened, and nothing went in: it has no room after all for what was planned. It may still
            // be the place for something else, but not this round's things; leave it out.
            out.add(chest.id);
        }
    }
    return {
        stored: [...stored.values()],
        left: [...remaining].map(([name, { count }]) => ({ name, count })),
        skipped,
        full: full && remaining.size > 0,
    };
}

/**
 * Fetches an item.
 * @param {object[]} chests - the chests it may take from (take_put.js), as for putAway
 * @param {object} options
 * @param {string} options.name
 * @param {number} options.count
 * @param {object} options.hands
 * @param {{x: number, y: number, z: number}} options.from
 * @param {() => void} [options.checkpoint]
 * @returns {Promise<{taken: {chest: object, count: number}[], total: number, skipped: {chest: object, reason: string}[],
 *   bagFull: boolean}>}
 */
export async function fetchItem(chests, { name, count, hands, from, checkpoint = () => {}, lookLimit = LOOK_LIMIT }) {
    const beliefs = new Map(chests.map(chest => [chest.id, { ...chest }]));
    const taken = [], skipped = [], done = new Set();
    let total = 0, looked = 0, bagFull = false;

    while (total < count && !bagFull) {
        const open = [...beliefs.values()].filter(chest => !done.has(chest.id));
        const plan = planFetch(name, count - total, open);
        let chest;
        if (plan.from.length) chest = beliefs.get(plan.from[0].id);
        else {
            // No chest it has looked into holds any more of it. A chest it has never looked into might:
            // the nearest of those is worth a look, as a player opens the chests of a room they don't know.
            const unseen = open.filter(c => !c.items);
            if (!unseen.length || looked >= lookLimit) break;
            // The bot's own and shared chests before a player's, then the nearest.
            const best = Math.min(...unseen.map(c => c.rank ?? 0));
            chest = walkOrder(from, unseen.filter(c => (c.rank ?? 0) === best))[0];
            looked++;
        }
        done.add(chest.id);
        const result = await visit(hands, chest, checkpoint, async opened => {
            const had = countIn(opened.slots(), name);
            const want = Math.min(count - total, had);
            if (want > 0) {
                try { await opened.takeOut(name, want); }
                catch { checkpoint(); /* the bag is full: what fitted is counted below */ }
                await opened.settle();
            }
            const got = had - countIn(opened.slots(), name);
            if (got > 0) { taken.push({ chest, count: got }); total += got; }
            if (got < want) bagFull = true;
            Object.assign(chest, beliefOf(opened.slots()));
        });
        if (!result.ok) skipped.push({ chest, reason: result.reason });
    }
    return { taken, total, skipped, bagFull };
}
