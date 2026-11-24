// SPDX-License-Identifier: CC0-1.0
// What a world makes by itself, by block name: the ground a player may dig without asking anyone.
//
// Good-neighbor rules go the safe way round: a block is someone's unless it is natural terrain. A list of
// what players build with is never finished (every update adds blocks), and a block left off it would be
// fair game; a block left off this list is only protected, and the bot asks or goes round. The list
// follows the one in nengoxx's Mindcraft fork (`src/agent/work/data/natural_blocks.json`, MIT; see
// ATTRIBUTION.md), with the Nether and the End added, since a bot travels there too.
//
// Left out on purpose, so protected unless the caller knows better:
//   - logs and leaves: a log is natural only as part of a tree, which trees.js judges; leaves only when grown;
//   - what players farm: crops, sugar cane, bamboo, cactus, pumpkins, melons, berry bushes, kelp. A field of
//     them is usually someone's;
//   - what generated structures share with builds: cobblestone, planks, rails, bricks, glass, obsidian. A
//     mineshaft's planks can't be told from a player's tunnel by the blocks alone.
// Names are Java Edition's; the caller puts another edition's names in Java's terms first.

const NATURAL = new Set([
    // Stone and the underground
    'stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'calcite', 'dripstone_block', 'pointed_dripstone',
    'smooth_basalt', 'amethyst_block', 'budding_amethyst', 'amethyst_cluster', 'large_amethyst_bud',
    'medium_amethyst_bud', 'small_amethyst_bud', 'magma_block', 'infested_stone', 'infested_deepslate',
    'ancient_debris', 'sculk', 'sculk_vein',
    // Soil and sand
    'dirt', 'grass_block', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'mud', 'clay', 'moss_block',
    'pale_moss_block', 'sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel', 'sandstone', 'red_sandstone',
    'terracotta', 'white_terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta', 'red_terracotta',
    'light_gray_terracotta',
    // Snow and ice
    'snow', 'snow_block', 'powder_snow', 'ice', 'packed_ice', 'blue_ice',
    // Plants that grow wild
    'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'bush', 'short_dry_grass', 'tall_dry_grass',
    'firefly_bush', 'seagrass', 'tall_seagrass', 'lily_pad', 'vine', 'glow_lichen', 'hanging_roots', 'cave_vines',
    'cave_vines_plant', 'spore_blossom', 'moss_carpet', 'pale_moss_carpet', 'pale_hanging_moss', 'azalea',
    'flowering_azalea', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'mangrove_roots',
    'muddy_mangrove_roots', 'mangrove_propagule', 'cobweb',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
    'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
    'pink_petals', 'wildflowers', 'leaf_litter', 'open_eyeblossom', 'closed_eyeblossom',
    'brown_mushroom', 'red_mushroom', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
    // The Nether
    'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone', 'crimson_nylium', 'warped_nylium',
    'crimson_roots', 'warped_roots', 'nether_sprouts', 'crimson_fungus', 'warped_fungus', 'weeping_vines',
    'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'nether_wart_block', 'warped_wart_block',
    'shroomlight', 'glowstone',
    // The End
    'end_stone', 'chorus_plant', 'chorus_flower',
]);

/** Is this block natural terrain, by its Java name? Ores are, wherever they are. */
export function isNaturalTerrain(name) {
    return NATURAL.has(name) || name.endsWith('_ore');
}

/** Is this block a tree's trunk: a log or a Nether stem, not stripped? Those are natural only as part of a tree. */
export function isTrunk(name) {
    return (name.endsWith('_log') || name === 'crimson_stem' || name === 'warped_stem') && !name.startsWith('stripped_');
}

/** Is this block a canopy: leaves, or the wart blocks a huge Nether fungus grows? */
export function isCanopy(name) {
    return name.endsWith('_leaves') || name === 'nether_wart_block' || name === 'warped_wart_block' || name === 'shroomlight';
}

// What a world puts against a tree's trunk besides air, water, its canopy and the ground.
const ON_TRUNKS = new Set(['cocoa', 'bee_nest', 'vine', 'moss_carpet', 'snow', 'water', 'air', 'cave_air', 'void_air',
    'sugar_cane', 'bamboo', 'bamboo_sapling', 'pumpkin', 'melon', 'sweet_berry_bush', 'kelp', 'kelp_plant', 'creaking_heart',
    'resin_clump']);

/**
 * Could a world have put this block next to a tree's trunk? If something else touches the trunk (planks,
 * glass, a door, a torch), the "trunk" is a beam in someone's build.
 */
export function besideTrees(name) {
    return ON_TRUNKS.has(name) || isCanopy(name) || isNaturalTerrain(name) || name.endsWith('_sapling');
}

/** Is this name empty space? */
export const isEmpty = name => name === 'air' || name === 'cave_air' || name === 'void_air';
