// SPDX-License-Identifier: CC0-1.0
// A drop that didn't come, looked for through a player's screen (fairplay/missing_drop.js), and the hook in
// gathering that asks for it (library/drop_look.js, mining.js). No game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { GoalBesideCell, lookForMissingDrop } from '../src/agent/fairplay/missing_drop.js';
import { watchLooks } from '../src/agent/fairplay/look_around.js';
import { screenOf } from '../src/agent/fairplay/sight.js';
import { lookForDrop, setDropLook } from '../src/agent/library/drop_look.js';
import { collectBlocks } from '../src/agent/library/mining.js';

/** A bot standing at `at`, seeing through a screen unless `narrow` is false, that records its looks and walks. */
function seeker({ at = new Vec3(0.5, 64, 0.5), narrow = true, walkTo = null } = {}) {
    const bot = new EventEmitter();
    const looks = [], walks = [], movements = [];
    const original = { name: 'the bot\'s own' };
    Object.assign(bot, {
        entity: { position: at.clone(), yaw: 0, pitch: 0 },
        lookAt: async point => { looks.push(point); },
        pathfinder: {
            movements: original,
            setMovements: m => { movements.push(m); bot.pathfinder.movements = m; },
            goto: async goal => { walks.push(goal); if (walkTo) bot.entity.position = walkTo.clone(); },
            setGoal: () => {},
        },
    });
    watchLooks(bot, { getScreen: () => (narrow ? screenOf(bot.entity.yaw, bot.entity.pitch, 70) : null) });
    return { bot, looks, walks, movements, original };
}
const options = (sees = () => false) => ({ seesItemNear: sees, holdMs: 0, walkingMoves: () => ({ name: 'walking' }) });

test('seeing all around, every drop in sight is seen already: nothing is done', async () => {
    const { bot, looks, walks } = seeker({ narrow: false });
    assert.equal(await lookForMissingDrop(bot, new Vec3(1, 63, 0), options()), false);
    assert.deepEqual(looks, []);
    assert.deepEqual(walks, []);
});

test('the bot looks at the floor where the block was, and stops there when an item is in view', async () => {
    const { bot, looks, walks } = seeker();
    let looked = false;
    bot.lookAt = async point => { looks.push(point); looked = true; };
    assert.equal(await lookForMissingDrop(bot, new Vec3(1, 63, 0), options(() => looked)), true);
    assert.equal(looks.length, 1);
    assert.deepEqual([looks[0].x, looks[0].y, looks[0].z], [1.5, 63.15, 0.5], 'the floor of the broken cell');
    assert.deepEqual(walks, [], 'seen from where it stands: no walk');
});

test('still not to be seen, the bot steps over to a hole beside and below its feet, and looks again', async () => {
    const { bot, looks, walks, movements, original } = seeker({ walkTo: new Vec3(1.5, 63, 0.5) });
    assert.equal(await lookForMissingDrop(bot, new Vec3(1, 63, 0), options()), true);
    assert.equal(walks.length, 1);
    assert.ok(walks[0] instanceof GoalBesideCell);
    assert.equal(looks.length, 2, 'a look before the walk and one after');
    assert.deepEqual(movements.map(m => m.name), ['walking', 'the bot\'s own'], 'walking only, then its own movements back');
});

test('no walk for a block broken above the feet, or when the bot already stands where the pickup reaches', async () => {
    const above = seeker();
    assert.equal(await lookForMissingDrop(above.bot, new Vec3(1, 65, 0), options()), true);
    assert.deepEqual(above.walks, [], 'its drop fell onto open ground, which the look showed');
    const inside = seeker({ at: new Vec3(1.5, 63, 0.5) });
    assert.equal(await lookForMissingDrop(inside.bot, new Vec3(1, 63, 0), options()), true);
    assert.deepEqual(inside.walks, [], 'standing in the hole already');
});

test('a walk that finds no way leaves the bot where it was, its own movements back', async () => {
    const { bot, movements } = seeker();
    bot.pathfinder.goto = async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); };
    assert.equal(await lookForMissingDrop(bot, new Vec3(1, 63, 0), options()), true);
    assert.equal(movements.at(-1).name, 'the bot\'s own');
});

test('the spots beside a cell are those the pickup box reaches from: a column round it, level or one below', () => {
    const goal = new GoalBesideCell(new Vec3(4, 63, 4));
    assert.equal(goal.isEnd(new Vec3(4, 63, 4)), true, 'in the hole');
    assert.equal(goal.isEnd(new Vec3(5, 62, 3)), true, 'beside it, one lower');
    assert.equal(goal.isEnd(new Vec3(5, 64, 4)), false, 'on the rim above');
    assert.equal(goal.isEnd(new Vec3(6, 63, 4)), false, 'two columns off');
    assert.equal(goal.heuristic(new Vec3(4, 63, 4)), 0);
    assert.ok(goal.heuristic(new Vec3(10, 64, 4)) > goal.heuristic(new Vec3(6, 64, 4)));
});

/** Two stone blocks; `gains` says, per dig, whether its drop reaches the bag by itself. */
function quarry(gains) {
    const registry = { blocksByName: { stone: { drops: [2] } }, items: { 2: { name: 'cobblestone' } } };
    const bot = Object.assign(new EventEmitter(), { interrupt_code: false, game: { gameMode: 'survival' }, world: {}, heldItem: { type: 1 }, registry });
    const blocks = [0, 1].map(x => ({ name: 'stone', type: 1, metadata: 0, position: new Vec3(x, 63, 0), canHarvest: () => true }));
    const remaining = new Set(blocks), items = [];
    bot.inventory = { items: () => items, emptySlotCount: () => 10 };
    bot.blockAt = pos => blocks.find(b => remaining.has(b) && b.position.equals(pos)) || { type: 0, name: 'air' };
    bot.pathfinder = { goto: () => Promise.resolve(), setGoal: () => {} };
    bot.tool = { equipForBlock: () => Promise.resolve() };
    bot.digTime = () => 10; bot.stopDigging = () => {};
    let dug = 0, pickups = 0, waiting = 0;
    bot.dig = block => {
        remaining.delete(block);
        if (gains[dug++]) items.push({ name: 'cobblestone', count: 1 }); else waiting++;
        return Promise.resolve();
    };
    // A pickup after a look finds the drop that was waiting.
    const pickup = () => { pickups++; return Promise.resolve(); };
    const found = () => { while (waiting) { waiting--; items.push({ name: 'cobblestone', count: 1 }); } };
    return { bot, options: { find: predicate => blocks.filter(b => remaining.has(b) && predicate(b)), pickup }, pickups: () => pickups, found };
}

test('gathering looks for a drop only when a break gave nothing, then picks up again', async () => {
    const { bot, options, pickups, found } = quarry([true, false]);
    const asked = [];
    setDropLook(bot, async (b, cell) => { asked.push(cell.toString()); found(); return true; });
    const result = await collectBlocks(bot, 'stone', 2, options);
    assert.equal(result.status, 'ok', result.text);
    assert.deepEqual(asked, [new Vec3(1, 63, 0).toString()], 'only the second block, whose drop did not come');
    assert.equal(pickups(), 3, 'a pickup per block, and one more after the look');
    assert.match(result.text, /acquired 2 cobblestone/);
    setDropLook(bot, null);
});

test('with no way of looking installed, gathering is as before: one pickup a block', async () => {
    const { bot, options, pickups } = quarry([false, false]);
    assert.equal(await lookForDrop(bot, new Vec3(0, 63, 0)), false);
    await collectBlocks(bot, 'stone', 2, options);
    assert.equal(pickups(), 2);
});
