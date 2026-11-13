// SPDX-License-Identifier: CC0-1.0
// The world.js choke point: with the fair query provider installed, every search in world.js answers
// from perception, and each through-walls switch loosens exactly one category.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import * as world from '../src/agent/library/world.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { fairQueries, registerFairPlay } from '../src/agent/fairplay/fair_queries.js';
import { resolvePolicy, blockCategory, allowsRawBlock } from '../src/agent/fairplay/policy.js';

// A raw world with things the bot can see (a log in the open) and things it can't (a buried diamond,
// a chest in a sealed room, a zombie and a player behind a wall).
function scene() {
    const block = (name, x, y, z) => ({ name, type: name.length, position: new Vec3(x, y, z) });
    const raw = [block('oak_log', 2, 64, 0), block('diamond_ore', 5, 40, 5), block('chest', -6, 60, 2), block('stone', 1, 63, 0)];
    const visibleBlocks = new Set(['2,64,0', '1,63,0']);
    const me = { id: 1, type: 'player', username: 'Fairy', position: new Vec3(0.5, 64, 0.5) };
    const cow = { id: 2, type: 'animal', name: 'cow', position: new Vec3(4, 64, 0) };
    const zombie = { id: 3, type: 'hostile', name: 'zombie', position: new Vec3(-5, 64, 0) };
    const alex = { id: 4, type: 'player', username: 'Alex', name: 'player', position: new Vec3(0, 64, -8) };
    const rawCalls = [];
    const bot = {
        username: 'Fairy', entity: me, entities: { 1: me, 2: cow, 3: zombie, 4: alex },
        findBlocks: ({ matching, count = 1 }) => {
            rawCalls.push('findBlocks');
            return raw.filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
                .slice(0, count).map(b => b.position);
        },
        blockAt: pos => { rawCalls.push('blockAt'); return raw.find(b => b.position.equals(pos.floored())) ?? null; },
        nearestEntity: () => { rawCalls.push('nearestEntity'); return null; },
    };
    const perception = {
        findBlocks: ({ matching, count = 1 }) => raw.filter(b => visibleBlocks.has(`${b.position.x},${b.position.y},${b.position.z}`))
            .filter(b => (typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type)))
            .slice(0, count).map(b => b.position),
        blockAt: pos => raw.find(b => b.position.equals(pos.floored()) && visibleBlocks.has(`${b.position.x},${b.position.y},${b.position.z}`)) ?? null,
        entities: () => [cow],
    };
    return { bot, perception, rawCalls, me, cow, zombie, alex };
}

const names = blocks => blocks.map(b => b.name).sort();
const all = () => true;

test('policy: fair play is off unless chosen, strict means every rule at its fair value', () => {
    assert.equal(resolvePolicy({}).mode, 'off');
    assert.equal(resolvePolicy({}).sight, 'all');
    const strict = resolvePolicy({ fair_play: 'strict' });
    assert.equal(strict.sight, 'rays');
    assert.equal(strict.ores_through_walls, false);
    assert.equal(strict.generated_code, 'wrapped');
    assert.equal(strict.good_neighbor.protect_builds, true);
    assert.ok(Object.isFrozen(strict) && Object.isFrozen(strict.slash_allowlist));
});

test('policy: custom starts from strict, and typos or bad values are errors rather than silently ignored', () => {
    const custom = resolvePolicy({ fair_play: 'custom', fair_play_custom: { ores_through_walls: true, sight: 'open_face' } });
    assert.equal(custom.ores_through_walls, true);
    assert.equal(custom.sight, 'open_face');
    assert.equal(custom.mobs_through_walls, false);
    assert.throws(() => resolvePolicy({ fair_play: 'custom', fair_play_custom: { ore_through_walls: true } }), /Unknown/);
    assert.throws(() => resolvePolicy({ fair_play: 'custom', fair_play_custom: { sight: 'xray' } }), /one of/);
    assert.throws(() => resolvePolicy({ fair_play: 'custom', fair_play_custom: { hearing_radius: '16' } }), /number/);
    assert.throws(() => resolvePolicy({ fair_play: 'lenient' }), /fair_play must be/);
});

test('policy: block categories decide which through-walls switch applies', () => {
    assert.equal(blockCategory('deepslate_diamond_ore'), 'ore');
    assert.equal(blockCategory('ancient_debris'), 'ore');
    assert.equal(blockCategory('barrel'), 'container');
    assert.equal(blockCategory('red_shulker_box'), 'container');
    assert.equal(blockCategory('red_bed'), 'station');
    assert.equal(blockCategory('oak_door'), 'station');
    assert.equal(blockCategory('sand'), 'other');
    const oresOnly = resolvePolicy({ fair_play: 'custom', fair_play_custom: { ores_through_walls: true } });
    assert.equal(allowsRawBlock(oresOnly, 'diamond_ore'), true);
    assert.equal(allowsRawBlock(oresOnly, 'chest'), false);
    assert.equal(allowsRawBlock(oresOnly, 'sand'), false);
});

test('without a provider, world.js behaves exactly as stock Mindcraft', () => {
    setWorldQueries(null);
    const { bot, rawCalls } = scene();
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, all, 64, 10)), ['chest', 'diamond_ore', 'oak_log', 'stone']);
    assert.ok(rawCalls.includes('findBlocks'));
});

test('a bot that is not registered keeps raw behavior even with the fair provider installed', () => {
    setWorldQueries(fairQueries);
    const { bot } = scene();
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, all, 64, 10)), ['chest', 'diamond_ore', 'oak_log', 'stone']);
    setWorldQueries(null);
});

test('P1: under strict fair play, world.js searches never touch raw blocks or entities', () => {
    setWorldQueries(fairQueries);
    const { bot, perception, rawCalls, cow } = scene();
    registerFairPlay(bot, { perception, policy: resolvePolicy({ fair_play: 'strict' }) });

    assert.deepEqual(names(world.getNearestBlocksWhere(bot, all, 64, 10)), ['oak_log', 'stone']);
    assert.deepEqual(world.getNearestBlocksWhere(bot, b => b.name === 'diamond_ore', 64, 1), [], 'the buried diamond is not found');
    assert.deepEqual(world.getNearbyEntities(bot, 32).map(e => e.id).sort(), [1, 2], 'itself and the cow; not the zombie');
    assert.equal(world.getNearestEntityWhere(bot, e => e.type === 'hostile', 32), null);
    assert.equal(world.getNearestEntityWhere(bot, e => e.name === 'cow', 32), cow);
    assert.deepEqual(world.getNearbyPlayers(bot, 64), [], 'Alex is behind a wall');
    assert.equal(world.getBlockAtPosition(bot, 0.5, -1, -0.5).name, 'stone', 'a seen block next to the bot reads normally');
    assert.deepEqual(rawCalls, [], 'no raw search, block read, or entity read happened');
    setWorldQueries(null);
});

test('P2: each through-walls switch loosens exactly its own category', () => {
    setWorldQueries(fairQueries);
    const cases = [
        [{ ores_through_walls: true }, ['diamond_ore', 'oak_log', 'stone'], [1, 2]],
        [{ containers_through_walls: true }, ['chest', 'oak_log', 'stone'], [1, 2]],
        [{ stations_through_walls: true }, ['oak_log', 'stone'], [1, 2]],
        [{ mobs_through_walls: true }, ['oak_log', 'stone'], [1, 2, 3]],
        [{ players_through_walls: true }, ['oak_log', 'stone'], [1, 2, 4]],
        [{ sight: 'all' }, ['chest', 'diamond_ore', 'oak_log', 'stone'], [1, 2]],
    ];
    for (const [custom, blocks, entityIds] of cases) {
        const { bot, perception } = scene();
        registerFairPlay(bot, { perception, policy: resolvePolicy({ fair_play: 'custom', fair_play_custom: custom }) });
        const label = JSON.stringify(custom);
        assert.deepEqual(names(world.getNearestBlocksWhere(bot, all, 64, 10)), blocks, label);
        assert.deepEqual(world.getNearbyEntities(bot, 64).map(e => e.id).sort(), entityIds, label);
    }
    setWorldQueries(null);
});

test('raw entities allowed by a switch still respect the entity distance', () => {
    setWorldQueries(fairQueries);
    const { bot, perception } = scene();
    registerFairPlay(bot, { perception, policy: resolvePolicy({ fair_play: 'custom', fair_play_custom: { mobs_through_walls: true, entity_distance: 3 } }) });
    assert.deepEqual(world.getNearbyEntities(bot, 64).map(e => e.id).sort(), [1, 2], 'the zombie is 5 blocks away');
    setWorldQueries(null);
});
