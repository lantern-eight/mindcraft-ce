// SPDX-License-Identifier: CC0-1.0
// The edition seam (src/agent/edition/): how block states are numbered and how a chunk section lists its
// blocks, asked for by name. Fair play's sight, its block search and world memory's look-around all stand
// on these answers, so a wrong one shows up as a bot that sees through walls or finds nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import registryFactory from 'prismarine-registry';
import chunkFactory from 'prismarine-chunk';
import { editionOf, registerEdition } from '../src/agent/edition/index.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { lazyStateTable, scanSection } from '../src/agent/fairplay/block_scan.js';
import { GAME_VERSION } from './helpers/game_version.js';

test('Java game data gets the Java answers, and so does game data built by hand', () => {
    assert.equal(editionOf(minecraftData(GAME_VERSION)), javaEdition);
    assert.equal(editionOf(registryFactory(GAME_VERSION)), javaEdition);
    assert.equal(editionOf({ blocksArray: [] }), javaEdition);
});

test('game data of an edition nobody registered is refused, not read as Java', () => {
    assert.throws(() => editionOf({ version: { type: 'unheard_of' } }), /"unheard_of" edition/);
    const answers = { name: 'test' };
    registerEdition('test_only', answers);
    assert.equal(editionOf({ version: { type: 'test_only' } }), answers);
});

test('a state table starts empty, keeps an entry per block state, and reads unknown numbers as 0', () => {
    const registry = minecraftData(GAME_VERSION);
    const table = javaEdition.stateTable(registry);
    const slab = registry.blocksByName.oak_slab;
    assert.equal(table.get(slab.defaultState), 0);
    table.setBlock(slab, 1);
    for (const stateId of javaEdition.stateIdsOf(slab)) assert.equal(table.get(stateId), 1);
    assert.equal(table.get(slab.minStateId - 1), 0, 'the block before is untouched');
    assert.equal(table.get(slab.maxStateId + 1), 0, 'the block after is untouched');
    table.set(registry.blocksByName.stone.defaultState, 7);
    assert.equal(table.get(registry.blocksByName.stone.defaultState), 7);
    // Numbers no state has: past the end, negative, missing.
    table.set(-5, 1);
    for (const stateId of [-5, 1e9, undefined, null]) assert.equal(table.get(stateId), 0, String(stateId));
});

test('state ids of a block come in the order game data lists per-state facts', () => {
    const registry = minecraftData(GAME_VERSION);
    const stairs = registry.blocksByName.oak_stairs;
    const ids = javaEdition.stateIdsOf(stairs);
    assert.equal(ids.length, stairs.maxStateId - stairs.minStateId + 1);
    assert.equal(ids[0], stairs.minStateId);
    assert.equal(ids.at(-1), stairs.maxStateId);
    // Sight pairs each id with the collision shape at the same place in this list.
    assert.equal(registry.blockCollisionShapes.blocks.oak_stairs.length, ids.length);
});

test('a lazy table asks once per state, and never keeps an answer for a number no state has', () => {
    const registry = minecraftData(GAME_VERSION);
    const asked = [];
    const isStone = lazyStateTable(registry, stateId => { asked.push(stateId); return registry.blocksByStateId[stateId]?.name === 'stone'; });
    const stone = registry.blocksByName.stone.defaultState, dirt = registry.blocksByName.dirt.defaultState;
    assert.equal(isStone(stone), true);
    assert.equal(isStone(stone), true);
    assert.equal(isStone(dirt), false);
    assert.equal(isStone(dirt), false);
    assert.deepEqual(asked, [stone, dirt]);
    assert.equal(isStone(-1), false);
});

test('a real chunk section is summarised and skipped when it holds nothing wanted', () => {
    const registry = registryFactory(GAME_VERSION);
    const Chunk = chunkFactory(registry);
    const column = new Chunk({ minY: -64, worldHeight: 384 });
    const stone = registry.blocksByName.stone.defaultState, ore = registry.blocksByName.diamond_ore.defaultState;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) column.setBlockStateId(new Vec3(x, 64, z), stone);
    column.setBlockStateId(new Vec3(3, 65, 4), ore);

    assert.equal(javaEdition.readStateId(column, { x: 3, y: 65, z: 4 }), ore);
    assert.equal(javaEdition.readStateId(column, { x: 3, y: 66, z: 4 }), registry.blocksByName.air.defaultState);

    const summary = javaEdition.sectionSummary(column, 4, -64); // the section from y 64 to 79
    assert.equal(summary.empty, false);
    assert.ok(summary.states.includes(stone) && summary.states.includes(ore));

    const visit = (wanted) => {
        const found = [];
        scanSection(javaEdition, column, 0, 4, 0, -64, wanted, (x, y, z) => found.push([x, y, z]));
        return found;
    };
    assert.deepEqual(visit(id => id === ore), [[3, 65, 4]]);
    // Gold isn't in the palette, so the section's 4096 cells are never read.
    const gold = registry.blocksByName.gold_ore.defaultState;
    let reads = 0;
    const counting = { sections: column.sections, getBlockStateId: pos => { reads++; return column.getBlockStateId(pos); } };
    scanSection(javaEdition, counting, 0, 4, 0, -64, id => id === gold, () => {});
    assert.equal(reads, 0);
});

test('sounds are heard by name and place, from all three Java sound packets, until told to stop', () => {
    const registry = minecraftData(GAME_VERSION);
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = registry;
    bot.entities = { 7: { position: { x: 1, y: 2, z: 3 } } };
    const heard = [];
    const stop = javaEdition.onSound(bot, (name, position) => heard.push([name, position]));
    const moo = registry.soundsByName['entity.cow.ambient'];
    const protocolId = moo.id - (registry.soundsArray[0].id); // the protocol counts the list from 0
    bot._client.emit('sound_effect', { sound: { soundId: protocolId }, x: 80, y: 16, z: -8 });
    bot._client.emit('named_sound_effect', { soundName: 'minecraft:entity.zombie.ambient', x: 8, y: 8, z: 8 });
    bot._client.emit('entity_sound_effect', { soundId: protocolId, entityId: 7 });
    assert.deepEqual(heard, [
        ['entity.cow.ambient', { x: 10, y: 2, z: -1 }],
        ['minecraft:entity.zombie.ambient', { x: 1, y: 1, z: 1 }],
        ['entity.cow.ambient', { x: 1, y: 2, z: 3 }],
    ]);
    stop();
    assert.deepEqual(['sound_effect', 'named_sound_effect', 'entity_sound_effect'].map(p => bot._client.listenerCount(p)), [0, 0, 0]);
});

test('the operator level comes from the status a Java server sets on the bot itself', () => {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.entity = { id: 5 };
    const levels = [];
    const stop = javaEdition.onOperatorLevel(bot, level => levels.push(level));
    bot._client.emit('entity_status', { entityId: 99, entityStatus: 28 }); // someone else
    bot._client.emit('entity_status', { entityId: 5, entityStatus: 3 });   // not about operators
    bot._client.emit('entity_status', { entityId: 5, entityStatus: 26 });
    bot._client.emit('entity_status', { entityId: 5, entityStatus: 24 });
    assert.deepEqual(levels, [2, 0]);
    stop();
    assert.equal(bot._client.listenerCount('entity_status'), 0);
});

test('Java keeps a double chest\'s pairing in the state, so there is nothing more to say about the other half', () => {
    assert.equal(javaEdition.otherHalfOf({ position: { x: 0, y: 64, z: 0 }, entity: { pairx: 1 } }), null);
});

test('a stack is moved with three clicks, the last only when something is left on the cursor', async () => {
    const clicks = [];
    const window = { selectedItem: null };
    const bot = { clickWindow: async (slot, button, mode) => { clicks.push([slot, button, mode]); } };
    await javaEdition.moveStack(bot, window, 3, 40);
    assert.deepEqual(clicks, [[3, 0, 0], [40, 0, 0]], 'put down or poured in whole: two clicks');
    clicks.length = 0;
    bot.clickWindow = async (slot, button, mode) => {
        clicks.push([slot, button, mode]);
        window.selectedItem = clicks.length === 2 ? { name: 'dirt', count: 5 } : null; // a swap leaves the other stack in hand
    };
    await javaEdition.moveStack(bot, window, 3, 40);
    assert.deepEqual(clicks, [[3, 0, 0], [40, 0, 0], [3, 0, 0]], 'what came off goes back where the move began');
});
