// SPDX-License-Identifier: CC0-1.0
// Told places: where a player said something is, until the bot has seen it for itself.
//
// Players tell each other coordinates all the time ("the village is at 300, -120"), read off the debug
// screen or a minimap. A bot that hears it may remember it and head there, but it hasn't seen the place,
// and nothing it decides should treat the place as seen. So a told place is kept apart (places.js, kind
// "told") and becomes an ordinary place only when the bot's own eyes have taken in that spot: when world
// memory holds the cells there, which only fair play's sight test writes.
//
// Here are the pure parts: reading the coordinates out of what was said, deciding whether memory holds
// the spot, and the check made after each look-around. Nothing here reads the live world.

const AIR = 'air';

// Sane limits for what a player could mean. The world border is 30 million out; heights run from the
// bottom of the overworld to the top of any dimension.
const MAX_XZ = 30_000_000;
const MIN_Y = -128, MAX_Y = 512;

/**
 * Reads a position out of what a player said: "300 64 -120", "300, -120", "x=300 z=-120",
 * "(300, ~, -120)". Three numbers are x, y and z; two are x and z, with the height unknown. A `~` for y
 * means unknown too.
 * @returns {{x:number, y:number|null, z:number}|null} null when it can't be read as a position
 */
export function parseWhere(text) {
    const said = String(text ?? '');
    const number = '-?\\d+(?:\\.\\d+)?';
    // Labelled: x=300 y=64 z=-120, in any order, with = or :.
    const labelled = {};
    for (const match of said.matchAll(new RegExp(`\\b([xyz])\\s*[:=]\\s*(${number}|~)`, 'gi'))) labelled[match[1].toLowerCase()] = match[2];
    let parts;
    if (labelled.x !== undefined && labelled.z !== undefined) parts = [labelled.x, labelled.y ?? '~', labelled.z];
    else {
        const tokens = said.match(new RegExp(`${number}|~`, 'g')) ?? [];
        if (tokens.length === 2 && !tokens.includes('~')) parts = [tokens[0], '~', tokens[1]];
        else if (tokens.length === 3 && tokens[0] !== '~' && tokens[2] !== '~') parts = tokens;
        else return null;
    }
    const [x, z] = [Number(parts[0]), Number(parts[2])];
    const y = parts[1] === '~' ? null : Number(parts[1]);
    if (![x, z].every(v => Number.isFinite(v) && Math.abs(v) <= MAX_XZ)) return null;
    if (y !== null && !(Number.isFinite(y) && y >= MIN_Y && y <= MAX_Y)) return null;
    return { x, y, z };
}

/**
 * Has the bot seen this spot, by world memory? With a height, any cell remembered within `around` blocks
 * of it counts, empty air included: the bot looked there. Without one, the column is searched from `top`
 * down to `bottom` for the highest block remembered there, which is the ground (or a roof, or a tree: what
 * a player looking at that spot from above would see first).
 * @param {object} cells - world memory's cells
 * @param {{x:number, y:number|null, z:number}} spot
 * @returns {{x:number, y:number, z:number}|null} the spot as seen, with its height filled in, or null
 */
export function seenSpot(cells, spot, { around = 2, top = MAX_Y, bottom = MIN_Y } = {}) {
    const x = Math.floor(spot.x), z = Math.floor(spot.z);
    if (spot.y !== null && spot.y !== undefined) {
        const y = Math.floor(spot.y);
        for (let dy = -around; dy <= around; dy++) for (let dx = -around; dx <= around; dx++) for (let dz = -around; dz <= around; dz++) {
            if (cells.read(x + dx, y + dy, z + dz) !== null) return { x: spot.x, y: spot.y, z: spot.z };
        }
        return null;
    }
    for (let y = Math.floor(top); y >= Math.floor(bottom); y--) {
        const name = cells.read(x, y, z);
        if (name && name !== AIR) return { x: spot.x, y: y + 1, z: spot.z };
    }
    return null;
}

/** "chest 4, furnace 1": what the bot remembers inside a place's box. */
function contents(memory, place) {
    const counts = new Map();
    for (const thing of memory.things?.within(place.min, place.max) ?? []) {
        if (thing.kind !== 'ore') counts.set(thing.name, (counts.get(thing.name) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => `${name} ${n}`).join(', ');
}

const at = spot => `${Math.floor(spot.x)}, ${Math.floor(spot.y)}, ${Math.floor(spot.z)}`;

/**
 * Turns a told place into a seen one and says so in a sentence. The sentence states what was seen and
 * carries no instruction, as change notes do.
 * @returns {{place: object, joined: number|null, beside: string|null, text: string}|null}
 */
export function confirm(memory, told, spot) {
    const result = memory.places.confirmTold(told.id, spot);
    if (!result) return null;
    const teller = told.told?.by ? `, which ${told.told.by} told you of,` : ', which you were told of,';
    let text = `Seen "${told.name}"${teller} at ${at(spot)}.`;
    if (result.joined !== null) {
        const what = contents(memory, result.place);
        text += what ? ` It is the site where you saw ${what}.` : ' It is a site you had found.';
    } else if (result.beside) text += ` It is beside "${result.beside}".`;
    return { ...result, text };
}

/**
 * After a look-around: has the bot now seen any told place near it? Each one seen becomes a place like
 * any other and gets a note, so the model hears of it once, in passing.
 *
 * Only places within `reach` are checked (the recorder looks this far), and a spot without a height only
 * within `flatReach` across the ground, so a column glimpsed at the edge of sight doesn't count as having
 * seen the place. Its column is searched from well above the bot to well below.
 * @param {object} memory - from openMemory
 * @param {{x:number, y:number, z:number}} here - where the bot is
 * @returns {object[]} what `confirm` returned, for each place seen
 */
export function checkTold(memory, here, { reach = 24, flatReach = 16 } = {}) {
    const seen = [];
    for (const told of memory.places.toldNear?.(here, { maxDistance: reach }) ?? []) {
        const known = told.spot.y !== null;
        if (!known && Math.hypot(told.spot.x - here.x, told.spot.z - here.z) > flatReach) continue;
        const spot = seenSpot(memory.cells, told.spot, known ? {} : { top: here.y + 32, bottom: here.y - 64 });
        if (!spot) continue;
        const result = confirm(memory, told, spot);
        if (!result) continue;
        memory.changes.note?.(result.text);
        seen.push(result);
    }
    return seen;
}
