// SPDX-License-Identifier: CC0-1.0
// Which group an item belongs to when chests are sorted: tools with tools, wood with wood.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, groupOf, grouper } from '../src/agent/storage/item_groups.js';

test('common items land in the group a player would expect', () => {
    const expected = {
        tools: ['iron_pickaxe', 'stone_axe', 'wooden_shovel', 'diamond_hoe', 'shears', 'flint_and_steel', 'water_bucket', 'fishing_rod'],
        combat: ['iron_sword', 'bow', 'arrow', 'shield', 'diamond_chestplate', 'leather_boots', 'turtle_helmet'],
        food: ['bread', 'cooked_beef', 'apple', 'golden_carrot', 'baked_potato', 'porkchop'],
        minerals: ['iron_ore', 'deepslate_diamond_ore', 'raw_iron', 'raw_gold_block', 'iron_ingot', 'gold_nugget', 'coal', 'diamond', 'iron_block'],
        wood: ['oak_log', 'stripped_birch_log', 'spruce_planks', 'crimson_stem', 'stick'],
        stone: ['cobblestone', 'stone', 'deepslate', 'polished_andesite', 'sandstone', 'netherrack', 'obsidian'],
        earth: ['dirt', 'sand', 'gravel', 'clay_ball', 'grass_block', 'flint'],
        plants: ['wheat_seeds', 'oak_sapling', 'wheat', 'sugar_cane', 'birch_leaves', 'poppy', 'bone_meal'],
        mob_drops: ['bone', 'string', 'rotten_flesh', 'gunpowder', 'ender_pearl', 'leather', 'feather'],
        redstone: ['redstone', 'repeater', 'sticky_piston', 'hopper', 'stone_button', 'oak_pressure_plate', 'powered_rail', 'minecart'],
        building: ['oak_stairs', 'stone_bricks', 'glass', 'white_wool', 'iron_door', 'oak_fence', 'torch', 'chest', 'crafting_table', 'ladder'],
    };
    for (const [group, names] of Object.entries(expected)) {
        for (const name of names) assert.equal(groupOf(name), group, name);
    }
});

test('a name is matched by what the item is for before what it is made of', () => {
    assert.equal(groupOf('stone_pickaxe'), 'tools', 'a tool, not stone');
    assert.equal(groupOf('golden_sword'), 'combat', 'a weapon, not a mineral');
    assert.equal(groupOf('golden_apple'), 'food', 'food, not a mineral');
    assert.equal(groupOf('iron_trapdoor'), 'building', 'a building piece, not a mineral');
    assert.equal(groupOf('redstone_ore'), 'minerals', 'an ore, not a redstone part');
    assert.equal(groupOf('glowstone'), 'building', 'a light, not stone');
    assert.equal(groupOf('grindstone'), 'building', 'a workstation, not stone');
    assert.equal(groupOf('spider_eye'), 'mob_drops', 'a drop, though it can be eaten');
});

test('an item nobody listed goes in "other", and every group is on the list', () => {
    assert.equal(groupOf('some_item_from_a_future_version'), 'other');
    assert.equal(groupOf(''), 'other');
    assert.equal(groupOf(undefined), 'other');
    assert.equal(GROUPS.at(-1), 'other');
    for (const name of ['iron_pickaxe', 'bread', 'oak_log', 'dirt', 'bone', 'zzz']) assert.ok(GROUPS.includes(groupOf(name)), name);
});

test('the game\'s own list of foods can be handed in, so a new food needs no change here', () => {
    const isFood = name => name === 'glistering_melon_pie';
    const custom = grouper({ isFood });
    assert.equal(groupOf('glistering_melon_pie'), 'other');
    assert.equal(custom('glistering_melon_pie'), 'food');
    assert.equal(custom('iron_pickaxe'), 'tools', 'everything else is unchanged');
    assert.equal(custom('rotten_flesh'), 'mob_drops', 'a drop stays a drop even when the game calls it food');
});
