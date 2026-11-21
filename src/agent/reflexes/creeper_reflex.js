// SPDX-License-Identifier: CC0-1.0
// The creeper reflex, `creeper_safety`: back off from a creeper about to explode, and finish with one
// that keeps following.
//
// It is a mode like Mindcraft's own, registered right after `self_preservation` (install.js), so it comes
// before every reflex an action can pause. Nothing pauses it by name: walking to a player, a fight, or
// `!stay` can't switch it off. It answers only to its own switch (`!setMode("creeper_safety", false)`),
// not to `cowardice`: stepping out of a blast is self-preservation, like stepping out of lava.
//
// Each round it tells the threat picture (picture.js) which creepers are in view and whether each is lit
// (asked of the edition seam: a player sees a creeper swell and flash), asks decideThreat (decide.js)
// what to do, and acts. Under fair play a sound handler also tells the picture about a hiss or an
// explosion, and runs a round at once instead of waiting for the next one (install.js), because the
// round can be 300 ms away and the fuse is 1.5 s.
//
// Acting, in this order:
//   1. Set the hold (src/agent/action_hold.js) **before** starting anything. A round of the other reflexes
//      may already be part way through, and without the hold one of them could start its own action and
//      stop the back-off. The model's commands wait for it, too.
//   2. Start the move as an action of this mode: back off, hit and step back, or leave (moves.js).
//   3. Lift the hold a moment after the move ends, so whatever comes next doesn't walk straight back.
//   4. Tell the model once, in one fair line, if the move interrupted what it was doing. A creeper that
//      keeps following brings the bot back here several times, and that is still one message.
//
// It sees through world.js like every other reflex: what is in view under fair play, everything without
// it. A creeper that just slipped out of view is handed out as a stand-in where it was last seen; its fuse
// isn't read from that (it would read the live creeper behind the wall), the picture estimates it instead.
import convoManager from '../conversation.js';
import settings from '../settings.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { withinAttackReach } from '../library/attack_reach.js';
import { holdActions, holdKind } from '../action_hold.js';
import { log } from '../library/skills.js';
import { editionOf } from '../edition/index.js';
import { describeDirection } from '../fairplay/perception.js';
import { fairPlayOf } from '../fairplay/fair_queries.js';
import { createThreatPicture } from './picture.js';
import { bestWeapon, blockTheBlast, decideThreat, hitsNeeded } from './decide.js';
import { backOffFrom, hitAndStepBack } from './moves.js';

export const MODE_NAME = 'creeper_safety';
const FOLLOW_SPEED = 3;       // blocks a second: about as fast as a creeper walks after its target

/**
 * Where a creeper that is following the bot has likely got to, out of view for `ms`: from where it was last
 * known, that much nearer the bot at a creeper's walking pace, never closer than a block. Leaving through a
 * player's screen the bot runs facing away; a player knows the creeper behind is still coming, and a leave
 * measured from where it was last seen ended inside its reach, every time.
 * @returns {{x: number, y: number, z: number}}
 */
export function comingOn(position, toward, ms) {
    const dx = toward.x - position.x, dz = toward.z - position.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(Math.max(0, d - 1), FOLLOW_SPEED * ms / 1000);
    if (d === 0 || step === 0) return { ...position };
    return { x: position.x + dx / d * step, y: position.y, z: position.z + dz / d * step };
}
const MOVES = new Set(['back_off', 'hit_and_step_back', 'leave']);
const HOLD_AFTER_MS = 1500;   // after a move, how long other starts still wait
const ROOF_CHECK = 8;         // blocks above the head that make the bot "underground" for the decision
const HIT_REACH = 3;          // a survival player's reach to a mob
const LOOK_WITHIN = 32;       // creepers are followed this far, so leaving one knows when it is far enough
const LOST_SIGHT_MS = 2000;   // out of view this long while leaving: it has lost the bot
const STUCK_MS = 500;         // backing off, but this long without getting anywhere: stuck
const STUCK_MOVE = 0.4;       // blocks: less than this in STUCK_MS
// While a creeper that isn't lit is this close, the reflexes that run errands for an idle bot (picking up
// items, hunting, placing torches, making room) start nothing, and one already walking is stopped: their
// walks don't look where they go, and one walked the bot up to a creeper for an item beside it.
const KEEP_OUT = 8;
const KEEP_OUT_MS = 1000;     // renewed each round while the creeper stays close
const ERRANDS = new Set(['hunting', 'item_collecting', 'torch_placing', 'elbow_room'].map(name => `mode:${name}`));

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {object} [options.orders] - the standing orders (orders.js); none means the bot's own judgment
 * @param {object} [options.shield] - the bot's shield (shield.js); none: no shield
 * @returns {{mode: object, hear: Function, picture: object}}
 */
export function createCreeperReflex({ now = Date.now, orders = null, shield = null } = {}) {
    const picture = createThreatPicture({ now });
    // Mobs seen dying: a killed creeper lies there for a moment, still swollen, but it can't explode.
    const dying = new Set();

    const mode = {
        name: MODE_NAME,
        description: 'Back off from a creeper about to explode, and finish with one that keeps following. Interrupts all actions; no action pauses it.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: agent => round(agent),
    };

    // What the decision needs to know about the bot.
    function selfOf(bot) {
        const position = bot.entity.position;
        let underground = false;
        for (let dy = 2; dy <= ROOF_CHECK + 1 && !underground; dy++) {
            const block = worldQueries().blockAt(bot, position.offset(0, dy, 0));
            underground = Boolean(block) && block.boundingBox !== 'empty';
        }
        const carried = bot.inventory?.items?.().map(item => item.name) ?? [];
        const meleeOf = editionOf(bot.registry).meleeOf;
        return {
            position: { x: position.x, y: position.y, z: position.z },
            health: bot.health ?? 20,
            gameMode: bot.game?.gameMode,
            edition: editionOf(bot.registry).name,
            underground,
            hitsNeeded: hitsNeeded(carried, meleeOf),
            armed: bestWeapon(carried, meleeOf) !== null,
        };
    }

    // Tells the picture which creepers are in view right now, and whether each one's fuse is lit.
    function look(bot) {
        const edition = editionOf(bot.registry);
        const inView = world.getNearbyEntities(bot, LOOK_WITHIN)
            .filter(entity => entity.name === 'creeper' && entity.lastSeenAt === undefined && !dying.has(entity.id)) // not a stand-in
            .map(entity => ({ id: entity.id, position: entity.position, lit: edition.isFusing(bot.registry, entity) }));
        const self = selfOf(bot);
        // Whether the bot can see where a creeper stood, by the middle of its body, within the distance it
        // follows creepers at: one lit there that isn't there any more went off. Fair play's eyes only;
        // without them, the picture never guesses.
        const perception = fairPlayOf(bot)?.perception;
        const spotInView = perception?.seesCell ? spot => Math.hypot(spot.x - self.position.x, spot.y - self.position.y, spot.z - self.position.z) <= LOOK_WITHIN
            && perception.seesCell({ x: spot.x, y: spot.y + 0.85, z: spot.z }) : undefined;
        picture.see(inView, self, { spotInView });
        return self;
    }

    // The creeper itself, if it is in view now, for hitting it.
    function creeperInView(bot, id) {
        if (id === null || id === undefined) return null;
        return world.getNearbyEntities(bot, LOOK_WITHIN).find(entity => entity.id === id && entity.lastSeenAt === undefined) ?? null;
    }

    function round(agent) {
        const bot = agent.bot;
        if (!mode.on || mode.active || !bot?.entity) return;
        const self = look(bot);
        const order = orders?.orderFor('creeper', self) ?? null;
        const decision = decideThreat(picture.creepers(self), self, { explosion: picture.explosion(self), order });
        // Not awaited: the move runs as an action, and the round must not hold up the mode loop.
        if (MOVES.has(decision.stance)) act(agent, decision, self).catch(error => console.warn(`[${MODE_NAME}] ${error.stack ?? error}`));
        else keepOut(agent, self);
    }

    // No errands near a creeper. A short hold of its own kind, renewed while the creeper stays close; it
    // lets through commands and every reflex that isn't an errand, and never replaces another reflex's hold.
    function keepOut(agent, self) {
        const near = picture.creepers(self).some(c => c.seenNow && !c.lit && c.distance <= KEEP_OUT);
        if (!near) return;
        const kind = holdKind(agent);
        if (kind && kind !== 'creeper nearby') return;
        holdActions(agent, { kind: 'creeper nearby', lets: label => !ERRANDS.has(label), reason: 'a creeper is close by', maxMs: KEEP_OUT_MS });
        if (ERRANDS.has(agent.actions.currentActionLabel)) agent.actions.stop().catch(() => {});
    }

    /** A sound hearing passed on. A hiss or an explosion runs a round at once. */
    function hear(agent, sound) {
        const bot = agent.bot;
        if (!bot?.entity || !(sound.subject === 'explosion' || /^creeper \(hissing\)$/.test(sound.subject))) return;
        picture.hear(sound, selfOf(bot));
        bot.emit?.('threat_reflex', { event: 'heard', at: performance.now(), subject: sound.subject, mode: MODE_NAME });
        if (mode.on && !mode.active && !mode.paused) round(agent);
    }

    async function act(agent, decision, self) {
        const bot = agent.bot;
        mode.active = true; // first, so neither the mode loop nor a sound starts a second move
        // The hold lets through this mode and the ones before it in the list (self_preservation).
        const names = Object.keys(bot.modes.getJson());
        const lets = new Set(names.slice(0, names.indexOf(MODE_NAME) + 1).map(name => `mode:${name}`));
        const hold = holdActions(agent, { lets: label => lets.has(label), reason: 'the bot is getting away from a creeper' });
        const interrupted = agent.actions.currentActionLabel;
        const where = describeDirection(self.position, decision.from).text;
        const line = sayLine(decision, where);
        say(agent, line);
        const report = event => bot.emit?.('threat_reflex', { ...event, stance: decision.stance, key: decision.key, mode: MODE_NAME });
        report({ event: 'decided', at: performance.now() });

        // Where the creeper is now, as the bot knows it, while it moves.
        let last = decision.from;
        const leavingBlind = decision.stance === 'leave' && narrowView(agent);
        const from = () => {
            look(bot);
            const key = picture.resolve(decision.key);
            const track = picture.creepers(selfOf(bot)).find(c => c.key === key);
            if (track) last = leavingBlind && !track.seenNow && track.unseenMs ? comingOn(track.position, bot.entity.position, track.unseenMs) : track.position;
            return last;
        };
        let result, ended = null;
        try {
            result = await agent.actions.runAction(`mode:${MODE_NAME}`, async () => {
                if (decision.stance === 'hit_and_step_back') {
                    const id = picture.creepers(selfOf(bot)).find(c => c.key === picture.resolve(decision.key))?.id;
                    const outcome = await hitAndStepBack(bot, {
                        creeper: () => creeperInView(bot, id),
                        inReach: entity => withinAttackReach(bot, entity) && bot.entity.position.distanceTo(entity.position) <= HIT_REACH,
                        to: decision.distance, report,
                    });
                    ended = outcome.hit ? 'hit and stepped back' : outcome.ended;
                    log(bot, outcome.hit ? 'Hit the creeper and stepped back.' : `Backed off from the creeper (${outcome.ended}).`);
                    return;
                }
                const leaving = decision.stance === 'leave';
                // A carried shield goes in the off-hand meanwhile, without waiting: the first step can't wait.
                shield?.ready().catch(() => {});
                const outcome = await backOffFrom(bot, {
                    from, to: decision.distance, report, maxMs: leaving ? 10000 : 3000,
                    // Leaving also ends when the creeper has lost sight of the bot for good. Out of the bot's view
                    // means out of the creeper's only when the bot sees all around: through a player's screen
                    // the bot runs facing away, so it leaves by distance, and looks back when it stops.
                    done: () => leaving && !narrowView(agent) && outOfSight(bot, decision.key),
                    guard: blastGuard(bot, decision.key),
                });
                ended = outcome.ended;
                log(bot, `${leaving ? 'Left the creeper behind' : 'Backed off from the creeper'} (${outcome.ended}).`);
            }, { timeout: 1 });
        } finally {
            mode.active = false;
            if (decision.key !== 'explosion') picture.noteBackOff(decision.key);
            hold.release(HOLD_AFTER_MS);
        }
        report({ event: 'done', at: performance.now(), ended, interrupted: Boolean(result?.interrupted) });
        tellModel(agent, decision, interrupted, result, line);
    }

    // Backing off from a lit creeper the bot can't get clear of in time (blockTheBlast): the shield up,
    // faced at it, until it has blown or gone out. Stuck is going nowhere for half a second, or standing
    // behind the shield already.
    function blastGuard(bot, key) {
        if (!shield) return null;
        const started = now();
        const trail = []; // {at, x, z}: where the bot was lately
        return {
            shield,
            against: () => {
                const here = bot.entity.position;
                trail.push({ at: now(), x: here.x, z: here.z });
                while (trail.length > 1 && now() - trail[1].at >= STUCK_MS) trail.shift();
                const barelyMoved = now() - started >= STUCK_MS && now() - trail[0].at >= STUCK_MS
                    && Math.hypot(here.x - trail[0].x, here.z - trail[0].z) < STUCK_MOVE;
                const track = picture.creepers(selfOf(bot)).find(c => c.key === picture.resolve(key));
                if (!blockTheBlast(track, { stuck: shield.up || barelyMoved })) return null;
                const creeper = creeperInView(bot, track.id);
                if (creeper) return { x: creeper.position.x, y: creeper.position.y + (creeper.height ?? 1.7) * 0.5, z: creeper.position.z };
                // Out of view (behind the bot, through a player's screen): where the bot knows it to be, seen
                // or heard. Turning the shield there turns the bot to face it, as a player would.
                return track.position ? { x: track.position.x, y: track.position.y + 0.85, z: track.position.z } : null;
            },
        };
    }

    // Whether the bot sees through a player's screen (fair play's look memory knows).
    const narrowView = agent => Boolean(agent.fairPlay?.looks?.getScreen?.());

    // Out of view for a while: the creeper no longer sees the bot either, and loses it.
    function outOfSight(bot, key) {
        const track = picture.creepers(selfOf(bot)).find(c => c.key === picture.resolve(key));
        return !track || (track.source === 'seen' && !track.seenNow && track.unseenMs >= LOST_SIGHT_MS);
    }

    function tellModel(agent, decision, interrupted, result, line) {
        const track = picture.creepers(selfOf(agent.bot)).find(c => c.key === picture.resolve(decision.key));
        const already = track?.told;
        if (!interrupted || agent.actions.resume_func || agent.self_prompter?.isActive?.() || result?.interrupted || already) {
            agent.bot.modes.flushBehaviorLog?.();
            return;
        }
        picture.noteTold(decision.key);
        const role = convoManager.inConversation() ? agent.last_sender : 'system';
        const logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted}' was interrupted by ${MODE_NAME}: ${line}`
            + `\nYour behavior log: ${logs}\nRespond accordingly.`);
    }

    /** Listens for mobs dying and going, on the bot it acts for. */
    function watch(bot) {
        bot.on?.('entityDead', entity => dying.add(entity.id));
        bot.on?.('entityGone', entity => dying.delete(entity.id));
    }

    return { mode, hear, picture, round, watch };
}

// One fair line about what happened: where the creeper was as a direction and rough distance, the way a
// player would put it.
function sayLine(decision, where) {
    if (decision.reason === 'explosion') return `Something exploded (${where}); backing off.`;
    const what = decision.reason === 'hissed' ? 'A creeper hissed' : decision.reason === 'lit' ? 'A creeper is about to explode'
        : decision.reason === 'close' ? 'A creeper came close' : decision.reason === 'ordered' ? 'A creeper is near'
            : 'A creeper keeps following me';
    const doing = decision.stance === 'hit_and_step_back' ? 'hitting it and stepping back'
        : decision.stance === 'leave' ? 'leaving it behind' : 'backing off';
    // A move made because a player said so says so, so the model knows where it came from.
    return `${what} (${where}); ${doing}${decision.reason === 'ordered' ? ', as I was told to' : ''}.`;
}

function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}
