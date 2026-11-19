// SPDX-License-Identifier: CC0-1.0
// The fight, `self_defense`, as the threat reflexes run it: fight a lone mob that comes at the bot, when the
// bot is fit for it.
//
// It takes over Mindcraft's own `self_defense` (install.js registers it under the same name and in the same
// place, so the switch, the profiles and the actions that pause it by name keep their meaning). The stock
// body fought any hostile within 8 blocks with a walkable path, every round's path search new, whatever the
// bot's health: a passing enderman, two zombies at once, a skeleton it then chased. This one fights only
// what chooseFight (mob_decide.js) allows, rule 6 of the threat rules: one melee mob that has picked a
// target, within 8 blocks, with the bot at half health or more and fed enough to sprint. Two or more, or one
// too strong, are the mob reflex's to back away from.
//
//   - Whether the mob can be walked to is the kept path verdict (path_verdicts.js), not a new search.
//   - A mob the bot fought for 30 s without finishing is given up on for a minute, so the bot doesn't keep
//     going back to one it can't reach or can't kill.
//   - It claims the mob as it starts (claims.js), for 5 s, so the mob reflex doesn't take it for a crowd
//     retreat the moment a second mob turns up; an urgent move (low health, a mob aiming) doesn't ask. A
//     crowd that is still there after that is the mob reflex's.
//   - It stops when the bot's health falls under 6, for the mob reflex to run.
import convoManager from '../conversation.js';
import * as world from '../library/world.js';
import { log } from '../library/skills.js';
import { describeDirection } from '../fairplay/perception.js';
import { chooseFight, LOW_HEALTH } from './mob_decide.js';
import { fightOne } from './moves.js';
import { mobsAround, mobInView, ordersFor, say, selfOf } from './mobs.js';
import { CLAIM_MS } from './claims.js';

export const MODE_NAME = 'self_defense';
const GIVE_UP_MS = 60000;
const FIGHT_MS = 30000;
const TELL_AGAIN_MS = 60000;

/**
 * @param {object} options
 * @param {object} options.claims - shared with the mob reflex (claims.js)
 * @param {object} [options.orders] - the standing orders (orders.js); none means the bot's own judgment
 * @param {() => number} [options.now]
 */
export function createFightReflex({ claims, orders = null, now = Date.now }) {
    const givenUp = new Map(); // mob id -> until when
    const told = new Map();
    const dying = new Set();

    const mode = {
        name: MODE_NAME,
        description: 'Fight a lone mob that comes at you, when healthy and fed enough. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: agent => round(agent),
    };

    async function round(agent) {
        const bot = agent.bot;
        if (!mode.on || mode.active || !bot?.entity) return;
        const self = selfOf(bot);
        const ownerOf = claims.ownerOf;
        const isGivenUp = id => (givenUp.get(id) ?? 0) > now();
        const mobs = mobsAround(bot, dying);
        // The choice is made without the path first; only the one mob it picks is asked about.
        const orderOf = ordersFor(orders, self);
        const pick = chooseFight(mobs, self, { ownerOf, givenUp: isGivenUp, orderOf });
        if (!pick) return;
        const entity = mobInView(bot, pick.id);
        if (!entity || !(await world.isClearPath(bot, entity))) return;
        if (mode.active || !mode.on) return; // something else started while the path was asked
        act(agent, { ...pick, ordered: orderOf(pick)?.stance === 'fight' }, self).catch(error => console.warn(`[${MODE_NAME}] ${error.stack ?? error}`));
    }

    async function act(agent, pick, self) {
        const bot = agent.bot;
        mode.active = true;
        claims.claim(`id:${pick.id}`, MODE_NAME, CLAIM_MS); // long enough not to take turns, not the whole fight
        const interrupted = agent.actions.currentActionLabel;
        const where = describeDirection(self.position, pick.position).text;
        const line = `Fighting the ${pick.name.replace(/_/g, ' ')} (${where})${pick.ordered ? ', as I was told to' : ''}.`;
        say(agent, line);
        bot.emit?.('threat_reflex', { event: 'decided', at: performance.now(), stance: 'fight', key: `id:${pick.id}`, mode: MODE_NAME });
        let result, ended = null;
        try {
            result = await agent.actions.runAction(`mode:${MODE_NAME}`, async () => {
                // A fight under orders ends when the order lapses (under its minimum health), as the bot's
                // own ends under 6: then the mob reflex decides.
                const lapsed = () => pick.ordered && orders?.orderFor(pick.name, selfOf(bot))?.stance !== 'fight';
                const outcome = await fightOne(bot, {
                    target: () => mobInView(bot, pick.id),
                    stop: () => (bot.health ?? 20) < LOW_HEALTH || lapsed(),
                    maxMs: FIGHT_MS,
                });
                ended = outcome.ended === 'stopped' && lapsed() ? 'order lapsed' : outcome.ended;
                if (ended === 'out of time') givenUp.set(pick.id, now() + GIVE_UP_MS);
                log(bot, ended === 'gone' ? `Fought off the ${pick.name}.` : `Stopped fighting the ${pick.name} (${ended}).`);
            }, { timeout: -1 });
        } finally {
            mode.active = false;
            claims.claim(`id:${pick.id}`, MODE_NAME, 1000); // a moment more, so nothing snatches it as it falls
        }
        bot.emit?.('threat_reflex', { event: 'done', at: performance.now(), stance: 'fight', ended, mode: MODE_NAME });
        tellModel(agent, pick, interrupted, result, line);
    }

    // As the stock reflex did: when the fight stopped what the bot was doing, the model is told. Once per mob.
    function tellModel(agent, pick, interrupted, result, line) {
        const key = `id:${pick.id}`;
        const already = now() - (told.get(key) ?? -Infinity) < TELL_AGAIN_MS;
        if (!interrupted || agent.actions.resume_func || agent.self_prompter?.isActive?.() || result?.interrupted || already) {
            agent.bot.modes.flushBehaviorLog?.();
            return;
        }
        told.set(key, now());
        const role = convoManager.inConversation() ? agent.last_sender : 'system';
        const logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted}' was interrupted by ${MODE_NAME}: ${line}`
            + `\nYour behavior log: ${logs}\nRespond accordingly.`);
    }

    function watch(bot) {
        bot.on?.('entityDead', entity => dying.add(entity.id));
        bot.on?.('entityGone', entity => dying.delete(entity.id));
    }

    return { mode, round, watch, clear: () => { givenUp.clear(); told.clear(); dying.clear(); } };
}
