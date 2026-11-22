// SPDX-License-Identifier: CC0-1.0
// How fast the bot turns its head.
//
// mineflayer sets the bot's facing the moment a look is asked for. It paces only what it tells the server
// about an unforced look, and a forced one (the fight's, the reflexes') not even that. Perception reads the
// bot's own facing, and walking goes the way it faces, so the bot sees the whole circle and faces a mob
// behind it in no time at all, which no player can. Through a player's screen that would make every turn a
// free look around.
//
// So every look goes through here: the facing moves toward the one asked for a step each game tick, at a
// speed a player can match, and the look resolves when it gets there. A player on a controller takes about a
// second to turn round (timed on Bedrock); a mouse player can be faster, but every player can be this fast.
// The steps go through whatever guards bot.look (the enderman gaze guard sees each one), and the newest look
// asked for wins: the pathfinder, which asks every tick, simply steers the turn as it goes.
//
// `turn_speed` (in the fair-play policy) is degrees a second, or "instant" for mineflayer's own way. The
// module is installed either way; at "instant" it passes every look straight on.

export const CONTROLLER_DEGREES_PER_SECOND = 180;
const TICK_MS = 50;
const TAU = 2 * Math.PI;
// Closer than this to the facing asked for counts as there. The game's own mouse step is 0.15 degrees.
const THERE = 0.002;
// Building a pillar under itself, the bot jumps and places the block below its feet at the top of the jump.
// A jump is up and down in about 0.6 s, and from a level look turning to face straight down takes half of
// that, from looking up (just after digging the block overhead) all of it. So a player looks down first, and
// jumps once looking down. This far down the block below is on screen, and the last bit of the turn, as the
// place looks at the very face, is a tick or two.
const TOWER_PITCH = -65 * Math.PI / 180;
// The walk's heading counts as current for this long after its last look: the pathfinder looks every tick.
const HEADING_FRESH_MS = 120;
// The movement keys a player holds for a heading this far round from the facing (cos and sin of 67.5
// degrees): eight ways, as a keyboard gives, each within 22.5 degrees of the way it means to go.
const KEY_SHARE = Math.cos(67.5 * Math.PI / 180);
const MOVES = ['forward', 'back', 'left', 'right', 'sprint'];

/**
 * The movement keys that carry the bot toward a heading while it faces another way, as a player walks with
 * the keys (or the stick) while the camera turns. `relative` is the heading less the facing, in radians,
 * positive toward greater yaw, which is the bot's left. Sprinting needs the forward key, as in the game.
 * @returns {{forward:boolean, back:boolean, left:boolean, right:boolean}}
 */
export function keysToward(relative) {
    const ahead = Math.cos(relative), left = Math.sin(relative);
    return { forward: ahead > KEY_SHARE, back: ahead < -KEY_SHARE, left: left > KEY_SHARE, right: left < -KEY_SHARE };
}

/** The smallest signed angle from a to b, in radians: positive is a turn toward greater yaw. */
export function angleBetween(a, b) {
    return ((b - a) % TAU + TAU + Math.PI) % TAU - Math.PI;
}

/**
 * Where the facing is one step from (yaw, pitch) toward (toYaw, toPitch), turning at most `maxStep` radians.
 * The two axes move together along the shorter way round, so the turn goes straight, not yaw first.
 * @returns {{yaw:number, pitch:number, there:boolean}}
 */
export function stepToward(yaw, pitch, toYaw, toPitch, maxStep) {
    const dYaw = angleBetween(yaw, toYaw), dPitch = toPitch - pitch;
    const distance = Math.hypot(dYaw, dPitch);
    if (distance <= Math.max(maxStep, THERE)) return { yaw: yaw + dYaw, pitch: toPitch, there: true };
    const f = maxStep / distance;
    return { yaw: yaw + dYaw * f, pitch: pitch + dPitch * f, there: false };
}

/**
 * Paces every look the bot makes. Once per bot. Whatever wraps bot.look before this is what each step goes
 * through; a guard put on afterwards (reflexes/gaze.js) takes its place in the steps by `stepThrough`.
 *
 * @param {object} bot - after its plugins are loaded
 * @param {object} options
 * @param {() => number|'instant'} options.getSpeed - degrees a second, or 'instant'
 * @param {(ms: number) => Promise<void>} [options.wait] - waits a game tick; tests pass their own
 * @returns {{stop: function}|null}
 */
export function installTurnSpeed(bot, { getSpeed, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (!bot || typeof bot.look !== 'function' || bot.lookPacer) return bot?.lookPacer ?? null;
    let step = bot.look;              // one step of a turn: the look as it was before this, guards and all
    let turn = 0;                     // the number of the newest turn; an older one stops when it sees a newer
    let stopped = false;
    let heading = null;               // where the walk is going: the newest unforced look, {yaw, at}

    async function paced(yaw, pitch, force) {
        const speed = getSpeed();
        const entity = bot.entity;
        // The pathfinder alone looks unforced, every tick it walks, along the way it is going.
        if (!force) heading = { yaw, at: Date.now() };
        if (stopped || speed === 'instant' || !(speed > 0) || !entity || !Number.isFinite(entity.yaw)) return step(yaw, pitch, force);
        // The steps are sent forced, so the walking gaze (walking_gaze.js), which tilts only the pathfinder's
        // unforced level look, is asked here for the pitch the turn is really headed for.
        pitch = bot.lookWalkingGaze?.(yaw, pitch, force) ?? pitch;
        const mine = ++turn;
        const maxStep = (speed * Math.PI / 180) * (TICK_MS / 1000);
        for (;;) {
            const next = stepToward(entity.yaw, entity.pitch, yaw, pitch, maxStep);
            // Each step is sent at once: it is no bigger than a player turns in a tick.
            await step(next.yaw, next.pitch, true);
            if (next.there || mine !== turn || stopped) return;
            await wait(TICK_MS);
            if (mine !== turn || stopped || !bot.entity) return;
        }
    }

    // The pathfinder builds a pillar by holding jump while it waits for the bot to rise, and places when it
    // is high enough. It sets jump each game tick, after the physics has moved the bot; this runs after it
    // (it was put on later) and before the next move. So, until the bot looks down, it takes the jump back
    // and turns the head down instead: the jump starts once the look is there, as a player's would.
    let lookingDown = false;
    const holdTowerJump = () => {
        const entity = bot.entity;
        if (stopped || !bot.controlState?.jump || !bot.pathfinder?.isBuilding?.() || !entity?.onGround) return;
        const speed = getSpeed();
        if (speed === 'instant' || !(speed > 0) || !(entity.pitch > TOWER_PITCH)) return;
        // Asking for the jump also queued one (mineflayer's physics jumps on either), so both are taken back.
        bot.setControlState('jump', false);
        bot.jumpQueued = false;
        if (lookingDown) return;
        lookingDown = true;
        Promise.resolve(bot.look(entity.yaw, -Math.PI / 2, true)).catch(() => {}).finally(() => { lookingDown = false; });
    };
    bot.on?.('physicsTick', holdTowerJump);

    // The pathfinder walks by looking the way it is going and holding forward. At a player's turning speed
    // the facing lags behind that look, and forward then carries the bot the way it faces: round a corner it
    // swings wide, off a bridge or into a trench beside the path. A player walks the way they mean to go with
    // the keys, whichever way the camera has got to. So, after the pathfinder has set the keys each tick,
    // its forward is swapped for the keys that go toward its heading from the facing the bot has now. What it
    // asked for is kept, to put back when the facing catches up or it stops walking.
    const asked = {};
    const setControl = typeof bot.setControlState === 'function' ? bot.setControlState : null;
    let steering = false;
    if (setControl) {
        bot.setControlState = function (control, state) {
            asked[control] = state;
            // While it steers, a movement key asked for between ticks (a reflex's walk sets its keys on its
            // own clock) is steered at once too, or it would hold forward and back together until the tick.
            if (steering && MOVES.includes(control)) return steer();
            return setControl.call(this, control, state);
        };
    }
    const putBack = () => {
        if (!steering) return;
        steering = false;
        for (const control of MOVES) setControl.call(bot, control, Boolean(asked[control]));
    };
    const steer = () => {
        if (!setControl) return;
        const entity = bot.entity;
        const speed = getSpeed();
        const walking = asked.forward && !asked.back && !asked.left && !asked.right && heading && (heading.held || Date.now() - heading.at <= HEADING_FRESH_MS);
        if (stopped || speed === 'instant' || !(speed > 0) || !walking || !entity || !Number.isFinite(entity.yaw)) return putBack();
        const keys = keysToward(angleBetween(entity.yaw, heading.yaw));
        if (keys.forward && !keys.left && !keys.right) return putBack();
        steering = true;
        for (const control of ['forward', 'back', 'left', 'right']) setControl.call(bot, control, keys[control]);
        setControl.call(bot, 'sprint', Boolean(asked.sprint) && keys.forward);
    };
    bot.on?.('physicsTick', steer);

    const pacer = {
        /**
         * Walks toward a heading (a yaw) on the keys, while forward is held, whichever way the bot faces:
         * for a move that walks without the pathfinder, as a reflex backing away while it turns to run does.
         * Held until called with null, or until the pathfinder walks somewhere and looks its own way.
         */
        walkToward(yaw) { heading = Number.isFinite(yaw) ? { yaw, at: Date.now(), held: true } : null; },
        /** A guard put on bot.look after this wraps each step instead of the whole turn. */
        stepThrough(wrap) { step = wrap(step); },
        /** Every look goes straight through from now on. */
        stop() {
            stopped = true;
            bot.off?.('physicsTick', holdTowerJump);
            bot.off?.('physicsTick', steer);
            if (setControl) putBack();
        },
    };
    const look = (yaw, pitch, force) => paced(yaw, pitch, force);
    // Kept on the function too, so that a wrapper that copies the marks of what it wraps keeps them.
    look.lookPacer = pacer;
    if (bot.look.gazeGuarded) look.gazeGuarded = true;
    bot.lookPacer = pacer;
    bot.look = look;
    return pacer;
}
