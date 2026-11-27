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
