// Seen-world map: what the bot has actually seen, remembered the way a player remembers it.
//
// It is the fair-play replacement for "search every loaded block" (the bot can only go back to sand it
// saw), and it is place memory for free ("the beach is over there") without the model having to decide
// to save anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSeenMap, loadSeenMap, seenMapFile } from '../src/agent/fairplay/seen_map.js';

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

test('M1: a block seen once is remembered after walking away, with when it was seen', () => {
    const now = clock();
    const map = createSeenMap({ scope: 'local:55916/w1/overworld', now });
    map.observeBlock({ x: 10, y: 63, z: -4 }, 'sand');
    now.advance(60_000);
    const [hit] = map.nearest(['sand'], { x: 0, y: 64, z: 0 });
    assert.equal(hit.name, 'sand');
    assert.deepEqual([hit.x, hit.y, hit.z], [10, 63, -4]);
    assert.equal(hit.lastSeen, 1_000_000);
    assert.equal(hit.provenance, 'observed');
});

test('nearest sorts by distance, respects the limit and maximum distance, and takes several types', () => {
    const map = createSeenMap({ scope: 's', now: clock() });
    map.observeBlock({ x: 30, y: 64, z: 0 }, 'sand');
    map.observeBlock({ x: 5, y: 64, z: 0 }, 'red_sand');
    map.observeBlock({ x: 12, y: 64, z: 0 }, 'sand');
    const all = map.nearest(['sand', 'red_sand'], { x: 0, y: 64, z: 0 }, { limit: 10 });
    assert.deepEqual(all.map(e => e.x), [5, 12, 30]);
    assert.deepEqual(map.nearest(['sand'], { x: 0, y: 64, z: 0 }, { maxDistance: 20, limit: 10 }).map(e => e.x), [12]);
    assert.equal(map.nearest(['diamond_ore'], { x: 0, y: 64, z: 0 }).length, 0);
});

test('M2: a block that changes out of sight is still remembered; looking again marks it gone', () => {
    const now = clock();
    const map = createSeenMap({ scope: 's', now });
    map.observeBlock({ x: 3, y: 64, z: 3 }, 'furnace');
    // Someone breaks the furnace while the bot is elsewhere: the map can't know, just like a person.
    assert.equal(map.nearest(['furnace'], { x: 0, y: 64, z: 0 }).length, 1);
    now.advance(5_000);
    map.observeCell({ x: 3, y: 64, z: 3 }, 'air'); // the bot looks at that spot again
    assert.equal(map.nearest(['furnace'], { x: 0, y: 64, z: 0 }).length, 0, 'gone furnaces are not offered as targets');
    const gone = map.get(3, 64, 3);
    assert.equal(gone.provenance, 'gone');
    assert.equal(gone.goneAt, 1_005_000);
    assert.equal(map.nearest(['furnace'], { x: 0, y: 64, z: 0 }, { includeGone: true }).length, 1);
});

test('seeing the same block again just refreshes it; seeing something else there replaces it', () => {
    const now = clock();
    const map = createSeenMap({ scope: 's', now });
    map.observeBlock({ x: 1, y: 2, z: 3 }, 'chest');
    now.advance(1000);
    map.observeCell({ x: 1, y: 2, z: 3 }, 'chest');
    assert.equal(map.get(1, 2, 3).lastSeen, 1_001_000);
    assert.equal(map.get(1, 2, 3).firstSeen, 1_000_000);
    map.observeBlock({ x: 1, y: 2, z: 3 }, 'barrel');
    assert.equal(map.get(1, 2, 3).name, 'barrel');
    assert.equal(map.count('chest'), 0);
    assert.equal(map.count('barrel'), 1);
});

test('reported places are kept apart from observed ones until the bot sees them', () => {
    const map = createSeenMap({ scope: 's', now: clock() });
    map.report({ x: 100, y: 70, z: 100 }, 'sand', 'Alex');
    assert.equal(map.nearest(['sand'], { x: 0, y: 64, z: 0 }).length, 0, 'not a target by default: unverified');
    const [told] = map.nearest(['sand'], { x: 0, y: 64, z: 0 }, { includeReported: true });
    assert.equal(told.provenance, 'reported');
    assert.equal(told.reportedBy, 'Alex');
    map.observeBlock({ x: 100, y: 70, z: 100 }, 'sand');
    assert.equal(map.get(100, 70, 100).provenance, 'observed');
    assert.equal(map.nearest(['sand'], { x: 0, y: 64, z: 0 }).length, 1);
});

test('within() lists remembered blocks in a box', () => {
    const map = createSeenMap({ scope: 's', now: clock() });
    map.observeBlock({ x: 0, y: 64, z: 0 }, 'crafting_table');
    map.observeBlock({ x: 4, y: 64, z: 4 }, 'chest');
    map.observeBlock({ x: 40, y: 64, z: 40 }, 'chest');
    const inside = map.within({ x: -2, y: 60, z: -2 }, { x: 8, y: 70, z: 8 });
    assert.deepEqual(inside.map(e => e.name).sort(), ['chest', 'crafting_table']);
    assert.deepEqual(map.within({ x: -2, y: 60, z: -2 }, { x: 8, y: 70, z: 8 }, ['chest']).map(e => e.x), [4]);
});

test('box queries work across column borders and negative coordinates', () => {
    const map = createSeenMap({ scope: 's', now: clock() });
    // One block in each of nine 16x16 columns around the origin, plus one far away.
    for (const x of [-17, -1, 16]) for (const z of [-17, 0, 31]) map.observeBlock({ x, y: 64, z }, 'chest');
    map.observeBlock({ x: 400, y: 64, z: 400 }, 'chest');
    const near = map.within({ x: -2, y: 0, z: -1 }, { x: 16, y: 100, z: 31 });
    assert.deepEqual(near.map(e => `${e.x},${e.z}`).sort(), ['-1,0', '-1,31', '16,0', '16,31']);
    assert.equal(map.within({ x: -1000, y: 0, z: -1000 }, { x: 1000, y: 100, z: 1000 }).length, 10, 'a huge box still finds everything');
    assert.equal(map.size, 10);
});

test('a remembered block keeps the exact state it was seen in', () => {
    const now = clock();
    const map = createSeenMap({ scope: 's', now });
    map.observeBlock({ x: 3, y: 64, z: 3 }, 'wheat', 'observed', 4321);
    assert.equal(map.get(3, 64, 3).stateId, 4321);
    map.observeBlock({ x: 3, y: 64, z: 3 }, 'wheat'); // seen again by a caller that doesn't know the state
    assert.equal(map.get(3, 64, 3).stateId, 4321, 'the known state is kept');
    map.observeCell({ x: 3, y: 64, z: 3 }, 'wheat', 4328); // looked again: the crop has grown
    assert.equal(map.get(3, 64, 3).stateId, 4328);
    const dir = mkdtempSync(path.join(tmpdir(), 'seen-state-'));
    map.save(dir);
    assert.equal(loadSeenMap(dir, 's', { now }).get(3, 64, 3).stateId, 4328);
});

test('per-type caps drop the least recently seen entries first', () => {
    const now = clock();
    const map = createSeenMap({ scope: 's', now, maxPerType: 3 });
    for (let i = 0; i < 5; i++) { map.observeBlock({ x: i, y: 64, z: 0 }, 'oak_log'); now.advance(1000); }
    assert.equal(map.count('oak_log'), 3);
    assert.deepEqual(map.nearest(['oak_log'], { x: 0, y: 64, z: 0 }, { limit: 10 }).map(e => e.x).sort(), [2, 3, 4]);
});

test('explored sections and biome samples are remembered at coarse resolution', () => {
    const now = clock();
    const map = createSeenMap({ scope: 's', now });
    map.markExplored({ x: 17, y: 70, z: -1 });
    assert.equal(map.isExplored({ x: 31, y: 64, z: -16 }), true, 'same 16x16x16 section');
    assert.equal(map.isExplored({ x: 32, y: 64, z: -16 }), false);
    map.recordBiome({ x: 200, z: 40 }, 'beach');
    map.recordBiome({ x: -50, z: 0 }, 'plains');
    const beach = map.nearestBiome('beach', { x: 0, y: 64, z: 0 });
    assert.equal(beach.name, 'beach');
    assert.ok(Math.abs(beach.x - 200) < 16 && Math.abs(beach.z - 40) < 16);
    assert.equal(map.nearestBiome('desert', { x: 0, y: 64, z: 0 }), null);
});

test('M3: the map saves and loads per scope; a different world gets an empty map', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'seen-map-'));
    const now = clock();
    const scope = 'localhost:55916/-123/overworld';
    const map = createSeenMap({ scope, now });
    map.observeBlock({ x: 10, y: 63, z: -4 }, 'sand');
    map.report({ x: 1, y: 2, z: 3 }, 'chest', 'Alex');
    map.markExplored({ x: 0, y: 64, z: 0 });
    map.recordBiome({ x: 0, z: 0 }, 'plains');
    map.save(dir);

    const file = seenMapFile(dir, scope);
    assert.ok(existsSync(file));
    assert.ok(!path.basename(file).includes(':') && !path.basename(file).includes('/'), 'scope is made safe for a file name');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).scope, scope);

    const loaded = loadSeenMap(dir, scope, { now });
    assert.equal(loaded.get(10, 63, -4).name, 'sand');
    assert.equal(loaded.get(1, 2, 3).provenance, 'reported');
    assert.equal(loaded.isExplored({ x: 5, y: 70, z: 5 }), true);
    assert.equal(loaded.nearestBiome('plains', { x: 0, y: 64, z: 0 }).name, 'plains');

    const otherWorld = loadSeenMap(dir, 'localhost:55916/-999/overworld', { now });
    assert.equal(otherWorld.count('sand'), 0);
    const nether = loadSeenMap(dir, 'localhost:55916/-123/the_nether', { now });
    assert.equal(nether.count('sand'), 0, 'dimensions are separate scopes');
});

test('a damaged map file is set aside instead of crashing startup', async () => {
    const fs = await import('node:fs');
    const dir = mkdtempSync(path.join(tmpdir(), 'seen-map-'));
    const scope = 's';
    const file = seenMapFile(dir, scope);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"version":1,"scope":"s","blocks":[[1,'); // a crash mid-write left junk
    const loaded = loadSeenMap(dir, scope, { now: clock() });
    assert.equal(loaded.count('sand'), 0);
    assert.ok(fs.readdirSync(path.dirname(file)).some(name => name.includes('.corrupt-')), 'the bad file is kept for inspection');
});
