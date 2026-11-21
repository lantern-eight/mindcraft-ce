// SPDX-License-Identifier: CC0-1.0
// Which field of view a live script runs fair play with.
//
// Strict fair play sees through a player's screen (fov_degrees 70). Most live scenes are about something
// else (walls, memory, reflexes), and are worth running both ways: with the screen, as the bot plays, and
// all around, which shows whether a failure comes from the view or from the thing the scene is about.
//   MC_TEST_VIEW=all   (or --view=all)    all around: strict with fov_degrees 360
//   anything else                         strict, the narrow view
// An environment variable, so that bedrock_all.js passes it on to every script it starts.
const chosen = process.argv.find(a => a.startsWith('--view='))?.split('=')[1] ?? process.env.MC_TEST_VIEW;

/** 'all' or 'narrow'. */
export const LIVE_VIEW = chosen === 'all' ? 'all' : 'narrow';

/** The fair-play settings for that view, to spread into setSettings or resolvePolicy. */
export function fairPlaySettings() {
    return LIVE_VIEW === 'all' ? { fair_play: 'custom', fair_play_custom: { fov_degrees: 360 } } : { fair_play: 'strict' };
}

/**
 * Turns the bot to face a point, as a player turns to look at something a scene asks about. Through a
 * player's screen that decides what the bot sees; seeing all around, it changes nothing.
 * @param {object} bot
 * @param {{x:number,y:number,z:number}} point
 */
export async function faceToward(bot, point) {
    const p = bot.entity.position;
    const dx = point.x - p.x, dy = point.y - (p.y + (bot.entity.eyeHeight ?? 1.62)), dz = point.z - p.z;
    await bot.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), true);
}

/**
 * Turns the bot all the way round in eight steps, a little down, as a player looks over a new place, and
 * calls `each` after every step: to let world memory look, say. Ends facing as it began.
 * @param {object} bot
 * @param {() => Promise<void>|void} each
 */
export async function lookRound(bot, each) {
    const yaw = bot.entity.yaw, pitch = bot.entity.pitch;
    for (let i = 0; i < 8; i++) {
        await bot.look(yaw + i * Math.PI / 4, -0.35, true);
        await each();
    }
    await bot.look(yaw, pitch, true);
}
