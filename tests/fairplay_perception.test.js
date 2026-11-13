// Perception: what the bot knows right now. Touch, sight, memory, hearing, and the name-tag rule,
// tested on small hand-built worlds with a stand-in bot (tests/helpers/fixture_world.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { createPerception, describeDirection, soundSubject } from '../src/agent/fairplay/perception.js';
import { createSeenMap } from '../src/agent/fairplay/seen_map.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';

const STRICT = resolvePolicy({ fair_play: 'strict' });

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

function setup(build, { policy = STRICT, entities = [], now = clock(), options = {} } = {}) {
    const world = fixtureWorld({ min: [-24, -4, -24], max: [24, 24, 24] });
    world.fill('stone', [-24, 0, -24], [24, 0, 24]); // floor
    build(world);
    const bot = stubBot(world, { entities });
    const seenMap = createSeenMap({ scope: 'test', now });
    // No getStateId is passed, so these tests also exercise the reader that perception uses on a live bot.
    const perception = createPerception({ bot, policy, seenMap, now, ...NO_BUDGETS, ...options });
    return { world, bot, seenMap, perception, now };
}

const at = (x, y, z) => new Vec3(x, y, z);
const diamond = w => w.registry.blocksByName.diamond_ore.id;

test('blockAt: a buried ore is unknown, an ore in plain view is known and remembered', () => {
    const { perception, seenMap } = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0); // buried
        w.set('diamond_ore', 4, 2, -3); // standing alone, in view
    });
    assert.equal(perception.blockAt(at(6, 3, 0)), null);
    assert.equal(perception.blockAt(at(4, 2, -3)).name, 'diamond_ore');
    assert.equal(seenMap.get(4, 2, -3)?.name, 'diamond_ore', 'seeing a notable block records it');
    assert.equal(seenMap.get(6, 3, 0), null);
});

test('touch: blocks around a bot sealed in a tiny hole are known; the diagonal ones are not', () => {
    const { perception } = setup(w => {
        w.fill('dirt', [-1, 1, -1], [1, 3, 1]);
        w.fill('air', [0, 1, 0], [0, 2, 0]); // the bot's own two cells
        w.set('iron_ore', 1, 2, 0); // beside its head
        w.set('coal_ore', 1, 2, 1); // diagonal: not touching, not visible
    });
    assert.equal(perception.blockAt(at(1, 2, 0)).name, 'iron_ore');
    assert.equal(perception.blockAt(at(0, 0, 0)).name, 'stone', 'the block underfoot');
    assert.equal(perception.blockAt(at(1, 2, 1)), null);
});

test('findBlocks returns only known blocks, nearest first, even when buried ones are closer', () => {
    const { world, perception } = setup(w => {
        w.fill('stone', [2, 1, -2], [4, 4, 2]);
        w.set('diamond_ore', 3, 2, 0); // buried, close
        w.set('diamond_ore', -10, 1, 0); // in the open on the other side, farther
    });
    const found = perception.findBlocks({ matching: diamond(world), maxDistance: 32, count: 5 });
    assert.deepEqual(found.map(p => [p.x, p.y, p.z]), [[-10, 1, 0]]);
});

test('findBlocks finds a block in plain view even when hundreds of buried ones are nearer', () => {
    // The bot stands on dirt with a thick slab of stone under it: every nearby stone is buried. A search
    // that only looked at the nearest few hundred candidates would give up before the one in view.
    const { world, perception } = setup(w => {
        w.fill('dirt', [-24, 0, -24], [24, 0, 24]);
        w.fill('stone', [-8, -3, -8], [8, -1, 8]); // 867 buried stone blocks right under the bot
        w.set('stone', 12, 1, 0); // one stone standing in the open, farther away
    });
    const stone = world.registry.blocksByName.stone.id;
    assert.deepEqual(perception.findBlocks({ matching: stone, maxDistance: 32, count: 1 }).map(p => [p.x, p.y, p.z]), [[12, 1, 0]]);
    assert.equal(perception.findBlocks({ matching: stone, maxDistance: 8, count: 5 }).length, 0, 'and none of the buried ones');
});

test('findBlocks takes a predicate, including one that looks at where the block is', () => {
    const { perception } = setup(w => {
        w.set('oak_log', 3, 1, 0);
        w.set('oak_log', 3, 2, 0);
        w.set('oak_log', -5, 1, 2);
    });
    const high = perception.findBlocks({ matching: b => b.name === 'oak_log' && b.position.y >= 2, maxDistance: 16, count: 10 });
    assert.deepEqual(high.map(p => [p.x, p.y, p.z]), [[3, 2, 0]]);
    const all = perception.findBlocks({ matching: b => b.name === 'oak_log', maxDistance: 16, count: 10 });
    assert.equal(all.length, 3);
    assert.deepEqual([all[0].x, all[0].y, all[0].z], [3, 1, 0], 'nearest first');
});

test('memory: a block seen earlier stays known out of view, exactly as it was seen, until the bot looks again', () => {
    const now = clock();
    const { world, bot, seenMap, perception } = setup(w => {
        w.set('chest', 6, 1, 0);
        w.fill('stone', [6, 1, 3], [6, 5, 8]); // a wall to hide behind, south of the chest
    }, { now });
    const chest = world.registry.blocksByName.chest.id;
    assert.equal(perception.blockAt(at(6, 1, 0)).name, 'chest');
    assert.equal(perception.blockAt(at(6, 1, 0)).rememberedAt, undefined, 'in view, it is the live block');
    bot.moveTo(6.5, 1, 10.5); // behind the wall
    assert.equal(perception.knowsCell(at(6, 1, 0)), true, 'remembered, though not visible now');
    world.set('air', 6, 1, 0); // someone takes the chest while the bot is away
    const believed = perception.blockAt(at(6, 1, 0));
    assert.equal(believed.name, 'chest', 'the bot still believes the chest is there');
    assert.equal(believed.rememberedAt, 1_000_000, 'and the answer is marked as memory');
    assert.deepEqual(perception.findBlocks({ matching: chest, maxDistance: 32, count: 3 }).map(p => p.x), [6]);
    assert.equal(seenMap.get(6, 1, 0).provenance, 'observed');
    bot.moveTo(0.5, 1, 0.5); // back in view
    now.advance(2000);
    perception.tick();
    assert.equal(seenMap.get(6, 1, 0).provenance, 'gone', 'looking again corrects memory');
    assert.equal(perception.blockAt(at(6, 1, 0)).name, 'air');
    assert.deepEqual(perception.findBlocks({ matching: chest, maxDistance: 32, count: 3 }), []);
});

test('memory never peeks at the live world: a crop that grew out of sight is remembered as it was', () => {
    const { world, bot, perception } = setup(w => {
        w.set('wheat', 6, 1, 0, { age: 0 });
        w.fill('stone', [6, 1, 3], [6, 5, 8]);
    });
    const young = world.stateIdOf('wheat', { age: 0 }), ripe = world.stateIdOf('wheat', { age: 7 });
    assert.equal(perception.blockAt(at(6, 1, 0)).stateId, young);
    bot.moveTo(6.5, 1, 10.5); // behind the wall
    world.set('wheat', 6, 1, 0, { age: 7 }); // it ripens while the bot isn't looking
    assert.equal(perception.blockAt(at(6, 1, 0)).stateId, young, 'still remembered as freshly planted');
    bot.moveTo(0.5, 1, 0.5);
    assert.equal(perception.blockAt(at(6, 1, 0)).stateId, ripe, 'seen again, the bot knows it is ripe');
});

test('place memory: a block seen earlier is still found after its chunk is no longer loaded', () => {
    const { world, bot, seenMap, perception } = setup(w => w.fill('sand', [20, 1, -1], [22, 1, 1]));
    const sand = world.registry.blocksByName.sand.id;
    perception.tick(); // the background pass notices the sand
    assert.equal(seenMap.count('sand'), 9);
    world.unload([16, -4, -24], [24, 24, 24]); // the bot walks off and that chunk unloads
    bot.emit('chunkColumnUnload'); // mineflayer announces it, which is what tells perception to look afresh
    const found = perception.findBlocks({ matching: sand, maxDistance: 64, count: 1 });
    assert.deepEqual(found.map(p => [p.x, p.y, p.z]), [[20, 1, 0]], 'nearest remembered sand');
    assert.equal(perception.blockAt(found[0]).name, 'sand');
    assert.ok(perception.blockAt(found[0]).rememberedAt);
    assert.equal(perception.blockAt(at(23, 1, 0)), null, 'a cell there the bot never saw stays unknown');
});

test('what digging uncovers is seen straight away, without the bot having to move', () => {
    const { world, bot, perception } = setup(w => {
        w.fill('stone', [3, 1, -2], [6, 4, 2]);
        w.set('iron_ore', 4, 2, 0); // one block behind the stone face at x 3
    });
    assert.equal(perception.blockAt(at(4, 2, 0)), null);
    world.set('air', 3, 2, 0); // the bot digs the block in front of the ore
    bot.emit('blockUpdate');
    assert.equal(perception.blockAt(at(4, 2, 0)).name, 'iron_ore');
});

test('tick records visible notable blocks (ores, sand) and skips buried ones', () => {
    const { seenMap, perception } = setup(w => {
        w.fill('sand', [8, 1, -2], [10, 1, 2]); // a sandy patch in the open
        w.fill('stone', [-8, 1, -2], [-4, 5, 2]);
        w.set('gold_ore', -6, 3, 0); // buried
        w.set('oak_log', 0, 1, 8);
    });
    perception.tick();
    assert.equal(seenMap.count('sand'), 15);
    assert.equal(seenMap.count('gold_ore'), 0);
    assert.equal(seenMap.count('oak_log'), 1);
    assert.equal(seenMap.isExplored({ x: 0, y: 1, z: 0 }), true);
});

test('the background pass is spread over several ticks, each stopping at its time budget', () => {
    // A clock that moves on 1 ms every time it is read, so a 3 ms budget allows about three steps per tick.
    let ms = 0;
    const { seenMap, perception } = setup(w => w.fill('sand', [8, 1, -2], [10, 1, 2]), { options: { clock: () => ms++, tickBudgetMs: 3 } });
    perception.tick();
    assert.ok(seenMap.count('sand') < 15, 'one tick is not enough');
    for (let i = 0; i < 200; i++) perception.tick();
    assert.equal(seenMap.count('sand'), 15, 'the pass finishes over later ticks');
});

test('stop() removes every listener perception added, so respawns do not pile them up', () => {
    const { world } = setup(() => {});
    const bot = stubBot(world);
    bot._client = new EventEmitter();
    const perception = createPerception({ bot, policy: STRICT, ...NO_BUDGETS });
    perception.start();
    const events = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload'];
    const packets = ['sound_effect', 'named_sound_effect', 'entity_sound_effect'];
    assert.ok(events.every(e => bot.listenerCount(e) > 0) && packets.every(p => bot._client.listenerCount(p) > 0));
    perception.stop();
    assert.deepEqual(events.map(e => bot.listenerCount(e)), [0, 0, 0]);
    assert.deepEqual(packets.map(p => bot._client.listenerCount(p)), [0, 0, 0]);
});

test('E1: a mob behind a wall is not perceived; one in view is', () => {
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: at(8.5, 1, 0.5), height: 1.95 };
    const cow = { id: 8, type: 'animal', name: 'cow', position: at(-6.5, 1, 0.5), height: 1.4 };
    const { perception } = setup(w => w.fill('stone', [4, 1, -3], [4, 6, 3]), { entities: [zombie, cow] });
    assert.deepEqual(perception.entities().map(e => e.name), ['cow']);
});

test('E4: a mob that slips out of view stays known for a moment, then is forgotten', () => {
    const now = clock();
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: at(8.5, 1, 0.5), height: 1.95 };
    const { world, perception } = setup(() => {}, { entities: [zombie], now });
    assert.equal(perception.entities().length, 1);
    world.fill('stone', [4, 1, -3], [4, 6, 3]); // a wall goes up between them
    now.advance(1000);
    assert.equal(perception.entities().length, 1, 'just slipped out of view');
    now.advance(5000);
    assert.equal(perception.entities().length, 0);
});

test('E3: name tags show standing players through walls within 64 blocks, but not sneaking ones', () => {
    const standing = { id: 9, type: 'player', username: 'Alex', position: at(10.5, 1, 0.5), height: 1.8, eyeHeight: 1.62 };
    const sneaking = { id: 10, type: 'player', username: 'Sam', position: at(10.5, 1, 4.5), height: 1.5, eyeHeight: 1.27 };
    const far = { id: 11, type: 'player', username: 'Kim', position: at(10.5, 1, 0.5).offset(70, 0, 0), height: 1.8, eyeHeight: 1.62 };
    const { perception } = setup(w => w.fill('stone', [4, 1, -6], [4, 6, 6]), { entities: [standing, sneaking, far] });
    assert.deepEqual(perception.entities().map(e => e.username), ['Alex']);
});

test('open_face sight sees ore in a sealed cave; ray sight does not', () => {
    const build = w => {
        w.fill('stone', [4, 1, -3], [14, 6, 3]);
        w.fill('air', [8, 2, 0], [10, 3, 0]);
        w.set('diamond_ore', 11, 2, 0);
    };
    const rays = setup(build);
    assert.equal(rays.perception.blockAt(at(11, 2, 0)), null);
    const openFace = setup(build, { policy: resolvePolicy({ fair_play: 'custom', fair_play_custom: { sight: 'open_face' } }) });
    assert.equal(openFace.perception.blockAt(at(11, 2, 0)).name, 'diamond_ore');
});

test('E2: hearing gives what and roughly where, never coordinates, and only within the hearing radius', () => {
    const now = clock();
    const { perception } = setup(() => {}, { now });
    perception.hearSound('minecraft:entity.zombie.ambient', at(6, 1, -6));
    perception.hearSound('minecraft:entity.creeper.primed', at(-3, 1, 0));
    perception.hearSound('minecraft:entity.skeleton.ambient', at(40, 1, 0)); // beyond 16 blocks
    const heard = perception.heard();
    assert.deepEqual(heard.map(h => h.subject).sort(), ['creeper (hissing)', 'zombie']);
    const zombie = heard.find(h => h.subject === 'zombie');
    assert.equal(zombie.direction, 'north-east');
    assert.equal(zombie.distance, 'close');
    for (const h of heard) assert.doesNotMatch(h.text, /\d/, 'no coordinates or exact distances');
    now.advance(20_000);
    assert.equal(perception.heard().length, 0, 'old sounds fade');
});

test('hearing reads the server\'s sound packets and names each sound from the right place in the list', () => {
    const { world } = setup(() => {});
    const cow = { id: 21, type: 'animal', name: 'cow', position: at(-4.5, 1, 0.5), height: 1.4 };
    const bot = stubBot(world, { entities: [cow] });
    bot._client = new EventEmitter();
    const perception = createPerception({ bot, policy: STRICT, ...NO_BUDGETS });
    perception.start();
    const sounds = world.registry.soundsByName, first = world.registry.soundsArray[0].id;
    // The protocol counts sounds from 0, wherever minecraft-data starts counting.
    const moo = sounds['entity.cow.ambient'].id - first;
    // The trap this avoids: indexing the table with that number directly gives a different sound.
    assert.notEqual(world.registry.sounds[moo]?.name, 'entity.cow.ambient');

    bot._client.emit('sound_effect', { sound: { soundId: moo }, x: 6 * 8, y: 1 * 8, z: 0 }); // a sound at a spot, by number
    bot._client.emit('sound_effect', { sound: { data: { soundName: 'minecraft:entity.zombie.ambient' } }, x: 0, y: 8, z: -6 * 8 }); // by name
    bot._client.emit('entity_sound_effect', { sound: { soundId: sounds['entity.creeper.primed'].id - first }, entityId: 21 }); // attached to an entity
    bot._client.emit('sound_effect', { sound: { soundId: sounds['entity.cow.ambient'].id - first }, x: 60 * 8, y: 8, z: 0 }); // too far to hear
    perception.stop();

    const heard = Object.fromEntries(perception.heard().map(h => [h.subject, h.direction]));
    assert.deepEqual(heard, { cow: 'east', zombie: 'north', 'creeper (hissing)': 'west' });
});

test('two of a kind in different directions are heard separately, and a source in view is marked seen', () => {
    const cow = { id: 21, type: 'animal', name: 'cow', position: at(-6.5, 1, 0.5), height: 1.4 }; // in plain view, to the west
    const { perception } = setup(w => w.fill('stone', [4, 1, -3], [4, 6, 3]), { entities: [cow] });
    perception.hearSound('entity.cow.ambient', cow.position);
    perception.hearSound('entity.cow.hurt', at(8.5, 1, 0.5)); // another cow, behind the wall to the east
    const heard = perception.heard().map(h => [h.subject, h.direction, h.seen]);
    assert.deepEqual(heard.sort(), [['cow', 'east', false], ['cow', 'west', true]]);
});

test('describeDirection and soundSubject', () => {
    const o = { x: 0, y: 64, z: 0 };
    assert.equal(describeDirection(o, { x: 0, y: 64, z: -10 }).direction, 'north');
    assert.equal(describeDirection(o, { x: 10, y: 64, z: 0 }).direction, 'east');
    assert.equal(describeDirection(o, { x: 0, y: 64, z: 10 }).direction, 'south');
    assert.equal(describeDirection(o, { x: -10, y: 64, z: 0 }).direction, 'west');
    assert.equal(describeDirection(o, { x: 0, y: 70, z: 0 }).direction, 'above');
    assert.equal(soundSubject('minecraft:entity.zombie.ambient'), 'zombie');
    assert.equal(soundSubject('entity.cave_spider.ambient'), 'cave_spider');
    assert.equal(soundSubject('minecraft:block.stone.break'), null);
    assert.equal(soundSubject('minecraft:entity.player.hurt'), null);
});
