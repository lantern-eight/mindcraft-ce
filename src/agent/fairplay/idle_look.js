// SPDX-License-Identifier: CC0-1.0
// The idle look-around: where the bot looks while it has nothing to do.
//
// Mindcraft's `idle_staring` stares at the nearest mob within ten blocks, or looks a random way every two to
// twelve seconds. Seeing all around that is only for show. Through a player's screen it is the only time an
// idle bot looks about, and it does it badly: a random way can be the same way twice, and staring at one
// zombie turns the second one off the screen, so the bot takes two for one.
//
// This one, registered under the same name and in the same place (so the switch, the profiles and whatever
// pauses it by name keep their meaning):
//   - looks at mobs and players in view the way a person does: holds the look a moment, looks away, looks
//     back, and after a few looks leaves that one alone for a while;
//   - otherwise turns toward the way it has looked at least lately, so an idle bot covers the whole circle
//     every few seconds;
//   - turns its head at most once every 600 ms, and never stares at an enderman (the gaze guard keeps every
//     look off their eyes in any case);
//   - gives way to a glance (reflexes/glance.js), which holds the head for a moment.
// The shape of the gaze, the budget of looks and the floor on head turns are ideas from winnerspiros's
// mindcraft fork (ATTRIBUTION.md); the code is this fork's own.
import * as world from '../library/world.js';
import { editionOf } from '../edition/index.js';
import { looksOf, stalestHeading } from './look_around.js';

const WITHIN = 10;                  // mobs farther than this aren't looked at, as in the stock mode
const HOLD_MS = [1500, 3500];       // how long a look at a mob is held
const AWAY_MS = [2500, 7000];       // and how long the bot looks elsewhere before looking back
const LOOKS = 3;                    // looks at one mob before it is left alone
const REST_MS = 30_000;             // and for how long
const TURN_FLOOR_MS = 600;          // the least time between two turns of the head
const WANDER_NARROW_MS = [1000, 2500]; // between looks about, through a player's screen: the circle in a few seconds
const WANDER_WIDE_MS = [2000, 12000];  // seeing all around, as the stock mode does

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {() => number} [options.random]
 * @param {(bot: object) => boolean} [options.narrow] - whether the bot sees through a screen
 * @returns {{mode: object}}
 */
export function createIdleLook({ now = Date.now, random = Math.random, narrow = bot => Boolean(looksOf(bot)?.getScreen()) } = {}) {
    const between = ([lo, hi]) => lo + random() * (hi - lo);
    let target = null;        // { id, phase: 'hold' | 'away', until }
    const budgets = new Map(); // mob id -> { looks, restUntil }
    let nextTurn = 0, nextWander = 0;

    function lookAtMob(bot, mob) {
        // A baby is looked in the eye, half as high (the edition seam knows a baby).
        const baby = mob.type !== 'player' && editionOf(bot.registry).isBaby(mob);
        const height = baby ? mob.height / 2 : mob.height;
        bot.lookAt(mob.position.offset(0, height, 0));
    }

    function lookAbout(bot) {
        if (narrow(bot)) {
            const stalest = stalestHeading(bot);
            if (stalest) { bot.look(stalest.yaw, -0.35 + random() * 0.4, false); return; }
        }
        bot.look(random() * Math.PI * 2, (random() * Math.PI / 2) - Math.PI / 4, false);
    }

    // May this mob be looked at now? A few looks, then left alone for a while.
    function mayLookAt(id, t) {
        const budget = budgets.get(id);
        return !budget || budget.looks < LOOKS || t >= budget.restUntil;
    }
    function spendLook(id, t) {
        let budget = budgets.get(id);
        if (!budget || (budget.looks >= LOOKS && t >= budget.restUntil)) budget = { looks: 0, restUntil: 0 };
        budget.looks++;
        if (budget.looks >= LOOKS) budget.restUntil = t + REST_MS;
        budgets.set(id, budget);
    }

    const mode = {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,
        update(agent) {
            const bot = agent.bot;
            if (!bot?.entity?.position) return;
            const t = now();
            if ((looksOf(bot)?.holdUntil ?? 0) > t) return; // a glance has the head
            // Mobs in view, live (not one that just slipped out of sight), never an enderman.
            const mobs = world.getNearbyEntities(bot, WITHIN)
                .filter(e => e !== bot.entity && e.name !== 'enderman' && e.lastSeenAt === undefined);
            for (const id of budgets.keys()) if (!mobs.some(m => m.id === id) && t >= (budgets.get(id).restUntil || 0)) budgets.delete(id);

            if (target?.phase === 'hold') {
                const mob = mobs.find(m => m.id === target.id);
                if (mob && t < target.until) { lookAtMob(bot, mob); return; } // following it with the eyes
                // Held long enough, or gone: look away for a while.
                target = mob ? { id: target.id, phase: 'away', until: t + between(AWAY_MS) } : null;
                if (t >= nextTurn) { lookAbout(bot); nextTurn = t + TURN_FLOOR_MS; nextWander = t + between(narrow(bot) ? WANDER_NARROW_MS : WANDER_WIDE_MS); }
                return;
            }
            if (t < nextTurn) return;
            const awayFrom = target?.phase === 'away' && t < target.until ? target.id : null;
            if (target?.phase === 'away' && t >= target.until) target = null;
            const mob = mobs.find(m => m.id !== awayFrom && mayLookAt(m.id, t));
            if (mob) {
                spendLook(mob.id, t);
                target = { id: mob.id, phase: 'hold', until: t + between(HOLD_MS) };
                lookAtMob(bot, mob);
                nextTurn = t + TURN_FLOOR_MS;
                return;
            }
            if (t >= nextWander) {
                lookAbout(bot);
                nextTurn = t + TURN_FLOOR_MS;
                nextWander = t + between(narrow(bot) ? WANDER_NARROW_MS : WANDER_WIDE_MS);
            }
        },
    };
    return { mode };
}
