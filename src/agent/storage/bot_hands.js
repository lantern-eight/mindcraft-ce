// SPDX-License-Identifier: CC0-1.0
// The bot's hands on a real chest: getting to it, opening it, reading what is in each slot, clicking.
// This is the only file in chest sorting that touches the bot's windows.
//
// One move of the sort plan is three left clicks, the way a player makes it with the mouse: pick the
// stack up, click the other slot, and put back whatever is on the cursor after that. (mineflayer has a
// helper for this, but it looks for the cursor on the bot's own inventory, which is not where the
// cursor is while a chest is open, so a swap would leave a stack hanging in the air.)
//
// The bot carries chest items only in main inventory slots that were empty when the sort began, and
// never in the hotbar. What it was holding and carrying before stays exactly where it was. Stacks are
// clicked into a chosen empty slot, never shift-clicked, so they cannot pour into the bot's own stacks
// of the same item.
//
// The bot's side of a window is a guess: it works out what each click did without waiting for the
// server, and for some items it guesses wrong. `settle` asks the server to send the whole window
// again, which is the truth, and tidies up a stack left on the cursor by a wrong guess.
import { createHash } from 'node:crypto';
import { onActionCleanup } from '../action_context.js';

// The bot's main inventory, in its own slot numbers. The nine hotbar slots follow it.
const MAIN_START = 9, MAIN_END = 36;
// How long to wait for the server to correct the bot's copy of a window, when it cannot be asked outright.
const QUIET_MS = 250;
// A chest this close to the bot's eyes is opened from where the bot stands. A little under what the
// game allows, so a chest right at the edge is walked up to instead of missed.
const ARMS_REACH = 4;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const jsonSafe = (_, value) => (typeof value === 'bigint' ? `${value}n` : value);
const typeOf = part => (part && typeof part === 'object' ? String(part.type) : String(part));

/**
 * A stack as the sort plan wants it, from one of the bot's item objects. `key` tells apart items that
 * share a name but would not stack in the game: a worn pickaxe and a new one, two different potions,
 * a sword somebody named. Stacks pour together only when their keys match.
 * @returns {{name: string, count: number, key: string}|null} null for an empty slot
 */
export function stackOf(item) {
    if (!item?.name || !(item.count > 0)) return null;
    const { name, count } = item;
    const components = item.components ?? [], removed = item.removedComponents ?? [];
    // Newer game versions say what is special about an item in its components, older ones in its nbt.
    // Where there are components, the nbt is something the bot's own item code fills in (every tool
    // gets a "Damage: 0"), not something the server said, so it is left out: a new pickaxe is plain.
    const nbt = Array.isArray(item.components) ? null : item.nbt ?? null;
    if (!item.metadata && !nbt && !components.length && !removed.length) return { name, count, key: name };
    // Everything that makes this item different from a plain one, in a fixed order so that the same
    // thing always gives the same key. Only a short fingerprint is kept: a written book is long.
    const byType = list => [...list].sort((a, b) => compare(typeOf(a), typeOf(b)));
    const detail = JSON.stringify([item.metadata || 0, nbt, byType(components), byType(removed)], jsonSafe);
    return { name, count, key: `${name}#${createHash('sha1').update(detail).digest('hex').slice(0, 12)}` };
}

/** `promise`, or an error saying `what` when it takes longer than `ms`. */
function within(promise, ms, what) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what)), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The hands the sorter works with (see runSort in sorter.js), on a mineflayer bot.
 *
 * @param {object} bot - the mineflayer bot
 * @param {object} options
 * @param {(chest: object) => Promise<void>} options.goTo - walks to a chest; rejects when it cannot get there
 * @param {(pos: {x: number, y: number, z: number}) => object|null} options.blockAt - the block at a
 *   spot, as far as the bot may know it
 * @param {(name: string) => boolean} [options.isChest] - is a block of this name one of the chests being sorted?
 * @param {number} [options.reach] - how near a chest has to be for the bot to open it without walking
 * @param {number} [options.openTimeoutMs] - how long a chest gets to open. One with a block on top never does
 * @param {number} [options.syncTimeoutMs] - how long the server gets to send a window again
 * @param {number} [options.pauseMs] - the pause after each move, so the clicks come no faster than a
 *   quick player's
 * @param {(ms: number) => Promise<void>} [options.wait]
 */
export function botHands(bot, { goTo, blockAt, isChest = () => true, reach = ARMS_REACH, openTimeoutMs = 4000, syncTimeoutMs = 1500,
    pauseMs = 100, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    // Decided once, at the start: a slot that fills up later (something picked up on the way) is then
    // noticed as a surprise instead of quietly changing which slot is which.
    const handSlots = [];
    const own = bot.inventory.slots;
    for (let slot = MAIN_START; slot < MAIN_END; slot++) if (!own[slot]) handSlots.push(slot);
    const where = pos => `${pos.x}, ${pos.y}, ${pos.z}`;

    /** Is the block at `pos` within arm's reach of the bot's eyes, measured to the nearest point of the block? */
    const inReach = pos => {
        const feet = bot.entity?.position;
        if (!feet) return false;
        const eye = { x: feet.x, y: feet.y + (bot.entity.eyeHeight ?? 1.62), z: feet.z };
        const gap = axis => Math.max(pos[axis] - eye[axis], 0, eye[axis] - (pos[axis] + 1));
        return Math.hypot(gap('x'), gap('y'), gap('z')) <= reach;
    };
    /** Opens whichever half of the chest will open. Gives the window, or the reason there is none. */
    const tryOpen = async halves => {
        let problem = null;
        for (const pos of halves) {
            const block = blockAt(pos);
            if (!block || !isChest(block.name)) {
                problem ??= new Error(`there is no chest at ${where(pos)} any more`);
                continue;
            }
            const opening = bot.openContainer(block);
            try {
                return { window: await within(opening, openTimeoutMs, 'it did not open') };
            } catch (error) {
                problem = error;
                // Should it open after all once the bot has given up on it, it is closed again.
                opening.then(late => late?.close?.(), () => {});
            }
        }
        return { problem };
    };

    return {
        /** How many stacks the bot can carry between chests. */
        free: () => handSlots.length,
        /** What is in the bot's hand slots, read from its own inventory. For when no chest is open. */
        held: () => { const slots = bot.inventory.slots; return handSlots.map(slot => stackOf(slots[slot])); },

        async open(chest) {
            // Either half of a double chest opens it, and one half may be in view where the other is not.
            const halves = [chest, chest.also].filter(Boolean);
            // A walk that fails still counts when it brought the chest within reach.
            const walkUp = async () => {
                try { await goTo(chest); }
                catch (error) { if (!halves.some(inReach)) throw error; }
            };
            // A player sorting a room of chests does not step up to each one: most are within reach of
            // where they stand. So the bot walks only to a chest it cannot reach, or one that would not
            // open from where it is (out of sight behind another, say).
            const near = halves.some(inReach);
            if (!near) await walkUp();
            let { window, problem } = await tryOpen(halves);
            if (!window && near) {
                await walkUp();
                ({ window, problem } = await tryOpen(halves));
            }
            if (!window) throw problem;

            const start = window.inventoryStart;                    // the chest's slots come first in its window
            const inWindow = slot => start + slot - MAIN_START;     // one of the bot's own slots, as the window numbers it
            let last = null;                                        // the slot the last move picked up from
            // A cancelled sort closes the chest there and then. It is not left open on the bot.
            const shut = () => { if (bot.currentWindow === window) window.close(); };
            const forget = onActionCleanup(bot, shut);
            const sync = async () => {
                if (typeof bot._syncWindow === 'function') {
                    try { return await within(bot._syncWindow(window), syncTimeoutMs, 'the server did not answer'); }
                    catch { /* wait it out instead */ }
                }
                await wait(QUIET_MS);
            };

            return {
                slots: () => { const all = window.slots; return Array.from({ length: start }, (_, i) => stackOf(all[i])); },
                bag: () => { const all = window.slots; return handSlots.map(slot => stackOf(all[inWindow(slot)])); },
                async move(op, from, to) {
                    const a = op === 'put' ? inWindow(handSlots[from]) : from;
                    const b = op === 'take' ? inWindow(handSlots[to]) : to;
                    last = a;
                    await bot.clickWindow(a, 0, 0);
                    await bot.clickWindow(b, 0, 0);
                    if (window.selectedItem) await bot.clickWindow(a, 0, 0);
                    if (pauseMs > 0) await wait(pauseMs);
                },
                async settle() {
                    await sync();
                    if (!window.selectedItem) return;
                    // The bot guessed a click wrong and stopped a click short, so a stack is still on the
                    // cursor. It goes back where the move began, or failing that into any empty slot.
                    const all = window.slots;
                    const candidates = [last, ...Array.from({ length: start }, (_, i) => i), ...handSlots.map(inWindow)];
                    const empty = candidates.find(slot => slot !== null && !all[slot]);
                    if (empty === undefined) return;    // nowhere at all: closing hands it to the bot's inventory
                    await bot.clickWindow(empty, 0, 0);
                    await sync();
                },
                async close() {
                    forget();
                    shut();
                },
            };
        },
    };
}
