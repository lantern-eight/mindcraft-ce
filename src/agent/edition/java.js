// SPDX-License-Identifier: CC0-1.0
// The edition seam's answers for Java Edition (see index.js).
//
// Java's game data numbers the states of all blocks in one run from 0, and each block type owns the
// numbers from its minStateId to its maxStateId. So a table with one entry per block state can be a typed
// array indexed by state number: the fastest lookup there is, which matters because sight asks one for
// every cell a ray crosses.

/**
 * One small whole number (0 to 255) per block state, every entry 0 to start with. Fair play keeps its
 * yes/no answers per state in these: "does this state block sight?", "is it air?".
 */
class StateTable {
    constructor(size) {
        this.values = new Uint8Array(size);
    }

    /** The entry for a state. A number no block state has reads as 0. */
    get(stateId) {
        return this.values[stateId] ?? 0;
    }

    set(stateId, value) {
        if (stateId >= 0 && stateId < this.values.length) this.values[stateId] = value;
    }

    /** Sets the entry for every state of one block type. */
    setBlock(block, value) {
        this.values.fill(value, block.minStateId, block.maxStateId + 1);
    }
}

// Worked out once per game data: one more than the highest state number.
const tableSizes = new WeakMap();
function tableSize(registry) {
    let size = tableSizes.get(registry);
    if (size === undefined) {
        size = 0;
        for (const block of registry.blocksArray) size = Math.max(size, block.maxStateId + 1);
        tableSizes.set(registry, size);
    }
    return size;
}

export const javaEdition = Object.freeze({
    name: 'java',

    /**
     * The state numbers of one block type, in the order game data lists per-state facts such as
     * collision shapes: the first number goes with the first entry.
     */
    stateIdsOf(block) {
        return Array.from({ length: block.maxStateId - block.minStateId + 1 }, (_, i) => block.minStateId + i);
    },

    /**
     * The block state at one cell of a chunk column, or null or undefined when the column doesn't hold
     * that cell. `pos` has x and z inside the column (0 to 15) and an absolute y.
     */
    readStateId(column, pos) {
        return column.getBlockStateId(pos);
    },

    /** An empty table with one entry per block state of this game data (see StateTable above). */
    stateTable(registry) {
        return new StateTable(tableSize(registry));
    },

    /**
     * What a chunk section can say about its blocks without reading them all, or null when there is no
     * section to ask. A scan uses it to skip sections that can hold nothing it wants.
     *
     * @param {object} column - a chunk column from the bot's world
     * @param {number} sy - the section's y (block y >> 4)
     * @param {number} minY - the world's lowest block y, where the column's first section starts
     * @returns {{empty:boolean, states:number[]|null}|null} `empty`: every cell is air. `states`: the block
     *   states the section may hold (its palette), or null when it holds too many kinds to list
     */
    sectionSummary(column, sy, minY) {
        const section = column.sections?.[sy - (minY >> 4)];
        if (!section) return null;
        const empty = section.solidBlockCount === 0;
        // A section that once held many kinds of block keeps no palette even after it has been emptied;
        // then it holds plain air (state 0) as far as a scan is concerned.
        const states = Array.isArray(section.palette) ? section.palette : empty ? [0] : null;
        return { empty, states };
    },
});
