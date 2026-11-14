// SPDX-License-Identifier: CC0-1.0
// Things: the single objects worth knowing exactly. Chests and what is in them, doors and whether they
// were open, beds, workstations, signs, portals, ores, and per area the crops and the animals.
//
// Cells (cells.js) remember that a block of some name is somewhere. A thing remembers more: the state
// it was in, when it was first and last seen, where the bot stood when it saw it (so it can walk back
// to that spot), and for a container what was inside the last time the bot looked.
//
// Memory behaves like a person's. A chest that is emptied while the bot is away is still remembered
// full; only looking again corrects it. A thing seen to be gone is marked gone, not deleted, so the bot
// can say "the furnace that was here is gone". A thing a player merely told the bot about is kept as
// "reported" and isn't treated as real until the bot sees it.
//
// This is a plain store with an injected clock. It holds names, positions, times and properties by
// name; never the game's numbers, which change between game versions. What counts as a thing is decided
// in kinds.js.
import path from 'node:path';
import { kindOf as defaultKindOf } from './kinds.js';
import { readJsonFile, writeFileAtomic } from './files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'things.json';

const keyOf = (x, y, z) => `${x},${y},${z}`;
const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const distanceTo = (thing, from) => Math.hypot(thing.x + 0.5 - from.x, thing.y + 0.5 - from.y, thing.z + 0.5 - from.z);

/**
 * @param {object} options
 * @param {string} options.scope - `host:port/world/dimension`; one store per scope
 * @param {() => number} [options.now]
 * @param {(name: string) => string|null} [options.kindOf]
 * @param {number} [options.maxPerName] - things kept per block name; the least recently seen go first
 */
export function createThings({ scope, now = Date.now, kindOf = defaultKindOf, maxPerName = 4000 } = {}) {
    if (!scope) throw new Error('A things store needs a scope (server/world/dimension)');
    const byKey = new Map();    // "x,y,z" -> thing. A two-block thing (double chest, bed, door) is under both cells
    const byName = new Map();   // block name -> Set of things
    const byItem = new Map();   // item name -> Set of containers last seen holding it
    const fields = new Map();   // "cx,cy,cz|crop" -> field
    const herds = new Map();    // "cx,cy,cz" -> herds seen in that cube
    const biomes = new Map();   // "cx,cz" -> { name, lastSeen }
    let dirty = false;

    function index(thing) {
        byKey.set(keyOf(thing.x, thing.y, thing.z), thing);
        if (thing.also) byKey.set(keyOf(thing.also.x, thing.also.y, thing.also.z), thing);
        if (!byName.has(thing.name)) byName.set(thing.name, new Set());
        byName.get(thing.name).add(thing);
        for (const item of Object.keys(thing.contents?.items ?? {})) {
            if (!byItem.has(item)) byItem.set(item, new Set());
            byItem.get(item).add(thing);
        }
    }

    function unindex(thing) {
        if (byKey.get(keyOf(thing.x, thing.y, thing.z)) === thing) byKey.delete(keyOf(thing.x, thing.y, thing.z));
        if (thing.also && byKey.get(keyOf(thing.also.x, thing.also.y, thing.also.z)) === thing) byKey.delete(keyOf(thing.also.x, thing.also.y, thing.also.z));
        byName.get(thing.name)?.delete(thing);
        for (const item of Object.keys(thing.contents?.items ?? {})) byItem.get(item)?.delete(thing);
    }

    // Keep each name near its cap by forgetting what was seen longest ago. Trimming waits until a name
    // is a little over (5%) and then drops the extra in one pass, so a vein of ore isn't a sort per block.
    const slack = Math.max(1, Math.ceil(maxPerName / 20));
    function enforceCap(name) {
        const all = byName.get(name);
        if (!all || all.size <= maxPerName + slack) return;
        const oldestFirst = [...all].sort((a, b) => a.lastSeen - b.lastSeen);
        for (const thing of oldestFirst.slice(0, all.size - maxPerName)) unindex(thing);
    }

    const shown = (thing, { includeReported = false, includeGone = false } = {}) =>
        (thing.provenance !== 'gone' || includeGone) && (thing.provenance !== 'reported' || includeReported);

    function copy(thing) {
        const out = { ...thing, kind: kindOf(thing.name) };
        if (thing.state) out.state = { ...thing.state };
        if (thing.also) out.also = { ...thing.also };
        if (thing.contents) out.contents = { ...thing.contents, items: { ...thing.contents.items } };
        return out;
    }

    function markGone(thing, t) {
        if (thing.provenance === 'gone') return;
        thing.provenance = 'gone';
        thing.goneAt = t;
        dirty = true;
    }

    const things = {
        scope,
        get size() { return new Set(byKey.values()).size; },
        get dirty() { return dirty; },

        /**
         * The bot sees a thing right now.
         * @param {{x:number,y:number,z:number}} pos
         * @param {string} name - the block's name
         * @param {object} [seen]
         * @param {object|null} [seen.state] - the block's properties by name (facing, open, age...)
         * @param {number|null} [seen.from] - the trail crumb the bot stands at
         * @param {number|null} [seen.fromDistance] - how far the bot is from the thing. The crumb kept is
         *   the one it was seen from closest up: that is the spot to walk back to, not wherever it last
         *   caught sight of the thing from across a field
         * @param {number|null} [seen.day] - the game day
         * @param {object|null} [seen.partner] - the cell of its other half (double chest, bed, door)
         * @param {string} [seen.text] - what a sign says
         * @param {boolean} [seen.touched] - known by touch, not by sight
         * @returns {{thing: object, isNew: boolean}} `isNew` when the bot didn't already believe it was there
         */
        see(pos, name, { state = null, from = null, fromDistance = null, day = null, partner = null, text = undefined, touched = false } = {}) {
            const { x, y, z } = cellOf(pos);
            const t = now();
            let thing = byKey.get(keyOf(x, y, z));
            if (thing && thing.name !== name) { unindex(thing); thing = null; } // something else stands here now

            // The other half of a two-block thing that is already known: this cell joins it.
            const other = partner ? byKey.get(keyOf(Math.floor(partner.x), Math.floor(partner.y), Math.floor(partner.z))) : null;
            if (other && other !== thing && other.name === name && other.provenance !== 'gone' && !other.also) {
                if (thing) {
                    // Both halves were known as separate things until now: keep whatever each knew.
                    other.contents ??= thing.contents;
                    other.firstSeen = Math.min(other.firstSeen, thing.firstSeen);
                    unindex(thing);
                }
                unindex(other);
                other.also = { x, y, z };
                other.alsoState = state;
                index(other);
                thing = other;
            }

            const isNew = !thing || thing.provenance === 'gone' || thing.provenance === 'reported';
            if (!thing) {
                thing = { x, y, z, name, firstSeen: t };
                index(thing);
            } else if (thing.provenance === 'reported') {
                thing.firstSeen = t; // "first seen" means seen, not heard about
            }
            const main = thing.x === x && thing.y === y && thing.z === z;
            if (state) { if (main) thing.state = state; else thing.alsoState = state; }
            thing.lastSeen = t;
            thing.provenance = touched ? 'touched' : 'observed';
            delete thing.goneAt;
            if (from !== null && (thing.from == null || fromDistance === null || !(fromDistance > thing.fromDistance))) {
                thing.from = from;
                if (fromDistance !== null) thing.fromDistance = Math.round(fromDistance * 10) / 10;
            }
            if (day !== null) thing.day = day;
            if (text !== undefined) thing.text = text;
            dirty = true;
            enforceCap(name);
            return { thing: copy(thing), isNew };
        },

        /**
         * The bot can see this cell right now and it holds `name`. Corrects memory and never adds to it: a
         * remembered thing that is still there is refreshed, one that isn't is marked gone.
         * @returns {object|null} the thing remembered at that cell, as it stands after the correction
         */
        seeCell(pos, name) {
            const { x, y, z } = cellOf(pos);
            const thing = byKey.get(keyOf(x, y, z));
            if (!thing) return null;
            const t = now();
            if (thing.name === name) {
                thing.lastSeen = t;
                if (thing.provenance === 'reported' || thing.provenance === 'gone') thing.provenance = 'observed';
                delete thing.goneAt;
                dirty = true;
            } else {
                markGone(thing, t);
            }
            return copy(thing);
        },

        /** A player says there is something here. Kept as unverified until the bot sees it. */
        report(pos, name, reportedBy = null) {
            const { x, y, z } = cellOf(pos);
            const old = byKey.get(keyOf(x, y, z));
            if (old && old.provenance !== 'gone') {
                if (reportedBy) { old.reportedBy = reportedBy; dirty = true; } // keep what the bot saw; note who agreed
                return copy(old);
            }
            if (old) unindex(old);
            const t = now();
            const thing = { x, y, z, name, firstSeen: t, lastSeen: t, provenance: 'reported', reportedBy };
            index(thing);
            dirty = true;
            return copy(thing);
        },

        /** The thing remembered at a cell (either cell of a two-block thing), or null. */
        get(x, y, z) {
            const thing = byKey.get(keyOf(Math.floor(x), Math.floor(y), Math.floor(z)));
            return thing ? copy(thing) : null;
        },

        /**
         * Remembered things, nearest first.
         * @param {string[]|null} names - block names, or null for any
         * @param {{x:number,y:number,z:number}} from
         * @param {object} [options]
         * @param {string[]} [options.kinds] - only these kinds ('container', 'bed'...)
         */
        nearest(names, from, { maxDistance = Infinity, limit = 1, kinds = null, ...filters } = {}) {
            const hits = [];
            const consider = thing => {
                if (!shown(thing, filters) || (kinds && !kinds.includes(kindOf(thing.name)))) return;
                const distance = distanceTo(thing, from);
                if (distance <= maxDistance) hits.push({ thing, distance });
            };
            if (names) for (const name of new Set(names)) for (const thing of byName.get(name) ?? []) consider(thing);
            else for (const thing of new Set(byKey.values())) consider(thing);
            hits.sort((a, b) => a.distance - b.distance);
            return hits.slice(0, limit).map(({ thing, distance }) => ({ ...copy(thing), distance }));
        },

        /** Remembered things inside an inclusive box. */
        within(min, max, { names = null, kinds = null, ...filters } = {}) {
            const out = [];
            const consider = thing => {
                if (thing.x < min.x || thing.x > max.x || thing.y < min.y || thing.y > max.y || thing.z < min.z || thing.z > max.z) return;
                if (!shown(thing, filters) || (kinds && !kinds.includes(kindOf(thing.name)))) return;
                out.push(copy(thing));
            };
            if (names) for (const name of new Set(names)) for (const thing of byName.get(name) ?? []) consider(thing);
            else for (const thing of new Set(byKey.values())) consider(thing);
            return out;
        },

        /** Every thing the bot believes is there (seen, not gone), optionally only some kinds. */
        list({ kinds = null } = {}) {
            const out = [];
            for (const thing of new Set(byKey.values()))
                if (shown(thing) && (!kinds || kinds.includes(kindOf(thing.name)))) out.push(copy(thing));
            return out;
        },

        /** How many of a block name the bot currently believes are there. */
        count(name) {
            let n = 0;
            for (const thing of byName.get(name) ?? []) if (shown(thing)) n++;
            return n;
        },

        // ---- Containers ----

        /**
         * What the bot saw inside a container. Taken when it opens one and again when it closes it, so its
         * own changes are kept. It is a belief with an age: someone may have changed the chest since.
         * @param {{name:string,count:number}[]} items
         * @returns {object|null} the container, or null when no thing is remembered at that cell
         */
        setContents(pos, items, { freeSlots = null, slots = null } = {}) {
            const { x, y, z } = cellOf(pos);
            const thing = byKey.get(keyOf(x, y, z));
            if (!thing) return null;
            unindex(thing);
            const totals = {};
            for (const { name, count } of items) totals[name] = (totals[name] ?? 0) + count;
            thing.contents = { items: totals, freeSlots, slots, at: now() };
            index(thing);
            dirty = true;
            return copy(thing);
        },

        /**
         * Containers the bot last saw holding an item, nearest first. "iron" finds iron_ingot and raw_iron;
         * an exact item name finds only that item.
         * @returns {{x,y,z,name,items:object,total:number,distance:number,lookedAt:number}[]}
         */
        findItem(query, from, { limit = 5 } = {}) {
            const wanted = String(query).toLowerCase().replace(/\s+/g, '_');
            const exact = byItem.has(wanted) && byItem.get(wanted).size > 0;
            const hits = new Map();
            for (const [item, holders] of byItem) {
                if (exact ? item !== wanted : !item.includes(wanted)) continue;
                for (const thing of holders) {
                    if (!shown(thing)) continue;
                    const hit = hits.get(thing) ?? { x: thing.x, y: thing.y, z: thing.z, name: thing.name, from: thing.from ?? null, items: {}, total: 0,
                        distance: distanceTo(thing, from), lookedAt: thing.contents.at };
                    hit.items[item] = thing.contents.items[item];
                    hit.total += thing.contents.items[item];
                    hits.set(thing, hit);
                }
            }
            return [...hits.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
        },

        // ---- Fields and herds: kept per 16-block cube, replaced whole each time the cube is looked over ----

        /**
         * The crop plants of one kind seen in a cube: how many, how many ripe, and the box they span. A
         * count of zero forgets the field.
         */
        setField(cx, cy, cz, crop, { count, ripe = 0, min = null, max = null }, { from = null, day = null } = {}) {
            const key = `${keyOf(cx, cy, cz)}|${crop}`;
            if (!count) { if (fields.delete(key)) dirty = true; return; }
            fields.set(key, { cx, cy, cz, crop, count, ripe, min, max, lastSeen: now(), from, day });
            dirty = true;
        },

        /** Fields the bot remembers, nearest first by the middle of their box. */
        fieldsNear(from, { maxDistance = Infinity, crop = null, limit = 20 } = {}) {
            const out = [];
            for (const field of fields.values()) {
                if (crop && field.crop !== crop) continue;
                const mid = field.min && field.max
                    ? { x: (field.min.x + field.max.x) / 2, y: (field.min.y + field.max.y) / 2, z: (field.min.z + field.max.z) / 2 }
                    : { x: field.cx * 16 + 8, y: field.cy * 16 + 8, z: field.cz * 16 + 8 };
                const distance = Math.hypot(mid.x - from.x, mid.y - from.y, mid.z - from.z);
                if (distance <= maxDistance) out.push({ ...field, x: mid.x, y: mid.y, z: mid.z, distance });
            }
            return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
        },

        /** The animals seen in a cube, as [{ kind, count, x, y, z }]. Replaces what was remembered for that cube. */
        setHerds(cx, cy, cz, seen, { from = null, day = null } = {}) {
            const key = keyOf(cx, cy, cz);
            if (!seen.length) { if (herds.delete(key)) dirty = true; return; }
            const t = now();
            herds.set(key, seen.map(herd => ({ kind: herd.kind, count: herd.count, x: herd.x, y: herd.y, z: herd.z, lastSeen: t, from, day })));
            dirty = true;
        },

        /** Herds the bot remembers, nearest first. */
        herdsNear(from, { maxDistance = Infinity, kind = null, limit = 20 } = {}) {
            const out = [];
            for (const group of herds.values()) {
                for (const herd of group) {
                    if (kind && herd.kind !== kind) continue;
                    const distance = Math.hypot(herd.x - from.x, herd.y - from.y, herd.z - from.z);
                    if (distance <= maxDistance) out.push({ ...herd, distance });
                }
            }
            return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
        },

        // ---- Biomes: where the bot stood, per 16x16 column (a player reads it on the debug screen) ----

        recordBiome(pos, name) {
            const key = `${Math.floor(pos.x) >> 4},${Math.floor(pos.z) >> 4}`;
            if (biomes.get(key)?.name !== name) dirty = true;
            biomes.set(key, { name, lastSeen: now() });
        },

        /** The nearest column where the bot stood in this biome, as the column's centre. */
        nearestBiome(name, from) {
            let best = null;
            for (const [key, sample] of biomes) {
                if (sample.name !== name) continue;
                const [cx, cz] = key.split(',').map(Number);
                const x = cx * 16 + 8, z = cz * 16 + 8;
                const distance = Math.hypot(x - from.x, z - from.z);
                if (!best || distance < best.distance) best = { name, x, z, lastSeen: sample.lastSeen, distance };
            }
            return best;
        },

        toJSON() {
            return {
                version: FORMAT_VERSION, scope, savedAt: now(),
                things: [...new Set(byKey.values())],
                fields: [...fields.values()],
                herds: [...herds].map(([key, group]) => [key, group]),
                biomes: [...biomes].map(([key, sample]) => [key, sample.name, sample.lastSeen]),
            };
        },

        /** Writes the store into its scope folder. */
        save(dir) {
            const file = path.join(dir, FILE_NAME);
            writeFileAtomic(file, JSON.stringify(things.toJSON()));
            dirty = false;
            return file;
        },

        /** Internal: fills an empty store from a saved file's data. */
        _restore(data) {
            for (const thing of data.things ?? []) index(thing);
            for (const field of data.fields ?? []) fields.set(`${keyOf(field.cx, field.cy, field.cz)}|${field.crop}`, field);
            for (const [key, group] of data.herds ?? []) herds.set(key, group);
            for (const [key, name, lastSeen] of data.biomes ?? []) biomes.set(key, { name, lastSeen });
        },
    };
    return things;
}

/** Loads the things kept in a scope folder, or starts empty. A damaged or mismatched file is set aside. */
export function loadThings(dir, options = {}) {
    const things = createThings(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
    });
    if (data) things._restore(data);
    return things;
}
