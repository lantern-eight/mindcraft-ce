// SPDX-License-Identifier: CC0-1.0
// The fight's own moves: how the bot fights a mob hand to hand, once the fight (`self_defense`, in
// fight_reflex.js) has chosen to. Whom to fight is decided there; this is only how.
//
//   fightMelee(bot, options)   fight until no mob it may fight is left near, or until told to stop
//
// It took over from Mindcraft's combat plugin (mineflayer-pvp), which follows one mob and swings on a timer.
// What a player does instead, and this does:
//   - Swings when the weapon is recharged and the mob is in reach. How long a weapon takes to recharge, and
//     how hard it hits, is the edition's answer (meleeOf at the edition seam): Java has an attack meter,
//     Bedrock has none. The plugin's own table stopped before copper, so a copper sword swung every 5 ticks
//     at a third of its damage. Reach is measured as the game measures it, from the eye to the nearest point
//     of the mob's body (survivalReach), not from the feet.
//   - Turns to whichever mob is in reach when the one it was fighting isn't (an idea from hashtagakiaki's
//     trials, where two zombies won by the second biting while the bot chased the first). A target in reach
//     is finished first.
//   - Steps back while the weapon recharges, when a second mob is close or the target is right on it
//     (LarsHamb's arena): the mobs reach it one at a time instead of together. Never backwards into lava or
//     off a drop.
//   - Sprints straight at a mob on its own level when the ground between is open, safe and seen; the
//     pathfinder (fair legs, under fair play) finds the way otherwise (LarsHamb: a skeleton backs off faster
//     than the pathfinder re-plans). It doesn't chase out of a leash round where the fight began
//     (JQDAW's fight in place, nengoxx's leash): 12 blocks, or 24 after an archer, which backs away as it shoots.
//   - Puts the weapon back in hand whenever it isn't there (wehos/mc-agent-neko: an equip lost to another
//     action left it fighting bare-handed).
//   - Lets go of a fight that isn't working: a mob it can't get closer to for 6 s (LarsHamb), or swings in
//     reach that never make the mob flinch (neko's breaker, made fair: the red flash a player sees, never
//     the mob's health).
//   - With a shield in the off-hand, it stops and holds it up toward an archer it sees drawing its bow
//     while its target is out of reach, and goes on once the arrow has landed (neko's matchup: close on a
//     skeleton behind a shield). The shield is down to move and to swing (shield.js says why).
//   - It neither swings nor changes what it holds in the middle of a meal: a player can't, and a sword put
//     back in hand would cut the meal short (the use-item channel, item_use.js).
//
// Fair play: everything it acts on is what the bot sees. The mobs come from the caller, which reads them
// through world.js (in view under fair play; everything the server tracks with fair play off). Blocks come
// through world.js's provider. A swing "lands" when the mob flinches, which a player sees too.
import pf from 'mineflayer-pathfinder';
import { worldQueries } from '../library/world_queries.js';
import { editionOf } from '../edition/index.js';
import { bestWeapon } from './decide.js';
import { isRanged } from './mob_decide.js';
import { safeCell } from './moves.js';
import { EATING } from './item_use.js';
import { shieldTuning } from './shield.js';
import { looksOf } from '../fairplay/look_around.js';

const BEAT_MS = 50;                 // a game tick: how often the fight looks again
const TICK_MS = 50;                 // the margin a swing waits beyond the recharge, for the server's clock
const STEP_BACK_OTHERS = 4;         // another mob this close (feet to feet) makes the bot step back between swings
const STEP_BACK_TARGET = 0.5;       // or the target this close (eye to body)
const RUSH_WITHIN = 16;             // farthest it sprints straight at a mob
const LEASH = 12;                   // farthest from where the fight began that it follows a mob
const ARCHER_LEASH = 24;            // and an archer, which backs away as it shoots and shoots wherever the bot stops
const NOT_CLOSER_MS = 6000;         // out of reach and no closer for this long: let go
const NOT_LANDING_SWINGS = 4;       // swings in reach with no flinch...
const NOT_LANDING_MS = 4000;        // ...and none seen for this long: let go
const LANDED_WITHIN_MS = 500;       // a flinch this soon after a swing is that swing landing

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const floorOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

/**
 * How far a hit from `eye` has to reach to touch a mob: to the nearest point of its body, a box its width
 * across and its height tall. That is how the game measures a player's reach to a mob.
 */
export function reachTo(eye, entity) {
    const half = (entity.width ?? 0.6) / 2, height = entity.height ?? 1.8, p = entity.position;
    const dx = Math.max(p.x - half - eye.x, 0, eye.x - (p.x + half));
    const dy = Math.max(p.y - eye.y, 0, eye.y - (p.y + height));
    const dz = Math.max(p.z - half - eye.z, 0, eye.z - (p.z + half));
    return Math.hypot(dx, dy, dz);
}

/**
 * Which mob to fight now. The one it was fighting while it is in reach; otherwise the nearest one in reach;
 * otherwise the one it was fighting, if still there; otherwise the nearest mob it may fight.
 * @param {object|null} current - the mob it was fighting, as seen now, or null when gone
 * @param {object[]} foes - every mob it may fight now, as seen now
 */
export function pickTarget(current, foes, eye, reach) {
    if (current && reachTo(eye, current) <= reach) return current;
    const byReach = foes.map(mob => ({ mob, reach: reachTo(eye, mob) })).sort((a, b) => a.reach - b.reach);
    const nearest = byReach[0];
    if (nearest && nearest.reach <= reach) return nearest.mob;
    return current ?? nearest?.mob ?? null;
}

/** Whether the weapon has recharged since the last swing (or the last change of what is in hand). */
export function charged({ now, lastSwingAt, rechargeMs }) {
    return now - lastSwingAt >= rechargeMs + TICK_MS;
}

/**
 * Whether to step back this beat: only while waiting on the weapon, only with a second mob close or the
 * target right on the bot, and only if the ground behind is safe.
 */
export function shouldStepBack({ charged: ready, targetReach, othersWithin, behindSafe }) {
    if (ready || !behindSafe) return false;
    return othersWithin > 0 || targetReach < STEP_BACK_TARGET;
}

/**
 * Whether the bot can sprint straight at a point on its own level: within 16 blocks, and every cell between
 * known, open, safe and with solid ground right under it (no drop to fall down mid-sprint).
 * @param {(pos: object) => object|null} blockAt - read the fair way
 */
export function openWayTo(blockAt, feet, to) {
    if (Math.abs(to.y - feet.y) >= 1) return false;
    const distance = flat(feet, to);
    if (distance > RUSH_WITHIN) return false;
    const dx = (to.x - feet.x) / distance, dz = (to.z - feet.z) / distance;
    for (let k = 1; k < distance - 0.5; k++) {
        const cell = floorOf({ x: feet.x + dx * k, y: feet.y, z: feet.z + dz * k });
        if (!safeCell(blockAt, cell)) return false;
        const ground = blockAt({ ...cell, y: cell.y - 1 });
        if (!ground || ground.boundingBox !== 'block') return false;
    }
    return true;
}

/**
 * Whether the bot may go after a mob here: the leash holds the bot within 12 blocks of where the fight began,
 * so a mob counts as within it when the bot could hit it from inside (a reach short of it). An archer gets 24:
 * a skeleton backs away as it shoots, and stopping at 12 only stands the bot where it is shot, until the fight
 * gives up on it (a live scene in the open did that once a skeleton there had its bow).
 * @param {object} [mob] - the mob, for its kind
 */
export function withinLeash(target, home, reach, mob = null) {
    return flat(target, home) - reach <= (mob && isRanged({ name: mob.name }) ? ARCHER_LEASH : LEASH);
}

/**
 * Why to let go of a fight now, or null to go on.
 * @param {object} state - {now, closestAt (when it last got closer), inReach, swingsSinceLanded, lastLandedAt}
 */
export function fightLetGo({ now, closestAt, inReach, swingsSinceLanded, lastLandedAt }) {
    if (!inReach && now - closestAt > NOT_CLOSER_MS) return 'not getting closer';
    if (inReach && swingsSinceLanded >= NOT_LANDING_SWINGS && now - lastLandedAt > NOT_LANDING_MS) return 'not landing';
    return null;
}

function fightMovements(bot) {
    const movements = new pf.Movements(bot);
    movements.canDig = false;           // a fight is no time to tunnel, and a mob behind stone isn't one to fight
    movements.allow1by1towers = false;
    movements.scafoldingBlocks = [];
    movements.allowSprinting = true;
    movements.maxDropDown = 2;
    return movements;
}

/**
 * Fights hand to hand until no mob it may fight is left near, until `stop()` says so, after `maxMs`, or
 * when the action is stopped.
 * @param {object} bot
 * @param {object} options
 * @param {number} options.first - the id of the mob to start on
 * @param {(id: number) => object|null} options.see - that mob as the bot sees it now, alive and in view, or null
 * @param {() => object[]} [options.foes] - every mob it may fight now, as seen now (the first one among them
 *     or not); with none given, only the first
 * @param {(entity: object) => void} [options.onTarget] - told each time it turns to a new mob
 * @param {() => boolean} [options.stop]
 * @param {number} [options.maxMs]
 * @param {object|null} [options.shield] - the bot's shield (shield.js), or none
 * @param {() => object|null} [options.shotComing] - the mob about to loose a shot at the bot, as seen now
 * @param {object|null} [options.use] - the use-item channel (item_use.js)
 * @param {() => number} [options.now]
 * @returns {Promise<{ended: string, target: number|null, swings: number, landed: number, blocks: number}>}
 *     target: the mob it was fighting when it ended; blocks: how often the shield went up
 */
export async function fightMelee(bot, { first, see, foes = () => [], onTarget = () => {}, stop = () => false, maxMs = 30000,
    shield = null, shotComing = () => null, use = null, now = Date.now }) {
    const edition = editionOf(bot.registry);
    const { entities: reach } = edition.survivalReach(); // to a mob, from the eye
    const blockAt = pos => worldQueries().believedAt(bot, pos);
    const startedAt = now();
    const home = bot.entity.position.clone();
    let target = see(first), ended = null;
    if (!target) return { ended: 'gone', target: first, swings: 0, landed: 0, blocks: 0 };

    let lastSwingAt = -Infinity, swings = 0, landed = 0, blocks = 0;
    let closest = Infinity, closestAt = startedAt, swingsSinceLanded = 0, lastLandedAt = startedAt;
    let equipping = false, moving = 'still', followed = null;
    const sinceSwing = [];
    const onHurt = entity => {
        const swing = sinceSwing.find(s => s.id === entity.id && !s.landed && now() - s.at <= LANDED_WITHIN_MS);
        if (!swing) return;
        swing.landed = true;
        landed++;
        swingsSinceLanded = 0;
        lastLandedAt = now();
    };
    bot.on('entityHurt', onHurt);

    // Movement is either the bot's own keys (a rush, a step back) or the pathfinder, never both at once.
    const keys = (forward, back, sprint, jump = false) => {
        bot.setControlState('forward', forward);
        bot.setControlState('back', back);
        bot.setControlState('sprint', sprint);
        bot.setControlState('jump', jump);
    };
    const halt = () => {
        if (moving === 'path') bot.pathfinder.setGoal(null);
        keys(false, false, false);
        moving = 'still';
        followed = null;
    };
    const holdWeapon = () => {
        const weapon = bestWeapon(bot.inventory.items().map(item => item.name), edition.meleeOf);
        if (!weapon || bot.heldItem?.name === weapon || equipping) return;
        const item = bot.inventory.items().find(i => i.name === weapon);
        if (!item) return;
        shield?.lower(); // on Java a change of the item in hand lowers it anyway
        equipping = true;
        bot.equip(item, 'hand')
            .catch(() => {})
            .finally(() => { equipping = false; lastSwingAt = now(); }); // a change of item empties the meter on Java
    };

    try {
        onTarget(target);
        while (!ended) {
            if (bot.interrupt_code || stop()) { ended = 'stopped'; break; }
            if (now() - startedAt > maxMs) { ended = 'out of time'; break; }
            // A glance has the head (glance.js): a hit from a side the target isn't on turns it, for a moment, to
            // see what dealt it. The fight stands meanwhile, neither turning back nor swinging, and the moment
            // doesn't count against it as not getting closer. What the glance shows, the mob reflex weighs.
            if ((looksOf(bot)?.holdUntil ?? 0) > Date.now()) {
                halt();
                closestAt = now();
                await wait(BEAT_MS);
                continue;
            }
            const eating = use?.owner() === EATING;
            if (!eating) holdWeapon();

            const position = bot.entity.position;
            const eye = { x: position.x, y: position.y + (bot.entity.eyeHeight ?? 1.62), z: position.z };
            const others = foes();
            const next = pickTarget(target ? see(target.id) : null, others, eye, reach);
            if (!next) { ended = 'gone'; break; }
            if (next.id !== target?.id) {
                target = next;
                onTarget(target);
                closest = Infinity; closestAt = now(); swingsSinceLanded = 0; lastLandedAt = now();
            } else {
                target = next;
            }

            const toTarget = reachTo(eye, target);
            const inReach = toTarget <= reach;
            // Getting nearer is progress, and so is having it in reach: a mob hit is knocked back, and catching up
            // to hit it again brings the bot no nearer than the first time. Out of reach again, it counts from there.
            if (inReach || toTarget < closest - 0.5) { closest = toTarget; closestAt = now(); }
            const letGo = fightLetGo({ now: now(), closestAt, inReach, swingsSinceLanded, lastLandedAt });
            if (letGo) { ended = letGo; break; }

            // An arrow coming while the target is out of reach: stand, face the archer, shield up, and go on
            // once it has landed (shotComing says when). Time behind the shield doesn't count as not getting closer.
            const shooter = shield?.has() && !inReach && !eating ? shotComing() : null;
            if (shooter) {
                halt();
                await bot.lookAt(shooter.position.offset(0, (shooter.height ?? 1.8) * 0.8, 0), true);
                const wasUp = shield.up;
                if (shield.raise()) {
                    if (!wasUp) blocks++;
                    closestAt = now();
                    await wait(BEAT_MS);
                    continue;
                }
            }

            const aimAt = target.position.offset(0, (target.height ?? 1.8) * 0.6, 0);
            await bot.lookAt(aimAt, true);
            const ready = !equipping && charged({ now: now(), lastSwingAt, rechargeMs: edition.meleeOf(bot.heldItem?.name).rechargeMs });

            if (!inReach) shield?.lower(); // to walk, or to stand facing a mob past the leash
            if (inReach) {
                if (ready && !eating) {
                    // Swing first, then stop: a hit landed while sprinting knocks the mob back farther. Never
                    // with the shield up: a player lets go of it to swing.
                    shield?.lower();
                    bot.attack(target);
                    lastSwingAt = now();
                    swings++;
                    swingsSinceLanded++;
                    sinceSwing.push({ id: target.id, at: now(), landed: false });
                    if (sinceSwing.length > 8) sinceSwing.shift();
                    halt();
                } else {
                    // Waiting on the weapon. Back off a little if that keeps the mobs from all reaching it at once.
                    const othersWithin = others.filter(mob => mob.id !== target.id && flat(mob.position, position) <= STEP_BACK_OTHERS).length;
                    const away = { x: position.x - target.position.x, z: position.z - target.position.z };
                    const length = Math.hypot(away.x, away.z) || 1;
                    const behind = floorOf({ x: position.x + away.x / length, y: position.y, z: position.z + away.z / length });
                    if (shouldStepBack({ charged: ready, targetReach: toTarget, othersWithin, behindSafe: safeCell(blockAt, behind) })) {
                        shield?.lower();
                        if (moving === 'path') bot.pathfinder.setGoal(null);
                        keys(false, true, false);
                        moving = 'back';
                    } else {
                        if (moving !== 'still') halt();
                        // Standing, waiting on the weapon: the shield up meanwhile, if the arena says it pays.
                        if (shieldTuning.betweenSwings && shield && !eating && !shield.up && shield.raise()) blocks++;
                    }
                }
            } else if (!withinLeash(target.position, home, reach, target)) {
                // It has gone past the leash: face it, but don't follow. It comes back, or the fight lets go.
                if (moving !== 'still') halt();
            } else if (openWayTo(blockAt, position, target.position)) {
                if (moving === 'path') bot.pathfinder.setGoal(null);
                keys(true, false, true, Boolean(bot.entity.isCollidedHorizontally));
                moving = 'rush';
            } else if (moving !== 'path' || followed !== target.id) {
                keys(false, false, false);
                bot.pathfinder.setMovements(fightMovements(bot));
                bot.pathfinder.setGoal(new pf.goals.GoalFollow(target, 1.5), true);
                moving = 'path';
                followed = target.id;
            }
            await wait(BEAT_MS);
        }
    } finally {
        bot.off('entityHurt', onHurt);
        shield?.lower();
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
    }
    return { ended, target: target?.id ?? null, swings, landed, blocks };
}
