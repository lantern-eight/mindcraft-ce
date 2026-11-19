// SPDX-License-Identifier: CC0-1.0
// The moves the threat reflexes make. None of them pauses any reflex: self_preservation least of all,
// since a bot backing off from a creeper can back into lava.
//
//   backOffFrom(bot, options)     sprint away from a point until far enough, out of time, or told to stop
//   hitAndStepBack(bot, options)  one sprint-hit at a creeper, which knocks it back, then back off
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
    const started = Date.now();
    const blockAt = pos => worldQueries().blockAt(bot, pos);
    let threat = from();
    const distance = () => (threat ? flat(bot.entity.position, threat) : null);
    const finished = () => {
        if (bot.interrupt_code) return 'stopped';
        threat = from() ?? threat;
        if (!threat) return 'gone';
        if (distance() >= to) return 'far enough';
        if (done()) return 'done';
        if (Date.now() - started > maxMs) return 'out of time';
        return null;
    };
    let ended = finished();
    try {
        // The dash: straight away at once, if that way is safe, and on for as long as it stays safe. A
        // sprint in a straight line is the fastest way out; the pathfinder walks more than it sprints.
        const step = ended ? null : firstStep(blockAt, bot.entity.position, threat);
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
        // The rest, by the pathfinder, re-aimed when the threat moves.
        let aimedAt = null;
        while (!ended && !(ended = finished())) {
            if (!aimedAt || flat(aimedAt, threat) > 2) {
                aimedAt = { ...threat };
                bot.pathfinder.setMovements(escapeMovements(bot));
                bot.pathfinder.setGoal(new pf.goals.GoalInvert(new pf.goals.GoalNear(threat.x, threat.y, threat.z, to)), true);
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
