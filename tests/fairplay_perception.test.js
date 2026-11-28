// SPDX-License-Identifier: CC0-1.0
// Perception: what the bot knows right now. Touch, sight, memory, hearing, and the name-tag rule,
// tested on small hand-built worlds with a stand-in bot (tests/helpers/fixture_world.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { createPerception, describeDirection, soundSubject } from '../src/agent/fairplay/perception.js';
import { openMemory } from '../src/agent/memory/store.js';
import { createRecorder } from '../src/agent/memory/recorder.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';

// Strict, but seeing all around: these scenes put things on every side of the bot to test something other
// than the view. The narrowed view, strict's own, has tests of its own.
const ALL_AROUND = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 360 } });

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

function setup(build, { policy = ALL_AROUND, entities = [], now = clock(), options = {} } = {}) {
    const world = fixtureWorld({ min: [-24, -4, -24], max: [24, 24, 24] });
    world.fill('stone', [-24, 0, -24], [24, 0, 24]); // floor
    build(world);
    const bot = stubBot(world, { entities });
    // Memory is world memory, as on a real bot: the recorder looks around and perception answers from it.
    let recorder = null;
    const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'perception-')), scope: 'test', now,
        canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory, now, tickBudgetMs: Infinity });
    // No getStateId is passed, so these tests also exercise the reader that perception uses on a live bot.
    const perception = createPerception({ bot, policy, memory: recorder.view, now, ...NO_BUDGETS, ...options });
    recorder.attach(perception);
    return { world, bot, remembered: recorder.view, recorder, perception, now };
}

const at = (x, y, z) => new Vec3(x, y, z);
const diamond = w => w.registry.blocksByName.diamond_ore.id;

test('blockAt: a buried ore is unknown, an ore in plain view is known and remembered', () => {
    const { perception, remembered } = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0); // buried
        w.set('diamond_ore', 4, 2, -3); // standing alone, in view
    });
    assert.equal(perception.blockAt(at(6, 3, 0)), null);
    assert.equal(perception.blockAt(at(4, 2, -3)).name, 'diamond_ore');
    assert.equal(remembered.get(4, 2, -3)?.name, 'diamond_ore', 'seeing a block records it');
    assert.equal(remembered.get(6, 3, 0), null);
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
    const { world, bot, remembered, recorder, perception } = setup(w => {
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
    assert.equal(remembered.get(6, 1, 0)?.name, 'chest');
    bot.moveTo(0.5, 1, 0.5); // back in view
    now.advance(2000);
    recorder.tick();
    assert.equal(remembered.get(6, 1, 0), null, 'looking again corrects memory');
    assert.equal(perception.blockAt(at(6, 1, 0)).name, 'air');
    assert.deepEqual(perception.findBlocks({ matching: chest, maxDistance: 32, count: 3 }), []);
});

test('memory: a predicate that turns away the cell the bot stands on still finds what it remembers elsewhere', () => {
    // Gathering excludes each block it has broken, and the bot often stands where one was. Whether a
    // remembered name could match at all must not be judged at the bot's own cell.
    const { bot, perception } = setup(w => {
        w.set('chest', 6, 1, 0);
        w.fill('stone', [6, 1, 3], [6, 5, 8]);
    });
    perception.findBlocks({ matching: () => true, maxDistance: 32, count: 100 }); // sees the chest
    bot.moveTo(6.5, 1, 10.5); // behind the wall: the chest is only remembered now
    const here = bot.entity.position.floored().toString();
    const matching = block => block.name === 'chest' && (!block.position || block.position.toString() !== here);
    assert.deepEqual(perception.findBlocks({ matching, maxDistance: 32, count: 3 }).map(p => [p.x, p.y, p.z]), [[6, 1, 0]]);
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

test('a crop remembered by name alone says nothing of how grown it is', () => {
    const { world, bot, remembered, recorder, perception } = setup(w => {
        w.set('wheat', 6, 1, 0, { age: 7 });
        w.fill('stone', [6, 1, 3], [6, 5, 8]);
    });
    recorder.tick(); // the look-around notes the wheat, by name
    assert.equal(remembered.get(6, 1, 0)?.name, 'wheat');
    bot.moveTo(6.5, 1, 10.5); // behind the wall
    const believed = perception.blockAt(at(6, 1, 0));
    assert.ok(believed?.rememberedAt !== undefined, 'only remembered');
    assert.deepEqual(believed.getProperties(), {}, 'not a seedling: its growth is unknown');
    bot.moveTo(0.5, 1, 0.5);
    assert.equal(perception.blockAt(at(6, 1, 0)).stateId, world.stateIdOf('wheat', { age: 7 }), 'seen again, it is the live block');
});

test('place memory: a block seen earlier is still found after its chunk is no longer loaded', () => {
    const { world, bot, remembered, recorder, perception } = setup(w => w.fill('sand', [20, 1, -1], [22, 1, 1]));
    const sand = world.registry.blocksByName.sand.id;
    recorder.tick(); // the look-around notices the sand
    assert.equal(remembered.recall({ names: ['sand'], point: { x: 0, y: 1, z: 0 }, maxDistance: 64, count: 100 }).length, 9);
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

test('stop() removes every listener perception added, so respawns do not pile them up', () => {
    const { world } = setup(() => {});
    const bot = stubBot(world);
    bot._client = new EventEmitter();
    const perception = createPerception({ bot, policy: ALL_AROUND, ...NO_BUDGETS });
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

test('a mob that slipped out of view is known where it was last seen, not where it has gone', () => {
    const now = clock();
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: at(8.5, 1, 0.5), height: 1.95, yaw: 1 };
    const { world, perception } = setup(() => {}, { entities: [zombie], now });
    assert.equal(perception.entities()[0], zombie, 'in view: the live mob');
    world.fill('stone', [4, 1, -3], [4, 6, 3]);
    zombie.position = at(12.5, 1, 3.5); // it walks on behind the wall
    now.advance(1000);
    const [standIn] = perception.entities();
    assert.notEqual(standIn, zombie);
    assert.deepEqual([standIn.position.x, standIn.position.z], [8.5, 0.5], 'where it was seen');
    assert.equal(standIn.id, 7);
    assert.equal(standIn.name, 'zombie');
    assert.ok(Object.isFrozen(standIn));
    assert.equal(perception.entities()[0], standIn, 'the same stand-in while it stays out of view');
    assert.equal(perception.liveOf(standIn), zombie);
    assert.equal(perception.liveOf(zombie), zombie);
    assert.equal(perception.seesEntity(standIn), false, 'judged where the mob is now');
    world.fill('air', [4, 1, -3], [4, 6, 3]); // back in view
    assert.equal(perception.entities()[0], zombie);
});

test('E3: name tags show standing players through walls within 64 blocks, but not sneaking ones', () => {
    const standing = { id: 9, type: 'player', username: 'Alex', position: at(10.5, 1, 0.5), height: 1.8, eyeHeight: 1.62 };
    const sneaking = { id: 10, type: 'player', username: 'Sam', position: at(10.5, 1, 4.5), height: 1.5, eyeHeight: 1.27 };
    const far = { id: 11, type: 'player', username: 'Kim', position: at(10.5, 1, 0.5).offset(70, 0, 0), height: 1.8, eyeHeight: 1.62 };
    const { perception } = setup(w => w.fill('stone', [4, 1, -6], [4, 6, 6]), { entities: [standing, sneaking, far] });
    assert.deepEqual(perception.entities().map(e => e.username), ['Alex']);
});

const NARROW = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 70 } });

test('a narrow view: what is behind the bot is unknown until it turns', () => {
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: at(0.5, 1, 8.5), height: 1.95 }; // south, behind
    const { bot, perception, world } = setup(w => w.set('diamond_ore', 0, 1, 6), { policy: NARROW, entities: [zombie] });
    // The stub bot faces north (yaw 0), so +z is behind it.
    assert.equal(perception.blockAt(at(0, 1, 6)), null, 'the ore behind');
    assert.deepEqual(perception.entities(), [], 'the zombie behind');
    assert.equal(perception.findBlocks({ matching: diamond(world), maxDistance: 16 }).length, 0);
    bot.entity.yaw = Math.PI; // turn round to face south
    bot.entity.pitch = -0.3;
    assert.equal(perception.blockAt(at(0, 1, 6))?.name, 'diamond_ore');
    assert.deepEqual(perception.entities().map(e => e.name), ['zombie']);
    assert.ok(perception.screenNow(), 'a screen while the view is narrow');
});

test('a narrow view: a point just behind the bot is touched, not seen', () => {
    const { bot, perception } = setup(() => {}, { policy: NARROW });
    // The bot stands at the origin facing north; the cell just south of it is within touch.
    const behind = at(0.5, 1.85, 1.5), ahead = at(0.5, 1.85, -2.5);
    assert.equal(perception.seesCell(behind), true, 'touch reaches the cell');
    assert.equal(perception.seesPoint(behind), false, 'but the eyes don\'t');
    assert.equal(perception.seesPoint(ahead), true);
    bot.entity.yaw = Math.PI; // facing south, looking a little down: it is 38 degrees below the eye
    bot.entity.pitch = -0.3;
    assert.equal(perception.seesPoint(behind), true);
});

test('a narrow view: what is heard says which side of the bot it came from, as well as which way', () => {
    const { bot, perception } = setup(() => {}, { policy: NARROW });
    perception.hearSound('minecraft:entity.zombie.ambient', at(0.5, 1, 8.5));   // south: behind the bot, facing north
    perception.hearSound('minecraft:entity.skeleton.ambient', at(-8.5, 1, 0.5)); // west: to its left
    perception.hearSound('minecraft:entity.spider.ambient', at(8.5, 1, 0.5));    // east: to its right
    perception.hearSound('minecraft:entity.cow.ambient', at(0.5, 1, -8.5));      // north: in front
    const said = Object.fromEntries(perception.heard().map(h => [h.subject, h.text]));
    assert.equal(said.zombie, 'behind you, south, close');
    assert.equal(said.skeleton, 'to your left, west, close');
    assert.equal(said.spider, 'to your right, east, close');
    assert.equal(said.cow, 'in front of you, north, close');
    assert.equal(perception.heard().find(h => h.subject === 'zombie').direction, 'south', 'the compass way is kept apart');
    bot.entity.yaw = Math.PI; // turned round
    assert.match(perception.heard().find(h => h.subject === 'zombie').text, /^in front of you/);
    const wide = setup(() => {});
    wide.perception.hearSound('minecraft:entity.zombie.ambient', at(0.5, 1, 8.5));
    assert.equal(wide.perception.heard()[0].text, 'south, close', 'seeing all around, the compass alone');
});

test('a narrow view: a name tag shows through walls only on screen', () => {
    const ahead = { id: 9, type: 'player', username: 'Alex', position: at(0.5, 1, -10.5), height: 1.8, eyeHeight: 1.62 };
    const behind = { id: 10, type: 'player', username: 'Sam', position: at(0.5, 1, 10.5), height: 1.8, eyeHeight: 1.62 };
    const walls = w => { w.fill('stone', [-6, 1, -5], [6, 8, -5]); w.fill('stone', [-6, 1, 5], [6, 8, 5]); };
    const { bot, perception } = setup(walls, { policy: NARROW, entities: [ahead, behind] });
    assert.deepEqual(perception.entities().map(e => e.username), ['Alex'], 'north, through the wall');
    bot.entity.yaw = Math.PI;
    assert.deepEqual(perception.entities().map(e => e.username).sort(), ['Alex', 'Sam'],
        'facing south: Sam\'s tag is on screen, and Alex is remembered a moment where last seen');
    const all = setup(walls, { entities: [ahead, behind] });
    assert.equal(all.perception.screenNow(), null, 'all around: no screen');
    assert.deepEqual(all.perception.entities().map(e => e.username).sort(), ['Alex', 'Sam'], 'all around, both');
});

test('entitiesInSightAnyWay: a mob in a clear line from the eye, whichever way the bot faces; not one behind a wall', () => {
    const open = { id: 7, type: 'hostile', name: 'enderman', position: at(0.5, 1, 10.5), height: 2.9 };
    const walled = { id: 8, type: 'hostile', name: 'enderman', position: at(10.5, 1, 0.5), height: 2.9 };
    const { perception } = setup(w => w.fill('stone', [5, 1, -3], [5, 8, 3]), { policy: NARROW, entities: [open, walled] });
    assert.deepEqual(perception.entities(), [], 'neither is in view facing north');
    assert.deepEqual(perception.entitiesInSightAnyWay(64).map(e => e.id), [7]);
    assert.deepEqual(perception.entitiesInSightAnyWay(5).map(e => e.id), [], 'too far');
});

// The wall rules hold through a player's screen too, once the bot faces the scene.
test('through a player\'s screen, facing them: a buried ore is unknown, an ore in view known; a mob behind a wall unseen', () => {
    const ores = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0); // buried
        w.set('diamond_ore', 4, 2, -3); // standing alone
    }, { policy: NARROW });
    ores.bot.entity.yaw = -Math.PI / 2; // facing east, at the stone
    assert.equal(ores.perception.blockAt(at(6, 3, 0)), null);
    assert.equal(ores.perception.blockAt(at(4, 2, -3))?.name, 'diamond_ore');
    assert.deepEqual(ores.perception.findBlocks({ matching: diamond(ores.world), maxDistance: 32, count: 5 }).map(p => p.toArray()), [[4, 2, -3]]);

    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: at(8.5, 1, 0.5), height: 1.95 };
    const pig = { id: 8, type: 'animal', name: 'pig', position: at(2.5, 1, 1.5), height: 0.9 };
    const mobs = setup(w => w.fill('stone', [4, 1, -3], [4, 6, 3]), { policy: NARROW, entities: [zombie, pig] });
    mobs.bot.entity.yaw = -Math.PI / 2;
    assert.deepEqual(mobs.perception.entities().map(e => e.name), ['pig'], 'the pig in front, not the zombie behind the wall');
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

test('a listener is told of each sound as it arrives, with direction and band only, never a position', () => {
    const now = clock();
    const { perception } = setup(() => {}, { now });
    const told = [];
    const stop = perception.onHeard(sound => told.push(sound));
    perception.hearSound('minecraft:entity.creeper.primed', at(-3, 1, 0));
    perception.hearSound('minecraft:entity.skeleton.ambient', at(40, 1, 0)); // beyond 16 blocks: not heard
    assert.equal(told.length, 1);
    const [hiss] = told;
    assert.deepEqual(Object.keys(hiss).sort(), ['direction', 'distance', 'news', 'seen', 'subject', 'text']);
    assert.equal(hiss.subject, 'creeper (hissing)');
    assert.equal(hiss.direction, 'west');
    assert.equal(hiss.distance, 'very close');
    assert.equal(hiss.news, true);
    assert.equal(hiss.seen, false, 'no creeper in view');
    assert.doesNotMatch(JSON.stringify(hiss), /-?\d+\.\d|"x"|"position"/, 'no coordinates anywhere in it');
    const { secondsAgo, ...listed } = perception.heard()[0];
    assert.deepEqual({ ...hiss }, listed, 'the same as heard() lists');
    stop();
    perception.hearSound('minecraft:entity.creeper.primed', at(-3, 1, 0));
    assert.equal(told.length, 1, 'stopped listening');
});

test('a listener that throws doesn\'t stop the sound being heard', () => {
    const { perception } = setup(() => {}, {});
    perception.onHeard(() => { throw new Error('boom'); });
    perception.hearSound('minecraft:entity.zombie.ambient', at(6, 1, -6));
    assert.equal(perception.heard().length, 1);
});

test('hearing reads the server\'s sound packets and names each sound from the right place in the list', () => {
    const { world } = setup(() => {});
    const cow = { id: 21, type: 'animal', name: 'cow', position: at(-4.5, 1, 0.5), height: 1.4 };
    const bot = stubBot(world, { entities: [cow] });
    bot._client = new EventEmitter();
    const perception = createPerception({ bot, policy: ALL_AROUND, ...NO_BUDGETS });
    perception.start();
    const sounds = world.registry.soundsByName, first = world.registry.soundsArray[0].id;
    // The protocol counts sounds from 0, wherever minecraft-data starts counting.
    const moo = sounds['entity.cow.ambient'].id - first;
    // The trap this avoids: where minecraft-data counts from 1 (up to 26.1), indexing the table with that
    // number directly gives a different sound. From 26.3 it counts from 0 and the two agree.
    if (first !== 0) assert.notEqual(world.registry.sounds[moo]?.name, 'entity.cow.ambient');

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
    assert.equal(soundSubject('minecraft:block.wooden_door.open'), 'door (opened)');
    assert.equal(soundSubject('minecraft:block.iron_door.close'), 'door (closed)');
    assert.equal(soundSubject('minecraft:block.cherry_wood_trapdoor.open'), 'trapdoor (opened)');
    assert.equal(soundSubject('minecraft:block.nether_wood_fence_gate.close'), 'fence_gate (closed)');
    assert.equal(soundSubject('minecraft:block.chest.open'), 'chest (opened)');
    assert.equal(soundSubject('minecraft:block.copper_chest_oxidized.close'), 'chest (closed)');
    assert.equal(soundSubject('minecraft:block.barrel.open'), 'barrel (opened)');
    assert.equal(soundSubject('minecraft:block.eyeblossom.open'), null, 'a flower opening is not worth telling');
    assert.equal(soundSubject('minecraft:block.grass.step'), 'footsteps');
    assert.equal(soundSubject('minecraft:entity.generic.explode'), 'explosion');
    // A bow's twang is told apart from a skeleton's rattle, as a player hears it.
    assert.equal(soundSubject('minecraft:entity.skeleton.shoot'), 'skeleton (shooting)');
    assert.equal(soundSubject('minecraft:entity.skeleton.ambient'), 'skeleton');
});

test('W7: doors, chests, footsteps and explosions are heard; a source in view is marked seen, a blast is always news', () => {
    const cow = { id: 8, type: 'animal', name: 'cow', position: at(-6.5, 1, 0.5), height: 1.4 };
    const { perception } = setup(w => w.fill('stone', [4, 1, -6], [4, 6, 6]), { entities: [cow] }); // a wall to the east
    perception.hearSound('minecraft:block.wooden_door.open', at(8, 1, 0));   // behind the wall
    perception.hearSound('minecraft:block.chest.open', at(-2, 1, 2));        // in plain view, west
    perception.hearSound('minecraft:block.grass.step', at(-6.5, 1, 0.5));    // the cow, walking in view
    perception.hearSound('minecraft:block.grass.step', at(9, 1, 3));         // something behind the wall
    perception.hearSound('minecraft:entity.generic.explode', at(-10, 1, -2)); // in plain view, and still news
    const heard = Object.fromEntries(perception.heard().map(h => [`${h.subject} ${h.direction}`, h]));
    assert.equal(heard['door (opened) east'].seen, false);
    assert.equal(heard['chest (opened) south-west'].seen, true, 'a chest whose spot is in view');
    assert.equal(heard['footsteps west'].seen, true, 'the cow it can see');
    assert.equal(heard['footsteps east'].seen, false);
    assert.equal(heard['explosion west'].seen, false);
    assert.equal(heard['explosion west'].news, true);
    assert.equal(heard['door (opened) east'].news, false);
});

test('a search that runs out of its time budget is counted and noted in the log, at most once a minute', () => {
    const warnings = [];
    let t = 0;
    const tick = () => (t += 50); // every look at the clock takes 50 ms, so a 100 ms budget trips at once
    const { world, perception } = setup(w => w.set('diamond_ore', 3, 1, 0),
        { options: { searchBudgetMs: 100, clock: tick, warn: line => warnings.push(line) } });
    const search = () => perception.findBlocks({ matching: diamond(world), maxDistance: 20, count: 5 });
    search();
    assert.equal(perception.stats().searchesCut, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ran out of its 100 ms/);
    search(); search();
    assert.equal(perception.stats().searchesCut, 3);
    assert.equal(warnings.length, 1, 'no second line within the minute');
    t += 60_000;
    search();
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /3 searches cut short since the last note/);
});
