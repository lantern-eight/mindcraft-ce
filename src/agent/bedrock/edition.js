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
//   - **What a sign says,** which a Bedrock sign keeps per side in its block entity, in fields of its own.
//   - **Whether a mob is a baby,** one of the entity's named flags on Bedrock, not a numbered entry.
//   - **Moving a stack in an open chest,** which Bedrock does with one item stack request, not clicks
//     on a cursor (window_moves.js).
//
// Read with Java's answers, a hashed state number fits no table: nothing blocked sight, and a search over
// the chunks found nothing. That is why the bot named the dirt under a grass floor it was standing on.
//
// Registered for the game data type "bedrock" when this file is first imported. connect.js imports it,
// so it is in place before any bot starts.
import { registerEdition } from '../edition/index.js';
import { javaEdition as java, isShelfBlock, shelfClickAt, shelfSlots } from '../edition/java.js';
import { moveStack } from './window_moves.js';
import { bedrockNamesFor } from './names.js';

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
const SOUND_WORDS = { fuse: 'primed', bow: 'shoot' };
// Sounds the server sends that a player doesn't hear: a mob that appears makes no noise.
const SILENT = new Set(['spawn']);
// The mob events a Bedrock client plays a cry for, as the word in Java's sound name.
const CRIES = { hurt_animation: 'hurt', death_animation: 'death' };
// Sounds a Bedrock server plays for a block or a blast rather than a mob, as the Java sound hearing knows.
// One door, trapdoor or gate sound stands for all of their kinds, as hearing names them all alike.
const BLOCK_SOUNDS = {
    door_open: 'block.wooden_door.open', door_close: 'block.wooden_door.close',
    trapdoor_open: 'block.wooden_trapdoor.open', trapdoor_close: 'block.wooden_trapdoor.close',
    fence_gate_open: 'block.fence_gate.open', fence_gate_close: 'block.fence_gate.close',
    chest_open: 'block.chest.open', chest_closed: 'block.chest.close',
    ender_chest_open: 'block.ender_chest.open', ender_chest_closed: 'block.ender_chest.close',
    barrel_open: 'block.barrel.open', barrel_close: 'block.barrel.close',
    shulker_box_open: 'block.shulker_box.open', shulker_box_closed: 'block.shulker_box.close',
    explode: 'entity.generic.explode',
};

// ---- Operator rights ----

// A Bedrock server's command permission levels, in order: their place is the level the operator check reports, 0 for none.
// A villager's job by its `variant`, in Bedrock's order, which is not Java's.
const VILLAGER_JOBS = ['unemployed', 'farmer', 'fisherman', 'shepherd', 'fletcher', 'librarian', 'cartographer',
    'cleric', 'armorer', 'weaponsmith', 'toolsmith', 'butcher', 'leatherworker', 'mason', 'nitwit'];

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

// ---- Block names in Java's terms ----

// The game data's table from Bedrock's block names to Java's, read once per game version (see javaNameOf).
const javaNames = new Map(); // version -> translation from names.js, or null when there is no table
function javaNamesFor(registry) {
    const version = registry?.version?.minecraftVersion;
    if (!javaNames.has(version)) javaNames.set(version, bedrockNamesFor(version));
    return javaNames.get(version);
}

// ---- Reach ----

// A survival player's reach on Bedrock (see survivalReach).
const SURVIVAL_REACH = Object.freeze({ blocks: 5, entities: 3 });

// ---- Furnaces ----

// Bedrock's furnace blocks (see furnaceOf): a burning furnace is a block of its own, not a state.
const FURNACES = new Map([
    ['furnace', { kind: 'furnace', lit: false }], ['lit_furnace', { kind: 'furnace', lit: true }],
    ['blast_furnace', { kind: 'blast_furnace', lit: false }], ['lit_blast_furnace', { kind: 'blast_furnace', lit: true }],
    ['smoker', { kind: 'smoker', lit: false }], ['lit_smoker', { kind: 'smoker', lit: true }],
]);

// ---- Melee ----

// What a melee hit does on Bedrock (see meleeOf): each item's attack damage. Bedrock's swords hit harder
// than Java's and its axes softer, so a sword is the better weapon there in every material.
const bedrockTier = (kind, damages) => Object.entries(damages).map(([material, damage]) => [`${material}_${kind}`, damage]);
const BEDROCK_DAMAGE = new Map([
    ...bedrockTier('sword', { wooden: 5, golden: 5, stone: 6, copper: 6, iron: 7, diamond: 8, netherite: 9 }),
    ...bedrockTier('axe', { wooden: 4, golden: 4, stone: 5, copper: 5, iron: 6, diamond: 7, netherite: 8 }),
    ...bedrockTier('pickaxe', { wooden: 3, golden: 3, stone: 4, copper: 4, iron: 5, diamond: 6, netherite: 7 }),
    ...bedrockTier('shovel', { wooden: 2, golden: 2, stone: 3, copper: 3, iron: 4, diamond: 5, netherite: 6 }),
    ['trident', 9],
]);
// How often an archer shoots on Bedrock, in ms, on easy and normal and on hard (see shotBeatMs): each one's
// ranged attack interval in Mojang's published behavior files.
const SHOT_BEATS = { skeleton: [3000, 2000], stray: [3000, 2000], bogged: [3500, 2500] };

// A mob hurt can't be hurt again for 10 ticks. With no attack meter, that is how often a swing counts.
const BEDROCK_HURT_PAUSE_MS = 500;

// Mobs that attack any player they see, whatever happens, and the ones among them that shoot (see
// isAggressive and isAiming). By Bedrock's names: an evoker is `evocation_illager` there.
const ALWAYS_HOSTILE = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_villager_v2', 'skeleton', 'stray', 'bogged',
    'wither_skeleton', 'creeper', 'witch', 'pillager', 'vindicator', 'evocation_illager', 'ravager', 'slime', 'magma_cube', 'silverfish',
    'endermite', 'blaze', 'ghast', 'phantom', 'guardian', 'elder_guardian', 'hoglin', 'piglin_brute', 'vex', 'zoglin', 'breeze', 'shulker']);
const SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'blaze', 'ghast']);
const AIM_DEGREES = 20;
const PUSH_WITHIN_MS = 100;
// Whether a mob's head faces a point, within `degrees`: the way it looks, as mineflayer turns its yaw (0
// faces north, -z), against the way to the point.
function faces(entity, at, degrees) {
    const yaw = entity.headYaw ?? entity.yaw;
    if (typeof yaw !== 'number') return false;
    const dx = at.x - entity.position.x, dz = at.z - entity.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return true;
    const dot = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / length;
    return dot >= Math.cos(degrees * Math.PI / 180);
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
     * Whether leaves were placed by a player and so never fall away, as on Java. Bedrock keeps it as the
     * `persistent_bit` of the leaves' state, a byte: 1 for placed leaves.
     */
    leavesPersist(registry, stateId) {
        return bedrockEdition.propsOfState(registry, stateId)?.persistent_bit === '1';
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
     * bot's own cries are left out. Doors, chests and the like, and explosions, come as sounds played at
     * a spot, and are named too. Only listens.
     */
    onSound(bot, hear) {
        const played = packet => {
            const block = BLOCK_SOUNDS[packet?.sound_id];
            if (block) return hear(block, packet.position); // whatever made it: a creeper's blast is an explosion
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

    /**
     * What a sign says, one string per side, the front first. A Bedrock sign keeps each side's text in
     * its block entity, under `FrontText` and `BackText`, with the lines on rows of their own; a sign
     * from before signs had two sides has a single `Text`. The library's own reading of a Bedrock sign
     * looks only for that old field, so with a current server it never found any text.
     */
    signSidesOf(block) {
        const fields = block?.entity?.value ?? block?.entity;
        // The block entity comes as tagged values ({type, value}); a plain copy of it has bare ones.
        const plain = field => field && typeof field === 'object' && 'type' in field && 'value' in field ? field.value : field;
        const textOf = side => { const text = plain(plain(side)?.Text); return typeof text === 'string' ? text : ''; };
        if (fields?.FrontText || fields?.BackText) return [textOf(fields.FrontText), textOf(fields.BackText)];
        const old = plain(fields?.Text);
        return typeof old === 'string' ? [old] : [];
    },

    /**
     * What a shelf shows (as on Java: its facing, whether it is powered, and its three slots). Bedrock names
     * the state's parts its own way, `minecraft:cardinal_direction` and `powered_bit`, and keeps the items in
     * the shelf's block entity as a container does, `Items` with `Slot`, `Name` and `Count`, in tagged
     * values the adapter hands on as they came.
     */
    shelfOf(block) {
        if (!isShelfBlock(block?.name)) return null;
        let props = {};
        try { props = block.getProperties?.() ?? {}; } catch { /* a shape without properties: none known */ }
        const plain = field => (field && typeof field === 'object' && 'type' in field && 'value' in field ? field.value : field);
        const fields = plain(block?.entity);
        let slots = null;
        if (fields && typeof fields === 'object') {
            let items = plain(fields.Items) ?? [];
            if (items && !Array.isArray(items)) items = plain(items) ?? [];   // a tagged list: {type, value: [...]}
            // The list holds all three slots in order, an empty one as a blank name and a count of 0, with no
            // Slot field (checked on a 1.26.60 server): where an entry stands is its slot.
            slots = shelfSlots((Array.isArray(items) ? items : []).map((entry, index) => {
                const item = plain(entry) ?? {};
                return { slot: plain(item.Slot) ?? index, name: plain(item.Name ?? item.name), count: plain(item.Count ?? item.count) };
            }));
        }
        const powered = props.powered_bit;
        return { facing: props['minecraft:cardinal_direction'] ?? props.facing ?? null, powered: powered === 1 || powered === true || powered === '1', slots };
    },

    /**
     * Clicks one slot of a shelf (see Java's answer). The adapter's `activateBlock` always clicks the
     * middle of a face, which is the middle slot, so this goes through the click the adapter places blocks
     * with, which takes the point on the face (`delta`), without the start and end of an item use that a
     * placement sends: a plain click on a block, as when a chest is opened.
     */
    async clickShelfSlot(bot, block, slot) {
        const at = shelfClickAt(bedrockEdition.shelfOf(block)?.facing, slot);
        if (!at) throw new Error('there is no telling which way the shelf faces');
        if (typeof bot._genericPlace !== 'function') throw new Error('the Bedrock adapter in use cannot click a point on a block');
        await bot._genericPlace(block, at.face, { delta: at.cursor, swingArm: 'right', itemUseLifecycle: false });
    },

    /**
     * Moves `count` of a stack between two of the bot's own slots (see Java's answer). Bedrock moves a
     * given number in one request, and swaps two different items. A move between the hotbar and the main inventory needs the inventory
     * screen open, as a player has it open to do it, so it is opened for the move and closed again.
     */
    async moveInBag(bot, from, to, count) {
        const item = bot.inventory.slots[from];
        if (!item) return;
        const bedrockSlot = slot => (slot >= 36 ? slot - 36 : slot);
        const crosses = (from >= 36) !== (to >= 36);
        const opened = crosses && !bot.currentWindow && typeof bot.openInventory === 'function';
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        if (opened) { bot.openInventory(); await pause(400); }
        try {
            bot.moveInventoryItem(bedrockSlot(from), bedrockSlot(to), Math.min(count ?? item.count, item.count));
            await pause(400);
        } finally {
            if (opened && bot.currentWindow) bot.closeWindow(bot.currentWindow);
        }
    },

    /**
     * Is this mob a baby? The adapter keeps a Bedrock mob's metadata by name, not by Java's numbered
     * entries, and a mob's age is one of the entity's flags there (`flags.baby`). Java's entry 16 is
     * never filled in on Bedrock, so read the Java way every calf passed for a cow.
     */
    isBaby(entity) {
        return Boolean(entity?.metadata?.flags?.baby);
    },

    /**
     * Is this creeper's fuse lit? A Bedrock creeper about to blow has the `ignited` flag among its entity
     * flags, the same set `isBaby` reads; the server sets it whether the creeper lit itself or was lit
     * with flint and steel.
     */
    isFusing(registry, entity) {
        return entity?.name === 'creeper' && Boolean(entity.metadata?.flags?.ignited);
    },

    /**
     * Is this mob aiming a ranged attack? A Bedrock server sends no flag for it: a skeleton drawing its bow at
     * the bot showed none (1.26.63), though the entity flags have names for a crossbow charged (`charged`)
     * and a blaze or ghast winding up (`charge_attack`), read here in case a server sends them. What a player
     * does see is the archer turning to face it: a shooter that always attacks players, within 20 degrees of
     * facing `at` (the eye of whoever asks), is taken to be aiming at it.
     * @param {{x:number, y:number, z:number}} [at]
     */
    isAiming(registry, entity, at) {
        const flags = entity?.metadata?.flags ?? {}, more = entity?.metadata?.flags_extended ?? {};
        if (flags.charged || flags.charge_attack || more.facing_target_to_range_attack) return true;
        if (!SHOOTERS.has(entity?.name) || !at || !entity.position) return false;
        return faces(entity, at, AIM_DEGREES);
    },

    /**
     * Is this mob about to loose a shot? A Bedrock server shows no bow drawn. Watched packet by packet
     * (1.26.63), nothing it sends about a skeleton changes between its taking a target and each arrow: not the
     * `action` flag (the one Geyser shows a Java skeleton's draw to Bedrock players with), not `charged` or
     * `charge_amount`, no event. So a skeleton's shots come with no tell to raise a shield for; what a Bedrock
     * player goes by is the beat, a shot every 3 s with its `bow` sound. A crossbow `charged`, or a blaze or
     * ghast winding up (`charge_attack`), is read if a server sends it.
     */
    isDrawing(registry, entity, at) {
        const flags = entity?.metadata?.flags ?? {};
        return Boolean(flags.charged || flags.charge_attack);
    },

    /**
     * Has this mob picked a target and come for it? A Bedrock server doesn't say: a zombie biting the bot
     * showed no flag and no target (1.26.63). What a Bedrock player goes by is the kind of mob: one that
     * always attacks players has come for whoever it can see. A neutral mob (an enderman, a spider by day,
     * a zombified piglin) counts only when it is `angry`.
     */
    isAggressive(registry, entity) {
        return Boolean(entity?.metadata?.flags?.angry) || ALWAYS_HOSTILE.has(entity?.name);
    },

    /**
     * Calls `felt({ direction })` each time the bot is hurt. A Bedrock server tells the player it was hurt
     * with an entity event, and pushes it back from the hit in the same moment (`set_entity_motion`); a
     * player feels the push. The side the hit came from is the other way from the push. A hit that pushes
     * nowhere (fire, a fall) gives a null direction.
     * @returns {() => void} stops listening
     */
    onHurt(bot, felt) {
        let push = null; // {at, x, z}: the last push the server gave the bot
        const pushed = packet => {
            if (Number(packet?.runtime_entity_id) !== bot.entity?.id || !packet.velocity) return;
            push = { at: Date.now(), x: packet.velocity.x, z: packet.velocity.z };
        };
        const listener = packet => {
            if (packet?.event_id !== 'hurt_animation' || Number(packet.runtime_entity_id) !== bot.entity?.id) return;
            const tell = () => {
                const recent = push && Date.now() - push.at <= PUSH_WITHIN_MS && Math.hypot(push.x, push.z) > 0.05;
                const length = recent ? Math.hypot(push.x, push.z) : 0;
                felt({ direction: recent ? { x: -push.x / length, z: -push.z / length } : null });
            };
            // The push comes just before the event, or just after it.
            if (push && Date.now() - push.at <= PUSH_WITHIN_MS) tell(); else setTimeout(tell, PUSH_WITHIN_MS);
        };
        bot._client?.on?.('set_entity_motion', pushed);
        bot._client?.on?.('entity_event', listener);
        return () => {
            bot._client?.off?.('set_entity_motion', pushed);
            bot._client?.off?.('entity_event', listener);
        };
    },

    /**
     * Is this mob a villager, and is it a child, what is its job and its level? Bedrock's villager is
     * `villager_v2` (`villager` is the one from before villages were reworked, kept for old worlds). Its
     * job is its `variant`, numbered in Bedrock's own order, and its level is its `trade_tier`, which
     * counts from 0 for a novice where Java's level counts from 1.
     */
    villagerOf(entity) {
        if (entity?.name !== 'villager_v2' && entity?.name !== 'villager') return null;
        const { variant, trade_tier: tier } = entity.metadata ?? {};
        return {
            baby: Boolean(entity.metadata?.flags?.baby),
            profession: VILLAGER_JOBS[variant] ?? null,
            level: Number.isInteger(tier) ? tier + 1 : null,
        };
    },

    /**
     * A block's name as Java Edition calls it, for Mindcraft's lists of Java's names. Bedrock names some
     * blocks its own way: water and lava that are still spreading are `flowing_water` and `flowing_lava`,
     * Java's thin layer of snow is `snow_layer` while Bedrock's `snow` is a whole block, a powered rail is a
     * `golden_rail`. The game data has a table from every Bedrock block to the Java block it stands for,
     * which world memory also goes by (names.js). A name the table doesn't have, such as an item that
     * places no block, is kept as it is.
     */
    javaNameOf(registry, name) {
        return javaNamesFor(registry)?.(name)?.name ?? name;
    },

    /**
     * How far a survival player reaches, from the eye. A Bedrock player with a keyboard and mouse or a
     * controller clicks and digs blocks up to 5 blocks away, half a block farther than on Java, and hits a
     * mob up to 3 away, as on Java. A player on a touch screen reaches a block 6 away; the bot is held to
     * the shorter reach, the one most players have.
     *
     * The server can't be asked: it lets far more through. A Bedrock Dedicated Server took a block dug 10
     * blocks away, a trapdoor opened 7 away and a mob hit 6 away, because it allows a margin for lag (half
     * as much again for digging) and does not check how far a hit reaches unless told to. Told to, with no
     * margin, it refused every hit past 3.
     *
     * @returns {{blocks: number, entities: number}}
     */
    survivalReach() {
        return SURVIVAL_REACH;
    },

    /**
     * What a melee hit with an item does. Bedrock has no attack meter: every swing does the item's full
     * damage however soon it follows the last. What limits a fight instead is the mob: once hurt, it can't
     * be hurt again for half a second, so a swing sooner than that does nothing. That half second is the
     * "recharge" here, the same for every item.
     *
     * @param {string|null|undefined} itemName - what is in the hand; nothing means a bare hand
     * @returns {{damage: number, rechargeMs: number}}
     */
    meleeOf(itemName) {
        return { damage: BEDROCK_DAMAGE.get(itemName) ?? 1, rechargeMs: BEDROCK_HURT_PAUSE_MS };
    },

    /**
     * How often a kind of archer shoots, when it shoots on a fixed beat. A Bedrock skeleton shows no bow drawn
     * (isDrawing), but its shots keep time: one every 3 s (2 s on hard), a bogged's every 3.5 s (2.5 s), each
     * with its `bow` sound, which a player hears and learns. Watched on a real server, a skeleton's first shot
     * came 3.1 s after it took the bot as its target and the rest 3.05 s apart.
     * @param {string} kind - the mob's name
     * @param {string} [difficulty] - the game's difficulty, as the bot knows it
     * @returns {number|null} ms between shots, or null for a mob that keeps no beat
     */
    shotBeatMs(kind, difficulty) {
        const beat = SHOT_BEATS[kind];
        return beat ? beat[difficulty === 'hard' ? 1 : 0] : null;
    },

    /**
     * Raises the shield in the off-hand, or lowers it. A Bedrock player raises a shield by sneaking, on every
     * kind of controls, and lowers it by standing up. Sneaking slows the walk as it always does.
     */
    raiseShield(bot, up) {
        bot.setControlState('sneak', up);
    },

    /**
     * Which furnace blocks the bot can smelt in. Bedrock's blast furnace and smoker open windows of their own
     * kind, with their own name for the input slot, and the pinned library puts into and takes out of only a
     * furnace's window. So only furnaces, until it does: a smelt then leaves the other two alone.
     *
     * @returns {('furnace'|'blast_furnace'|'smoker')[]}
     */
    usableFurnaceKinds() {
        return ['furnace'];
    },

    /**
     * Whether a block is a furnace (or a blast furnace or a smoker), and whether it is lit. Bedrock swaps a
     * furnace for a block of its own while it burns (`lit_furnace`), and back when it goes out, so the name
     * says both.
     */
    furnaceOf(block) {
        const furnace = block ? FURNACES.get(block.name) : undefined;
        return furnace ? { ...furnace } : null;
    },

    /**
     * What a cauldron holds, and whether it is full. Bedrock has one cauldron block for every liquid: the
     * `cauldron_liquid` state says which, and `fill_level` how much, from 0 (empty) to 6 (full). A bucket
     * takes only a full one.
     */
    cauldronOf(block) {
        if (block?.name !== 'cauldron') return null;
        let state;
        try { state = block.getProperties?.() ?? {}; } catch { state = {}; }
        const level = Number(state.fill_level);
        if (!(level > 0)) return { liquid: null, full: false };
        const liquid = ['water', 'lava', 'powder_snow'].includes(state.cauldron_liquid) ? state.cauldron_liquid : 'water';
        return { liquid, full: level === 6 };
    },

    moveStack,
});

registerEdition('bedrock', bedrockEdition);
