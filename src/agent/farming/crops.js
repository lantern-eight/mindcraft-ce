// SPDX-License-Identifier: CC0-1.0
// The crops, and the decisions a round of farming makes from what the bot knows. Pure: no bot, no world.
//
// Ideas from two forks of Mindcraft (see ATTRIBUTION.md, "Ideas and Methods"):
//   - akarkin1/mindcraft-fk, packs/farming/crop_logic.js: the crop table and the jobs of one cell of a field
//     (`cellPlan`), and the best hoe by material. Its plough order is ported as code, in visit_order.js.
//   - asanrivas/mindcraft, library/farming.js: exact names, never substrings ("poisonous_potato" holds
//     "potato"), and a harvest that only counts what reached the bag, stopping when breaking gains nothing.
// Written here for this fork: ripeness is not read from an age in this file but handed in by the caller,
// who may only know it for a crop in view (fair play), and a cell whose crop the bot hasn't seen is "look".
//
// Names are Java Edition's. A Bedrock bot hands its block names through the edition seam (`javaNameOf`)
// before asking; seed and produce items have the same names in both editions.

/**
 * The crops a field grows from a seed on farmland: the crop block, the item that plants it, and what it
 * gives. Carrots and potatoes are planted with the produce itself; there is no "carrot seed".
 */
export const CROPS = Object.freeze([
    Object.freeze({ block: 'wheat', seed: 'wheat_seeds', produce: 'wheat' }),
    Object.freeze({ block: 'carrots', seed: 'carrot', produce: 'carrot' }),
    Object.freeze({ block: 'potatoes', seed: 'potato', produce: 'potato' }),
    Object.freeze({ block: 'beetroots', seed: 'beetroot_seeds', produce: 'beetroot' }),
]);

const BY_BLOCK = new Map(CROPS.map(row => [row.block, row]));
const BY_SEED = new Map(CROPS.map(row => [row.seed, row]));
// What a player might call a crop: its block, its seed, its produce, a plural. Exact names only.
const ALIASES = new Map([
    ['wheat', 'wheat'], ['wheat_seeds', 'wheat'], ['seeds', 'wheat'],
    ['carrot', 'carrots'], ['carrots', 'carrots'],
    ['potato', 'potatoes'], ['potatoes', 'potatoes'],
    ['beetroot', 'beetroots'], ['beetroots', 'beetroots'], ['beetroot_seeds', 'beetroots'],
]);

const clean = name => (typeof name === 'string' ? name.trim().toLowerCase().replace(/^minecraft:/, '') : '');

/** The crop row for a crop block (Java's name), or null. */
export const cropOfBlock = name => BY_BLOCK.get(clean(name)) ?? null;

/** The crop row for a seed item, or null. `wheat` is not a seed; `carrot` is. */
export const cropOfSeed = name => BY_SEED.get(clean(name)) ?? null;

/** The crop row for any name a player might use for it (block, seed, produce), or null. */
export const cropOf = name => BY_BLOCK.get(ALIASES.get(clean(name))) ?? null;

/** Ground a hoe turns into farmland. Coarse dirt and rooted dirt turn into dirt first, so take two. */
export const TILLABLE = Object.freeze(['dirt', 'grass_block', 'dirt_path', 'coarse_dirt', 'rooted_dirt']);

const AIR = new Set(['air', 'cave_air', 'void_air']);
export const isAir = name => AIR.has(clean(name));

const HOES = ['netherite_hoe', 'diamond_hoe', 'iron_hoe', 'copper_hoe', 'stone_hoe', 'golden_hoe', 'wooden_hoe'];

/**
 * The best hoe among items, by material, or null.
 * @param {{name: string, count?: number}[]} items
 */
export function bestHoe(items) {
    const names = new Set((Array.isArray(items) ? items : []).filter(i => i && (i.count ?? 1) > 0).map(i => clean(i.name)));
    return HOES.find(h => names.has(h)) ?? null;
}

const count = (counts, name) => {
    const n = counts?.[name];
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The jobs for one cell of a field, in order, out of `look`, `harvest`, `plant`:
 *   - the bot doesn't know what stands on the farmland, or knows a crop but not whether it is ripe: `look`
 *     (it has to see it first: what is remembered of a crop says nothing about its age);
 *   - a ripe crop: `harvest`, then `plant` when the bag will hold that crop's seed (`seedsAfter`: a crop's
 *     own drops give it back, so a ripe crop can always be replanted unless the drops are lost);
 *   - a crop that isn't ripe, or anything else that isn't air: nothing;
 *   - air on farmland: `plant`, when there is any seed to plant.
 * @param {{ground: string, above: string|null, ripe?: boolean|null}} cell - Java names; `above` null when
 *   unknown; `ripe` true or false only for a crop seen now
 * @param {{seeds?: Object<string, number>}} have - seeds held, by item name
 * @returns {string[]}
 */
export function cellPlan(cell, have = {}) {
    if (!cell || clean(cell.ground) !== 'farmland') return [];
    if (cell.above === null || cell.above === undefined) return ['look'];
    const row = cropOfBlock(cell.above);
    if (row) {
        if (cell.ripe === null || cell.ripe === undefined) return ['look'];
        return cell.ripe ? ['harvest', 'plant'] : [];
    }
    if (!isAir(cell.above)) return [];
    return CROPS.some(r => count(have.seeds, r.seed) > 0) ? ['plant'] : [];
}

/**
 * Which seed to sow on an empty cell: the one asked for when the bag holds it; else the crop most of its
 * eight neighbours grow, when the bag holds that seed (a row of carrots gets carrots); else the seed the
 * bag holds most of. Ties go by the order of CROPS. Null when there is nothing to sow.
 * @param {{x: number, z: number}} cell
 * @param {{x: number, z: number, above: string|null}[]} cells - the field's cells
 * @param {Object<string, number>} seeds - seeds held, by item name, after keeping what is owed to replanting
 * @param {string|null} [wanted] - a seed or crop name the player asked for
 * @returns {string|null} a seed item name
 */
export function seedToSow(cell, cells, seeds, wanted = null) {
    const asked = wanted ? cropOf(wanted) : null;
    if (asked) return count(seeds, asked.seed) > 0 ? asked.seed : null;
    const votes = new Map();
    for (const other of Array.isArray(cells) ? cells : []) {
        if (other === cell || Math.abs(other.x - cell.x) > 1 || Math.abs(other.z - cell.z) > 1) continue;
        const row = cropOfBlock(other.above);
        if (row && count(seeds, row.seed) > 0) votes.set(row.seed, (votes.get(row.seed) ?? 0) + 1);
    }
    let best = null, most = 0;
    for (const row of CROPS) {
        const v = votes.get(row.seed) ?? 0;
        if (v > most) { best = row.seed; most = v; }
    }
    if (best) return best;
    for (const row of CROPS) {
        if (count(seeds, row.seed) > (best ? count(seeds, best) : 0)) best = row.seed;
    }
    return best;
}

/**
 * Breaks in a row that brought nothing into the bag before the round stops. Every break destroys a crop,
 * so a round whose drops keep getting lost (into water, through a gap) must not go on (asanrivas: a
 * permanent failure once passed for success 53 times). Two, not one: a single drop can roll out of reach.
 */
export const NO_GAIN_LIMIT = 2;

/** Should the round go on breaking crops? */
export const keepHarvesting = brokenSinceGain => brokenSinceGain < NO_GAIN_LIMIT;

/**
 * Seeds to hold back from sowing empty farmland: one for each ripe crop of that kind still to be cut and
 * replanted. Its own drops usually give it back, but a field whose drops are lost must not end up bare.
 * @param {{above: string|null, ripe?: boolean|null}[]} cells - cells still to be harvested
 * @returns {Object<string, number>} by seed item name
 */
export function seedsOwed(cells) {
    const owed = {};
    for (const cell of Array.isArray(cells) ? cells : []) {
        const row = cell?.ripe ? cropOfBlock(cell.above) : null;
        if (row) owed[row.seed] = (owed[row.seed] ?? 0) + 1;
    }
    return owed;
}
