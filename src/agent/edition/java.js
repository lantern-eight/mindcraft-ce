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

// A survival player's reach on Java (see survivalReach).
const SURVIVAL_REACH = Object.freeze({ blocks: 4.5, entities: 3 });

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

// The jobs a villager can have, in the order Java's game numbers them (its villager_profession list).
const PROFESSIONS = ['unemployed', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
    'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];

// A mob's age, at the index the game gives an animal's (see isBaby below).
const isBaby = entity => Boolean(entity?.metadata?.[16]);

// Where a creeper's fuse is kept in its metadata, found by name once per game data (see isFusing).
const fuseEntries = new WeakMap(); // registry -> { swell, ignited } metadata indexes, or null
function fuseEntriesOf(registry) {
    if (!registry || typeof registry !== 'object') return null;
    if (!fuseEntries.has(registry)) {
        const keys = registry.entitiesByName?.creeper?.metadataKeys ?? [];
        const swell = keys.indexOf('swell_dir'), ignited = keys.indexOf('is_ignited');
        fuseEntries.set(registry, swell < 0 ? null : { swell, ignited });
    }
    return fuseEntries.get(registry);
}

// Where a mob's flags are kept in its metadata, found by name once per game data and kind of mob (see
// isAiming and isAggressive). Every mob has `living_entity_flags` and `mob_flags`; a few have more.
const flagEntries = new WeakMap(); // registry -> Map(kind -> { name -> metadata index })
function entryOf(registry, kind, name) {
    if (!registry || typeof registry !== 'object') return -1;
    if (!flagEntries.has(registry)) flagEntries.set(registry, new Map());
    const kinds = flagEntries.get(registry);
    if (!kinds.has(kind)) {
        const keys = registry.entitiesByName?.[kind]?.metadataKeys ?? [];
        kinds.set(kind, Object.fromEntries(keys.map((key, index) => [key, index])));
    }
    return kinds.get(kind)[name] ?? -1;
}
const flagOf = (registry, entity, name, bit) => {
    const at = entryOf(registry, entity?.name, name);
    return at >= 0 && (Number(entity.metadata?.[at] ?? 0) & bit) !== 0;
};
const fieldOf = (registry, entity, name) => {
    const at = entryOf(registry, entity?.name, name);
    return at >= 0 ? entity.metadata?.[at] : undefined;
};
const HAND_ACTIVE = 0x01;   // living_entity_flags: the mob is using what it holds (drawing a bow)
const AGGRESSIVE = 0x04;    // mob_flags: the mob has a target, and raises its arms or its weapon at it
const BLAZE_CHARGED = 0x01; // a blaze's own flags: it glows and smokes before it fires
// Mobs that shoot with a bow, and mobs that shoot with a crossbow (a piglin only when it holds one).
const BOW_SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'illusioner']);
const CROSSBOW_SHOOTERS = new Set(['pillager', 'piglin']);
const holds = (entity, item) => [entity?.heldItem, entity?.equipment?.[0]].some(held => held?.name === item);

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
     * What a sign says: one string per side, the front first, each with its lines on separate rows. The
     * game keeps the text in the sign's block entity, whose shape differs by edition; Java's blocks read
     * their own (`getSignText`), so here that is only passed on.
     *
     * @param {object} block - a sign the bot can see
     * @returns {string[]} the sides' text; empty when the block has none
     */
    signSidesOf(block) {
        return block?.getSignText?.() ?? [];
    },

    /**
     * Is this mob a baby? Anyone can see that by looking. Java keeps it as a flag in the mob's metadata,
     * at the index the game gives an animal's age: 16 in current versions (the entity's own entries run
     * 0 to 7, a living one's 8 to 14, a mob's 15).
     *
     * @param {object} entity - a mob the bot can see
     * @returns {boolean}
     */
    isBaby(entity) {
        return isBaby(entity);
    },

    /**
     * Is this creeper's fuse lit? A player sees it: a lit creeper swells and flashes white. Java keeps it in
     * two entries of the creeper's metadata: `swell_dir`, 1 while the fuse burns and -1 while it runs back
     * down, and `is_ignited`, set when a player lights it with flint and steel. Both are found by name in the
     * game data, not by a fixed place, because the place moves when the game adds an entry before them (16
     * and 18 from 1.21 to 26.3).
     *
     * @param {object} registry - the bot's game data
     * @param {object} entity - a mob the bot can see
     * @returns {boolean} false for anything that isn't a creeper
     */
    isFusing(registry, entity) {
        if (entity?.name !== 'creeper') return false;
        const at = fuseEntriesOf(registry);
        if (!at) return false;
        const metadata = entity.metadata ?? {};
        return metadata[at.swell] > 0 || (at.ignited >= 0 && metadata[at.ignited] === true);
    },

    /**
     * Is this mob aiming a ranged attack? A player sees it: a skeleton raises its bow at its target and
     * draws it, a pillager holds up its crossbow or loads it, a ghast opens its eyes and mouth, a blaze
     * glows before it fires. Java keeps each in the mob's metadata, found by name: the aggressive bit of
     * `mob_flags` (the game shows it as the bow or crossbow held up), the hand-active bit of
     * `living_entity_flags` (the bow being drawn), `is_charging_crossbow`, the ghast's `is_charging`, and
     * the first bit of a blaze's `flags`. A mob that only shoots up close (a witch's potions) isn't counted.
     *
     * @param {object} registry - the bot's game data
     * @param {object} entity - a mob the bot can see
     * @param {{x:number, y:number, z:number}} [at] - the eye of whoever asks; Java's answer doesn't need it
     * @returns {boolean}
     */
    isAiming(registry, entity, at) {
        const kind = entity?.name;
        if (BOW_SHOOTERS.has(kind))
            return flagOf(registry, entity, 'mob_flags', AGGRESSIVE) || flagOf(registry, entity, 'living_entity_flags', HAND_ACTIVE);
        if (CROSSBOW_SHOOTERS.has(kind)) {
            if (fieldOf(registry, entity, 'is_charging_crossbow') === true) return true;
            return flagOf(registry, entity, 'mob_flags', AGGRESSIVE) && (kind === 'pillager' || holds(entity, 'crossbow'));
        }
        if (kind === 'ghast') return fieldOf(registry, entity, 'is_charging') === true;
        if (kind === 'blaze') return flagOf(registry, entity, 'flags', BLAZE_CHARGED);
        return false;
    },

    /**
     * Has this mob picked a target and come for it? A player sees it: a zombie walks at you with its arms
     * out, a skeleton raises its bow. Java keeps it as the aggressive bit of the mob's `mob_flags`, found by
     * name, which the game sets while a mob's attack goal runs and clears when it stops (a spider by day,
     * a mob that lost its target). A neutral mob that hasn't been provoked never has it.
     *
     * @param {object} registry - the bot's game data
     * @param {object} entity - a mob the bot can see
     * @returns {boolean}
     */
    isAggressive(registry, entity) {
        return flagOf(registry, entity, 'mob_flags', AGGRESSIVE);
    },

    /**
     * Calls `felt({ direction })` each time the bot is hit by something that came from a side, with
     * `direction` the way the hit came from as a flat unit vector {x, z}. A player sees it: the screen tilts
     * toward the hit. Java sends it to the player hurt alone, as the angle of the hit from where the player
     * faces (`hurt_animation`, degrees). The game's angle 0 is east (+x) and 90 south (+z); the player's
     * own facing is turned to the game's degrees from mineflayer's (radians, 0 north, turning the other
     * way) to add to it. Who hit the bot is not told: the game sends that too (`damage_event`), and a
     * player isn't shown it.
     *
     * The server measures the angle from the facing the bot last sent it, which is not the facing mineflayer
     * shows: mineflayer turns the bot at once but sends the turn a little at a time, over several ticks. So
     * the facing added back is the last one the two agreed on: the one the bot last sent, read off the
     * packets it writes (in the game's degrees already), or the one the server last set, by a teleport or
     * a turn of its own, which mineflayer takes as sent.
     * @returns {() => void} stops listening
     */
    onHurt(bot, felt) {
        const client = bot._client;
        let sent = null; // the game's yaw the server has for the bot, in degrees
        const shown = () => 180 - (bot.entity?.yaw ?? 0) * 180 / Math.PI;
        const write = client?.write;
        if (typeof write === 'function') {
            client.write = function (name, params, ...rest) {
                if ((name === 'look' || name === 'position_look') && typeof params?.yaw === 'number') sent = params.yaw;
                return write.call(this, name, params, ...rest);
            };
        }
        // mineflayer handles these first, and turns the bot to what the server says.
        const setByServer = () => { sent = shown(); };
        const listener = packet => {
            if (packet.entityId !== bot.entity?.id || typeof packet.yaw !== 'number') return;
            const angle = (packet.yaw + (sent ?? shown())) * Math.PI / 180;
            felt({ direction: { x: Math.cos(angle), z: Math.sin(angle) } });
        };
        client?.on?.('hurt_animation', listener);
        client?.on?.('position', setByServer);
        client?.on?.('player_rotation', setByServer);
        return () => {
            client?.off?.('hurt_animation', listener);
            client?.off?.('position', setByServer);
            client?.off?.('player_rotation', setByServer);
            if (typeof write === 'function') client.write = write;
        };
    },

    /**
     * Is this mob a villager, and what can anyone see of it: whether it is a child, its job (from the
     * clothes it wears) and how far it has come in that job (the badge on its belt, 1 for a novice to 5
     * for a master). Java keeps the job and level together in one entry of the villager's metadata, the
     * job as its place in the game's list. That entry was 18 up to 1.21 and is 19 from 26.1, which added
     * one before it, so it is found by its shape. Versions before 1.14 sent only the job's number, at 18.
     *
     * @param {object} entity - a mob the bot can see
     * @returns {{baby: boolean, profession: string|null, level: number|null}|null} null when it is not a
     *     villager; a job or level that isn't known is null
     */
    villagerOf(entity) {
        if (entity?.name !== 'villager') return null;
        const data = Object.values(entity.metadata ?? {})
            .find(value => value && typeof value === 'object' && value.villagerProfession !== undefined);
        const job = data ? data.villagerProfession : typeof entity.metadata?.[18] === 'number' ? entity.metadata[18] : null;
        const level = Number.isInteger(data?.level) ? data.level : null;
        return { baby: isBaby(entity), profession: PROFESSIONS[job] ?? null, level };
    },

    /**
     * A block's name as Java Edition calls it. Mindcraft's skills and reflexes check what is in front of the
     * bot against lists of Java's names (what may be built over, what is water or lava), and ask this so
     * those lists hold on another game too. On Java a name is its own.
     *
     * @param {object} registry - the bot's game data
     * @param {string} name - a block's name in the game in play, or the name of the item that places it
     * @returns {string}
     */
    javaNameOf(registry, name) {
        return name;
    },

    /**
     * How far a survival player reaches, from the eye: to the nearest part of a block it clicks or digs, and
     * to the nearest part of a mob's hitbox it hits or uses. Java keeps these as two attributes of the
     * player (`block_interaction_range` and `entity_interaction_range`, from 1.20.5), 4.5 and 3 unless a
     * server changes them. Creative mode reaches farther; fair play plays survival.
     *
     * @returns {{blocks: number, entities: number}}
     */
    survivalReach() {
        return SURVIVAL_REACH;
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
