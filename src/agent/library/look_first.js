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

// ---- Going up to the surface ----

const OPEN = new Set(['air', 'cave_air', 'void_air']);
// One round goes up to the highest ground the bot knows of; from there it looks again. Underground with
// nothing remembered that is only the ceiling, so the climb goes a few blocks at a time.
const MAX_ROUNDS = 16;
const LOOK_UP = 1.45; // radians: nearly straight up (the game stops a look at 90 degrees)

/**
 * What the bot knows of the column above its head: the highest block in it, and whether every cell up to
 * the top of the world is known to be open sky.
 */
function columnAbove(bot) {
    const feet = cellOf(bot.entity.position);
    const top = (bot.game?.minY ?? -64) + (bot.game?.height ?? 384) - 1;
    let highest = null, open = true;
    for (let y = feet.y + 2; y <= top; y++) {
        const block = knownBlockAt(bot, new Vec3(feet.x, y, feet.z));
        if (!block) { open = false; continue; }
        if (OPEN.has(block.name)) continue;
        highest = block;
        open = false;
    }
    return { highest, open };
}

const SIDEWAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const solid = block => Boolean(block) && !OPEN.has(block.name) && block.boundingBox === 'block';

/**
 * Under open sky, the bot may still stand at the bottom of a pit: the shaft it dug its way up, say, with
 * its head just level with the ground. That is when all four sides are solid at head height. Then the way
 * out is to rise until one side is open: the feet height above the lowest of the four walls. Returns that
 * height, or null when the bot isn't walled in.
 */
function pitExit(bot) {
    const feet = cellOf(bot.entity.position);
    let exit = Infinity;
    for (const [dx, dz] of SIDEWAYS) {
        let y = feet.y + 1;
        if (!solid(knownBlockAt(bot, new Vec3(feet.x + dx, y, feet.z + dz)))) return null;
        while (solid(knownBlockAt(bot, new Vec3(feet.x + dx, y, feet.z + dz)))) y++;
        exit = Math.min(exit, y);
    }
    return exit;
}

/**
 * Waits for the bot to be on its feet. The walk counts a cell reached as soon as the bot is in it, which on
 * a pillar can be the top of a jump; judged from there, the pit it is about to drop back into looks like
 * open ground. A bot with no physics (a test's) has no onGround, and is taken as standing.
 */
async function landed(bot, timeoutMs = 2000) {
    const started = Date.now();
    while (bot.entity?.onGround === false && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Walks up to a height over the column, and stands there. A pillar's last block can fail to go down at the
 * top of a jump, and the bot drops back a block short; then it tries again, as a player would.
 */
async function climbTo(bot, goToPosition, x, y, z) {
    for (let tries = 0; tries < 3; tries++) {
        const before = Math.floor(bot.entity.position.y);
        await goToPosition(bot, x, y, z, 0);
        await landed(bot);
        const now = Math.floor(bot.entity.position.y);
        if (now >= y || (tries > 0 && now <= before)) return;
    }
}

/**
 * Looks up the column. At a player's turning speed (fairplay/turn_speed.js) the turn takes a moment, and a
 * newer look, the walk's last step say, ends it part way; so it is asked again until the bot faces up.
 */
async function lookUp(bot) {
    for (let tries = 0; tries < 3 && bot.look; tries++) {
        await bot.look(bot.entity.yaw, LOOK_UP, true);
        if (!(Math.abs(bot.entity.pitch - LOOK_UP) > 0.05)) return;
    }
}

/**
 * A bot standing in a hole one block deep, walled in at its feet but not at its head, can step up and out.
 * Returns the cell to step up to, on ground the bot knows of with room to stand, or null when it isn't in
 * such a hole or knows of no way out.
 */
function stepOut(bot) {
    const feet = cellOf(bot.entity.position);
    const sides = SIDEWAYS.map(([dx, dz]) => new Vec3(feet.x + dx, feet.y, feet.z + dz));
    if (!sides.every(side => solid(knownBlockAt(bot, side)))) return null;
    const room = side => [1, 2].every(up => {
        const block = knownBlockAt(bot, side.offset(0, up, 0));
        return block && !solid(block) && block.boundingBox === 'empty';
    });
    const way = sides.find(room);
    return way ? way.offset(0, 1, 0) : null;
}

/**
 * Goes up to the surface over the bot's own column. Mindcraft's version read the whole column from the
 * world data and went straight to the top of it, which told the model the height of the surface above a
 * sealed cave. This one goes to the highest block the bot knows of above it (the ceiling, or ground it
 * remembers from earlier), looks again from there, and stops when it sees open sky overhead and can
 * step out sideways. With fair play off the bot knows the whole column, so the first round goes all the
 * way, as before.
 *
 * @param {object} bot
 * @param {object} options
 * @param {(bot, x, y, z, minDistance) => Promise<boolean>} options.goToPosition - skills.goToPosition
 * @param {(bot, text) => void} options.log - skills.log
 * @returns {Promise<boolean>} true once the bot stands under open sky
 */
export async function climbToSurface(bot, { goToPosition, log }) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
        await landed(bot);
        const feetY = Math.floor(bot.entity.position.y);
        // Looking up the column, as a player climbing out does. Through a player's screen the cells straight
        // overhead are out of a level look.
        await lookUp(bot);
        const { highest, open } = columnAbove(bot);
        if (open) {
            const exitY = pitExit(bot);
            if (exitY === null) {
                // In a hole a block deep (a pillar whose last block didn't go down leaves one), it steps up
                // and out onto the ground beside it, as a player would, rather than stand in the hole.
                const out = stepOut(bot);
                if (out) {
                    await climbTo(bot, goToPosition, out.x, out.y, out.z);
                    if (Math.floor(bot.entity.position.y) > feetY) {
                        log(bot, `Reached the surface at y=${Math.floor(bot.entity.position.y)}.`);
                        return true;
                    }
                }
                log(bot, round === 0 ? `Already at the surface, with open sky above, at y=${feetY}.` : `Reached the surface at y=${feetY}.`);
                return true;
            }
            const feet = cellOf(bot.entity.position);
            log(bot, `Open sky above, but walls all round: climbing to y=${exitY} to step out.`);
            await climbTo(bot, goToPosition, feet.x, exitY, feet.z);
            if (Math.floor(bot.entity.position.y) <= feetY) {
                log(bot, `Could not climb out of the pit at y=${Math.floor(bot.entity.position.y)}.`);
                return false;
            }
            continue;
        }
        if (!highest) {
            log(bot, `Can't tell where the surface is: you can't see anything above you.`);
            return false;
        }
        const goal = highest.position.offset(0, 1, 0);
        log(bot, `Going up to the highest ground you know of above you, at y=${goal.y}.`);
        await climbTo(bot, goToPosition, goal.x, goal.y, goal.z);
        if (Math.floor(bot.entity.position.y) <= feetY) {
            log(bot, `Could not get any higher than y=${Math.floor(bot.entity.position.y)}.`);
            return false;
        }
    }
    log(bot, `Climbed to y=${Math.floor(bot.entity.position.y)}, but there is still no open sky above.`);
    return false;
}
