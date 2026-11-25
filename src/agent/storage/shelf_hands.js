// SPDX-License-Identifier: CC0-1.0
// The bot's hands on a shelf: getting in front of it, seeing what is on it, and taking things off it.
// This is the only file in chest storage that clicks a shelf.
//
// A shelf has no window. What is on it shows on its front, and a player moves things with one click of
// the hand on the slot they want: an empty hand takes the whole stack, a held stack goes into an empty
// slot, and two stacks swap whole. So taking from a shelf is: stand in front of it, hold nothing, click
// the slot. To take part of a stack, the whole stack comes off, the part wanted is split off in the bag,
// and the rest goes back with a second click, as a player would do it.
//
// Putting onto a shelf is the same click with the stack in hand, into an empty slot: a click on a full
// slot would swap the two stacks, so that is never done. Exactly the number to put has to be in the hand
// first, so a part of a stack is split off in the bag, and one in the main inventory is brought to the
// hotbar. Which shelves are put onto at all is decided by the caller: one a player has said is for
// something (see stow_commands.js).
//
// The hands give putting away and fetching (stow.js) the same shape a chest's do (bot_hands.js): `open` a
// shelf, read its `slots` and the bot's `pockets`, `takeOut` an item or `putSlot` one, `settle`, `close`.
//
// A powered shelf is never clicked: one click on it swaps the bot's whole hotbar with what is on it.
//
// Which point of the shelf's front to click, and how a part of a stack is moved in the bag, depend on
// the edition of the game, so they are asked of the edition seam (clickShelfSlot, moveInBag).
import { onActionCleanup } from '../action_context.js';
import { editionOf } from '../edition/index.js';

const HOTBAR_START = 36, HOTBAR_END = 45, MAIN_START = 9;
// A shelf this close to the bot's eyes is clicked from where the bot stands, as for a chest.
const ARMS_REACH = 4;
// Where the front of a shelf facing each way is: one step that way from the shelf.
const FRONT = { south: { x: 0, z: 1 }, north: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/**
 * Is a point in front of a shelf's front face: past the plane of that face, on the side it faces? A
 * player has to be there to see what is on it and to click it.
 */
export function inFrontOf(shelf, facing, point) {
    switch (facing) {
        case 'south': return point.z > shelf.z + 1;
        case 'north': return point.z < shelf.z;
        case 'east': return point.x > shelf.x + 1;
        case 'west': return point.x < shelf.x;
        default: return false;
    }
}

/** The cell right in front of a shelf, which the bot walks to; null when the way it faces is unknown. */
export function frontOf(shelf, facing) {
    const step = FRONT[facing];
    return step ? { x: shelf.x + step.x, y: shelf.y, z: shelf.z + step.z } : null;
}

/**
 * The hands fetching works with on shelves, on a mineflayer bot.
 *
 * @param {object} bot
 * @param {object} options
 * @param {(cell: {x: number, y: number, z: number}) => Promise<void>} options.goTo - walks to within a
 *   block of a cell; rejects when it cannot get there
 * @param {(pos: {x: number, y: number, z: number}) => object|null} options.blockAt - the block at a spot,
 *   as far as the bot may know it
 * @param {object} [options.edition] - the edition seam's answers; the bot's own by default
 * @param {number} [options.reach]
 * @param {number} [options.answerMs] - how long the server gets to answer a click
 * @param {(ms: number) => Promise<void>} [options.wait]
 */
export function shelfHands(bot, { goTo, blockAt, edition = null, reach = ARMS_REACH, answerMs = 2000,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const seam = () => edition ?? editionOf(bot.registry);
    const slots = () => bot.inventory.slots;
    const eye = () => {
        const feet = bot.entity?.position;
        return feet ? { x: feet.x, y: feet.y + (bot.entity.eyeHeight ?? 1.62), z: feet.z } : null;
    };
    const inReach = pos => {
        const from = eye();
        if (!from) return false;
        const gap = axis => Math.max(pos[axis] - from[axis], 0, from[axis] - (pos[axis] + 1));
        return Math.hypot(gap('x'), gap('y'), gap('z')) <= reach;
    };
    /** Waits until `done()` holds, or the server has had its time to answer. Says whether it held. */
    const until = async done => {
        for (const end = Date.now() + answerMs; Date.now() < end;) {
            if (done()) return true;
            await wait(50);
        }
        return done();
    };
    const emptyIn = (start, end, not = []) => {
        for (let slot = start; slot < end; slot++) if (!slots()[slot] && !not.includes(slot)) return slot;
        return null;
    };

    return {
        async open(shelf) {
            const where = `${shelf.x}, ${shelf.y}, ${shelf.z}`;
            const look = () => {
                const block = blockAt(shelf);
                const shown = block ? seam().shelfOf(block) : null;
                if (!shown) throw new Error(`there is no shelf at ${where} any more`);
                return { block, shown };
            };
            let { shown } = look();
            if (shown.powered) throw new Error('it is powered: a click on it would swap your whole hotbar with what is on it');
            // In front of it and within reach, or a walk to the cell in front of it.
            const ready = () => inFrontOf(shelf, shown.facing, eye() ?? shelf) && inReach(shelf);
            if (!ready()) {
                const front = frontOf(shelf, shown.facing);
                if (!front) throw new Error('there is no telling which way it faces');
                try { await goTo(front); }
                catch (error) { if (!ready()) throw error; }
                if (!ready()) throw new Error('could not get in front of it');
            }
            ({ shown } = look());
            if (!shown.slots) throw new Error('what is on it has not come through yet');

            const selected = bot.quickBarSlot ?? 0;
            const restore = () => { if (bot.quickBarSlot !== selected) bot.setQuickBarSlot(selected); };
            const forget = onActionCleanup(bot, restore);

            /** What is on the shelf now, as the bot sees it: three slots, an empty one null. */
            const onShelf = () => (look().shown.slots ?? [null, null, null]).map(stack => (stack ? { ...stack, key: stack.name } : null));
            const click = async slot => {
                const { block, shown: now } = look();
                if (now.powered) throw new Error('it became powered: a click on it would swap your whole hotbar');
                await seam().clickShelfSlot(bot, block, slot);
            };
            const move = async (from, to, count) => {
                await seam().moveInBag(bot, from, to, count);
                return until(() => !slots()[from] || slots()[to]?.count >= count);
            };

            /** One of the bot's slots in its hand, holding exactly `count`. Gives the hotbar slot, and how to undo it. */
            const inHand = async (slot, count) => {
                const item = slots()[slot];
                let hand = slot, swapped = null;
                if (slot < HOTBAR_START) {
                    // From the main inventory to the hotbar: into an empty slot of it, or swapped with one.
                    hand = emptyIn(HOTBAR_START, HOTBAR_END);
                    if (hand === null) {
                        if (count < item.count) throw new Error('your inventory has no room to split the stack');
                        hand = HOTBAR_START + ((selected + 1) % 9);
                        swapped = { hand, back: slot };
                    }
                    await seam().moveInBag(bot, slot, hand, swapped ? item.count : count);
                    if (!(await until(() => slots()[hand]?.name === item.name && (swapped || slots()[hand].count === count)))) throw new Error('could not bring it to your hand');
                } else if (count < item.count) {
                    // Part of a stack in the hotbar: the rest is split off and stays in the bag.
                    const spare = emptyIn(MAIN_START, HOTBAR_END, [slot]);
                    if (spare === null) throw new Error('your inventory has no room to split the stack');
                    if (!(await move(slot, spare, item.count - count)) || slots()[slot]?.count !== count) throw new Error('could not split the stack');
                }
                return { hand, swapped };
            };

            return {
                slots: onShelf,
                /** All of the bot's own slots: index 0 is its slot 9, the last its slot 44. */
                pockets: () => Array.from({ length: 36 }, (_, i) => { const item = slots()[MAIN_START + i]; return item ? { name: item.name, count: item.count, key: item.name } : null; }),
                /**
                 * Puts `count` from one of the bot's own slots (9 to 44) into an empty slot of the shelf, as
                 * one stack. Rejects when the shelf has no empty slot, having put nothing.
                 */
                async putSlot(slot, count) {
                    const item = slots()[slot];
                    if (!item || !(count > 0)) return;
                    const into = onShelf().findIndex(stack => !stack);
                    if (into < 0) throw new Error('the shelf is full');
                    const { hand, swapped } = await inHand(slot, Math.min(count, item.count));
                    bot.setQuickBarSlot(hand - HOTBAR_START);
                    await click(into);
                    await until(() => !slots()[hand]);
                    // What was in that hotbar slot goes back to it.
                    if (swapped && !slots()[hand]) await move(swapped.back, hand, slots()[swapped.back]?.count ?? 0);
                },
                /**
                 * Takes up to `count` of an item off the shelf into the bot's inventory. Rejects when the
                 * bag has no room, having taken what it could; `slots` then says how much.
                 */
                async takeOut(name, count) {
                    let left = count;
                    for (let slot = 0; slot < 3 && left > 0; slot++) {
                        const stack = onShelf()[slot];
                        if (stack?.name !== name) continue;
                        // An empty hand: an empty hotbar slot, or one emptied into the main inventory.
                        let hand = emptyIn(HOTBAR_START, HOTBAR_END), aside = null;
                        if (hand === null) {
                            aside = emptyIn(MAIN_START, HOTBAR_START);
                            if (aside === null) throw new Error('inventory is full');
                            hand = HOTBAR_START + ((selected + 1) % 9);     // not the one in use
                            await move(hand, aside, slots()[hand].count);
                            if (slots()[hand]) throw new Error('could not free a hand to take it with');
                        }
                        bot.setQuickBarSlot(hand - HOTBAR_START);
                        await click(slot);
                        if (!(await until(() => slots()[hand]?.name === name))) throw new Error('the shelf did not hand anything over');
                        // More than wanted: the part wanted is split off, and the rest goes back on the shelf.
                        // With no slot to split into, all of it goes back: more than was asked for is not taken.
                        if (slots()[hand].count > left) {
                            const spare = emptyIn(MAIN_START, HOTBAR_END, [hand]);
                            const split = spare !== null && await move(hand, spare, left) && slots()[spare]?.count === left;
                            await click(slot);
                            await until(() => !slots()[hand]);
                            if (!split) {
                                if (aside !== null && !slots()[hand]) await move(aside, hand, slots()[aside]?.count ?? 0);
                                throw new Error('inventory is full');
                            }
                        }
                        // What was moved aside goes back to its slot, and what was taken into the main inventory.
                        if (aside !== null) {
                            const room = slots()[hand] ? emptyIn(MAIN_START, HOTBAR_START) : null;
                            if (room !== null) await move(hand, room, slots()[hand].count);
                            if (!slots()[hand]) await move(aside, hand, slots()[aside]?.count ?? 0);
                        }
                        const now = onShelf()[slot];
                        left -= stack.count - (now?.name === name ? now.count : 0);
                    }
                },
                /** What the shelf shows is what the server sent: a moment for the last of it to arrive. */
                async settle() { await wait(150); },
                async close() {
                    forget();
                    restore();
                },
            };
        },
    };
}
