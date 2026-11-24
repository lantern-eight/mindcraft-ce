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
import { javaEdition } from '../src/agent/edition/java.js';
import { buildStopsSightTable } from '../src/agent/fairplay/sight.js';
import { scanSection } from '../src/agent/fairplay/block_scan.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { needsBedrockLibraries } from './helpers/bedrock_libraries.js';

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

test('a state table over hashes keeps one entry per state and nothing for other numbers', { skip: needsBedrockLibraries }, () => {
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

test('state numbers of a block come in the order of its collision shapes', { skip: needsBedrockLibraries }, () => {
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

test('a section never made reads as air, inside the world only', { skip: needsBedrockLibraries }, () => {
    const registry = bedrockRegistry();
    const column = flatColumns(registry).get('0,0');
    assert.equal(column.getBlockStateId(new Vec3(0, 40, 0)), undefined, 'the library itself gives nothing there');
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: 40, z: 0 }), registry.blocksByName.air.defaultState);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: -61, z: 0 }), registry.blocksByName.grass_block.defaultState);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: -65, z: 0 }), undefined);
    assert.equal(bedrockEdition.readStateId(column, { x: 0, y: 400, z: 0 }), undefined);
});

test('a section is summarised from its first layer, and skipped when it holds nothing wanted', { skip: needsBedrockLibraries }, () => {
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

test('a Bedrock shooter aims when it faces the bot, or shows a flag for it; a mob that always attacks has a target', () => {
    // mineflayer's yaw: 0 faces north (-z). The bot is 10 blocks north of the skeleton.
    const at = { x: 0, y: 65.6, z: -10 };
    const skeleton = yaw => ({ name: 'skeleton', position: { x: 0, y: 64, z: 0 }, yaw, metadata: { flags: {} } });
    assert.equal(bedrockEdition.isAiming(null, skeleton(0), at), true, 'facing the bot');
    assert.equal(bedrockEdition.isAiming(null, skeleton(0.3), at), true, 'within 20 degrees');
    assert.equal(bedrockEdition.isAiming(null, skeleton(Math.PI / 2), at), false, 'facing away');
    assert.equal(bedrockEdition.isAiming(null, skeleton(0)), false, 'no one to aim at');
    assert.equal(bedrockEdition.isAiming(null, { ...skeleton(Math.PI), name: 'zombie' }, at), false, 'a zombie shoots nothing');
    assert.equal(bedrockEdition.isAiming(null, { name: 'pillager', position: { x: 0, y: 64, z: 0 }, metadata: { flags: { charged: true } } }, at), true, 'a crossbow charged');
    assert.equal(bedrockEdition.isAggressive(null, { name: 'zombie', metadata: { flags: {} } }), true, 'a zombie always attacks');
    assert.equal(bedrockEdition.isAggressive(null, { name: 'enderman', metadata: { flags: {} } }), false, 'neutral until angry');
    assert.equal(bedrockEdition.isAggressive(null, { name: 'enderman', metadata: { flags: { angry: true } } }), true);
    assert.equal(bedrockEdition.isAggressive(null, { name: 'evocation_illager', metadata: { flags: {} } }), true, "an evoker, by Bedrock's name for it");
});

test('a Bedrock shooter shows no bow drawn, only a crossbow charged or a blaze or ghast winding up', () => {
    // Facing the bot is aiming on Bedrock (isAiming), but nothing tells when the shot comes.
    const at = { x: 0, y: 65.6, z: -10 };
    const shooter = (name, flags = {}) => ({ name, position: { x: 0, y: 64, z: 0 }, yaw: 0, metadata: { flags } });
    assert.equal(bedrockEdition.isDrawing(null, shooter('skeleton'), at), false, 'facing the bot, but no draw to see');
    assert.equal(bedrockEdition.isDrawing(null, shooter('pillager', { charged: true }), at), true, 'a crossbow charged');
    assert.equal(bedrockEdition.isDrawing(null, shooter('blaze', { charge_attack: true }), at), true);
    assert.equal(bedrockEdition.isDrawing(null, null, at), false);
});

test('a Bedrock archer shoots on a fixed beat, quicker on hard, as the game\'s own behavior files give it', () => {
    assert.equal(bedrockEdition.shotBeatMs('skeleton', 'normal'), 3000);
    assert.equal(bedrockEdition.shotBeatMs('skeleton', 'easy'), 3000);
    assert.equal(bedrockEdition.shotBeatMs('skeleton', 'hard'), 2000);
    assert.equal(bedrockEdition.shotBeatMs('stray', 'normal'), 3000);
    assert.equal(bedrockEdition.shotBeatMs('bogged', 'normal'), 3500);
    assert.equal(bedrockEdition.shotBeatMs('bogged', 'hard'), 2500);
    assert.equal(bedrockEdition.shotBeatMs('pillager', 'normal'), null, 'a crossbow is loaded, not on a beat');
    assert.equal(bedrockEdition.shotBeatMs('zombie', 'normal'), null);
});

test('a Bedrock player raises the shield in the off-hand by sneaking', () => {
    const controls = [];
    const bot = { setControlState: (control, state) => controls.push([control, state]) };
    bedrockEdition.raiseShield(bot, true);
    bedrockEdition.raiseShield(bot, false);
    assert.deepEqual(controls, [['sneak', true], ['sneak', false]]);
});

test('a Bedrock bot feels a hit from the side opposite the push it gets', () => {
    const listeners = {};
    const bot = { entity: { id: 3 }, _client: { on: (name, fn) => { listeners[name] = fn; }, off() {} } };
    const felt = [];
    bedrockEdition.onHurt(bot, hit => felt.push(hit.direction));
    // Pushed north (-z): the hit came from the south.
    listeners.set_entity_motion({ runtime_entity_id: 3n, velocity: { x: 0, y: 0.4, z: -0.4 } });
    listeners.entity_event({ event_id: 'hurt_animation', runtime_entity_id: 3n });
    listeners.entity_event({ event_id: 'hurt_animation', runtime_entity_id: 4n });
    listeners.entity_event({ event_id: 'death_animation', runtime_entity_id: 3n });
    assert.equal(felt.length, 1);
    assert.ok(felt[0].z > 0.99, JSON.stringify(felt[0]));
});

test('Bedrock answers every question the edition seam asks', () => {
    // A question added to the seam for Java and not answered here stops whatever asks it on a Bedrock
    // bot, with an error, instead of failing a test.
    const missing = Object.keys(javaEdition).filter(key => typeof javaEdition[key] === 'function' && typeof bedrockEdition[key] !== 'function');
    assert.deepEqual(missing, []);
});

test('a Bedrock furnace is another block while it burns', () => {
    assert.deepEqual(bedrockEdition.furnaceOf({ name: 'furnace' }), { kind: 'furnace', lit: false });
    assert.deepEqual(bedrockEdition.furnaceOf({ name: 'lit_furnace' }), { kind: 'furnace', lit: true });
    assert.deepEqual(bedrockEdition.furnaceOf({ name: 'lit_blast_furnace' }), { kind: 'blast_furnace', lit: true });
    assert.deepEqual(bedrockEdition.furnaceOf({ name: 'smoker' }), { kind: 'smoker', lit: false });
    assert.equal(bedrockEdition.furnaceOf({ name: 'chest' }), null);
    assert.equal(bedrockEdition.furnaceOf(null), null);
});

test('a Bedrock cauldron is one block for every liquid: its states say which, and how full', () => {
    const cauldron = state => ({ name: 'cauldron', getProperties: () => state });
    assert.deepEqual(bedrockEdition.cauldronOf(cauldron({ cauldron_liquid: 'lava', fill_level: 6 })), { liquid: 'lava', full: true });
    assert.deepEqual(bedrockEdition.cauldronOf(cauldron({ cauldron_liquid: 'lava', fill_level: 3 })), { liquid: 'lava', full: false });
    assert.deepEqual(bedrockEdition.cauldronOf(cauldron({ cauldron_liquid: 'water', fill_level: 6 })), { liquid: 'water', full: true });
    // Empty, it still names a liquid (water, by default), but holds none.
    assert.deepEqual(bedrockEdition.cauldronOf(cauldron({ cauldron_liquid: 'water', fill_level: 0 })), { liquid: null, full: false });
    assert.deepEqual(bedrockEdition.cauldronOf({ name: 'cauldron' }), { liquid: null, full: false }, 'remembered without its state');
    assert.equal(bedrockEdition.cauldronOf({ name: 'lit_furnace' }), null);
    assert.equal(bedrockEdition.cauldronOf(null), null);
});

test('a survival player on Bedrock reaches half a block farther to a block than on Java, and as far to a mob', () => {
    // The keyboard, mouse and controller reach. A touch screen reaches a block 6 away; the bot is held to 5.
    assert.deepEqual(bedrockEdition.survivalReach(), { blocks: 5, entities: 3 });
});

test('a melee hit on Bedrock: swords hit harder than axes, and every swing counts after the mob\'s half second', () => {
    assert.deepEqual(bedrockEdition.meleeOf('iron_sword'), { damage: 7, rechargeMs: 500 });
    assert.deepEqual(bedrockEdition.meleeOf('iron_axe'), { damage: 6, rechargeMs: 500 });
    assert.deepEqual(bedrockEdition.meleeOf('netherite_sword'), { damage: 9, rechargeMs: 500 });
    assert.deepEqual(bedrockEdition.meleeOf(undefined), { damage: 1, rechargeMs: 500 }, 'a bare hand');
    assert.deepEqual(bedrockEdition.meleeOf('dirt'), { damage: 1, rechargeMs: 500 });
});

test('a Bedrock block is named in Java\'s terms for Mindcraft\'s lists, from the game data\'s own table', () => {
    // Mindcraft's skills and reflexes name blocks the way Java does: a thin layer of snow is "snow", water
    // is "water" whether still or flowing. Bedrock's names for the same things differ.
    const registry = { version: { type: 'bedrock', minecraftVersion: BEDROCK_VERSION } };
    const asJava = name => bedrockEdition.javaNameOf(registry, name);
    assert.equal(asJava('snow_layer'), 'snow', 'the thin layer');
    assert.equal(asJava('snow'), 'snow_block', 'a whole block of snow, on Bedrock');
    assert.equal(asJava('flowing_water'), 'water');
    assert.equal(asJava('water'), 'water');
    assert.equal(asJava('flowing_lava'), 'lava');
    assert.equal(asJava('deadbush'), 'dead_bush');
    assert.equal(asJava('golden_rail'), 'powered_rail');
    assert.equal(asJava('trip_wire'), 'tripwire');
    assert.equal(asJava('cobblestone'), 'cobblestone', 'a name both games share');
    assert.equal(asJava('water_bucket'), 'water_bucket', 'an item that is no block keeps its name');
    assert.equal(bedrockEdition.javaNameOf({ version: { type: 'bedrock', minecraftVersion: '0.0.1' } }, 'snow_layer'), 'snow_layer',
        'game data with no table: the name as it is');
});

test('a Bedrock mob is a baby by its flags, not by Java\'s numbered entry', () => {
    assert.equal(bedrockEdition.isBaby({ name: 'cow', metadata: { flags: { baby: true, breathing: true } } }), true);
    assert.equal(bedrockEdition.isBaby({ name: 'cow', metadata: { flags: { baby: false } } }), false);
    assert.equal(bedrockEdition.isBaby({ name: 'cow', metadata: { 16: true } }), false, 'Java\'s entry means nothing on Bedrock');
    assert.equal(bedrockEdition.isBaby({ name: 'cow' }), false, 'no metadata yet');
});

test('a Bedrock creeper\'s lit fuse is its ignited flag', () => {
    assert.equal(bedrockEdition.isFusing(null, { name: 'creeper', metadata: { flags: { ignited: true } } }), true);
    assert.equal(bedrockEdition.isFusing(null, { name: 'creeper', metadata: { flags: { ignited: false } } }), false);
    assert.equal(bedrockEdition.isFusing(null, { name: 'creeper', metadata: { 16: 1 } }), false, 'Java\'s entry means nothing on Bedrock');
    assert.equal(bedrockEdition.isFusing(null, { name: 'tnt_minecart', metadata: { flags: { ignited: true } } }), false, 'only a creeper');
});

test('a Bedrock villager is read from its own name and named metadata', () => {
    const villager = (metadata) => ({ name: 'villager_v2', metadata });
    assert.deepEqual(bedrockEdition.villagerOf(villager({ variant: 5, trade_tier: 0, flags: { baby: false } })),
        { baby: false, profession: 'librarian', level: 1 }, 'a novice librarian');
    assert.deepEqual(bedrockEdition.villagerOf(villager({ variant: 13, trade_tier: 4, flags: {} })),
        { baby: false, profession: 'mason', level: 5 }, 'a master mason');
    assert.deepEqual(bedrockEdition.villagerOf(villager({ variant: 0, trade_tier: 0, flags: { baby: true } })),
        { baby: true, profession: 'unemployed', level: 1 });
    assert.deepEqual(bedrockEdition.villagerOf(villager({})), { baby: false, profession: null, level: null }, 'nothing said yet');
    assert.deepEqual(bedrockEdition.villagerOf({ name: 'villager', metadata: { variant: 7, trade_tier: 1 } }),
        { baby: false, profession: 'cleric', level: 2 }, 'the villager from before 1.14 has the same fields');
    assert.equal(bedrockEdition.villagerOf({ name: 'villager_v2', metadata: { 18: { villagerProfession: 9 } } }).profession, null,
        'Java\'s entries mean nothing on Bedrock');
    assert.equal(bedrockEdition.villagerOf({ name: 'wandering_trader', metadata: { variant: 0 } }), null);
    assert.equal(bedrockEdition.villagerOf({ name: 'cow', metadata: { variant: 1 } }), null);
});

test('standing on a flat grass floor, the bot knows the grass and not the dirt or bedrock under it', { skip: needsBedrockLibraries }, () => {
    const registry = bedrockRegistry();
    const columns = flatColumns(registry);
    columns.get('0,0').setBlockStateId(new Vec3(5, -60, 0), registry.blocksByName.diamond_ore.defaultState); // in the open
    columns.get('0,0').setBlockStateId(new Vec3(6, -63, 3), registry.blocksByName.diamond_ore.defaultState); // buried
    const bot = bedrockBot(registry, columns, [0.5, -60, 0.5]);
    // Seeing all around: the blocks asked about lie on every side of the bot.
    const allAround = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 360 } });
    const perception = createPerception({ bot, policy: allAround, searchBudgetMs: Infinity });
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

// ---- Hearing and operator rights ----

function listeningBot() {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.entity = { id: 1, name: 'player', position: new Vec3(0, -60, 0) };
    bot.entities = { 1: bot.entity, 40: { id: 40, name: 'cow', position: new Vec3(0.5, -60, -9.5) } };
    return bot;
}

test('a mob is heard from what a Bedrock server sends: its sounds, and its hurt and death cries', () => {
    const bot = listeningBot();
    const heard = [];
    const stop = bedrockEdition.onSound(bot, (name, position) => heard.push([name, position]));
    const at = { x: 3.5, y: -59, z: 1.5 };
    bot._client.emit('level_sound_event', { sound_id: 'spawn', position: at, entity_type: 'minecraft:cow' }); // makes no noise
    bot._client.emit('level_sound_event', { sound_id: 'fuse', position: at, entity_type: 'minecraft:creeper' });
    bot._client.emit('level_sound_event', { sound_id: 'bow', position: at, entity_type: 'minecraft:skeleton' }); // a shot
    bot._client.emit('level_sound_event', { sound_id: 'place', position: at, entity_type: '' });             // a block, not a mob
    bot._client.emit('entity_event', { runtime_entity_id: '40', event_id: 'hurt_animation', data: 4 });      // sent as a big number
    bot._client.emit('entity_event', { runtime_entity_id: '40', event_id: 'death_animation', data: 0 });
    bot._client.emit('entity_event', { runtime_entity_id: '40', event_id: 'eat_grass_animation', data: 0 }); // silent
    bot._client.emit('entity_event', { runtime_entity_id: '1', event_id: 'hurt_animation', data: 4 });       // the bot itself
    bot._client.emit('entity_event', { runtime_entity_id: '77', event_id: 'hurt_animation', data: 4 });      // nothing it knows of
    assert.deepEqual(heard.map(([name]) => name), ['entity.creeper.primed', 'entity.skeleton.shoot', 'entity.cow.hurt', 'entity.cow.death']);
    assert.deepEqual(heard[0][1], at);
    assert.deepEqual(heard[2][1], bot.entities[40].position);
    // Doors, chests and blasts are played at a spot, and named as Java names them.
    heard.length = 0;
    bot._client.emit('level_sound_event', { sound_id: 'door_open', position: at, entity_type: '' });
    bot._client.emit('level_sound_event', { sound_id: 'chest_closed', position: at, entity_type: '' });
    bot._client.emit('level_sound_event', { sound_id: 'explode', position: at, entity_type: 'minecraft:creeper' });
    assert.deepEqual(heard.map(([name]) => name), ['block.wooden_door.open', 'block.chest.close', 'entity.generic.explode']);
    stop();
    assert.deepEqual(['level_sound_event', 'entity_event'].map(p => bot._client.listenerCount(p)), [0, 0]);
});

test('perception turns a Bedrock cry into what a player would make of it', { skip: needsBedrockLibraries }, () => {
    const registry = bedrockRegistry();
    const bot = Object.assign(bedrockBot(registry, flatColumns(registry), [0.5, -60, 0.5]), { _client: new EventEmitter() });
    bot.entities[40] = { id: 40, name: 'creeper', type: 'hostile', position: new Vec3(0.5, -60, -9.5), height: 1.7 };
    const perception = createPerception({ bot, policy: resolvePolicy({ fair_play: 'strict' }), searchBudgetMs: Infinity, tickBudgetMs: Infinity });
    perception.start();
    bot._client.emit('entity_event', { runtime_entity_id: '40', event_id: 'hurt_animation', data: 4 });
    bot._client.emit('level_sound_event', { sound_id: 'fuse', position: { x: 0.5, y: -60, z: -9.5 }, entity_type: 'minecraft:creeper' });
    const heard = perception.heard().map(h => `${h.subject} (${h.direction}, ${h.distance})`).sort();
    perception.stop();
    assert.deepEqual(heard, ['creeper (hissing) (north, close)', 'creeper (north, close)']);
});

test('the operator level comes from the permissions a Bedrock server gives', () => {
    const bot = listeningBot();
    const levels = [];
    const stop = bedrockEdition.onOperatorLevel(bot, level => levels.push(level));
    bot.emit('abilities', { permissionLevel: 'member', commandPermission: 'normal' });
    bot.emit('abilities', { permissionLevel: 'operator', commandPermission: 'normal' });
    bot.emit('abilities', { permissionLevel: 'operator', commandPermission: 'operator' });
    bot.emit('abilities', { permissionLevel: 'custom', commandPermission: 'owner' });
    bot.emit('abilities', { permissionLevel: 'visitor' });
    assert.deepEqual(levels, [0, 1, 1, 4, 0]);
    stop();
    assert.equal(bot.listenerCount('abilities'), 0);
});
