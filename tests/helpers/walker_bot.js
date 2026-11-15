// SPDX-License-Identifier: CC0-1.0
// A stand-in bot the real pathfinder can plan for, standing in a hand-built world.
//
// The fair-legs tests need the pathfinder's own route search, not a copy of it: the point is what that
// search is told about the world. So this takes the stub bot from fixture_world.js, hands out real blocks
// (with shapes and dig times, which the pathfinder reads), and loads the real pathfinder plugin onto it.
// Nothing here walks: the plugin's walking needs a server's physics. Planning needs none.
import blockFactory from 'prismarine-block';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import { stubBot } from './fixture_world.js';
import { GAME_VERSION } from './game_version.js';

/**
 * @param {object} world - from fixtureWorld
 * @param {object} [options] - as for stubBot: position, yaw, pitch, entities
 * @returns {object} the stub bot, with real blocks and `bot.pathfinder`
 */
export function walkerBot(world, options = {}) {
    const bot = stubBot(world, options);
    const Block = blockFactory(world.registry);
    bot.version = world.registry.version?.minecraftVersion ?? GAME_VERSION;
    bot.blockAt = pos => {
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const id = world.getStateId(x, y, z);
        if (id == null) return null;
        const block = Block.fromStateId(id, 0);
        block.position = new Vec3(x, y, z);
        return block;
    };
    bot.entity.onGround = true;
    bot.entity.effects = {};
    bot.inventory = { items: () => [], slots: [] };
    bot.clearControlStates = () => {};
    bot.stopDigging = () => {};
    pf.pathfinder(bot);
    return bot;
}

/**
 * Runs the pathfinder's search to its end and returns the last result, with the route as a list of
 * "x,y,z" cells. The cells come from each step's `hash`, which keeps the cell the search chose; the
 * step's own x, y and z are rewritten afterwards into where the bot should stand.
 */
export function planRoute(bot, movements, goal, { timeoutMs = 5000 } = {}) {
    let last = null;
    for (const { result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, { timeout: timeoutMs, tickTimeout: timeoutMs })) last = result;
    return { status: last.status, cost: last.cost, cells: last.path.map(step => step.hash), path: last.path, visited: last.visitedNodes };
}
