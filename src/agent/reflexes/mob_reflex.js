// SPDX-License-Identifier: CC0-1.0
// The mob reflex, `mob_safety`: run at low health, take cover from a mob aiming at the bot, back away
// when outnumbered or from a mob the bot shouldn't fight, and get away from hits it can't see the cause of.
//
// It is a mode like Mindcraft's own, registered right after the creeper reflex (install.js), so it comes
// before every reflex an action can pause. Nothing pauses it by name: walking to a player, a fight, or
// `!stay` can't switch it off. It answers only to its own switch (`!setMode("mob_safety", false)`), not to
// `cowardice`, which keeps its stock body and stays off in the default profiles.
//
// Each round it reads the hostile mobs around (mobs.js) and the hits felt lately (the edition seam's
// `onHurt`: which way a hit came from, as a player's screen tilts toward it), asks decideMobThreat
// (mob_decide.js) what to do, and acts:
//   1. Set the hold (src/agent/action_hold.js) before starting anything, so neither a lower reflex nor a
//      command from the model stops the move part way.
//   2. Claim the mobs it is about (claims.js), so the fight doesn't take them straight back.
//   3. Start the move as an action of this mode: retreat from all of them at once, or take cover (moves.js).
//      With no cover near, it backs out of the archer's range, and with a shield it stops behind it while
//      the archer draws (shield.js), as the fight does.
//   4. Lift the hold a moment after the move ends, so whatever comes next doesn't walk straight back.
//   5. Tell the model once, in one fair line, if the move interrupted what it was doing. The same threat
//      coming back (a crowd that keeps following, a skeleton that keeps finding the bot) is still one
//      message a minute, so a night full of mobs doesn't flood the model.
import convoManager from '../conversation.js';
import { holdActions } from '../action_hold.js';
import { log } from '../library/skills.js';
import { editionOf } from '../edition/index.js';
import { describeDirection } from '../fairplay/perception.js';
import { decideMobThreat, explainsHit, isMelee, ordersAfterGivingUp } from './mob_decide.js';
import { backAwayFacing, retreatFrom, takeCover } from './moves.js';
import { mobsAround, mobInView, ordersFor, say, selfOf } from './mobs.js';
import { CLAIM_MS } from './claims.js';
import { shotComing, shotWindow } from './shield.js';

export const MODE_NAME = 'mob_safety';
const MOVES = new Set(['flee', 'retreat', 'take_cover']);
const HOLD_AFTER_MS = 1500;   // after a move, how long other starts still wait
const TELL_AGAIN_MS = 60000;  // the same threat is told about once a minute at most
const HITS_KEPT_MS = 10000;
const LOST_SIGHT_MS = 2000;   // all of them out of view this long while retreating: they lost the bot too
export const FOLLOW_PER_S = 2.5; // a mob out of view that chases is taken to keep coming at about this, in blocks a second
                                 // (a zombie after a player, measured live on Bedrock: 2.3; a little over, to be sure)

/**
 * @param {object} options
 * @param {object} options.claims - shared with the fight (claims.js)
 * @param {object} [options.orders] - the standing orders (orders.js); none means the bot's own judgment
 * @param {(id: number) => boolean} [options.gaveUp] - whether the fight gave up on a mob lately: an order to
 *     fight it then no longer holds here (ordersAfterGivingUp)
 * @param {object} [options.shield] - the bot's shield (shield.js); none: no shield
 * @param {object} [options.beat] - the beat of shots heard (shot_beat.js), for a game that shows no bow drawn
 * @param {() => number} [options.now]
 * @returns {{mode: object, round: Function, watch: Function, hits: object[]}}
 */
export function createMobReflex({ claims, orders = null, gaveUp = () => false, shield = null, beat = null, now = Date.now }) {
    const hits = [];          // {at, direction}: hits felt lately, oldest first
    const told = new Map();   // threat key -> when the model was last told about it
    const dying = new Set();  // mobs seen dying

    const mode = {
        name: MODE_NAME,
        description: 'Run at low health, take cover from a mob aiming at you, and back away when outnumbered or from a mob too strong to fight. Interrupts all actions; no action pauses it.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: agent => round(agent),
    };

    function round(agent) {
        const bot = agent.bot;
        if (!mode.on || mode.active || !bot?.entity) return;
        while (hits.length && now() - hits[0].at > HITS_KEPT_MS) hits.shift();
        const self = selfOf(bot);
        const decision = decideMobThreat(mobsAround(bot, dying), self, { hits, now: now(), ownerOf: claims.ownerOf, orderOf: ordersAfterGivingUp(ordersFor(orders, self), gaveUp), gaveUp });
        // Not awaited: the move runs as an action, and the round must not hold up the mode loop.
        if (MOVES.has(decision.stance)) act(agent, decision, self).catch(error => console.warn(`[${MODE_NAME}] ${error.stack ?? error}`));
    }

    async function act(agent, decision, self) {
        const bot = agent.bot;
        mode.active = true;
        // The hold lets through this mode and the ones before it in the list (self_preservation, creepers).
        const names = Object.keys(bot.modes.getJson());
        const lets = new Set(names.slice(0, names.indexOf(MODE_NAME) + 1).map(name => `mode:${name}`));
        const hold = holdActions(agent, { lets: label => lets.has(label), reason: `the bot is getting away from ${whatOf(decision)}` });
        for (const id of decision.ids ?? []) claims.claim(`id:${id}`, MODE_NAME, CLAIM_MS);
        const interrupted = agent.actions.currentActionLabel;
        const line = sayLine(decision, describeDirection(self.position, decision.from[0]).text);
        say(agent, line);
        const report = event => bot.emit?.('threat_reflex', { ...event, stance: decision.stance, key: decision.key, reason: decision.reason, mode: MODE_NAME });
        // Where the mobs were, as seen: the danger watch keeps a zone where an archer stood (danger_watch.js).
        report({ event: 'decided', at: performance.now(), from: decision.from.map(({ x, y, z }) => ({ x, y, z })) });

        // Where the mobs are now, as the bot knows them: in view, or where last seen. The sides hits came
        // from stay put. Fleeing at low health keeps away from newcomers too.
        const ids = decision.ids ?? [];
        const sides = decision.from.slice(ids.length);
        // A mob that chases (a zombie, a spider) and is out of view is taken to keep coming: a player running
        // from zombies knows they follow, and through a player's screen the bot runs with its back to them.
        // Gone by where it was last seen, the retreat ended 'far enough' with the zombies still coming, a few
        // blocks behind. For as long as the move lasts: one zombie followed for all of a 5 s retreat. One that
        // gave up only makes the bot run a little farther, and the look back as it stops shows which.
        let known = decision.from.slice(0, ids.length);
        const lastAt = [...known], seenAt = ids.map(() => now()), chases = ids.map(() => false);
        const from = () => {
            const around = mobsAround(bot, dying);
            const here = bot.entity.position;
            known = ids.map((id, i) => {
                const mob = around.find(m => m.id === id);
                if (mob) { lastAt[i] = mob.position; chases[i] = isMelee(mob); } // a stand-in stands where last seen
                if (mob?.seenNow) seenAt[i] = now();
                return chases[i] && !mob?.seenNow ? followedTo(lastAt[i], here, now() - seenAt[i]) : lastAt[i];
            });
            const points = [...known, ...sides];
            if (decision.stance === 'flee') for (const mob of around) if (!ids.includes(mob.id)) points.push(mob.position);
            return points;
        };
        const lostSight = () => {
            if (!ids.length) return false;
            const around = mobsAround(bot, dying);
            return ids.every(id => { const mob = around.find(m => m.id === id); return !mob || !mob.seenNow; })
                && now() - lastSeen >= LOST_SIGHT_MS;
        };
        let lastSeen = now();
        const seeing = setInterval(() => { if (ids.some(id => mobInView(bot, id))) lastSeen = now(); }, 250);

        let result, ended = null;
        try {
            result = await agent.actions.runAction(`mode:${MODE_NAME}`, async () => {
                if (decision.stance === 'take_cover') {
                    await shield?.ready(); // a carried shield in the off-hand, for a back-out with no cover near
                    const id = ids[0];
                    const eye = () => {
                        const mob = mobInView(bot, id);
                        return mob ? { x: mob.position.x, y: mob.position.y + (mob.height ?? 1.8) * 0.9, z: mob.position.z } : null;
                    };
                    let outcome = await takeCover(bot, { eye, report, done: () => !aimingNow(bot, id) && lostSight() });
                    report({ event: 'cover', at: performance.now(), ended: outcome.ended });
                    if (outcome.ended === 'no cover' || outcome.ended === 'no way there') {
                        // With a shield, the bot backs out facing the archer, as a player does. A shield covers only
                        // the side the bot faces: running faces away, so each shot meant a turn to raise it, too late
                        // as often as not, and through a player's screen the bot couldn't even see the archer draw
                        // or tell its next shot was due. Facing it, it sees the archer, so losing sight means
                        // something, whichever way the bot sees.
                        const archer = () => {
                            const mob = mobInView(bot, id) ?? mobsAround(bot, dying).find(m => m.id === id);
                            const at = mob?.position ?? known[0];
                            return at ? { x: at.x, y: at.y + (mob?.height ?? 1.8) * 0.8, z: at.z } : null;
                        };
                        outcome = shield?.has()
                            ? await backAwayFacing(bot, { from, face: archer, to: decision.distance, report, done: lostSight, guard: archerGuard(bot) })
                            : await retreatFrom(bot, { from, to: decision.distance, report, done: () => !narrowView(agent) && lostSight(), guard: archerGuard(bot) });
                    }
                    ended = outcome.ended;
                    log(bot, `Took cover from the ${decision.name} (${ended}).`);
                    return;
                }
                // Out of the bot's view means out of the mobs' only when the bot sees all around: through a
                // player's screen it backs away facing the way out, so it goes by distance, and looks back when
                // it stops (the glance). The same for backing out of an archer's range with no cover, above.
                const outcome = await retreatFrom(bot, { from, to: decision.distance, report, maxMs: decision.stance === 'flee' ? 10000 : 8000,
                    done: () => !narrowView(agent) && lostSight() });
                ended = outcome.ended;
                log(bot, `${decision.stance === 'flee' ? 'Ran' : 'Backed away'} from ${whatOf(decision)} (${ended}).`);
            }, { timeout: 1 });
        } finally {
            clearInterval(seeing);
            mode.active = false;
            for (const id of ids) claims.claim(`id:${id}`, MODE_NAME, CLAIM_MS);
            hold.release(HOLD_AFTER_MS);
        }
        report({ event: 'done', at: performance.now(), ended, interrupted: Boolean(result?.interrupted) });
        tellModel(agent, decision, interrupted, result, line);
    }

    // Whether the bot sees through a player's screen (fair play's narrow view), not all around.
    const narrowView = agent => Boolean(agent.fairPlay?.looks?.getScreen?.());

    // Backing out of range with no cover near: the shield up toward an archer while it draws, and until its
    // arrow lands, when every archer aiming is on one side (shield.js).
    function archerGuard(bot) {
        if (!shield) return null;
        const window = shotWindow(now);
        return {
            shield,
            against: () => {
                const id = window(shotComing(mobsAround(bot, dying, beat), bot.entity.position));
                const mob = id === null ? null : mobInView(bot, id);
                return mob ? { x: mob.position.x, y: mob.position.y + (mob.height ?? 1.8) * 0.8, z: mob.position.z } : null;
            },
        };
    }

    function aimingNow(bot, id) {
        const mob = mobInView(bot, id);
        const here = bot.entity.position;
        return Boolean(mob) && editionOf(bot.registry).isAiming(bot.registry, mob, { x: here.x, y: here.y + 1.62, z: here.z });
    }

    function tellModel(agent, decision, interrupted, result, line) {
        const already = now() - (told.get(decision.key) ?? -Infinity) < TELL_AGAIN_MS;
        if (!interrupted || agent.actions.resume_func || agent.self_prompter?.isActive?.() || result?.interrupted || already) {
            agent.bot.modes.flushBehaviorLog?.();
            return;
        }
        told.set(decision.key, now());
        const role = convoManager.inConversation() ? agent.last_sender : 'system';
        const logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted}' was interrupted by ${MODE_NAME}: ${line}`
            + `\nYour behavior log: ${logs}\nRespond accordingly.`);
    }

    /** Listens for hits on the bot and mobs dying, on the bot it acts for. */
    function watch(bot) {
        editionOf(bot.registry).onHurt(bot, ({ direction }) => {
            // Whether something in view could have dealt it, as it lands, on the side it came from: a player knows
            // who hit them when a zombie is right there, and remembers it after the zombie falls. One hit from
            // behind while fighting a zombie in front is not that zombie's, and the bot looks round (the glance).
            const here = bot.entity?.position;
            const explained = Boolean(here) && mobsAround(bot, dying).some(mob => mob.seenNow && explainsHit(mob, direction, here));
            hits.push({ at: now(), direction, explained });
            bot.emit?.('threat_reflex', { event: 'felt', at: performance.now(), direction, unseen: !explained, mode: MODE_NAME });
        });
        bot.on?.('entityDead', entity => dying.add(entity.id));
        bot.on?.('entityGone', entity => dying.delete(entity.id));
    }

    return { mode, round, watch, hits, clear: () => { hits.length = 0; told.clear(); dying.clear(); } };
}

/**
 * Where a mob out of view that chases the bot is taken to be: come on from where it was last seen, toward the
 * bot, at FOLLOW_PER_S for the time since, and never nearer than a block. Pure.
 * @param {{x:number, y:number, z:number}} lastSeen
 * @param {{x:number, y:number, z:number}} here - where the bot is
 * @param {number} ms - since it was last seen
 */
export function followedTo(lastSeen, here, ms, perSecond = FOLLOW_PER_S) {
    const dx = here.x - lastSeen.x, dz = here.z - lastSeen.z, apart = Math.hypot(dx, dz);
    const step = Math.min(perSecond * Math.max(0, ms) / 1000, apart - 1);
    if (step <= 0) return { x: lastSeen.x, y: lastSeen.y, z: lastSeen.z };
    return { x: lastSeen.x + dx / apart * step, y: lastSeen.y, z: lastSeen.z + dz / apart * step };
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five'];
const spoken = name => name.replace(/_/g, ' ');

// What the move is about, the way a player would say it.
function whatOf(decision) {
    if (decision.reason === 'low health') return 'the mobs around';
    if (decision.reason === 'unseen hits') return 'whatever is hitting it';
    if (decision.reason === 'outnumbered' || (decision.reason === 'ordered' && decision.names.length > 1)) {
        const kinds = new Set(decision.names);
        const count = NUMBERS[decision.names.length] ?? 'several';
        return kinds.size === 1 ? `${count} ${spoken(decision.names[0])}s` : `${count} mobs`;
    }
    return `the ${spoken(decision.name)}`;
}

// One fair line about what happened: where the threat was as a direction and rough distance.
function sayLine(decision, where) {
    switch (decision.reason) {
        case 'low health': return `I'm badly hurt with mobs about (${where}); running.`;
        case 'aiming': return `A ${spoken(decision.name)} is aiming at me (${where}); taking cover.`;
        case 'outnumbered': return `${whatOf(decision).replace(/^./, c => c.toUpperCase())} are coming at me (${where}); backing away from them.`;
        case 'unseen hits': return `Something I can't see keeps hitting me (${where}); getting away.`;
        case 'too strong': return `A ${spoken(decision.name)} is coming at me (${where}); backing away, it's too strong to fight.`;
        case 'hurt': return `A ${spoken(decision.name)} is coming at me (${where}); backing away, I'm too hurt to fight.`;
        case 'hungry': return `A ${spoken(decision.name)} is coming at me (${where}); backing away, I'm too hungry to fight.`;
        case 'ordered': return `${whatOf(decision).replace(/^./, c => c.toUpperCase())} ${decision.names.length > 1 ? 'are' : 'is'} coming at me (${where}); backing away, as I was told to.`;
        default: return `Getting away from ${whatOf(decision)} (${where}).`;
    }
}
