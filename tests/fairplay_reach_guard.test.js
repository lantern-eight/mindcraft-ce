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
import '../src/agent/bedrock/edition.js'; // registers Bedrock's answers at the edition seam

// The bot stands at the origin on a stone floor, eye at y 2.62. Its click and hit methods just record
// what reached "the server".
function setup(build, { custom = null, entities = [], deciding = true, edition = null } = {}) {
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
    // Hand-built game data has no edition, and counts as Java's; `edition` names another game.
    const guard = createReachGuard({ policy, getPerception: () => perception, getRegistry: () => (edition ? { version: { type: edition } } : bot.registry) });
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

test('the reach is the game\'s own: half a block more for a block on Bedrock, the same for a mob', async () => {
    // A log whose near face is 4.8 blocks from the eye: past Java's reach of 4.5, inside Bedrock's 5.
    const log = w => { w.set('oak_log', 5, 2, 0); w.set('oak_log', 6, 2, 0); };
    const java = setup(log);
    java.bot.moveTo(0.2, 1, 0.5);
    await assert.rejects(java.bot.dig(java.block(5, 2, 0)), /it is 4\.8 blocks away and you can reach 4\.5/);

    const bedrock = setup(log, { edition: 'bedrock' });
    bedrock.bot.moveTo(0.2, 1, 0.5);
    await bedrock.bot.dig(bedrock.block(5, 2, 0));
    bedrock.world.set('air', 5, 2, 0);
    await assert.rejects(bedrock.bot.dig(bedrock.block(6, 2, 0)), /it is 5\.8 blocks away and you can reach 5\./);
    assert.deepEqual(bedrock.sent, [['dig', 'oak_log']]);

    // A mob 3.3 blocks away is out of reach on both.
    const cow = { id: 6, name: 'cow', type: 'animal', position: new Vec3(-3.25, 1, 0.5), height: 1.4, width: 0.9 };
    const mob = setup(() => {}, { entities: [cow], edition: 'bedrock' });
    assert.throws(() => mob.bot.attack(cow), /it is 3\.3 blocks away and you can reach 3\./);
});

test('a reach set by hand is used on either game', async () => {
    const far = w => w.set('oak_log', 6, 2, 0); // near face 5.5 blocks from the eye
    for (const edition of [null, 'bedrock']) {
        const { bot, block, sent } = setup(far, { custom: { reach_blocks: 6 }, edition });
        await bot.dig(block(6, 2, 0));
        assert.equal(sent.length, 1, edition ?? 'java');
    }
    const near = setup(w => w.set('oak_log', 4, 2, 0), { custom: { reach_blocks: 3 }, edition: 'bedrock' });
    await assert.rejects(near.bot.dig(near.block(4, 2, 0)), /you can reach 3\./);
});

test('a reach is "survival" (the game\'s own) to begin with, and only a positive number may replace it', () => {
    const strict = resolvePolicy({ fair_play: 'strict' });
    assert.equal(strict.reach_blocks, 'survival');
    assert.equal(strict.reach_entities, 'survival');
    assert.equal(resolvePolicy({ fair_play: 'custom', fair_play_custom: { reach_entities: 4 } }).reach_entities, 4);
    assert.equal(resolvePolicy({ fair_play: 'custom', fair_play_custom: { reach_blocks: 'survival' } }).reach_blocks, 'survival');
    for (const wrong of ['far', 0, -1, Infinity, '6'])
        assert.throws(() => resolvePolicy({ fair_play: 'custom', fair_play_custom: { reach_blocks: wrong } }), /reach_blocks must be "survival" or a positive number/);
});

test('a mob known only from where it was last seen is hit, or not, by where it is now', async () => {
    // The zombie stands in view within reach, then a wall goes up and it walks off behind it. For a
    // moment it is still known, where it was seen; a swing at that stand-in is judged on the zombie.
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: new Vec3(2.5, 1, 0.5), height: 1.95, width: 0.6 };
    const { world, bot, sent } = setup(() => {}, { entities: [zombie] });
    const perception = createPerception({ bot, policy: resolvePolicy({ fair_play: 'strict' }), ...NO_BUDGETS });
    assert.equal(perception.entities()[0], zombie);
    world.fill('stone', [-2, 1, 1], [3, 4, 1]); // a wall north of the bot, out of the line to where it stood
    zombie.position = new Vec3(0.5, 1, 2.5);      // within reach, behind the wall
    const standIn = perception.entities()[0];
    assert.notEqual(standIn, zombie);
    const guard = createReachGuard({ policy: resolvePolicy({ fair_play: 'strict' }), getPerception: () => perception, getRegistry: () => bot.registry });
    assert.ok(perception.seesCell(new Vec3(2, 2, 0)), 'the spot where it stood is still in view');
    assert.throws(() => guard.checkEntity(standIn), /can't see the zombie/);
    zombie.position = new Vec3(2.5, 1, 0.5); // back where it was, in plain view
    guard.checkEntity(standIn);
    zombie.position = new Vec3(6.5, 1, -2.5); // in plain view, out of reach
    assert.throws(() => guard.checkEntity(standIn), /can't reach the zombie/);
    assert.deepEqual(sent, []);
});
