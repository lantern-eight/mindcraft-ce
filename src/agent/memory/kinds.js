// SPDX-License-Identifier: CC0-1.0
// Kinds: the one place that decides what sort of thing a block or a mob is.
//
// Everything here goes by name pattern, never by the game's numbers. A door from a wood type added in
// some future game version ends in `_door` like every other door, so it is a door here with no code
// change. When a game update does need a tweak to what the bot remembers, this file is where it goes.
//
// The rest of the memory code asks these questions and knows nothing about Minecraft's block list.

// ---- Names from another edition of the game ----
//
// The names here are Java Edition's. Another edition names some of the same blocks differently (Bedrock
// Edition's `wooden_door` is Java's `oak_door`) and describes their states with other properties. Its
// module hands a translation to translateNamesWith, and each question below is then asked of the Java
// name and properties. Memory itself keeps the names and properties of the game it plays, as the rest of
// the bot sees them. A name or state the translation doesn't know is taken as it is, which is every one
// a Java bot meets.
let toJava = null;

/**
 * Sets the translation into Java's names, or removes it with null. One bot runs per process, and it plays
 * one edition, so there is one translation at a time.
 * @param {((name: string, state?: object|null) => {name: string, state: object|null}|null)|null} translate
 *   gives the Java name (and, when a state is passed, the Java properties) or null when it has none
 */
export function translateNamesWith(translate) {
    toJava = translate;
}

const javaName = name => (name && toJava?.(name)?.name) || name;
const javaBlock = (name, state) => (name && toJava?.(name, state)) || { name, state };

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
    return name ? kindOfJava(javaName(name)) : null;
}

function kindOfJava(name) {
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
export const isCrop = name => Object.hasOwn(CROPS, javaName(name));

/** Is this crop ready to pick? `state` is the block's properties by name; a crop with no known age is not ripe. */
export function isRipe(name, state) {
    ({ name, state } = javaBlock(name, state));
    const age = Number(state?.age);
    return Object.hasOwn(CROPS, name) && Number.isFinite(age) && age >= CROPS[name];
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
    ({ name, state } = javaBlock(name, state));
    if (!state) return null;
    const kind = kindOfJava(name);
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
    name = javaName(name);
    return SELF_CHANGING.has(name) || Object.hasOwn(CROPS, name) || name.endsWith('_leaves') || name.endsWith('_sapling')
        || name.endsWith('_stem') || name.endsWith('_concrete_powder') || name.endsWith('_mushroom')
        || name.endsWith('amethyst_bud') || name === 'amethyst_cluster' || name.endsWith('_propagule')
        || name.endsWith('_roots') || name.endsWith('_fungus') || name.endsWith('_nylium');
}

// Blocks that turn up in an empty cell with nobody placing them: they grow there, fall there, flow there,
// form there or are laid there. A tree's logs are among them, since a sapling grows into a tree.
const APPEARS_BY_ITSELF = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel', 'pointed_dripstone',
    'snow', 'ice', 'frosted_ice', 'fire', 'soul_fire', 'water', 'lava', 'bubble_column', 'sugar_cane', 'cactus', 'bamboo',
    'bamboo_sapling', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'vine', 'cave_vines', 'cave_vines_plant',
    'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant', 'glow_lichen', 'moss_carpet',
    'pumpkin', 'melon', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'sweet_berry_bush', 'chorus_plant',
    'chorus_flower', 'brown_mushroom_block', 'red_mushroom_block', 'bee_nest', 'turtle_egg', 'frogspawn', 'sculk_vein',
    'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'hanging_roots', 'spore_blossom', 'pale_hanging_moss']);
// What lava leaves where it meets water, so a cell that held either may hold one of these with nobody by.
const LAVA_MADE = new Set(['stone', 'cobblestone', 'obsidian', 'basalt']);
const FLUIDS = new Set(['water', 'lava', 'bubble_column']);
const COPPER_AGE = /^(waxed_)?(exposed_|weathered_|oxidized_)?/;

function appearsByItself(name) {
    return APPEARS_BY_ITSELF.has(name) || Object.hasOwn(CROPS, name) || name.endsWith('_sapling') || name.endsWith('_leaves')
        || name.endsWith('_log') || name.endsWith('_stem') || name.endsWith('_concrete_powder') || name.endsWith('_mushroom')
        || name.endsWith('amethyst_bud') || name === 'amethyst_cluster' || name.endsWith('_propagule')
        || name.endsWith('_roots') || name.endsWith('_fungus');
}

/**
 * Is a block, seen where memory held something else, the sign of someone having built it there? True for
 * a block where the bot had seen empty space, or in place of a block it remembers, unless that block
 * could have got there by itself: grown, fallen, flowed, frozen, weathered, or left by lava meeting water.
 * The bot's own work is the caller's to leave out. A cell never seen before (`before` null) proves nothing.
 *
 * This is what tells a wall a player put up from rock that was always there, whatever the wall is made of:
 * dirt stacked across a tunnel is natural by its name and built by where it stands.
 * @param {string|null} before - what memory held: a block name, 'air' for seen empty, null for never seen
 * @param {string|null} after - what the bot sees there now
 */
export function wasBuilt(before, after) {
    if (before == null || !after || after === 'air' || before === after) return false;
    const now = javaName(after);
    if (appearsByItself(now)) return false;
    if (before === 'air') return true;
    const was = javaName(before);
    // A remembered block that became another by itself: grass to dirt and back, a field gone wild.
    if (changesByItself(was) && changesByItself(now)) return false;
    if (FLUIDS.has(was) && LAVA_MADE.has(now)) return false;
    // Copper weathering a step, or being waxed, is the same block getting older.
    const copper = name => name.replace(COPPER_AGE, '').replace(/^copper_block$/, 'copper');
    if (was.includes('copper') && copper(was) === copper(now)) return false;
    return true;
}

const HERD_ANIMALS = new Set(['cow', 'mooshroom', 'sheep', 'pig', 'chicken', 'horse', 'donkey', 'mule', 'llama', 'trader_llama',
    'goat', 'rabbit', 'camel', 'villager', 'wandering_trader', 'wolf', 'cat', 'fox', 'bee', 'turtle', 'panda', 'axolotl',
    'frog', 'sniffer', 'armadillo', 'strider', 'iron_golem', 'snow_golem', 'allay', 'parrot', 'ocelot', 'polar_bear']);

/** Is this mob one worth remembering the whereabouts of (farm animals, villagers, pets), as opposed to a monster? */
export const isHerdAnimal = name => HERD_ANIMALS.has(name);

const CLIMBABLE = new Set(['ladder', 'vine', 'scaffolding', 'twisting_vines', 'twisting_vines_plant', 'weeping_vines',
    'weeping_vines_plant', 'cave_vines', 'cave_vines_plant']);

/**
 * How the bot is moving, going by the block its feet are in: through a doorway, up a ladder, in water,
 * or just walking. The trail marks these spots, since a route through them is not plain walking.
 * @returns {'walk'|'door'|'ladder'|'water'}
 */
export function moveKindOf(name) {
    if (kindOf(name) === 'passage') return 'door';
    name = javaName(name);
    if (CLIMBABLE.has(name)) return 'ladder';
    if (name === 'water' || name === 'bubble_column') return 'water';
    return 'walk';
}
