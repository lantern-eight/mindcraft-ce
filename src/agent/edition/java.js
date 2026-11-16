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

// The sound packets a Java server sends. Sounds played at a spot carry their position in eighths of a block;
// sounds attached to an entity come from wherever that entity is.
const SOUND_AT_SPOT = ['sound_effect', 'named_sound_effect'];
const SOUND_OF_ENTITY = 'entity_sound_effect';

/**
 * The name of the sound a packet carries, or null.
 *
 * mineflayer's own `soundEffectHeard` event can't be used for this: on 1.21 it looks each sound up one
 * place off in the sound list, so a cow's moo arrives named as an unrelated sound and its hurt cry as its
 * death cry. minecraft-data numbers its sound list from 0 in some versions and from 1 in others, while the
 * protocol always counts from 0, so the lookup goes by where the list starts.
 */
function soundNameOf(registry, packet) {
    if (typeof packet?.soundName === 'string') return packet.soundName;                 // older servers name it outright
    if (typeof packet?.sound?.data?.soundName === 'string') return packet.sound.data.soundName; // a sound given by name
    const id = packet?.sound ? packet.sound.soundId : packet?.soundId;                   // its place in the game's sound list
    const base = registry?.soundsArray?.[0]?.id ?? 0;
    return Number.isInteger(id) ? registry?.sounds?.[id + base]?.name ?? null : null;
}

// The values a block property can take, in the order Java counts them.
const valuesOf = property => property.values
    ?? (property.type === 'bool' ? ['true', 'false'] : Array.from({ length: property.num_values }, (_, i) => String(i)));

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

    /**
     * The named properties of a block state, every value a string, or null for a block with none
     * (src/agent/memory/block_state.js). A Java state number is the block's first number plus an offset
     * that packs one digit per property, the last property in the lowest place.
     */
    propsOfState(registry, stateId) {
        const block = registry.blocksByStateId[stateId];
        if (!block?.states?.length) return null;
        let rest = stateId - block.minStateId;
        const props = {};
        for (let i = block.states.length - 1; i >= 0; i--) {
            const property = block.states[i];
            props[property.name] = valuesOf(property)[rest % property.num_values];
            rest = Math.floor(rest / property.num_values);
        }
        return props;
    },

    /**
     * The state number for a block name with these properties (src/agent/memory/block_state.js): the
     * block's default state with each property given replaced. A property the block doesn't have, or a
     * value it can't take, is ignored. Null for a block name the game data doesn't know.
     */
    stateOfProps(registry, name, props) {
        const block = registry.blocksByName[name];
        if (!block) return null;
        const base = block.defaultState ?? block.minStateId;
        const states = block.states ?? [];
        if (!props || !states.length) return base;
        const digits = [];
        let rest = base - block.minStateId;
        for (let i = states.length - 1; i >= 0; i--) {
            digits[i] = rest % states[i].num_values;
            rest = Math.floor(rest / states[i].num_values);
        }
        let offset = 0;
        states.forEach((property, i) => {
            const wanted = props[property.name] === undefined ? -1 : valuesOf(property).indexOf(String(props[property.name]));
            offset = offset * property.num_values + (wanted >= 0 ? wanted : digits[i]);
        });
        return block.minStateId + offset;
    },

    /** An empty table with one entry per block state of this game data (see StateTable above). */
    stateTable(registry) {
        return new StateTable(tableSize(registry));
    },

    /**
     * Calls `hear(soundName, position)` for every sound the server sends the bot, with the sound's name as
     * Java writes it ("minecraft:entity.cow.ambient") and where it came from. Only listens: nothing is sent.
     * The server sends a sound only to players close enough to hear it, so this is what a player with
     * subtitles on would get.
     * @returns {() => void} stops listening
     */
    onSound(bot, hear) {
        const atSpot = packet => hear(soundNameOf(bot.registry, packet), { x: packet.x / 8, y: packet.y / 8, z: packet.z / 8 });
        const ofEntity = packet => hear(soundNameOf(bot.registry, packet), bot.entities?.[packet.entityId]?.position);
        for (const name of SOUND_AT_SPOT) bot._client?.on?.(name, atSpot);
        bot._client?.on?.(SOUND_OF_ENTITY, ofEntity);
        return () => {
            for (const name of SOUND_AT_SPOT) bot._client?.off?.(name, atSpot);
            bot._client?.off?.(SOUND_OF_ENTITY, ofEntity);
        };
    },

    /**
     * Calls `report(level)` whenever the server tells the bot its operator level: 0 for none, higher for
     * more rights. A Java server does it with an entity status of 24 to 28 on the bot's own entity.
     * @returns {() => void} stops listening
     */
    onOperatorLevel(bot, report) {
        const listener = packet => {
            if (packet.entityId !== bot.entity?.id || packet.entityStatus < 24 || packet.entityStatus > 28) return;
            report(packet.entityStatus - 24);
        };
        bot._client?.on?.('entity_status', listener);
        return () => bot._client?.off?.('entity_status', listener);
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

    /**
     * Where the other half of a two-block thing is, when the game keeps that outside the block's state.
     * Java keeps it in the state (a chest's `type`, a door's `half`), where world memory's kinds.js reads
     * it, so here there is never anything more to say.
     *
     * @param {{position: {x:number, y:number, z:number}, entity?: object}} block - a block the bot can see
     * @returns {{x:number, y:number, z:number}|null}
     */
    otherHalfOf(block) {
        return null;
    },

    /**
     * Moves the stack in one slot of an open window onto another slot, the way a player does it with the
     * mouse: pick it up, click the other slot, and put back whatever came off. Onto an empty slot it is
     * put down; onto the same kind of item it is poured in, and what doesn't fit goes back; onto
     * anything else the two swap. Slots are numbered the way the window numbers them.
     *
     * (mineflayer has a helper for this, but it looks for the cursor on the bot's own inventory, which is
     * not where the cursor is while a chest is open, so a swap would leave a stack hanging in the air.)
     */
    async moveStack(bot, window, from, to) {
        await bot.clickWindow(from, 0, 0);
        await bot.clickWindow(to, 0, 0);
        if (window.selectedItem) await bot.clickWindow(from, 0, 0);
    },
});
