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
import { holdActions } from '../action_hold.js';
import { editionOf } from '../edition/index.js';
import { describeDirection } from '../fairplay/perception.js';
import { createThreatPicture } from './picture.js';
import { decideThreat, hitsNeeded } from './decide.js';
import { backOffFrom, hitAndStepBack } from './moves.js';

export const MODE_NAME = 'creeper_safety';
const MOVES = new Set(['back_off', 'hit_and_step_back', 'leave']);
const HOLD_AFTER_MS = 1500;   // after a move, how long other starts still wait
const ROOF_CHECK = 8;         // blocks above the head that make the bot "underground" for the decision
const HIT_REACH = 3;          // a survival player's reach to a mob

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @returns {{mode: object, hear: Function, picture: object}}
 */
export function createCreeperReflex({ now = Date.now } = {}) {
    const picture = createThreatPicture({ now });

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
        return {
            position: { x: position.x, y: position.y, z: position.z },
            health: bot.health ?? 20,
            gameMode: bot.game?.gameMode,
            edition: editionOf(bot.registry).name,
            underground,
            hitsNeeded: hitsNeeded(bot.inventory?.items?.().map(item => item.name) ?? []),
        };
    }

    // Tells the picture which creepers are in view right now, and whether each one's fuse is lit.
    function look(bot) {
        const edition = editionOf(bot.registry);
        const inView = world.getNearbyEntities(bot, 16)
            .filter(entity => entity.name === 'creeper' && entity.lastSeenAt === undefined) // not a stand-in
            .map(entity => ({ id: entity.id, position: entity.position, lit: edition.isFusing(bot.registry, entity) }));
        const self = selfOf(bot);
        picture.see(inView, self);
        return self;
    }

    // The creeper itself, if it is in view now, for hitting it.
    function creeperInView(bot, id) {
        if (id === null || id === undefined) return null;
        return world.getNearbyEntities(bot, 16).find(entity => entity.id === id && entity.lastSeenAt === undefined) ?? null;
    }

    function round(agent) {
        const bot = agent.bot;
        if (!mode.on || mode.active || !bot?.entity) return;
        const self = look(bot);
        const decision = decideThreat(picture.creepers(self), self, { explosion: picture.explosion(self) });
        // Not awaited: the move runs as an action, and the round must not hold up the mode loop.
        if (MOVES.has(decision.stance)) act(agent, decision, self).catch(error => console.warn(`[${MODE_NAME}] ${error.stack ?? error}`));
    }

    /** A sound hearing passed on. A hiss or an explosion runs a round at once. */
    function hear(agent, sound) {
        const bot = agent.bot;
        if (!bot?.entity || !(sound.subject === 'explosion' || /^creeper \(hissing\)$/.test(sound.subject))) return;
        picture.hear(sound, selfOf(bot));
        bot.emit?.('threat_reflex', { event: 'heard', at: performance.now(), subject: sound.subject });
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
        const report = event => bot.emit?.('threat_reflex', { ...event, stance: decision.stance, key: decision.key });
        report({ event: 'decided', at: performance.now() });

        // Where the creeper is now, as the bot knows it, while it moves.
        let last = decision.from;
        const from = () => {
            look(bot);
            const track = picture.creepers(selfOf(bot)).find(c => c.key === decision.key);
            if (track) last = track.position;
            return last;
        };
        let result;
        try {
            result = await agent.actions.runAction(`mode:${MODE_NAME}`, async () => {
                if (decision.stance === 'hit_and_step_back') {
                    const id = picture.creepers(selfOf(bot)).find(c => c.key === decision.key)?.id;
                    const outcome = await hitAndStepBack(bot, {
                        creeper: () => creeperInView(bot, id),
                        inReach: entity => withinAttackReach(bot, entity) && bot.entity.position.distanceTo(entity.position) <= HIT_REACH,
                        to: decision.distance, report,
                    });
                    return outcome.hit ? `Hit the creeper and stepped back.` : `Backed off from the creeper.`;
                }
                const leaving = decision.stance === 'leave';
                const outcome = await backOffFrom(bot, {
                    from, to: decision.distance, report, maxMs: leaving ? 8000 : 3000,
                    // Leaving also ends when the creeper has lost sight of the bot for good.
                    done: () => leaving && outOfSight(bot, decision.key),
                });
                return `Backed off (${outcome.ended}).`;
            }, { timeout: 1 });
        } finally {
            mode.active = false;
            if (decision.key !== 'explosion') picture.noteBackOff(decision.key);
            hold.release(HOLD_AFTER_MS);
        }
        report({ event: 'done', at: performance.now(), result: result?.message });
        tellModel(agent, decision, interrupted, result, line);
    }

    // Out of sight for a moment: the creeper no longer sees the bot either.
    function outOfSight(bot, key) {
        const track = picture.creepers(selfOf(bot)).find(c => c.key === key);
        return !track || (!track.seenNow && track.source === 'seen');
    }

    function tellModel(agent, decision, interrupted, result, line) {
        const track = picture.creepers(selfOf(agent.bot)).find(c => c.key === decision.key);
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

    return { mode, hear, picture, round };
}

// One fair line about what happened: where the creeper was as a direction and rough distance, the way a
// player would put it.
function sayLine(decision, where) {
    if (decision.reason === 'explosion') return `Something exploded (${where}); backing off.`;
    const what = decision.reason === 'hissed' ? 'A creeper hissed' : decision.reason === 'lit' ? 'A creeper is about to explode'
        : decision.reason === 'close' ? 'A creeper came close' : 'A creeper keeps following me';
    const doing = decision.stance === 'hit_and_step_back' ? 'hitting it and stepping back'
        : decision.stance === 'leave' ? 'leaving it behind' : 'backing off';
    return `${what} (${where}); ${doing}.`;
}

function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}
