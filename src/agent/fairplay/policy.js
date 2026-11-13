// Fair-play policy: turns the `fair_play` settings into one frozen object every check reads.
//
// There is one master switch, `fair_play`:
//   "strict"  every rule at its fair value (the project default)
//   "off"     stock Mindcraft behavior: nothing is filtered (the default when the setting is absent, so
//             these modules change nothing for anyone who doesn't opt in)
//   "custom"  start from strict and loosen individual rules with `fair_play_custom`
// Each rule is then checked in exactly one place (see the design doc, section 3.10). That is what makes
// the switches cheap: flipping `ores_through_walls` changes one category in the query provider and
// nothing else.

export const STRICT_RULES = Object.freeze({
    // Information
    sight: 'rays',                  // 'rays' | 'open_face' | 'all'
    ores_through_walls: false,
    containers_through_walls: false,
    stations_through_walls: false,
    mobs_through_walls: false,
    players_through_walls: 'nametag', // 'nametag' | true | false
    fov_degrees: 360,
    sight_distance: 'server',       // 'server' (whatever is loaded) or a number of blocks
    entity_distance: 64,
    hearing_radius: 16,
    // Actions
    interact_through_walls: false,
    reach_blocks: 4.5,              // how far a survival player can click or dig a block, eye to block
    reach_entities: 3,              // how far a survival player can hit or use a mob, eye to hitbox
    slash_commands: false,
    slash_allowlist: Object.freeze(['tell', 'msg', 'w']),
    cheat_mode: false,
    generated_code: 'wrapped',      // 'off' | 'wrapped' | 'raw'
});

export const OFF_RULES = Object.freeze({
    ...STRICT_RULES,
    sight: 'all',
    ores_through_walls: true,
    containers_through_walls: true,
    stations_through_walls: true,
    mobs_through_walls: true,
    players_through_walls: true,
    interact_through_walls: true,
    slash_commands: true,
    cheat_mode: true,
    generated_code: 'raw',
});

const CHOICES = {
    sight: ['rays', 'open_face', 'all'],
    players_through_walls: ['nametag', true, false],
    generated_code: ['off', 'wrapped', 'raw'],
};

const GOOD_NEIGHBOR_DEFAULTS = Object.freeze({
    protect_builds: true, protect_chests: true, protect_animals: true, protected_areas: Object.freeze([]),
});

function validate(rules) {
    for (const [key, value] of Object.entries(rules)) {
        if (!(key in STRICT_RULES)) throw new Error(`Unknown fair_play_custom rule: ${key}`);
        const expected = STRICT_RULES[key];
        if (CHOICES[key]) {
            if (!CHOICES[key].includes(value)) throw new Error(`fair_play_custom.${key} must be one of ${CHOICES[key].join(', ')}`);
        } else if (key === 'sight_distance') {
            if (value !== 'server' && !(Number.isFinite(value) && value > 0)) throw new Error('fair_play_custom.sight_distance must be "server" or a positive number');
        } else if (key === 'slash_allowlist') {
            if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && /^[a-z0-9_:-]+$/i.test(v)))
                throw new Error('fair_play_custom.slash_allowlist must be a list of command names');
        } else if (typeof value !== typeof expected) {
            throw new Error(`fair_play_custom.${key} must be a ${typeof expected}`);
        }
    }
}

/**
 * @param {object} settings - global settings merged with the profile (profile values win)
 * @returns {object} frozen policy: { mode, ...rules, good_neighbor, command_permissions }
 */
export function resolvePolicy(settings = {}) {
    const mode = settings.fair_play ?? 'off';
    let rules;
    if (mode === 'strict') rules = STRICT_RULES;
    else if (mode === 'off') rules = OFF_RULES;
    else if (mode === 'custom') {
        const custom = settings.fair_play_custom ?? {};
        validate(custom);
        rules = { ...STRICT_RULES, ...custom };
    } else throw new Error(`fair_play must be "strict", "custom" or "off", not ${JSON.stringify(mode)}`);

    const goodNeighbor = mode === 'off' && !settings.good_neighbor
        ? { protect_builds: false, protect_chests: false, protect_animals: false, protected_areas: [] }
        : { ...GOOD_NEIGHBOR_DEFAULTS, ...(settings.good_neighbor ?? {}) };

    return deepFreeze({
        mode, ...rules,
        slash_allowlist: [...rules.slash_allowlist],
        good_neighbor: goodNeighbor,
        command_permissions: { owners: [...(settings.command_permissions?.owners ?? [])] },
    });
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const v of Object.values(value)) deepFreeze(v);
        Object.freeze(value);
    }
    return value;
}

// ---- Block categories the through-walls switches loosen ----

const CONTAINERS = new Set(['chest', 'trapped_chest', 'ender_chest', 'barrel', 'hopper', 'dropper', 'dispenser',
    'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'crafter', 'chiseled_bookshelf', 'decorated_pot']);
const STATIONS = new Set(['crafting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'enchanting_table',
    'smithing_table', 'stonecutter', 'grindstone', 'loom', 'cartography_table', 'fletching_table', 'lectern',
    'cauldron', 'composter', 'beacon', 'respawn_anchor', 'lodestone', 'bell', 'jukebox']);

/** 'ore' | 'container' | 'station' | 'other', for deciding which through-walls switch applies. */
export function blockCategory(name) {
    if (!name) return 'other';
    if (name.endsWith('_ore') || name === 'ancient_debris') return 'ore';
    if (CONTAINERS.has(name) || name.endsWith('shulker_box')) return 'container';
    if (STATIONS.has(name) || name.endsWith('_bed') || (name.endsWith('_door') && name !== 'iron_door')) return 'station';
    return 'other';
}

/** True when the policy lets this block type be found through walls (no sight needed). */
export function allowsRawBlock(policy, name) {
    if (policy.sight === 'all') return true;
    switch (blockCategory(name)) {
        case 'ore': return policy.ores_through_walls === true;
        case 'container': return policy.containers_through_walls === true;
        case 'station': return policy.stations_through_walls === true;
        default: return false;
    }
}

/** True when any block category may skip the sight check, so the provider must also search raw. */
export function anyRawBlocks(policy) {
    return policy.sight === 'all' || policy.ores_through_walls === true
        || policy.containers_through_walls === true || policy.stations_through_walls === true;
}

/** True when the policy lets this entity be known through walls. Players under 'nametag' are perception's call. */
export function allowsRawEntity(policy, entity) {
    if (entity?.type === 'player') return policy.players_through_walls === true;
    return policy.mobs_through_walls === true;
}
