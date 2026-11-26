// SPDX-License-Identifier: CC0-1.0
// Blast furnaces and smokers: which items each takes, that a free one near comes before a furnace, that the
// bot places the fastest kind it carries, that a smelt in one takes half as long, and that a Bedrock bot,
// whose library works only a furnace's window, leaves them alone. Against the pretend furnace world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEED, kindName, kindsFor } from '../src/agent/smelting/recipes.js';
import { smeltingSkills } from '../src/agent/smelting/smelt.js';
import { createJobs } from '../src/agent/smelting/jobs.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

test('ores go to a blast furnace, food to a smoker, and everything to a furnace', () => {
    assert.deepEqual(kindsFor('raw_iron'), ['blast_furnace', 'furnace']);
    assert.deepEqual(kindsFor('deepslate_gold_ore'), ['blast_furnace', 'furnace']);
    assert.deepEqual(kindsFor('ancient_debris'), ['blast_furnace', 'furnace']);
    assert.deepEqual(kindsFor('beef'), ['smoker', 'furnace']);
    assert.deepEqual(kindsFor('kelp'), ['smoker', 'furnace']);
    assert.deepEqual(kindsFor('sand'), ['furnace']);
    assert.deepEqual(kindsFor('oak_log'), ['furnace'], 'charcoal only in a furnace');
    assert.deepEqual(kindsFor('chorus_fruit'), ['furnace']);
    assert.deepEqual(kindsFor('dirt'), [], 'nothing smelts dirt');
    assert.equal(SPEED.blast_furnace, 2);
    assert.equal(kindName('blast_furnace'), 'blast furnace');
});

function setup(options, { edition = javaEdition } = {}) {
    const w = fakeFurnaceWorld(options);
    const book = createJobs({ scope: 'test/overworld', now: w.now });
    const smelting = smeltingSkills({ world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => edition, jobs: () => book,
        now: w.now, sleep: w.sleep, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    return { ...w, ...smelting, book, said: () => w.logs.join('\n') };
}

test('raw iron goes to the free blast furnace near, though a furnace is nearer, and takes half as long', async () => {
    const t = setup({ inventory: { raw_iron: 16, coal: 4 }, furnaces: [{ at: [2, 64, 0] }, { at: [6, 64, 0], kind: 'blast_furnace' }] });
    const started = t.now();
    assert.equal(await t.smeltItem(t.bot, 'raw_iron', 16), true, t.said());
    assert.match(t.said(), /smelted 16 raw_iron into iron_ingot in the blast furnace at 6, 64, 0, burning 2 coal/);
    assert.equal(t.bag.iron_ingot, 16);
    assert.equal(t.bag.coal, 2, 'a coal smelts eight in a blast furnace too');
    const took = t.now() - started;
    assert.ok(took < 16 * 10000 * 0.7, `16 items in a blast furnace take about 80 s, not 160: ${took} ms`);
    assert.deepEqual(t.furnaceAt(2, 64, 0).slots, [null, null, null], 'the furnace was not used');
});

test('sand is never put in a blast furnace or a smoker: they don\'t smelt it', async () => {
    const t = setup({ inventory: { sand: 4, coal: 1 }, furnaces: [{ at: [2, 64, 0], kind: 'blast_furnace' }, { at: [3, 64, 0], kind: 'smoker' }, { at: [8, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 4), true, t.said());
    assert.match(t.said(), /in the furnace at 8, 64, 0/);
});

test('a smoker in use is left alone for a free furnace, and said so by name', async () => {
    const t = setup({ inventory: { beef: 4, coal: 1 }, furnaces: [{ at: [2, 64, 0], kind: 'smoker', input: { name: 'chicken', count: 3 } }, { at: [5, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'beef', 4), true, t.said());
    assert.match(t.said(), /The smoker at 2, 64, 0 is in use \(3 chicken in it\), so I left it alone/);
    assert.match(t.said(), /into cooked_beef in the furnace at 5, 64, 0/);
});

test('with no furnace block about, the bot places the smoker it carries for food, and picks it back up', async () => {
    const t = setup({ inventory: { beef: 4, coal: 1, furnace: 1, smoker: 1, stone_pickaxe: 1 } });
    assert.equal(await t.smeltItem(t.bot, 'beef', 4), true, t.said());
    assert.match(t.said(), /I placed my smoker at .*I picked my smoker back up/);
    assert.equal(t.bag.smoker, 1);
    assert.equal(t.bag.furnace, 1, 'its furnace stayed in the bag');
    assert.equal(t.bag.cooked_beef, 4);
});

test('loaded and left in a blast furnace: it is said to be done in half the time, and the job says which block', async () => {
    const t = setup({ inventory: { raw_gold: 20, coal: 3 }, furnaces: [{ at: [4, 64, 0], kind: 'blast_furnace' }] });
    assert.equal(await t.loadFurnace(t.bot, 'raw_gold', 20), true, t.said());
    assert.match(t.said(), /in the blast furnace at 4, 64, 0\. The 20 raw_gold in it will be gold_ingot in about 2 minutes/, '100 s, where a furnace takes 200');
    assert.equal(t.book.at({ x: 4, y: 64, z: 0 }).kind, 'blast_furnace');
    assert.match(t.furnacesText(t.bot), /- blast furnace at 4, 64, 0: 20 raw_gold into gold_ingot/);
    t.advance(105000);
    assert.match(t.readyNotes(t.bot).join('\n'), /The gold_ingot in the blast furnace at 4, 64, 0 should be done/);
    t.logs.length = 0;
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /From the blast furnace at 4, 64, 0 I took 20 gold_ingot/);
});

test('on Bedrock, whose library works only a furnace\'s window, the blast furnace is left for the furnace', async () => {
    const bedrockish = { ...javaEdition, usableFurnaceKinds: () => ['furnace'] };
    const t = setup({ inventory: { raw_iron: 4, coal: 1 }, furnaces: [{ at: [2, 64, 0], kind: 'blast_furnace' }, { at: [6, 64, 0] }] }, { edition: bedrockish });
    assert.equal(await t.smeltItem(t.bot, 'raw_iron', 4), true, t.said());
    assert.match(t.said(), /in the furnace at 6, 64, 0/);
    assert.deepEqual(t.furnaceAt(2, 64, 0).slots, [null, null, null]);
});
