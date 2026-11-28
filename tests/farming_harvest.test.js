// SPDX-License-Identifier: CC0-1.0
// What of a field's harvest goes into the field's chest, and what the bot keeps: seed to sow the field again,
// and food to eat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_RESERVE, SEED_KEEP_MAX, harvestPlan, isHarvest } from '../src/agent/farming/harvest_plan.js';

const cells = (block, n) => Array.from({ length: n }, () => ({ above: block }));
// The game's food table, as the bot has it: a poisonous potato can be eaten, so it is there.
const isFood = name => ['bread', 'carrot', 'potato', 'beetroot', 'poisonous_potato', 'melon_slice'].includes(name);
const asCounts = list => Object.fromEntries(list.map(({ name, count }) => [name, count]));

test('a wheat field keeps a seed for each of its cells and stores the wheat and the other seed', () => {
    const plan = harvestPlan({ wheat: 20, wheat_seeds: 30, dirt: 5 }, cells('wheat', 9));
    assert.deepEqual(asCounts(plan.store), { wheat: 20, wheat_seeds: 21 });
    assert.deepEqual(asCounts(plan.keep), { wheat_seeds: 9 });
    assert.ok(!('dirt' in asCounts(plan.store)), 'what isn\'t the harvest stays where it is');
});

test('seed is kept only as far as the bag has it, and at most a stack', () => {
    assert.deepEqual(asCounts(harvestPlan({ wheat_seeds: 4 }, cells('wheat', 9)).keep), { wheat_seeds: 4 });
    const big = harvestPlan({ wheat_seeds: 200 }, cells('wheat', 100));
    assert.deepEqual(asCounts(big.keep), { wheat_seeds: SEED_KEEP_MAX });
    assert.deepEqual(asCounts(big.store), { wheat_seeds: 200 - SEED_KEEP_MAX });
});

test('carrots are seed and food: with nothing else to eat, the bag keeps the food reserve', () => {
    const plan = harvestPlan({ carrot: 30 }, cells('carrots', 6));
    assert.deepEqual(asCounts(plan.keep), { carrot: FOOD_RESERVE });
    assert.deepEqual(asCounts(plan.store), { carrot: 30 - FOOD_RESERVE });
});

test('food the bot already carries counts towards the reserve, and the most filling crop is kept first', () => {
    assert.deepEqual(asCounts(harvestPlan({ carrot: 30, bread: 20 }, cells('carrots', 6), { isFood }).keep), { carrot: 6 }, 'only the seed');
    const mixed = harvestPlan({ carrot: 10, potato: 10, beetroot: 10, bread: 4 }, [], { isFood });
    assert.deepEqual(asCounts(mixed.keep), { carrot: 10, beetroot: 2 }, 'carrots first, 12 kept with the 4 bread');
    assert.deepEqual(asCounts(mixed.store), { beetroot: 8, potato: 10 });
});

test('a poisonous potato is never food to keep, and a field of several crops keeps each crop\'s seed', () => {
    const plan = harvestPlan({ poisonous_potato: 2, potato: 3, beetroot_seeds: 12, beetroot: 5, wheat_seeds: 6, bread: 16 },
        [...cells('beetroots', 4), ...cells('potatoes', 3), ...cells('wheat', 2), { above: 'air' }, { above: null }], { isFood });
    assert.deepEqual(asCounts(plan.keep), { beetroot_seeds: 4, potato: 3, wheat_seeds: 2 });
    assert.deepEqual(asCounts(plan.store), { beetroot: 5, beetroot_seeds: 8, poisonous_potato: 2, wheat_seeds: 4 });
});

test('melon slices are food, after carrots; a stem keeps a seed; pumpkins go to the chest', () => {
    const plan = harvestPlan({ melon_slice: 30, melon_seeds: 5, pumpkin: 4, pumpkin_seeds: 2 }, [...cells('melon_stem', 2), ...cells('attached_pumpkin_stem', 1)], { isFood });
    assert.deepEqual(asCounts(plan.keep), { melon_seeds: 2, melon_slice: 16, pumpkin_seeds: 1 });
    assert.deepEqual(asCounts(plan.store), { melon_seeds: 3, melon_slice: 14, pumpkin: 4, pumpkin_seeds: 1 });
});

test('what a field gives, and nothing else, is the harvest', () => {
    for (const name of ['wheat', 'wheat_seeds', 'carrot', 'potato', 'poisonous_potato', 'beetroot', 'beetroot_seeds', 'melon_slice', 'melon_seeds', 'pumpkin', 'pumpkin_seeds'])
        assert.ok(isHarvest(name), name);
    for (const name of ['bread', 'dirt', 'stone_hoe', 'carved_pumpkin']) assert.ok(!isHarvest(name), name);
    assert.deepEqual(harvestPlan({}, cells('wheat', 3)), { store: [], keep: [] });
});

test('a round asks for its harvest to go to the chests of whose field it is, and says what it kept', async () => {
    const { storeHarvest } = await import('../src/agent/farming/tend.js');
    const stacks = [{ name: 'wheat', count: 12 }, { name: 'wheat_seeds', count: 20 }, { name: 'stone_hoe', count: 1 }];
    const bot = { inventory: { items: () => stacks, slots: [...Array(9).fill(null), ...stacks] }, registry: { foodsByName: {} } };
    const field = { cells: cells('wheat', 9) };
    const calls = [];
    const store = async (items, request) => { calls.push({ items, request }); return { status: 'ok', text: 'Put away wheat 12, wheat_seeds 11 in 1 chest:', stored: 23 }; };

    const said = await storeHarvest(bot, field, { owner: 'me' }, { asked: false }, store);
    assert.deepEqual(calls[0].items, [{ name: 'wheat', count: 12 }, { name: 'wheat_seeds', count: 11 }]);
    assert.deepEqual(calls[0].request, { whose: 'any', distance: 16, asked: false }, 'the bot\'s own field: its own and shared chests');
    assert.match(said, /^The harvest, to the field's chest: Put away wheat 12/);
    assert.match(said, /Kept on you, to sow the field again and to eat: wheat_seeds 9\.$/);

    await storeHarvest(bot, field, { owner: null }, { asked: true, by: 'Alex' }, store);
    assert.equal(calls[1].request.whose, 'any', 'nobody\'s field: the bot\'s own and shared chests');
    await storeHarvest(bot, field, { owner: 'Alex' }, { asked: true, by: 'Alex' }, store);
    assert.deepEqual(calls[2].request, { whose: 'Alex', distance: 16, asked: true }, 'Alex\'s field: Alex\'s chests, as asked');

    const none = async () => ({ status: 'none', text: '', stored: 0 });
    assert.equal(await storeHarvest(bot, field, { owner: 'me' }, {}, none), null, 'no chest for it: nothing to add');
    const broken = async () => { throw new Error('the chest is gone'); };
    assert.equal(await storeHarvest(bot, field, { owner: 'me' }, {}, broken), 'Could not put the harvest away: the chest is gone');
});

test('the fruit a round picks is a melon or pumpkin beside a stem of its own kind, at the stem\'s height', async () => {
    const { fruitsBeside } = await import('../src/agent/farming/tend.js');
    const world = { '1,1,0': 'melon', '0,1,1': 'pumpkin', '-1,1,0': 'pumpkin', '0,2,-1': 'melon', '5,1,5': 'melon' };
    const read = (x, y, z) => ({ name: world[`${x},${y},${z}`] ?? 'air' });
    const found = fruitsBeside(read, [{ x: 0, y: 0, z: 0, above: 'attached_melon_stem' }, { x: 4, y: 0, z: 5, above: 'wheat' }]);
    assert.deepEqual(found.map(f => `${f.name} ${f.x},${f.y},${f.z}`), ['melon 1,1,0'], 'not a pumpkin by a melon stem, nor one a block up, nor one by wheat');
    const pumpkins = fruitsBeside(read, [{ x: 0, y: 0, z: 0, above: 'pumpkin_stem' }]);
    assert.deepEqual(pumpkins.map(f => `${f.x},${f.z}`).sort(), ['-1,0', '0,1']);
});
