// SPDX-License-Identifier: CC0-1.0
// Cells: an exact copy of every block the bot has seen, kept per 16-block cube.
//
// This is the bot's picture of the world. It answers "what did I see there?", "where is the nearest
// sand I know of?" and "what is in this area?" ("sand 400"), and because it keeps the cells themselves
// and not just counts, seeing a remembered cell hold something else is proof that the place changed,
// whichever side the bot looks from.
//
// How a cube is kept: one byte per cell.
//   0          never seen
//   1          seen to be empty. Only written where a block was remembered and is now gone; open air
//              the bot merely looked through is left at 0, since recording it would cost five times
//              the cubes for nothing
//   2 to 254   a block, as a position in the cube's own list of block names
//   255        "other": the cube already holds 253 different names (it never happens in a real world)
// A beach cube and a cube full of a house cost the same 4 KB in memory, and on disk each shrinks to
// what it holds: about 135 bytes for plain terrain.
//
// Only names are kept, never the game's numbers for blocks, which change with every game version. This
// store doesn't know the game exists: it is handed names and positions.
//
// On disk, cubes are grouped into region files of 4 x 4 x 4 cubes (64 blocks a side), loaded when
// something asks about that part of the world and written back when changed, so no file is large and
// nothing is rewritten whole. A small index says which regions hold which block names, so "nearest
// sand" opens only the regions that could hold the answer.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { readJsonFile, setAside, writeFileAtomic } from './files.js';

const FORMAT_VERSION = 1;
const VOLUME = 4096;      // cells in a cube
const NEVER = 0, EMPTY = 1, FIRST = 2, OTHER = 255;
const MAX_NAMES = OTHER - FIRST;
const MAX_FROM = 4;       // viewpoints remembered per cube
const LOOKED_SLACK_MS = 60_000;
const EMPTY_NAMES = new Set(['air', 'cave_air', 'void_air']);
export const AIR = 'air';
export const OTHER_NAME = 'other';

const cubeKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
const cellIndex = (x, y, z) => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);

/** Distance from a point to the nearest part of a box that starts at (x, y, z) and is `size` wide. */
function boxDistance(p, x, y, z, size) {
    const gap = (v, lo) => (v < lo ? lo - v : v > lo + size ? v - lo - size : 0);
    return Math.hypot(gap(p.x, x), gap(p.y, y), gap(p.z, z));
}

/**
 * @param {object} [options]
 * @param {object} [options.storage] - where regions are kept; see fileStorage and memoryStorage
 * @param {() => number} [options.now]
 * @param {number} [options.maxLoadedRegions] - regions held in memory; the least recently used is
 *   written back and dropped beyond this
 */
export function createCells({ storage = memoryStorage(), now = Date.now, maxLoadedRegions = 64 } = {}) {
    const regions = new Map();      // region key -> { key, cubes: Map, dirty, used }
    const regionNames = new Map();  // region key -> Set of block names in it (the index)
    const onDisk = new Set(storage.listRegions());
    let indexDirty = false;
    let uses = 0;
    let lastCube = null;            // most reads and writes land in the cube the one before did

    const savedIndex = storage.loadIndex();
    if (savedIndex?.version === FORMAT_VERSION) {
        for (const [key, names] of Object.entries(savedIndex.regions ?? {}))
            if (onDisk.has(key)) regionNames.set(key, new Set(names));
    }

    // ---- Cubes and regions ----

    function newCube(cx, cy, cz) {
        // `cells` stays null until a block is written. A cube of open air that the bot has looked
        // through is worth remembering ("I looked here and it was empty") but not worth 4 KB.
        return { cx, cy, cz, cells: null, names: [], nameIndex: new Map(), looked: 0, from: [], own: null, summary: null };
    }

    function getRegion(key, create) {
        let region = regions.get(key);
        if (!region) {
            if (onDisk.has(key)) region = loadRegion(key);
            else if (create) region = { key, cubes: new Map(), dirty: false, used: 0 };
            else return null;
            regions.set(key, region);
            if (!regionNames.has(key)) {
                // A region file the index didn't know about (the index was lost): list it now.
                const names = new Set();
                for (const cube of region.cubes.values()) for (const name of cube.names) names.add(name);
                regionNames.set(key, names);
                indexDirty = true;
            }
            if (regions.size > maxLoadedRegions) evictOne(region);
        }
        region.used = ++uses;
        return region;
    }

    function getCube(cx, cy, cz, create) {
        if (lastCube && lastCube.cx === cx && lastCube.cy === cy && lastCube.cz === cz) return lastCube;
        const region = getRegion(cubeKey(cx >> 2, cy >> 2, cz >> 2), create);
        if (!region) return null;
        const key = cubeKey(cx, cy, cz);
        let cube = region.cubes.get(key);
        if (!cube) {
            if (!create) return null;
            cube = newCube(cx, cy, cz);
            cube.region = region;
            region.cubes.set(key, cube);
        }
        lastCube = cube;
        return cube;
    }

    function touch(cube) {
        cube.summary = null;
        cube.region.dirty = true;
    }

    const nameOf = (cube, value) => (value === EMPTY ? AIR : value === OTHER ? OTHER_NAME : cube.names[value - FIRST]);

    function noteName(cube, name) {
        const names = regionNames.get(cube.region.key);
        if (!names.has(name)) { names.add(name); indexDirty = true; }
    }

    /** The byte for a block name in this cube, adding the name to the cube's list if it is new. */
    function valueFor(cube, name) {
        let value = cube.nameIndex.get(name);
        if (value !== undefined) return value;
        if (cube.names.length >= MAX_NAMES) dropUnusedNames(cube);
        if (cube.names.length >= MAX_NAMES) { noteName(cube, OTHER_NAME); return OTHER; }
        cube.names.push(name);
        value = cube.names.length - 1 + FIRST;
        cube.nameIndex.set(name, value);
        noteName(cube, name);
        return value;
    }

    // A cube's list of names only grows as blocks come and go. When it is full, names no cell uses any
    // more are dropped and the cells renumbered, before giving up and writing "other".
    function dropUnusedNames(cube) {
        const used = new Uint8Array(256);
        for (let i = 0; i < VOLUME; i++) used[cube.cells[i]] = 1;
        const renumber = new Uint8Array(256);
        renumber[EMPTY] = EMPTY; renumber[OTHER] = OTHER;
        const kept = [];
        cube.names.forEach((name, n) => {
            if (!used[n + FIRST]) return;
            kept.push(name);
            renumber[n + FIRST] = kept.length - 1 + FIRST;
        });
        if (kept.length === cube.names.length) return;
        for (let i = 0; i < VOLUME; i++) cube.cells[i] = renumber[cube.cells[i]];
        cube.names = kept;
        cube.nameIndex = new Map(kept.map((name, n) => [name, n + FIRST]));
    }

    /** Per block name in a cube: how many, the box they span, and one example cell. Cached until a write. */
    function summarise(cube) {
        if (cube.summary) return cube.summary;
        const summary = new Map();
        if (cube.cells) {
            const x0 = cube.cx * 16, y0 = cube.cy * 16, z0 = cube.cz * 16;
            const byValue = new Array(256);
            for (let i = 0; i < VOLUME; i++) {
                const value = cube.cells[i];
                if (value < FIRST) continue;
                const x = x0 + (i & 15), y = y0 + (i >> 8), z = z0 + ((i >> 4) & 15);
                const entry = byValue[value];
                if (!entry) { byValue[value] = { count: 1, min: { x, y, z }, max: { x, y, z }, example: { x, y, z } }; continue; }
                entry.count++;
                if (x < entry.min.x) entry.min.x = x; else if (x > entry.max.x) entry.max.x = x;
                if (z < entry.min.z) entry.min.z = z; else if (z > entry.max.z) entry.max.z = z;
                entry.max.y = y; // cells are walked from the bottom up, so the latest y is the highest
            }
            for (let value = FIRST; value < 256; value++) if (byValue[value]) summary.set(nameOf(cube, value), byValue[value]);
        }
        cube.summary = summary;
        return summary;
    }

    function addTo(total, name, entry) {
        const have = total.get(name);
        if (!have) { total.set(name, { count: entry.count, min: { ...entry.min }, max: { ...entry.max }, example: { ...entry.example } }); return; }
        have.count += entry.count;
        for (const axis of ['x', 'y', 'z']) {
            have.min[axis] = Math.min(have.min[axis], entry.min[axis]);
            have.max[axis] = Math.max(have.max[axis], entry.max[axis]);
        }
    }

    // ---- Saving and loading ----

    function encode(region) {
        const cubes = [...region.cubes.values()];
        const header = {
            version: FORMAT_VERSION,
            cubes: cubes.map(cube => ({
                at: [cube.cx, cube.cy, cube.cz], names: cube.names, looked: cube.looked, from: cube.from,
                ...(cube.cells ? {} : { hollow: true }),
                ...(cube.own?.size ? { own: [...cube.own] } : {}),
            })),
        };
        const head = Buffer.from(JSON.stringify(header));
        const length = Buffer.alloc(4);
        length.writeUInt32LE(head.length);
        return deflateSync(Buffer.concat([length, head, ...cubes.filter(cube => cube.cells).map(cube => cube.cells)]));
    }

    function decode(key, buffer) {
        const raw = inflateSync(buffer);
        const headLength = raw.readUInt32LE(0);
        const header = JSON.parse(raw.subarray(4, 4 + headLength).toString());
        if (header.version !== FORMAT_VERSION) throw new Error(`unknown format ${header.version}`);
        const region = { key, cubes: new Map(), dirty: false, used: 0 };
        let offset = 4 + headLength;
        for (const saved of header.cubes) {
            const cube = newCube(...saved.at);
            cube.region = region;
            cube.names = saved.names;
            cube.nameIndex = new Map(saved.names.map((name, n) => [name, n + FIRST]));
            cube.looked = saved.looked ?? 0;
            cube.from = saved.from ?? [];
            if (saved.own) cube.own = new Map(saved.own);
            if (!saved.hollow) {
                if (offset + VOLUME > raw.length) throw new Error('file is cut short');
                cube.cells = new Uint8Array(raw.subarray(offset, offset + VOLUME)); // a copy, so the big buffer can go
                offset += VOLUME;
            }
            region.cubes.set(cubeKey(...saved.at), cube);
        }
        return region;
    }

    function loadRegion(key) {
        try {
            return decode(key, storage.loadRegion(key));
        } catch (error) {
            // One bad file costs that one 64-block region of memory, not the bot.
            storage.setAside(key, error.message);
            onDisk.delete(key);
            regionNames.delete(key);
            indexDirty = true;
            return { key, cubes: new Map(), dirty: false, used: 0 };
        }
    }

    function saveRegion(region) {
        if (region.cubes.size) {
            storage.saveRegion(region.key, encode(region));
            onDisk.add(region.key);
            // Put the index right while the region is in hand: exactly the names its cells hold now.
            const names = new Set();
            for (const cube of region.cubes.values()) for (const name of summarise(cube).keys()) names.add(name);
            const old = regionNames.get(region.key);
            if (!old || old.size !== names.size || [...names].some(name => !old.has(name))) {
                regionNames.set(region.key, names);
                indexDirty = true;
            }
        }
        region.dirty = false;
    }

    function evictOne(keep) {
        let oldest = null;
        for (const region of regions.values()) if (region !== keep && (!oldest || region.used < oldest.used)) oldest = region;
        if (!oldest) return;
        if (oldest.dirty) saveRegion(oldest);
        regions.delete(oldest.key);
        if (lastCube?.region === oldest) lastCube = null;
    }

    return {
        /** How many regions are in memory right now. */
        get loadedRegions() { return regions.size; },
        get dirty() { return indexDirty || [...regions.values()].some(region => region.dirty); },

        /**
         * The bot sees this cell holding `name` right now.
         * @returns {string|null} what was remembered there before: a block name, 'air' (seen empty), or
         *   null when the cell had never been seen. The caller compares it to tell a change from a first look.
         */
        write(x, y, z, name) {
            const empty = EMPTY_NAMES.has(name);
            const cube = getCube(x >> 4, y >> 4, z >> 4, !empty);
            if (!cube?.cells) {
                if (empty || !cube) return null; // open air where nothing was remembered: not recorded
                cube.cells = new Uint8Array(VOLUME);
            }
            const i = cellIndex(x, y, z);
            const old = cube.cells[i];
            if (empty && old === NEVER) return null;
            // The old name is read first: making room for a new name can renumber the cube's cells.
            const before = old === NEVER ? null : nameOf(cube, old);
            const value = empty ? EMPTY : valueFor(cube, name);
            if (cube.cells[i] !== value) { cube.cells[i] = value; touch(cube); }
            return before;
        },

        /** What the bot remembers at a cell: a block name, 'air' (seen empty), or null (never seen). */
        read(x, y, z) {
            const cube = getCube(x >> 4, y >> 4, z >> 4, false);
            if (!cube?.cells) return null;
            const value = cube.cells[cellIndex(x, y, z)];
            return value === NEVER ? null : nameOf(cube, value);
        },

        /**
         * Calls `visit(x, y, z, name)` for every cell remembered in one cube, 'air' cells included. The
         * recorder uses it to check what it remembers against what it sees.
         */
        eachCell(cx, cy, cz, visit) {
            const cube = getCube(cx, cy, cz, false);
            if (!cube?.cells) return;
            const x0 = cx * 16, y0 = cy * 16, z0 = cz * 16;
            for (let i = 0; i < VOLUME; i++) {
                const value = cube.cells[i];
                if (value !== NEVER) visit(x0 + (i & 15), y0 + (i >> 8), z0 + ((i >> 4) & 15), nameOf(cube, value));
            }
        },

        /** What one cube holds: `names` maps each block name to { count, min, max, example }. Null if unknown. */
        cubeSummary(cx, cy, cz) {
            const cube = getCube(cx, cy, cz, false);
            if (!cube) return null;
            return { names: new Map([...summarise(cube)].map(([name, e]) => [name, { count: e.count, min: { ...e.min }, max: { ...e.max }, example: { ...e.example } }])),
                looked: cube.looked, from: [...cube.from] };
        },

        /** What an inclusive box of cells holds, as a Map of block name to { count, min, max, example }. */
        boxSummary(min, max) {
            const total = new Map();
            for (let rx = min.x >> 6; rx <= max.x >> 6; rx++) {
                for (let ry = min.y >> 6; ry <= max.y >> 6; ry++) {
                    for (let rz = min.z >> 6; rz <= max.z >> 6; rz++) {
                        const region = getRegion(cubeKey(rx, ry, rz), false);
                        if (!region) continue;
                        for (const cube of region.cubes.values()) {
                            if (!cube.cells) continue;
                            const x0 = cube.cx * 16, y0 = cube.cy * 16, z0 = cube.cz * 16;
                            if (x0 > max.x || x0 + 15 < min.x || y0 > max.y || y0 + 15 < min.y || z0 > max.z || z0 + 15 < min.z) continue;
                            const inside = x0 >= min.x && x0 + 15 <= max.x && y0 >= min.y && y0 + 15 <= max.y && z0 >= min.z && z0 + 15 <= max.z;
                            if (inside) { for (const [name, entry] of summarise(cube)) addTo(total, name, entry); continue; }
                            // The box cuts through this cube: count only the cells inside the box.
                            for (let i = 0; i < VOLUME; i++) {
                                const value = cube.cells[i];
                                if (value < FIRST) continue;
                                const x = x0 + (i & 15), y = y0 + (i >> 8), z = z0 + ((i >> 4) & 15);
                                if (x < min.x || x > max.x || y < min.y || y > max.y || z < min.z || z > max.z) continue;
                                const at = { x, y, z };
                                addTo(total, nameOf(cube, value), { count: 1, min: at, max: at, example: at });
                            }
                        }
                    }
                }
            }
            return total;
        },

        /**
         * Remembered cells of the given block names, nearest first. Opens only the regions the index
         * says could hold them, nearest region first, and stops when no closer one is left.
         * @returns {{x:number,y:number,z:number,name:string,distance:number}[]}
         */
        nearest(names, from, { maxDistance = 64, limit = 1 } = {}) {
            const wantedNames = new Set(names);
            const candidates = [];
            const consider = key => {
                const [rx, ry, rz] = key.split(',').map(Number);
                const d = boxDistance(from, rx * 64, ry * 64, rz * 64, 64);
                if (d <= maxDistance) candidates.push({ key, d });
            };
            for (const [key, have] of regionNames) if (names.some(name => have.has(name))) consider(key);
            for (const key of onDisk) if (!regionNames.has(key)) consider(key); // not indexed yet: has to be opened
            candidates.sort((a, b) => a.d - b.d);

            let hits = [];
            let worst = Infinity; // distance of the last hit that still makes the limit
            for (const candidate of candidates) {
                if (hits.length >= limit && candidate.d > worst) break;
                const region = getRegion(candidate.key, false);
                if (!region) continue;
                for (const cube of region.cubes.values()) {
                    if (!cube.cells) continue;
                    const want = new Uint8Array(256);
                    let any = false;
                    for (const name of wantedNames) {
                        const value = name === OTHER_NAME ? OTHER : cube.nameIndex.get(name);
                        if (value !== undefined) { want[value] = 1; any = true; }
                    }
                    if (!any) continue;
                    const x0 = cube.cx * 16, y0 = cube.cy * 16, z0 = cube.cz * 16;
                    const nearestPart = boxDistance(from, x0, y0, z0, 16);
                    if (nearestPart > maxDistance || (hits.length >= limit && nearestPart > worst)) continue;
                    for (let i = 0; i < VOLUME; i++) {
                        const value = cube.cells[i];
                        if (!want[value]) continue;
                        const x = x0 + (i & 15), y = y0 + (i >> 8), z = z0 + ((i >> 4) & 15);
                        const distance = Math.hypot(x + 0.5 - from.x, y + 0.5 - from.y, z + 0.5 - from.z);
                        if (distance <= maxDistance && (hits.length < limit || distance < worst)) hits.push({ x, y, z, name: nameOf(cube, value), distance });
                    }
                    if (hits.length > limit) {
                        hits.sort((a, b) => a.distance - b.distance);
                        hits.length = limit;
                    }
                    if (hits.length >= limit) worst = hits.reduce((far, hit) => Math.max(far, hit.distance), 0);
                }
            }
            return hits.sort((a, b) => a.distance - b.distance);
        },

        /**
         * The bot has looked over this whole cube from where it stands. `crumbId` is the trail crumb it
         * stands at, when there is one: a block that later turns up here, seen from the same crumb, wasn't
         * there before. Only the last few viewpoints are kept.
         */
        markLooked(cx, cy, cz, crumbId = null) {
            const cube = getCube(cx, cy, cz, true);
            const t = now();
            // The time is always updated in memory, but only counts as a change worth saving once a minute.
            if (t - cube.looked >= LOOKED_SLACK_MS) cube.region.dirty = true;
            cube.looked = t;
            if (crumbId === null || cube.from.at(-1) === crumbId) return;
            cube.from = cube.from.filter(id => id !== crumbId);
            cube.from.push(crumbId);
            if (cube.from.length > MAX_FROM) cube.from.shift();
            cube.region.dirty = true;
        },

        /** When the cube was last looked over (0 if never), and whether that was ever from this crumb. */
        lookedAt(cx, cy, cz) { return getCube(cx, cy, cz, false)?.looked ?? 0; },
        wasLookedFrom(cx, cy, cz, crumbId) { return getCube(cx, cy, cz, false)?.from.includes(crumbId) ?? false; },

        /**
         * Marks a cell as one the bot itself changed: 'placed' or 'dug'. Its own work is no surprise when
         * it sees the place again, and "what did I place" is what it may take down again later.
         */
        tag(x, y, z, what) {
            if (what !== 'placed' && what !== 'dug') throw new Error(`Unknown tag: ${what}`);
            const cube = getCube(x >> 4, y >> 4, z >> 4, true);
            cube.own ??= new Map();
            cube.own.set(cellIndex(x, y, z), what);
            cube.region.dirty = true;
        },
        tagOf(x, y, z) { return getCube(x >> 4, y >> 4, z >> 4, false)?.own?.get(cellIndex(x, y, z)) ?? null; },

        /**
         * Writes changed regions, then the index. With a budget it stops when the time is used up and
         * carries on at the next call, so saving never holds the game up.
         * @returns {number} regions still waiting to be written
         */
        save({ budgetMs = Infinity, clock = () => performance.now() } = {}) {
            const deadline = clock() + budgetMs;
            let waiting = 0;
            for (const region of regions.values()) {
                if (!region.dirty) continue;
                if (clock() > deadline) { waiting++; continue; }
                saveRegion(region);
            }
            if (indexDirty && waiting === 0) {
                storage.saveIndex({ version: FORMAT_VERSION, regions: Object.fromEntries([...regionNames].map(([key, names]) => [key, [...names]])) });
                indexDirty = false;
            }
            return waiting;
        },
    };
}

/** Keeps regions as files in one folder: `r.<x>.<y>.<z>.bin` and `index.json`. */
export function fileStorage(dir, { warn = console.warn } = {}) {
    const fileOf = key => path.join(dir, `r.${key.replaceAll(',', '.')}.bin`);
    const indexFile = path.join(dir, 'index.json');
    return {
        listRegions() {
            if (!existsSync(dir)) return [];
            return readdirSync(dir).map(name => name.match(/^r\.(-?\d+)\.(-?\d+)\.(-?\d+)\.bin$/))
                .filter(Boolean).map(match => `${match[1]},${match[2]},${match[3]}`);
        },
        loadRegion: key => readFileSync(fileOf(key)),
        saveRegion: (key, buffer) => writeFileAtomic(fileOf(key), buffer),
        setAside: (key, reason) => setAside(fileOf(key), reason, warn),
        loadIndex: () => readJsonFile(indexFile, { warn }),
        saveIndex: data => writeFileAtomic(indexFile, JSON.stringify(data)),
    };
}

/** Keeps regions in memory only. For tests, and for running with nothing saved. `loads` counts region reads. */
export function memoryStorage() {
    const files = new Map();
    let index = null;
    const storage = {
        loads: 0,
        files,
        listRegions: () => [...files.keys()],
        loadRegion: key => { storage.loads++; return files.get(key); },
        saveRegion: (key, buffer) => { files.set(key, buffer); },
        setAside: key => { files.delete(key); },
        loadIndex: () => index,
        saveIndex: data => { index = JSON.parse(JSON.stringify(data)); },
        loseIndex: () => { index = null; },
    };
    return storage;
}
