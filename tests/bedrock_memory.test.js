// SPDX-License-Identifier: CC0-1.0
// World memory on Bedrock Edition: block states by name (src/agent/bedrock/edition.js), Bedrock's names in
// Java's terms for kinds.js (src/agent/bedrock/names.js), and the real recorder over Bedrock chunk columns.
// No server.
//
// What went wrong without them: memory did Java's arithmetic on Bedrock's hashed state numbers, so a door's
// state came out as nonsense, and kinds.js, which knows Java's names, didn't know a Bedrock bed, a spawner or
// a beetroot for what they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vec3 } from 'vec3';
import registryFactory from 'prismarine-registry';
import chunkFactory from 'prismarine-chunk';
import { bedrockEdition } from '../src/agent/bedrock/edition.js';
import { bedrockNamesFor, bedrockToJava } from '../src/agent/bedrock/names.js';
import { propsOfState, stateOfProps } from '../src/agent/memory/block_state.js';
import { isCrop, isRipe, kindOf, moveKindOf, partnerOffset, translateNamesWith } from '../src/agent/memory/kinds.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { openMemory } from '../src/agent/memory/store.js';
import { createRecorder } from '../src/agent/memory/recorder.js';
import { needsBedrockLibraries } from './helpers/bedrock_libraries.js';

const BEDROCK_VERSION = '1.26.60';

function bedrockRegistry() {
    const registry = registryFactory(`bedrock_${BEDROCK_VERSION}`);
    const itemstates = registry.itemsArray.map(item => ({ name: `minecraft:${item.name}`, runtime_id: item.id, component_based: false }));
    registry.handleStartGame({ block_network_ids_are_hashes: true, itemstates });
    return registry;
}
const registry = bedrockRegistry();

test('a Bedrock state gives its properties by name, and the properties give the state back', { skip: needsBedrockLibraries }, () => {
    const door = stateOfProps(registry, 'wooden_door', { upper_block_bit: '1', 'minecraft:cardinal_direction': 'east', open_bit: '1' });
    assert.notEqual(door, registry.blocksByName.wooden_door.defaultState);
    assert.deepEqual(propsOfState(registry, door),
        { door_hinge_bit: '0', 'minecraft:cardinal_direction': 'east', open_bit: '1', upper_block_bit: '1' });
    // Every state of a few blocks makes the round trip.
    for (const name of ['wooden_door', 'bed', 'wheat', 'chest', 'oak_stairs']) {
        for (const stateId of registry.blocksByName[name].states)
            assert.equal(stateOfProps(registry, name, propsOfState(registry, stateId)), stateId, `${name} ${stateId}`);
    }
    assert.equal(propsOfState(registry, registry.blocksByName.stone.defaultState), null, 'stone has no properties');
});

test('what a state can\'t be keeps the default: an unknown property, an unknown value, an unknown block', () => {
    const wheat = registry.blocksByName.wheat;
    assert.equal(stateOfProps(registry, 'wheat', { growth: '99', colour: 'blue' }), wheat.defaultState);
    assert.equal(stateOfProps(registry, 'wheat', { growth: 7 }), stateOfProps(registry, 'wheat', { growth: '7' }), 'numbers or text');
    assert.equal(stateOfProps(registry, 'wheat', null), wheat.defaultState);
    assert.equal(stateOfProps(registry, 'no_such_block', { growth: '1' }), null);
});

test('Bedrock\'s names are judged as the Java blocks they stand for', () => {
    translateNamesWith(bedrockNamesFor(BEDROCK_VERSION));
    try {
        assert.equal(kindOf('bed'), 'bed');
        assert.equal(kindOf('mob_spawner'), 'spawner');
        assert.equal(kindOf('portal'), 'portal');
        assert.equal(kindOf('lit_furnace'), 'container');
        assert.equal(kindOf('fence_gate'), 'passage');
        assert.equal(kindOf('trapdoor'), 'passage');
        assert.equal(kindOf('standing_sign'), 'sign');
        assert.equal(moveKindOf('flowing_water'), 'water');
        assert.equal(isCrop('beetroot'), true);

        // A door's halves, and a bed's: Bedrock's own properties say which half is which.
        assert.deepEqual(partnerOffset('wooden_door', { upper_block_bit: '1', 'minecraft:cardinal_direction': 'east', open_bit: '0', door_hinge_bit: '0' }), { x: 0, y: -1, z: 0 });
        assert.deepEqual(partnerOffset('wooden_door', { upper_block_bit: '0', 'minecraft:cardinal_direction': 'east', open_bit: '0', door_hinge_bit: '0' }), { x: 0, y: 1, z: 0 });
        const foot = partnerOffset('bed', { direction: '2', head_piece_bit: '0', occupied_bit: '0' });
        const head = partnerOffset('bed', { direction: '2', head_piece_bit: '1', occupied_bit: '0' });
        assert.ok(foot && head && foot.x === -head.x && foot.z === -head.z && Math.abs(foot.x) + Math.abs(foot.z) === 1, `${JSON.stringify(foot)} ${JSON.stringify(head)}`);
        // Properties given as getProperties() gives them, numbers rather than text, translate the same.
        assert.deepEqual(partnerOffset('bed', { direction: 2, head_piece_bit: 1, occupied_bit: 0 }), head);

        // A Bedrock chest doesn't say whether it is half of a double chest, so it is taken as a single one.
        assert.equal(partnerOffset('chest', { 'minecraft:cardinal_direction': 'north' }), null);

        assert.equal(isRipe('wheat', { growth: '7' }), true);
        assert.equal(isRipe('wheat', { growth: '6' }), false);
        assert.equal(isRipe('beetroot', { growth: '7' }), true);
        assert.equal(isRipe('beetroot', { growth: '3' }), false);
    } finally {
        translateNamesWith(null);
    }
});

test('a Java property the table fills in the same for every state is left out, not passed on', () => {
    const translate = bedrockToJava({
        'minecraft:chest[minecraft:cardinal_direction=north]': 'minecraft:chest[facing=north,type=right,waterlogged=false]',
        'minecraft:chest[minecraft:cardinal_direction=south]': 'minecraft:chest[facing=south,type=right,waterlogged=false]',
    });
    assert.deepEqual(translate('chest', { 'minecraft:cardinal_direction': 'south' }), { name: 'chest', state: { facing: 'south' } });
    assert.deepEqual(translate('chest'), { name: 'chest', state: null });
    assert.deepEqual(translate('chest', { 'minecraft:cardinal_direction': 'up' }), { name: 'chest', state: null }, 'a state not in the table');
    assert.equal(translate('stone'), null, 'a name not in the table');
});

// ---- The recorder on a Bedrock world ----

// A sign's block entity as the server sends it: tagged values, each side's text under a field of its own.
function signEntity(front, back) {
    const side = text => ({ type: 'compound', value: { Text: { type: 'string', value: text }, SignTextColor: { type: 'int', value: -16777216 } } });
    return { type: 'compound', name: '', value: { id: { type: 'string', value: 'Sign' }, FrontText: side(front), BackText: side(back),
        IsWaxed: { type: 'byte', value: 0 } } };
}

test('a Bedrock sign gives the text of each side, the front first', () => {
    assert.deepEqual(bedrockEdition.signSidesOf({ entity: signEntity('Wheat\nfarm', 'Keep out') }), ['Wheat\nfarm', 'Keep out']);
    assert.deepEqual(bedrockEdition.signSidesOf({ entity: { FrontText: { Text: 'Mine' } } }), ['Mine', ''], 'a plain copy of the block entity');
    assert.deepEqual(bedrockEdition.signSidesOf({ entity: { type: 'compound', value: { Text: { type: 'string', value: 'Old\nsign' } } } }),
        ['Old\nsign'], 'a sign from before signs had two sides');
    assert.deepEqual(bedrockEdition.signSidesOf({ entity: undefined }), [], 'no block entity yet');
    assert.deepEqual(bedrockEdition.signSidesOf(null), [], 'nothing there');
});

// The cells a remembered thing covers: where it is, and its other half if it has one.
const cellsOf = thing => [thing, thing.also].filter(Boolean).map(p => `${p.x},${p.y},${p.z}`).sort();

// A flat world as a Bedrock flat world has it (bedrock, two of dirt, grass on top at -61), with a door, a
// bed, a chest, a sign and a ripe field of wheat in the open, and the bot standing in the middle.
function bedrockScene() {
    const Chunk = chunkFactory(registry);
    const columns = new Map();
    const columnOf = (x, z) => {
        const key = `${x >> 4},${z >> 4}`;
        if (!columns.has(key)) {
            const column = new Chunk({ x: x >> 4, z: z >> 4 });
            for (const [name, y] of [['bedrock', -64], ['dirt', -63], ['dirt', -62], ['grass_block', -61]])
                for (let lx = 0; lx < 16; lx++)
                    for (let lz = 0; lz < 16; lz++) column.setBlockStateId(new Vec3(lx, y, lz), registry.blocksByName[name].defaultState);
            columns.set(key, column);
        }
        return columns.get(key);
    };
    for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) columnOf(cx * 16, cz * 16);
    const set = (x, y, z, name, props = null) =>
        columnOf(x, z).setBlockStateId(new Vec3(x & 15, y, z & 15), stateOfProps(registry, name, props));
    set(4, -60, 0, 'wooden_door', { 'minecraft:cardinal_direction': 'west', upper_block_bit: '0' });
    set(4, -59, 0, 'wooden_door', { 'minecraft:cardinal_direction': 'west', upper_block_bit: '1' });
    set(-3, -60, 2, 'bed', { direction: '2', head_piece_bit: '0' });
    set(-3, -60, 1, 'bed', { direction: '2', head_piece_bit: '1' });
    set(2, -60, -4, 'chest', { 'minecraft:cardinal_direction': 'south' });
    // A sign, with its text in its block entity as a current server sends it: each side in a field of its own.
    set(2, -60, 3, 'standing_sign', { ground_sign_direction: '4' });
    columnOf(2, 3).setBlockEntity(new Vec3(2, -60, 3), signEntity('Iron\nin the east', ''));
    for (let x = -6; x <= -4; x++) {
        set(x, -61, -4, 'farmland');
        set(x, -60, -4, 'wheat', { growth: '7' });
    }

    const bot = new EventEmitter();
    Object.assign(bot, {
        registry,
        entity: { id: 1, type: 'player', position: new Vec3(0.5, -60, 0.5), eyeHeight: 1.62, yaw: 0, pitch: 0, height: 1.8, onGround: true },
        entities: {},
        game: { minY: -64, height: 384, dimension: 'overworld', gameMode: 'survival' },
        world: { getColumn: (cx, cz) => columns.get(`${cx},${cz}`) ?? null, getBiome: () => 0 },
        blockAt(pos) {
            const column = columns.get(`${Math.floor(pos.x) >> 4},${Math.floor(pos.z) >> 4}`);
            if (!column) return null;
            const block = column.getBlock(new Vec3(Math.floor(pos.x) & 15, Math.floor(pos.y), Math.floor(pos.z) & 15));
            block.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            return block;
        },
    });
    bot.entities[1] = bot.entity;
    return { bot, set };
}

test('the recorder keeps a Bedrock door, bed, chest, sign and field as the things they are', { skip: needsBedrockLibraries }, () => {
    translateNamesWith(bedrockNamesFor(BEDROCK_VERSION));
    try {
        const { bot, set } = bedrockScene();
        let t = 1_000_000;
        const now = () => t;
        let recorder = null;
        const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'bedrock-memory-')), scope: 'test/overworld', now,
            canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
        recorder = createRecorder({ bot, memory, now, tickBudgetMs: Infinity });
        const perception = createPerception({ bot, policy: resolvePolicy({ fair_play: 'strict' }), seenMap: recorder.view, backgroundPass: false,
            now, searchBudgetMs: Infinity, tickBudgetMs: Infinity });
        recorder.attach(perception);
        recorder.tick();

        assert.equal(memory.cells.read(4, -61, 4), 'grass_block');
        assert.equal(memory.cells.read(4, -62, 4), null, 'the dirt under the grass was never seen');

        const door = memory.things.get(4, -60, 0);
        assert.equal(door?.kind, 'passage');
        assert.equal(door.name, 'wooden_door', 'memory keeps the name the game uses');
        assert.equal(door.state['minecraft:cardinal_direction'], 'west', 'and its properties, by the names the game gives them');
        assert.deepEqual(cellsOf(door), ['4,-59,0', '4,-60,0'], 'the two halves are one door');
        assert.equal(memory.things.count('wooden_door'), 1);

        const bed = memory.things.get(-3, -60, 2);
        assert.equal(bed?.kind, 'bed');
        assert.deepEqual(cellsOf(bed), ['-3,-60,1', '-3,-60,2'], 'the head lies the way the bed faces');
        assert.equal(memory.things.count('bed'), 1);

        const chest = memory.things.get(2, -60, -4);
        assert.equal(chest?.kind, 'container');
        assert.equal(chest.also, undefined, 'a single chest');

        const sign = memory.things.get(2, -60, 3);
        assert.equal(sign?.kind, 'sign', JSON.stringify(sign));
        assert.equal(sign.text, 'Iron / in the east', 'what it says, read from its block entity');

        const fields = memory.things.fieldsNear({ x: -5, y: -60, z: -4 }, { maxDistance: 16 });
        assert.ok(fields.some(f => f.crop === 'wheat' && f.count === 3 && f.ripe === 3), JSON.stringify(fields));

        // Walled in, the bot sees nothing; what it knows of the door is the door as it remembers it,
        // in the state it was in.
        for (const [x, y, z] of [[1, -60, 0], [1, -59, 0], [-1, -60, 0], [-1, -59, 0], [0, -60, 1], [0, -59, 1],
            [0, -60, -1], [0, -59, -1], [0, -58, 0]]) set(x, y, z, 'stone');
        perception.invalidate();
        const remembered = perception.blockAt(new Vec3(4, -59, 0));
        assert.ok(remembered?.rememberedAt, 'from memory, not from the world');
        assert.equal(remembered.name, 'wooden_door');
        assert.equal(propsOfState(registry, remembered.stateId).upper_block_bit, '1');
        perception.stop();
    } finally {
        translateNamesWith(null);
    }
});
