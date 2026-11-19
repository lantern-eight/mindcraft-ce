// SPDX-License-Identifier: CC0-1.0
// What to do about the hostile mobs around the bot, other than creepers: one pure decision for the mob
// reflex, and one for the fight. Tested with plain objects.
//
// decideMobThreat(mobs, self, extra) returns { stance, key, from, reason, distance }:
//   flee        sprint far from every hostile in view, and from where the hits came from
//   take_cover  get out of the line of sight of a mob aiming at the bot
//   retreat     sprint away from all of `from` at once, until `distance` from each
//   ignore      nothing to do
//
// First match wins (the creeper reflex, before this one in the mode list, has rules 1 and 2):
//   3. Health under 6, with a hostile in view or a hit felt just now: flee, far.
//   4. A ranged mob in view aiming at the bot (a bow raised or drawn, a crossbow held up), within 16:
//      take cover. Not whenever one is in view: at night that is the difference between a bot that
//      works and one that keeps running.
//   5. Two or more melee mobs in view within 8 that have picked a target (or are within 5, about to): retreat
//      from all of them. A single zombie is a fair fight; two at once killed an unarmed player in measured
//      trials. A fight already started on one of them doesn't hold this back.
//   5b. One such mob the bot is in no shape to fight, or that is too strong for a fight nobody asked
//      for: retreat from it. Health under 10, food 6 or less (no sprinting, no healing), a cave spider's
//      poison, a warden.
//   7. Hit twice within a few seconds with no mob in view that could have done it (none within reach, none
//      that has picked a target, none that shoots): retreat away from where the hits came from.
//   Anything else: ignore. Rule 6, a lone melee mob in a fair fight, is the fight's (chooseFight below,
//   run by `self_defense`).
//
// Seen means in view now. Under fair play that is what the bot sees; without it, every mob the server
// tracks. Neither ever reads a mob out of view: a stand-in where one was last seen counts only as a place
// to keep away from.

export const LOW_HEALTH = 6;        // rule 3: under this, any threat is a reason to run
export const FIGHT_HEALTH = 10;     // rule 6: at least half health to stand and fight
export const FIGHT_FOOD = 6;        // above this the bot can sprint and its health comes back
export const CROWD_WITHIN = 8;      // rules 5 and 6: how close a melee mob counts
export const AIM_WITHIN = 16;       // rule 4: a skeleton shoots from about 15 blocks
export const FLEE_TO = 20;
export const RETREAT_TO = 16;
export const HITS_WITHIN_MS = 4000; // rule 7: two hits this close together
const SEEN_WITHIN = 16;
const CLOSE = 5;                    // a melee mob this close counts as coming, target or not

// Mobs that fight from afar. A witch throws potions with no tell to see, so it counts as ranged but is
// never seen aiming. An evoker is `evocation_illager` on Bedrock.
const RANGED = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'illusioner', 'evoker', 'evocation_illager', 'witch', 'blaze', 'ghast', 'breeze', 'shulker']);
// Melee mobs the bot doesn't pick a fight with on its own: poison, or far stronger than an unarmed
// player. The fight's scope (rule 6) leaves them out, and rule 5b retreats from them.
const TOO_STRONG = new Set(['cave_spider', 'warden', 'ravager', 'vindicator', 'piglin_brute', 'hoglin', 'zoglin', 'enderman', 'wither_skeleton', 'wither']);
// Mobs that are no reason to run along the ground: they fly over it.
const FLYING = new Set(['phantom', 'vex', 'bat', 'ghast']);

export const isRanged = mob => RANGED.has(mob.name) || (mob.name === 'piglin' && mob.aiming);
export const isMelee = mob => mob.name !== 'creeper' && !isRanged(mob) && !FLYING.has(mob.name);

const ignore = { stance: 'ignore' };
const pointsOf = mobs => mobs.map(mob => ({ ...mob.position }));

/**
 * @param {object[]} mobs - hostile mobs, nearest first: {id, name, position, distance, seenNow, aiming,
 *     aggressive}. Stand-ins (seenNow false) are places to keep away from, never a reason to act.
 * @param {object} self - {position, health, food, gameMode}
 * @param {object} [extra]
 * @param {{at: number, direction: {x:number, z:number}|null}[]} [extra.hits] - hits felt, newest last
 * @param {number} [extra.now]
 * @param {(key: string) => string|null} [extra.ownerOf] - which reflex has taken a mob (the claims)
 * @returns {{stance: string, key?: string, from?: object[], ids?: number[], reason?: string, distance?: number}}
 *     `ids`: the mobs it is about, whose places `from` holds as they were
 */
export function decideMobThreat(mobs, self, { hits = [], now = Date.now(), ownerOf = () => null } = {}) {
    if (self.gameMode === 'creative' || self.gameMode === 'spectator') return ignore;
    const seen = mobs.filter(mob => mob.seenNow && mob.distance <= SEEN_WITHIN);
    const recent = hits.filter(hit => now - hit.at <= HITS_WITHIN_MS);
    const fought = mob => ownerOf(`id:${mob.id}`) === 'self_defense';

    // 3. Low health: away from everything, the mobs out of view included.
    if (self.health < LOW_HEALTH && (seen.length > 0 || recent.length > 0)) {
        const from = [...pointsOf(mobs.filter(mob => mob.distance <= SEEN_WITHIN)), ...hitPoints(recent, self)];
        const ids = mobs.filter(mob => mob.distance <= SEEN_WITHIN).map(mob => mob.id);
        if (from.length) return { stance: 'flee', key: 'low health', from, ids, reason: 'low health', distance: FLEE_TO };
    }

    // 4. A mob aiming at the bot: out of its line of sight.
    const aiming = seen.find(mob => isRanged(mob) && mob.aiming && mob.distance <= AIM_WITHIN);
    if (aiming) return { stance: 'take_cover', key: `id:${aiming.id}`, from: [{ ...aiming.position }], ids: [aiming.id], reason: 'aiming', name: aiming.name, distance: AIM_WITHIN + 2 };

    // 5. Outnumbered: a fight the bot took on one mob doesn't hold this back, a second one changes it. A mob
    // that close counts whether or not it has picked a target yet: it is about to, and a second or two
    // waiting for it to show is a second or two of hits.
    const coming = seen.filter(mob => isMelee(mob) && (mob.aggressive || mob.distance <= CLOSE) && mob.distance <= CROWD_WITHIN);
    if (coming.length >= 2) {
        const crowd = mobs.filter(mob => isMelee(mob) && mob.distance <= SEEN_WITHIN && (mob.aggressive || !mob.seenNow || mob.distance <= CLOSE));
        return { stance: 'retreat', key: 'crowd', from: pointsOf(crowd), ids: crowd.map(mob => mob.id), reason: 'outnumbered', names: coming.map(mob => mob.name), distance: RETREAT_TO };
    }

    // 5b. One the bot shouldn't fight.
    if (coming.length === 1 && !fought(coming[0]) && coming[0].aggressive) {
        const mob = coming[0];
        const why = TOO_STRONG.has(mob.name) ? 'too strong' : self.health < FIGHT_HEALTH ? 'hurt'
            : (self.food ?? 20) <= FIGHT_FOOD ? 'hungry' : null;
        if (why) return { stance: 'retreat', key: `id:${mob.id}`, from: [{ ...mob.position }], ids: [mob.id], reason: why, name: mob.name, distance: RETREAT_TO };
    }

    // 7. Hits from something the bot can't see.
    const withSide = recent.filter(hit => hit.direction);
    const couldHaveDoneIt = mob => mob.distance <= 6 || mob.aggressive || isRanged(mob);
    if (withSide.length >= 2 && !seen.some(couldHaveDoneIt)) {
        return { stance: 'retreat', key: 'unseen hits', from: hitPoints(withSide, self), ids: [], reason: 'unseen hits', distance: 12 };
    }
    return ignore;
}

// Where hits came from, as points a few blocks off on the side each came from: enough to run from.
function hitPoints(hits, self) {
    return hits.filter(hit => hit.direction).map(hit => ({
        x: self.position.x + hit.direction.x * 4, y: self.position.y, z: self.position.z + hit.direction.z * 4,
    }));
}

/**
 * Rule 6, the fight: a lone melee mob coming at the bot, fought only when the bot is fit for it. Measured
 * trials (unarmed, unarmored) won one mob of most kinds and lost two zombies, so the scope is one mob,
 * half health or more, and food to sprint on. The mob reflex retreats from what is left out.
 * @param {object[]} mobs - as for decideMobThreat
 * @param {object} self - {health, food, gameMode}
 * @param {object} [extra]
 * @param {(mob: object) => boolean} [extra.reachable] - the cached path verdict
 * @param {(key: string) => string|null} [extra.ownerOf]
 * @param {(id: number) => boolean} [extra.givenUp] - a target the bot gave up on lately
 * @returns {object|null} the mob to fight
 */
export function chooseFight(mobs, self, { reachable = () => true, ownerOf = () => null, givenUp = () => false } = {}) {
    if (self.gameMode === 'creative' || self.gameMode === 'spectator') return null;
    if (self.health < FIGHT_HEALTH || (self.food ?? 20) <= FIGHT_FOOD) return null;
    const coming = mobs.filter(mob => mob.seenNow && isMelee(mob) && mob.aggressive && mob.distance <= CROWD_WITHIN);
    if (coming.length !== 1) return null;
    const mob = coming[0];
    // Another one close by that hasn't picked a target yet soon will: not a fight to start.
    if (mobs.some(other => other !== mob && other.seenNow && isMelee(other) && other.distance <= CROWD_WITHIN)) return null;
    if (TOO_STRONG.has(mob.name) || givenUp(mob.id)) return null;
    const owner = ownerOf(`id:${mob.id}`);
    if (owner && owner !== 'self_defense') return null;
    return reachable(mob) ? mob : null;
}
