// SPDX-License-Identifier: CC0-1.0
// What a chest is for: "this chest is for tools", a sign over a chest that says "Ores", the inbox.
//
// A player who sets up a storage room decides what goes where, says it, and often puts up signs. The bot
// keeps what it was told in the chest book (`holds`), and reads the signs it has seen (world memory keeps
// what a sign says). A player's word comes first; a sign counts while nobody has said otherwise. A sign
// never says whose a chest is: that only ever comes from a player.
//
// What a chest can be for, word by word:
//   - a group of items, as item_groups.js has them ("tools", "wood"), or a plain word for one ("ores",
//     "weapons", "crops");
//   - an item ("iron_ingot", "cobblestone"; "Iron ingots" on a sign);
//   - the inbox: the chest players drop things into, for the bot to file into the others.
// A chest for something takes what it is for first, and nothing else when putting away (D9 in the notes:
// a player keeps dirt out of the tools chest). Sorting puts other things there only when they fit
// nowhere else, since a sort has to place everything that is already in the chests.
//
// Pure: no game, no bot. What counts as an item is asked of the caller (the game's own item list).
import { GROUPS } from './item_groups.js';

/** The word for the chest players drop things into. */
export const INBOX = 'inbox';

// Plain words players use for the groups, and for the inbox. Several words make one phrase ("mob drops").
const WORDS = new Map(Object.entries({
    tool: 'tools', tools: 'tools', pickaxes: 'tools', axes: 'tools', shovels: 'tools', utility: 'tools',
    weapon: 'combat', weapons: 'combat', armor: 'combat', armour: 'combat', combat: 'combat', gear: 'combat', pvp: 'combat',
    food: 'food', foods: 'food', meat: 'food', snacks: 'food', kitchen: 'food',
    ore: 'minerals', ores: 'minerals', mineral: 'minerals', minerals: 'minerals', ingots: 'minerals', gems: 'minerals',
    metals: 'minerals', valuables: 'minerals', mining: 'minerals',
    wood: 'wood', woods: 'wood', logs: 'wood', lumber: 'wood', timber: 'wood',
    stone: 'stone', stones: 'stone', rock: 'stone', rocks: 'stone', cobble: 'stone',
    earth: 'earth', dirt: 'earth', soil: 'earth',
    plant: 'plants', plants: 'plants', crops: 'plants', crop: 'plants', farm: 'plants', farming: 'plants', seeds: 'plants', flowers: 'plants', garden: 'plants',
    drops: 'mob_drops', 'mob drops': 'mob_drops', loot: 'mob_drops', monster: 'mob_drops', 'mob loot': 'mob_drops',
    redstone: 'redstone',
    building: 'building', 'building blocks': 'building', builds: 'building', decor: 'building', decoration: 'building', furniture: 'building',
    other: 'other', misc: 'other', miscellaneous: 'other', junk: 'other', stuff: 'other', random: 'other',
    inbox: INBOX, 'drop off': INBOX, dropoff: INBOX, 'drop-off': INBOX, 'drop box': INBOX, dropbox: INBOX, input: INBOX,
    unsorted: INBOX, incoming: INBOX, deposit: INBOX,
}));
for (const group of GROUPS) WORDS.set(group, group);
WORDS.set('mob_drops', 'mob_drops');

const SPLIT = /\s*(?:\n|\/|,|&|\+|;|\band\b|\|)\s*/;

/** The words a player or a sign used, as names: lowercase, spaces to underscores. */
const asName = phrase => phrase.toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 _-]/g, ' ').trim().replace(/[\s-]+/g, '_');

/**
 * What one phrase names: a group, the inbox, an item, or nothing known.
 * @param {string} phrase
 * @param {(name: string) => boolean} isItem
 * @returns {string|null}
 */
function readPhrase(phrase, isItem) {
    const spaced = phrase.toLowerCase().replace(/[^a-z0-9 _-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spaced) return null;
    if (WORDS.has(spaced)) return WORDS.get(spaced);
    const name = asName(spaced);
    if (WORDS.has(name)) return WORDS.get(name);
    // An item, as the game names it, or as a sign writes it: "Iron ingots" is iron_ingot.
    for (const guess of [name, name.replace(/ies$/, 'y'), name.replace(/es$/, ''), name.replace(/s$/, '')]) {
        if (guess && isItem(guess)) return guess;
        // A metal by its name alone ("Iron", "Gold") is its ingot, as a player labels the chest.
        if (guess && isItem(`${guess}_ingot`)) return `${guess}_ingot`;
    }
    // A longer phrase may still hold one known word: "Alice's tools", "Building stuff".
    const words = spaced.split(' ');
    for (const word of words) if (WORDS.has(word) && WORDS.get(word) !== 'other') return WORDS.get(word);
    return null;
}

/**
 * Reads what a chest is for, from a player's words or a sign's text.
 * @param {string} text - "tools", "iron_ingot, gold_ingot", "Ores / Gems", "inbox"
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.isItem] - whether a name is an item of the game
 * @returns {{holds: string[], unknown: string[]}} what was understood, in order, and the phrases that weren't.
 *   The inbox comes alone: a chest that is the inbox is for nothing else.
 */
export function readPurpose(text, { isItem = () => false } = {}) {
    const holds = [], unknown = [];
    for (const phrase of String(text ?? '').split(SPLIT).map(p => p.trim()).filter(Boolean)) {
        const word = readPhrase(phrase, isItem);
        if (word === null) unknown.push(phrase);
        else if (!holds.includes(word)) holds.push(word);
    }
    return { holds: holds.includes(INBOX) ? [INBOX] : holds, unknown };
}

/**
 * What a chest is for now: what a player said, else what a sign on it says.
 * @param {object} chest
 * @param {object} options
 * @param {object} options.book - the chest book
 * @param {(chest: object) => string|null} [options.signText] - what a sign on or beside the chest says, as
 *   world memory saw it
 * @param {(name: string) => boolean} [options.isItem]
 * @returns {{holds: string[], from: 'said'|'sign'|null}} `holds` is empty for a chest for anything
 */
export function purposeOf(chest, { book, signText = () => null, isItem = () => false }) {
    const said = book?.holdsOf?.(chest) ?? null;
    if (said !== null) return { holds: said, from: 'said' };
    const text = signText(chest);
    if (text) {
        const { holds } = readPurpose(text, { isItem });
        if (holds.length) return { holds, from: 'sign' };
    }
    return { holds: [], from: null };
}

/** Is this the inbox? */
export const isInbox = holds => Boolean(holds?.includes(INBOX));

/**
 * How well a chest suits an item, by what it is for.
 * @param {string[]|undefined} holds
 * @param {string} name - the item
 * @param {(name: string) => string} groupOf
 * @returns {number} 2: the chest is for this item; 1: for its group; 0: for anything; -1: for something
 *   else, or the inbox
 */
export function fitFor(holds, name, groupOf) {
    if (!holds?.length) return 0;
    if (isInbox(holds)) return -1;
    if (holds.includes(name)) return 2;
    if (holds.includes(groupOf(name))) return 1;
    return -1;
}

/** "tools and iron_ingot", "the inbox", "anything": what a chest is for, as the model reads it. */
export function purposeText(holds) {
    if (!holds?.length) return 'anything';
    if (isInbox(holds)) return 'the inbox';
    const names = holds.map(word => word.replace(/_/g, ' '));
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
