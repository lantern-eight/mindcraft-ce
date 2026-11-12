// The seen-world map: what this bot has actually seen, remembered the way a player remembers it.
//
// It does two jobs at once:
//   1. Fair-play memory. Skills and the model look for blocks here instead of in raw chunk data, so the
//      bot can only go back to a furnace, a chest or a patch of sand it really saw.
//   2. Place memory for free. "Nearest sand I've seen" is a lookup, and the beach gets remembered
//      without the model having to decide to save it.
//
// Memory behaves like a person's: a block that changes while the bot isn't looking keeps its old entry
// (the bot still thinks the furnace is there), and only looking again corrects it, marking the old
// entry "gone". A place a player merely told the bot about is kept as "reported" and isn't treated as
// a target until the bot sees it (the provenance idea comes from the hashtagakiaki fork's place registry).
//
// Each entry also keeps the exact block state it was seen in (which way a chest faces, how grown a crop
// was). That lets perception answer "what's there?" from memory alone when the block is out of sight,
// instead of peeking at the live world and learning something the bot couldn't know.
//
// This module is a pure store with an injected clock and plain file I/O. The perception service decides
// *what* is worth recording (ores, containers, stations, sand...); the store only remembers it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FORMAT_VERSION = 1;
const PROVENANCES = new Set(['observed', 'touched', 'reported']);

const keyOf = (x, y, z) => `${x},${y},${z}`;
const cell = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

/** File for one scope (server, world, dimension). The scope is hashed so any string makes a safe name. */
export function seenMapFile(dir, scope) {
    const slug = String(scope).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    const hash = createHash('sha1').update(String(scope)).digest('hex').slice(0, 10);
    return path.join(dir, `${slug}-${hash}.json`);
}

/**
 * @param {object} options
 * @param {string} options.scope - `host:port/world/dimension`, from AgentSystem.scope(); one map per scope
 * @param {() => number} [options.now]
 * @param {number} [options.maxPerType] - entries kept per block type; the least recently seen go first
 */
export function createSeenMap({ scope, now = Date.now, maxPerType = 4000 } = {}) {
    if (!scope) throw new Error('A seen-world map needs a scope (server/world/dimension)');
    const byKey = new Map();   // "x,y,z" -> entry
    const byName = new Map();  // block name -> Set of keys
    const byColumn = new Map(); // "cx,cz" (16x16 columns) -> Set of keys, so a box query walks only its own columns
    const explored = new Map(); // "sx,sy,sz" (16x16x16 sections) -> last time the bot saw into it
    const biomes = new Map();  // "cx,cz" (16x16 columns) -> { name, lastSeen }

    const columnOf = entry => `${entry.x >> 4},${entry.z >> 4}`;

    function index(entry) {
        const k = keyOf(entry.x, entry.y, entry.z);
        if (!byName.has(entry.name)) byName.set(entry.name, new Set());
        byName.get(entry.name).add(k);
        const column = columnOf(entry);
        if (!byColumn.has(column)) byColumn.set(column, new Set());
        byColumn.get(column).add(k);
    }

    function unindex(entry) {
        const k = keyOf(entry.x, entry.y, entry.z);
        byName.get(entry.name)?.delete(k);
        const column = columnOf(entry);
        const keys = byColumn.get(column);
        if (keys) {
            keys.delete(k);
            if (keys.size === 0) byColumn.delete(column);
        }
    }

    // Keep each type near its cap by forgetting what was seen longest ago. Trimming waits until a type is
    // a little over its cap (5%) and then drops the extra in one sorted pass. Trimming on every new block
    // would mean a full scan of that type per block, which adds up fast on a beach full of sand.
    const slack = Math.max(1, Math.ceil(maxPerType / 20));
    function enforceCap(name) {
        const keys = byName.get(name);
        if (!keys || keys.size <= maxPerType + slack) return;
        const oldestFirst = [...keys].sort((a, b) => byKey.get(a).lastSeen - byKey.get(b).lastSeen);
        for (const k of oldestFirst.slice(0, keys.size - maxPerType)) {
            unindex(byKey.get(k));
            byKey.delete(k);
        }
    }

    function put(entry) {
        const k = keyOf(entry.x, entry.y, entry.z);
        const old = byKey.get(k);
        if (old) unindex(old);
        byKey.set(k, entry);
        index(entry);
        enforceCap(entry.name);
        return entry;
    }

    const visible = (entry, { includeReported = false, includeGone = false } = {}) =>
        (entry.provenance !== 'gone' || includeGone) && (entry.provenance !== 'reported' || includeReported);

    const copy = entry => ({ ...entry });

    const map = {
        scope,

        /** How many blocks are remembered in all, whatever their state. */
        get size() { return byKey.size; },

        /**
         * The bot sees (or touches) a notable block right now.
         * @param {number|null} [stateId] - the exact block state seen, when the caller knows it
         */
        observeBlock(pos, name, provenance = 'observed', stateId = null) {
            if (!PROVENANCES.has(provenance) || provenance === 'reported') throw new Error(`Bad provenance: ${provenance}`);
            const { x, y, z } = cell(pos);
            const t = now();
            const old = byKey.get(keyOf(x, y, z));
            const sameBlock = old && old.name === name;
            return copy(put({
                x, y, z, name,
                firstSeen: sameBlock && old.provenance !== 'reported' ? old.firstSeen : t,
                lastSeen: t, provenance,
                ...(Number.isInteger(stateId) ? { stateId } : sameBlock && Number.isInteger(old.stateId) ? { stateId: old.stateId } : {}),
                ...(sameBlock && old.reportedBy ? { reportedBy: old.reportedBy } : {}),
            }));
        },

        /**
         * The bot can see this cell right now and it holds `name`. Corrects memory: a remembered block
         * that is still there is refreshed; one that isn't is marked gone. Never adds new entries; the
         * perception service calls observeBlock for things worth remembering.
         */
        observeCell(pos, name, stateId = null) {
            const { x, y, z } = cell(pos);
            const entry = byKey.get(keyOf(x, y, z));
            if (!entry) return null;
            if (entry.name === name) {
                entry.lastSeen = now();
                if (Number.isInteger(stateId)) entry.stateId = stateId;
                if (entry.provenance === 'reported' || entry.provenance === 'gone') entry.provenance = 'observed';
                delete entry.goneAt;
            } else if (entry.provenance !== 'gone') {
                entry.provenance = 'gone';
                entry.goneAt = now();
            }
            return copy(entry);
        },

        /** A player says there is something here. Kept as unverified until the bot sees it. */
        report(pos, name, reportedBy = null) {
            const { x, y, z } = cell(pos);
            const old = byKey.get(keyOf(x, y, z));
            if (old && old.provenance !== 'gone') {
                if (reportedBy) old.reportedBy = reportedBy; // keep what the bot saw; note who agreed
                return copy(old);
            }
            const t = now();
            return copy(put({ x, y, z, name, firstSeen: t, lastSeen: t, provenance: 'reported', reportedBy }));
        },

        get(x, y, z) {
            const entry = byKey.get(keyOf(Math.floor(x), Math.floor(y), Math.floor(z)));
            return entry ? copy(entry) : null;
        },

        /**
         * Remembered blocks of the given types, nearest first.
         * @param {string[]} types
         * @param {{x:number,y:number,z:number}} from
         * @param {{maxDistance?:number, limit?:number, includeReported?:boolean, includeGone?:boolean}} [options]
         */
        nearest(types, from, { maxDistance = Infinity, limit = 1, ...filters } = {}) {
            const hits = [];
            for (const name of types) {
                for (const k of byName.get(name) ?? []) {
                    const entry = byKey.get(k);
                    if (!visible(entry, filters)) continue;
                    const d = Math.hypot(entry.x + 0.5 - from.x, entry.y + 0.5 - from.y, entry.z + 0.5 - from.z);
                    if (d <= maxDistance) hits.push([d, entry]);
                }
            }
            hits.sort((a, b) => a[0] - b[0]);
            return hits.slice(0, limit).map(([d, entry]) => ({ ...entry, distance: d }));
        },

        /** Remembered blocks inside an inclusive box, optionally only some types. */
        within(min, max, types = null, filters = {}) {
            const out = [];
            const consider = k => {
                const e = byKey.get(k);
                if (e && e.x >= min.x && e.x <= max.x && e.y >= min.y && e.y <= max.y && e.z >= min.z && e.z <= max.z && visible(e, filters))
                    out.push(copy(e));
            };
            if (types) {
                for (const name of new Set(types)) for (const k of byName.get(name) ?? []) consider(k);
                return out;
            }
            // Walk only the columns the box covers, unless the box is so big that walking everything is less work.
            const cx0 = Math.floor(min.x) >> 4, cx1 = Math.floor(max.x) >> 4;
            const cz0 = Math.floor(min.z) >> 4, cz1 = Math.floor(max.z) >> 4;
            if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) >= byColumn.size) {
                for (const keys of byColumn.values()) for (const k of keys) consider(k);
            } else {
                for (let cx = cx0; cx <= cx1; cx++)
                    for (let cz = cz0; cz <= cz1; cz++)
                        for (const k of byColumn.get(`${cx},${cz}`) ?? []) consider(k);
            }
            return out;
        },

        /** How many of a type the bot currently believes are there (seen, not gone, not merely reported). */
        count(name) {
            let n = 0;
            for (const k of byName.get(name) ?? []) if (visible(byKey.get(k))) n++;
            return n;
        },

        /** The bot has looked into the 16x16x16 section holding this point. */
        markExplored(pos) {
            explored.set(keyOf(Math.floor(pos.x) >> 4, Math.floor(pos.y) >> 4, Math.floor(pos.z) >> 4), now());
        },

        isExplored(pos) {
            return explored.has(keyOf(Math.floor(pos.x) >> 4, Math.floor(pos.y) >> 4, Math.floor(pos.z) >> 4));
        },

        /** The biome where the bot stood (a player reads it on the debug screen), per 16x16 column. */
        recordBiome(pos, name) {
            biomes.set(`${Math.floor(pos.x) >> 4},${Math.floor(pos.z) >> 4}`, { name, lastSeen: now() });
        },

        /** Nearest column where the bot stood in this biome, as the column's center. */
        nearestBiome(name, from) {
            let best = null, bestDistance = Infinity;
            for (const [k, sample] of biomes) {
                if (sample.name !== name) continue;
                const [cx, cz] = k.split(',').map(Number);
                const x = cx * 16 + 8, z = cz * 16 + 8;
                const d = Math.hypot(x - from.x, z - from.z);
                if (d < bestDistance) { bestDistance = d; best = { name, x, z, lastSeen: sample.lastSeen, distance: d }; }
            }
            return best;
        },

        toJSON() {
            return {
                version: FORMAT_VERSION, scope, savedAt: now(),
                blocks: [...byKey.values()].map(e => [e.x, e.y, e.z, e.name, e.firstSeen, e.lastSeen, e.provenance,
                    e.reportedBy ?? null, e.goneAt ?? null, e.stateId ?? null]),
                explored: [...explored].map(([k, t]) => [...k.split(',').map(Number), t]),
                biomes: [...biomes].map(([k, s]) => [...k.split(',').map(Number), s.name, s.lastSeen]),
            };
        },

        /** Writes the map atomically (temp file, then rename), so a crash never leaves half a file. */
        save(dir) {
            mkdirSync(dir, { recursive: true });
            const file = seenMapFile(dir, scope);
            const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
            writeFileSync(tmp, JSON.stringify(map.toJSON()));
            renameSync(tmp, file);
            return file;
        },

        /** Internal: restores entries from a saved file's data. */
        _restore(data) {
            for (const [x, y, z, name, firstSeen, lastSeen, provenance, reportedBy, goneAt, stateId] of data.blocks ?? []) {
                const entry = { x, y, z, name, firstSeen, lastSeen, provenance };
                if (reportedBy) entry.reportedBy = reportedBy;
                if (goneAt) entry.goneAt = goneAt;
                if (Number.isInteger(stateId)) entry.stateId = stateId; // absent in files written before states were kept
                put(entry);
            }
            for (const [sx, sy, sz, t] of data.explored ?? []) explored.set(keyOf(sx, sy, sz), t);
            for (const [cx, cz, name, t] of data.biomes ?? []) biomes.set(`${cx},${cz}`, { name, lastSeen: t });
        },
    };
    return map;
}

/**
 * Loads the map for one scope, or starts an empty one. A damaged or mismatched file is renamed aside
 * (kept for inspection) rather than crashing startup or mixing two worlds' memories.
 */
export function loadSeenMap(dir, scope, options = {}) {
    const map = createSeenMap({ ...options, scope });
    const file = seenMapFile(dir, scope);
    if (!existsSync(file)) return map;
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data.version !== FORMAT_VERSION || data.scope !== scope) throw new Error('version or scope mismatch');
        map._restore(data);
    } catch (error) {
        const aside = `${file}.corrupt-${Date.now()}`;
        try { renameSync(file, aside); } catch { /* leave it; we still start empty */ }
        console.warn(`Seen-world map ${path.basename(file)} could not be read (${error.message}); kept as ${path.basename(aside)}.`);
        return createSeenMap({ ...options, scope });
    }
    return map;
}
