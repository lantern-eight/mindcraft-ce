// SPDX-License-Identifier: CC0-1.0
// What a furnace makes of what. Pure: no game, no bot.
//
// The game data (minecraft-data) has no furnace recipes, only the crafting table's, so the common ones are
// listed here. Names are matched exactly, never by a part of the name: Mindcraft's own test took anything
// with "raw" or "log" in it, so `raw_iron_block` passed as something to smelt, while `red_sand`, `clay`
// and `netherrack` didn't.
//
// Names are Java Edition's. Bedrock calls two of the products something else, and says so below; every
// input here has the same name on both.

/** What a furnace makes of each item, other than logs and wood (see productOf). */
export const SMELTS = Object.freeze({
    // Ores and raw metal
    raw_iron: 'iron_ingot', iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot',
    raw_gold: 'gold_ingot', gold_ore: 'gold_ingot', deepslate_gold_ore: 'gold_ingot', nether_gold_ore: 'gold_ingot',
    raw_copper: 'copper_ingot', copper_ore: 'copper_ingot', deepslate_copper_ore: 'copper_ingot',
    coal_ore: 'coal', deepslate_coal_ore: 'coal',
    diamond_ore: 'diamond', deepslate_diamond_ore: 'diamond',
    emerald_ore: 'emerald', deepslate_emerald_ore: 'emerald',
    lapis_ore: 'lapis_lazuli', deepslate_lapis_ore: 'lapis_lazuli',
    redstone_ore: 'redstone', deepslate_redstone_ore: 'redstone',
    nether_quartz_ore: 'quartz',
    ancient_debris: 'netherite_scrap',
    // Building blocks
    sand: 'glass', red_sand: 'glass',
    cobblestone: 'stone', stone: 'smooth_stone',
    cobbled_deepslate: 'deepslate',
    sandstone: 'smooth_sandstone', red_sandstone: 'smooth_red_sandstone',
    quartz_block: 'smooth_quartz',
    basalt: 'smooth_basalt',
    stone_bricks: 'cracked_stone_bricks',
    deepslate_bricks: 'cracked_deepslate_bricks', deepslate_tiles: 'cracked_deepslate_tiles',
    nether_bricks: 'cracked_nether_bricks',
    polished_blackstone_bricks: 'cracked_polished_blackstone_bricks',
    clay_ball: 'brick', clay: 'terracotta',
    netherrack: 'nether_brick',
    wet_sponge: 'sponge',
    // Dyes and plants
    cactus: 'green_dye', sea_pickle: 'lime_dye', chorus_fruit: 'popped_chorus_fruit',
    // Food
    beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton',
    rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato',
    kelp: 'dried_kelp',
});

// What smelts twice as fast in a blast furnace (ores and raw metal) and in a smoker (food). A furnace smelts
// these too, and everything else; the other two smelt nothing else.
const BLASTS = new Set([
    'raw_iron', 'iron_ore', 'deepslate_iron_ore', 'raw_gold', 'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore',
    'raw_copper', 'copper_ore', 'deepslate_copper_ore', 'coal_ore', 'deepslate_coal_ore', 'diamond_ore', 'deepslate_diamond_ore',
    'emerald_ore', 'deepslate_emerald_ore', 'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'nether_quartz_ore', 'ancient_debris',
]);
const SMOKES = new Set(['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'potato', 'kelp']);

/**
 * How many times as fast as a furnace each furnace block smelts. A blast furnace and a smoker also burn their
 * fuel twice as fast, so a piece of fuel smelts as many items in each.
 */
export const SPEED = Object.freeze({ furnace: 1, blast_furnace: 2, smoker: 2 });

/**
 * The furnace blocks that smelt an item, fastest first: a blast furnace for ores, a smoker for food, and a
 * furnace for everything. Empty for an item no furnace changes.
 * @param {string} item
 * @returns {('furnace'|'blast_furnace'|'smoker')[]}
 */
export function kindsFor(item) {
    const n = cleanName(item);
    if (!productOf(n)) return [];
    if (BLASTS.has(n)) return ['blast_furnace', 'furnace'];
    if (SMOKES.has(n)) return ['smoker', 'furnace'];
    return ['furnace'];
}

/** A furnace block's name as a player says it: "furnace", "blast furnace", "smoker". */
export const kindName = kind => String(kind ?? 'furnace').replace(/_/g, ' ');

// Bedrock's names for the products it names differently.
const BEDROCK_PRODUCTS = Object.freeze({ nether_brick: 'netherbrick', terracotta: 'hardened_clay' });

// Wood of the Nether (crimson and warped stems and planks) doesn't burn and doesn't make charcoal.
const NETHER_WOOD = /^(stripped_)?(crimson|warped)_/;

/** A name as the game writes it, without `minecraft:` and in lower case; null for anything else. */
export function cleanName(name) {
    if (typeof name !== 'string') return null;
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '');
    return clean.length > 0 ? clean : null;
}

/** A log or a block of wood that burns, stripped or not (`oak_log`, `stripped_birch_wood`). */
export function isBurningLog(name) {
    const n = cleanName(name);
    return n !== null && /^[a-z_]+_(log|wood)$/.test(n) && !NETHER_WOOD.test(n);
}

/** Planks that burn (`oak_planks`, `bamboo_planks`); never crimson or warped. */
export function isBurningPlanks(name) {
    const n = cleanName(name);
    return n !== null && /^[a-z_]+_planks$/.test(n) && !NETHER_WOOD.test(n);
}

/**
 * The planks a log is crafted into: `stripped_oak_log` and `oak_wood` both make `oak_planks`. Null for
 * anything that isn't a log that burns.
 */
export function planksOf(log) {
    const n = cleanName(log);
    if (!isBurningLog(n)) return null;
    return `${n.replace(/^stripped_/, '').replace(/_(log|wood)$/, '')}_planks`;
}

/**
 * What a furnace makes of an item: `sand` gives `glass`, `oak_log` gives `charcoal`; null for an item a
 * furnace doesn't change.
 * @param {string} item
 * @param {{edition?: 'java'|'bedrock'}} [options] - whose names to give the product in
 * @returns {string|null}
 */
export function productOf(item, { edition = 'java' } = {}) {
    const n = cleanName(item);
    if (n === null) return null;
    const product = Object.hasOwn(SMELTS, n) ? SMELTS[n] : isBurningLog(n) ? 'charcoal' : null;
    if (product && edition === 'bedrock') return BEDROCK_PRODUCTS[product] ?? product;
    return product;
}

/**
 * What to smelt to make an item: `glass` comes from `sand` or `red_sand`. Empty for something no furnace
 * makes. Charcoal comes from any log, so only `oak_log` is named for it, as an example.
 * @param {string} product - in either edition's names
 * @returns {string[]}
 */
export function inputsFor(product) {
    let n = cleanName(product);
    if (n === null) return [];
    for (const [java, bedrock] of Object.entries(BEDROCK_PRODUCTS)) if (n === bedrock) n = java;
    if (n === 'charcoal') return ['oak_log'];
    return Object.keys(SMELTS).filter(input => SMELTS[input] === n);
}
