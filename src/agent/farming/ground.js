// SPDX-License-Identifier: CC0-1.0
// Where to make a field: the ground a careful player would till. Pure: handed a block reader, never the world.
//
// A player making a field looks for ground that will grow crops and isn't anyone's:
//   - soil a hoe turns into farmland: grass, dirt, coarse dirt, rooted dirt. Never a path (someone made it)
//     and never a cell the caller says is someone's (seen built, a protected area);
//   - with room above for the crop: air, or wild grass and ferns, which the bot cuts first;
//   - kept wet: farmland dries back to dirt unless water lies within 4 blocks of it sideways, at its own
//     level or one above (the game's hydration rule; chrisjoyce911's farming research note has it too);
//   - next to the field it is making bigger, when there is one, and never against a field it may not tend,
//     where new farmland would join that field and make it hard to say whose is whose.
// The reader answers only what the bot knows (in view, or remembered), so a cell it has never seen is never
// tilled, and water it has never seen keeps nothing wet.

/** Soil a hoe turns into farmland, by Java's name. Coarse and rooted dirt take two strokes: first to dirt. */
export const SOIL = Object.freeze(['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt']);
/** Soil that takes two strokes of the hoe. */
export const TWO_STROKES = Object.freeze(['coarse_dirt', 'rooted_dirt']);
/** Wild plants that may stand where a crop will grow: cut first. */
export const WEEDS = Object.freeze(['short_grass', 'grass', 'fern', 'tall_grass', 'large_fern', 'short_dry_grass', 'tall_dry_grass']);

const AIR = new Set(['air', 'cave_air', 'void_air']);
const WATER = new Set(['water', 'flowing_water']);
const SOIL_SET = new Set(SOIL);
const WEED_SET = new Set(WEEDS);

/** How far sideways water keeps farmland wet. */
export const WET_REACH = 4;
/** How far from the bot ground is looked for, sideways and up or down. */
export const GROUND_RANGE = 12, GROUND_DEPTH = 4;

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * Chooses the cells to till.
 * @param {(x: number, y: number, z: number) => ({name: string}|null)} read - what the bot knows is at a cell,
 *   by Java's name, or null when it doesn't know
 * @param {object} options
 * @param {{x: number, y: number, z: number}} options.from - where the bot stands (its feet's block)
 * @param {number} options.size - how many cells at most
 * @param {{x: number, y: number, z: number}[]} [options.field] - the farmland of a field to make bigger
 * @param {{x: number, y: number, z: number}[]} [options.avoid] - farmland of fields not to touch
 * @param {(x: number, y: number, z: number, name: string) => boolean} [options.mayTill] - false for a cell
 *   that is someone's (seen built, a protected area)
 * @param {number} [options.range]
 * @returns {{cells: {x: number, y: number, z: number, ground: string, above: string}[], why: string|null,
 *   water: {x: number, y: number, z: number}[]}} `why` when no cell was found: 'no_water' (none in view
 *   near the bot), 'no_ground' (water, but no free soil it keeps wet); `water` the water seen near the cells
 */
export function chooseGround(read, { from, size, field = [], avoid = [], mayTill = () => true, range = GROUND_RANGE } = {}) {
    const look = (x, y, z) => {
        try { return read(x, y, z) ?? null; } catch { return null; }
    };
    const fx = Math.floor(from.x), fy = Math.floor(from.y), fz = Math.floor(from.z);
    const reach = range + WET_REACH;

    // The water the bot knows near it, and the cells each keeps wet.
    const water = [];
    const wet = new Set();
    for (let x = fx - reach; x <= fx + reach; x++) {
        for (let z = fz - reach; z <= fz + reach; z++) {
            for (let y = fy - GROUND_DEPTH - 1; y <= fy + GROUND_DEPTH + 1; y++) {
                if (!WATER.has(look(x, y, z)?.name)) continue;
                water.push({ x, y, z });
                // Farmland at this level, or one below, within four sideways.
                for (let dx = -WET_REACH; dx <= WET_REACH; dx++) for (let dz = -WET_REACH; dz <= WET_REACH; dz++) {
                    wet.add(key(x + dx, y, z + dz));
                    wet.add(key(x + dx, y - 1, z + dz));
                }
            }
        }
    }
    if (!water.length) return { cells: [], why: 'no_water', water };

    // Cells next to a field not to touch: new farmland there would join it (fields join sideways, diagonally,
    // and a level up or down).
    const nearOther = new Set();
    for (const c of avoid) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++)
        nearOther.add(key(c.x + dx, c.y + dy, c.z + dz));

    // Every cell that could be tilled.
    const free = new Map();
    for (let x = fx - range; x <= fx + range; x++) {
        for (let z = fz - range; z <= fz + range; z++) {
            for (let y = fy - GROUND_DEPTH; y <= fy + 1; y++) {
                const k = key(x, y, z);
                if (!wet.has(k) || nearOther.has(k)) continue;
                const ground = look(x, y, z)?.name;
                if (!SOIL_SET.has(ground)) continue;
                const above = look(x, y + 1, z)?.name;
                if (!above || !(AIR.has(above) || WEED_SET.has(above))) continue;
                if (!mayTill(x, y, z, ground)) continue;
                free.set(k, { x, y, z, ground, above });
            }
        }
    }
    if (!free.size) return { cells: [], why: 'no_ground', water };

    // Grow the plot outward from where it starts: the edge of the field being made bigger, else the free cell
    // nearest the bot. Nearest first, so the plot stays one piece and close.
    const taken = [];
    const queued = new Set();
    const queue = [];
    const push = cell => {
        const k = key(cell.x, cell.y, cell.z);
        if (queued.has(k)) return;
        queued.add(k);
        queue.push(cell);
    };
    const neighbours = (c, levels) => {
        const out = [];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            for (const dy of levels) {
                const next = free.get(key(c.x + dx, c.y + dy, c.z + dz));
                if (next) out.push(next);
            }
        }
        return out;
    };
    const fromBot = c => Math.abs(c.x - fx) + Math.abs(c.z - fz) + Math.abs(c.y - fy) * 2;
    if (field.length) {
        for (const c of field) for (const next of neighbours(c, [-1, 0, 1])) push(next);
        if (!queue.length) return { cells: [], why: 'no_ground', water };
    } else {
        push([...free.values()].sort((a, b) => fromBot(a) - fromBot(b))[0]);
    }
    const anchor = field.length ? field : [queue[0]];
    const fromAnchor = c => Math.min(...anchor.map(a => Math.abs(a.x - c.x) + Math.abs(a.z - c.z)));
    while (queue.length && taken.length < size) {
        queue.sort((a, b) => fromAnchor(a) - fromAnchor(b) || fromBot(a) - fromBot(b));
        const cell = queue.shift();
        taken.push(cell);
        // Within a new plot, one level only: a field the bot makes is flat.
        for (const next of neighbours(cell, field.length ? [-1, 0, 1] : [0])) push(next);
    }
    const near = water.filter(w => taken.some(c => Math.abs(c.x - w.x) <= WET_REACH && Math.abs(c.z - w.z) <= WET_REACH && (w.y === c.y || w.y === c.y + 1)));
    return { cells: taken, why: null, water: near };
}
