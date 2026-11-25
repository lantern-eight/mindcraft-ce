// SPDX-License-Identifier: CC0-1.0
// Loading a furnace and leaving it, against the pretend furnace (helpers/fake_furnace.js): what the bot
// says when it loads, the reminder once the smelt should be done, and collecting, topping up and putting in
// the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smeltingSkills } from '../src/agent/smelting/smelt.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { createJobs } from '../src/agent/smelting/jobs.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

function setup(options) {
    const w = fakeFurnaceWorld(options);
    const book = createJobs({ scope: 'test/overworld', now: w.now });
    const smelting = smeltingSkills({ world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => javaEdition, jobs: () => book,
        now: w.now, sleep: w.sleep, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    return { ...w, ...smelting, book, said: () => w.logs.join('\n'), fresh: () => { w.logs.length = 0; } };
}

test('loaded and left: the bot says when it will be done, is reminded once, and collects the glass', async () => {
    const t = setup({ inventory: { sand: 16, coal: 5 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 16), true, t.said());
    assert.match(t.said(), /put 16 sand and 2 coal in the furnace at 3, 64, 0\. The 16 sand in it will be glass in about 3 minutes\. !collectFurnace/);
    assert.equal(t.bot.currentWindow, null, 'shut, and left');
    assert.match(t.furnacesText(t.bot), /furnace at 3, 64, 0: 16 sand into glass; done in about 3 minutes/);
    assert.deepEqual(t.readyNotes(t.bot), [], 'not ready yet');

    t.advance(170000);
    assert.deepEqual(t.readyNotes(t.bot), ['The glass in the furnace at 3, 64, 0 should be done (!collectFurnace).']);
    assert.deepEqual(t.readyNotes(t.bot), [], 'said once');

    t.fresh();
    assert.equal(await t.collectFurnace(t.bot), true, t.said());
    assert.equal(t.bag.glass, 16);
    assert.equal(t.bag.coal, 3);
    assert.match(t.said(), /From the furnace at 3, 64, 0 I took 16 glass\./);
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null, 'the job is over');
    assert.match(t.furnacesText(t.bot), /nothing smelting/);
});

test('more than a stack: the first goes in, and collecting puts in the rest', async () => {
    // A coal more than 100 items need: a furnace that finishes between visits loses the rest of a burn.
    const t = setup({ inventory: { sand: 100, coal: 14 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 100), true, t.said());
    assert.match(t.said(), /put 64 sand and 8 coal in.*36 more sand go in when there is room/);
    t.advance(30000);
    t.fresh();
    await t.collectFurnace(t.bot);
    // Ten seconds an item: three are done.
    assert.match(t.said(), /I took 3 glass\. I put in 3 sand more\. 64 sand still smelting/);
    t.advance(700000);
    t.fresh();
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /I took 64 glass\. I put in 33 sand more/);
    t.advance(400000);
    await t.collectFurnace(t.bot);
    assert.equal(t.bag.glass, 100, t.said());
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots.filter(Boolean), [], 'its spare coal came back out');
});

test('short of fuel when it loads, it loads what the fuel covers', async () => {
    const t = setup({ inventory: { sand: 32, coal: 2 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 32), true, t.said());
    assert.match(t.said(), /fuel for only 16/);
    assert.equal(t.bag.sand, 16, 'the rest stays in its bag');
    t.advance(170000);
    assert.match(t.readyNotes(t.bot)[0] ?? '', /should be done/);
    t.fresh();
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /took 16 glass/);
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
});

test('fuel that runs out with the job half done: the reminder says so, and collecting tops it up', async () => {
    const t = setup({ inventory: { sand: 16, coal: 2 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 16), true, t.said());
    t.furnaceAt(3, 64, 0).slots[1] = null; // someone took the second coal
    t.book.note({ x: 3, y: 64, z: 0 }, { unfueled: 8, readyAt: t.now() + 80000 });
    t.advance(90000);
    assert.match(t.readyNotes(t.bot)[0] ?? '', /smelted what its fuel covered; 8 sand wait for more fuel/);
    t.bag.coal = 1;
    t.fresh();
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /I took 8 glass\. 8 sand still smelting, done in about 80 seconds/);
    assert.equal(t.bag.coal ?? 0, 0, 'its new coal went in');
});

test('collecting with nothing left smelting, or from a furnace someone else has filled', async () => {
    const t = setup({ furnaces: [{ at: [3, 64, 0], input: { name: 'raw_iron', count: 5 } }] });
    assert.equal(await t.collectFurnace(t.bot), false);
    assert.match(t.said(), /nothing smelting in any furnace that I know of/);
    t.book.start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 4 });
    t.book.note({ x: 3, y: 64, z: 0 }, { loaded: 4 });
    t.fresh();
    assert.equal(await t.collectFurnace(t.bot), false);
    assert.match(t.said(), /furnace at 3, 64, 0 has someone else's things in it now, so I left it/);
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots[0], { name: 'raw_iron', count: 5 });
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
});

test('a furnace placed for a load is picked back up after the last of it, with a pickaxe', async () => {
    const t = setup({ inventory: { sand: 4, coal: 1, furnace: 1, stone_pickaxe: 1 } });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 4), true, t.said());
    assert.match(t.said(), /placed my furnace/);
    t.advance(50000);
    t.fresh();
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /took 4 glass.*picked my furnace back up/);
    assert.equal(t.bag.furnace, 1);
});
