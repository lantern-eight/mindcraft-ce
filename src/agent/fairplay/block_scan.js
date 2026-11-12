// A fast, private scan of the chunk data the client holds. For perception.js only.
//
// mineflayer's own block search builds a full Block object for every cell it looks at. On real terrain
// that made one pass over the 32 blocks around the bot cost about 80 ms. This reads the raw block state
// ids straight from the chunk columns instead (about 10 ms for the same volume) and leaves it to the
// caller to decide, cell by cell, what deserves a closer look.
//
// What comes out of here is raw: cells the bot may have no way of seeing. So nothing outside perception
// may call it, and perception puts every cell through the sight rules before returning anything.

// Distance along one axis from a point to a row of 16 cells starting at `low` (0 when the point is
// among them). Cells are measured at their low corner, the way mineflayer's own search measures them.
const axisGap = (p, low) => (p < low ? low - p : p > low + 15 ? p - (low + 15) : 0);

/**
 * The 16x16x16 sections that reach into a sphere around `origin`, nearest first. Nearest first matters:
 * a search can stop as soon as the next section is farther away than what it has already found.
 *
 * @param {{x:number, y:number, z:number}} origin - whole-number block coordinates
 * @param {number} radius - in blocks
 * @param {number} minY - lowest block y of the world
 * @param {number} maxY - highest block y of the world
 * @returns {{cx:number, sy:number, cz:number, minDistSq:number}[]} section coordinates (block >> 4) and
 *   the squared distance from the origin to the section's nearest cell
 */
export function sectionsInRange(origin, radius, minY, maxY) {
    const out = [];
    const r2 = radius * radius;
    const y0 = Math.max(minY, Math.floor(origin.y - radius)), y1 = Math.min(maxY, Math.floor(origin.y + radius));
    for (let cx = Math.floor(origin.x - radius) >> 4; cx <= Math.floor(origin.x + radius) >> 4; cx++) {
        const dx = axisGap(origin.x, cx * 16);
        for (let cz = Math.floor(origin.z - radius) >> 4; cz <= Math.floor(origin.z + radius) >> 4; cz++) {
            const dz = axisGap(origin.z, cz * 16);
            for (let sy = y0 >> 4; sy <= y1 >> 4; sy++) {
                const dy = axisGap(origin.y, sy * 16);
                const minDistSq = dx * dx + dy * dy + dz * dz;
                if (minDistSq <= r2) out.push({ cx, sy, cz, minDistSq });
            }
        }
    }
    return out.sort((a, b) => a.minDistSq - b.minDistSq);
}

// One position object reused for every read, so scanning a section allocates nothing.
const local = { x: 0, y: 0, z: 0 };

/**
 * Calls `visit(x, y, z, stateId)` for every cell of one section whose block state is wanted.
 *
 * @param {object} column - a chunk column: `getBlockStateId({x, y, z})` with x and z inside the column
 *   (0..15) and y absolute. If it also has `sections` (prismarine-chunk does), two shortcuts apply.
 * @param {number} cx @param {number} sy @param {number} cz - section coordinates
 * @param {number} minY - lowest block y of the world, where the column's first section starts
 * @param {(stateId:number) => boolean} wanted
 * @param {(x:number, y:number, z:number, stateId:number) => void} visit
 */
export function scanSection(column, cx, sy, cz, minY, wanted, visit) {
    // Shortcuts, the same two mineflayer's search relies on. A section that is all air, or whose
    // palette (the short list of block states it contains) holds nothing wanted, is skipped without
    // reading its 4096 cells. Most of the sky and much of the ground goes this way.
    const section = column.sections?.[sy - (minY >> 4)];
    if (section) {
        if (section.solidBlockCount === 0 && !wanted(0)) return;
        if (Array.isArray(section.palette) && !section.palette.some(wanted)) return;
    }
    const baseX = cx * 16, baseY = sy * 16, baseZ = cz * 16;
    for (let ly = 0; ly < 16; ly++) {
        local.y = baseY + ly;
        for (let lz = 0; lz < 16; lz++) {
            local.z = lz;
            for (let lx = 0; lx < 16; lx++) {
                local.x = lx;
                const stateId = column.getBlockStateId(local);
                // null or undefined: a cell the client doesn't have (only test worlds have holes inside a column).
                if (stateId != null && wanted(stateId)) visit(baseX + lx, local.y, baseZ + lz, stateId);
            }
        }
    }
}

/**
 * Remembers a yes/no answer per block state, working each one out the first time it is asked. A search
 * asks "could this state match?" for hundreds of thousands of cells but only a few dozen distinct states.
 * @param {number} size - one more than the highest state id
 * @param {(stateId:number) => boolean} decide
 * @returns {(stateId:number) => boolean}
 */
export function lazyStateTable(size, decide) {
    const table = new Int8Array(size).fill(-1);
    return stateId => {
        let answer = table[stateId];
        if (answer === undefined) return false; // a state id the registry doesn't know
        if (answer < 0) answer = table[stateId] = decide(stateId) ? 1 : 0;
        return answer === 1;
    };
}
