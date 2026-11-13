// SPDX-License-Identifier: CC0-1.0
// Kinds: the one place that decides what sort of thing a block or a mob is.
//
// Everything here goes by name pattern, never by the game's numbers. A door from a wood type added in
// some future game version ends in `_door` like every other door, so it is a door here with no code
// change. When a game update does need a tweak to what the bot remembers, this file is where it goes.
//
// The rest of the memory code asks these questions and knows nothing about Minecraft's block list.

const CONTAINERS = new Set(['chest', 'trapped_chest', 'ender_chest', 'barrel', 'hopper', 'dropper', 'dispenser',
    'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'crafter', 'chiseled_bookshelf', 'decorated_pot']);
const WORKSTATIONS = new Set(['crafting_table', 'enchanting_table', 'smithing_table', 'grindstone', 'stonecutter',
    'loom', 'cartography_table', 'fletching_table', 'lectern', 'composter', 'beacon', 'respawn_anchor', 'lodestone',
    'bell', 'jukebox', 'campfire', 'soul_campfire']);
const PORTALS = new Set(['nether_portal', 'end_portal', 'end_portal_frame', 'end_gateway']);
const SPAWNERS = new Set(['spawner', 'trial_spawner', 'vault']);

/**
 * The kind of single object a block is, or null for ordinary blocks.
 * @returns {'container'|'workstation'|'passage'|'bed'|'sign'|'portal'|'spawner'|'ore'|null}
 */
export function kindOf(name) {
    if (!name) return null;
    if (CONTAINERS.has(name) || name.endsWith('shulker_box')) return 'container';
    if (WORKSTATIONS.has(name) || name.endsWith('anvil') || name.endsWith('cauldron')) return 'workstation';
    if (name.endsWith('_door') || name.endsWith('_fence_gate') || name.endsWith('_trapdoor')) return 'passage';
    if (name.endsWith('_bed')) return 'bed';
    if (name.endsWith('_sign')) return 'sign';
    if (PORTALS.has(name)) return 'portal';
    if (SPAWNERS.has(name)) return 'spawner';
    if (name.endsWith('_ore') || name === 'ancient_debris') return 'ore';
    return null;
}

/** Kinds that make a spot a place worth naming. An ore vein or a lone portal doesn't. */
export const startsPlace = kind => kind === 'container' || kind === 'workstation' || kind === 'passage'
    || kind === 'bed' || kind === 'sign';

// Crops, with the `age` at which each is ready to pick.
const CROPS = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3, nether_wart: 3, cocoa: 2, sweet_berry_bush: 3, torchflower_crop: 1, pitcher_crop: 4 };

/** Is this block a planted crop that grows? */
export const isCrop = name => Object.hasOwn(CROPS, name);

/** Is this crop ready to pick? `state` is the block's properties by name; a crop with no known age is not ripe. */
export function isRipe(name, state) {
    const age = Number(state?.age);
    return isCrop(name) && Number.isFinite(age) && age >= CROPS[name];
}

// A sideways offset. Adding 0 turns the "negative zero" that multiplying by -1 can give into plain 0.
const flat = (x, z) => ({ x: x + 0, y: 0, z: z + 0 });

/**
 * Where the other half of a two-block object is, as an offset from this half, or null for one-block
 * objects. A double chest, a bed and a door are each one thing to a player, so they are one thing here.
 * `state` is the block's properties by name.
 */
export function partnerOffset(name, state) {
    if (!state) return null;
    const kind = kindOf(name);
    if (kind === 'passage' && name.endsWith('_door')) {
        return state.half === 'upper' ? { x: 0, y: -1, z: 0 } : state.half === 'lower' ? { x: 0, y: 1, z: 0 } : null;
    }
    const ahead = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } }[state.facing];
    if (!ahead) return null;
    if (kind === 'bed') {
        // A bed's head lies in the direction it faces, with the foot behind it.
        const sign = state.part === 'foot' ? 1 : state.part === 'head' ? -1 : 0;
        return sign ? flat(ahead.x * sign, ahead.z * sign) : null;
    }
    if (name === 'chest' || name === 'trapped_chest') {
        // Seen from the front, the half marked "left" has its partner on its right, which is clockwise
        // from the way the chest faces; "right" is the mirror of that.
        const sign = state.type === 'left' ? 1 : state.type === 'right' ? -1 : 0;
        return sign ? flat(-ahead.z * sign, ahead.x * sign) : null;
    }
    return null;
}

// Blocks that change with nobody touching them. Seeing one of these differ from memory is not news.
const SELF_CHANGING = new Set(['grass_block', 'dirt', 'farmland', 'snow', 'snow_block', 'ice', 'frosted_ice', 'fire', 'soul_fire',
    'water', 'lava', 'bubble_column', 'sand', 'red_sand', 'gravel', 'pointed_dripstone', 'sugar_cane', 'cactus', 'bamboo',
    'kelp', 'kelp_plant', 'vine', 'cave_vines', 'cave_vines_plant', 'twisting_vines', 'weeping_vines', 'moss_carpet',
    'pumpkin', 'melon', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'sculk', 'sculk_vein', 'mycelium', 'podzol',
    'budding_amethyst', 'powder_snow', 'sweet_berry_bush', 'chorus_plant', 'chorus_flower', 'dripstone_block']);

/**
 * Does this block grow, spread, flow, fall or burn by itself? Crops, saplings, leaves, grass, snow, fire,
 * water, lava and falling blocks do, so a difference there says nothing about anyone having been by.
 */
export function changesByItself(name) {
    if (!name) return false;
    return SELF_CHANGING.has(name) || isCrop(name) || name.endsWith('_leaves') || name.endsWith('_sapling')
        || name.endsWith('_stem') || name.endsWith('_concrete_powder') || name.endsWith('_mushroom')
        || name.endsWith('amethyst_bud') || name === 'amethyst_cluster' || name.endsWith('_propagule')
        || name.endsWith('_roots') || name.endsWith('_fungus') || name.endsWith('_nylium');
}

const HERD_ANIMALS = new Set(['cow', 'mooshroom', 'sheep', 'pig', 'chicken', 'horse', 'donkey', 'mule', 'llama', 'trader_llama',
    'goat', 'rabbit', 'camel', 'villager', 'wandering_trader', 'wolf', 'cat', 'fox', 'bee', 'turtle', 'panda', 'axolotl',
    'frog', 'sniffer', 'armadillo', 'strider', 'iron_golem', 'snow_golem', 'allay', 'parrot', 'ocelot', 'polar_bear']);

/** Is this mob one worth remembering the whereabouts of (farm animals, villagers, pets), as opposed to a monster? */
export const isHerdAnimal = name => HERD_ANIMALS.has(name);
