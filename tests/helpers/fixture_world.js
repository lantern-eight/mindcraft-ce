// SPDX-License-Identifier: CC0-1.0
// A tiny in-memory block world for fair-play unit tests.
//
// Fair-play rules are about geometry ("is there a clear line from the eye to this face?"),
// so the tests need small, hand-built worlds: a buried ore, a sealed cave, a glass window.
// A real server is slow and nondeterministic for that. This helper stores block state ids in a
// Map, treats everything else inside the loaded box as air, and reports cells outside the box
// (or in an "unloaded" region) as unknown, the way a client sees chunks it hasn't received.
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import Vec3 from 'vec3';

export function fixtureWorld({ version = '1.21.11', min = [-32, -16, -32], max = [32, 32, 32] } = {}) {
    const registry = minecraftData(version);
    const cells = new Map();
    const unloaded = [];
    const key = (x, y, z) => `${x},${y},${z}`;
    const inBox = (x, y, z, lo, hi) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
    const corners = (a, b) => [a.map((v, i) => Math.min(v, b[i])), a.map((v, i) => Math.max(v, b[i]))];

    // Chunk columns, shaped like the real ones perception scans. They are rebuilt only after the world
    // changes. Each column carries per-section summaries (how many non-air cells, which block states),
    // the same shortcuts real chunk sections offer, so scans skip empty space here too.
    let edits = 0, builtAt = -1, columns = new Map(), summaries = new Map();
    const EMPTY_SECTION = Object.freeze({ solidBlockCount: 0, palette: Object.freeze([0]) });
    function rebuild() {
        columns = new Map();
        summaries = new Map();
        for (const [k, id] of cells) {
            const [x, y, z] = k.split(',').map(Number);
            const sectionKey = `${x >> 4},${y >> 4},${z >> 4}`;
            let summary = summaries.get(sectionKey);
            if (!summary) summaries.set(sectionKey, summary = { solidBlockCount: 0, palette: [0] });
            if (id !== 0) summary.solidBlockCount++;
            if (!summary.palette.includes(id)) summary.palette.push(id);
        }
        builtAt = edits;
    }

    // The state id for a block, by default its default state. `props` picks a specific state, for
    // example { type: 'double' } for a double slab; properties left out keep their default value.
    function stateIdOf(name, props = null) {
        const block = registry.blocksByName[name];
        if (!block) throw new Error(`Unknown block name in fixture: ${name}`);
        const base = block.defaultState ?? block.minStateId;
        if (!props) return base;
        // State ids count through the properties like digits of a mixed-radix number, last property fastest.
        const states = block.states ?? [];
        const valuesOf = s => s.values ?? (s.type === 'bool' ? ['true', 'false'] : Array.from({ length: s.num_values }, (_, i) => String(i)));
        let rest = base - block.minStateId;
        const digits = [];
        for (let i = states.length - 1; i >= 0; i--) {
            digits[i] = rest % states[i].num_values;
            rest = Math.floor(rest / states[i].num_values);
        }
        let offset = 0;
        states.forEach((s, i) => {
            let digit = digits[i];
            if (props[s.name] !== undefined) {
                digit = valuesOf(s).indexOf(String(props[s.name]));
                if (digit < 0) throw new Error(`${name} has no ${s.name}=${props[s.name]}`);
            }
            offset = offset * s.num_values + digit;
        });
        return block.minStateId + offset;
    }

    const world = {
        registry,
        stateIdOf,

        /** Place one block; `props` picks a specific state, like { type: 'double' } for a slab. */
        set(name, x, y, z, props = null) {
            cells.set(key(x, y, z), stateIdOf(name, props));
            edits++;
            return world;
        },

        /** Fill an inclusive box with one block type (use 'air' to carve). */
        fill(name, a, b) {
            const [lo, hi] = corners(a, b);
            const id = stateIdOf(name);
            for (let x = lo[0]; x <= hi[0]; x++)
                for (let y = lo[1]; y <= hi[1]; y++)
                    for (let z = lo[2]; z <= hi[2]; z++)
                        cells.set(key(x, y, z), id);
            edits++;
            return world;
        },

        /** Mark an inclusive box as not received by the client, so it reads as unknown. */
        unload(a, b) {
            unloaded.push(corners(a, b));
            edits++;
            return world;
        },

        /**
         * The chunk column at chunk coordinates (cx, cz), or null outside the world box. Like a real
         * column: `getBlockStateId({x, y, z})` takes x and z inside the column and an absolute y, and
         * `sections` starts at y -64, the overworld's lowest section.
         */
        column(cx, cz) {
            if (cx * 16 + 15 < min[0] || cx * 16 > max[0] || cz * 16 + 15 < min[2] || cz * 16 > max[2]) return null;
            if (builtAt !== edits) rebuild();
            const columnKey = `${cx},${cz}`;
            if (!columns.has(columnKey)) {
                columns.set(columnKey, {
                    getBlockStateId: pos => world.getStateId(cx * 16 + pos.x, pos.y, cz * 16 + pos.z),
                    sections: Array.from({ length: 24 }, (_, i) => summaries.get(`${cx},${i - 4},${cz}`) ?? EMPTY_SECTION),
                });
            }
            return columns.get(columnKey);
        },

        /** null means "the client doesn't have this cell", the same contract the sight core expects. */
        getStateId(x, y, z) {
            if (!inBox(x, y, z, min, max)) return null;
            if (unloaded.some(([lo, hi]) => inBox(x, y, z, lo, hi))) return null;
            return cells.get(key(x, y, z)) ?? 0; // state 0 is air
        },

        nameAt(x, y, z) {
            const id = world.getStateId(x, y, z);
            return id == null ? null : registry.blocksByStateId[id]?.name ?? null;
        },

        /** Every cell set explicitly (including carved air), as [x, y, z, stateId]. */
        *cells() {
            for (const [k, id] of cells) {
                const [x, y, z] = k.split(',').map(Number);
                yield [x, y, z, id];
            }
        },
    };
    return world;
}

/**
 * A stand-in for a mineflayer bot standing in a fixture world: enough of the real bot's surface
 * (blockAt, findBlocks, chunk columns, entities, registry, events) for perception and the fair-play
 * guards. findBlocks is the *raw* search (it stands in for mineflayer's): it only scans cells set
 * explicitly, which keeps tests fast, so plain air is never a match.
 */
export function stubBot(world, { position = [0.5, 1, 0.5], yaw = 0, pitch = 0, entities = [] } = {}) {
    const registry = world.registry;
    const blockAt = pos => {
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const id = world.getStateId(x, y, z);
        if (id == null) return null;
        const b = registry.blocksByStateId[id];
        return { name: b.name, type: b.id, stateId: id, position: new Vec3(x, y, z), boundingBox: b.boundingBox };
    };
    const matches = (block, matching) => (typeof matching === 'function' ? matching(block)
        : [].concat(matching).includes(block.type));
    const bot = new EventEmitter();
    Object.assign(bot, {
        registry,
        username: 'Fairy',
        entity: { id: 0, type: 'player', username: 'Fairy', position: new Vec3(...position), eyeHeight: 1.62, yaw, pitch, height: 1.8 },
        entities: {},
        blockAt,
        findBlocks({ matching, maxDistance = 16, count = 1, point }) {
            const origin = point ?? bot.entity.position;
            const found = [];
            for (const [x, y, z] of world.cells()) {
                const p = new Vec3(x, y, z);
                if (p.offset(0.5, 0.5, 0.5).distanceTo(origin) > maxDistance) continue;
                const block = blockAt(p);
                if (block && block.name !== 'air' && matches(block, matching)) found.push(p);
            }
            return found.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin)).slice(0, count);
        },
        world: { getBiome: () => 0, getColumn: (cx, cz) => world.column(cx, cz) },
        game: { minY: -64, height: 384, dimension: 'overworld', gameMode: 'survival' },
        moveTo(x, y, z) { bot.entity.position = new Vec3(x, y, z); },
    });
    bot.entities[0] = bot.entity;
    for (const e of entities) bot.entities[e.id] = e;
    return bot;
}

/**
 * Options for createPerception in tests: no time budgets, so a result never depends on how fast the
 * machine running the tests happens to be.
 */
export const NO_BUDGETS = Object.freeze({ searchBudgetMs: Infinity, tickBudgetMs: Infinity });
