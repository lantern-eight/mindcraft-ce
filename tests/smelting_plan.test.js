// SPDX-License-Identifier: CC0-1.0
// What smelts into what, and what to burn: the pure half of smelting (recipes.js, fuel.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputsFor, isBurningLog, isBurningPlanks, planksOf, productOf } from '../src/agent/smelting/recipes.js';
import { fuelPer, itemsFrom, nextFuel, planFuel, unitsFor } from '../src/agent/smelting/fuel.js';

test('a furnace makes glass of sand and red sand, ingots of raw metal, charcoal of any log', () => {
    assert.equal(productOf('sand'), 'glass');
    assert.equal(productOf('red_sand'), 'glass');
    assert.equal(productOf('minecraft:Raw_Iron'), 'iron_ingot');
    assert.equal(productOf('stripped_cherry_wood'), 'charcoal');
    assert.equal(productOf('beef'), 'cooked_beef');
    assert.equal(productOf('cobbled_deepslate'), 'deepslate');
});

test('names are matched whole: no part of a name makes something smeltable', () => {
    // Mindcraft's own check took anything with "raw" or "log" in it.
    for (const name of ['raw_iron_block', 'cooked_beef', 'glass', 'crimson_stem', 'warped_hyphae', 'oak_log_fence', 'logs', null, ''])
        assert.equal(productOf(name), null, String(name));
});

test('Bedrock calls two products something else', () => {
    assert.equal(productOf('netherrack', { edition: 'bedrock' }), 'netherbrick');
    assert.equal(productOf('clay', { edition: 'bedrock' }), 'hardened_clay');
    assert.equal(productOf('sand', { edition: 'bedrock' }), 'glass');
});

test('what to smelt to make a product, in either edition\'s names', () => {
    assert.deepEqual(inputsFor('glass'), ['sand', 'red_sand']);
    assert.deepEqual(inputsFor('netherbrick'), ['netherrack']);
    assert.deepEqual(inputsFor('charcoal'), ['oak_log']);
    assert.deepEqual(inputsFor('diamond_pickaxe'), []);
});

test('Nether wood does not burn; logs are made into their own planks', () => {
    assert.ok(isBurningLog('oak_log') && isBurningLog('stripped_spruce_wood'));
    assert.ok(!isBurningLog('crimson_stem') && !isBurningLog('stripped_warped_hyphae'));
    assert.ok(isBurningPlanks('bamboo_planks') && !isBurningPlanks('crimson_planks'));
    assert.equal(planksOf('stripped_dark_oak_log'), 'dark_oak_planks');
    assert.equal(planksOf('birch_wood'), 'birch_planks');
    assert.equal(planksOf('crimson_stem'), null);
});

test('how far a piece of fuel goes', () => {
    assert.equal(fuelPer('coal'), 8);
    assert.equal(fuelPer('oak_planks'), 1.5);
    assert.equal(fuelPer('crimson_planks'), 0);
    assert.equal(fuelPer('lava_bucket'), 100);
    assert.equal(unitsFor(1.5, 60), 40);
    assert.equal(unitsFor(8, 60), 8);
    assert.equal(itemsFrom(1.5, 3), 4);
});

test('60 glass: 8 coal, or 40 planks, or 10 logs made into planks', () => {
    assert.deepEqual(planFuel({ sand: 60, coal: 20 }, 60, { input: 'sand', product: 'glass' }),
        { stages: [{ name: 'coal', units: 8, covers: 60 }], crafts: [], covers: 60 });
    assert.deepEqual(planFuel({ sand: 60, oak_planks: 64 }, 60, { input: 'sand' }).stages, [{ name: 'oak_planks', units: 40, covers: 60 }]);
    const fromLogs = planFuel({ sand: 60, oak_log: 30 }, 60, { input: 'sand' });
    assert.deepEqual(fromLogs.crafts, [{ log: 'oak_log', planks: 'oak_planks', times: 10 }]);
    assert.deepEqual(fromLogs.stages, [{ name: 'oak_planks', units: 40, covers: 60 }]);
});

test('one kind of fuel per stage: 5 coal, then planks for the rest', () => {
    const plan = planFuel({ sand: 60, coal: 5, oak_planks: 30 }, 60, { input: 'sand' });
    assert.deepEqual(plan.stages, [{ name: 'coal', units: 5, covers: 40 }, { name: 'oak_planks', units: 14, covers: 20 }]);
    assert.equal(plan.covers, 60);
});

test('it never burns what it is smelting, nor what it is making', () => {
    // Making charcoal: the logs being smelted are not fuel, and the charcoal already carried isn't burned.
    const plan = planFuel({ oak_log: 8, charcoal: 10 }, 8, { input: 'oak_log', product: 'charcoal' });
    assert.equal(plan.covers, 0);
    // With logs to spare, the spare ones are made into planks.
    const spare = planFuel({ oak_log: 10, charcoal: 10 }, 8, { input: 'oak_log', product: 'charcoal' });
    assert.deepEqual(spare.crafts, [{ log: 'oak_log', planks: 'oak_planks', times: 2 }]);
    assert.equal(spare.covers, 8);
});

test('a coal block or a lava bucket only when nothing else covers it', () => {
    assert.deepEqual(planFuel({ coal: 1, coal_block: 3 }, 3).stages, [{ name: 'coal', units: 1, covers: 3 }]);
    assert.deepEqual(planFuel({ coal: 1, coal_block: 3 }, 20).stages,
        [{ name: 'coal', units: 1, covers: 8 }, { name: 'coal_block', units: 1, covers: 12 }]);
    assert.deepEqual(planFuel({ crimson_planks: 64 }, 3), { stages: [], crafts: [], covers: 0 });
});

test('a plan short of fuel says how far it goes', () => {
    const plan = planFuel({ sand: 10, oak_planks: 1 }, 10, { input: 'sand' });
    assert.equal(plan.covers, 1);
    assert.deepEqual(plan.stages, [{ name: 'oak_planks', units: 1, covers: 1 }]);
});

test('what to add to the fuel slot now: only more of what is in it', () => {
    assert.deepEqual(nextFuel({ coal: 4, oak_planks: 10 }, 12, null), { name: 'coal', units: 2, covers: 12 });
    assert.deepEqual(nextFuel({ coal: 4, oak_planks: 10 }, 3, { name: 'oak_planks', count: 1 }), { name: 'oak_planks', units: 2, covers: 3 });
    assert.equal(nextFuel({ coal: 4 }, 3, { name: 'oak_planks', count: 1 }), null);
    assert.equal(nextFuel({ coal: 4 }, 0, null), null);
    // Never more than the slot holds.
    assert.deepEqual(nextFuel({ oak_planks: 100 }, 96, { name: 'oak_planks', count: 10 }), { name: 'oak_planks', units: 54, covers: 81 });
    // Never the input still waiting in the bag.
    assert.equal(nextFuel({ oak_log: 20 }, 3, null, { input: 'oak_log', product: 'charcoal' }), null);
});
