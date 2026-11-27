// SPDX-License-Identifier: CC0-1.0
// Where travel asks whether the bot already knows a way.
//
// Every walk in skills.js ends in goToGoal. Before it plans anything, goToGoal calls followKnownWay
// below. With no guide installed that does nothing, and travel is exactly as Mindcraft always had it.
// Another module can install a guide that first walks the bot along a way it remembers; goToGoal then
// carries on from wherever that left the bot, so a guide only ever has to get the bot closer.
//
// The guide may also find that the way is blocked by someone's build. Then the rest of the trip should dig
// nothing: an ordinary path that may dig would tunnel round their wall into what they built. goToGoal hands
// its movements to keepToWay below, which makes them dig nothing after such a verdict.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code,
// so a setter there would let that code swap the guide.

let guide = null;

/**
 * Installs the guide, or removes it with null.
 * @param {((bot: object, goal: object, log: (bot: object, text: string) => void) => Promise<{noDigging?: boolean}|void>)|null} fn
 */
export function setTravelGuide(fn) {
    guide = fn ?? null;
}

/**
 * Lets the installed guide move the bot towards the goal along a way it knows. Resolves when the guide
 * is done, having moved the bot or not, with what it found about the way (null with no guide). Rejects
 * only when the guide does, which it should do only for a trip that was interrupted.
 * @returns {Promise<{noDigging?: boolean}|null>}
 */
export async function followKnownWay(bot, goal, log) {
    if (!guide) return null;
    return (await guide(bot, goal, log)) ?? null;
}

/**
 * Shapes the movements the rest of the trip plans with, after what the guide found. A way blocked by
 * someone's build means no digging at all; otherwise they are left as they are.
 * @param {{noDigging?: boolean}|null} way - what followKnownWay resolved to
 * @param {...object} movements - the pathfinder movements goToGoal is about to plan with
 */
export function keepToWay(way, ...movements) {
    if (!way?.noDigging) return;
    for (const moves of movements) moves.canDig = false;
}
