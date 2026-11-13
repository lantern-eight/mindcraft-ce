// SPDX-License-Identifier: CC0-1.0
// The reach guard: the bot can only click, dig, place against or hit what is within a player's reach
// and in view. Each test stands the bot in a small hand-built world and tries an action.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { createReachGuard, installReachGuard } from '../src/agent/fairplay/reach_guard.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';

// The bot stands at the origin on a stone floor, eye at y 2.62. Its click and hit methods just record
// what reached "the server".
function setup(build, { custom = null, entities = [], deciding = true } = {}) {
    const world = fixtureWorld({ min: [-16, -4, -16], max: [16, 16, 16] });
    world.fill('stone', [-16, 0, -16], [16, 0, 16]);
    build(world);
    const bot = stubBot(world, { entities });
    const sent = [];
    for (const name of ['dig', 'placeBlock', 'activateBlock', 'openContainer', 'openFurnace', 'activateEntity', 'useOn'])
        bot[name] = async target => { sent.push([name, target.name ?? target.username]); return name; };
    bot.attack = target => { sent.push(['attack', target.name]); };
    const policy = resolvePolicy(custom ? { fair_play: 'custom', fair_play_custom: custom } : { fair_play: 'strict' });
    const perception = createPerception({ bot, policy, ...NO_BUDGETS });
    const guard = createReachGuard({ policy, getPerception: () => perception });
    let isDeciding = deciding;
    installReachGuard(bot, guard, { deciding: () => isDeciding });
    const block = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    return { world, bot, sent, block, guard, setDeciding: value => { isDeciding = value; } };
}

test('R1: a chest behind a wall cannot be opened, even within reach; with a way to see it, it can', async () => {
    const walled = setup(w => {
        w.fill('stone', [2, 1, -2], [2, 4, 2]); // a wall one block east of the bot
        w.set('chest', 3, 1, 0);                // a chest right behind it, well within reach
    });
    await assert.rejects(walled.bot.openContainer(walled.block(3, 1, 0)), /can't see the block at 3, 1, 0 .* can't open it/);
    assert.deepEqual(walled.sent, [], 'nothing was sent to the server');

    const open = setup(w => {
        w.fill('stone', [2, 1, -2], [2, 4, 2]);
        w.fill('air', [2, 1, 0], [2, 2, 0]);    // a doorway in the wall
        w.set('chest', 3, 1, 0);
    });
    assert.equal(await open.bot.openContainer(open.block(3, 1, 0)), 'openContainer');
    assert.deepEqual(open.sent, [['openContainer', 'chest']]);
});

test('a block in plain view but too far away cannot be dug until the bot moves closer', async () => {
    const { bot, block, sent } = setup(w => w.set('oak_log', 7, 1, 0));
    await assert.rejects(bot.dig(block(7, 1, 0)), /can't reach the block at 7, 1, 0: it is 6\.\d blocks away and you can reach 4\.5/);
    bot.moveTo(4.5, 1, 0.5);
    await bot.dig(block(7, 1, 0));
    assert.deepEqual(sent, [['dig', 'oak_log']]);
});

test('reach is measured from the eye to the nearest part of the block, as the game does', async () => {
    const { bot, block, sent } = setup(w => { w.set('oak_log', 5, 2, 0); w.set('oak_log', 0, 1, -6); });
    await bot.dig(block(5, 2, 0)); // its near face is 4.5 blocks from the eye: just in reach
    await assert.rejects(bot.dig(block(0, 1, -6)), /can't reach/); // nearest point 5.5 blocks away
    assert.equal(sent.length, 1);
});

test('R2: a block can only be placed against a side the bot can see', async () => {
    const { bot, block } = setup(w => w.set('stone', 3, 1, 0));
    const stone = block(3, 1, 0);
    assert.equal(await bot.placeBlock(stone, new Vec3(-1, 0, 0)), 'placeBlock', 'the side facing the bot');
    assert.equal(await bot.placeBlock(stone, new Vec3(0, 1, 0)), 'placeBlock', 'the top, seen from above');
    await assert.rejects(bot.placeBlock(stone, new Vec3(1, 0, 0)), /can't see the side of the block at 3, 1, 0/);
});

test('the block underfoot can be dug and built on, though the bot is standing on it', async () => {
    const { bot, block, sent } = setup(() => {});
    await bot.dig(block(0, 0, 0));
    await bot.placeBlock(block(0, 0, 0), new Vec3(0, 1, 0));
    assert.equal(sent.length, 2);
});

test('a mob behind a wall cannot be hit, and one in the open only from within 3 blocks', () => {
    const hidden = { id: 5, name: 'zombie', type: 'hostile', position: new Vec3(3.5, 1, 0.5), height: 1.95, width: 0.6 };
    const far = { id: 6, name: 'cow', type: 'animal', position: new Vec3(-5.5, 1, 0.5), height: 1.4, width: 0.9 };
    const near = { id: 7, name: 'pig', type: 'animal', position: new Vec3(0.5, 1, 2.5), height: 0.9, width: 0.9 };
    const { bot, sent } = setup(w => w.fill('stone', [2, 1, -2], [2, 4, 2]), { entities: [hidden, far, near] });
    assert.throws(() => bot.attack(hidden), /can't see the zombie from here/);
    assert.throws(() => bot.attack(far), /can't reach the cow: it is \d\.\d blocks away and you can reach 3/);
    bot.attack(near);
    assert.deepEqual(sent, [['attack', 'pig']]);
});

test('the pathfinder and combat plugin, which act outside a command, are not held to the guard', async () => {
    const { bot, block, sent, setDeciding } = setup(w => { w.fill('stone', [2, 1, -2], [2, 4, 2]); w.set('chest', 3, 1, 0); });
    setDeciding(false); // what a call from the pathfinder's own timer looks like
    await bot.openContainer(block(3, 1, 0));
    assert.equal(sent.length, 1);
});

test('interact_through_walls lifts the sight rule but not the reach rule', async () => {
    const { bot, block, sent } = setup(w => {
        w.fill('stone', [2, 1, -2], [2, 4, 2]);
        w.set('chest', 3, 1, 0);
        w.set('chest', 9, 1, 0);
    }, { custom: { interact_through_walls: true } });
    await bot.openContainer(block(3, 1, 0));
    await assert.rejects(bot.openContainer(block(9, 1, 0)), /can't reach/);
    assert.equal(sent.length, 1);
});

test('refusals carry a code, and the guard only wraps once', async () => {
    const { bot, block, guard } = setup(w => w.set('oak_log', 9, 1, 0));
    const dig = bot.dig;
    installReachGuard(bot, guard);
    assert.equal(bot.dig, dig, 'a second install leaves the methods alone');
    const error = await bot.dig(block(9, 1, 0)).catch(e => e);
    assert.equal(error.code, 'fair_play_reach');
});
