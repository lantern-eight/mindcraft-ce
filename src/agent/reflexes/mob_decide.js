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
// Gear widens rules 4 to 6 (fightScope): armed with a sword or an axe, three melee mobs at once are a fight,
// not a crowd; armed and in a full iron set or better, two archers (skeletons and their kin) are rushed
// instead of hidden from. Measured in the fight arena (tests/live/fight_arena.js). Under half health, or
// too hungry to sprint, gear counts for nothing.
//
// Standing orders (orders.js) change rules 4 to 6 for the mobs they name, and never rule 3. `orderOf(mob)`
// gives the order that applies to a mob now, already lapsed when the bot is under its minimum health:
//   fight   the fight takes it on, alone or not, strong or not; it counts toward no crowd and no 5b
//   flee    backed away from as soon as it comes for the bot (after rule 4), instead of fought
//   ignore  as if it weren't there, but for rule 3 and as a mob that could have dealt a hit (rule 7)
// A mob with no order goes by the rules above.
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
// Archers the bot may rush when well armored: the bow-carrying kin of the skeleton, the ones the arena measured.
const ARCHERS = new Set(['skeleton', 'stray', 'bogged']);
// Armor points of a full iron set: the armored kit the arena measured.
export const ARMORED = 15;
// Mobs that are no reason to run along the ground: they fly over it.
const FLYING = new Set(['phantom', 'vex', 'bat', 'ghast']);

export const isRanged = mob => RANGED.has(mob.name) || (mob.name === 'piglin' && mob.aiming);
export const isMelee = mob => mob.name !== 'creeper' && !isRanged(mob) && !FLYING.has(mob.name);
/** Whether a mob could have dealt a hit just felt: one within reach, one with a target, one that shoots. */
export const couldHaveHit = mob => mob.distance <= 6 || mob.aggressive || isRanged(mob);

const isArcher = mob => ARCHERS.has(mob.name);

/**
 * How many mobs at once the bot takes on by its own judgment: a lone melee mob bare-handed (measured trials
 * lost two zombies), three melee mobs with a sword or an axe, and two archers besides with a full iron set or
 * better. In the arena (Java, fair play strict, three runs each, every swing timed to the weapon) a stone
 * or copper sword beat three zombies with 3 damage taken; an iron sword in iron armor won every round, a mixed
 * one of two zombies, a skeleton and a spider with 7 damage, two skeletons with 4. A stone sword alone won the
 * mixed round too, but with 20 damage taken: so archers only when armored. Under half health, or with food at
 * 6 or less, it is the lone mob again, whatever the gear.
 * @param {object} self - {health, food, armed, armor}
 * @returns {{melee: number, archers: number}}
 */
export function fightScope(self) {
    if (self.health < FIGHT_HEALTH || (self.food ?? 20) <= FIGHT_FOOD || !self.armed) return { melee: 1, archers: 0 };
    return { melee: 3, archers: (self.armor ?? 0) >= ARMORED ? 2 : 0 };
}

const ignore = { stance: 'ignore' };
const pointsOf = mobs => mobs.map(mob => ({ ...mob.position }));
const noOrders = () => null;

// Whether a mob has come for the bot: a melee one that has picked a target, or is close enough that it is
// about to, within 8; one that shoots, aiming or with a target, within its range.
function comesFor(mob) {
    if (isRanged(mob)) return (mob.aiming || mob.aggressive) && mob.distance <= AIM_WITHIN;
    return (mob.aggressive || mob.distance <= CLOSE) && mob.distance <= CROWD_WITHIN;
}

/**
 * @param {object[]} mobs - hostile mobs, nearest first: {id, name, position, distance, seenNow, aiming,
 *     aggressive}. Stand-ins (seenNow false) are places to keep away from, never a reason to act.
 * @param {object} self - {position, health, food, gameMode, armed, armor}
 * @param {object} [extra]
 * @param {{at: number, direction: {x:number, z:number}|null, explained?: boolean}[]} [extra.hits] - hits
 *     felt, newest last; `explained` when a mob that could have dealt it was in view as it landed
 * @param {number} [extra.now]
 * @param {(key: string) => string|null} [extra.ownerOf] - which reflex has taken a mob (the claims)
 * @param {(mob: object) => {stance: string, distance?: number}|null} [extra.orderOf] - the standing order
 *     that applies to a mob now
 * @param {(id: number) => boolean} [extra.gaveUp] - whether the fight gave up on a mob lately (or couldn't
 *     reach it): an archer it would have rushed is then hidden from again
 * @returns {{stance: string, key?: string, from?: object[], ids?: number[], reason?: string, distance?: number}}
 *     `ids`: the mobs it is about, whose places `from` holds as they were
 */
export function decideMobThreat(mobs, self, { hits = [], now = Date.now(), ownerOf = () => null, orderOf = noOrders, gaveUp = () => false } = {}) {
    if (self.gameMode === 'creative' || self.gameMode === 'spectator') return ignore;
    const seen = mobs.filter(mob => mob.seenNow && mob.distance <= SEEN_WITHIN);
    const recent = hits.filter(hit => now - hit.at <= HITS_WITHIN_MS);
    const fought = mob => ownerOf(`id:${mob.id}`) === 'self_defense';
    const stanceOf = mob => orderOf(mob)?.stance ?? null;
    const own = mob => stanceOf(mob) === null;             // goes by the bot's own judgment
    const heeded = mob => stanceOf(mob) !== 'ignore';

    // 3. Low health: away from everything, the mobs out of view included. No order reaches this.
    if (self.health < LOW_HEALTH && (seen.length > 0 || recent.length > 0)) {
        const from = [...pointsOf(mobs.filter(mob => mob.distance <= SEEN_WITHIN)), ...hitPoints(recent, self)];
        const ids = mobs.filter(mob => mob.distance <= SEEN_WITHIN).map(mob => mob.id);
        if (from.length) return { stance: 'flee', key: 'low health', from, ids, reason: 'low health', distance: FLEE_TO };
    }

    // What the bot takes on by its own judgment, by its gear, and what has come for it.
    const scope = fightScope(self);
    const coming = seen.filter(mob => own(mob) && isMelee(mob) && (mob.aggressive || mob.distance <= CLOSE) && mob.distance <= CROWD_WITHIN);
    const archers = seen.filter(mob => own(mob) && isArcher(mob) && comesFor(mob));
    // An archer the fight will rush: armored enough, not too many of them or of the rest, and not one the fight
    // gave up on (out of reach, or its hits didn't land).
    const rushed = mob => isArcher(mob) && archers.length <= scope.archers && coming.length <= scope.melee && !gaveUp(mob.id);

    // 4. A mob aiming at the bot: out of its line of sight, unless the fight will rush it.
    const aiming = seen.find(mob => own(mob) && isRanged(mob) && mob.aiming && mob.distance <= AIM_WITHIN && !rushed(mob));
    if (aiming) return { stance: 'take_cover', key: `id:${aiming.id}`, from: [{ ...aiming.position }], ids: [aiming.id], reason: 'aiming', name: aiming.name, distance: AIM_WITHIN + 2 };

    // A standing order to back away: from every mob so ordered that has come for the bot, at once.
    const toFlee = seen.filter(mob => stanceOf(mob) === 'flee' && comesFor(mob));
    if (toFlee.length) {
        const distance = Math.max(...toFlee.map(mob => orderOf(mob).distance ?? RETREAT_TO));
        const key = toFlee.length === 1 ? `id:${toFlee[0].id}` : 'ordered';
        return { stance: 'retreat', key, from: pointsOf(toFlee), ids: toFlee.map(mob => mob.id), reason: 'ordered', name: toFlee[0].name, names: toFlee.map(mob => mob.name), distance };
    }

    // 5. Outnumbered: a fight the bot took on one mob doesn't hold this back, a second one changes it. A mob
    // that close counts whether or not it has picked a target yet: it is about to, and a second or two
    // waiting for it to show is a second or two of hits. Only mobs with no order count toward a crowd (the
    // ones it was told to fight are the fight's), but a crowd is backed away from all at once, those included.
    // More than the gear takes on, or two or more with one the bot shouldn't fight among them.
    if (coming.length > scope.melee || (coming.length >= 2 && coming.some(mob => TOO_STRONG.has(mob.name)))) {
        const crowd = mobs.filter(mob => heeded(mob) && isMelee(mob) && mob.distance <= SEEN_WITHIN && (mob.aggressive || !mob.seenNow || mob.distance <= CLOSE));
        return { stance: 'retreat', key: 'crowd', from: pointsOf(crowd), ids: crowd.map(mob => mob.id), reason: 'outnumbered', names: coming.map(mob => mob.name), distance: RETREAT_TO };
    }

    // 5b. One the bot shouldn't fight.
    if (coming.length === 1 && !fought(coming[0]) && coming[0].aggressive) {
        const mob = coming[0];
        const why = TOO_STRONG.has(mob.name) ? 'too strong' : self.health < FIGHT_HEALTH ? 'hurt'
            : (self.food ?? 20) <= FIGHT_FOOD ? 'hungry' : null;
        if (why) return { stance: 'retreat', key: `id:${mob.id}`, from: [{ ...mob.position }], ids: [mob.id], reason: why, name: mob.name, distance: RETREAT_TO };
    }

    // 7. Hits from something the bot can't see. A hit that landed with a mob in view that could have dealt
    // it is not one of them, even if that mob has since died or slipped out of view: in a fight against two,
    // the first one's last hits would otherwise send the bot away from the second.
    const withSide = recent.filter(hit => hit.direction && !hit.explained);
    if (withSide.length >= 2 && !seen.some(couldHaveHit)) {
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
 * half health or more, and food to sprint on. The mob reflex retreats from what is left out. A standing
 * order to fight widens it: any mob so ordered that comes for the bot, nearest first, while the bot is at
 * the order's minimum health or more; ranged ones too, within their range.
 * @param {object[]} mobs - as for decideMobThreat
 * @param {object} self - {health, food, gameMode}
 * @param {object} [extra]
 * @param {(mob: object) => boolean} [extra.reachable] - the cached path verdict
 * @param {(key: string) => string|null} [extra.ownerOf]
 * @param {(id: number) => boolean} [extra.givenUp] - a target the bot gave up on lately
 * @param {(mob: object) => object|null} [extra.orderOf] - as for decideMobThreat
 * @returns {object|null} the mob to fight
 */
export function chooseFight(mobs, self, { reachable = () => true, ownerOf = () => null, givenUp = () => false, orderOf = noOrders } = {}) {
    if (self.gameMode === 'creative' || self.gameMode === 'spectator') return null;
    if (self.health < LOW_HEALTH) return null;
    const stanceOf = mob => orderOf(mob)?.stance ?? null;
    const free = mob => {
        if (givenUp(mob.id)) return false;
        const owner = ownerOf(`id:${mob.id}`);
        return !owner || owner === 'self_defense';
    };

    // A standing order to fight: the nearest such mob that has come for the bot, however many there are.
    // Its minimum health was already checked (orderOf gives no order under it).
    const ordered = mobs.find(mob => mob.seenNow && mob.name !== 'creeper' && stanceOf(mob) === 'fight' && comesFor(mob) && free(mob));
    if (ordered) return reachable(ordered) ? ordered : null;

    // The bot's own judgment: as many as its gear takes on (fightScope), with the bot fit for it. Mobs it was
    // told to ignore aren't there.
    if (self.health < FIGHT_HEALTH || (self.food ?? 20) <= FIGHT_FOOD) return null;
    const scope = fightScope(self);
    const there = mobs.filter(mob => mob.seenNow && stanceOf(mob) !== 'ignore');
    const melee = there.filter(mob => isMelee(mob) && mob.aggressive && mob.distance <= CROWD_WITHIN);
    const archers = scope.archers > 0 ? there.filter(mob => isArcher(mob) && comesFor(mob)) : [];
    if (melee.length + archers.length === 0) return null;
    if (melee.length > scope.melee || archers.length > scope.archers) return null;
    // Others close by that haven't picked a target yet soon will: they count too.
    if (there.filter(mob => isMelee(mob) && mob.distance <= CROWD_WITHIN).length > scope.melee) return null;
    if ([...melee, ...archers].some(mob => TOO_STRONG.has(mob.name))) return null;
    // The nearest of them it is free to take on (no order of its own: flee, or a fight it isn't free for).
    const mob = [...melee, ...archers].filter(other => stanceOf(other) === null && free(other)).sort((a, b) => a.distance - b.distance)[0];
    if (!mob) return null;
    return reachable(mob) ? mob : null;
}

/**
 * Whether a mob may be fought once a fight is under way, as the fight turns from one mob to the next (it
 * fights in place, hitting whichever is in reach). The same mobs chooseFight would take on: one that has
 * come for the bot and is in view, and that an order tells it to fight, or that it would fight on its own
 * (a melee mob, not one too strong). Never one it was told to leave alone or back away from, one it gave
 * up on, or one another reflex has taken. An archer only when the gear's scope takes archers on.
 * @param {object} mob - as for decideMobThreat
 * @param {object} [extra] - ownerOf, givenUp and orderOf, as for chooseFight, and the gear's `scope` (fightScope)
 */
export function joinsFight(mob, { ownerOf = () => null, givenUp = () => false, orderOf = noOrders, scope = { melee: 1, archers: 0 } } = {}) {
    if (!mob.seenNow || mob.name === 'creeper' || !comesFor(mob) || givenUp(mob.id)) return false;
    const owner = ownerOf(`id:${mob.id}`);
    if (owner && owner !== 'self_defense') return false;
    const stance = orderOf(mob)?.stance ?? null;
    if (stance === 'fight') return true;
    if (stance !== null) return false;
    return (isMelee(mob) && !TOO_STRONG.has(mob.name)) || (isArcher(mob) && scope.archers > 0);
}

/**
 * The orders as the mob reflex goes by them. An order to fight a mob leaves that mob to the fight; once the
 * fight has given up on it (it couldn't get closer, or its hits didn't land), nothing would deal with it, and
 * an archer could shoot the bot where it stands. So for a mob the fight gave up on, an order to fight no
 * longer holds, and the bot's own judgment is back: cover from an archer, a retreat from a crowd.
 * @param {(mob: object) => object|null} orderOf
 * @param {(id: number) => boolean} gaveUp - whether the fight gave up on a mob lately
 */
export function ordersAfterGivingUp(orderOf, gaveUp) {
    return mob => {
        const order = orderOf(mob);
        return order?.stance === 'fight' && gaveUp(mob.id) ? null : order;
    };
}
