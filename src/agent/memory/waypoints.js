// SPDX-License-Identifier: CC0-1.0
// Waypoints a player shares in chat.
//
// Map mods let a player share a waypoint as a line of chat: Xaero's Minimap posts
//     xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints
// and JourneyMap
//     [name:"Base", x:268, y:64, z:-160, dim:minecraft:overworld]
// A line like that is a player telling the bot where a place is, as plainly as "the base is at 268 64 -160",
// so it becomes a told place (told.js, places.js) at once, without asking the model to read it. The bot
// answers in a line of chat, and the model hears of it once, through the change notes.
//
// A waypoint can be in another dimension. Each dimension keeps its own memory, so a Nether waypoint shared in
// the Overworld goes into the Nether's places, and is there when the bot gets there.
//
// Only a message that is nothing but a waypoint is taken this way. Anything more ("meet me here
// xaero-waypoint:...") goes to the model as before, which can save it with !rememberToldPlace.

/** The dimensions as both editions name them (`bot.game.dimension`). */
const DIMENSIONS = ['overworld', 'the_nether', 'the_end'];

/** A dimension's name as `bot.game.dimension` gives it, from what a waypoint says; null when it can't be told. */
export function dimensionOf(text) {
    const name = String(text ?? '').toLowerCase().replace(/^minecraft:/, '');
    if (DIMENSIONS.includes(name)) return name;
    // Xaero names its waypoint sets after the dimension: Internal-overworld-waypoints, Internal-the-nether-
    // waypoints, or by the old number, Internal-dim%-1-waypoints (the Nether) and Internal-dim%1-waypoints (the End).
    if (/nether|dim%-1(?!\d)/.test(name)) return 'the_nether';
    if (/end|dim%1(?!\d)/.test(name)) return 'the_end';
    if (/overworld|dim%0(?!\d)/.test(name)) return 'overworld';
    return null;
}

const number = text => (/^-?\d+$/.test(text) ? Number(text) : null);

/** Xaero's line: name, initials, x, y (or ~), z, colour, whether it is temporary, a yaw, and the set it is in. */
function xaero(text) {
    const match = /^xaero-waypoint:(.*)$/i.exec(text);
    if (!match) return null;
    const fields = match[1].split(':');
    if (fields.length < 5) return null;
    const [name, initials, xs, ys, zs] = fields;
    const x = number(xs), z = number(zs), y = ys === '~' ? null : number(ys);
    if (x === null || z === null || (y === null && ys !== '~')) return null;
    return { name: (name || initials).trim(), spot: { x, y, z }, dimension: dimensionOf(fields.slice(8).join(':')), format: 'Xaero' };
}

/** JourneyMap's line: [name:"...", x:.., y:.., z:.., dim:...], its keys in any order. */
function journeyMap(text) {
    const match = /^\[(.*)\]$/.exec(text);
    if (!match) return null;
    const fields = {};
    for (const part of match[1].matchAll(/(\w+):("[^"]*"|[^,\]]*)/g)) fields[part[1].toLowerCase()] = part[2].trim().replace(/^"|"$/g, '');
    if (!('name' in fields) || !('x' in fields) || !('z' in fields)) return null;
    const x = number(fields.x), z = number(fields.z), y = 'y' in fields ? number(fields.y) : null;
    if (x === null || z === null || ('y' in fields && y === null)) return null;
    return { name: fields.name.trim(), spot: { x, y, z }, dimension: 'dim' in fields ? dimensionOf(fields.dim) : null, format: 'JourneyMap' };
}

/**
 * Reads a chat message that is a shared waypoint and nothing else.
 * @returns {{name: string, spot: {x: number, y: number|null, z: number}, dimension: string|null, format: string}|null}
 */
export function parseWaypoint(message) {
    if (typeof message !== 'string') return null;
    const text = message.trim();
    const waypoint = xaero(text) ?? journeyMap(text);
    return waypoint?.name ? waypoint : null;
}

/**
 * Takes shared waypoints out of what the agent answers. Wraps `agent.handleMessage` (no inherited file is
 * edited): a player's message that is a waypoint goes to `tell` instead of the model.
 * @param {object} agent
 * @param {(player: string, waypoint: object) => boolean} tell - saves it; returns false to hand the message on
 * @returns {{stop: () => void}}
 */
export function waypointListener(agent, tell) {
    const original = agent.handleMessage;
    if (typeof original !== 'function') return { stop() {} };
    const isPlayer = source => typeof source === 'string' && source && source !== 'system' && source !== agent.name;
    agent.handleMessage = function (source, message, ...rest) {
        const waypoint = isPlayer(source) ? parseWaypoint(message) : null;
        if (waypoint) {
            try { if (tell(source, waypoint)) return Promise.resolve(true); }
            catch (error) { console.warn('[world memory] a shared waypoint could not be saved:', error?.message ?? error); }
        }
        return original.call(this, source, message, ...rest);
    };
    return { stop() { agent.handleMessage = original; } };
}
