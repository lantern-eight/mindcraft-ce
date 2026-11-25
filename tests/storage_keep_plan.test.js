// SPDX-License-Identifier: MIT
// The keep plan: what the bot keeps when it puts things away. Pure, no game.
//
// Most cases are ported from the akarkin1/mindcraft-fk fork's tests/unit/storage_logic.test.js, under
// the MIT License (the notice is in LICENSE), adapted to this port: every stored entry names its slots,
// an enchanted or named tool is kept before a plain one, and a hotbar stack before a main inventory one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { keepPlan } from '../src/agent/storage/keep_plan.js';

// A small food table in the shape of the game's foodsByName.
const FOODS = {
    bread: { foodPoints: 5, saturation: 6 },
    cooked_beef: { foodPoints: 8, saturation: 12.8 },
    cooked_porkchop: { foodPoints: 8, saturation: 12.8 },
    baked_potato: { foodPoints: 5, saturation: 6 },
    carrot: { foodPoints: 3, saturation: 3.6 },
    rotten_flesh: { foodPoints: 4, saturation: 0.8 },
    golden_apple: { foodPoints: 4, saturation: 9.6 },
};

/** An inventory from [name, count, usesLeft] rows, in main inventory slots from 9 on. */
const inv = (...rows) => rows.map(([name, count = 1, usesLeft = null], i) => ({ name, count, slot: 9 + i, usesLeft }));
const asMap = list => Object.fromEntries(list.map(entry => [entry.name, entry.count]));
const plan = (inventory, options = {}) => keepPlan(inventory, { foods: FOODS, ...options });

describe('keep plan: tools', () => {
    test('keeps the best tool of each kind and one more pickaxe', () => {
        const p = plan(inv(['wooden_pickaxe', 1, 50], ['stone_pickaxe', 1, 100], ['iron_pickaxe', 1, 200],
            ['diamond_axe', 1, 900], ['stone_axe', 1, 120], ['wooden_shovel', 1, 30], ['golden_hoe', 1, 20], ['iron_sword', 1, 5]));
        assert.deepEqual(asMap(p.keep), { iron_pickaxe: 1, stone_pickaxe: 1, diamond_axe: 1, wooden_shovel: 1, golden_hoe: 1, iron_sword: 1 });
        assert.deepEqual(asMap(p.store), { wooden_pickaxe: 1, stone_axe: 1 });
    });

    test('material order: netherite, diamond, iron, copper, stone, golden, wooden', () => {
        const p = plan(inv(['golden_sword', 1, 30], ['stone_sword', 1, 10], ['wooden_sword', 1, 59], ['netherite_axe', 1, 3], ['diamond_axe', 1, 1500]));
        assert.deepEqual(asMap(p.keep), { stone_sword: 1, netherite_axe: 1 });
        assert.deepEqual(asMap(plan(inv(['stone_shovel', 1, 30], ['copper_shovel', 1, 10])).keep), { copper_shovel: 1 });
    });

    test('among equal tools the one with more uses left; the stored ones are named by slot, worst first', () => {
        const items = inv(['stone_pickaxe', 1, 10], ['stone_pickaxe', 1, 100], ['stone_pickaxe', 1, 60], ['iron_pickaxe', 1, 250]);
        const p = plan(items);
        assert.deepEqual(asMap(p.keep), { iron_pickaxe: 1, stone_pickaxe: 1 });
        assert.deepEqual(p.store, [{ name: 'stone_pickaxe', count: 2, slots: [9, 11] }]);
    });

    test('an enchanted or named tool is kept before a plain one with more uses left', () => {
        const items = [{ name: 'iron_sword', count: 1, slot: 9, usesLeft: 250 }, { name: 'iron_sword', count: 1, slot: 10, usesLeft: 40, special: true }];
        assert.deepEqual(plan(items).store, [{ name: 'iron_sword', count: 1, slots: [9] }]);
    });

    test('a tool without a known number of uses left counts as the most worn', () => {
        const p = plan(inv(['iron_axe', 1, null], ['iron_axe', 1, 40]));
        assert.deepEqual(p.store, [{ name: 'iron_axe', count: 1, slots: [9] }]);
    });

    test('shears, flint and steel and fishing rods are not tools of the table: stored', () => {
        assert.deepEqual(asMap(plan(inv(['shears', 1, 200], ['flint_and_steel', 1, 60], ['fishing_rod', 1, 60])).store),
            { shears: 1, flint_and_steel: 1, fishing_rod: 1 });
    });
});

describe('keep plan: armour, weapons, food and supplies', () => {
    test('armour, shield, bow, crossbow, trident and totem are all kept; arrows up to 64', () => {
        const p = plan(inv(['iron_helmet'], ['diamond_chestplate'], ['iron_leggings'], ['iron_leggings'], ['elytra'], ['shield'], ['bow'],
            ['crossbow'], ['trident'], ['totem_of_undying'], ['arrow', 64], ['arrow', 36], ['spectral_arrow', 10]));
        assert.deepEqual(asMap(p.keep), { iron_helmet: 1, diamond_chestplate: 1, iron_leggings: 2, elytra: 1, shield: 1, bow: 1, crossbow: 1,
            trident: 1, totem_of_undying: 1, arrow: 64 });
        assert.deepEqual(asMap(p.store), { arrow: 36, spectral_arrow: 10 });
    });

    test('horse armour is not the bot\'s armour', () => {
        assert.deepEqual(asMap(plan(inv(['iron_horse_armor'])).store), { iron_horse_armor: 1 });
    });

    test('food up to 16 pieces, the best first; food that is no meal is stored', () => {
        const p = plan(inv(['bread', 20], ['cooked_beef', 10], ['rotten_flesh', 5], ['golden_apple', 2]));
        assert.deepEqual(asMap(p.keep), { cooked_beef: 10, bread: 6 });
        assert.deepEqual(asMap(p.store), { bread: 14, rotten_flesh: 5, golden_apple: 2 });
    });

    test('food ties go by saturation, then by name', () => {
        assert.deepEqual(asMap(plan(inv(['cooked_porkchop', 10], ['cooked_beef', 10], ['baked_potato', 20], ['bread', 20])).keep),
            { cooked_beef: 10, cooked_porkchop: 6 });
    });

    test('without the game\'s food table a built-in one knows the common food', () => {
        const p = keepPlan(inv(['bread', 20], ['cooked_beef', 4], ['rotten_flesh', 3], ['dirt', 5]));
        assert.deepEqual(asMap(p.keep), { cooked_beef: 4, bread: 12 });
        assert.deepEqual(asMap(p.store), { bread: 8, rotten_flesh: 3, dirt: 5 });
    });

    test('torches and ladders up to 64, cobblestone up to 32, over several stacks', () => {
        const p = plan(inv(['torch', 64], ['torch', 36], ['ladder', 70], ['cobblestone', 64], ['cobblestone', 32]));
        assert.deepEqual(asMap(p.keep), { torch: 64, ladder: 64, cobblestone: 32 });
        assert.deepEqual(asMap(p.store), { torch: 36, ladder: 6, cobblestone: 64 });
    });

    test('one crafting table, water bucket, bucket and bed', () => {
        const p = plan(inv(['crafting_table', 2], ['water_bucket'], ['water_bucket'], ['bucket', 3], ['white_bed'], ['red_bed']));
        assert.deepEqual(asMap(p.keep), { crafting_table: 1, water_bucket: 1, bucket: 1, red_bed: 1 });
        assert.deepEqual(asMap(p.store), { crafting_table: 1, water_bucket: 1, bucket: 2, white_bed: 1 });
    });

    test('everything else is stored', () => {
        const p = plan(inv(['dirt', 12], ['wheat', 20], ['raw_iron', 5], ['diamond', 2]));
        assert.deepEqual(p.keep, []);
        assert.deepEqual(asMap(p.store), { dirt: 12, wheat: 20, raw_iron: 5, diamond: 2 });
    });
});

describe('keep plan: which stacks', () => {
    test('a stack in the hotbar is kept before one in the main inventory', () => {
        const items = [{ name: 'cobblestone', count: 64, slot: 12 }, { name: 'cobblestone', count: 20, slot: 37 }];
        // 32 kept: the hotbar's 20 and 12 of the main stack. The main stack is drawn on for the rest.
        assert.deepEqual(plan(items).store, [{ name: 'cobblestone', count: 52, slots: [12] }]);
    });

    test('stacks emptied whole come before a stack partly kept', () => {
        const items = [{ name: 'torch', count: 50, slot: 36 }, { name: 'torch', count: 30, slot: 10 }, { name: 'torch', count: 40, slot: 11 }];
        // 64 kept: the hotbar's 50, then 14 of the slot-10 stack. Slot 11 goes whole, then the rest of slot 10.
        assert.deepEqual(plan(items).store, [{ name: 'torch', count: 56, slots: [11, 10] }]);
    });
});

describe('keep plan: options', () => {
    test('seeds and bone meal are stored unless options.keep names them', () => {
        const items = inv(['wheat_seeds', 50], ['beetroot_seeds', 5], ['bone_meal', 7]);
        assert.deepEqual(asMap(plan(items).store), { wheat_seeds: 50, beetroot_seeds: 5, bone_meal: 7 });
        const p = plan(items, { keep: { wheat_seeds: 32, bone_meal: -1 } });
        assert.deepEqual(asMap(p.keep), { wheat_seeds: 32, bone_meal: 7 });
        assert.deepEqual(asMap(p.store), { wheat_seeds: 18, beetroot_seeds: 5 });
    });

    test('options.keep as a list or one name keeps all of them', () => {
        const items = inv(['bone_meal', 7], ['wheat_seeds', 3], ['dirt', 1]);
        assert.deepEqual(asMap(plan(items, { keep: ['bone_meal', 'wheat_seeds'] }).keep), { bone_meal: 7, wheat_seeds: 3 });
        assert.deepEqual(asMap(plan(items, { keep: 'bone_meal' }).keep), { bone_meal: 7 });
    });

    test('several rules for one name: the largest count wins', () => {
        assert.deepEqual(asMap(plan(inv(['torch', 100]), { keep: { torch: 10 } }).keep), { torch: 64 });
    });

    test('invalid counts are ignored; minecraft: prefixes are removed', () => {
        assert.deepEqual(asMap(plan(inv(['dirt', 10]), { keep: { dirt: 'many', sand: Number.NaN, clay: -5 } }).store), { dirt: 10 });
        assert.deepEqual(asMap(plan(inv(['gravel', 3]), { keep: { 'minecraft:gravel': 2 } }).keep), { gravel: 2 });
    });

    test('options.only stores the named items, all of them, and keeps everything else', () => {
        const items = inv(['wheat', 20], ['torch', 30], ['dirt', 5], ['stone_pickaxe', 1, 10], ['wooden_pickaxe', 1, 10], ['wooden_pickaxe', 1, 20]);
        const p = plan(items, { only: ['wheat', 'torch'] });
        assert.deepEqual(asMap(p.store), { wheat: 20, torch: 30 });
        assert.deepEqual(asMap(p.keep), { dirt: 5, stone_pickaxe: 1, wooden_pickaxe: 2 });
        assert.deepEqual(asMap(plan(items, { only: 'Dirt' }).store), { dirt: 5 });
    });

    test('options.only with options.keep stores what is beyond the count', () => {
        const p = plan(inv(['wheat', 9], ['wheat_seeds', 40], ['bread', 3]), { only: ['wheat', 'wheat_seeds'], keep: { wheat_seeds: 32 } });
        assert.deepEqual(asMap(p.store), { wheat: 9, wheat_seeds: 8 });
        assert.deepEqual(asMap(p.keep), { wheat_seeds: 32, bread: 3 });
    });

    test('an empty options.only list means no restriction', () => {
        assert.deepEqual(asMap(plan(inv(['dirt', 5]), { only: [] }).store), { dirt: 5 });
    });
});

describe('keep plan: input and output', () => {
    test('anything odd is left out, and a missing inventory is empty', () => {
        assert.deepEqual(keepPlan(null), { keep: [], store: [] });
        assert.deepEqual(keepPlan(undefined, null), { keep: [], store: [] });
        const p = plan([null, 'dirt', { name: 'dirt', count: 0 }, { count: 4 }, { name: '', count: 1 }, { name: 'air', count: 1 },
            { name: 'dirt', count: 3.7, slot: 9 }, { name: 'minecraft:gravel', count: 2, slot: 10 }]);
        assert.deepEqual(p.keep, []);
        assert.deepEqual(asMap(p.store), { dirt: 3, gravel: 2 });
    });

    test('lists come by count, highest first, then by name', () => {
        const p = plan(inv(['dirt', 5], ['sand', 12], ['clay', 5], ['torch', 3], ['bread', 3]));
        assert.deepEqual(p.store.map(entry => entry.name), ['sand', 'clay', 'dirt']);
        assert.deepEqual(p.keep.map(entry => entry.name), ['bread', 'torch']);
    });
});
