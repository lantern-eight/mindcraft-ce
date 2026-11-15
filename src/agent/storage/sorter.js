// SPDX-License-Identifier: CC0-1.0
// The doing half of chest sorting: look in every chest, have a plan made, and carry it out.
//
// A plan (sort_plan.js) is worked out from what the chests held when the bot looked. By the time the
// bot is back at a chest a player may have taken something out, the server may have made a click come
// out differently, or the chest may be gone. So a plan is never trusted further than the next move:
//   - before working in a chest, the bot checks the chest is as it remembers;
//   - after each move, it checks the move did what the plan said;
//   - before closing, it asks the server what is really there.
// When anything differs it believes its eyes, puts down what it is carrying, and plans again from what
// is really there. After a few such surprises it stops, instead of circling a chest for ever.
//
// Nothing here touches the game. Chests are reached through "hands" that are handed in (bot_hands.js
// has the real ones), so all of this runs in tests against a fake room.
import { applyMoves, planSort } from './sort_plan.js';

const alike = (a, b) => (!a || !b ? !a && !b : a.key === b.key && a.count === b.count);
const allAlike = (a, b) => a.length === b.length && a.every((stack, i) => alike(stack, b[i]));
const stacksIn = slots => slots.filter(Boolean).length;

/** A plan's moves as visits: each run of moves made in one chest, which is one walk and one opening. */
function visitsOf(moves) {
    const visits = [];
    for (const move of moves) {
        if (visits.at(-1)?.chest !== move.chest) visits.push({ chest: move.chest, moves: [] });
        visits.at(-1).moves.push(move);
    }
    return visits;
}

/**
 * Sorts a set of chests.
 *
 * @param {{id: *}[]} chests - the chests, nearest first. Only `id` is used here; the rest of each
 *   entry is for the hands, which know how to get to it.
 * @param {object} options
 * @param {object} options.hands - how the chests are handled:
 *   `free()` how many stacks the bot can carry; `held()` what it is carrying, with no chest open;
 *   `open(chest)` goes to a chest and opens it (rejects, with the reason, when it cannot), giving
 *   `slots()` and `bag()` (what the bot sees in the chest and in its hands), `move(op, from, to)` (one
 *   move of the plan), `settle()` (asks the server what is really there) and `close()`.
 * @param {(name: string) => number} [options.stackSize] - how many of an item fit in a slot
 * @param {(name: string) => string} [options.groupOf] - see planSort
 * @param {string[]} [options.groupOrder] - see planSort
 * @param {number} [options.maxReplans] - how many times it will plan again after a surprise
 * @param {() => void} [options.checkpoint] - called before each step; throws when the sort is cancelled
 * @returns {Promise<{chests: object[], skipped: object[], moves: number, visits: number, replans: number,
 *   stacksBefore: number, stacksAfter: number, carrying: object[], done: boolean}>}
 *   `chests` are the ones sorted, each with the `slots` it now holds; `skipped` those that would not
 *   open, each with a `reason`; `carrying` is what was left in the bot's hands when it had to stop;
 *   `done` says whether the chests are in order.
 */
export async function runSort(chests, { hands, stackSize = () => 64, groupOf, groupOrder, maxReplans = 3, checkpoint = () => {} } = {}) {
    const carry = hands.free();
    const known = new Map();                  // chest id -> { chest, slots, before }: what the bot believes is in it
    let bag = new Array(carry).fill(null);    // and what it believes it is carrying
    let at = null;                            // the chest it was last at
    const report = { chests: [], skipped: [], moves: 0, visits: 0, replans: 0, stacksBefore: 0, stacksAfter: 0, carrying: [], done: false };

    const leaveOut = (chest, error) => {
        known.delete(chest.id);
        report.skipped.push({ ...chest, reason: error?.message || String(error) });
    };
    /** Goes to a chest and opens it. One that will not open is left out of the sort from here on. */
    const open = async chest => {
        checkpoint();
        try {
            const win = await hands.open(chest);
            at = chest.id;
            return win;
        } catch (error) {
            checkpoint();       // a cancelled sort is not a chest that would not open
            leaveOut(chest, error);
            return null;
        }
    };

    // Some servers allow a stack bigger than the game's own data says. The plan and the checking of
    // each move have to agree on how much fits in a slot, so both ask this, which goes by the biggest
    // stack the bot has actually seen.
    const biggest = new Map();
    const measure = () => {
        biggest.clear();
        const note = stack => { if (stack && stack.count > (biggest.get(stack.name) ?? 0)) biggest.set(stack.name, stack.count); };
        for (const entry of known.values()) entry.slots.forEach(note);
        bag.forEach(note);
    };
    const sizeOf = name => {
        const told = Math.floor(Number(stackSize(name)));
        return Math.max(told >= 1 ? told : 64, biggest.get(name) ?? 0);
    };

    /**
     * Is the chest, and what the bot carries, as the bot believes? A glance at its own copy of the window
     * comes first, since that costs nothing; `sure` asks the server before looking. When what it sees
     * still differs, it believes its eyes from here on and the answer is no.
     */
    const asBelieved = async (win, entry, sure = false) => {
        const matches = () => allAlike(win.slots(), entry.slots) && allAlike(win.bag(), bag);
        if (sure) await win.settle();
        if (matches()) return true;
        if (!sure) {
            await win.settle();
            if (matches()) return true;
        }
        entry.slots = win.slots();
        bag = win.bag();
        return false;
    };

    /** Carries a plan out, visit by visit. False as soon as something is not as the plan expects. */
    const carryOut = async plan => {
        for (const visit of visitsOf(plan.moves)) {
            const entry = known.get(visit.chest);
            const win = await open(entry.chest);
            if (!win) return false;
            report.visits++;
            try {
                if (!(await asBelieved(win, entry))) return false;
                for (const move of visit.moves) {
                    checkpoint();
                    // What the move should lead to. A move that cannot even be made on paper is a
                    // mistake in the plan, not a surprise in the world, and must not be passed over.
                    let after;
                    try { after = applyMoves([{ id: move.chest, slots: entry.slots }], [move], { stackSize: sizeOf, bag }); }
                    catch (error) { throw Object.assign(error, { planning: true }); }
                    await win.move(move.op, move.from, move.to);
                    report.moves++;
                    entry.slots = after.chests[0].slots;
                    bag = after.bag;
                    if (!(await asBelieved(win, entry))) return false;
                }
                if (!(await asBelieved(win, entry, true))) return false;
            } catch (error) {
                if (error?.planning) throw error;
                checkpoint();
                // The chest closed under the bot's hands, or a click failed outright. What the chest
                // holds now is anyone's guess, so it is left out; what the bot holds, it can see.
                leaveOut(entry.chest, error);
                await win.close();
                bag = hands.held();
                return false;
            } finally {
                await win.close();
            }
        }
        return true;
    };

    /**
     * Empties the bot's hands into whatever free slots the chests have, so that a new plan can start
     * from the chests alone. This is the careful path, taken after a surprise: it reads the chest again
     * before every stack it puts down. Says whether its hands are empty now.
     */
    const putDown = async () => {
        // The chest it is standing at first: that is usually where the stacks came from.
        const order = [...known.values()].sort((a, b) => (b.chest.id === at) - (a.chest.id === at));
        for (const entry of order) {
            if (!bag.some(Boolean)) break;
            if (!known.has(entry.chest.id) || !entry.slots.includes(null)) continue;
            const win = await open(entry.chest);
            if (!win) continue;
            report.visits++;
            try {
                await win.settle();
                for (let hand = 0; hand < bag.length; hand++) {
                    entry.slots = win.slots();
                    bag = win.bag();
                    const spot = entry.slots.indexOf(null);
                    if (spot < 0) break;
                    if (!bag[hand]) continue;
                    checkpoint();
                    await win.move('put', hand, spot);
                    report.moves++;
                }
                await win.settle();
                entry.slots = win.slots();
                bag = win.bag();
            } catch (error) {
                checkpoint();
                leaveOut(entry.chest, error);
                await win.close();
                bag = hands.held();
            } finally {
                await win.close();
            }
        }
        return !bag.some(Boolean);
    };

    // Look in every chest first, as a player would before deciding where things go. Memory of a chest
    // is not enough here: it keeps how many of each item there were, not which slot each stack was in.
    for (const chest of chests) {
        const win = await open(chest);
        if (!win) continue;
        try {
            const slots = win.slots();
            known.set(chest.id, { chest, slots, before: stacksIn(slots) });
        } finally {
            await win.close();
        }
    }

    while (known.size) {
        measure();
        const plan = planSort([...known.values()].map(({ chest, slots }) => ({ id: chest.id, slots })),
            { stackSize: sizeOf, groupOf, groupOrder, carry });
        if (!plan.moves.length || (await carryOut(plan))) {
            report.done = plan.complete;
            break;
        }
        // Something was not as expected. Start again from what is really there, with empty hands. With
        // nowhere to put what it carries there is nothing more it can safely do.
        if (!(await putDown()) || report.replans >= maxReplans) break;
        report.replans++;
    }

    for (const { chest, slots, before } of known.values()) {
        report.chests.push({ ...chest, slots });
        report.stacksBefore += before;
        report.stacksAfter += stacksIn(slots);
    }
    report.carrying = bag.filter(Boolean);
    return report;
}
