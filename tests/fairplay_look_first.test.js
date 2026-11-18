// SPDX-License-Identifier: CC0-1.0
// Skills given a block by its coordinates look at it before deciding anything from it (look_first.js),
// and place against a side the bot can see.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { lookFirst, sideToPlaceAgainst } from '../src/agent/library/look_first.js';
import { breakBlockAt } from '../src/agent/library/skills.js';
import { namedCells, EMPTY, plainMovements, walker, loadGameData } from './helpers/named_cells.js';

let restoreMovements;
test.beforeEach(() => { restoreMovements = plainMovements(); });
test.afterEach(() => { restoreMovements(); setWorldQueries(null); });

// ---- lookFirst ----

test('a block in view is read at once, without a walk', async () => {
    const { bot } = namedCells({ cells: { '3,63,0': 'stone' } });
    let walks = 0;
    const seen = await lookFirst(bot, new Vec3(3, 63, 0), async () => { walks++; });
    assert.equal(seen.block.name, 'stone');
    assert.equal(walks, 0);
});

test('an unknown block makes the bot walk up and look; buried, it is called hidden and never named', async () => {
    const { bot } = namedCells({ cells: { '3,50,0': 'lava' }, known: new Set() });
    const goals = [];
    const seen = await lookFirst(bot, new Vec3(3, 50, 0), async (_bot, goal) => { goals.push(goal); });
    assert.equal(seen.block, null);
    assert.equal(goals.length, 1, 'it walked toward the block');
    assert.equal(goals[0].x, 3); assert.equal(goals[0].y, 50); assert.equal(goals[0].z, 0);
    assert.match(seen.reason, /can't see the block at 3, 50, 0/);
    assert.doesNotMatch(seen.reason, /lava/);
});

test('a block that comes into view on the walk is read from there', async () => {
    const known = new Set();
    const { bot } = namedCells({ cells: { '3,50,0': 'diamond_ore' }, known });
    const seen = await lookFirst(bot, new Vec3(3, 50, 0), async () => { known.add('3,50,0'); });
    assert.equal(seen.block.name, 'diamond_ore');
});

test('a remembered block is looked at again; still out of view, the skill is told it can\'t tell what is there now', async () => {
    const { bot } = namedCells({ cells: { '3,63,0': 'chest' }, known: new Set(['3,63,0']), remembered: new Set(['3,63,0']) });
    let walks = 0;
    const seen = await lookFirst(bot, new Vec3(3, 63, 0), async () => { walks++; });
    assert.equal(walks, 1);
    assert.equal(seen.block, null);
    assert.match(seen.reason, /can't tell what is there now/);
});

// ---- breakBlockAt through lookFirst ----

test('breakBlockAt on a buried block walks up to it, then says it can\'t see it, not what it is', async () => {
    await loadGameData();
    const { bot } = namedCells({ cells: { '2,60,0': 'lava' }, known: new Set() });
    const goals = walker(bot);
    assert.equal(await breakBlockAt(bot, 2, 60, 0), false);
    assert.equal(goals.length, 1, 'it went to look');
    assert.match(bot.output, /can't see the block at 2, 60, 0/);
    assert.doesNotMatch(bot.output, /lava/);
});

test('breakBlockAt on a block in view still decides from it: lava is skipped and said', async () => {
    const { bot } = namedCells({ cells: { '1,64,0': 'lava' } });
    assert.equal(await breakBlockAt(bot, 1, 64, 0), false);
    assert.match(bot.output, /because it is lava/);
});

// ---- choosing a side to place against ----

const DIRS = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(1, 0, 0), new Vec3(-1, 0, 0)];
const isEmpty = block => EMPTY.has(block.name);

test('a side is never chosen against a neighbor the bot doesn\'t know', () => {
    // Stone under the target, unknown to the bot; a known stone to the east.
    const { bot } = namedCells({ cells: { '5,63,0': 'stone', '6,64,0': 'stone' }, known: new Set(['5,64,0', '6,64,0']) });
    const side = sideToPlaceAgainst(bot, new Vec3(5, 64, 0), DIRS, isEmpty);
    assert.deepEqual(side.buildOffBlock.position, new Vec3(6, 64, 0));
    assert.deepEqual(side.faceVec, new Vec3(-1, 0, 0));
});

test('a side in view wins over a preferred side the bot can\'t see', () => {
    // Stone below (preferred) and to the east; only the east one's clicked side is in view.
    const { bot } = namedCells({ cells: { '5,63,0': 'stone', '6,64,0': 'stone' }, faces: new Set(['6,64,0|-1,0,0']) });
    const side = sideToPlaceAgainst(bot, new Vec3(5, 64, 0), DIRS, isEmpty);
    assert.deepEqual(side.buildOffBlock.position, new Vec3(6, 64, 0));
});

test('with no side in view the preferred known one is kept, for the placement to explain', () => {
    const { bot } = namedCells({ cells: { '5,63,0': 'stone', '6,64,0': 'stone' }, faces: new Set() });
    const side = sideToPlaceAgainst(bot, new Vec3(5, 64, 0), DIRS, isEmpty);
    assert.deepEqual(side.buildOffBlock.position, new Vec3(5, 63, 0));
});

test('nothing known to build off: no side', () => {
    const { bot } = namedCells({ cells: { '5,63,0': 'stone' }, known: new Set() });
    assert.equal(sideToPlaceAgainst(bot, new Vec3(5, 64, 0), DIRS, isEmpty), null);
});
