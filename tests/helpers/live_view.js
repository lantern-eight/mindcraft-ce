// SPDX-License-Identifier: CC0-1.0
// Which field of view a live script runs fair play with.
//
// Strict fair play sees through a player's screen (fov_degrees 70). Most live scenes are about something
// else (walls, memory, reflexes), and are worth running both ways: with the screen, as the bot plays, and
// all around, which shows whether a failure comes from the view or from the thing the scene is about.
//   MC_TEST_VIEW=all   (or --view=all)    all around: strict with fov_degrees 360
//   anything else                         strict, the narrow view
// And how fast the bot turns, to measure what a player's turning costs a scene:
//   MC_TEST_TURN=instant   (or --turn=instant)   the facing changes at once, as mineflayer turns
//   anything else                                strict's, a player on a controller
// Environment variables, so that java_all.js and bedrock_all.js pass them on to every script they start.
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const chosen = option('view') ?? process.env.MC_TEST_VIEW;
const turn = option('turn') ?? process.env.MC_TEST_TURN;

/** 'all' or 'narrow'. */
export const LIVE_VIEW = chosen === 'all' ? 'all' : 'narrow';
/** 'instant' or 'strict'. */
export const LIVE_TURN = turn === 'instant' ? 'instant' : 'strict';

/** The fair-play settings for that view and turn, to spread into setSettings or resolvePolicy. */
export function fairPlaySettings() {
    const custom = {
        ...(LIVE_VIEW === 'all' ? { fov_degrees: 360 } : {}),
        ...(LIVE_TURN === 'instant' ? { turn_speed: 'instant' } : {}),
    };
    return Object.keys(custom).length ? { fair_play: 'custom', fair_play_custom: custom } : { fair_play: 'strict' };
}

/**
 * Turns the bot to a facing and makes sure it got there. At a player's turning speed a turn takes up to a
 * second, and a newer look (the idle look-around, a glance) ends it part way; a scene that needs the bot
 * facing a way asks again until it is.
 * @param {object} bot
 * @param {number} yaw
 * @param {number} [pitch]
 */
export async function faceExactly(bot, yaw, pitch = 0) {
    const off = () => Math.abs(((yaw - bot.entity.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) + Math.abs(pitch - bot.entity.pitch);
    for (let tries = 0; tries < 5; tries++) {
        await bot.look(yaw, pitch, true);
        if (off() < 0.02) return;
    }
    throw new Error(`the bot would not face ${yaw.toFixed(2)}, ${pitch.toFixed(2)}: it faces ${bot.entity.yaw.toFixed(2)}, ${bot.entity.pitch.toFixed(2)}`);
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
    await faceExactly(bot, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
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
