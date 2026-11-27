// SPDX-License-Identifier: CC0-1.0
// A whole smelt, against a small world of furnaces whose clock moves only when the bot waits
// (helpers/fake_furnace.js): finding a free furnace, loading it, shutting it, coming back, taking back what
// is the bot's, and every way it can go wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smeltingSkills } from '../src/agent/smelting/smelt.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { createJobs } from '../src/agent/smelting/jobs.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

// The pretend furnace's slots are filled the moment it opens, so the pause real furnaces get after opening
// (openSettleMs) is left out: it would only let the pretend one burn on unwatched.
function setup(options) {
    const w = fakeFurnaceWorld(options);
    const smelting = smeltingSkills({
        world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => javaEdition,
        now: w.now, sleep: w.sleep, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } },
    });
    return { ...w, ...smelting, said: () => w.logs.join('\n') };
}

test('16 sand and 2 coal make 16 glass, and the furnace is left empty', async () => {
    const t = setup({ inventory: { sand: 16, coal: 5 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 16), true, t.said());
    assert.equal(t.bag.glass, 16);
    assert.equal(t.bag.coal, 3, 'two coal burned, none left in the furnace');
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots, [null, null, null]);
    assert.match(t.said(), /smelted 16 sand into glass in the furnace at 3, 64, 0, burning 2 coal/);
    assert.equal(t.bot.currentWindow, null, 'the window is shut');
    // It shut the furnace between looks rather than standing at it.
    assert.ok(t.events.filter(e => e === 'close').length >= 2, t.events.join(', '));
});

test('5 coal, then planks for the rest: 60 glass', async () => {
    const t = setup({ inventory: { sand: 60, coal: 5, oak_planks: 30 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 60), true, t.said());
    assert.equal(t.bag.glass, 60);
    assert.equal(t.bag.coal ?? 0, 0);
    assert.ok(t.bag.oak_planks >= 15, `at most 15 planks burned, ${30 - t.bag.oak_planks} were`);
});

test('logs are made into planks first: 60 glass from 10 logs', async () => {
    const t = setup({ inventory: { sand: 60, oak_log: 12 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 60), true, t.said());
    assert.equal(t.bag.glass, 60);
    assert.equal(t.bag.oak_log, 2);
    assert.match(t.said(), /made 10 oak_log into oak_planks for fuel/);
});

test('more than a stack goes in a stack at a time: 130 glass', async () => {
    const t = setup({ inventory: { sand: 130, coal: 20 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 130), true, t.said());
    assert.equal(t.bag.glass, 130);
    assert.equal(t.bag.coal, 20 - 17);
});

test('a furnace in use is left alone, and a free one used', async () => {
    const t = setup({
        inventory: { sand: 4, coal: 1 },
        furnaces: [{ at: [2, 64, 0], input: { name: 'raw_iron', count: 3 } }, { at: [6, 64, 0] }],
    });
    assert.equal(await t.smeltItem(t.bot, 'sand', 4), true, t.said());
    assert.deepEqual(t.furnaceAt(2, 64, 0).slots[0], { name: 'raw_iron', count: 3 }, 'their iron is still there');
    assert.match(t.said(), /furnace at 2, 64, 0 is in use \(3 raw_iron in it\)/);
    assert.match(t.said(), /in the furnace at 6, 64, 0/);
});

test('someone else\'s glass in the output makes a furnace in use: it is not taken', async () => {
    const t = setup({ inventory: { sand: 2, coal: 1 }, furnaces: [{ at: [2, 64, 0], output: { name: 'glass', count: 9 } }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 2), false);
    assert.equal(t.bag.glass, undefined);
    assert.match(t.said(), /in use \(9 glass in it\)/);
});

test('fuel already in a furnace is used, and only the bot\'s own is taken back', async () => {
    const t = setup({ inventory: { sand: 8, coal: 3 }, furnaces: [{ at: [3, 64, 0], fuel: { name: 'coal', count: 2 } }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.equal(t.bag.coal, 3, 'the furnace\'s own coal covered it; the bot put none in');
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots[1], { name: 'coal', count: 1 });
});

test('a furnace that never opens is given up in time, and leaves no window open', async () => {
    const t = setup({ inventory: { sand: 2, coal: 1 }, furnaces: [{ at: [3, 64, 0], neverOpens: true }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 2), false);
    assert.match(t.said(), /couldn't use the furnace at 3, 64, 0: it did not open/);
    assert.equal(t.bot.currentWindow, null);
});

test('a put that throws still leaves the window shut', async () => {
    const t = setup({ inventory: { sand: 2, coal: 1 }, furnaces: [{ at: [3, 64, 0], throwOnPut: true }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 2), false);
    assert.equal(t.bot.currentWindow, null);
    assert.equal(t.bag.sand, 2, 'nothing was lost');
});

test('a carried furnace is placed, and picked back up with a pickaxe', async () => {
    const t = setup({ inventory: { sand: 3, coal: 1, furnace: 1, stone_pickaxe: 1 } });
    assert.equal(await t.smeltItem(t.bot, 'sand', 3), true, t.said());
    assert.equal(t.bag.glass, 3);
    assert.equal(t.bag.furnace, 1);
    assert.match(t.said(), /placed my furnace at .*picked my furnace back up/);
});

test('without a pickaxe the placed furnace is left, and the bot says where', async () => {
    const t = setup({ inventory: { sand: 3, coal: 1, furnace: 1 } });
    assert.equal(await t.smeltItem(t.bot, 'sand', 3), true, t.said());
    assert.equal(t.bag.furnace, undefined);
    assert.match(t.said(), /left my furnace at .*it takes a pickaxe/);
});

test('no furnace known and none carried: said so that fair play can add its note', async () => {
    const t = setup({ inventory: { sand: 3, coal: 1 } });
    assert.equal(await t.smeltItem(t.bot, 'sand', 3), false);
    assert.match(t.said(), /There is no furnace nearby that I know of/);
});

test('stopped while it waits: the furnace is left working, and the bot says what is in it', async () => {
    const t = setup({ inventory: { sand: 20, coal: 3 }, furnaces: [{ at: [3, 64, 0] }] });
    const sleep = t.sleep;
    let waited = 0;
    t.bot.interrupt_code = false;
    const realSleep = async ms => { waited += ms; if (waited > 30000) t.bot.interrupt_code = true; await sleep(ms); };
    const smelting = smeltingSkills({ world: t.world, skills: t.skills, blockAt: t.blockAt, editionOf: () => javaEdition,
        now: t.now, sleep: realSleep, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    assert.equal(await smelting.smeltItem(t.bot, 'sand', 20), false);
    assert.match(t.said(), /interrupted\. The furnace at 3, 64, 0 still has sand of mine in it/);
    assert.ok(t.furnaceAt(3, 64, 0).slots[0]?.count > 0);
});

test('short of fuel: it smelts what the fuel covers and says so', async () => {
    const t = setup({ inventory: { sand: 10, oak_planks: 1 }, furnaces: [{ at: [3, 64, 0] }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 10), false);
    assert.equal(t.bag.glass, 1);
    assert.equal(t.bag.sand, 9);
    assert.match(t.said(), /fuel for only 1/);
});

test('someone puts their own things in mid-smelt: the bot stops and leaves them', async () => {
    const t = setup({ inventory: { sand: 6, coal: 1 }, furnaces: [{ at: [3, 64, 0] }] });
    const sleep = t.sleep;
    let meddled = false;
    const meddling = async ms => {
        await sleep(ms);
        const f = t.furnaceAt(3, 64, 0);
        if (!meddled && f.slots[0]?.count < 6) { meddled = true; f.slots[0] = { name: 'raw_iron', count: 2 }; }
    };
    const smelting = smeltingSkills({ world: t.world, skills: t.skills, blockAt: t.blockAt, editionOf: () => javaEdition,
        now: t.now, sleep: meddling, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    assert.equal(await smelting.smeltItem(t.bot, 'sand', 6), false);
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots[0], { name: 'raw_iron', count: 2 });
    assert.match(t.said(), /Someone else put something in the furnace/);
});

test('asked to smelt a product, it says what to smelt instead', async () => {
    const t = setup({ inventory: { glass: 3 } });
    assert.equal(await t.smeltItem(t.bot, 'glass', 3), false);
    assert.match(t.said(), /glass isn't smelted, it is made: smelt sand and red_sand/);
});

test('clearing a furnace takes everything out of it', async () => {
    const t = setup({ furnaces: [{ at: [3, 64, 0], input: { name: 'sand', count: 2 }, fuel: { name: 'coal', count: 1 }, output: { name: 'glass', count: 5 } }] });
    assert.equal(await t.clearFurnace(t.bot), true);
    assert.deepEqual(t.bag, { sand: 2, coal: 1, glass: 5 });
    assert.match(t.said(), /cleared the furnace at 3, 64, 0, taking 2 sand, 1 coal and 5 glass/);
    assert.equal(t.bot.currentWindow, null);
});

// ---- Jobs: what the bot left smelting where ----

/** A smelting set-up with a jobs store, and a sleep the test can stop the bot from. */
function withJobs(options, { stopAfterMs = Infinity } = {}) {
    const w = fakeFurnaceWorld(options);
    const book = createJobs({ scope: 'test/overworld', now: w.now });
    let waited = 0;
    const sleep = async ms => { waited += ms; if (waited > stopAfterMs) w.bot.interrupt_code = true; await w.sleep(ms); };
    const make = s => smeltingSkills({ world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => javaEdition, jobs: () => book,
        now: w.now, sleep: s, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    return { ...w, book, ...make(sleep), again: () => { w.bot.interrupt_code = false; return make(w.sleep); }, said: () => w.logs.join('\n') };
}

test('a stopped smelt leaves a job, and smelting again goes on with it in the same furnace', async () => {
    const t = withJobs({ inventory: { sand: 20, coal: 3 }, furnaces: [{ at: [3, 64, 0] }] }, { stopAfterMs: 30000 });
    assert.equal(await t.smeltItem(t.bot, 'sand', 20), false);
    const job = t.book.at({ x: 3, y: 64, z: 0 });
    assert.ok(job, 'the job is kept');
    assert.equal(job.input, 'sand');
    assert.equal(job.loaded, 20);
    assert.deepEqual(job.fuelPut, { coal: 3 });
    assert.equal(t.bag.sand ?? 0, 0, 'all its sand is in the furnace');

    // All its sand is in there, so it has none to carry: it goes on with what it left.
    const again = t.again();
    t.logs.length = 0;
    assert.equal(await again.smeltItem(t.bot, 'sand', 20), true, t.said());
    assert.equal(t.bag.glass, 20);
    assert.match(t.said(), /went on with the sand I had left in the furnace at 3, 64, 0/);
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots, [null, null, null], 'and took back the coal left over');
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null, 'the job is over');
});

test('its own furnace smelting something else is left to that, not called in use', async () => {
    const t = withJobs({ inventory: { sand: 2, coal: 1 }, furnaces: [{ at: [3, 64, 0], input: { name: 'raw_iron', count: 3 }, fuel: { name: 'coal', count: 1 } }, { at: [5, 64, 2] }] });
    t.book.start({ x: 3, y: 64, z: 0 }, { input: 'raw_iron', product: 'iron_ingot', total: 3 });
    t.book.note({ x: 3, y: 64, z: 0 }, { loaded: 3, fuelPut: { coal: 1 } });
    assert.equal(await t.smeltItem(t.bot, 'sand', 2), true, t.said());
    assert.match(t.said(), /furnace at 3, 64, 0 is smelting my raw_iron, so I left it to that/);
    assert.ok(t.book.at({ x: 3, y: 64, z: 0 }), 'the iron job stands');
});

test('a furnace with more in it than the bot put there is someone else\'s too', async () => {
    const t = withJobs({ inventory: { sand: 2, coal: 1 }, furnaces: [{ at: [3, 64, 0], input: { name: 'sand', count: 9 } }, { at: [5, 64, 2] }] });
    t.book.start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 4 });
    t.book.note({ x: 3, y: 64, z: 0 }, { loaded: 4 });
    assert.equal(await t.smeltItem(t.bot, 'sand', 2), true, t.said());
    assert.match(t.said(), /furnace at 3, 64, 0 is in use \(9 sand in it\)/);
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots[0], { name: 'sand', count: 9 });
});

test('its sand gone from the furnace when it comes back, the bot smelts only what it carries', async () => {
    const t = withJobs({ inventory: { sand: 3, coal: 1 }, furnaces: [{ at: [3, 64, 0] }] });
    t.book.start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 8 });
    t.book.note({ x: 3, y: 64, z: 0 }, { loaded: 8 });
    assert.equal(await t.smeltItem(t.bot, 'sand', 11), false);
    assert.equal(t.bag.glass, 3);
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
});

test('clearing a furnace with a job in it ends the job', async () => {
    const t = withJobs({ furnaces: [{ at: [3, 64, 0], input: { name: 'sand', count: 2 } }] });
    t.book.start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 2 });
    t.book.note({ x: 3, y: 64, z: 0 }, { loaded: 2 });
    assert.equal(await t.clearFurnace(t.bot), true);
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
});
