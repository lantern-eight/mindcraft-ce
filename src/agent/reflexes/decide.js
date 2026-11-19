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
// The bot's other reflexes and the `cowardice` switch have no say here: backing off from a creeper about
// to explode is self-preservation, like stepping out of lava.
import { FUSE_RANGE } from './picture.js';

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

const ignore = { stance: 'ignore' };

/**
 * @param {object[]} creepers - from the threat picture, nearest first: {key, position, distance, lit,
 *     fuse, seenNow, source, encounters}
 * @param {object} self - {position, health, gameMode, edition: 'java'|'bedrock', underground, hitsNeeded}
 * @param {object} [extra] - {explosion: {position, distance}|null}
 * @returns {{stance: string, key?: string, from?: object, reason?: string, sprint?: boolean, distance?: number}}
 */
export function decideThreat(creepers, self, { explosion = null } = {}) {
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
        if (!lit && !close && !following) continue;
        if (outOfReach(creeper)) { watching ??= { stance: 'watch', key: creeper.key, from: creeper.position, reason: 'above, out of reach' }; continue; }
        if (creeper.encounters > 0) return finish(creeper, self);
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

// Rule 1b: the same creeper again. Finish it, by hitting it or by leaving for good.
function finish(creeper, self) {
    const canFight = self.edition !== 'bedrock' && self.hitsNeeded <= MAX_HITS && self.health >= MIN_HEALTH;
    if (!canFight) return { stance: 'leave', key: creeper.key, from: creeper.position, reason: 'following', sprint: true, distance: LEAVE_TO };
    // Going back in only once its fuse has run down: a fuse half burned explodes with no new hiss.
    if (creeper.lit || creeper.fuse > FUSE_NEAR_ZERO) return backOff(creeper, 'lit');
    return { stance: 'hit_and_step_back', key: creeper.key, from: creeper.position, reason: 'following', sprint: true, distance: BACK_OFF_TO };
}

// The damage a hit does, by what is in the bot's hand (Java Edition; a fist does 1). Swords and axes are
// what equipHighestAttack picks.
const WEAPON_DAMAGE = {
    wooden_sword: 4, golden_sword: 4, stone_sword: 5, copper_sword: 5, iron_sword: 6, diamond_sword: 7, netherite_sword: 8,
    wooden_axe: 7, golden_axe: 7, stone_axe: 9, copper_axe: 9, iron_axe: 9, diamond_axe: 9, netherite_axe: 10,
};
const CREEPER_HEALTH = 20;

/**
 * How many hits the best weapon among these items needs to kill a creeper, without critical hits.
 * @param {string[]} itemNames - what the bot carries
 */
export function hitsNeeded(itemNames) {
    const best = Math.max(1, ...itemNames.map(name => WEAPON_DAMAGE[name] ?? 0));
    return Math.ceil(CREEPER_HEALTH / best);
}

/** The name of the item among these that hits hardest, or null when none is a weapon. */
export function bestWeapon(itemNames) {
    let best = null;
    for (const name of itemNames) if (WEAPON_DAMAGE[name] && (!best || WEAPON_DAMAGE[name] > WEAPON_DAMAGE[best])) best = name;
    return best;
}
