// SPDX-License-Identifier: CC0-1.0
// Filing the inbox: the chest players drop things into, for the bot to put where they belong.
//
// A shared base often has one chest by the door where everyone empties their bag, and somebody files it
// later. That is the job here, done the way a player does it: open the inbox, take out what fits in the
// bag, carry it to the chests where those things go (by the same rules as putting away, stow.js), come
// back for the rest. What fits nowhere goes back into the inbox, so nothing ends up stuck in the bot's
// bag, and the inbox keeps what it could not file for a player to deal with.
//
// Only what came out of the inbox is put away. The bot's own things stay with it, even of a kind the inbox
// also held: the keep plan has no say over things that were never the bot's (D13 in the notes), and the
// bot never puts away its own pickaxe because it was filing someone's pickaxes.
//
// Nothing touches the game here directly: it is handed "hands" (bot_hands.js), as stow.js is.
import { putAway } from './stow.js';
import { walkOrder } from './stow_plan.js';

/** How many trips to an inbox, at most: each carries a bagful, so this is a lot of filing. */
export const MAX_TRIPS = 8;

const countIn = (stacks, name) => stacks.reduce((n, stack) => n + (stack?.name === name ? stack.count : 0), 0);
const kindsIn = stacks => [...new Set(stacks.filter(Boolean).map(stack => stack.name))];
const add = (into, name, n) => { if (n > 0) into[name] = (into[name] ?? 0) + n; };
/** The bot's own slots (9 to 44) that hold an item, as an open window shows them. */
const slotsHolding = (pockets, name) => pockets.map((stack, i) => (stack?.name === name ? 9 + i : null)).filter(slot => slot !== null);

/**
 * Opens a chest, hands it to `use`, and closes it again whatever happens.
 * @returns {Promise<{ok: boolean, reason?: string, value?: *}>}
 */
async function visit(hands, chest, checkpoint, use) {
    checkpoint();
    let opened;
    try { opened = await hands.open(chest); }
    catch (error) {
        checkpoint();
        return { ok: false, reason: error?.message ?? String(error) };
    }
    try { return { ok: true, value: await use(opened) }; }
    finally { await opened.close(); }
}

/**
 * Takes as much as the bag holds out of an open inbox, leaving the kinds in `skip` (already found to fit
 * nowhere). Returns what came out by kind, the bag slots now holding each, and whether the bag left some.
 */
async function takeAll(opened, skip) {
    const taken = {};
    let short = false;
    for (const name of kindsIn(opened.slots()).filter(name => !skip.has(name))) {
        const had = countIn(opened.slots(), name);
        try { await opened.takeOut(name, had); }
        catch { /* the bag is full: what fitted is counted below */ }
        await opened.settle();
        const got = had - countIn(opened.slots(), name);
        add(taken, name, got);
        if (got < had) short = true;
    }
    const slots = Object.fromEntries(Object.keys(taken).map(name => [name, slotsHolding(opened.pockets(), name)]));
    return { taken, short, slots };
}

/** Puts back into an open inbox what could not be filed. Returns what would not go back (the inbox is full). */
async function putBack(opened, left) {
    const stuck = {};
    for (const [name, count] of Object.entries(left)) {
        const before = countIn(opened.slots(), name);
        let asked = 0;
        for (const slot of slotsHolding(opened.pockets(), name)) {
            if (asked >= count) break;
            const n = Math.min(opened.pockets()[slot - 9]?.count ?? 0, count - asked);
            if (!(n > 0)) continue;
            asked += n;
            try { await opened.putSlot(slot, n); }
            catch { break; }
        }
        await opened.settle();
        add(stuck, name, count - Math.max(0, countIn(opened.slots(), name) - before));
    }
    return stuck;
}

/**
 * Files what is in the inboxes into the other chests.
 * @param {object[]} inboxes - the inbox chests it may take from, as found
 * @param {object[]} chests - the chests it may put into, as putAway takes them (each with `holds`, so the
 *   inbox and chests for something else are kept out)
 * @param {object} options
 * @param {object} options.hands
 * @param {{x: number, y: number, z: number}} options.from
 * @param {(name: string) => number} [options.stackSize]
 * @param {(name: string) => string} [options.groupOf]
 * @param {() => void} [options.checkpoint]
 * @param {number} [options.trips]
 * @returns {Promise<{filed: {chest: object, items: Object<string, number>}[], back: {chest: object, items: Object<string, number>}[],
 *   carrying: Object<string, number>, skipped: {chest: object, reason: string}[], more: boolean}>} `back` is what went
 *   back into each inbox because no chest had room for it; `carrying` is what would not even go back; `more` says
 *   an inbox still holds things it did not get to
 */
export async function fileInbox(inboxes, chests, { hands, from, stackSize = () => 64, groupOf, checkpoint = () => {}, trips = MAX_TRIPS }) {
    const filed = new Map(), back = [], skipped = [], carrying = {};
    let more = false;
    const note = (chest, items) => {
        if (!filed.has(chest.id)) filed.set(chest.id, { chest, items: {} });
        for (const [name, n] of Object.entries(items)) add(filed.get(chest.id).items, name, n);
    };

    for (const inbox of walkOrder(from, inboxes)) {
        const returned = {};
        const nowhere = new Set();      // kinds no chest had room for: not taken out again
        for (let trip = 0; ; trip++) {
            if (trip >= trips) { more = true; break; }
            // Take out what fits in the bag.
            const took = await visit(hands, inbox, checkpoint, opened => takeAll(opened, nowhere));
            if (!took.ok) { skipped.push({ chest: inbox, reason: took.reason }); break; }
            const { taken, short, slots } = took.value;
            if (!Object.keys(taken).length) {
                // Nothing came out: an empty inbox, or a bag with no room for any of it.
                if (short) more = true;
                break;
            }

            // Carry it where it belongs. Only what came out of the inbox goes: putAway moves a count, so the
            // bot's own stack of the same kind keeps what it had.
            const items = Object.entries(taken).map(([name, count]) => ({ name, count, slots: slots[name] }));
            const report = await putAway(chests, { items, hands, from: inbox, stackSize, groupOf, checkpoint });
            for (const { chest, items: put } of report.stored) note(chest, put);
            skipped.push(...report.skipped.filter(s => !skipped.some(t => t.chest.id === s.chest.id)));

            // What fits nowhere goes back where it came from.
            const left = {};
            for (const { name, count } of report.left) { add(left, name, count); nowhere.add(name); }
            if (Object.keys(left).length) {
                const went = await visit(hands, inbox, checkpoint, opened => putBack(opened, left));
                const stuck = went.ok ? went.value : left;
                for (const [name, n] of Object.entries(left)) add(returned, name, n - (stuck[name] ?? 0));
                for (const [name, n] of Object.entries(stuck)) add(carrying, name, n);
            }
            // A trip that filed nothing will not file anything the next time either. Otherwise go back for
            // more only when the bag was what stopped it.
            if (!report.stored.length || !short) {
                if (short) more = true;
                break;
            }
        }
        if (Object.keys(returned).length) back.push({ chest: inbox, items: returned });
    }
    return { filed: [...filed.values()], back, carrying, skipped, more };
}
