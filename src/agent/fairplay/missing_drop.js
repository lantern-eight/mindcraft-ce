// SPDX-License-Identifier: CC0-1.0
// Looking for a drop that didn't come, through a player's screen (library/drop_look.js says when).
//
// Gathering picks up the drops the bot can see. Through a player's screen a drop can be out of view although it
// lies close by: at the bottom of the hole the bot just dug beside its feet, hidden by the block it stands on, or
// below the bottom edge of the screen. Out of view, the pickup never goes for it, and the drop stays on the
// ground. On a server with Bedrock's pickup box, half a block under the feet, an item one block down is not
// handed over by the server either.
//
// A player whose block broke and gave nothing looks where the block was, and if the item is still not to be
// seen, steps over to the hole. So does the bot: it never knows where the drop is, only where the block was.
// Seeing all around, it already sees every drop in sight, and nothing is done.
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { cancellable } from '../action_context.js';
import * as world from '../library/world.js';
import { looksOf } from './look_around.js';

const HOLD_MS = 300;       // a look is held this long, so perception sees what it faces
const NEAR_CELL = 2;       // blocks: an item in view this near where the block was is its drop, or near enough
const WALK_MS = 4000;      // the walk over to the hole is given up after this
const IN_VIEW = 8;         // blocks: how far round the bot an item in view is looked for

/**
 * Any column within one of the cell, with the feet at the cell's height or one below: there the pickup box,
 * a block wider than the body and half a block under the feet, takes an item lying in the cell. The same
 * spots as the stock pickup's goal, for a cell instead of an item.
 */
export class GoalBesideCell extends pf.goals.Goal {
    constructor(cell) {
        super();
        this.x = Math.floor(cell.x); this.y = Math.floor(cell.y); this.z = Math.floor(cell.z);
    }
    heuristic(node) {
        const dx = Math.max(0, Math.abs(this.x - node.x) - 1), dz = Math.max(0, Math.abs(this.z - node.z) - 1);
        const below = this.y - node.y;
        const dy = below < 0 ? -below : below > 1 ? below - 1 : 0;
        return Math.sqrt(dx * dx + dz * dz) + dy;
    }
    isEnd(node) {
        const below = this.y - node.y;
        return Math.abs(this.x - node.x) <= 1 && Math.abs(this.z - node.z) <= 1 && (below === 0 || below === 1);
    }
}

/**
 * Looks for the drop of the block broken at `cell`: a look where it was, and if no item is in view near it, a
 * walk over to the hole when the hole is at or below the bot's feet, and another look. Says whether it did
 * either, so the caller picks up again.
 * @param {object} bot
 * @param {{x:number,y:number,z:number}} cell - where the block was
 * @param {object} [options]
 * @param {(bot: object, cell: object) => boolean} [options.seesItemNear] - is an item in view near the cell
 * @param {number} [options.holdMs]
 * @param {(bot: object) => object} [options.walkingMoves] - the pathfinder movements for the walk over
 * @returns {Promise<boolean>}
 */
export async function lookForMissingDrop(bot, cell, { seesItemNear = itemInViewNear, holdMs = HOLD_MS, walkingMoves = walkingOnly } = {}) {
    if (!looksOf(bot)?.getScreen() || !bot.entity?.position || !cell) return false;
    const floor = { x: Math.floor(cell.x) + 0.5, y: Math.floor(cell.y) + 0.15, z: Math.floor(cell.z) + 0.5 };
    const lookAtFloor = async () => {
        await bot.lookAt(new Vec3(floor.x, floor.y, floor.z), true);
        await new Promise(resolve => setTimeout(resolve, holdMs));
    };
    await lookAtFloor();
    if (seesItemNear(bot, cell) || bot.interrupt_code) return true;

    // Not to be seen from here. A hole at or below the feet may hide it: step over to it. A block broken above
    // the feet dropped its item onto open ground, which the look has already shown.
    const goal = new GoalBesideCell(cell);
    const feet = bot.entity.position.floored();
    if (Math.floor(cell.y) > feet.y || goal.isEnd(feet)) return true;
    const previous = bot.pathfinder.movements;
    bot.pathfinder.setMovements(walkingMoves(bot));
    try {
        await cancellable(bot, () => bot.pathfinder.goto(goal), WALK_MS, () => bot.pathfinder.setGoal(null));
    } catch (error) {
        if (bot.interrupt_code) throw error;
        // No way over, or not in time: the look from here is all a player would manage too.
    } finally {
        if (previous) bot.pathfinder.setMovements(previous);
    }
    if (!bot.interrupt_code) await lookAtFloor();
    return true;
}

/** Walking only, as the stock pickup's first try: nothing dug or placed to look for a drop. */
function walkingOnly(bot) {
    const walking = new pf.Movements(bot);
    walking.canDig = false;
    walking.scafoldingBlocks = [];
    walking.allow1by1towers = false;
    return walking;
}

/** Is an item in view, now or a moment ago, within a couple of blocks of the cell? */
function itemInViewNear(bot, cell) {
    const middle = { x: Math.floor(cell.x) + 0.5, y: Math.floor(cell.y) + 0.5, z: Math.floor(cell.z) + 0.5 };
    return world.getNearbyEntities(bot, IN_VIEW).some(e => e.name === 'item' && e.position
        && Math.hypot(e.position.x - middle.x, e.position.y - middle.y, e.position.z - middle.z) <= NEAR_CELL);
}
