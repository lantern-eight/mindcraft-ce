// SPDX-License-Identifier: CC0-1.0
// Getting a tool: the one in the bag, else one from the chests, else one crafted from what the bag and the
// chests hold. `!getTool("pickaxe", "iron")`.
//
// A player who needs a pickaxe looks in their bag, then in their chests, then at the crafting table, and
// fetches what the recipe is short of on the way. That is the order here. Which chests may be used is the
// fetch rule (take_put.js): the bot's own and shared ones, and a player's when a player asks.
//
// What a tool takes, from the game's recipes as a player knows them: a head of planks, cobblestone, iron,
// gold or diamond (three for a pickaxe or an axe, two for a hoe or a sword, one for a shovel), and sticks
// (two, or one for a sword), made at a crafting table. Sticks come from planks and planks from logs, so a
// chest of logs is enough for a wooden tool. Netherite is never crafted here: it takes a smithing table and
// a template. The crafting itself is Mindcraft's own (`craftRecipe`), which finds a table nearby or puts
// down one the bot carries.

/** The tools, and what each takes besides its head: [head count, sticks]. */
export const SHAPES = Object.freeze({ pickaxe: [3, 2], axe: [3, 2], shovel: [1, 2], hoe: [2, 2], sword: [2, 1] });
/** Materials, worst first, by the word in the tool's name. */
export const MATERIALS = Object.freeze(['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite']);
/** What "any" works through, best first: gold is soft, and netherite is not crafted. */
const ANY_ORDER = ['netherite', 'diamond', 'iron', 'stone', 'wooden'];
/** The head each material is made of. */
const HEADS = {
    wooden: name => name.endsWith('_planks'),
    stone: name => ['cobblestone', 'cobbled_deepslate', 'blackstone'].includes(name),
    golden: name => name === 'gold_ingot',
    iron: name => name === 'iron_ingot',
    diamond: name => name === 'diamond',
};
/** Logs, stems and their wood blocks, stripped or not: each makes four planks. */
export const isLog = name => /_(log|stem|wood|hyphae)$/.test(name);
export const isPlanks = name => name.endsWith('_planks');
/** The planks a log makes: oak_log and stripped_oak_wood make oak_planks, crimson_stem crimson_planks. */
export const planksOf = log => `${log.replace(/^stripped_/, '').replace(/_(log|stem|wood|hyphae)$/, '')}_planks`;

/** "Pickaxes" and "pick" are a pickaxe; "spade" a shovel. */
export function readKind(text) {
    const word = String(text ?? '').toLowerCase().trim().replace(/^["']|["']$/g, '').replace(/s$/, '');
    const kind = { pick: 'pickaxe', spade: 'shovel', hatchet: 'axe' }[word] ?? word;
    return SHAPES[kind] ? kind : null;
}
/** "wood" is wooden, "gold" golden, "best" and "" any. */
export function readMaterial(text) {
    const word = String(text ?? '').toLowerCase().trim().replace(/^["']|["']$/g, '');
    if (['', 'any', 'best', 'whatever'].includes(word)) return 'any';
    const material = { wood: 'wooden', gold: 'golden', cobblestone: 'stone', cobble: 'stone' }[word] ?? word;
    return MATERIALS.includes(material) ? material : null;
}

const rank = material => MATERIALS.indexOf(material);
/** The material of a tool, by its name ("iron_pickaxe" is iron), or null when it is no tool of that kind. */
export const materialOf = (name, kind) => (name.endsWith(`_${kind}`) && MATERIALS.includes(name.slice(0, -kind.length - 1)) ? name.slice(0, -kind.length - 1) : null);

/**
 * Whether the bag already has the tool asked for: one of that kind at that material or better (gold counts
 * only when gold was asked for, since a golden tool wears out at once).
 * @param {{name: string}[]} bag
 * @returns {string|null} the name of the one it has
 */
export function carriedTool(bag, kind, material) {
    const fits = name => {
        const m = materialOf(name, kind);
        if (!m) return false;
        if (material === 'any') return true;
        if (m === material) return true;
        return m !== 'golden' && material !== 'golden' && rank(m) > rank(material);
    };
    return bag.map(item => item.name).filter(fits).sort((a, b) => rank(materialOf(b, kind)) - rank(materialOf(a, kind)))[0] ?? null;
}

/**
 * What a crafted tool is short of, from what the bot carries and what the chests it may use hold.
 * @param {string} kind
 * @param {string} material - not netherite
 * @param {Object<string, number>} have - the bag's counts by name
 * @param {Object<string, number>} stored - the chests' counts by name, as the bot believes them
 * @param {object} [extra]
 * @param {boolean} [extra.table] - whether a crafting table is near or carried
 * @returns {{possible: boolean, fetch: {name: string, count: number}[], missing: string|null}}
 *   what to fetch first, in order, and when it can't be done, what is lacking
 */
export function craftPlan(kind, material, have, stored, { table = false } = {}) {
    const [headCount, stickCount] = SHAPES[kind];
    const isHead = HEADS[material];
    const fetch = [];
    const total = (counts, test) => Object.entries(counts).reduce((n, [name, count]) => n + (test(name) ? count : 0), 0);
    // Things to fetch of a kind ("any planks"): from the chest kinds holding most of it.
    const take = (test, count) => {
        let left = count;
        for (const [name, n] of Object.entries(stored).filter(([name]) => test(name)).sort((a, b) => b[1] - a[1])) {
            if (left <= 0) break;
            const c = Math.min(left, n);
            fetch.push({ name, count: c });
            stored[name] -= c;
            left -= c;
        }
        return left;   // what no chest has
    };
    stored = { ...stored };

    // Planks are needed for wooden heads, sticks and a table: count them together, with logs (four planks each).
    let planksNeeded = 0;
    if (material === 'wooden') planksNeeded += headCount;
    const sticksShort = Math.max(0, stickCount - (have.stick ?? 0));
    let sticksFromChests = Math.min(sticksShort, stored.stick ?? 0);
    if (sticksFromChests) { fetch.push({ name: 'stick', count: sticksFromChests }); stored.stick -= sticksFromChests; }
    if (sticksShort - sticksFromChests > 0) planksNeeded += 2;     // two planks make four sticks
    let tableShort = !table && !(have.crafting_table > 0);
    if (tableShort && (stored.crafting_table ?? 0) > 0) { fetch.push({ name: 'crafting_table', count: 1 }); tableShort = false; }
    if (tableShort) planksNeeded += 4;

    if (material !== 'wooden') {
        const short = Math.max(0, headCount - total(have, isHead));
        if (short && take(isHead, short) > 0) return { possible: false, fetch: [], missing: `${headCount} ${material === 'stone' ? 'cobblestone' : headName(material)}` };
    }
    const planksShort = Math.max(0, planksNeeded - total(have, isPlanks) - 4 * total(have, isLog));
    if (planksShort) {
        const fromPlanks = Math.min(planksShort, total(stored, isPlanks));
        const stillShort = planksShort - fromPlanks;
        if (fromPlanks) take(isPlanks, fromPlanks);
        if (stillShort && take(isLog, Math.ceil(stillShort / 4)) > 0) return { possible: false, fetch: [], missing: `${planksNeeded} planks (or logs)` };
    }
    return { possible: true, fetch, missing: null };
}
const headName = material => ({ golden: 'gold_ingot', iron: 'iron_ingot', diamond: 'diamond' })[material];

/** The order "any" tries materials in, for crafting: best first, never netherite. */
export const craftOrder = material => (material === 'any' ? ANY_ORDER.filter(m => m !== 'netherite') : material === 'netherite' ? [] : [material]);
/** The order "any" looks for a tool in the chests: best first. */
export const fetchOrder = material => (material === 'any' ? ANY_ORDER : [material]);
