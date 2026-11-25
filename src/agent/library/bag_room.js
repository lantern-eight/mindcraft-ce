// SPDX-License-Identifier: CC0-1.0
// Room in the bag for what a block drops, asked before each block a gathering job breaks.
//
// Mindcraft's collecting (mining.js) breaks block after block and picks up the drops. With the bag full it
// went on breaking, and the drops lay on the ground: forty blocks mined, nothing gained, and the job called
// it a success. A player whose bag is full stops, and empties it into their chests if those are near.
//
// So before each break the job asks `makeRoomFor`: is there an empty slot, or a stack of what the block
// drops with room on it? If not, and a way of making room is installed for the bot (chest storage puts
// things away when its chests are near: src/agent/storage/install.js), it is tried once; otherwise, or if
// that freed nothing, the job stops and says the bag is full. The setter lives here, not in skills.js,
// because that file is handed to generated code.

const makers = new WeakMap(); // bot -> async () => string|null
const notes = new WeakMap();  // bot -> what making room did, for the job's result

/** Installs how a bot makes room in its bag (null removes it). It returns what it did, for the bot's log. */
export function setRoomMaker(bot, maker) {
    if (maker) makers.set(bot, maker);
    else makers.delete(bot);
}

/** The items a block drops, by name, as the game data lists them. Empty when it doesn't say. */
function dropsOf(bot, block) {
    const ids = bot.registry?.blocksByName?.[block?.name]?.drops ?? [];
    return ids.map(drop => bot.registry.items?.[typeof drop === 'object' ? drop.drop ?? drop.id : drop]?.name).filter(Boolean);
}

/**
 * Whether the bag can take what a block drops: an empty slot, or a stack of each thing it may drop with room.
 * A bot whose inventory can't say counts as having room, as Mindcraft assumed before.
 */
export function hasRoomFor(bot, block) {
    const inventory = bot.inventory;
    if (typeof inventory?.emptySlotCount !== 'function') return true;
    if (inventory.emptySlotCount() > 0) return true;
    const drops = dropsOf(bot, block);
    if (!drops.length) return false;
    const items = inventory.items?.() ?? [];
    return drops.every(name => items.some(item => item.name === name && item.count < (item.stackSize ?? 64)));
}

/** What the job says when it stops for a full bag. "Inventory full" is how the bot's own messages know it. */
export const FULL_TEXT = 'Inventory full: nothing more fits in your bag. Put things away in your chests (!putAway) '
    + 'or drop what you don\'t need (!discard), then go on.';

/**
 * Before breaking a block: whether to stop (and why), and whether the bot went somewhere to make room, in
 * which case it has to walk back to the block before breaking it.
 * @returns {Promise<{stop: string|null, moved: boolean}>}
 */
export async function makeRoomFor(bot, block) {
    if (hasRoomFor(bot, block)) return { stop: null, moved: false };
    const maker = makers.get(bot);
    if (!maker) return { stop: FULL_TEXT, moved: false };
    const said = await maker();
    if (said) notes.set(bot, [...(notes.get(bot) ?? []), said]);
    return hasRoomFor(bot, block) ? { stop: null, moved: true } : { stop: FULL_TEXT, moved: true };
}

/**
 * What making room did during a job, as lines for its result, and forgets it. A job's result is what the
 * model reads, so a trip to the chests in the middle of it is said there: "" when there was none.
 */
export function takeRoomNotes(bot) {
    const said = notes.get(bot) ?? [];
    notes.delete(bot);
    return said.map(line => `\n${line}`).join('');
}
