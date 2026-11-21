// SPDX-License-Identifier: CC0-1.0
// Where the bot looks while it walks.
//
// The pathfinder faces the way it walks and holds the head level. With a view all around that costs
// nothing, but through a player's screen a level look leaves out the ground closer than about two blocks:
// it is below the bottom of the screen. The bot would walk onto ground it has never seen, and route
// planning, which takes a cell never seen for open ground, could send it through the floor under its
// feet. A player walking looks a little down, at the ground a few steps ahead, and so does the bot: while
// the pathfinder walks under a narrow view, its level look is tilted down by WALKING_PITCH. Every other
// look, and any look with the view all around, is left as asked.
//
// The pathfinder is not changed: the look it asks for is. The tilt is told to whatever wraps bot.look
// outside this (`pitchFor`), so the enderman gaze guard judges the look that is really made.

// 25 degrees down: the bottom of a screen 70 tall then meets the ground about one block ahead of the
// feet, and the top still shows the land ahead to a little above the horizon.
export const WALKING_PITCH = -25 * Math.PI / 180;

/**
 * Tilts the pathfinder's level look down while it walks under a narrow view. Once per bot.
 * @param {object} bot - after its plugins are loaded
 * @param {object} options
 * @param {() => object|null} options.getScreen - the screen the bot sees through, or null when it sees all
 *   around (perception's screenNow)
 */
export function installWalkingGaze(bot, { getScreen }) {
    if (!bot || typeof bot.look !== 'function' || bot.lookWalkingGaze) return;
    const look = bot.look;
    // The pathfinder's walking look is level, never forced: bot.look(yaw, 0). Others pass their own pitch.
    const pitchFor = (yaw, pitch, force) =>
        (pitch === 0 && !force && bot.pathfinder?.isMoving?.() && getScreen()) ? WALKING_PITCH : pitch;
    const walking = (yaw, pitch, force) => look(yaw, pitchFor(yaw, pitch, force), force);
    walking.pitchFor = pitchFor;
    // Kept on the bot, not the function, so it holds whatever wraps bot.look after this.
    bot.lookWalkingGaze = pitchFor;
    if (look.gazeGuarded) walking.gazeGuarded = true;
    bot.look = walking;
}
