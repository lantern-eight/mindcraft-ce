// SPDX-License-Identifier: CC0-1.0
// The moves the threat reflexes make. None of them pauses any reflex: self_preservation least of all,
// since a bot backing off from a creeper can back into lava.
//
//   backOffFrom(bot, options)     sprint away from a point until far enough, out of time, or told to stop
//   retreatFrom(bot, options)     the same, away from several threats at once
//   hitAndStepBack(bot, options)  one sprint-hit at a creeper, which knocks it back, then back off
//   takeCover(bot, options)       walk to the nearest spot a mob's line of sight doesn't reach
//   fightOne(bot, options)        fight one mob until it is gone, or until told to stop
//
// A creeper's fuse is the clock: from lit to the blast is 1.5 s. So the first step away must not wait on
// a path search. If the ground straight away from the threat is open and safe, the bot sprints that way
// at once, and keeps going while the way stays safe; the pathfinder takes over where it doesn't. Choosing that direction is a
// decision, so it reads blocks through world.js's provider: what the bot has seen under fair play, the
// raw world without it. It never steps into lava or fire, or off a drop of more than 2 blocks; with no
// safe straight line it waits for the pathfinder instead. Otherwise self_preservation would step in, and
// the two reflexes would fight over the bot.
//
// The walking itself goes through the pathfinder, so under fair play its route is planned over what the
// bot has seen (fair_legs.js), like every other walk.
import pf from 'mineflayer-pathfinder';
import { worldQueries } from '../library/world_queries.js';
import { bestWeapon } from './decide.js';

const HAZARD = /lava|fire|magma|cactus|campfire|sweet_berry|powder_snow|wither_rose/; // flowing_lava too
const MAX_DROP = 2;
const TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]; // straight away first, then aside
const STEP_MS = 50;

const floorOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const open = block => Boolean(block) && block.boundingBox === 'empty' && !HAZARD.test(block.name);

/**
 * Whether a body can stand in the cell at feet `cell`: feet and head open, ground under it within a drop
 * of 2, and nothing burning. A cell the bot doesn't know is not safe.
 * @param {(pos: object) => object|null} blockAt
 */
export function safeCell(blockAt, cell) {
    if (!open(blockAt(cell)) || !open(blockAt({ ...cell, y: cell.y + 1 }))) return false;
    for (let drop = 1; drop <= MAX_DROP + 1; drop++) {
        const below = blockAt({ ...cell, y: cell.y - drop });
        if (!below) return false;               // unknown: can't tell how far the fall is
        if (HAZARD.test(below.name)) return false;
        if (below.boundingBox !== 'empty') return true;
    }
    return false;                               // a drop of more than 2
}

/**
 * The direction of a safe straight first step away from `from`, as a unit {x, z}, or null when none is
 * safe. Tries straight away first, then 45 and 90 degrees to either side. Two cells along it must be safe.
 * @param {(pos: object) => object|null} blockAt - reads blocks the fair way (through world.js's provider)
 * @param {{x:number, y:number, z:number}} position - the bot's feet
 * @param {{x:number, z:number}} from - the threat
 */
export function firstStep(blockAt, position, from) {
    let dx = position.x - from.x, dz = position.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) { dx = 1; dz = 0; } else { dx /= length; dz /= length; }
    for (const turn of TURNS) {
        const x = dx * Math.cos(turn) - dz * Math.sin(turn), z = dx * Math.sin(turn) + dz * Math.cos(turn);
        const cells = [1, 2].map(k => floorOf({ x: position.x + x * k, y: position.y, z: position.z + z * k }));
        if (cells.every(cell => safeCell(blockAt, cell))) return { x, z };
    }
    return null;
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function escapeMovements(bot) {
    const movements = new pf.Movements(bot);
    movements.canDig = false;           // digging takes time a fuse doesn't give
    movements.canOpenDoors = false;     // a door is slow, and the creeper follows through it
    movements.allow1by1towers = false;
    movements.scafoldingBlocks = [];
    movements.allowSprinting = true;
    movements.maxDropDown = MAX_DROP;    // as for the first step: a fall hurts, and the creeper is still coming
    return movements;
}

/**
 * Backs away from a point. Ends when the bot is `to` blocks from it, when `done()` says so, after `maxMs`,
 * or when the action is stopped.
 * @param {object} bot
 * @param {object} options
 * @param {() => object|null} options.from - where the threat is now (it may move); null when it is gone
 * @param {number} [options.to] - blocks to get from it
 * @param {number} [options.maxMs]
 * @param {() => boolean} [options.done] - another reason to stop, such as being out of its sight
 * @param {(event: object) => void} [options.report] - told when the first step is taken, for timing
 * @returns {Promise<{distance: number|null, ended: string}>}
 */
export async function backOffFrom(bot, { from, to = 8, maxMs = 3000, done = () => false, report = () => {} }) {
    return retreatFrom(bot, { from: () => { const point = from(); return point ? [point] : null; }, to, maxMs, done, report });
}

/**
 * The way straight away from several threats at once, as a flat unit vector {x, z}: each pushes the bot
 * away from itself, the nearer the harder. Null when they are all where the bot stands.
 */
export function awayFrom(position, points) {
    let x = 0, z = 0;
    for (const point of points) {
        const dx = position.x - point.x, dz = position.z - point.z;
        const squared = dx * dx + dz * dz;
        if (squared < 1e-4) continue;
        x += dx / squared; z += dz / squared;
    }
    const length = Math.hypot(x, z);
    return length < 1e-6 ? null : { x: x / length, z: z / length };
}

/**
 * Sprints away from several threats at once until the bot is `to` blocks from each, when `done()` says so,
 * after `maxMs`, or when the action is stopped. It goes away from all of them together, not just the
 * nearest: running from one zombie straight into the next is what a flee that follows the nearest does.
 * @param {object} bot
 * @param {object} options
 * @param {() => object[]|null} options.from - where the threats are now (they may move); null when gone
 * @param {number} [options.to]
 * @param {number} [options.maxMs]
 * @param {() => boolean} [options.done]
 * @param {(event: object) => void} [options.report]
 * @returns {Promise<{distance: number|null, ended: string}>} distance: to the nearest threat
 */
export async function retreatFrom(bot, { from, to = 16, maxMs = 6000, done = () => false, report = () => {} }) {
    const started = Date.now();
    const blockAt = pos => worldQueries().blockAt(bot, pos);
    let threats = from();
    const distance = () => (threats?.length ? Math.min(...threats.map(point => flat(bot.entity.position, point))) : null);
    const finished = () => {
        if (bot.interrupt_code) return 'stopped';
        const now = from();
        if (now?.length) threats = now;
        if (!threats?.length) return 'gone';
        if (distance() >= to) return 'far enough';
        if (done()) return 'done';
        if (Date.now() - started > maxMs) return 'out of time';
        return null;
    };
    let ended = finished();
    try {
        // The dash: straight away at once, if that way is safe, and on for as long as it stays safe. A
        // sprint in a straight line is the fastest way out; the pathfinder walks more than it sprints.
        const away = ended ? null : awayFrom(bot.entity.position, threats);
        const position = bot.entity.position;
        const step = away ? firstStep(blockAt, position, { x: position.x - away.x, z: position.z - away.z })
            : ended ? null : firstStep(blockAt, position, threats[0]);
        if (step) {
            const ahead = () => bot.entity.position.offset(step.x * 3, 1.6, step.z * 3);
            await bot.lookAt(ahead(), true);
            bot.setControlState('sprint', true);
            bot.setControlState('forward', true);
            report({ event: 'step', at: performance.now(), how: 'dash' });
            while (!(ended = finished())) {
                // Two cells ahead, as for the first step: one more block is all a sprint covers between checks.
                const next = [1, 2].map(k => floorOf({ x: bot.entity.position.x + step.x * k, y: bot.entity.position.y, z: bot.entity.position.z + step.z * k }));
                if (!next.every(cell => safeCell(blockAt, cell))) break; // something in the way: the pathfinder picks
                await wait(STEP_MS);
            }
            bot.clearControlStates();
        }
        // The rest, by the pathfinder, re-aimed when a threat moves.
        let aimedAt = null;
        while (!ended && !(ended = finished())) {
            if (!aimedAt || aimedAt.length !== threats.length || threats.some((point, i) => flat(aimedAt[i], point) > 2)) {
                aimedAt = threats.map(point => ({ ...point }));
                bot.pathfinder.setMovements(escapeMovements(bot));
                bot.pathfinder.setGoal(awayGoal(threats, to), true);
                if (!step) report({ event: 'step', at: performance.now(), how: 'path' });
            }
            await wait(STEP_MS);
        }
    } finally {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
    }
    return { distance: distance(), ended };
}

// Anywhere at least `to` from every threat: the opposite of "near any of them".
function awayGoal(threats, to) {
    const near = threats.map(point => new pf.goals.GoalNear(point.x, point.y, point.z, to));
    return new pf.goals.GoalInvert(near.length === 1 ? near[0] : new pf.goals.GoalCompositeAny(near));
}

/**
 * One sprint-hit at a creeper, then a back-off past its range. A sprinting hit knocks it back several
 * blocks, and with the bot stepping back at the same time its fuse runs down. The bot never stands next
 * to it: if it can't land the hit quickly, it backs off anyway.
 * @param {object} bot
 * @param {object} options
 * @param {() => object|null} options.creeper - the creeper as the bot sees it now, or null
 * @param {(entity: object) => boolean} options.inReach - whether a hit from here lands
 * @param {number} [options.to]
 */
export async function hitAndStepBack(bot, { creeper, inReach, to = 8, report = () => {} }) {
    const weapon = bestWeapon(bot.inventory.items().map(item => item.name));
    if (weapon && bot.heldItem?.name !== weapon) {
        const item = bot.inventory.items().find(i => i.name === weapon);
        if (item) await bot.equip(item, 'hand');
    }
    let hit = false;
    const started = Date.now();
    try {
        while (!bot.interrupt_code && Date.now() - started < 1500) {
            const target = creeper();
            if (!target) break;
            await bot.lookAt(target.position.offset(0, (target.height ?? 1.7) * 0.6, 0), true);
            // Sprinting as the hit lands is what knocks it back far.
            bot.setControlState('sprint', true);
            bot.setControlState('forward', true);
            if (inReach(target)) {
                await bot.attack(target);
                hit = true;
                break;
            }
            await wait(STEP_MS);
        }
    } finally {
        bot.clearControlStates();
    }
    const last = creeper();
    const where = last ? last.position.clone() : null;
    const result = await backOffFrom(bot, { from: () => creeper()?.position ?? where, to, report });
    return { hit, ...result };
}

// ---- Cover ----

/**
 * Whether known solid blocks stand between two points. Walks the cells the line crosses (the voxel walk
 * of sight.js, much simplified) and asks each one through `blockAt`. A cell the bot doesn't know is not
 * counted as solid: cover is only cover where the bot has seen the wall.
 * @param {(pos: object) => object|null} blockAt
 */
export function lineBlocked(blockAt, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return false;
    let x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z);
    const end = { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
    const next = (p, d, cell, step) => (step === 0 ? Infinity : ((step > 0 ? cell + 1 : cell) - p) / d);
    let tX = next(a.x, dx, x, stepX), tY = next(a.y, dy, y, stepY), tZ = next(a.z, dz, z, stepZ);
    const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx), deltaY = stepY === 0 ? Infinity : Math.abs(1 / dy), deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
    for (let guard = 0; guard < 256; guard++) {
        if (tX <= tY && tX <= tZ) { if (tX > 1) break; x += stepX; tX += deltaX; }
        else if (tY <= tZ) { if (tY > 1) break; y += stepY; tY += deltaY; }
        else { if (tZ > 1) break; z += stepZ; tZ += deltaZ; }
        if (x === end.x && y === end.y && z === end.z) break;
        const block = blockAt({ x, y, z });
        if (block && block.boundingBox === 'block') return true;
    }
    return false;
}

const BODY = [0.9, 1.6]; // where on a body a shot lands: the chest and the head

/** Whether a body standing with its feet at `feet` is hidden from `eye` by known blocks. */
export function hiddenFrom(blockAt, eye, feet) {
    return BODY.every(dy => lineBlocked(blockAt, eye, { x: feet.x, y: feet.y + dy, z: feet.z }));
}

/**
 * The nearest spots within `radius` where a body would be hidden from `eye`, nearest first: cells the bot
 * knows, safe to stand in (as for the first step of a back-off), and not right next to the mob.
 * @param {(pos: object) => object|null} blockAt
 * @param {{x:number, y:number, z:number}} position - the bot's feet
 * @param {{x:number, y:number, z:number}} eye - the mob's eye
 */
export function coverSpots(blockAt, position, eye, { radius = 6, limit = 5 } = {}) {
    const here = floorOf(position);
    const fromMob = Math.hypot(position.x - eye.x, position.z - eye.z);
    const spots = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const cell = { x: here.x + dx, y: here.y + dy, z: here.z + dz };
        const centre = { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 };
        if (Math.hypot(centre.x - eye.x, centre.z - eye.z) < Math.min(fromMob, 4)) continue;
        if (!safeCell(blockAt, cell) || !hiddenFrom(blockAt, eye, centre)) continue;
        spots.push({ cell, cost: Math.hypot(dx, dz) + Math.abs(dy) * 2 });
    }
    return spots.sort((a, b) => a.cost - b.cost).slice(0, limit).map(spot => spot.cell);
}

/**
 * Gets out of a mob's line of sight: walks to the nearest spot behind a wall the bot has seen. Ends when the
 * bot is hidden from the mob, when `done()` says so, after `maxMs`, or when the action is stopped. With no
 * cover near, it ends at once with 'no cover', for the caller to back out of range instead.
 * @param {object} bot
 * @param {object} options
 * @param {() => object|null} options.eye - the mob's eye now; null when it is gone
 * @returns {Promise<{ended: string}>}
 */
export async function takeCover(bot, { eye, maxMs = 6000, done = () => false, report = () => {} }) {
    const started = Date.now();
    const blockAt = pos => worldQueries().blockAt(bot, pos);
    let from = eye();
    const finished = () => {
        if (bot.interrupt_code) return 'stopped';
        from = eye() ?? from;
        if (!from) return 'gone';
        if (hiddenFrom(blockAt, from, bot.entity.position)) return 'covered';
        if (done()) return 'done';
        if (Date.now() - started > maxMs) return 'out of time';
        return null;
    };
    let ended = finished();
    if (ended) return { ended };
    const spots = coverSpots(blockAt, bot.entity.position, from);
    if (!spots.length) return { ended: 'no cover' };
    try {
        const movements = escapeMovements(bot);
        bot.pathfinder.setMovements(movements);
        bot.pathfinder.setGoal(new pf.goals.GoalCompositeAny(spots.map(cell => new pf.goals.GoalBlock(cell.x, cell.y, cell.z))), false);
        report({ event: 'step', at: performance.now(), how: 'cover' });
        while (!(ended = finished())) {
            if (!bot.pathfinder.isMoving?.() && !bot.pathfinder.goal) { ended = 'no way there'; break; }
            await wait(STEP_MS);
        }
    } finally {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
    }
    return { ended };
}

// ---- The fight ----

/**
 * Fights one mob, with the best weapon carried, until it is gone from view, until `stop()` says so, or
 * until the action is stopped. The combat plugin does the hitting and the following; it never chases the
 * mob out of the fight's range.
 * @param {object} bot
 * @param {object} options
 * @param {() => object|null} options.target - the mob as the bot sees it now, or null
 * @param {() => boolean} [options.stop]
 * @param {number} [options.maxMs]
 * @returns {Promise<{ended: string}>}
 */
export async function fightOne(bot, { target, stop = () => false, maxMs = 30000 }) {
    const weapon = bestWeapon(bot.inventory.items().map(item => item.name));
    if (weapon && bot.heldItem?.name !== weapon) {
        const item = bot.inventory.items().find(i => i.name === weapon);
        if (item) await bot.equip(item, 'hand');
    }
    const started = Date.now();
    let mob = target(), ended = null;
    if (!mob) return { ended: 'gone' };
    try {
        bot.pvp.attack(mob);
        while (!ended) {
            await wait(250);
            mob = target();
            if (bot.interrupt_code) ended = 'stopped';
            else if (!mob) ended = 'gone';
            else if (stop()) ended = 'stopped';
            else if (Date.now() - started > maxMs) ended = 'out of time';
        }
    } finally {
        bot.pvp.stop();
    }
    return { ended };
}
