// SPDX-License-Identifier: CC0-1.0
// Never look an enderman in the eye.
//
// An enderman turns on a player who looks at its head: the game takes the player's line of view and the
// line to the enderman's eyes, and calls it a stare when they are within a small angle of each other, the
// smaller the farther off it is (about 4 degrees at 10 blocks, 2 at 20). A player who knows learns to look
// at its feet. The bot looks around all the time: the idle look-around, a dash away from a creeper, walking.
// Any of those can sweep over an enderman's head and start a fight the bot can't win.
//
// So every look the bot makes goes through a guard (bot.look, which bot.lookAt also calls). When the look
// would come within twice the game's angle of an enderman's eyes, its pitch is lowered until it doesn't:
// the bot looks at the enderman's feet, or the ground before it. A look that is nowhere near one is let
// through untouched. Endermen are the ones world.js hands out, so under fair play only those in view count,
// as only those can see the bot stare.
import * as world from '../library/world.js';

const ENDERMAN_EYE = 2.55;
const MARGIN = 2;          // twice the game's angle
const STEP = 0.05;         // radians the pitch is lowered by at a time
const NOTICE_WITHIN = 64;  // an enderman notices a stare from this far
const EYES_KEPT_MS = 250;

// The way a look points, as mineflayer turns yaw and pitch: yaw 0 faces north (-z), turning toward west.
const viewOf = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });

/** Whether a look from `eye` would count as a stare at any of the enderman eyes `eyes`, with the margin. */
export function stares(eye, yaw, pitch, eyes) {
    const view = viewOf(yaw, pitch);
    return eyes.some(target => {
        const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 1e-6) return false;
        const dot = (view.x * dx + view.y * dy + view.z * dz) / distance;
        return dot > 1 - (0.025 * MARGIN) / distance;
    });
}

/**
 * The pitch to look at with this yaw so as not to stare at any of `eyes`: the one asked for when that is
 * safe, else lowered until it is (straight down at most).
 */
export function safePitch(eye, yaw, pitch, eyes) {
    let safe = pitch;
    while (safe > -Math.PI / 2 && stares(eye, yaw, safe, eyes)) safe -= STEP;
    return Math.max(safe, -Math.PI / 2);
}

/**
 * Puts the guard on the bot's looks. Once per bot.
 * @param {object} bot
 */
export function guardGaze(bot) {
    if (!bot || typeof bot.look !== 'function' || bot.look.gazeGuarded) return;
    const look = bot.look;
    // The pathfinder looks the way it walks every tick, and asking what is in view costs a look around; the
    // endermen in view are asked for at most every 250 ms.
    let eyes = [], askedAt = -Infinity;
    const endermenEyes = () => {
        if (Date.now() - askedAt < EYES_KEPT_MS) return eyes;
        askedAt = Date.now();
        eyes = world.getNearbyEntities(bot, NOTICE_WITHIN)
            .filter(entity => entity.name === 'enderman')
            .map(entity => ({ x: entity.position.x, y: entity.position.y + ENDERMAN_EYE, z: entity.position.z }));
        return eyes;
    };
    const guarded = async (yaw, pitch, force) => {
        const position = bot.entity?.position;
        if (!position) return look(yaw, pitch, force);
        const eyes = endermenEyes();
        if (!eyes.length) return look(yaw, pitch, force);
        const eye = { x: position.x, y: position.y + (bot.entity.eyeHeight ?? 1.62), z: position.z };
        return look(yaw, safePitch(eye, yaw, pitch, eyes), force);
    };
    guarded.gazeGuarded = true;
    bot.look = guarded;
}
