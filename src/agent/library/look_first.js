// SPDX-License-Identifier: CC0-1.0
// Looking before acting: how a skill reads a block it was given by its coordinates.
//
// A skill told "break the block at 3, 60, -2" used to read that block straight from the world data the
// bot is sent, which includes every block deep inside the ground. Whatever it then said or did gave the
// block away: "Skipping the block ... because it is lava", "diamond_ore in the way", the height of the
// surface above a sealed cave. A player handed those coordinates would have to go and look first.
//
// So those skills ask here instead. A block comes from world.js's provider: under fair play, what the bot
// perceives or remembers; otherwise the raw world, exactly as Mindcraft always had it. When the bot doesn't
// know a cell, or only remembers it, it walks close, looks at it and reads it again. If it still can't see
// the cell (it is buried), the skill is told so, and decides nothing from it.
//
// The walking is passed in (skills.js's goToGoal and goToPosition), so this module needs nothing from
// skills.js. The fair answers come from the provider, so it needs nothing from fair play either: with fair
// play off, every cell that is loaded is "in view", and nothing here walks or changes what a skill does.
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import { worldQueries } from './world_queries.js';
import { assertActionOwner } from '../action_context.js';

// How close to walk to a cell the bot can't see yet. Close enough to look into a hollow or round a corner,
// and well within reach even of a block below the feet, so the skill can act from there without moving
// again. Any closer and a cell just under the ground could only be reached by digging down to it, which
// is more than a look.
const NEAR = 3;

const cellOf = pos => new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
const where = cell => `${cell.x}, ${cell.y}, ${cell.z}`;

/** The block at a cell as the bot knows it right now, without moving: null when it doesn't know. */
export function knownBlockAt(bot, pos) {
    return worldQueries().blockAt(bot, cellOf(pos)) ?? null;
}

/**
 * True for a block the bot perceives right now. Perception hands out a remembered block as a stand-in
 * marked with when it was seen (`rememberedAt`); that is fine for planning, but what is there now may
 * have changed, and acting on a block needs it in view.
 */
export function inViewNow(block) {
    return Boolean(block) && block.rememberedAt === undefined;
}

/**
 * The block at a cell, for a skill about to decide something from it or act on it. In view: returned at
 * once. Unknown, or only remembered: the bot walks within three blocks, looks at it, and reads again.
 *
 * @param {object} bot
 * @param {{x:number,y:number,z:number}} pos
 * @param {(bot: object, goal: object) => Promise<unknown>} goToGoal - how the skill walks (skills.goToGoal)
 * @returns {Promise<{block: object|null, reason?: string}>} the block in view, or null and a sentence for
 *   the model saying why the skill can't go on
 */
export async function lookFirst(bot, pos, goToGoal) {
    const cell = cellOf(pos);
    let block = knownBlockAt(bot, cell);
    if (inViewNow(block)) return { block };
    try {
        await goToGoal(bot, new pf.goals.GoalNear(cell.x, cell.y, cell.z, NEAR));
    } catch (error) {
        // A stopped action ends here, as it would anywhere else. A walk that found no way only means the
        // bot looks from wherever it got to.
        assertActionOwner(bot);
        if (bot.interrupt_code) throw error;
    }
    await bot.lookAt?.(cell.offset(0.5, 0.5, 0.5)); // matters only with a narrowed field of view
    block = knownBlockAt(bot, cell);
    if (inViewNow(block)) return { block };
    return {
        block: null,
        reason: block
            ? `You can't see the block at ${where(cell)} from as close as you could get, so you can't tell what is there now.`
            : `You can't see the block at ${where(cell)}, even from close by: other blocks hide it. Uncover it first, or choose a block you can see.`,
    };
}

/**
 * Which block to place against, and which side of it to click, for a block to go at `target`. Only
 * neighbors the bot knows about are considered, so it never builds off a block it hasn't seen. Among
 * them, the first (in the caller's order of preference) whose clicked side is in view wins, since a
 * player can only click a side they can see. When none is in view the first known one is returned
 * anyway, and the placement's own check says why it can't be done.
 *
 * @param {object} bot
 * @param {object} target - a Vec3, the cell the new block goes in
 * @param {object[]} dirs - Vec3 steps from the target to each neighbor, most preferred first
 * @param {(block: object) => boolean} isEmpty - true for a block that can't be built off (air, water...)
 * @returns {{buildOffBlock: object, faceVec: object}|null}
 */
export function sideToPlaceAgainst(bot, target, dirs, isEmpty) {
    let fallback = null;
    for (const d of dirs) {
        const block = knownBlockAt(bot, target.plus(d));
        if (!block || isEmpty(block)) continue;
        const side = { buildOffBlock: block, faceVec: new Vec3(-d.x, -d.y, -d.z) };
        if (worldQueries().seesFace(bot, block.position, side.faceVec)) return side;
        fallback ??= side;
    }
    return fallback;
}
