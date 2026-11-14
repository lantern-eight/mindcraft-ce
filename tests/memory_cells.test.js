// SPDX-License-Identifier: CC0-1.0
// Cells: the exact copy of every block the bot has seen, per 16-block cube, saved in region files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { createCells, fileStorage, memoryStorage, OTHER_NAME } from '../src/agent/memory/cells.js';

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** Fills an inclusive box with one block name. */
function fill(cells, [x0, y0, z0], [x1, y1, z1], name) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells.write(x, y, z, name);
}

test('C1: a cell written is read back by name, and an unwritten cell reads as never seen', () => {
    const cells = createCells();
    assert.equal(cells.write(10, 64, -4, 'sand'), null, 'nothing was remembered there before');
    assert.equal(cells.read(10, 64, -4), 'sand');
    assert.equal(cells.read(11, 64, -4), null, 'the cell next to it was never seen');
    assert.equal(cells.read(5000, 10, 5000), null, 'nor was anything far away');

    assert.equal(cells.write(10, 64, -4, 'glass'), 'sand', 'writing says what was remembered before');
    assert.equal(cells.read(10, 64, -4), 'glass');
    assert.equal(cells.write(10, 64, -4, 'glass'), 'glass');

    // Negative coordinates and cube edges land in the right cells.
    cells.write(-1, -1, -1, 'stone');
    cells.write(-16, -16, -16, 'dirt');
    cells.write(-17, 0, 15, 'gravel');
    assert.equal(cells.read(-1, -1, -1), 'stone');
    assert.equal(cells.read(-16, -16, -16), 'dirt');
    assert.equal(cells.read(-17, 0, 15), 'gravel');
    assert.equal(cells.read(-17, 0, 16), null);
});

test('open air is only recorded where a block was remembered', () => {
    const cells = createCells();
    assert.equal(cells.write(0, 100, 0, 'air'), null);
    assert.equal(cells.read(0, 100, 0), null, 'air the bot looked through is not kept');
    assert.equal(cells.cubeSummary(0, 6, 0), null, 'and makes no cube');

    cells.write(3, 64, 3, 'furnace');
    assert.equal(cells.write(3, 64, 3, 'cave_air'), 'furnace', 'the furnace is seen to be gone');
    assert.equal(cells.read(3, 64, 3), 'air', 'and that is remembered: the cell was seen empty');
    assert.equal(cells.write(3, 64, 3, 'oak_planks'), 'air', 'so a block turning up there is known to be new');
});

test('C2: the summary of a cube matches its cells: counts, boxes and an example', () => {
    const cells = createCells();
    fill(cells, [0, 62, 0], [9, 63, 4], 'sand');           // 10 x 2 x 5 = 100
    fill(cells, [12, 60, 12], [13, 60, 12], 'sandstone');  // 2
    cells.write(7, 70, 7, 'oak_log');

    const { names } = cells.cubeSummary(0, 3, 0);          // y 48 to 63
    assert.equal(names.get('sand').count, 100);
    assert.deepEqual(names.get('sand').min, { x: 0, y: 62, z: 0 });
    assert.deepEqual(names.get('sand').max, { x: 9, y: 63, z: 4 });
    assert.equal(cells.read(...Object.values(names.get('sand').example)), 'sand');
    assert.equal(names.get('sandstone').count, 2);
    assert.equal(names.has('oak_log'), false, 'the log is in the cube above');

    // A change shows in the summary straight away.
    cells.write(0, 62, 0, 'glass');
    assert.equal(cells.cubeSummary(0, 3, 0).names.get('sand').count, 99);
    assert.notDeepEqual(cells.cubeSummary(0, 3, 0).names.get('sand').example, { x: 0, y: 62, z: 0 });
    fill(cells, [0, 62, 0], [9, 63, 0], 'glass');           // the whole z = 0 row goes
    assert.deepEqual(cells.cubeSummary(0, 3, 0).names.get('sand').min, { x: 0, y: 62, z: 1 });
    fill(cells, [0, 62, 0], [9, 63, 0], 'sand');
    cells.write(0, 62, 0, 'glass');

    // A box over several cubes adds whole cubes up and counts cell by cell where it cuts through one.
    fill(cells, [16, 62, 0], [19, 62, 0], 'sand');
    const beach = cells.boxSummary({ x: 0, y: 48, z: 0 }, { x: 31, y: 79, z: 15 });
    assert.equal(beach.get('sand').count, 103);
    assert.deepEqual(beach.get('sand').max, { x: 19, y: 63, z: 4 });
    assert.equal(beach.get('oak_log').count, 1);
    const part = cells.boxSummary({ x: 8, y: 62, z: 0 }, { x: 17, y: 62, z: 0 });
    assert.equal(part.get('sand').count, 4, 'x 8 and 9 in the first cube, 16 and 17 in the second');
    assert.equal(part.has('glass'), false);
});

test('C3: nearest sand is found through the index, across region files, without loading them all', () => {
    const storage = memoryStorage();
    const first = createCells({ storage });
    first.write(10, 64, 10, 'sand');
    first.write(500, 64, 0, 'sand');
    first.write(501, 64, 0, 'sand');
    first.write(-900, 70, 300, 'sand');
    for (let i = 0; i < 12; i++) first.write(200 + i * 70, 20, 200, 'stone'); // a dozen regions with no sand
    assert.equal(first.save(), 0);
    assert.equal(storage.files.size, 15);

    // A new session: nothing is in memory until it is asked for.
    const cells = createCells({ storage });
    assert.equal(cells.loadedRegions, 0);
    const [hit] = cells.nearest(['sand'], { x: 480, y: 64, z: 0 }, { maxDistance: 2000 });
    assert.deepEqual([hit.x, hit.y, hit.z, hit.name], [500, 64, 0, 'sand']);
    assert.equal(storage.loads, 1, 'only the one region that could hold the nearest sand was opened');

    const three = cells.nearest(['sand'], { x: 480, y: 64, z: 0 }, { maxDistance: 2000, limit: 3 });
    assert.deepEqual(three.map(h => h.x), [500, 501, 10]);
    assert.equal(cells.nearest(['sand'], { x: 480, y: 64, z: 0 }, { maxDistance: 100, limit: 9 }).length, 2);
    assert.equal(cells.nearest(['diamond_ore'], { x: 0, y: 0, z: 0 }, { maxDistance: 5000 }).length, 0);
    assert.equal(storage.loads <= 3, true, 'and never the stone-only regions');

    // If the index is lost, the region files are still found; it only costs opening them.
    storage.loseIndex();
    const rebuilt = createCells({ storage });
    assert.equal(rebuilt.nearest(['sand'], { x: -890, y: 70, z: 300 }, { maxDistance: 100 })[0].x, -900);
});

test('C3b: only a few regions stay in memory, and one pushed out is written first', () => {
    const storage = memoryStorage();
    const cells = createCells({ storage, maxLoadedRegions: 2 });
    for (let i = 0; i < 6; i++) cells.write(i * 64, 0, 0, `block_${i}`);
    assert.equal(cells.loadedRegions, 2);
    assert.equal(storage.files.size, 4, 'the four pushed out were saved on the way');
    for (let i = 0; i < 6; i++) assert.equal(cells.read(i * 64, 0, 0), `block_${i}`);
});

test('C4: a cube with more block names than fit in a byte still works', () => {
    const cells = createCells();
    for (let i = 0; i < 300; i++) cells.write(i % 16, (i >> 4) % 16, i >> 8, `block_${i}`);
    assert.equal(cells.read(0, 0, 0), 'block_0');
    assert.equal(cells.read(12, 15, 0), 'block_252', 'the 253rd name still has its own entry');
    assert.equal(cells.read(13, 15, 0), OTHER_NAME, 'the rest share one');
    const { names } = cells.cubeSummary(0, 0, 0);
    assert.equal(names.get(OTHER_NAME).count, 47);
    assert.equal(names.size, 254);
    assert.equal(cells.nearest([OTHER_NAME], { x: 0, y: 0, z: 0 }, { limit: 100 }).length, 47);

    // Names nothing uses any more make room again. The very first write finds the list still full,
    // so that one cell shares "other"; it frees a name, and every write after it fits.
    for (let i = 0; i < 300; i++) cells.write(i % 16, (i >> 4) % 16, i >> 8, 'stone');
    assert.equal(cells.read(0, 0, 0), OTHER_NAME);
    assert.equal(cells.write(1, 0, 0, 'brand_new'), 'stone');
    assert.equal(cells.read(1, 0, 0), 'brand_new');
    assert.equal(cells.cubeSummary(0, 0, 0).names.get('stone').count, 298);
    assert.equal(cells.cubeSummary(0, 0, 0).names.size, 3);
});

test('C5: cells survive a save and a load, and a damaged region file is set aside', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cells-'));
    const now = clock();
    const cells = createCells({ storage: fileStorage(dir), now });
    fill(cells, [0, 62, 0], [9, 63, 4], 'sand');
    cells.write(3, 64, 3, 'furnace');
    cells.write(3, 64, 3, 'air');
    cells.write(300, 12, -40, 'diamond_ore');
    cells.markLooked(0, 3, 0, 7);
    cells.markLooked(0, 9, 0, 7);                 // a cube of open sky: looked through, nothing in it
    cells.tag(1, 62, 1, 'placed');
    assert.equal(cells.dirty, true);
    cells.save();
    assert.equal(cells.dirty, false);
    assert.deepEqual(readdirSync(dir).sort(), ['index.json', 'r.0.0.0.bin', 'r.0.1.0.bin', 'r.0.2.0.bin', 'r.4.0.-1.bin']);

    const warnings = [];
    const open = () => createCells({ storage: fileStorage(dir, { warn: message => warnings.push(message) }), now });
    const loaded = open();
    assert.equal(loaded.read(9, 63, 4), 'sand');
    assert.equal(loaded.read(3, 64, 3), 'air');
    assert.equal(loaded.read(300, 12, -40), 'diamond_ore');
    assert.equal(loaded.cubeSummary(0, 3, 0).names.get('sand').count, 100);
    assert.equal(loaded.lookedAt(0, 3, 0), 1_000_000);
    assert.equal(loaded.wasLookedFrom(0, 3, 0, 7), true);
    assert.equal(loaded.wasLookedFrom(0, 3, 0, 8), false);
    assert.equal(loaded.wasLookedFrom(0, 9, 0, 7), true, 'the empty cube remembers being looked through');
    assert.equal(loaded.read(0, 150, 0), null);
    assert.equal(loaded.tagOf(1, 62, 1), 'placed');
    assert.equal(loaded.tagOf(2, 62, 1), null);
    assert.equal(loaded.dirty, false, 'reading changes nothing');

    // Terrain packs small: a hundred sand blocks and a few others in well under a kilobyte.
    assert.equal(readFileSync(path.join(dir, 'r.0.0.0.bin')).length < 400, true);

    // One file is damaged. That region starts empty; the others are untouched.
    writeFileSync(path.join(dir, 'r.0.0.0.bin'), 'not a region file');
    const damaged = open();
    assert.equal(damaged.read(9, 63, 4), null);
    assert.equal(damaged.read(300, 12, -40), 'diamond_ore');
    assert.equal(warnings.length, 1);
    assert.equal(readdirSync(dir).some(name => name.startsWith('r.0.0.0.bin.damaged-')), true);
    damaged.write(9, 63, 4, 'sand');           // and it can be written again
    damaged.save();
    assert.equal(open().read(9, 63, 4), 'sand');
});

test('C6: only names are saved, so a file loads under a game version whose numbers differ', () => {
    // Two game versions number the same blocks differently. The recorder turns numbers into names
    // before they reach the store, so the store never sees a number.
    const oldVersion = { 1: 'stone', 2: 'oak_door', 3: 'chest' };
    const newVersion = { 1: 'stone', 2: 'pale_oak_door', 3: 'oak_door', 4: 'chest' };
    const storage = memoryStorage();
    const before = createCells({ storage });
    [[0, 1], [1, 2], [2, 3]].forEach(([x, id]) => before.write(x, 64, 0, oldVersion[id]));
    before.save();

    const header = (() => {
        const raw = inflateSync(storage.files.get('0,1,0'));
        return JSON.parse(raw.subarray(4, 4 + raw.readUInt32LE(0)).toString());
    })();
    assert.deepEqual(header.cubes[0].names, ['stone', 'oak_door', 'chest']);

    const after = createCells({ storage });
    const idOf = name => Number(Object.entries(newVersion).find(([, n]) => n === name)[0]);
    assert.equal(idOf(after.read(1, 64, 0)), 3, 'the door is still a door, under its new number');
    assert.equal(idOf(after.read(2, 64, 0)), 4);
});

test('a cube remembers the last few places it was looked over from', () => {
    const now = clock();
    const cells = createCells({ now });
    cells.write(0, 0, 0, 'stone');
    assert.equal(cells.lookedAt(0, 0, 0), 0);
    for (const crumb of [1, 2, 3, 4, 5]) { now.advance(1000); cells.markLooked(0, 0, 0, crumb); }
    assert.equal(cells.wasLookedFrom(0, 0, 0, 1), false, 'the oldest of five is forgotten');
    assert.equal(cells.wasLookedFrom(0, 0, 0, 2), true);
    assert.equal(cells.wasLookedFrom(0, 0, 0, 5), true);
    assert.equal(cells.lookedAt(0, 0, 0), 1_005_000);
    assert.equal(cells.wasLookedFrom(3, 3, 3, 5), false);
});

test('eachCell walks what is remembered in a cube', () => {
    const cells = createCells();
    cells.write(17, 5, 33, 'stone');
    cells.write(18, 5, 33, 'chest');
    cells.write(18, 5, 33, 'air');
    const seen = [];
    cells.eachCell(1, 0, 2, (x, y, z, name) => seen.push(`${x},${y},${z}=${name}`));
    assert.deepEqual(seen, ['17,5,33=stone', '18,5,33=air']);
    cells.eachCell(9, 9, 9, () => assert.fail('nothing is remembered there'));
});
