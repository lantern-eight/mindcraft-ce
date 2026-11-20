// SPDX-License-Identifier: CC0-1.0
// The shield: a carried shield goes in the off-hand, and goes up where a player would raise it.
//
//   createShield(bot, { use })   the bot's shield: put it in the off-hand, raise it, lower it
//   shotComing(mobs)             the mob about to loose a shot at the bot, to hold the shield up against
//
// The moves that raise it are the fight (melee.js), the back-out of range from an archer with no cover near
// (moves.js, for the mob reflex), and the back-off from a lit creeper the bot can't get clear of in time
// (moves.js, for the creeper reflex). Each asks, step by step, whether to hold the shield up, and the rest of
// the time it is down.
//
// How it is used, and why:
//   - **Up only while the bot stands still.** The game slows a player with a shield up to a fifth of a walk
//     and lets them neither sprint nor swing. mineflayer's physics doesn't slow the bot, so a bot walking
//     behind its shield would move faster than any player can. So it stands while the shield is up, and
//     lowers it to move or to swing.
//   - **Up when the shot comes, not while an archer is about.** A skeleton holds its bow up all the while it
//     has a target, and draws it for about a second before each arrow; a player raises the shield while it
//     draws and runs in between. That is the tell asked of the edition seam (isDrawing). Bedrock shows no
//     draw, so there a skeleton's shots come with no tell, and the bot meets archers as before.
//   - **Up until the arrow lands.** The draw ends as the arrow is loosed, and the arrow is still on its way:
//     half a second at most across an archer's range. The shield stays up that long after the draw ends.
//   - **Only when it covers every archer.** A shield covers the side it faces. With archers aiming from two
//     sides, facing one turns the bot's back to the other, and it never closes on either: in the arena two
//     skeletons on either side of the bot cost it 16 damage round its shield. Then it fights on unshielded,
//     as it did before it had one.
//   - **Never against a witch** (wehos/mc-agent-neko): its splash potions land round a shield.
//   - **One owner of the use-item channel** (item_use.js): the shield doesn't go up in the middle of a meal,
//     and a meal waits for it to come down.
// Raising it is the edition's answer (raiseShield): using the off-hand on Java, sneaking on Bedrock.
import { editionOf } from '../edition/index.js';
import { withoutAction } from '../action_context.js';

export const SHIELD = 'shield';
export const BLOCK_WITHIN = 16;     // an archer's range: a skeleton shoots from about 15 blocks
export const AFTER_SHOT_MS = 600;   // an arrow crosses an archer's range in half a second
const COVER_DEGREES = 60;           // archers within this of the one faced are behind the same shield (the
                                    // game covers 90 degrees either side; archers strafe as they shoot)
const OFF_HAND_SLOT = 45;           // mineflayer's slot for the off-hand, on both editions
// Mobs whose attacks a shield doesn't stop.
const UNBLOCKED = new Set(['witch']);

/**
 * Settings the fight arena may change to measure them (tests/live/fight_arena.js). Not a player's setting:
 * what the arena shows to pay is what the bot does.
 *   betweenSwings  raise it while the weapon recharges, with the mob in reach. Off: in the Java arena it saved
 *                  nothing and cost a little (a lone skeleton 4 damage instead of none), as LarsHamb's
 *                  arena found too
 *   beat           where the game shows no bow drawn (Bedrock), raise it as an archer's next shot is due, by the
 *                  beat of its shots heard (shot_beat.js), when backing out of its range. Off only to measure
 *                  what that gives. (The fight doesn't keep the beat: in the Bedrock arena it blocked about an
 *                  arrow a round, and cost more in time stood still.)
 */
export const shieldTuning = { betweenSwings: false, beat: true };

/** What is in the bot's off-hand, or null. */
export function offHandOf(bot) {
    const slot = typeof bot.getEquipmentDestSlot === 'function' ? bot.getEquipmentDestSlot('off-hand') : OFF_HAND_SLOT;
    return bot.inventory?.slots?.[slot ?? OFF_HAND_SLOT] ?? null;
}

/**
 * The mob to hold the shield up against now: the nearest one in view about to loose a shot, within an
 * archer's range, when every other mob in view aiming at the bot is on the same side. Null when none is, or
 * when the archers are on more than one side.
 * @param {object[]} mobs - from mobsAround (mobs.js): {seenNow, drawing, aiming, distance, position, name, ...}
 * @param {{x:number, z:number}} at - where the bot stands
 */
export function shotComing(mobs, at) {
    const shooter = mobs
        .filter(mob => mob.seenNow && mob.drawing && mob.distance <= BLOCK_WITHIN && !UNBLOCKED.has(mob.name))
        .sort((a, b) => a.distance - b.distance)[0];
    if (!shooter) return null;
    const facing = Math.atan2(shooter.position.z - at.z, shooter.position.x - at.x);
    const covered = mob => {
        let turn = Math.abs(Math.atan2(mob.position.z - at.z, mob.position.x - at.x) - facing);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        return turn <= COVER_DEGREES * Math.PI / 180;
    };
    const others = mobs.filter(mob => mob !== shooter && mob.seenNow && (mob.aiming || mob.drawing) && mob.distance <= BLOCK_WITHIN);
    return others.every(covered) ? shooter : null;
}

/**
 * What to hold the shield up against, step by step: the mob about to shoot, and for a moment after its
 * draw ends, the same mob, whose arrow is on its way.
 * @param {() => number} [now]
 * @returns {(coming: object|null) => number|null} given the mob shotComing found now (or null), the id of the
 *     mob to block now, or null
 */
export function shotWindow(now = Date.now) {
    let last = null, until = -Infinity;
    return coming => {
        if (coming) { last = coming.id; until = now() + AFTER_SHOT_MS; return last; }
        return now() < until ? last : null;
    };
}

/**
 * The bot's shield.
 * @param {object} bot
 * @param {object} options
 * @param {object} options.use - the use-item channel (item_use.js)
 * @param {() => number} [options.now]
 */
export function createShield(bot, { use, now = Date.now }) {
    let up = false, raisedAt = null;
    const edition = () => editionOf(bot.registry);
    const has = () => offHandOf(bot)?.name === 'shield';

    return {
        /** Whether it is up now. */
        get up() { return up; },
        /** When it went up, or null while it is down. */
        get raisedAt() { return raisedAt; },
        /** Whether a shield is in the off-hand. */
        has,
        /**
         * Puts a carried shield in the off-hand, when the off-hand is empty: a player keeps one there. Whatever
         * else the off-hand holds was put there on purpose, and stays. Inside an action, like any equip.
         * @returns {Promise<boolean>} whether a shield is in the off-hand now
         */
        async ready() {
            if (has()) return true;
            const carried = bot.inventory?.items?.().find(item => item.name === 'shield');
            if (!carried || offHandOf(bot)) return false;
            try { await bot.equip(carried, 'off-hand'); } catch { /* the next move tries again */ }
            return has();
        },
        /**
         * Raises it, if there is one in the off-hand and the channel is free (not in the middle of a meal).
         * The caller stands still while it is up.
         * @returns {boolean} whether it is up
         */
        raise() {
            if (up) return true;
            if (!has() || !use.take(SHIELD)) return false;
            edition().raiseShield(bot, true);
            up = true;
            raisedAt = now();
            return true;
        },
        /** Lowers it, if it is up. Also once the action that raised it is over, so it is never left up. */
        lower() {
            if (!up) return;
            up = false;
            raisedAt = null;
            // An action that was stopped turns down its own controls (action_context.js); this one must go through.
            withoutAction(() => edition().raiseShield(bot, false));
            use.release(SHIELD);
        },
    };
}
