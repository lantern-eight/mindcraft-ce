// SPDX-License-Identifier: CC0-1.0
// Digging down as a staircase, the way a careful player does.
//
// Mindcraft's digDown digs the column under the bot's feet. Before each block it reads the two below for
// lava, water or a drop, and those are still inside the ground: a player standing there can't see them.
// Without that look, digging straight down drops the bot into whatever is under the floor. That is why
// players dig a staircase instead: each block they will stand on next has its top uncovered, in plain
// view, before they step onto it.
//
// So does this. Each step digs the cells the body passes through and the one it will stand in, one block
// ahead and one block lower, then looks at the block that is now under the next step. Lava or water there
// or beside a cell it opened, a drop of more than two blocks, or a block it can't see or dig, and it stops
// and says why. Every block it reads comes through world.js's provider (look_first.js), so it decides from
// what the bot sees, never from the raw world.
//
// Fair play installs it as digDown's way of digging down (dig_down_way.js). It takes the stock skills it
// uses as arguments, so this module and skills.js don't import each other.
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as mc from '../../utils/mcdata.js';
import { assertActionOwner } from '../action_context.js';
import { knownBlockAt, inViewNow } from './look_first.js';

// The four ways a staircase can go, in mineflayer's directions (yaw 0 faces north, -z).
const HEADINGS = {
    north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0),
};
const OPEN = new Set(['air', 'cave_air', 'void_air']);
const LIQUIDS = new Set(['lava', 'water']);
// The same allowance as the stock digDown: a step that turns out to be a drop of up to two blocks is fine.
const MAX_FALL = 2;
// Sand or gravel falling into a cell as fast as it is dug.
const MAX_DIGS_PER_CELL = 8;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const NOT_BELOW = SIDES.filter(([, dy]) => dy !== -1);

const cellOf = pos => new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
const where = cell => `${cell.x}, ${cell.y}, ${cell.z}`;
// Names in Java's terms (the edition seam): Bedrock's spreading lava is `flowing_lava`.
const liquidOf = block => {
    const name = mc.javaNameOf(block.name);
    return LIQUIDS.has(name) ? name : null;
};
// Nothing to stand on: air, or a block with no collision box (a torch, a flower, tall grass).
const standable = block => !OPEN.has(block.name) && block.boundingBox !== 'empty' && !liquidOf(block);

/** The heading the bot faces, rounded to the nearest of the four. */
export function headingOf(yaw = 0) {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
    return dz > 0 ? 'south' : 'north';
}

/**
 * Lava or water the bot can see beside a cell, as words for the model; null when there is none. The cell
 * under the next step is left to landingBelow, which says so in its own words.
 */
function liquidBeside(bot, cell, sides = SIDES) {
    for (const [dx, dy, dz] of sides) {
        const side = cell.offset(dx, dy, dz);
        const block = knownBlockAt(bot, side);
        const liquid = block && liquidOf(block);
        if (liquid) return `there is ${liquid} at ${where(side)}, next to the staircase`;
    }
    return null;
}

/**
 * Makes one cell of the staircase open. Returns null when it is, or words saying why it can't be.
 * Only a cell in view is dug: the bot reads what it is digging, it doesn't guess.
 */
async function clearCell(bot, cell, breakBlockAt, sides) {
    for (let digs = 0; digs < MAX_DIGS_PER_CELL; digs++) {
        const block = knownBlockAt(bot, cell);
        if (!inViewNow(block)) return `you can't see the block at ${where(cell)}`;
        const liquid = liquidOf(block);
        if (liquid) return `there is ${liquid} at ${where(cell)}`;
        // Nothing to dig: air, or something the body passes through (a torch, tall grass).
        if (OPEN.has(block.name) || block.boundingBox === 'empty') return liquidBeside(bot, cell, sides);
        if (!await breakBlockAt(bot, cell.x, cell.y, cell.z)) return `could not dig the ${block.name} at ${where(cell)}`;
    }
    return `blocks kept falling into ${where(cell)}`;
}

/**
 * Where the bot will stand after stepping down onto the cell below `ahead`: the cell above the first
 * block it can stand on, within the allowed fall. Returns { stand } or { problem } with words for the model.
 */
function landingBelow(bot, ahead) {
    for (let fall = 0; fall <= MAX_FALL; fall++) {
        const floor = ahead.offset(0, -2 - fall, 0);
        const block = knownBlockAt(bot, floor);
        if (!block) return { problem: `you can't see what is under the next step, at ${where(floor)}` };
        const liquid = liquidOf(block);
        if (liquid) return { problem: `there is ${liquid} under the next step, at ${where(floor)}` };
        if (standable(block)) return { stand: floor.offset(0, 1, 0) };
    }
    return { problem: `there is a drop of more than ${MAX_FALL} blocks under the next step, at ${where(ahead.offset(0, -2, 0))}` };
}

/**
 * Digs down `distance` blocks as a staircase heading the way the bot faces.
 *
 * @param {object} bot
 * @param {number} distance - how many blocks down
 * @param {object} skills - the stock skills it uses: `breakBlockAt` and `log`
 * @returns {Promise<boolean>} true when it got all the way down
 */
export async function digStairsDown(bot, distance, { breakBlockAt, log }) {
    const heading = headingOf(bot.entity.yaw);
    const step = HEADINGS[heading];
    const start = cellOf(bot.entity.position).y;
    const depth = () => start - cellOf(bot.entity.position).y;
    const stop = why => {
        log(bot, `Dug down ${depth()} of ${distance} blocks as a staircase heading ${heading}, then stopped: ${why}.`);
        return false;
    };

    // The walk from step to step: no digging (the staircase does that, looking first) and no building.
    const walking = new pf.Movements(bot);
    walking.canDig = false;
    walking.scafoldingBlocks = [];
    walking.allow1by1towers = false;
    walking.allowParkour = false;

    while (depth() < distance) {
        const feet = cellOf(bot.entity.position);
        const ahead = feet.plus(step);
        // Top first, so sand or gravel loosened above falls into a cell that is still to be dug. Then once
        // more: what falls takes a moment to land, and by the second look it has.
        for (let pass = 0; pass < 2; pass++) {
            for (const cell of [ahead.offset(0, 1, 0), ahead, ahead.offset(0, -1, 0)]) {
                const sides = cell.y === ahead.y - 1 ? NOT_BELOW : SIDES;
                const problem = await clearCell(bot, cell, breakBlockAt, sides);
                if (problem) return stop(problem);
            }
        }
        // The block under the next step has its top uncovered now, so the bot can see it.
        const { stand, problem } = landingBelow(bot, ahead);
        if (problem) return stop(problem);
        bot.pathfinder.setMovements(walking);
        try {
            await bot.pathfinder.goto(new pf.goals.GoalBlock(stand.x, stand.y, stand.z));
        } catch (error) {
            assertActionOwner(bot); // a stopped action ends here, as it would anywhere else
            return stop(`could not step down to ${where(stand)} (${error.message})`);
        }
        if (cellOf(bot.entity.position).y >= feet.y) return stop(`could not step down to ${where(stand)}`);
    }
    log(bot, `Dug down ${depth()} blocks as a staircase heading ${heading}.`);
    return true;
}
