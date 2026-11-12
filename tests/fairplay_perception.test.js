// Perception: what the bot knows right now. Touch, sight, memory, hearing, and the name-tag rule,
// tested on small hand-built worlds with a stand-in bot (tests/helpers/fixture_world.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot } from './helpers/fixture_world.js';
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

function setup(build, { policy = STRICT, entities = [], now = clock() } = {}) {
    const world = fixtureWorld({ min: [-24, -4, -24], max: [24, 24, 24] });
    world.fill('stone', [-24, 0, -24], [24, 0, 24]); // floor
    build(world);
    const bot = stubBot(world, { entities });
    const seenMap = createSeenMap({ scope: 'test', now });
    const perception = createPerception({ bot, policy, seenMap, getStateId: world.getStateId, now });
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

test('memory: a block seen earlier stays known out of view, until it is gone or seen changed', () => {
    const now = clock();
    const { world, bot, seenMap, perception } = setup(w => {
        w.set('chest', 6, 1, 0);
        w.fill('stone', [6, 1, 3], [6, 5, 8]); // a wall to hide behind, south of the chest
    }, { now });
    assert.equal(perception.blockAt(at(6, 1, 0)).name, 'chest');
    bot.moveTo(6.5, 1, 10.5); // behind the wall
    assert.equal(perception.knowsCell(at(6, 1, 0)), true, 'remembered, though not visible now');
    world.set('air', 6, 1, 0); // someone takes the chest while the bot is away
    assert.equal(perception.blockAt(at(6, 1, 0)), null, 'memory no longer matches the world, so nothing is returned');
    assert.equal(seenMap.get(6, 1, 0).provenance, 'observed', 'but the bot does not know it is gone yet');
    bot.moveTo(0.5, 1, 0.5); // back in view
    now.advance(2000);
    perception.tick();
    assert.equal(seenMap.get(6, 1, 0).provenance, 'gone', 'looking again corrects memory');
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
