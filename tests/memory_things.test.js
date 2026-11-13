// SPDX-License-Identifier: CC0-1.0
// Things: the single objects the bot knows exactly (chests and their contents, doors, beds, ores...),
// plus the crops and animals it has seen per area. Also kinds.js, which decides what is a thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createThings, loadThings } from '../src/agent/memory/things.js';
import { changesByItself, isCrop, isHerdAnimal, isRipe, kindOf, partnerOffset, startsPlace } from '../src/agent/memory/kinds.js';

const SCOPE = 'local:55916/w1/overworld';
const HERE = { x: 0, y: 64, z: 0 };

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

// ---- K1: what the seen-world map did, things do too ----

test('K1: a thing seen once is remembered after walking away, with when and from where', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    const { thing, isNew } = things.see({ x: 10.7, y: 63, z: -3.2 }, 'furnace', { state: { facing: 'north', lit: 'false' }, from: 12, day: 3 });
    assert.equal(isNew, true);
    assert.equal(thing.kind, 'container');
    now.advance(60_000);
    const [hit] = things.nearest(['furnace'], HERE);
    assert.deepEqual([hit.x, hit.y, hit.z], [10, 63, -4]);
    assert.equal(hit.lastSeen, 1_000_000);
    assert.equal(hit.provenance, 'observed');
    assert.equal(hit.from, 12, 'the crumb to walk back to');
    assert.equal(hit.day, 3);
    assert.deepEqual(hit.state, { facing: 'north', lit: 'false' });
    assert.equal(things.see({ x: 10, y: 63, z: -4 }, 'furnace').isNew, false);
    assert.equal(things.get(10, 63, -4).from, 12, 'seeing it again without a crumb keeps the old one');
});

test('K1: nearest sorts by distance, respects limit and maximum distance, and filters by kind', () => {
    const things = createThings({ scope: SCOPE, now: clock() });
    things.see({ x: 30, y: 64, z: 0 }, 'chest');
    things.see({ x: 5, y: 64, z: 0 }, 'barrel');
    things.see({ x: 12, y: 64, z: 0 }, 'chest');
    things.see({ x: 8, y: 64, z: 0 }, 'oak_door');
    assert.deepEqual(things.nearest(['chest', 'barrel'], HERE, { limit: 10 }).map(t => t.x), [5, 12, 30]);
    assert.deepEqual(things.nearest(['chest'], HERE, { maxDistance: 20, limit: 10 }).map(t => t.x), [12]);
    assert.deepEqual(things.nearest(null, HERE, { kinds: ['container'], limit: 10 }).map(t => t.x), [5, 12, 30]);
    assert.deepEqual(things.nearest(null, HERE, { kinds: ['passage'] }).map(t => t.name), ['oak_door']);
    assert.equal(things.nearest(['diamond_ore'], HERE).length, 0);
    assert.equal(things.list({ kinds: ['container'] }).length, 3);
});

test('K1: a thing that changes out of sight is still remembered; looking again marks it gone', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    things.see({ x: 3, y: 64, z: 3 }, 'furnace');
    assert.equal(things.nearest(['furnace'], HERE).length, 1, 'nobody told the bot it was broken');
    now.advance(5_000);
    const corrected = things.seeCell({ x: 3, y: 64, z: 3 }, 'air');
    assert.equal(corrected.provenance, 'gone');
    assert.equal(corrected.goneAt, 1_005_000);
    assert.equal(things.nearest(['furnace'], HERE).length, 0, 'gone things are not offered as targets');
    assert.equal(things.nearest(['furnace'], HERE, { includeGone: true }).length, 1);
    assert.equal(things.count('furnace'), 0);
    assert.equal(things.seeCell({ x: 9, y: 9, z: 9 }, 'air'), null, 'nothing was remembered there');

    // It is rebuilt and seen again.
    const back = things.see({ x: 3, y: 64, z: 3 }, 'furnace');
    assert.equal(back.isNew, true);
    assert.equal(back.thing.provenance, 'observed');
    assert.equal(back.thing.goneAt, undefined);
});

test('K1: seeing the same thing again refreshes it; seeing something else there replaces it', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    things.see({ x: 1, y: 2, z: 3 }, 'chest');
    now.advance(1000);
    things.seeCell({ x: 1, y: 2, z: 3 }, 'chest');
    assert.equal(things.get(1, 2, 3).lastSeen, 1_001_000);
    assert.equal(things.get(1, 2, 3).firstSeen, 1_000_000);
    things.see({ x: 1, y: 2, z: 3 }, 'barrel');
    assert.equal(things.get(1, 2, 3).name, 'barrel');
    assert.equal(things.count('chest'), 0);
    assert.equal(things.count('barrel'), 1);
    assert.equal(things.size, 1);
});

test('K1: reported things are kept apart from seen ones until the bot sees them', () => {
    const things = createThings({ scope: SCOPE, now: clock() });
    things.report({ x: 100, y: 70, z: 100 }, 'chest', 'Alex');
    assert.equal(things.nearest(['chest'], HERE).length, 0, 'not a target by default: unverified');
    const [told] = things.nearest(['chest'], HERE, { includeReported: true });
    assert.equal(told.provenance, 'reported');
    assert.equal(told.reportedBy, 'Alex');
    assert.equal(things.see({ x: 100, y: 70, z: 100 }, 'chest').isNew, true);
    assert.equal(things.get(100, 70, 100).provenance, 'observed');
    assert.equal(things.nearest(['chest'], HERE).length, 1);
});

test('K1: box queries work across negative coordinates, and caps drop the oldest first', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now, maxPerName: 3 });
    for (const x of [-17, -1, 16]) for (const z of [-17, 0, 31]) things.see({ x, y: 64, z }, 'chest');
    // Nine chests, over the cap of three: only the three seen last are kept.
    assert.equal(things.count('chest') <= 4, true);
    const uncapped = createThings({ scope: SCOPE, now });
    for (const x of [-17, -1, 16]) for (const z of [-17, 0, 31]) uncapped.see({ x, y: 64, z }, 'chest');
    uncapped.see({ x: 0, y: 64, z: 5 }, 'crafting_table');
    const near = uncapped.within({ x: -2, y: 0, z: -1 }, { x: 16, y: 100, z: 31 });
    assert.deepEqual(near.map(t => `${t.x},${t.z}`).sort(), ['-1,0', '-1,31', '0,5', '16,0', '16,31']);
    assert.deepEqual(uncapped.within({ x: -2, y: 0, z: -1 }, { x: 16, y: 100, z: 31 }, { names: ['crafting_table'] }).map(t => t.x), [0]);
    assert.equal(uncapped.within({ x: -1000, y: 0, z: -1000 }, { x: 1000, y: 100, z: 1000 }, { kinds: ['container'] }).length, 9);

    for (let i = 0; i < 5; i++) { things.see({ x: 100 + i, y: 64, z: 0 }, 'iron_ore'); now.advance(1000); }
    assert.equal(things.count('iron_ore'), 3);
    assert.deepEqual(things.nearest(['iron_ore'], { x: 100, y: 64, z: 0 }, { limit: 10 }).map(t => t.x).sort(), [102, 103, 104]);
});

test('K1: things save and load per scope, a different world starts empty, and a damaged file is set aside', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'things-'));
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    things.see({ x: 10, y: 63, z: -4 }, 'oak_door', { state: { half: 'lower', open: 'true' }, from: 4 });
    things.see({ x: 2, y: 64, z: 2 }, 'chest');
    things.setContents({ x: 2, y: 64, z: 2 }, [{ name: 'iron_ingot', count: 12 }], { freeSlots: 26, slots: 27 });
    things.report({ x: 1, y: 2, z: 3 }, 'chest', 'Alex');
    things.seeCell({ x: 10, y: 63, z: -4 }, 'air');
    things.recordBiome({ x: 200, z: 40 }, 'beach');
    things.setField(0, 4, 0, 'wheat', { count: 12, ripe: 5, min: { x: 0, y: 64, z: 0 }, max: { x: 3, y: 64, z: 2 } });
    things.setHerds(1, 4, 0, [{ kind: 'cow', count: 4, x: 20, y: 64, z: 3 }]);
    assert.equal(things.dirty, true);
    things.save(dir);
    assert.equal(things.dirty, false);

    const loaded = loadThings(dir, { scope: SCOPE, now });
    assert.equal(loaded.size, 3);
    assert.deepEqual(loaded.get(10, 63, -4), things.get(10, 63, -4));
    assert.equal(loaded.get(10, 63, -4).provenance, 'gone');
    assert.equal(loaded.findItem('iron_ingot', HERE)[0].total, 12, 'contents are searchable after a load');
    assert.equal(loaded.nearestBiome('beach', HERE).x, 200);
    assert.equal(loaded.nearestBiome('desert', HERE), null);
    assert.equal(loaded.fieldsNear(HERE)[0].ripe, 5);
    assert.equal(loaded.herdsNear(HERE)[0].count, 4);

    assert.equal(loadThings(mkdtempSync(path.join(tmpdir(), 'things-')), { scope: SCOPE, now }).size, 0);

    // The same folder read for another world: the file is not this world's, so it is not used.
    const warnings = [];
    const original = console.warn;
    console.warn = message => warnings.push(message);
    try {
        writeFileSync(path.join(dir, 'things.json'), '{"version":1,');
        assert.equal(loadThings(dir, { scope: SCOPE, now }).size, 0);
    } finally { console.warn = original; }
    assert.equal(warnings.length, 1);
});

// ---- K2: two-block things ----

test('K2: a double chest is one thing, and opening either half updates the same contents', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    const left = { x: 5, y: 64, z: 5 }, right = { x: 6, y: 64, z: 5 };
    things.see(left, 'chest', { state: { facing: 'north', type: 'left' }, partner: right });
    const second = things.see(right, 'chest', { state: { facing: 'north', type: 'right' }, partner: left });
    assert.equal(second.isNew, false, 'the other half of a chest it already knows');
    assert.equal(things.size, 1);
    assert.equal(things.count('chest'), 1);
    assert.deepEqual(things.get(6, 64, 5).also, { x: 6, y: 64, z: 5 });
    assert.equal(things.get(6, 64, 5).x, 5, 'either cell gives the one chest');

    things.setContents(right, [{ name: 'cobblestone', count: 64 }, { name: 'cobblestone', count: 20 }, { name: 'torch', count: 3 }], { freeSlots: 51, slots: 54 });
    assert.deepEqual(things.get(5, 64, 5).contents.items, { cobblestone: 84, torch: 3 });
    now.advance(5000);
    things.setContents(left, [{ name: 'torch', count: 3 }], { freeSlots: 53, slots: 54 });
    assert.deepEqual(things.get(6, 64, 5).contents.items, { torch: 3 });
    assert.equal(things.get(6, 64, 5).contents.at, 1_005_000);
    assert.equal(things.findItem('cobblestone', HERE).length, 0, 'the cobblestone was taken out');

    // Either half seen to be gone means the chest is gone.
    assert.equal(things.seeCell(right, 'air').provenance, 'gone');
    assert.equal(things.count('chest'), 0);

    // Two single chests side by side stay two things.
    things.see({ x: 20, y: 64, z: 0 }, 'chest', { state: { facing: 'north', type: 'single' } });
    things.see({ x: 21, y: 64, z: 0 }, 'chest', { state: { facing: 'north', type: 'single' } });
    assert.equal(things.count('chest'), 2);
    assert.equal(things.setContents({ x: 50, y: 64, z: 0 }, []), null, 'no container is remembered there');
});

test('K2: kinds.js says where the other half of a chest, a bed and a door is', () => {
    // A chest facing north has its front to the north; the half marked left has its partner to the east.
    assert.deepEqual(partnerOffset('chest', { facing: 'north', type: 'left' }), { x: 1, y: 0, z: 0 });
    assert.deepEqual(partnerOffset('chest', { facing: 'north', type: 'right' }), { x: -1, y: 0, z: 0 });
    assert.deepEqual(partnerOffset('trapped_chest', { facing: 'east', type: 'left' }), { x: 0, y: 0, z: 1 });
    assert.equal(partnerOffset('chest', { facing: 'north', type: 'single' }), null);
    assert.equal(partnerOffset('barrel', { facing: 'north' }), null);
    assert.deepEqual(partnerOffset('red_bed', { facing: 'south', part: 'foot' }), { x: 0, y: 0, z: 1 });
    assert.deepEqual(partnerOffset('red_bed', { facing: 'south', part: 'head' }), { x: 0, y: 0, z: -1 });
    assert.deepEqual(partnerOffset('oak_door', { half: 'lower', facing: 'east' }), { x: 0, y: 1, z: 0 });
    assert.deepEqual(partnerOffset('iron_door', { half: 'upper' }), { x: 0, y: -1, z: 0 });
    assert.equal(partnerOffset('chest', null), null);
});

test('kinds go by name pattern, so a block from a newer game version needs no change', () => {
    assert.equal(kindOf('chest'), 'container');
    assert.equal(kindOf('purple_shulker_box'), 'container');
    assert.equal(kindOf('crafting_table'), 'workstation');
    assert.equal(kindOf('chipped_anvil'), 'workstation');
    assert.equal(kindOf('some_future_wood_door'), 'passage');
    assert.equal(kindOf('some_future_wood_fence_gate'), 'passage');
    assert.equal(kindOf('some_future_wood_wall_hanging_sign'), 'sign');
    assert.equal(kindOf('white_bed'), 'bed');
    assert.equal(kindOf('deepslate_some_future_ore'), 'ore');
    assert.equal(kindOf('ancient_debris'), 'ore');
    assert.equal(kindOf('nether_portal'), 'portal');
    assert.equal(kindOf('stone'), null);
    assert.equal(kindOf('bedrock'), null, 'not a bed');
    assert.equal(startsPlace('container'), true);
    assert.equal(startsPlace('ore'), false);
    assert.equal(isCrop('wheat'), true);
    assert.equal(isRipe('wheat', { age: '7' }), true);
    assert.equal(isRipe('wheat', { age: 3 }), false);
    assert.equal(isRipe('beetroots', { age: 3 }), true);
    assert.equal(isRipe('wheat', null), false);
    assert.equal(changesByItself('oak_leaves'), true);
    assert.equal(changesByItself('wheat'), true);
    assert.equal(changesByItself('water'), true);
    assert.equal(changesByItself('oak_planks'), false);
    assert.equal(changesByItself('chest'), false);
    assert.equal(isHerdAnimal('cow'), true);
    assert.equal(isHerdAnimal('zombie'), false);
});

// ---- K3: where is the iron? ----

test('K3: "where is iron?" answers from container contents, nearest first, with the age of each look', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    things.see({ x: 40, y: 64, z: 0 }, 'chest', { from: 9 });
    things.see({ x: 4, y: 64, z: 0 }, 'barrel', { from: 2 });
    things.see({ x: 10, y: 64, z: 0 }, 'chest');
    things.setContents({ x: 40, y: 64, z: 0 }, [{ name: 'iron_ingot', count: 30 }, { name: 'raw_iron', count: 9 }]);
    now.advance(3_600_000);
    things.setContents({ x: 4, y: 64, z: 0 }, [{ name: 'iron_pickaxe', count: 1 }, { name: 'bread', count: 6 }]);
    things.setContents({ x: 10, y: 64, z: 0 }, [{ name: 'oak_log', count: 64 }]);

    const iron = things.findItem('iron', HERE);
    assert.deepEqual(iron.map(hit => hit.x), [4, 40], 'nearest first, and only chests holding some');
    assert.deepEqual(iron[1].items, { iron_ingot: 30, raw_iron: 9 });
    assert.equal(iron[1].total, 39);
    assert.equal(iron[1].from, 9, 'with the crumb to walk to');
    assert.equal(now() - iron[1].lookedAt, 3_600_000, 'that look was an hour ago');
    assert.equal(iron[0].lookedAt, now());

    // An exact item name means that item only.
    assert.deepEqual(things.findItem('iron_ingot', HERE).map(hit => hit.x), [40]);
    assert.deepEqual(things.findItem('Iron Ingot', HERE).map(hit => hit.x), [40]);
    assert.equal(things.findItem('diamond', HERE).length, 0);

    // A chest that is gone is no place to send anyone.
    things.seeCell({ x: 40, y: 64, z: 0 }, 'air');
    assert.deepEqual(things.findItem('iron', HERE).map(hit => hit.x), [4]);
});

// ---- K4: fields and herds ----

test('K4: a field keeps its count and ripe count, and a herd is replaced when its cube is seen again', () => {
    const now = clock();
    const things = createThings({ scope: SCOPE, now });
    const box = { min: { x: 0, y: 64, z: 0 }, max: { x: 7, y: 64, z: 3 } };
    things.setField(0, 4, 0, 'wheat', { count: 32, ripe: 0, ...box }, { from: 5, day: 1 });
    things.setField(0, 4, 0, 'carrots', { count: 8, ripe: 8, min: { x: 9, y: 64, z: 0 }, max: { x: 9, y: 64, z: 7 } });
    things.setField(6, 4, 6, 'wheat', { count: 3, ripe: 3 });
    let [wheat] = things.fieldsNear(HERE, { crop: 'wheat' });
    assert.deepEqual([wheat.count, wheat.ripe, wheat.from, wheat.day], [32, 0, 5, 1]);
    assert.deepEqual([wheat.x, wheat.z], [3.5, 1.5], 'the middle of the field');
    assert.equal(things.fieldsNear(HERE).length, 3);
    assert.equal(things.fieldsNear(HERE, { maxDistance: 30 }).length, 2);

    now.advance(86_400_000);
    things.setField(0, 4, 0, 'wheat', { count: 32, ripe: 30, ...box }, { from: 5, day: 2 }); // looked again: it grew
    [wheat] = things.fieldsNear(HERE, { crop: 'wheat' });
    assert.deepEqual([wheat.ripe, wheat.day, wheat.lastSeen], [30, 2, now()]);
    things.setField(0, 4, 0, 'carrots', { count: 0 });                                      // harvested and not replanted
    assert.equal(things.fieldsNear(HERE, { crop: 'carrots' }).length, 0);

    things.setHerds(1, 4, 0, [{ kind: 'cow', count: 4, x: 20, y: 64, z: 3 }, { kind: 'sheep', count: 2, x: 24, y: 64, z: 6 }], { from: 7 });
    things.setHerds(9, 4, 9, [{ kind: 'cow', count: 1, x: 150, y: 64, z: 150 }]);
    assert.deepEqual(things.herdsNear(HERE, { kind: 'cow' }).map(h => h.count), [4, 1]);
    assert.equal(things.herdsNear(HERE)[0].from, 7);
    things.setHerds(1, 4, 0, [{ kind: 'cow', count: 3, x: 21, y: 64, z: 3 }]);             // a cow and the sheep are gone
    assert.deepEqual(things.herdsNear(HERE, { maxDistance: 50 }).map(h => `${h.kind} ${h.count}`), ['cow 3']);
    things.setHerds(1, 4, 0, []);
    assert.equal(things.herdsNear(HERE, { maxDistance: 50 }).length, 0);
});
