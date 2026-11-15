// SPDX-License-Identifier: CC0-1.0
// Item groups: the one place that decides which items belong together in a chest.
//
// A player sorting a base puts tools with tools and wood with wood. This file is that judgment, and the
// only place in the storage code that knows any Minecraft item names. Everything goes by name, mostly
// by how a name ends, so an item from a future game version usually lands in the right group with no
// change here: a pickaxe of some new material still ends in `_pickaxe`. An item no rule knows goes in
// "other", which costs nothing worse than sitting at the end of a chest.
//
// A wrong group is harmless. It only changes which neighbours an item gets.

/** The groups, in the order they are laid out in a chest. */
export const GROUPS = ['tools', 'combat', 'food', 'minerals', 'wood', 'stone', 'earth', 'plants', 'mob_drops', 'redstone', 'building', 'other'];

const set = text => new Set(text.split(/\s+/).filter(Boolean));

const TOOLS = set(`shears flint_and_steel fishing_rod compass recovery_compass clock spyglass brush lead name_tag map
    filled_map carrot_on_a_stick warped_fungus_on_a_stick bundle saddle`);
const COMBAT = set('bow crossbow trident mace shield elytra totem_of_undying firework_rocket wolf_armor');
// Things mobs drop. Listed before food, because the game counts rotten flesh and spider eyes as food
// and no player keeps them with the bread.
const MOB_DROPS = set(`bone string rotten_flesh gunpowder spider_eye fermented_spider_eye ender_pearl ender_eye leather
    rabbit_hide rabbit_foot feather slime_ball magma_cream blaze_rod blaze_powder breeze_rod ghast_tear
    phantom_membrane ink_sac glow_ink_sac egg nether_star prismarine_shard prismarine_crystals shulker_shell
    turtle_scute armadillo_scute nautilus_shell honeycomb dragon_breath experience_bottle`);
const FOOD = set(`apple bread cookie cake pumpkin_pie melon_slice sweet_berries glow_berries carrot potato baked_potato
    poisonous_potato beetroot beetroot_soup mushroom_stew rabbit_stew suspicious_stew beef porkchop chicken mutton
    rabbit cod salmon tropical_fish pufferfish dried_kelp golden_apple enchanted_golden_apple golden_carrot
    honey_bottle chorus_fruit`);
const MINERALS = set(`coal charcoal diamond emerald lapis_lazuli quartz amethyst_shard netherite_scrap ancient_debris
    coal_block iron_block gold_block diamond_block emerald_block lapis_block copper_block netherite_block
    amethyst_block`);
const REDSTONE = set(`redstone redstone_torch redstone_block redstone_lamp repeater comparator piston sticky_piston
    observer hopper dropper dispenser lever tripwire_hook daylight_detector target tnt note_block crafter
    slime_block honey_block`);
// Things a player builds or furnishes with. Shaped blocks (stairs, slabs, doors) are matched by how
// their names end; these are the ones whose names say nothing.
const BUILDING = set(`glass bricks ladder torch soul_torch lantern soul_lantern scaffolding chain iron_bars glowstone
    sea_lantern bookshelf chest trapped_chest ender_chest barrel crafting_table furnace blast_furnace smoker anvil
    grindstone stonecutter smithing_table loom cartography_table fletching_table lectern composter enchanting_table
    brewing_stand cauldron lodestone jukebox beacon campfire soul_campfire bell flower_pot item_frame painting
    armor_stand end_rod`);
const EARTH = set(`dirt coarse_dirt rooted_dirt grass_block podzol mycelium mud sand red_sand gravel clay clay_ball
    flint snow snow_block snowball ice packed_ice blue_ice soul_sand soul_soil moss_block`);
const PLANTS = set(`wheat sugar_cane bamboo cactus kelp vine lily_pad pumpkin carved_pumpkin melon bone_meal dandelion
    poppy blue_orchid allium azure_bluet oxeye_daisy cornflower lily_of_the_valley sunflower lilac peony fern
    short_grass tall_grass seagrass nether_wart cocoa_beans hay_block torchflower pitcher_plant pitcher_pod azalea
    flowering_azalea spore_blossom glow_lichen`);

const TOOL_ENDS = /_(pickaxe|axe|shovel|hoe)$|bucket$/;
const COMBAT_ENDS = /_(sword|helmet|chestplate|leggings|boots|horse_armor)$|arrow$/;
const MINERAL_ENDS = /_(ore|ingot|nugget)$|^raw_/;
const REDSTONE_ENDS = /_(button|pressure_plate)$|rail$|minecart$/;
const BUILDING_ENDS = new RegExp('_(stairs|slab|wall|fence|fence_gate|door|trapdoor|sign|bricks|tiles|glass|glass_pane|concrete'
    + '|concrete_powder|terracotta|wool|carpet|bed|banner|candle|shulker_box|lamp)$');
const WOOD_ENDS = /_(log|wood|planks|stem|hyphae)$/;
const STONE_ENDS = /(stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|netherrack|obsidian)$/;
const PLANT_ENDS = /_(seeds|sapling|leaves|propagule|tulip|mushroom|roots|vines|fungus|bush)$/;

/**
 * Makes the function that says which group an item is in.
 *
 * The rules are tried in order and the first that matches wins. What an item is for comes before what
 * it is made of, so a stone pickaxe is a tool and an iron door is a building piece.
 *
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.isFood] - the game's own answer to "can this be eaten?",
 *   from its item data, so a food added by a game update is food here with no change to this file
 * @returns {(name: string) => string} one of GROUPS
 */
export function grouper({ isFood = () => false } = {}) {
    return function groupOf(name) {
        if (!name || typeof name !== 'string') return 'other';
        if (TOOL_ENDS.test(name) || TOOLS.has(name)) return 'tools';
        if (COMBAT_ENDS.test(name) || COMBAT.has(name)) return 'combat';
        if (MOB_DROPS.has(name)) return 'mob_drops';
        if (FOOD.has(name) || name.startsWith('cooked_') || isFood(name)) return 'food';
        if (MINERAL_ENDS.test(name) || MINERALS.has(name)) return 'minerals';
        if (REDSTONE_ENDS.test(name) || REDSTONE.has(name)) return 'redstone';
        if (BUILDING_ENDS.test(name) || BUILDING.has(name)) return 'building';
        if (WOOD_ENDS.test(name) || name === 'stick' || name === 'bamboo_block') return 'wood';
        if (STONE_ENDS.test(name)) return 'stone';
        if (EARTH.has(name)) return 'earth';
        if (PLANT_ENDS.test(name) || PLANTS.has(name)) return 'plants';
        return 'other';
    };
}

/** Which group an item is in, going by its name alone. */
export const groupOf = grouper();
