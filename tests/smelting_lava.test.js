// SPDX-License-Identifier: CC0-1.0
// Lava from a lava farm as the first fuel: the plan, filling a bucket at a full lava cauldron, finding an
// empty bucket in a furnace, and the bucket a lava load leaves behind. Against the pretend furnace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFuel, nextFuel } from '../src/agent/smelting/fuel.js';
import { smeltingSkills } from '../src/agent/smelting/smelt.js';
import { createJobs } from '../src/agent/smelting/jobs.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

test('with a lava farm, lava goes first; without one, a lava bucket is still the last resort', () => {
    const bag = { coal: 10, lava_bucket: 1 };
    assert.deepEqual(planFuel(bag, 60, { lavaFirst: true }).stages, [{ name: 'lava_bucket', units: 1, covers: 60 }]);
    assert.deepEqual(planFuel(bag, 60).stages, [{ name: 'coal', units: 8, covers: 60 }]);
    assert.deepEqual(planFuel(bag, 150, { lavaFirst: true }).stages, [{ name: 'lava_bucket', units: 1, covers: 100 }, { name: 'coal', units: 7, covers: 50 }]);
    // One bucket at a time in the slot, however many the bot carries.
    assert.deepEqual(nextFuel({ lava_bucket: 3 }, 250, null, { lavaFirst: true }), { name: 'lava_bucket', units: 1, covers: 100 });
});

function setup(options, deps = {}) {
    const w = fakeFurnaceWorld(options);
    const book = createJobs({ scope: 'test/overworld', now: w.now });
    const smelting = smeltingSkills({ world: w.world, skills: w.skills, blockAt: w.blockAt, editionOf: () => javaEdition, jobs: () => book,
        now: w.now, sleep: w.sleep, timing: { hands: { openTimeoutMs: 30, stepTimeoutMs: 30, openSettleMs: 0 } }, ...deps });
    return { ...w, ...smelting, book, said: () => w.logs.join('\n'), fresh: () => { w.logs.length = 0; } };
}

test('a lava farm near: the bot fills its bucket, smelts on the lava, keeps its coal, and takes its bucket back', async () => {
    const t = setup({ inventory: { sand: 16, coal: 4, bucket: 1 }, furnaces: [{ at: [3, 64, 0] }], lavaCauldrons: [[-3, 64, 0]] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 16), true, t.said());
    assert.match(t.said(), /filled a bucket with lava from the cauldron at -3, 64, 0/);
    assert.match(t.said(), /burning 1 lava_bucket/);
    assert.equal(t.bag.glass, 16);
    assert.equal(t.bag.coal, 4, 'no coal burned');
    assert.equal(t.bag.bucket, 1, 'its bucket came back out of the fuel slot');
    assert.equal(t.cauldronAt(-3, 64, 0).lava, false, 'the cauldron is empty until the dripstone fills it');
    assert.deepEqual(t.furnaceAt(3, 64, 0).slots, [null, null, null]);
});

test('no bucket in its bag: it takes the empty one it knows is in a furnace', async () => {
    const t = setup({ inventory: { sand: 8, coal: 1 }, furnaces: [{ at: [3, 64, 0] }, { at: [6, 64, 4], fuel: { name: 'bucket', count: 1 } }], lavaCauldrons: [[-3, 64, 0]] },
        { knownBuckets: () => [{ x: 6, y: 64, z: 4 }] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.match(t.said(), /took an empty bucket out of the furnace at 6, 64, 4\. I filled a bucket with lava/);
    assert.equal(t.bag.coal, 1);
    assert.equal(t.furnaceAt(6, 64, 4).slots[1], null);
});

test('no bucket in its bag or a furnace: it fetches one from the chests, and says where from', async () => {
    let t = null;
    const asked = [];
    t = setup({ inventory: { sand: 8, coal: 1 }, furnaces: [{ at: [3, 64, 0] }], lavaCauldrons: [[-3, 64, 0]] }, {
        fetchItem: async (bot, name, count) => {
            asked.push([name, count]);
            t.bag.bucket = 1;
            return { status: 'ok', text: 'Took 1 bucket:', taken: [{ label: 'chest at 5, 64, 5', owner: 'shared', count: 1 }] };
        },
    });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.deepEqual(asked, [['bucket', 1]], 'an empty bucket, one, by its exact name');
    assert.match(t.said(), /took an empty bucket from the chest at 5, 64, 5 \(shared\)\. I filled a bucket with lava/);
    assert.equal(t.bag.coal, 1, 'no coal burned');
    assert.equal(t.bag.bucket, 1, 'the bucket came back out of the fuel slot');
});

test('a furnace\'s bucket comes before the chests', async () => {
    let fetched = 0;
    const t = setup({ inventory: { sand: 8, coal: 1 }, furnaces: [{ at: [3, 64, 0] }, { at: [6, 64, 4], fuel: { name: 'bucket', count: 1 } }], lavaCauldrons: [[-3, 64, 0]] },
        { knownBuckets: () => [{ x: 6, y: 64, z: 4 }], fetchItem: async () => { fetched++; return null; } });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.equal(fetched, 0);
});

test('a chest held a bucket the bot may not take: it names that chest, and burns coal', async () => {
    const t = setup({ inventory: { sand: 8, coal: 1 }, furnaces: [{ at: [3, 64, 0] }], lavaCauldrons: [[-3, 64, 0]] }, {
        fetchItem: async () => ({ status: 'failed', taken: [], text: 'You know of no bucket in a chest you may take from within 64 blocks.\n'
            + '- The chest at 9, 64, 9 held 1 bucket when you last looked, but nobody has said whose it is: ask\n'
            + 'Chests you remember hold: water_bucket. Did you mean one of those?' }),
    });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.match(t.said(), /no empty bucket for it\.\n- The chest at 9, 64, 9 held 1 bucket/);
    assert.doesNotMatch(t.said(), /Did you mean/);
    assert.equal(t.bag.coal ?? 0, 0);
});

test('no bucket anywhere: it says so, and burns coal', async () => {
    const t = setup({ inventory: { sand: 8, coal: 1 }, furnaces: [{ at: [3, 64, 0] }], lavaCauldrons: [[-3, 64, 0]] });
    assert.equal(await t.smeltItem(t.bot, 'sand', 8), true, t.said());
    assert.match(t.said(), /lava in the cauldron at -3, 64, 0, but I have no empty bucket for it/);
    assert.equal(t.bag.coal ?? 0, 0);
});

test('a load on lava: collecting counts the lava still burning, adds no coal, and takes the bucket out', async () => {
    const t = setup({ inventory: { sand: 64, coal: 8, bucket: 1 }, furnaces: [{ at: [3, 64, 0] }], lavaCauldrons: [[-3, 64, 0]] });
    assert.equal(await t.loadFurnace(t.bot, 'sand', 64), true, t.said());
    assert.match(t.said(), /put 64 sand and 1 lava_bucket in the furnace/);
    t.advance(200000);
    t.fresh();
    await t.collectFurnace(t.bot);
    assert.match(t.said(), /took 20 glass\. 44 sand still smelting/);
    assert.equal(t.bag.coal, 8, 'the lava still burning covers the rest');
    assert.equal(t.bag.bucket, 1, 'the empty bucket came out of the slot');
    t.advance(450000);
    await t.collectFurnace(t.bot);
    assert.equal(t.bag.glass, 64);
    assert.equal(t.book.at({ x: 3, y: 64, z: 0 }), null);
});
