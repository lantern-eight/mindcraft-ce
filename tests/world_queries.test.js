// The query provider behind world.js: stock behavior by default, and one place to swap in another
// source of blocks and entities. These tests need nothing but world.js and a hand-made bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import * as world from '../src/agent/library/world.js';
import { worldQueries, setWorldQueries } from '../src/agent/library/world_queries.js';

// A bot with three blocks and two other entities, recording which raw methods get called.
function rawBot() {
    const block = (name, x, y, z) => ({ name, position: new Vec3(x, y, z) });
    const blocks = [block('oak_log', 2, 64, 0), block('chest', -6, 60, 2), block('stone', 1, 63, 0)];
    const me = { id: 1, type: 'player', username: 'Andy', position: new Vec3(0.5, 64, 0.5) };
    const cow = { id: 2, type: 'animal', name: 'cow', position: new Vec3(4, 64, 0) };
    const alex = { id: 3, type: 'player', username: 'Alex', name: 'player', position: new Vec3(0, 64, -8) };
    const calls = [];
    const bot = {
        username: 'Andy', entity: me, entities: { 1: me, 2: cow, 3: alex },
        findBlocks: ({ matching, count = 1 }) => { calls.push('findBlocks'); return blocks.filter(matching).slice(0, count).map(b => b.position); },
        blockAt: pos => { calls.push('blockAt'); return blocks.find(b => b.position.equals(pos.floored())) ?? null; },
        nearestEntity: match => { calls.push('nearestEntity'); return [cow, alex].find(match) ?? null; },
    };
    return { bot, calls, blocks, cow, alex };
}

const names = list => list.map(b => b.name).sort();

test('by default world.js reads the bot directly, exactly as before', () => {
    setWorldQueries(null);
    const { bot, calls, cow, alex } = rawBot();
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, () => true, 64, 10)), ['chest', 'oak_log', 'stone']);
    // Stock Mindcraft lists the bot itself first (distance 0); that is unchanged.
    assert.deepEqual(world.getNearbyEntities(bot, 16), [bot.entity, cow, alex]);
    assert.deepEqual(world.getNearbyPlayers(bot, 16), [alex]);
    assert.equal(world.getNearestEntityWhere(bot, e => e.name === 'cow', 16), cow);
    assert.equal(world.getBlockAtPosition(bot, 0.5, -1, -0.5).name, 'stone');
    assert.deepEqual([...new Set(calls)].sort(), ['blockAt', 'findBlocks', 'nearestEntity']);
});

test('an installed provider answers every search, and methods it leaves out fall back to the bot', () => {
    const { bot, calls, blocks, cow } = rawBot();
    // A provider that only knows about the log and the cow, and says nothing about nearestEntity.
    setWorldQueries({
        findBlocks: (_bot, { matching }) => [blocks[0]].filter(matching).map(b => b.position),
        blockAt: (_bot, pos) => (blocks[0].position.equals(pos.floored()) ? blocks[0] : null),
        entities: () => [cow],
    });
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, () => true, 64, 10)), ['oak_log']);
    assert.deepEqual(world.getNearbyEntities(bot, 16), [cow]);
    assert.deepEqual(world.getNearbyPlayers(bot, 16), []);
    assert.equal(world.getBlockAtPosition(bot, 0.5, -1, -0.5).name, 'air', 'an unknown cell reads as air, like an unloaded one');
    assert.deepEqual(calls, [], 'the raw bot was never asked');
    assert.equal(world.getNearestEntityWhere(bot, e => e.name === 'cow', 16), cow);
    assert.deepEqual(calls, ['nearestEntity'], 'a method the provider leaves out uses the bot');
    setWorldQueries(null);
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, () => true, 64, 10)), ['chest', 'oak_log', 'stone'], 'null restores the default');
});

test('a found position that has no readable block is dropped, not returned as null', () => {
    const { bot, blocks } = rawBot();
    setWorldQueries({ findBlocks: () => blocks.map(b => b.position), blockAt: (_bot, pos) => (pos.x === 2 ? blocks[0] : null) });
    assert.deepEqual(names(world.getNearestBlocksWhere(bot, () => true, 64, 10)), ['oak_log']);
    setWorldQueries(null);
});

test('world.js itself offers no way to swap the provider, since generated code is handed world.js', () => {
    assert.equal('setWorldQueries' in world, false);
    assert.equal(Object.isFrozen(worldQueries()), true);
});
