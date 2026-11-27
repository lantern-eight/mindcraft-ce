// SPDX-License-Identifier: CC0-1.0
// The real legs' watch over a walk, on a pretend bot and pathfinder: swimming is limited without a break,
// however many legs it is spread over, and a leg that stops for water goes back to the last dry ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { realLegs, targetsOf } from '../src/agent/explore/legs.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A bot whose pathfinder walks for `ms` and then arrives, unless its goal is taken away first. */
function pretendBot() {
    const goals = [];
    let stop = null;
    const bot = {
        interrupt_code: false,
        entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, isInWater: false },
        blockAt: () => ({ name: 'air' }),
        findBlocks: () => [],
        pathfinder: {
            walkMs: 1000,
            onWalk: () => {},
            setMovements() {},
            goto(goal) {
                goals.push(goal);
                bot.pathfinder.onWalk(goals.length);
                return new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, bot.pathfinder.walkMs);
                    stop = () => { clearTimeout(timer); reject(Object.assign(new Error('Goal changed'), { name: 'GoalChanged' })); };
                });
            },
            setGoal(goal) { if (goal === null) stop?.(); },
        },
    };
    return { bot, goals };
}
const quick = { swimMs: 150, stallMs: 5000, watchMs: 10, shoreMs: 500, movements: () => ({}) };

test('swimming is limited without a break, across legs, and the bot goes back to the last dry ground', async () => {
    const { bot, goals } = pretendBot();
    const legs = realLegs(bot, quick);
    // The first leg starts on the shore, wades in after 40 ms and arrives in the water at 120 ms: under the limit.
    bot.pathfinder.walkMs = 120;
    setTimeout(() => { bot.entity.position = new Vec3(10.5, 63, 0.5); bot.entity.onGround = false; bot.entity.isInWater = true; }, 40);
    assert.equal(await legs.walk({ x: 32, y: 64, z: 0 }), 'arrived');

    // The second starts in the water. The 80 ms already swum count, so it stops well before 150 ms of its own.
    bot.pathfinder.walkMs = 1000;
    const started = Date.now();
    bot.pathfinder.onWalk = n => { if (n === 3) { bot.pathfinder.walkMs = 5; bot.entity.position = new Vec3(0.5, 64, 0.5); bot.entity.isInWater = false; bot.entity.onGround = true; } };
    assert.equal(await legs.walk({ x: 64, y: 64, z: 0 }), 'water');
    assert.ok(Date.now() - started < 140, `stopped after ${Date.now() - started} ms`);
    // And it swam back to where it last stood dry: the shore it set out from.
    const back = goals.at(-1);
    assert.deepEqual([back.x, back.y, back.z], [0, 64, 0]);
});

test('a leg that stops moving ends as stalled', async () => {
    const { bot } = pretendBot();
    const legs = realLegs(bot, { ...quick, stallMs: 60 });
    assert.equal(await legs.walk({ x: 32, y: 64, z: 0 }), 'stalled');
});

test('a walk that ends in the water ends on the shore instead', async () => {
    const { bot, goals } = pretendBot();
    const legs = realLegs(bot, quick);
    bot.pathfinder.walkMs = 50;
    await legs.walk({ x: 32, y: 64, z: 0 }); // on dry ground: remembered
    bot.entity.position = new Vec3(8.5, 63, 0.5); bot.entity.isInWater = true; bot.entity.onGround = false;
    await legs.settle();
    const back = goals.at(-1);
    assert.deepEqual([back.x, back.y, back.z], [0, 64, 0]);
    await delay(20);
});

test('what to look for is split into the blocks and mobs the game knows', () => {
    const registry = { blocksByName: { sand: {}, red_sand: {} }, entitiesByName: { cow: {} } };
    assert.deepEqual(targetsOf(registry, ' Sand, minecraft:red_sand ,cow, beach'),
        { blocks: ['sand', 'red_sand'], mobs: ['cow'], unknown: ['beach'], all: ['sand', 'red_sand', 'cow'] });
});

test('with no way back to where it stood dry, the bot climbs out at the nearest bank it knows of', async () => {
    const { bot, goals } = pretendBot();
    const bank = new Vec3(6, 63, 3);
    bot.blockAt = pos => (pos.floored().equals(bank) ? { name: 'grass_block', boundingBox: 'block', position: bank } : { name: 'air', boundingBox: 'empty', position: pos.floored() });
    bot.findBlocks = () => [bank];
    const legs = realLegs(bot, quick);
    bot.pathfinder.walkMs = 20;
    await legs.walk({ x: 32, y: 64, z: 0 });                  // stood dry at the start: remembered
    bot.entity.position = new Vec3(8.5, 63, 0.5); bot.entity.isInWater = true; bot.entity.onGround = false;
    const goto = bot.pathfinder.goto;
    bot.pathfinder.goto = goal => {                             // no way back there
        if (goal.x === 0) { goals.push(goal); return Promise.reject(Object.assign(new Error('No path'), { name: 'NoPath' })); }
        return goto(goal);
    };
    await legs.settle();
    const climbed = goals.at(-1);
    assert.deepEqual([climbed.x, climbed.y, climbed.z], [6, 64, 3], 'to stand on the bank');
});

/** A pretend world memory: `at(x, y, z)` names a remembered cell, or null for one never seen. */
function pretendMemory(at) {
    return { cells: { read: (x, y, z) => at(x, y, z), seenOpen: () => false, lookedAt: () => 0, nearest: () => [] } };
}

test('a leg ending on remembered water, lava or a drop is known before setting out', () => {
    const { bot } = pretendBot();
    // East of x 20 a lake at 63; north of z -20 lava; west of x -20 the ground is 20 blocks down, over open air.
    const memory = pretendMemory((x, y, z) => {
        if (x >= 20) return y === 63 ? 'water' : y > 63 ? 'air' : null;
        if (z <= -20) return y === 63 ? 'lava' : y > 63 ? 'air' : null;
        if (x <= -20) return y === 43 ? 'stone' : y > 43 ? 'air' : null;
        return y === 63 ? 'grass_block' : y > 63 ? 'air' : null;
    });
    const legs = realLegs(bot, { ...quick, memory });
    assert.equal(legs.knownHazard({ x: 32, y: 64, z: 0 }), 'water');
    assert.equal(legs.knownHazard({ x: 0, y: 64, z: -32 }), 'lava');
    assert.equal(legs.knownHazard({ x: -32, y: 64, z: 0 }), 'drop');
    assert.equal(legs.knownHazard({ x: 0, y: 64, z: 10 }), null, 'plain ground');
});

test('ground never seen is no reason to turn, and neither is a puddle', () => {
    const { bot } = pretendBot();
    const legs = realLegs(bot, { ...quick, memory: pretendMemory((x, y, z) => (x === 32 && z === 0 && y === 63 ? 'water' : x > 100 ? null : y === 63 ? 'grass_block' : y > 63 ? 'air' : null)) });
    assert.equal(legs.knownHazard({ x: 32, y: 64, z: 0 }), null, 'one wet cell');
    assert.equal(legs.knownHazard({ x: 200, y: 64, z: 0 }), null, 'never seen');
    assert.equal(realLegs(bot, quick).knownHazard({ x: 32, y: 64, z: 0 }), null, 'no memory: nothing known');
});

test('underground, a leg ends at the farthest spot that way the bot has seen room to stand on', async () => {
    const { bot, goals } = pretendBot();
    // A stone roof 4 above the head; a tunnel east at y 64, seen as far as x 20, and rock never seen beyond.
    bot.blockAt = pos => (pos.y >= 68 ? { name: 'stone', boundingBox: 'block', position: pos } : { name: 'air', boundingBox: 'empty', position: pos });
    const tunnel = (x, y, z) => (x >= 0 && x <= 20 && z === 0 ? (y === 63 ? 'stone' : y === 64 || y === 65 ? 'air' : null) : null);
    const legs = realLegs(bot, { ...quick, memory: pretendMemory(tunnel) });
    bot.pathfinder.walkMs = 5;
    assert.equal(await legs.walk({ x: 32.5, y: 64, z: 0.5 }), 'arrived');
    const goal = goals.at(-1);
    assert.deepEqual([goal.x, goal.y, goal.z], [20, 64, 0], 'the end of what was seen of the tunnel');
});

test('underground with no room seen that way, the way counts as blocked without a walk', async () => {
    const { bot, goals } = pretendBot();
    bot.blockAt = pos => (pos.y >= 68 ? { name: 'stone', boundingBox: 'block', position: pos } : { name: 'air', boundingBox: 'empty', position: pos });
    const legs = realLegs(bot, { ...quick, memory: pretendMemory(() => null) });
    assert.equal(await legs.walk({ x: -32, y: 64, z: 0 }), 'no_path');
    assert.equal(goals.length, 0);
});

test('under the open sky, or under leaves, a leg is a plain walk to its x and z', async () => {
    const { bot, goals } = pretendBot();
    bot.blockAt = pos => (pos.y >= 70 && pos.y <= 72 ? { name: 'oak_leaves', boundingBox: 'block', position: pos } : { name: 'air', boundingBox: 'empty', position: pos });
    const legs = realLegs(bot, { ...quick, memory: pretendMemory(() => null) });
    bot.pathfinder.walkMs = 5;
    assert.equal(await legs.walk({ x: 32, y: 64, z: 0 }), 'arrived');
    assert.equal(goals.at(-1).constructor.name, 'GoalNearXZ');
});

test('the kinds of ground worth naming are the ones in view, each once', () => {
    const { bot } = pretendBot();
    const blocks = [['sand', 3], ['sand', 4], ['stone', 5], ['birch_log', 6], ['iron_ore', 7], ['grass_block', 8]];
    bot.findBlocks = ({ matching }) => blocks.map(([, x]) => new Vec3(x, 63, 0)).filter(pos => matching(bot.blockAt(pos)));
    bot.blockAt = pos => ({ name: blocks.find(([, x]) => x === pos.x)?.[0] ?? 'air', boundingBox: 'block', position: pos });
    assert.deepEqual(realLegs(bot, quick).kinds().sort(), ['birch_log', 'iron_ore', 'sand']);
});
