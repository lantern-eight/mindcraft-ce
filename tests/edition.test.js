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
import blockFactory from 'prismarine-block';
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
    assert.deepEqual(['sound_effect', 'named_sound_effect', 'entity_sound_effect', 'explosion'].map(p => bot._client.listenerCount(p)), [0, 0, 0, 0]);
});

test("an explosion is heard where it went off, from the sound inside the explosion packet (Java 1.21.2 and later)", () => {
    const registry = minecraftData(GAME_VERSION);
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.registry = registry;
    const heard = [];
    javaEdition.onSound(bot, (name, position) => heard.push([name, position]));
    const boom = registry.soundsByName['entity.generic.explode'];
    bot._client.emit('explosion', { center: { x: 4.5, y: 70, z: -2.5 }, radius: 3, sound: { soundId: boom.id - registry.soundsArray[0].id } });
    // An older server's explosion packet carries no sound: it sends one in a sound packet of its own.
    bot._client.emit('explosion', { x: 4.5, y: 70, z: -2.5, radius: 3 });
    // And one that says not to play it makes none.
    bot._client.emit('explosion', { center: { x: 9, y: 70, z: 9 }, radius: 3, sound: { soundId: boom.id - registry.soundsArray[0].id }, playSound: false });
    assert.deepEqual(heard, [['entity.generic.explode', { x: 4.5, y: 70, z: -2.5 }]]);
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

test('Java\'s signs read their own text, which the seam passes on side by side', () => {
    assert.deepEqual(javaEdition.signSidesOf({ getSignText: () => ['Wheat\nfarm', ''] }), ['Wheat\nfarm', '']);
    assert.deepEqual(javaEdition.signSidesOf({ name: 'stone' }), [], 'a block with no text');
    assert.deepEqual(javaEdition.signSidesOf(null), [], 'nothing there');
});

test('Java keeps a mob\'s age in its metadata, at index 16', () => {
    assert.equal(javaEdition.isBaby({ name: 'cow', metadata: { 16: true } }), true);
    assert.equal(javaEdition.isBaby({ name: 'cow', metadata: { 16: false } }), false);
    assert.equal(javaEdition.isBaby({ name: 'cow', metadata: [] }), false, 'nothing said: grown');
    assert.equal(javaEdition.isBaby({ name: 'cow' }), false, 'no metadata at all');
});

test('Java reads a creeper\'s lit fuse from its metadata, found by the entry\'s name', () => {
    const registry = minecraftData(GAME_VERSION);
    const keys = registry.entitiesByName.creeper.metadataKeys;
    const swell = keys.indexOf('swell_dir'), ignited = keys.indexOf('is_ignited');
    assert.ok(swell > 0 && ignited > 0, 'the game data names both entries');
    const creeper = entries => ({ name: 'creeper', metadata: Object.fromEntries(entries) });
    assert.equal(javaEdition.isFusing(registry, creeper([[swell, 1]])), true, 'the fuse burns');
    assert.equal(javaEdition.isFusing(registry, creeper([[swell, -1]])), false, 'the fuse runs back down');
    assert.equal(javaEdition.isFusing(registry, creeper([[swell, -1], [ignited, true]])), true, 'lit with flint and steel');
    assert.equal(javaEdition.isFusing(registry, creeper([])), false, 'nothing said yet');
    assert.equal(javaEdition.isFusing(registry, { name: 'zombie', metadata: { [swell]: 1 } }), false, 'only a creeper has a fuse');
    // An older game whose list put the entry elsewhere is still read by name.
    const shifted = { entitiesByName: { creeper: { metadataKeys: ['a', 'swell_dir'] } } };
    assert.equal(javaEdition.isFusing(shifted, creeper([[1, 1]])), true);
    assert.equal(javaEdition.isFusing({}, creeper([[swell, 1]])), false, 'game data with no creeper: never lit');
});

test('Java reads a ranged mob\'s aim from its metadata, found by name', () => {
    const registry = minecraftData(GAME_VERSION);
    const at = (kind, name) => registry.entitiesByName[kind].metadataKeys.indexOf(name);
    const mob = (kind, entries, extra = {}) => ({ name: kind, metadata: Object.fromEntries(entries), ...extra });
    // A skeleton raises its bow at a target (aggressive), and draws it (hand active).
    assert.equal(javaEdition.isAiming(registry, mob('skeleton', [[at('skeleton', 'mob_flags'), 0x04]])), true, 'bow raised');
    assert.equal(javaEdition.isAiming(registry, mob('skeleton', [[at('skeleton', 'living_entity_flags'), 0x01]])), true, 'bow drawn');
    assert.equal(javaEdition.isAiming(registry, mob('skeleton', [[at('skeleton', 'mob_flags'), 0x02]])), false, 'only left-handed');
    assert.equal(javaEdition.isAiming(registry, mob('stray', [])), false, 'nothing said: not aiming');
    // A pillager loads its crossbow, then holds it up loaded.
    assert.equal(javaEdition.isAiming(registry, mob('pillager', [[at('pillager', 'is_charging_crossbow'), true]])), true, 'loading');
    assert.equal(javaEdition.isAiming(registry, mob('pillager', [[at('pillager', 'mob_flags'), 0x04]])), true, 'held up');
    // A piglin aims only with a crossbow in its hand; with a sword it fights up close.
    const piglinAngry = [[at('piglin', 'mob_flags'), 0x04]];
    assert.equal(javaEdition.isAiming(registry, mob('piglin', piglinAngry, { heldItem: { name: 'crossbow' } })), true);
    assert.equal(javaEdition.isAiming(registry, mob('piglin', piglinAngry, { heldItem: { name: 'golden_sword' } })), false);
    assert.equal(javaEdition.isAiming(registry, mob('ghast', [[at('ghast', 'is_charging'), true]])), true, 'a ghast opens its mouth');
    assert.equal(javaEdition.isAiming(registry, mob('blaze', [[at('blaze', 'flags'), 0x01]])), true, 'a blaze glows');
    // A zombie coming for the bot is aggressive, but has nothing to aim.
    assert.equal(javaEdition.isAiming(registry, mob('zombie', [[at('zombie', 'mob_flags'), 0x04]])), false);
    assert.equal(javaEdition.isAiming(registry, null), false);
});

test('Java reads a shot about to be loosed: a bow drawn, a crossbow loading or held up, a ghast or blaze winding up', () => {
    const registry = minecraftData(GAME_VERSION);
    const at = (kind, name) => registry.entitiesByName[kind].metadataKeys.indexOf(name);
    const mob = (kind, entries, extra = {}) => ({ name: kind, metadata: Object.fromEntries(entries), ...extra });
    // A skeleton holds its bow up all the while it has a target; it draws it for a second before each shot.
    assert.equal(javaEdition.isDrawing(registry, mob('skeleton', [[at('skeleton', 'living_entity_flags'), 0x01]])), true, 'bow drawn');
    assert.equal(javaEdition.isDrawing(registry, mob('skeleton', [[at('skeleton', 'mob_flags'), 0x04]])), false, 'only held up');
    assert.equal(javaEdition.isDrawing(registry, mob('bogged', [[at('bogged', 'living_entity_flags'), 0x01]])), true);
    // A crossbow shows nothing between loaded and loosed: held up loaded is about to fire.
    assert.equal(javaEdition.isDrawing(registry, mob('pillager', [[at('pillager', 'is_charging_crossbow'), true]])), true, 'loading');
    assert.equal(javaEdition.isDrawing(registry, mob('pillager', [[at('pillager', 'mob_flags'), 0x04]])), true, 'held up');
    assert.equal(javaEdition.isDrawing(registry, mob('ghast', [[at('ghast', 'is_charging'), true]])), true);
    assert.equal(javaEdition.isDrawing(registry, mob('blaze', [[at('blaze', 'flags'), 0x01]])), true);
    // A zombie's arms out are no shot, and a drawn hand on a mob with no bow is something else.
    assert.equal(javaEdition.isDrawing(registry, mob('zombie', [[at('zombie', 'living_entity_flags'), 0x01]])), false);
    assert.equal(javaEdition.isDrawing(registry, null), false);
});

test('Java gives no beat to an archer\'s shots: its draw is there to see', () => {
    assert.equal(javaEdition.shotBeatMs('skeleton', 'normal'), null);
});

test('Java raises the shield by using the off-hand, and lowers it by letting go', () => {
    const calls = [];
    const bot = { activateItem: offHand => calls.push(['use', offHand]), deactivateItem: () => calls.push(['let go']) };
    javaEdition.raiseShield(bot, true);
    javaEdition.raiseShield(bot, false);
    assert.deepEqual(calls, [['use', true], ['let go']]);
});

test('Java reads whether a mob has a target from the aggressive bit of its mob flags', () => {
    const registry = minecraftData(GAME_VERSION);
    const flags = registry.entitiesByName.zombie.metadataKeys.indexOf('mob_flags');
    assert.ok(flags > 0, 'the game data names the entry');
    assert.equal(javaEdition.isAggressive(registry, { name: 'zombie', metadata: { [flags]: 0x04 } }), true, 'arms out');
    assert.equal(javaEdition.isAggressive(registry, { name: 'zombie', metadata: { [flags]: 0x06 } }), true, 'left-handed too');
    assert.equal(javaEdition.isAggressive(registry, { name: 'zombie', metadata: { [flags]: 0x02 } }), false);
    assert.equal(javaEdition.isAggressive(registry, { name: 'zombie', metadata: {} }), false, 'nothing said yet');
    assert.equal(javaEdition.isAggressive(registry, { name: 'no_such_mob', metadata: { [flags]: 0x04 } }), false, 'a kind the game data lacks');
});

test('Java tells the bot which way a hit came from, turned from the angle to where it faces', () => {
    const listeners = {};
    // mineflayer's yaw 0 faces north (-z); the game's is 180 there.
    const bot = { entity: { id: 5, yaw: 0 }, _client: { on: (name, fn) => { listeners[name] = fn; }, off() {} } };
    const felt = [];
    javaEdition.onHurt(bot, hit => felt.push(hit.direction));
    const round = v => ({ x: Math.round(v.x * 100) / 100 + 0, z: Math.round(v.z * 100) / 100 + 0 });
    // Facing north, a hit at the game's angle -90 from it came from the game's 90: south (+z), behind.
    listeners.hurt_animation({ entityId: 5, yaw: -90 });
    assert.deepEqual(round(felt[0]), { x: 0, z: 1 });
    // Facing east (mineflayer -90 degrees, the game's 270), the same angle comes from the game's 180: west.
    bot.entity.yaw = -Math.PI / 2;
    listeners.hurt_animation({ entityId: 5, yaw: -90 });
    assert.deepEqual(round(felt[1]), { x: -1, z: 0 });
    listeners.hurt_animation({ entityId: 6, yaw: 0 });
    assert.equal(felt.length, 2, 'another mob\'s hurt is not the bot\'s');
});

test('a hit is measured from the facing the bot last sent the server, not the one it shows', () => {
    const listeners = {}, written = [];
    const bot = {
        entity: { id: 5, yaw: Math.PI }, // shown turned south already
        _client: { on: (name, fn) => { listeners[name] = fn; }, off() {}, write: (name, params) => written.push(name) },
    };
    const felt = [];
    javaEdition.onHurt(bot, hit => felt.push(hit.direction));
    bot._client.write('look', { yaw: 180, pitch: 0, flags: {} }); // but the server last heard north
    assert.deepEqual(written, ['look'], 'the packet still goes out');
    listeners.hurt_animation({ entityId: 5, yaw: -90 });
    assert.ok(felt[0].z > 0.99, `from the south, measured from north: ${JSON.stringify(felt[0])}`);
    // A teleport sets the bot facing east (mineflayer -90 degrees, the game's 270) without the bot writing it.
    bot.entity.yaw = -Math.PI / 2;
    listeners.position({});
    listeners.hurt_animation({ entityId: 5, yaw: -90 });
    assert.ok(felt[1].x < -0.99, `from the west, measured from east: ${JSON.stringify(felt[1])}`);
});

test('Java keeps a villager\'s job and level together in one metadata entry, and its age at 16', () => {
    const librarian = { name: 'villager', metadata: { 16: false, 18: { villagerType: 2, villagerProfession: 9, level: 3 } } };
    assert.deepEqual(javaEdition.villagerOf(librarian), { baby: false, profession: 'librarian', level: 3 });
    const child = { name: 'villager', metadata: { 16: true, 18: { villagerType: 0, villagerProfession: 0, level: 1 } } };
    assert.deepEqual(javaEdition.villagerOf(child), { baby: true, profession: 'unemployed', level: 1 });
    // 26.1 added an entry before it, which moved it to 19.
    const mason26 = [];
    mason26[16] = false;
    mason26[19] = { villagerType: 0, villagerProfession: 10, level: 1 };
    mason26[20] = true;
    assert.deepEqual(javaEdition.villagerOf({ name: 'villager', metadata: mason26 }), { baby: false, profession: 'mason', level: 1 });
    // Versions before 1.14 sent only the job's number.
    assert.deepEqual(javaEdition.villagerOf({ name: 'villager', metadata: { 18: 10 } }), { baby: false, profession: 'mason', level: null });
    assert.deepEqual(javaEdition.villagerOf({ name: 'villager', metadata: {} }), { baby: false, profession: null, level: null }, 'not said yet');
    assert.deepEqual(javaEdition.villagerOf({ name: 'villager', metadata: { 18: { villagerProfession: 99, level: 1 } } }), { baby: false, profession: null, level: 1 }, 'a job this list lacks');
    assert.equal(javaEdition.villagerOf({ name: 'wandering_trader', metadata: {} }), null, 'trades, but is not a villager');
    assert.equal(javaEdition.villagerOf({ name: 'cow', metadata: { 16: true } }), null);
    assert.equal(javaEdition.villagerOf(null), null);
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

test('a survival player on Java reaches 4.5 blocks to a block and 3 to a mob', () => {
    assert.deepEqual(javaEdition.survivalReach(), { blocks: 4.5, entities: 3 });
});

test('a melee hit on Java: each weapon\'s damage, and a recharge of a second over its attack speed', () => {
    assert.deepEqual(javaEdition.meleeOf('iron_sword'), { damage: 6, rechargeMs: 625 });
    assert.deepEqual(javaEdition.meleeOf('copper_sword'), { damage: 5, rechargeMs: 625 }, 'copper, which mineflayer-pvp\'s table lacks');
    assert.deepEqual(javaEdition.meleeOf('iron_axe'), { damage: 9, rechargeMs: 1111 });
    assert.deepEqual(javaEdition.meleeOf('wooden_axe'), { damage: 7, rechargeMs: 1250 });
    assert.deepEqual(javaEdition.meleeOf('netherite_axe'), { damage: 10, rechargeMs: 1000 });
    assert.deepEqual(javaEdition.meleeOf('diamond_pickaxe'), { damage: 5, rechargeMs: 833 });
    assert.deepEqual(javaEdition.meleeOf('mace'), { damage: 6, rechargeMs: 1667 });
    for (const bare of [undefined, null, 'dirt', 'wooden_hoe'])
        assert.deepEqual(javaEdition.meleeOf(bare), { damage: 1, rechargeMs: 250 }, `${bare} hits as a bare hand`);
});

test('a Java block\'s name in Java\'s terms is its own', () => {
    const registry = minecraftData(GAME_VERSION);
    for (const name of ['snow', 'water', 'powered_rail', 'not_a_block']) assert.equal(javaEdition.javaNameOf(registry, name), name);
});

test('a Java furnace says it is lit by its `lit` property, read from the real block', () => {
    const Block = blockFactory(registryFactory(GAME_VERSION));
    const block = (name, props) => Block.fromProperties(name, props, 0);
    assert.deepEqual(javaEdition.furnaceOf(block('furnace', { facing: 'north', lit: true })), { kind: 'furnace', lit: true });
    assert.deepEqual(javaEdition.furnaceOf(block('smoker', { facing: 'east', lit: false })), { kind: 'smoker', lit: false });
    assert.deepEqual(javaEdition.furnaceOf(block('blast_furnace', { facing: 'south', lit: false })), { kind: 'blast_furnace', lit: false });
    assert.equal(javaEdition.furnaceOf(block('chest', { facing: 'north', type: 'single', waterlogged: false })), null);
    assert.equal(javaEdition.furnaceOf(null), null);
    // A block remembered without its state reads as not lit.
    assert.deepEqual(javaEdition.furnaceOf({ name: 'furnace' }), { kind: 'furnace', lit: false });
});

test('a Java cauldron says what it holds by its name, and how full by its level', () => {
    const Block = blockFactory(registryFactory(GAME_VERSION));
    const block = (name, props = {}) => Block.fromProperties(name, props, 0);
    assert.deepEqual(javaEdition.cauldronOf(block('lava_cauldron')), { liquid: 'lava', full: true });
    assert.deepEqual(javaEdition.cauldronOf(block('cauldron')), { liquid: null, full: false });
    assert.deepEqual(javaEdition.cauldronOf(block('water_cauldron', { level: 3 })), { liquid: 'water', full: true });
    assert.deepEqual(javaEdition.cauldronOf(block('water_cauldron', { level: 2 })), { liquid: 'water', full: false });
    assert.deepEqual(javaEdition.cauldronOf(block('powder_snow_cauldron', { level: 1 })), { liquid: 'powder_snow', full: false });
    assert.equal(javaEdition.cauldronOf(block('furnace', { facing: 'north', lit: false })), null);
    assert.equal(javaEdition.cauldronOf(null), null);
});
