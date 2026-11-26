// SPDX-License-Identifier: CC0-1.0
// Several furnaces at once: how a big smelt is shared out (by speed, only where it is worth a furnace and
// the fuel covers every share), and whole smelts and loads across a row of furnaces in the pretend furnace
// world: all of them used, one in use left out and its share given to the others, the bot's own placed and
// picked back up, and a stop leaving every furnace working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FURNACES, MIN_SHARE, planShares, shareOut } from '../src/agent/smelting/shares.js';
import { smeltingSkills } from '../src/agent/smelting/smelt.js';
import { createJobs } from '../src/agent/smelting/jobs.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

test('shares add up, in proportion to speed, the remainders to the nearest first', () => {
    assert.deepEqual(shareOut(60, [1, 1, 1]), [20, 20, 20]);
    assert.deepEqual(shareOut(61, [1, 1, 1]), [21, 20, 20]);
    assert.deepEqual(shareOut(30, [2, 1]), [20, 10], 'a blast furnace takes twice the share of a furnace');
    assert.deepEqual(shareOut(0, [1, 1]), [0, 0]);
});

test('a furnace is added only when each share is worth one and the fuel covers every share', () => {
    const three = ['furnace', 'furnace', 'furnace'];
    assert.deepEqual(planShares(60, three, { sand: 60, coal: 9 }, { input: 'sand', product: 'glass' }), [20, 20, 20], '3 coal for each 20');
    // 8 coal smelt 60 in one furnace, but three furnaces of 20 take 9: two of 30 take 8.
    assert.deepEqual(planShares(60, three, { sand: 60, coal: 8 }, { input: 'sand', product: 'glass' }), [30, 30]);
    assert.deepEqual(planShares(60, three, { sand: 60, coal: 7 }, { input: 'sand', product: 'glass' }), [60], 'short of fuel: one furnace');
    assert.deepEqual(planShares(2 * MIN_SHARE - 1, three, { sand: 20, coal: 9 }, { input: 'sand', product: 'glass' }), [15], 'too few to be worth a second');
    assert.deepEqual(planShares(30, ['blast_furnace', 'furnace'], { raw_iron: 30, coal: 9 }, { input: 'raw_iron', product: 'iron_ingot' }), [20, 10]);
    const many = Array(8).fill('furnace');
    assert.equal(planShares(200, many, { sand: 200, coal: 64 }, { input: 'sand', product: 'glass' }).length, MAX_FURNACES);
    // A load puts in a stack each now: the fuel is checked for that, the rest goes in later.
    assert.deepEqual(planShares(300, three, { sand: 300, coal: 24 }, { input: 'sand', product: 'glass', now: 64 }), [100, 100, 100]);
});

test('logs made into charcoal are not counted as fuel for the next furnace\'s share', () => {
    // 32 logs to smelt and 2 coal: the logs themselves can't be burned, so two furnaces of 16 take 4 coal.
    assert.deepEqual(planShares(32, ['furnace', 'furnace'], { oak_log: 32, coal: 2 }, { input: 'oak_log', product: 'charcoal' }), [32]);
});

// With `stopAfterMs`, the bot is stopped (as by !stop) once it has waited that long.
function setup(options, { stopAfterMs = Infinity } = {}) {
    const w = fakeFurnaceWorld(options);
    const book = createJobs({ scope: 'test/overworld', now: w.now });
    let waited = 0;
    const sleep = async ms => { waited += ms; if (waited > stopAfterMs) w.bot.interrupt_code = true; await w.sleep(ms); };
    const make = sleepWith => smeltingSkills({ world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => javaEdition, jobs: () => book,
        now: w.now, sleep: sleepWith, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } } });
    return { ...w, ...make(sleep), book, again: () => { w.bot.interrupt_code = false; return make(w.sleep); }, said: () => w.logs.join('\n') };
}
const row = (...xs) => xs.map(x => ({ at: [x, 64, 0] }));
const empty = [null, null, null];

test('60 sand and 9 coal in a row of three furnaces: 20 in each, done in about a third of the time', async () => {
    const t = setup({ inventory: { sand: 60, coal: 9 }, furnaces: row(2, 4, 6) });
    const started = t.now();
    assert.equal(await t.smeltItem(t.bot, 'sand', 60), true, t.said());
    assert.equal(t.bag.glass, 60);
    assert.equal(t.bag.coal ?? 0, 0);
    assert.match(t.said(), /I smelted 60 sand into glass in the furnace at 2, 64, 0, the furnace at 4, 64, 0 and the furnace at 6, 64, 0, burning 9 coal\./);
    const took = t.now() - started;
    assert.ok(took < 300000, `three furnaces do 60 in about 200 s, not 600: ${took} ms`);
    for (const x of [2, 4, 6]) assert.deepEqual(t.furnaceAt(x, 64, 0).slots, empty, `the furnace at ${x} is left empty`);
    assert.deepEqual(t.book.list(), [], 'no job is left');
});

test('with fuel for only two shares, two furnaces; a smelt too small for two, one', async () => {
    const t = setup({ inventory: { sand: 60, coal: 8 }, furnaces: row(2, 4, 6) });
    assert.equal(await t.smeltItem(t.bot, 'sand', 60), true, t.said());
    assert.match(t.said(), /in the furnace at 2, 64, 0 and the furnace at 4, 64, 0, burning 8 coal/);
    assert.deepEqual(t.furnaceAt(6, 64, 0).slots, empty);
    const small = setup({ inventory: { sand: 12, coal: 4 }, furnaces: row(2, 4) });
    assert.equal(await small.smeltItem(small.bot, 'sand', 12), true, small.said());
    assert.match(small.said(), /I smelted 12 sand into glass in the furnace at 2, 64, 0, burning 2 coal\./);
});

test('a furnace in the row that is in use is left alone, and its share goes to the others', async () => {
    const furnaces = [{ at: [2, 64, 0] }, { at: [4, 64, 0], input: { name: 'raw_iron', count: 5 } }, { at: [6, 64, 0] }];
    const t = setup({ inventory: { sand: 48, coal: 9 }, furnaces });
    assert.equal(await t.smeltItem(t.bot, 'sand', 48), true, t.said());
    assert.equal(t.bag.glass, 48);
    assert.match(t.said(), /The furnace at 4, 64, 0 is in use \(5 raw_iron in it\), so I left it alone\./);
    assert.match(t.said(), /in the furnace at 2, 64, 0 and the furnace at 6, 64, 0/);
    assert.deepEqual(t.furnaceAt(4, 64, 0).slots, [{ name: 'raw_iron', count: 5 }, null, null], 'their raw iron is as it was');
});

test('a blast furnace and a furnace share raw iron two to one, and are done about together', async () => {
    const t = setup({ inventory: { raw_iron: 48, coal: 7 }, furnaces: [{ at: [2, 64, 0], kind: 'blast_furnace' }, { at: [4, 64, 0] }] });
    const started = t.now();
    assert.equal(await t.smeltItem(t.bot, 'raw_iron', 48), true, t.said());
    assert.equal(t.bag.iron_ingot, 48);
    assert.match(t.said(), /in the blast furnace at 2, 64, 0 and the furnace at 4, 64, 0/);
    const took = t.now() - started;
    assert.ok(took < 200000, `32 in the blast furnace and 16 in the furnace take about 160 s: ${took} ms`);
});

test('a furnace farther off than the row is not shared with', async () => {
    const t = setup({ inventory: { sand: 40, coal: 9 }, furnaces: row(2, 30) });
    assert.equal(await t.smeltItem(t.bot, 'sand', 40), true, t.said());
    assert.match(t.said(), /I smelted 40 sand into glass in the furnace at 2, 64, 0, burning/);
    assert.deepEqual(t.furnaceAt(30, 64, 0).slots, empty);
});

test('furnaces the bot carries are placed to share the smelt when it has a pickaxe, and picked back up', async () => {
    const t = setup({ inventory: { sand: 40, coal: 9, furnace: 2, stone_pickaxe: 1 }, furnaces: row(2) });
    assert.equal(await t.smeltItem(t.bot, 'sand', 40), true, t.said());
    assert.equal(t.bag.glass, 40);
    assert.equal(t.bag.furnace, 2, 'both came back');
    assert.equal((t.said().match(/I placed my furnace at/g) ?? []).length, 2, t.said());
    assert.equal((t.said().match(/I picked my furnace back up/g) ?? []).length, 2, t.said());
    // Without a pickaxe it couldn't pick them up, so it doesn't put them down.
    const bare = setup({ inventory: { sand: 40, coal: 9, furnace: 2 }, furnaces: row(2) });
    assert.equal(await bare.smeltItem(bare.bot, 'sand', 40), true, bare.said());
    assert.doesNotMatch(bare.said(), /placed my furnace/);
    assert.equal(bare.bag.furnace, 2);
});

test('stopped half way, every furnace keeps its sand and its job, and smelting again goes on with them', async () => {
    const t = setup({ inventory: { sand: 48, coal: 9 }, furnaces: row(2, 4, 6) }, { stopAfterMs: 40000 });
    assert.equal(await t.smeltItem(t.bot, 'sand', 48), false);
    assert.match(t.said(), /I was interrupted\. The furnace at 2, 64, 0 still has sand of mine in it/);
    assert.equal(t.book.list().length, 3, 'a job in each furnace');
    assert.ok(t.bag.glass === undefined || t.bag.glass < 48);
    t.logs.length = 0;
    t.advance(30000);
    await t.again().smeltItem(t.bot, 'sand', 48);
    assert.equal(t.bag.glass, 48, t.said());
    for (const x of [2, 4, 6]) assert.deepEqual(t.furnaceAt(x, 64, 0).slots, empty, `the furnace at ${x} is left empty`);
    assert.deepEqual(t.book.list(), []);
});

test('a big load is shared between the furnaces in the row, each with its job, and collected from all of them', async () => {
    const t = setup({ inventory: { sand: 150, coal: 24 }, furnaces: row(2, 4, 6) });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 150), true, t.said());
    assert.match(t.said(), /I put 50 sand and 7 coal in the furnace at 2, 64, 0\..*I put 50 sand and 7 coal in the furnace at 4, 64, 0\..*I put 50 sand and 7 coal in the furnace at 6, 64, 0\./s);
    assert.equal(t.book.list().length, 3);
    for (const x of [2, 4, 6]) assert.match(t.furnacesText(t.bot), new RegExp(`- furnace at ${x}, 64, 0: 50 sand into glass`));
    t.advance(510000);
    t.logs.length = 0;
    await t.collectFurnace(t.bot);
    assert.equal(t.bag.glass, 150, t.said());
    assert.deepEqual(t.book.list(), []);
});
