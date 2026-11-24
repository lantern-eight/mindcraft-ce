// SPDX-License-Identifier: CC0-1.0
// The bot's hands on a furnace: opening it, reading its three slots, putting in and taking out, closing
// it. The only file in smelting that touches a window.
//
// Mineflayer's own furnace calls can wait for ever. Opening waits for the server to send a window, with no
// limit, so a furnace that never opens (one that was just broken, a server that lags or refuses) hangs the
// action and the agent with it. So every call here is given a deadline, and a window that turns up after
// the bot stopped waiting is closed again at once: a window left open makes the next open fail.
//
// Counts are read from the furnace's slots, before and after: what a call says it did isn't taken on
// trust. The bot's own inventory is not read while the window is open. On Java mineflayer copies it back
// only when the window closes, so until then it shows what the bot had before.
//
// On both editions the window offers the same calls (`putInput`, `putFuel`, `takeInput`, `takeFuel`,
// `takeOutput`): on Bedrock the library makes them item stack requests, so nothing here depends on the
// edition.
import { cleanName } from './recipes.js';

const SLOT = Object.freeze({ input: 0, fuel: 1, output: 2 });
const TAKE = Object.freeze({ input: 'takeInput', fuel: 'takeFuel', output: 'takeOutput' });
const PUT = Object.freeze({ input: 'putInput', fuel: 'putFuel' });

/** `promise`, or an error saying `what` when it takes longer than `ms`. */
function within(promise, ms, what) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(what), { late: true })), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A slot's stack as `{name, count}`, or null when it is empty. */
function stackIn(window, which) {
    const item = window?.slots?.[SLOT[which]];
    return item?.name && item.count > 0 ? { name: cleanName(item.name), count: item.count } : null;
}

/**
 * @param {object} bot - the mineflayer bot
 * @param {object} [options]
 * @param {number} [options.openTimeoutMs] - how long a furnace gets to open
 * @param {number} [options.stepTimeoutMs] - how long one put or take gets
 * @param {number} [options.settleMs] - a pause after each put or take, for the server's answer to land
 * @param {(ms: number) => Promise<void>} [options.wait]
 */
export function furnaceHands(bot, { openTimeoutMs = 4000, stepTimeoutMs = 4000, settleMs = 150,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const itemId = name => {
        const id = bot.registry?.itemsByName?.[name]?.id;
        if (id === undefined) throw new Error(`there is no item called ${name}`);
        return id;
    };
    const shut = window => {
        try { if (window && bot.currentWindow === window) bot.closeWindow(window); }
        catch { /* already gone */ }
    };

    return {
        /**
         * Opens a furnace. Gives `{furnace}`, or `{problem}`, a sentence saying why not. Never hangs and never
         * leaves a window open behind it.
         * @param {object} block - the furnace, as the bot knows it
         */
        async open(block) {
            // A window some other code left open makes this one never arrive.
            if (bot.currentWindow) shut(bot.currentWindow);
            let opening;
            try {
                opening = Promise.resolve().then(() => bot.openFurnace(block));
                const window = await within(opening, openTimeoutMs, 'it did not open');
                return { furnace: handle(window) };
            } catch (error) {
                // Should it open after all, once the bot has given up on it, it is closed again.
                opening?.then(late => shut(late), () => {});
                return { problem: error?.late ? 'it did not open' : (error?.message ?? String(error)) };
            }
        },
    };

    function handle(window) {
        let closed = false;
        const step = async (promise, what) => {
            try { await within(promise, stepTimeoutMs, what); }
            catch (error) { if (!error?.late) throw error; }
            if (settleMs > 0) await wait(settleMs);
        };
        return {
            /** What is in each slot now: `{input, fuel, output}`, each `{name, count}` or null. */
            slots: () => ({ input: stackIn(window, 'input'), fuel: stackIn(window, 'fuel'), output: stackIn(window, 'output') }),

            /**
             * Puts up to `count` of an item from the bot's inventory into the input or the fuel slot. Gives
             * how many went in, read from the slot.
             * @param {'input'|'fuel'} which
             */
            async put(which, name, count) {
                if (!(count > 0)) return 0;
                const before = stackIn(window, which);
                if (before && before.name !== name) return 0;
                const inSlot = () => { const now = stackIn(window, which); return now?.name === name ? now.count : 0; };
                // One stack at a time: Bedrock's library moves from the first stack of the item it finds,
                // and is refused when asked for more than that stack holds. Java's takes from several.
                for (let tries = 0; tries < 4 && inSlot() - (before?.count ?? 0) < count; tries++) {
                    const left = count - (inSlot() - (before?.count ?? 0));
                    const first = bot.inventory?.items?.().find(item => item.name === name)?.count ?? left;
                    const was = inSlot();
                    try { await step(window[PUT[which]](itemId(name), null, Math.min(left, first)), `the ${which} did not go in`); }
                    catch (error) { console.warn(`[smelting] Putting ${left} ${name} in the furnace:`, error?.message ?? error); }
                    if (inSlot() === was) break;
                }
                return Math.max(0, inSlot() - (before?.count ?? 0));
            },

            /**
             * Takes everything out of one slot into the bot's inventory. Gives `{name, count}` of what came
             * out, read from the slot, or null when nothing did.
             * @param {'input'|'fuel'|'output'} which
             */
            async take(which) {
                const before = stackIn(window, which);
                if (!before) return null;
                try { await step(window[TAKE[which]](), `the ${which} did not come out`); }
                catch (error) { console.warn(`[smelting] Taking the furnace's ${which}:`, error?.message ?? error); }
                const after = stackIn(window, which);
                const count = before.count - (after?.name === before.name ? after.count : 0);
                return count > 0 ? { name: before.name, count } : null;
            },

            /**
             * Takes up to `count` out of one slot, leaving the rest: the bot's own share of fuel that was
             * partly someone else's. Gives how many came out.
             */
            async takeSome(which, count) {
                const before = stackIn(window, which);
                if (!before || !(count > 0)) return 0;
                if (count >= before.count) return (await this.take(which))?.count ?? 0;
                // A part of a stack can't be taken in one call: take it all, then put the rest back.
                const took = await this.take(which);
                if (!took) return 0;
                const back = await this.put(which, took.name, took.count - count);
                return took.count - back;
            },

            async close() {
                if (closed) return;
                closed = true;
                shut(window);
            },
        };
    }
}
