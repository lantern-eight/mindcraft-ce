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
//   - **Sounds.** A Bedrock client makes most mob noises itself. The server sends a sound for some things
//     a mob does, and only an event when a mob is hurt or dies, from which the client plays the cry. It
//     never sends a mob's everyday noises (a cow's moo): the client makes those up as it goes.
//   - **Operator rights,** which a Bedrock server gives as a permission level, not an entity status.
//   - **A block state's properties,** which Bedrock's game data lists for every state by name, with
//     Bedrock's own names (`upper_block_bit` for the top half of a door).
//   - **A double chest,** whose two halves name each other in their block entities, not their states.
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

// ---- Sounds ----

// What a Bedrock sound is called, as the word Java uses in its sound names, where the two differ. Hearing
// reads the Java name ("entity.creeper.primed" is a creeper about to blow).
const SOUND_WORDS = { fuse: 'primed' };
// Sounds the server sends that a player doesn't hear: a mob that appears makes no noise.
const SILENT = new Set(['spawn']);
// The mob events a Bedrock client plays a cry for, as the word in Java's sound name.
const CRIES = { hurt_animation: 'hurt', death_animation: 'death' };

// ---- Operator rights ----

// A Bedrock server's command permission levels, in order: their place is the level the operator check reports, 0 for none.
const COMMAND_LEVELS = ['normal', 'operator', 'automation', 'host', 'owner', 'internal'];

// ---- Block states by name ----

// A property's value as world memory keeps it: always a string. Bedrock gives whole numbers for flags.
const propText = value => (typeof value === 'boolean' ? (value ? '1' : '0') : String(value));

// Every state of each block, by its properties, worked out once per game data: block name ->
// { defaults: the default state's properties, values: each property's values, byProps: key -> state }.
const statesByBlock = new WeakMap();
const propsKey = props => Object.keys(props).sort().map(key => `${key}=${props[key]}`).join(',');
function blockStatesOf(registry, name) {
    let byName = statesByBlock.get(registry);
    if (!byName) {
        byName = new Map();
        for (const state of registry.blockStates ?? []) {
            let entry = byName.get(state.name);
            if (!entry) byName.set(state.name, entry = { defaults: null, values: new Map(), byProps: new Map() });
            const props = bedrockEdition.propsOfState(registry, state.stateId) ?? {};
            for (const [key, value] of Object.entries(props)) {
                if (!entry.values.has(key)) entry.values.set(key, new Set());
                entry.values.get(key).add(value);
            }
            entry.byProps.set(propsKey(props), state.stateId);
        }
        statesByBlock.set(registry, byName);
    }
    const entry = byName.get(name);
    if (entry && !entry.defaults) entry.defaults = bedrockEdition.propsOfState(registry, registry.blocksByName[name]?.defaultState) ?? {};
    return entry ?? null;
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

    /**
     * The named properties of a block state, every value a string, or null for a block with none.
     * Bedrock's game data lists them for each state; the names are Bedrock's.
     */
    propsOfState(registry, stateId) {
        const states = registry.blockStatesByStateId?.[stateId]?.states;
        if (!states) return null;
        const keys = Object.keys(states);
        if (!keys.length) return null;
        return Object.fromEntries(keys.map(key => [key, propText(states[key]?.value ?? states[key])]));
    },

    /**
     * The state for a block name with these properties: the block's default state with each property
     * given replaced, as on Java. A property the block doesn't have, a value it can't take, or a mix of
     * values no state has, keeps the default.
     */
    stateOfProps(registry, name, props) {
        const block = registry.blocksByName[name];
        if (!block) return null;
        if (!props) return block.defaultState;
        const entry = blockStatesOf(registry, name);
        if (!entry) return block.defaultState;
        const wanted = { ...entry.defaults };
        for (const [key, value] of Object.entries(props)) {
            if (entry.values.get(key)?.has(propText(value))) wanted[key] = propText(value);
        }
        return entry.byProps.get(propsKey(wanted)) ?? block.defaultState;
    },

    stateTable(registry) {
        return hasStateRuns(registry) ? java.stateTable(registry) : new HashedStateTable(slotsOf(registry));
    },

    /**
     * Sounds by their Java names ("entity.cow.hurt"), from the two things a Bedrock server sends about mob
     * noises: a sound it plays for a mob, and the event the client plays a hurt or death cry for. The
     * bot's own cries are left out. Only listens.
     */
    onSound(bot, hear) {
        const played = packet => {
            const kind = String(packet?.entity_type ?? '').replace(/^minecraft:/, '');
            if (!kind || typeof packet.sound_id !== 'string' || SILENT.has(packet.sound_id)) return;
            hear(`entity.${kind}.${SOUND_WORDS[packet.sound_id] ?? packet.sound_id}`, packet.position);
        };
        const cried = packet => {
            const cry = CRIES[packet?.event_id];
            if (!cry) return;
            const mob = bot.entities?.[Number(packet.runtime_entity_id)];
            if (!mob?.name || mob === bot.entity) return;
            hear(`entity.${mob.name}.${cry}`, mob.position);
        };
        bot._client?.on?.('level_sound_event', played);
        bot._client?.on?.('entity_event', cried);
        return () => {
            bot._client?.off?.('level_sound_event', played);
            bot._client?.off?.('entity_event', cried);
        };
    },

    /**
     * The operator level from the permissions a Bedrock server gives the bot, which mineflayer's Bedrock
     * adapter hands on as `abilities`: the command permission's place in COMMAND_LEVELS, and at least 1
     * for a player the server calls an operator.
     */
    onOperatorLevel(bot, report) {
        const listener = abilities => {
            const command = Math.max(0, COMMAND_LEVELS.indexOf(abilities?.commandPermission));
            report(abilities?.permissionLevel === 'operator' ? Math.max(1, command) : command);
        };
        bot.on?.('abilities', listener);
        return () => bot.off?.('abilities', listener);
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

    /**
     * A Bedrock chest's state says only which way it faces. Whether it is half of a double chest, and
     * which block is the other half, is in its block entity: `pairx` and `pairz`, the other half's
     * place. The two halves stand side by side on one level, so anything else is not a pairing.
     */
    otherHalfOf(block) {
        const fields = block?.entity?.value ?? block?.entity;
        const read = key => { const field = fields?.[key]; return field && typeof field === 'object' ? field.value : field; };
        const x = read('pairx'), z = read('pairz');
        const at = block?.position;
        if (!Number.isInteger(x) || !Number.isInteger(z) || !at) return null;
        const here = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
        if (Math.abs(x - here.x) + Math.abs(z - here.z) !== 1) return null;
        return { x, y: here.y, z };
    },
});

registerEdition('bedrock', bedrockEdition);
