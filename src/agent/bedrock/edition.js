// SPDX-License-Identifier: CC0-1.0
// The edition seam's answers for Bedrock Edition (see src/agent/edition/index.js).
//
// Fair play, world memory and chest sorting were written against Java's game data. Two things they read
// are shaped differently on Bedrock, and this file answers for them:
//
//   - **How block states are numbered.** A current Bedrock server numbers each block state with a 32-bit
//     hash of its name and properties (the server says so when the bot joins). The numbers have no order,
//     so a block type has no run from a first to a last number the way it has on Java. The game data
//     lists each block's numbers instead (`block.states`, in the order of the per-state facts such as
//     collision shapes). A server that doesn't hash numbers its states from 0, as Java does.
//   - **What a chunk holds.** A section the server reported as all air is never made, so reading a cell
//     there gives nothing, where Java gives air. And a section keeps one palette per layer (the second
//     layer is mostly the water a block stands in), each entry an object that holds the state number.
//
// Read with Java's answers, a hashed state number fits no table: nothing blocked sight, and a search over
// the chunks found nothing. That is why the bot named the dirt under a grass floor it was standing on.
//
// Registered for the game data type "bedrock" when this file is first imported. connect.js imports it,
// so it is in place before any bot starts.
import { registerEdition } from '../edition/index.js';
import { javaEdition as java } from '../edition/java.js';

/** Does this game data give each block type a run of state numbers, as Java's does? */
const numbered = new WeakMap();
function hasStateRuns(registry) {
    let answer = numbered.get(registry);
    if (answer === undefined) {
        answer = registry.blocksArray.every(block => Number.isInteger(block.minStateId) && Number.isInteger(block.maxStateId));
        numbered.set(registry, answer);
    }
    return answer;
}

// ---- A table over hashed state numbers ----
//
// Sight asks its table about every cell a ray crosses, so the lookup has to be quick. A Map keyed by the
// hash costs about ten times a typed array; an open-addressing hash table over typed arrays costs about
// twice. The slots are laid out once per game data (StateSlots) and shared by every table over it, so a
// new table is one typed array.

class StateSlots {
    constructor(stateIds) {
        let bits = 1;
        while (2 ** bits < stateIds.length * 2) bits++; // at most half full, so probes stay short
        const capacity = 2 ** bits;
        this.mask = capacity - 1;
        this.shift = 32 - bits;
        this.keys = new Int32Array(capacity);
        this.used = new Uint8Array(capacity);
        for (const stateId of stateIds) {
            let slot = this.home(stateId);
            while (this.used[slot] && this.keys[slot] !== stateId) slot = (slot + 1) & this.mask;
            this.keys[slot] = stateId;
            this.used[slot] = 1;
        }
    }

    // Where a number's search starts: the top bits of the number times a large odd constant, which
    // spreads numbers counted from 0 as well as hashes.
    home(stateId) {
        return Math.imul(stateId, 0x9e3779b1) >>> this.shift;
    }

    /** The slot of a state number, or -1 for a number no block state has. */
    slotOf(stateId) {
        if ((stateId | 0) !== stateId) return -1; // not a whole 32-bit number: undefined, null, NaN
        let slot = this.home(stateId);
        while (this.used[slot]) {
            if (this.keys[slot] === stateId) return slot;
            slot = (slot + 1) & this.mask;
        }
        return -1;
    }
}

const slotsByRegistry = new WeakMap();
function slotsOf(registry) {
    let slots = slotsByRegistry.get(registry);
    if (!slots) {
        slots = new StateSlots(registry.blocksArray.flatMap(block => bedrockEdition.stateIdsOf(block)));
        slotsByRegistry.set(registry, slots);
    }
    return slots;
}

/** The same table as Java's (src/agent/edition/java.js), over hashed state numbers. */
class HashedStateTable {
    constructor(slots) {
        this.slots = slots;
        this.values = new Uint8Array(slots.mask + 1);
    }

    get(stateId) {
        const slot = this.slots.slotOf(stateId);
        return slot < 0 ? 0 : this.values[slot];
    }

    set(stateId, value) {
        const slot = this.slots.slotOf(stateId);
        if (slot >= 0) this.values[slot] = value;
    }

    setBlock(block, value) {
        for (const stateId of bedrockEdition.stateIdsOf(block)) this.set(stateId, value);
    }
}

// ---- Chunks ----

const airStates = new WeakMap(); // registry -> air's state number
function airOf(registry) {
    let air = airStates.get(registry);
    if (air === undefined) airStates.set(registry, air = registry.blocksByName.air.defaultState);
    return air;
}

export const bedrockEdition = Object.freeze({
    name: 'bedrock',

    stateIdsOf(block) {
        if (Number.isInteger(block.minStateId) && Number.isInteger(block.maxStateId)) return java.stateIdsOf(block);
        return Array.isArray(block.states) ? block.states : [];
    },

    /**
     * A cell in a section that was never made is air: the server said the whole section was, and the
     * library keeps no section for it. mineflayer's own `blockAt` answers air there too. Above and below
     * the world there is nothing to read.
     */
    readStateId(column, pos) {
        const stateId = column.getBlockStateId(pos);
        if (stateId !== undefined && stateId !== null) return stateId;
        if (pos.y < column.minY || pos.y >= column.maxY) return undefined;
        return airOf(column.registry);
    },

    stateTable(registry) {
        return hasStateRuns(registry) ? java.stateTable(registry) : new HashedStateTable(slotsOf(registry));
    },

    /**
     * As on Java, with Bedrock's sections: a section never made is all air, and only the first layer
     * counts, because that is the layer `readStateId` reads.
     */
    sectionSummary(column, sy, minY) {
        const section = column.sections?.[sy - (minY >> 4)];
        const air = airOf(column.registry);
        if (!section) return { empty: true, states: [air] };
        const layer = section.palette?.[0];
        if (!Array.isArray(layer)) return null;
        const states = layer.map(entry => entry.stateId);
        return { empty: states.every(stateId => stateId === air), states };
    },
});

registerEdition('bedrock', bedrockEdition);
