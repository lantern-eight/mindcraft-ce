// SPDX-License-Identifier: MIT
// The keep plan: what the bot keeps on itself when it puts things away, and what goes into a chest.
//
// Ported from `keepPlan` in the akarkin1/mindcraft-fk fork (src/agent/packs/storage/storage_logic.js,
// release v0.1.4.17-rc), which is under the MIT License: Copyright (c) 2024 Kolby Nottingham and the
// Mindcraft contributors, with that fork's changes under the same license. The notice is in LICENSE.
// Changes here: the food rules no longer come from that fork's home pack, every stored entry names the
// inventory slots to take it from (the bot puts things away slot by slot), and a stack in the hotbar is
// kept before one in the main inventory, so what the bot holds ready stays where it is.
//
// A player clearing their inventory into a chest keeps what they need out in the world: their best
// tools and a spare pickaxe, their armour and weapons, something to eat, torches, a few blocks to bridge
// with, a bucket and a bed. The rest goes in the chest. This is that judgment, as a pure function: an
// inventory in, two lists out. No game, no chests.

/** Kinds of tools: the best of each is kept, and one spare pickaxe. */
export const TOOL_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe', 'sword']);
/** Materials of tools, from the best to the weakest. Copper mines like stone and lasts longer. */
export const MATERIALS = Object.freeze(['netherite', 'diamond', 'iron', 'copper', 'stone', 'golden', 'wooden']);

/** Items kept up to a count, by name. A bed is kept once, whatever its colour. */
export const KEEP_LIMITS = Object.freeze({ torch: 64, ladder: 64, cobblestone: 32, crafting_table: 1, water_bucket: 1, bucket: 1 });
/** Pieces of food kept, the best first. */
export const FOOD_KEEP = 16;
/** Arrows kept, all kinds together, plain arrows first. */
export const ARROW_KEEP = 64;
/**
 * Food that is not worth keeping for a meal, though the game lets it be eaten: it poisons, makes the bot
 * hungry, teleports it, or is too precious to eat on the way (golden apples go in the chest for safety).
 */
export const NOT_A_MEAL = Object.freeze(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken',
    'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew']);

const ARROWS = ['arrow', 'spectral_arrow', 'tipped_arrow'];
const ARMOUR_ENDS = ['_helmet', '_chestplate', '_leggings', '_boots'];
const KEEP_ALL = new Set(['elytra', 'shield', 'bow', 'crossbow', 'trident', 'mace', 'totem_of_undying']);
// The bot's hotbar, in its own inventory's slot numbers. A stack there is kept before one in the main inventory.
const HOTBAR_START = 36, HOTBAR_END = 45;

// Food points of common food, for a call without the game's food table.
const FOOD_POINTS = Object.freeze({
    apple: 4, baked_potato: 5, beef: 3, beetroot: 1, beetroot_soup: 6, bread: 5, carrot: 3, chicken: 2, cod: 2,
    cooked_beef: 8, cooked_chicken: 6, cooked_cod: 5, cooked_mutton: 6, cooked_porkchop: 8, cooked_rabbit: 5,
    cooked_salmon: 6, cookie: 2, dried_kelp: 1, glow_berries: 2, golden_apple: 4, golden_carrot: 6, honey_bottle: 6,
    melon_slice: 2, mushroom_stew: 6, mutton: 2, porkchop: 3, potato: 1, pumpkin_pie: 8, rabbit: 3, rabbit_stew: 10,
    rotten_flesh: 4, salmon: 2, spider_eye: 2, sweet_berries: 2,
});

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
// Plain character order, not the reader's language: a plan must come out the same on every machine.
const compareNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** An item name without `minecraft:`, trimmed, in lower case; null for anything else. */
export function cleanName(name) {
    if (typeof name !== 'string') return null;
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length ? clean : null;
}

/** "pickaxe" for `iron_pickaxe`; null for anything that is not one of TOOL_KINDS. */
export function toolKindOf(name) {
    return typeof name === 'string' ? TOOL_KINDS.find(kind => name.endsWith(`_${kind}`)) ?? null : null;
}

/** "golden" for `golden_axe`; null when it is none of MATERIALS. */
export function materialOf(name) {
    return typeof name === 'string' ? MATERIALS.find(material => name.startsWith(`${material}_`)) ?? null : null;
}

/** Armour the bot wears: helmets, chestplates, leggings, boots, and elytra. Horse and wolf armour are not. */
export function isArmour(name) {
    return typeof name === 'string' && (name === 'elytra' || ARMOUR_ENDS.some(end => name.endsWith(end)));
}

/** Beds of any colour. */
export const isBed = name => typeof name === 'string' && name.endsWith('_bed');

/**
 * Counts to keep by name: `{ name: count }` (-1 for all), a list of names, or one name (all of them).
 * @returns {Map<string, number>} Infinity stands for all
 */
export function keepCounts(value) {
    const out = new Map();
    const add = (name, count) => {
        const clean = cleanName(name);
        if (clean === null) return;
        if (count === -1) out.set(clean, Infinity);
        else if (isNumber(count) && count >= 0) out.set(clean, Math.floor(count));
    };
    if (typeof value === 'string') add(value, -1);
    else if (Array.isArray(value)) value.forEach(name => add(name, -1));
    else if (isObject(value)) Object.entries(value).forEach(([name, count]) => add(name, count));
    return out;
}

function mealOf(foods, name) {
    if (NOT_A_MEAL.includes(name)) return null;
    if (isObject(foods)) {
        const entry = own(foods, name) ? foods[name] : null;
        return isObject(entry) && isNumber(entry.foodPoints)
            ? { points: entry.foodPoints, saturation: isNumber(entry.saturation) ? entry.saturation : 0 } : null;
    }
    return own(FOOD_POINTS, name) ? { points: FOOD_POINTS[name], saturation: 0 } : null;
}

/** The inventory as plain entries, anything odd left out. `index` keeps the order it came in. */
function entriesOf(inventory) {
    if (!Array.isArray(inventory)) return [];
    const out = [];
    inventory.forEach((item, index) => {
        if (!isObject(item)) return;
        const name = cleanName(item.name);
        const count = isNumber(item.count) ? Math.floor(item.count) : 0;
        if (name === null || name === 'air' || count <= 0) return;
        out.push({ name, count, slot: isNumber(item.slot) ? item.slot : null, usesLeft: isNumber(item.usesLeft) ? item.usesLeft : null,
            special: Boolean(item.special), index });
    });
    return out;
}

const inHotbar = entry => entry.slot !== null && entry.slot >= HOTBAR_START && entry.slot < HOTBAR_END;
// Better first: an enchanted or named one, then more uses left (an unknown number last), then the hotbar,
// then the order the inventory gave.
function better(a, b) {
    return Number(b.special) - Number(a.special) || (b.usesLeft ?? -Infinity) - (a.usesLeft ?? -Infinity)
        || Number(inHotbar(b)) - Number(inHotbar(a)) || a.index - b.index;
}
function materialRank(name) {
    const i = MATERIALS.indexOf(materialOf(name));
    return i < 0 ? MATERIALS.length : i;
}
const byCount = list => list.sort((a, b) => b.count - a.count || compareNames(a.name, b.name));

/**
 * Decides what stays with the bot and what goes into a chest.
 *
 * What the bot keeps: the best pickaxe, axe, shovel, hoe and sword by material (an enchanted or named
 * one first among equals, then the one with more uses left), and one more pickaxe; all armour, shields,
 * bows, crossbows, tridents, maces and totems; arrows up to 64; food up to 16 pieces, the best first;
 * torches and ladders up to 64; cobblestone up to 32; one crafting table, water bucket, bucket and bed;
 * and the counts of `options.keep`. When several rules name an item, the largest count wins. Everything
 * else is stored.
 *
 * With `options.only` (a name or a list of names) only those items are stored, all of them less the
 * counts of `options.keep`, and everything else is kept.
 *
 * @param {{name: string, count: number, slot?: number, usesLeft?: number|null, special?: boolean}[]} inventory -
 *   one entry per stack. `usesLeft` for a tool; `special` for one that is enchanted or named
 * @param {object} [options]
 * @param {string|string[]} [options.only]
 * @param {object|string[]|string} [options.keep] - counts to keep by name, -1 for all
 * @param {object} [options.foods] - the game's food table (`foodsByName`); without it a table of common food is used
 * @returns {{keep: {name: string, count: number}[], store: {name: string, count: number, slots: number[]}[]}}
 *   sorted by count, highest first, then by name. `slots` are the inventory slots to store from, in the
 *   order to take them: a stack the plan keeps whole is not among them, and one it keeps part of comes last
 */
export function keepPlan(inventory, options = {}) {
    const opts = isObject(options) ? options : {};
    const entries = entriesOf(inventory);
    const byName = new Map();
    for (const entry of entries) {
        if (!byName.has(entry.name)) byName.set(entry.name, []);
        byName.get(entry.name).push(entry);
    }
    const total = name => byName.get(name).reduce((sum, entry) => sum + entry.count, 0);
    const keepCount = new Map();
    const raise = (name, n) => keepCount.set(name, Math.max(keepCount.get(name) ?? 0, n));
    const chosen = new Set();       // the very stacks of the tools kept, so a worn one of the same name is not
    const explicit = keepCounts(opts.keep);
    const onlyList = typeof opts.only === 'string' ? [opts.only] : Array.isArray(opts.only) ? opts.only : [];
    const only = new Set(onlyList.map(cleanName).filter(Boolean));

    if (only.size) {
        for (const name of byName.keys()) {
            if (!only.has(name)) raise(name, Infinity);
            else if (explicit.has(name)) raise(name, explicit.get(name));
        }
    } else {
        for (const kind of TOOL_KINDS) {
            const tools = entries.filter(entry => toolKindOf(entry.name) === kind)
                .sort((a, b) => materialRank(a.name) - materialRank(b.name) || better(a, b));
            for (const tool of tools.slice(0, kind === 'pickaxe' ? 2 : 1)) {
                chosen.add(tool);
                raise(tool.name, [...chosen].filter(entry => entry.name === tool.name).length);
            }
        }
        let arrows = ARROW_KEEP;
        for (const name of ARROWS.filter(arrow => byName.has(arrow))) {
            const n = Math.min(total(name), arrows);
            raise(name, n);
            arrows -= n;
        }
        const meals = [...byName.keys()].map(name => ({ name, meal: mealOf(opts.foods, name) })).filter(food => food.meal)
            .sort((a, b) => b.meal.points - a.meal.points || b.meal.saturation - a.meal.saturation || compareNames(a.name, b.name));
        let food = FOOD_KEEP;
        for (const { name } of meals) {
            const n = Math.min(total(name), food);
            raise(name, n);
            food -= n;
        }
        const beds = [...byName.keys()].filter(isBed).sort(compareNames);
        if (beds.length) raise(beds[0], 1);
        for (const name of byName.keys()) {
            if (isArmour(name) || KEEP_ALL.has(name)) raise(name, Infinity);
            if (own(KEEP_LIMITS, name)) raise(name, KEEP_LIMITS[name]);
        }
        for (const [name, n] of explicit) if (byName.has(name)) raise(name, n);
    }

    const keep = [], store = [];
    for (const [name, list] of byName) {
        // Kept from the front: the chosen tools, then the better stacks. What is left over is stored.
        const ordered = [...list].sort((a, b) => Number(chosen.has(b)) - Number(chosen.has(a)) || better(a, b));
        let toKeep = keepCount.get(name) ?? 0, kept = 0, stored = 0;
        const whole = [], part = [];
        for (const entry of ordered) {
            const k = Math.min(entry.count, toKeep);
            toKeep -= k;
            kept += k;
            stored += entry.count - k;
            if (entry.count - k > 0 && entry.slot !== null) (k === 0 ? whole : part).push(entry.slot);
        }
        if (kept > 0) keep.push({ name, count: kept });
        // The stacks to empty, worst first; a stack partly kept is drawn on last.
        if (stored > 0) store.push({ name, count: stored, slots: [...whole.reverse(), ...part] });
    }
    return { keep: byCount(keep), store: byCount(store) };
}
