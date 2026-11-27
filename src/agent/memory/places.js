// SPDX-License-Identifier: CC0-1.0
// Places: spots worth a name. "The base", "the lava cave", "a site with 4 chests and a bed".
//
// A place comes to exist in one of three ways:
//   found   the bot saw things a player uses (chests, workstations, beds, doors, signs) close together.
//           Nobody had to decide to save it. Ores and animals don't start a place
//   named   someone named the spot the bot stands on, whether or not anything is there
//   told    a player said where it is ("the village is at 300, -120"). The bot has not seen it, so it is
//           kept apart from everything seen: it never joins a found site and nothing seen is filed under
//           it, until the bot sees the spot. Then it becomes a named spot, or the name of the site the
//           bot found there. Its height may be unknown, since players often give only x and z
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

/**
 * Distance from a point to the nearest part of a place's box (0 inside it). A told place whose height is
 * not known is measured across the ground only.
 */
function gapTo(place, p) {
    const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    const dy = place.min.y === null ? 0 : gap(p.y, place.min.y, place.max.y);
    return Math.hypot(gap(p.x, place.min.x, place.max.x), dy, gap(p.z, place.min.z, place.max.z));
}

/** The cell of a told spot, keeping an unknown height unknown. */
const toldCellOf = p => ({ x: Math.floor(p.x), y: p.y === null || p.y === undefined ? null : Math.floor(p.y), z: Math.floor(p.z) });

/**
 * @param {object} options
 * @param {string} options.scope - which world and dimension, from `scopeOf` in fairplay/install.js; one set of places per scope
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
    const copy = place => ({ ...place, min: { ...place.min }, max: { ...place.max }, ...(place.spot ? { spot: { ...place.spot } } : {}),
        ...(place.told ? { told: { ...place.told } } : {}) });
    const sameName = (place, label) => place.name?.toLowerCase() === label.toLowerCase();

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
        older.told ??= newer.told;
        older.lastSeen = Math.max(older.lastSeen, newer.lastSeen);
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
            // Only found places draw things in and join up. A bare named spot is someone's chosen name for
            // a point, so it is never swallowed by a site growing nearby; but a thing turning up right at
            // such a spot, with no site around, makes the spot itself the site.
            const close = [...places.values()].filter(place => place.kind === 'found' && gapTo(place, cell) <= joinDistance).sort((a, b) => a.id - b.id);
            const spot = close.length ? null : [...places.values()].find(place => place.kind === 'named' && gapTo(place, cell) <= 4);
            const place = close[0] ?? spot ?? create(cell, 'found', t);
            const joined = close.slice(1).map(other => { absorb(place, other); return other.id; });
            place.kind = 'found';
            grow(place, cell);
            place.lastSeen = t;
            place.crumb ??= thing.from ?? null;
            dirty = true;
            return { id: place.id, isNew: close.length === 0 && !spot, joined };
        },

        /**
         * Names the spot the bot stands on. In or right beside a known place that has no name yet, that
         * place gets the name; anywhere else a new place is made around the spot. A name belongs to one place: using it again moves it.
         * @returns {object} the place
         */
        remember(name, pos, { crumb = null, by = null } = {}) {
            const label = String(name).trim();
            for (const other of places.values()) {
                if (!sameName(other, label)) continue;
                other.name = null;
                delete other.spot;
                if (other.kind === 'named' || other.kind === 'told') places.delete(other.id); // it was only ever the name
            }
            // A site that already has a name keeps it: the new name is then a spot of its own inside it.
            const here = api.at(pos, { raw: true });
            const place = here && !here.name ? here : create(cellOf(pos), 'named', now());
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
            for (const other of places.values()) {
                if (other === place || !sameName(other, String(name).trim())) continue;
                other.name = null;
                if (other.kind === 'told') places.delete(other.id); // a told place is nothing without its name
            }
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

        /**
         * A player says a place of this name is at `spot` ({x, y, z}, y null when they didn't say). It is
         * kept as told, apart from what the bot has seen, until `confirmTold`. Told again, it moves. A
         * name the bot already gave something it has seen is not taken over by what it was told.
         * @param {object} [options]
         * @param {string|null} [options.by] - who said so
         * @returns {{place: object|null, taken: object|null}} the told place, or the seen place that has the name
         */
        tell(name, spot, { by = null } = {}) {
            const label = String(name).trim();
            const t = now();
            let place = null;
            for (const other of places.values()) {
                if (!sameName(other, label)) continue;
                if (other.kind !== 'told') return { place: null, taken: copy(other) };
                place = other;
            }
            const cell = toldCellOf(spot);
            if (!place) {
                place = { id: nextId++, kind: 'told', name: label, min: null, max: null, crumb: null, created: t, lastSeen: null };
                places.set(place.id, place);
            }
            place.name = label;
            place.namedBy = by;
            place.min = { ...cell };
            place.max = { ...cell };
            place.spot = { x: spot.x, y: cell.y === null ? null : spot.y, z: spot.z };
            place.told = { by, at: t };
            dirty = true;
            return { place: copy(place), taken: null };
        },

        /**
         * The bot has seen the spot of a told place. It becomes a named spot at `spot` (now with its
         * height), or, when an unnamed site the bot found by sight is within `joinDistance`, that site takes
         * the name and the told place is folded into it. A site that already has a name is left alone:
         * the told place stays a spot of its own beside it.
         * @returns {{place: object, joined: number|null, beside: string|null}|null} null when it is not a told place
         */
        confirmTold(id, spot) {
            const place = places.get(resolve(id));
            if (!place || place.kind !== 'told') return null;
            const t = now();
            const cell = cellOf(spot);
            place.kind = 'named';
            place.min = { ...cell };
            place.max = { ...cell };
            place.spot = { x: spot.x, y: spot.y, z: spot.z };
            place.told = { ...place.told, seenAt: t };
            place.lastSeen = t;
            dirty = true;
            const site = [...places.values()].filter(other => other.kind === 'found' && gapTo(other, cell) <= joinDistance)
                .sort((a, b) => gapTo(a, cell) - gapTo(b, cell))[0];
            if (!site) return { place: copy(place), joined: null, beside: null };
            if (site.name) return { place: copy(place), joined: null, beside: site.name };
            site.name = place.name;
            site.namedBy = place.namedBy;
            site.told = place.told;
            site.lastSeen = Math.max(site.lastSeen, t);
            places.delete(place.id);
            mergedInto.set(place.id, site.id);
            return { place: copy(site), joined: site.id, beside: null };
        },

        /** Told places not seen yet, nearest first, each with `distance` (across the ground when the height is unknown). */
        toldNear(from, { maxDistance = Infinity } = {}) {
            return [...places.values()].filter(place => place.kind === 'told').map(place => ({ ...copy(place), distance: gapTo(place, from) }))
                .filter(place => place.distance <= maxDistance).sort((a, b) => a.distance - b.distance);
        },

        /**
         * The place a point is in (or within `margin` blocks of). The smallest one, if several fit. A told
         * place the bot hasn't seen is never the place it is in: what it sees there isn't filed under hearsay.
         */
        at(pos, { margin = 4, raw = false } = {}) {
            let best = null, bestSize = Infinity;
            for (const place of places.values()) {
                if (place.kind === 'told' || gapTo(place, pos) > margin) continue;
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
