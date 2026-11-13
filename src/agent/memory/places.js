// SPDX-License-Identifier: CC0-1.0
// Places: spots worth a name. "The base", "the lava cave", "a site with 4 chests and a bed".
//
// A place comes to exist in one of two ways:
//   found   the bot saw things a player uses (chests, workstations, beds, doors, signs) close together.
//           Nobody had to decide to save it. Ores and animals don't start a place
//   named   someone named the spot the bot stands on, whether or not anything is there
// A found place can be given a name later, by the model or a player. Until then it is described by what
// it holds.
//
// A place keeps its id for good. When something built between two places joins them, the older one
// absorbs the newer and keeps its id and name, and the newer id still leads to it, so nothing that
// remembered either place is left pointing at nothing.
//
// A place stores only its box, its name and where to walk to. What is inside is asked of the things
// store when needed, so a chest that is gone never lingers in a count here.
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from './files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'places.json';

const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

/** Distance from a point to the nearest part of a place's box (0 inside it). */
function gapTo(place, p) {
    const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    return Math.hypot(gap(p.x, place.min.x, place.max.x), gap(p.y, place.min.y, place.max.y), gap(p.z, place.min.z, place.max.z));
}

/**
 * @param {object} options
 * @param {string} options.scope - `host:port/world/dimension`; one set of places per scope
 * @param {() => number} [options.now]
 * @param {number} [options.joinDistance] - a thing this close to a place belongs to it
 */
export function createPlaces({ scope, now = Date.now, joinDistance = 24 } = {}) {
    if (!scope) throw new Error('Places need a scope (server/world/dimension)');
    const places = new Map();   // id -> place
    const mergedInto = new Map(); // an absorbed place's id -> the id that absorbed it
    let nextId = 1;
    let dirty = false;

    const resolve = id => { while (mergedInto.has(id)) id = mergedInto.get(id); return id; };
    const copy = place => ({ ...place, min: { ...place.min }, max: { ...place.max }, ...(place.spot ? { spot: { ...place.spot } } : {}) });

    function create(cell, kind, t) {
        const place = { id: nextId++, kind, name: null, min: { ...cell }, max: { ...cell }, crumb: null, created: t, lastSeen: t };
        places.set(place.id, place);
        return place;
    }

    function grow(place, cell) {
        for (const axis of ['x', 'y', 'z']) {
            place.min[axis] = Math.min(place.min[axis], cell[axis]);
            place.max[axis] = Math.max(place.max[axis], cell[axis]);
        }
    }

    // The older place takes the newer one in. A name survives from whichever has one, the older first.
    function absorb(older, newer) {
        grow(older, newer.min);
        grow(older, newer.max);
        older.name ??= newer.name;
        older.namedBy ??= newer.namedBy;
        older.spot ??= newer.spot;
        older.crumb ??= newer.crumb;
        older.lastSeen = Math.max(older.lastSeen, newer.lastSeen);
        if (newer.kind === 'found') older.kind = 'found';
        places.delete(newer.id);
        mergedInto.set(newer.id, older.id);
    }

    const api = {
        scope,
        get size() { return places.size; },
        get dirty() { return dirty; },

        /**
         * The bot saw a thing of a kind that makes a place (the caller decides which kinds do). It joins
         * the place it is close to, joins several places into one if it sits between them, or starts a
         * new place.
         * @param {{x,y,z,from?:number}} thing
         * @returns {{id:number, isNew:boolean, joined:number[]}} the place, and the ids it absorbed
         */
        noteThing(thing) {
            const cell = cellOf(thing);
            const t = now();
            const close = [...places.values()].filter(place => gapTo(place, cell) <= joinDistance).sort((a, b) => a.id - b.id);
            const place = close[0] ?? create(cell, 'found', t);
            const joined = close.slice(1).map(other => { absorb(place, other); return other.id; });
            if (place.kind === 'named') place.kind = 'found'; // a named spot that turned out to have things at it
            grow(place, cell);
            place.lastSeen = t;
            place.crumb ??= thing.from ?? null;
            dirty = true;
            return { id: place.id, isNew: close.length === 0, joined };
        },

        /**
         * Names the spot the bot stands on. Inside a known place that place gets the name; anywhere else a
         * new place is made around the spot. A name belongs to one place: using it again moves it.
         * @returns {object} the place
         */
        remember(name, pos, { crumb = null, by = null } = {}) {
            const label = String(name).trim();
            for (const other of places.values()) {
                if (other.name?.toLowerCase() !== label.toLowerCase()) continue;
                other.name = null;
                delete other.spot;
                if (other.kind === 'named') places.delete(other.id); // it was only ever the name
            }
            const place = api.at(pos, { margin: 0, raw: true }) ?? create(cellOf(pos), 'named', now());
            place.name = label;
            place.namedBy = by;
            place.spot = { x: pos.x, y: pos.y, z: pos.z };
            if (crumb !== null) place.crumb = crumb;
            dirty = true;
            return copy(place);
        },

        /** Names a place by id. Returns the place, or null if there is none. */
        name(id, name, { by = null } = {}) {
            const place = places.get(resolve(id));
            if (!place) return null;
            for (const other of places.values()) if (other !== place && other.name?.toLowerCase() === String(name).trim().toLowerCase()) other.name = null;
            place.name = String(name).trim();
            place.namedBy = by;
            dirty = true;
            return copy(place);
        },

        /** A place by id. An id that was absorbed into another place gives that place. */
        get(id) {
            const place = places.get(resolve(id));
            return place ? copy(place) : null;
        },

        /** The place with this name (case doesn't matter), or null. */
        byName(name) {
            const wanted = String(name).trim().toLowerCase();
            for (const place of places.values()) if (place.name?.toLowerCase() === wanted) return copy(place);
            return null;
        },

        /** The place a point is in (or within `margin` blocks of). The smallest one, if several fit. */
        at(pos, { margin = 4, raw = false } = {}) {
            let best = null, bestSize = Infinity;
            for (const place of places.values()) {
                if (gapTo(place, pos) > margin) continue;
                const size = (place.max.x - place.min.x + 1) * (place.max.y - place.min.y + 1) * (place.max.z - place.min.z + 1);
                if (size < bestSize) { best = place; bestSize = size; }
            }
            return best ? (raw ? best : copy(best)) : null;
        },

        /** Known places, nearest first, each with `distance` to its box. */
        near(from, { maxDistance = Infinity, limit = 20 } = {}) {
            return [...places.values()].map(place => ({ ...copy(place), distance: gapTo(place, from) }))
                .filter(place => place.distance <= maxDistance)
                .sort((a, b) => a.distance - b.distance).slice(0, limit);
        },

        /** Forgets a found place that has no name and nothing left in it. Named places are kept. */
        forget(id) {
            const place = places.get(resolve(id));
            if (!place || place.name) return false;
            places.delete(place.id);
            dirty = true;
            return true;
        },

        toJSON() {
            return { version: FORMAT_VERSION, scope, savedAt: now(), nextId, places: [...places.values()], merged: [...mergedInto] };
        },

        /** Writes the places into their scope folder. */
        save(dir) {
            const file = path.join(dir, FILE_NAME);
            writeFileAtomic(file, JSON.stringify(api.toJSON()));
            dirty = false;
            return file;
        },

        /** Internal: fills an empty store from a saved file's data. */
        _restore(data) {
            for (const place of data.places ?? []) { places.set(place.id, place); nextId = Math.max(nextId, place.id + 1); }
            for (const [from, to] of data.merged ?? []) mergedInto.set(from, to);
            nextId = Math.max(nextId, data.nextId ?? 1);
        },
    };
    return api;
}

/** Loads the places kept in a scope folder, or starts empty. A damaged or mismatched file is set aside. */
export function loadPlaces(dir, options = {}) {
    const places = createPlaces(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
    });
    if (data) places._restore(data);
    return places;
}
