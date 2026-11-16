// SPDX-License-Identifier: CC0-1.0
// Fair play's eyes on Bedrock Edition: the edition seam's Bedrock answers (src/agent/bedrock/edition.js),
// and perception standing on them, with Bedrock game data and Bedrock chunk columns but no server.
//
// What went wrong without them: the bot, standing on a flat grass floor with fair play on, named the dirt
// and the bedrock under it. Bedrock numbers block states by hash, the sight table was built for Java's
// numbering and came out empty, and nothing blocked sight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import registryFactory from 'prismarine-registry';
import chunkFactory from 'prismarine-chunk';
import { editionOf } from '../src/agent/edition/index.js';
import { bedrockEdition } from '../src/agent/bedrock/edition.js';
import { buildStopsSightTable } from '../src/agent/fairplay/sight.js';
import { scanSection } from '../src/agent/fairplay/block_scan.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { createSeenMap } from '../src/agent/fairplay/seen_map.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';

const BEDROCK_VERSION = '1.26.60';

// Game data as a bot has it once the server has said hello: the server says whether state numbers are
// hashes, and current servers say yes.
function bedrockRegistry({ hashed = true } = {}) {
    const registry = registryFactory(`bedrock_${BEDROCK_VERSION}`);
    const itemstates = registry.itemsArray.map(item => ({ name: `minecraft:${item.name}`, runtime_id: item.id, component_based: false }));
    registry.handleStartGame({ block_network_ids_are_hashes: hashed, itemstates });
    return registry;
}

const STOPS = ['stone', 'dirt', 'grass_block', 'bedrock', 'diamond_ore', 'oak_log', 'furnace', 'oak_double_slab'];
const SEE_THROUGH = ['air', 'water', 'glass', 'tinted_glass', 'oak_leaves', 'chest', 'oak_slab', 'oak_stairs', 'oak_fence', 'torch'];

test('Bedrock game data gets the Bedrock answers', () => {
    assert.equal(editionOf(bedrockRegistry()), bedrockEdition);
    assert.equal(editionOf(bedrockRegistry({ hashed: false })), bedrockEdition);
});

for (const hashed of [true, false]) {
    test(`the sight table stops at full opaque blocks and nothing else (${hashed ? 'hashed' : 'counted'} state numbers)`, () => {
        const registry = bedrockRegistry({ hashed });
        const table = buildStopsSightTable(registry);
        for (const name of STOPS)
            for (const stateId of bedrockEdition.stateIdsOf(registry.blocksByName[name]))
                assert.equal(table.get(stateId), 1, `${name} ${stateId}`);
        for (const name of SEE_THROUGH)
            for (const stateId of bedrockEdition.stateIdsOf(registry.blocksByName[name]))
                assert.equal(table.get(stateId), 0, `${name} ${stateId}`);
    });
}

test('a state table over hashes keeps one entry per state and nothing for other numbers', () => {
    const registry = bedrockRegistry();
    const table = bedrockEdition.stateTable(registry);
    const states = registry.blocksArray.flatMap(block => bedrockEdition.stateIdsOf(block));
    assert.equal(new Set(states).size, states.length, 'every state has its own number');
    states.forEach((stateId, i) => table.set(stateId, (i % 250) + 1));
    states.forEach((stateId, i) => assert.equal(table.get(stateId), (i % 250) + 1));
    const unused = 12345; // not a hash any state has
    assert.ok(!states.includes(unused));
    table.set(unused, 9);
    for (const stateId of [unused, undefined, null, 1.5, 2 ** 40]) assert.equal(table.get(stateId), 0, String(stateId));
});

test('state numbers of a block come in the order of its collision shapes', () => {
    const registry = bedrockRegistry();
    const stairs = registry.blocksByName.oak_stairs;
    const ids = bedrockEdition.stateIdsOf(stairs);
    assert.equal(ids.length, registry.blockCollisionShapes.blocks.oak_stairs.length);
    assert.deepEqual(ids, stairs.states);
});

// A flat world like a Bedrock flat world: bedrock at -64, two of dirt, grass on top at -61.
function flatColumns(registry) {
    const Chunk = chunkFactory(registry);
    const columns = new Map();
    const layers = [['bedrock', -64], ['dirt', -63], ['dirt', -62], ['grass_block', -61]];
    for (let cx = -2; cx <= 1; cx++) {
        for (let cz = -2; cz <= 1; cz++) {
            const column = new Chunk({ x: cx, z: cz });
            for (const [name, y] of layers)
                for (let x = 0; x < 16; x++)
                    for (let z = 0; z < 16; z++) column.setBlockStateId(new Vec3(x, y, z), registry.blocksByName[name].defaultState);
            columns.set(`${cx},${cz}`, column);
        }
    }
    return columns;
}

test('a section never made reads as air, inside the world only', () => {
    const registry = bedrockRegistry();
    const column = flatColumns(registry).get('0,0');
    assert.equal(column.getBlockStateId(new Vec3(0, 40, 0)), undefined, 'the library itself gives nothing there');
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: 40, z: 0 }), registry.blocksByName.air.defaultState);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: -61, z: 0 }), registry.blocksByName.grass_block.defaultState);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: -65, z: 0 }), undefined);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: 400, z: 0 }), undefined);
});

test('a section is summarised from its first layer, and skipped when it holds nothing wanted', () => {
    const registry = bedrockRegistry();
    const column = flatColumns(registry).get('0,0');
    const air = registry.blocksByName.air.defaultState, dirt = registry.blocksByName.dirt.defaultState;
    const ground = bedrockEdition.sectionSummary(column, -4, -64);
    assert.equal(ground.empty, false);
    assert.ok(ground.states.includes(dirt));
    assert.deepEqual(bedrockEdition.sectionSummary(column, 2, -64), { empty: true, states: [air] });

    let reads = 0;
    const counting = Object.create(column, { getBlockStateId: { value: pos => { reads++; return column.getBlockStateId(pos); } } });
    const diamond = registry.blocksByName.diamond_ore.defaultState;
    scanSection(bedrockEdition, counting, 0, -4, 0, -64, id => id === diamond, () => {});
    assert.equal(reads, 0, 'no diamond in the palette: no cell is read');
    const found = [];
    scanSection(bedrockEdition, counting, 0, -4, 0, -64, id => id === dirt, (x, y, z) => found.push(y));
    assert.equal(found.length, 2 * 256);
});

// A stand-in for a Bedrock bot standing on the flat world: what perception reads from a live bot.
function bedrockBot(registry, columns, position) {
    const bot = new EventEmitter();
    const columnOf = (x, z) => columns.get(`${x >> 4},${z >> 4}`) ?? null;
    Object.assign(bot, {
        registry,
        entity: { id: 1, type: 'player', position: new Vec3(...position), eyeHeight: 1.62, yaw: 0, pitch: 0, height: 1.8 },
        entities: {},
        game: { minY: -64, height: 384, dimension: 'overworld', gameMode: 'survival' },
        world: { getColumn: (cx, cz) => columns.get(`${cx},${cz}`) ?? null, getBiome: () => 0 },
        blockAt(pos) {
            const column = columnOf(Math.floor(pos.x), Math.floor(pos.z));
            if (!column) return null;
            const block = column.getBlock(new Vec3(Math.floor(pos.x) & 15, Math.floor(pos.y), Math.floor(pos.z) & 15));
            block.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            return block;
        },
    });
    bot.entities[1] = bot.entity;
    return bot;
}

test('standing on a flat grass floor, the bot knows the grass and not the dirt or bedrock under it', () => {
    const registry = bedrockRegistry();
    const columns = flatColumns(registry);
    columns.get('0,0').setBlockStateId(new Vec3(5, -60, 0), registry.blocksByName.diamond_ore.defaultState); // in the open
    columns.get('0,0').setBlockStateId(new Vec3(6, -63, 3), registry.blocksByName.diamond_ore.defaultState); // buried
    const bot = bedrockBot(registry, columns, [0.5, -60, 0.5]);
    const perception = createPerception({ bot, policy: resolvePolicy({ fair_play: 'strict' }), seenMap: createSeenMap({ scope: 'test' }),
        searchBudgetMs: Infinity, tickBudgetMs: Infinity });
    const nameAt = (x, y, z) => perception.blockAt(new Vec3(x, y, z))?.name ?? null;

    assert.equal(nameAt(4, -61, 2), 'grass_block', 'the floor a few blocks off');
    assert.equal(nameAt(4, -62, 2), null, 'the dirt under it');
    assert.equal(nameAt(4, -64, 2), null, 'the bedrock at the bottom');
    assert.equal(nameAt(0, -62, 0), null, 'not even right under its feet: touch reaches one block down');
    assert.equal(nameAt(5, -60, 0), 'diamond_ore');
    assert.equal(nameAt(6, -63, 3), null);

    const ids = name => registry.blocksByName[name].id;
    const find = name => perception.findBlocks({ matching: ids(name), maxDistance: 16, count: 5000 });
    assert.equal(find('dirt').length, 0);
    assert.equal(find('bedrock').length, 0);
    assert.ok(find('grass_block').length > 100, 'the floor around it is in view');
    assert.deepEqual(find('diamond_ore').map(p => [p.x, p.y, p.z]), [[5, -60, 0]]);
    perception.stop();
});
