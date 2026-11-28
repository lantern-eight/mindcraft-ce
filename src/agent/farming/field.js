// SPDX-License-Identifier: CC0-1.0
// What a field is, as the bot knows it. Pure: handed a block reader, never the world.
//
// A field is the farmland connected to a start cell: sideways and diagonally, one level up or down, and
// across the water and paths that run between its rows. The reader answers only what the bot knows (in
// view now, or remembered), so a cell it has never seen is "unknown": the field stops there, and the
// caller learns that more of it may lie beyond, to look at before believing the field ends.
//
// Ideas from two forks of Mindcraft (MIT, see ATTRIBUTION.md): akarkin1/mindcraft-fk's open farm
// (`areas/open_farm.js`: farmland followed from the bot, with the water and paths among it) and its step
// cost (`packs/farming/field_logic.js` `stepPenalty`: no step 3 to 5 blocks above farmland); and
// hashtagakiaki/mindcraft's connected plot (`tendNearbyFarm`). Both read every block of a box from the
// game; this reads only what the bot perceives.

const BETWEEN_ROWS = new Set(['water', 'dirt_path']);

/** How many cells a field may have before the search stops: a field of 48 by 48. */
export const MAX_FIELD_CELLS = 2304;

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * The field around a start cell.
 * @param {(x: number, y: number, z: number) => ({name: string, ripe?: boolean|null}|null)} read - what the
 *   bot knows is at a cell, by Java's name, or null when it doesn't know. `ripe` is true or false only for a
 *   crop seen now; anything remembered has none
 * @param {{x: number, y: number, z: number}} start - a farmland cell
 * @param {{maxCells?: number, inBounds?: (x: number, z: number) => boolean}} [options]
 * @returns {{cells: {x: number, y: number, z: number, ground: 'farmland', above: string|null, ripe: boolean|null}[],
 *   between: {x: number, y: number, z: number, name: string}[], unknownEdge: number, full: boolean}}
 *   `cells` the farmland; `between` the water and paths among it; `unknownEdge` how many cells next to the
 *   field the bot has never seen; `full` true when the search stopped at maxCells
 */
export function findField(read, start, { maxCells = MAX_FIELD_CELLS, inBounds = () => true } = {}) {
    const look = (x, y, z) => {
        try { return read(x, y, z) ?? null; } catch { return null; }
    };
    const cells = [], between = [];
    const seen = new Set();
    const unknown = new Set();
    const first = start && look(start.x, start.y, start.z);
    if (first?.name !== 'farmland') return { cells, between, unknownEdge: 0, full: false };

    const queue = [{ x: start.x, y: start.y, z: start.z, farmland: true }];
    seen.add(key(start.x, start.y, start.z));
    let full = false;
    while (queue.length) {
        const at = queue.shift();
        if (at.farmland) {
            if (cells.length >= maxCells) { full = true; break; }
            const above = look(at.x, at.y + 1, at.z);
            cells.push({ x: at.x, y: at.y, z: at.z, ground: 'farmland', above: above?.name ?? null, ripe: above?.ripe ?? null });
        } else {
            between.push({ x: at.x, y: at.y, z: at.z, name: at.name });
        }
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = at.x + dx, z = at.z + dz;
                if (!inBounds(x, z)) continue;
                // Farmland one level up or down still belongs (a field on a gentle slope). Water and paths
                // belong only at the same level, and only when reached from farmland: one row of water joins
                // the rows on either side, but a river beside a field doesn't make the river part of it.
                for (const dy of at.farmland ? [0, -1, 1] : [0]) {
                    const y = at.y + dy;
                    const k = key(x, y, z);
                    if (seen.has(k)) continue;
                    const block = look(x, y, z);
                    if (!block) { if (dy === 0) unknown.add(k); continue; }
                    if (block.name === 'farmland') {
                        seen.add(k);
                        queue.push({ x, y, z, farmland: true });
                    } else if (at.farmland && dy === 0 && (dx === 0 || dz === 0) && BETWEEN_ROWS.has(block.name)) {
                        seen.add(k);
                        queue.push({ x, y, z, farmland: false, name: block.name });
                    }
                }
            }
        }
    }
    for (const k of seen) unknown.delete(k);
    return { cells, between, unknownEdge: unknown.size, full };
}

/** The box a field spans, ground to ground, or null for none. */
export function fieldBox(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return null;
    const pick = (axis, f) => f(...cells.map(c => c[axis]));
    return {
        min: { x: pick('x', Math.min), y: pick('y', Math.min), z: pick('z', Math.min) },
        max: { x: pick('x', Math.max), y: pick('y', Math.max), z: pick('z', Math.max) },
    };
}

/** What the pathfinder pays for a step that could land on farmland: more than it will ever pay (it drops a move over 100). */
export const NO_STEP = 100;

/**
 * A step cost for the pathfinder (`Movements.exclusionAreasStep`) that keeps the bot from landing on the
 * field's farmland: a jump or a fall onto farmland may trample it back to dirt, walking on it never does.
 *
 * The pathfinder asks about the cells a move passes through. Standing on farmland at height g, the feet are
 * at g + 1 and the head at g + 2: walking among the plants touches only those. A jump from the farmland
 * passes g + 3, and so does any step down onto it from higher ground (a step down of one block passes
 * g + 3 above where it lands, two blocks g + 3 and g + 4, and so on). So the cells 3 to 5 above farmland
 * are never stepped through, and the bot walks onto the field only from the level of its own ground.
 * The rule is akarkin1/mindcraft-fk's (`field_logic.js stepPenalty`, found in its world tests), written anew here.
 * @param {{x: number, y: number, z: number}[]} cells - the field's farmland
 * @returns {(block: {position?: {x: number, y: number, z: number}}|{x: number, y: number, z: number}) => number}
 */
export function stepCost(cells) {
    const groundOf = new Map();
    for (const c of Array.isArray(cells) ? cells : []) {
        const k = `${c.x},${c.z}`;
        if (!groundOf.has(k) || groundOf.get(k) < c.y) groundOf.set(k, c.y);
    }
    return block => {
        const p = block?.position ?? block;
        if (!p || !Number.isFinite(p.x)) return 0;
        const g = groundOf.get(`${Math.floor(p.x)},${Math.floor(p.z)}`);
        if (g === undefined) return 0;
        const up = Math.floor(p.y) - g;
        return up >= 3 && up <= 5 ? NO_STEP : 0;
    };
}
