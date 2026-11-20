// SPDX-License-Identifier: CC0-1.0
// What to do about the creepers in the threat picture: one pure decision, tested with plain objects.
//
// decideThreat(creepers, self, extra) returns { stance, key, from, reason, sprint, distance }:
//   back_off           sprint straight away until `distance` blocks from `from` (8: past the 7 blocks its
//                      fuse burns within)
//   hit_and_step_back  one sprint-hit, which knocks it back, then step back past its range
//   leave              go well away (22 blocks, well past the 16 a creeper follows) or out of its sight
//   watch              it is there but can't reach the bot; do nothing yet
//   ignore             nothing to do
//
// First match wins, so a lit creeper outranks everything else, a closer zombie included:
//   1. A lit creeper (seen lit, or a hiss remembered) within 7 blocks: back off.
//   1b. A creeper the bot already backed off from, coming again (it is following): finish the encounter.
//       Armed well enough (at most 4 hits needed) and with health 10 or more: hit it and step back, going
//       back in only once its fuse has run down. Otherwise leave it behind for good. On Bedrock always leave: its
//       creepers follow rules of their own that are not measured yet.
//   2. A creeper within 3 blocks whose fuse isn't lit yet: back off before it lights. An explosion heard
//      very close: back off from it (another may follow).
// A creeper well above a bot that is underground can't reach it, and is only watched.
//
// A standing order about creepers (orders.js) changes how an encounter goes, never whether a lit creeper is
// moved away from:
//   fight  a creeper seen within 6 blocks is met as rule 1b meets a following one, at the first meeting:
//          hit it and step back when armed well enough (Java only), going in only once its fuse has run
//          down. Not armed well enough, or on Bedrock, the order changes nothing.
//   flee   every reason to move (rules 1, 1b and 2, and a creeper seen coming within 8) leaves it for good
//          at once, to the order's distance, instead of backing off and waiting for it to follow.
//
// While it backs off from a lit creeper, a bot with a shield in the off-hand stops and holds it up toward the
// creeper when it can't get clear in time (blockTheBlast): a shield faced at a blast stops it.
//
// The bot's other reflexes and the `cowardice` switch have no say here: backing off from a creeper about
// to explode is self-preservation, like stepping out of lava.
import { FUSE_RANGE, FUSE_TICKS } from './picture.js';

export const BACK_OFF_TO = 8;       // past FUSE_RANGE, with a block to spare
// A creeper keeps its target while it is within 16 blocks (its follow range), and closes in on a bot that
// stops right at 16. Leaving goes well past that, so it loses the bot for good.
export const LEAVE_TO = 22;
export const MAX_HITS = 4;          // the most hits the bot will take on a creeper to finish it
export const MIN_HEALTH = 10;       // half health
const LIGHTS_WITHIN = 3;            // a creeper lights its fuse when its target is this close
const FINISH_WITHIN = 6;            // a following creeper this close is met, not waited for
const FUSE_NEAR_ZERO = 3;           // ticks: its fuse has as good as run down
const ABOVE_REACH = 4;              // blocks above an underground bot past which a creeper can't reach it
const EXPLOSION_CLOSE = 4;          // "very close" in hearing's bands
const FLEE_SEEN = 8;                // a creeper ordered fled is left as soon as it is seen this close

export const BLAST_REACH = 6;       // a creeper's blast hurts within about 6 blocks
const SPRINT_PER_TICK = 0.28;       // blocks a sprint covers in a tick

const ignore = { stance: 'ignore' };

/**
 * Whether to stop and hold a shield up at a lit creeper instead of running on. A player does when the blast
 * will catch them anyway: the creeper is in view and lit within the blast's reach, and at a sprint the fuse
 * runs out before the bot is past that reach; or the bot can't get away (it is stuck, or already behind its
 * shield, standing). The fuse is the picture's estimate, which a player keeps the same way: it swells and
 * flashes faster as it nears the end.
 * @param {object|null} creeper - from the threat picture: {seenNow, lit, distance, fuse}
 * @param {{stuck?: boolean}} [extra]
 */
export function blockTheBlast(creeper, { stuck = false } = {}) {
    if (!creeper?.seenNow || !creeper.lit || creeper.distance >= BLAST_REACH) return false;
    if (stuck) return true;
    const ticksLeft = Math.max(0, FUSE_TICKS - (creeper.fuse ?? 0));
    return creeper.distance + ticksLeft * SPRINT_PER_TICK < BLAST_REACH;
}

/**
 * @param {object[]} creepers - from the threat picture, nearest first: {key, position, distance, lit,
 *     fuse, seenNow, source, encounters}
 * @param {object} self - {position, health, gameMode, edition: 'java'|'bedrock', underground, hitsNeeded}
 * @param {object} [extra]
 * @param {{position: object, distance: number}|null} [extra.explosion]
 * @param {{stance: string, distance?: number}|null} [extra.order] - the standing order about creepers that
 *     applies now (lapsed already under its minimum health)
 * @returns {{stance: string, key?: string, from?: object, reason?: string, sprint?: boolean, distance?: number}}
 */
export function decideThreat(creepers, self, { explosion = null, order = null } = {}) {
    // A player in creative or spectator mode takes no damage.
    if (self.gameMode === 'creative' || self.gameMode === 'spectator') return ignore;

    const outOfReach = creeper => self.underground && creeper.seenNow
        && creeper.position.y - self.position.y >= ABOVE_REACH;
    let watching = null;

    for (const creeper of creepers) {
        // A heard creeper may be nearer than its rebuilt spot, by its band's slack.
        const lit = creeper.lit && creeper.distance - (creeper.slack ?? 0) <= FUSE_RANGE;
        const close = creeper.seenNow && creeper.distance <= LIGHTS_WITHIN;
        const following = creeper.encounters > 0 && creeper.seenNow && creeper.distance <= FINISH_WITHIN;
        const toMeet = order?.stance === 'fight' && creeper.seenNow && creeper.distance <= FINISH_WITHIN && fitToHit(self, order);
        const toFlee = order?.stance === 'flee' && creeper.seenNow && creeper.distance <= FLEE_SEEN;
        if (!lit && !close && !following && !toMeet && !toFlee) continue;
        if (outOfReach(creeper)) { watching ??= { stance: 'watch', key: creeper.key, from: creeper.position, reason: 'above, out of reach' }; continue; }
        if (order?.stance === 'flee') return { stance: 'leave', key: creeper.key, from: creeper.position, reason: 'ordered', sprint: true, distance: (order.distance ?? LEAVE_TO) + (creeper.slack ?? 0) };
        if (creeper.encounters > 0 || toMeet) return finish(creeper, self, order);
        return backOff(creeper, lit ? 'lit' : 'close');
    }
    if (explosion && explosion.distance <= EXPLOSION_CLOSE)
        return { stance: 'back_off', key: 'explosion', from: explosion.position, reason: 'explosion', sprint: true, distance: BACK_OFF_TO + (explosion.slack ?? 0) };
    return watching ?? ignore;
}

// A heard creeper's spot is only rebuilt from a distance band, and it may be nearer than that by the band's
// slack: the back-off goes that much farther.
function backOff(creeper, why) {
    const reason = creeper.source === 'heard' ? 'hissed' : why === 'lit' ? 'lit' : 'close';
    return { stance: 'back_off', key: creeper.key, from: creeper.position, reason, sprint: true, distance: BACK_OFF_TO + (creeper.slack ?? 0) };
}

// Whether the bot can hit a creeper and step back: Java's rules, a weapon that kills it in 4 hits, and half
// health, or the order's own minimum (orders.js gives no order under it).
function fitToHit(self, order) {
    const health = order?.stance === 'fight' ? 0 : MIN_HEALTH;
    return self.edition !== 'bedrock' && self.hitsNeeded <= MAX_HITS && self.health >= health;
}

// Rule 1b: the same creeper again, or a creeper the bot was told to fight. Finish it, by hitting it or by
// leaving for good.
function finish(creeper, self, order) {
    const canFight = fitToHit(self, order);
    if (!canFight) return { stance: 'leave', key: creeper.key, from: creeper.position, reason: 'following', sprint: true, distance: LEAVE_TO };
    // Going back in only once its fuse has run down: a fuse half burned explodes with no new hiss.
    if (creeper.lit || creeper.fuse > FUSE_NEAR_ZERO) return backOff(creeper, 'lit');
    const reason = creeper.encounters > 0 ? 'following' : 'ordered';
    return { stance: 'hit_and_step_back', key: creeper.key, from: creeper.position, reason, sprint: true, distance: BACK_OFF_TO };
}

// Swords and axes are what the bot counts as weapons. What each one does is the edition's answer
// (meleeOf at the edition seam): Java and Bedrock give them different damage, and only Java makes a swing
// wait for the weapon to recharge.
const WEAPON = /_(sword|axe)$/;
const TYPICAL_HEALTH = 20; // a zombie's, a skeleton's, a creeper's

/**
 * How long a weapon takes to kill a mob with this much health, from the first hit, swinging each time it is
 * fully recharged: (hits needed - 1) recharges.
 * @param {{damage: number, rechargeMs: number}} melee - the edition's answer for the weapon
 */
export function killTimeMs({ damage, rechargeMs }, health = TYPICAL_HEALTH) {
    return (Math.ceil(health / damage) - 1) * rechargeMs;
}

/**
 * How many hits the best weapon among these items needs to kill a creeper, without critical hits.
 * @param {string[]} itemNames - what the bot carries
 * @param {(name: string) => {damage: number}} meleeOf - the edition's answer (edition seam)
 */
export function hitsNeeded(itemNames, meleeOf) {
    const best = Math.max(1, ...itemNames.filter(name => WEAPON.test(name)).map(name => meleeOf(name).damage));
    return Math.ceil(TYPICAL_HEALTH / best);
}

/**
 * The weapon among these that kills a typical mob soonest, or null when none is a weapon. Soonest, not
 * hardest-hitting: on Java an iron axe hits for 9 and a sword for 6, but the sword swings almost twice as
 * often and kills a zombie sooner. On a tie, the harder hit (fewer swings to land).
 * @param {string[]} itemNames - what the bot carries
 * @param {(name: string) => {damage: number, rechargeMs: number}} meleeOf - the edition's answer
 */
export function bestWeapon(itemNames, meleeOf) {
    let best = null, bestTime = Infinity, bestDamage = 0;
    for (const name of new Set(itemNames)) {
        if (!WEAPON.test(name)) continue;
        const melee = meleeOf(name);
        if (melee.damage <= 1) continue; // a name the edition doesn't know as a weapon
        const time = killTimeMs(melee);
        if (time < bestTime || (time === bestTime && melee.damage > bestDamage)) { best = name; bestTime = time; bestDamage = melee.damage; }
    }
    return best;
}
