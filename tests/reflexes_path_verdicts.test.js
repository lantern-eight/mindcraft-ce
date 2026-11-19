// SPDX-License-Identifier: CC0-1.0
// world.isClearPath keeps its answer for a mob for 3 s, unless the mob or the bot moves 4 blocks, once a
// module asks it to; with nothing installed every ask searches, as in Mindcraft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { GAME_VERSION } from './helpers/game_version.js';
import { isClearPath } from '../src/agent/library/world.js';
import { keepPathVerdicts } from '../src/agent/library/path_verdicts.js';

const registry = minecraftData(GAME_VERSION);
function makeBot() {
    const bot = { registry, entity: { position: new Vec3(0, 64, 0) }, searches: 0, answer: 'success' };
    bot.pathfinder = { getPathTo: async () => { bot.searches++; return { status: bot.answer }; } };
    return bot;
}
const zombie = (x = 5) => ({ id: 9, name: 'zombie', position: new Vec3(x, 64, 0) });

test('with no cache, every ask searches', async () => {
    const bot = makeBot();
    await isClearPath(bot, zombie());
    await isClearPath(bot, zombie());
    assert.equal(bot.searches, 2);
});

test('a verdict is kept for 3 s, then searched again', async () => {
    const bot = makeBot();
    let t = 0;
    const cache = keepPathVerdicts(bot, { now: () => t });
    assert.equal(await isClearPath(bot, zombie()), true);
    bot.answer = 'noPath';
    t = 2900;
    assert.equal(await isClearPath(bot, zombie()), true, 'kept');
    assert.equal(bot.searches, 1);
    t = 3100;
    assert.equal(await isClearPath(bot, zombie()), false, 'searched again');
    assert.equal(bot.searches, 2);
    assert.deepEqual(cache.stats, { asked: 3, kept: 1 });
});

test('the mob or the bot moving 4 blocks makes the verdict stale', async () => {
    const bot = makeBot();
    keepPathVerdicts(bot, { now: () => 0 });
    await isClearPath(bot, zombie(5));
    await isClearPath(bot, zombie(8));
    assert.equal(bot.searches, 1, '3 blocks: kept');
    await isClearPath(bot, zombie(9.5));
    assert.equal(bot.searches, 2, '4.5 blocks: searched');
    bot.entity.position = new Vec3(4, 64, 0);
    await isClearPath(bot, zombie(9.5));
    assert.equal(bot.searches, 3, 'the bot moved');
    await isClearPath(bot, { name: 'spot', position: new Vec3(1, 64, 1) });
    await isClearPath(bot, { name: 'spot', position: new Vec3(1, 64, 1) });
    assert.equal(bot.searches, 5, 'no id: never kept');
});
