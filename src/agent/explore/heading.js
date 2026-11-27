// SPDX-License-Identifier: CC0-1.0
// Which way to explore: the heading the bot keeps, and the ways round when that one is blocked.
//
// A person exploring picks a direction and keeps it, so the walk goes somewhere instead of round in circles.
// Told "go east", they go east, and round a lake or a cliff on the way, never back west. Exploring on their
// own, they go on the way they were going when they last stopped; or, starting afresh, towards the land they
// have not seen yet. That is all this file decides. It is plain arithmetic on angles and positions, handed
// whatever it needs to know, so its tests need no game.
//
// Angles are on the ground plane, as Math.atan2(dz, dx): east (+x) is 0, south (+z) a quarter turn, west a
// half, north minus a quarter. They are not the bot's yaw, which counts the other way from another start.

const EIGHTH = Math.PI / 4;
const NAMES = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
// Exact, so that "north" walks straight north: wrapping 6 eighths round lands a hair to the west of it.
const ANGLES = [0, EIGHTH, 2 * EIGHTH, 3 * EIGHTH, Math.PI, -3 * EIGHTH, -2 * EIGHTH, -EIGHTH];

// Turns tried, in eighths, when the way ahead is blocked: straight on, then a little to either side, then more.
// Told a direction, the bot never turns back past a quarter: that would be walking the other way.
const FREE_TURNS = [0, 1, -1, 2, -2, 3, -3];
const BEARING_TURNS = [0, 1, -1, 2, -2];

/** The way to keep exploring, for "on" (and the words a model might use for it). */
export const ON = 'on';
const ON_WORDS = new Set(['on', 'any', 'anywhere', 'same', 'onward', 'onwards', 'ahead', 'forward', 'continue', '']);
const SHORT = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'north-east', nw: 'north-west', se: 'south-east', sw: 'south-west' };

/** An angle brought into -π..π. */
export function wrap(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** How far apart two angles are, 0..π. */
export function turnBetween(a, b) {
    return Math.abs(wrap(b - a));
}

/**
 * Reads a direction the way a player says it: "east", "North-East", "north east", "northeast", "NE".
 * @param {string} text
 * @returns {number|'on'|null} the angle, ON for "keep going", or null when it isn't a direction
 */
export function parseDirection(text) {
    const word = String(text ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ON_WORDS.has(word)) return ON;
    const name = SHORT[word] ?? word.replace(/^(north|south)-?(east|west)$/, '$1-$2');
    const index = NAMES.indexOf(name);
    return index === -1 ? null : ANGLES[index];
}

/** The nearest of the eight compass words for an angle. */
export function compassName(angle) {
    return NAMES[sectorOf(angle)];
}

/** Which eighth of the circle an angle is in, 0 (east) to 7 (north-east). */
export function sectorOf(angle) {
    return ((Math.round(wrap(angle) / EIGHTH) % 8) + 8) % 8;
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * How much of the ground along a heading the bot has never looked over, from 0 (all seen) to 1 (all new).
 * Asks only the bot's own record of what it has looked at (world memory's `lookedAt`), at three points one
 * to two legs out, in the cube at the bot's level and the ones above and below it.
 * @param {(cx: number, cy: number, cz: number) => number} lookedAt - when that 16-block cube was last looked
 *   over, 0 for never
 * @param {{x:number,y:number,z:number}} here
 * @param {number} angle
 * @param {number} leg - how long one leg is, in blocks
 */
export function newGroundAlong(lookedAt, here, angle, leg) {
    const samples = [1, 1.5, 2];
    const cy = Math.floor(here.y) >> 4;
    let fresh = 0;
    for (const k of samples) {
        const cx = Math.floor(here.x + Math.cos(angle) * leg * k) >> 4;
        const cz = Math.floor(here.z + Math.sin(angle) * leg * k) >> 4;
        if (![cy - 1, cy, cy + 1].some(c => lookedAt(cx, c, cz) > 0)) fresh++;
    }
    return fresh / samples.length;
}

/**
 * The heading to set out on.
 * @param {object} options
 * @param {number|'on'} options.direction - an angle the bot was told, or ON
 * @param {{x:number,y:number,z:number}} options.here - where the bot is
 * @param {{origin:{x:number,z:number}, end:{x:number,z:number}, heading:number, bearing:boolean}|null} options.last -
 *   how the last exploring ended, if there was one
 * @param {number} options.leg - how long one leg is
 * @param {((angle: number) => number|null)} [options.newGround] - how new the ground along a heading is (see
 *   newGroundAlong), or null when the bot keeps no record
 * @param {() => number} [options.random]
 * @returns {{heading: number, bearing: boolean, origin: {x:number,z:number}, resumed: boolean}} `bearing` is
 *   true when the heading was given and is to be kept; `origin` is where this stretch of exploring began
 */
export function startHeading({ direction, here, last = null, leg, newGround = () => null, random = Math.random }) {
    // A call that starts about where the last one ended carries on from it: short calls add up to one walk.
    const carriesOn = Boolean(last) && flat(last.end, here) <= 2 * leg;
    if (direction !== ON) {
        const same = carriesOn && last.bearing && turnBetween(last.heading, direction) < 1e-6;
        return { heading: direction, bearing: true, origin: same ? last.origin : { x: here.x, z: here.z }, resumed: same };
    }
    if (carriesOn) return { heading: last.heading, bearing: false, origin: last.origin, resumed: true };

    // Starting afresh: towards the most land not yet seen, with a small cost for turning from the old heading
    // so that two ways about as new as each other keep the walk going the way it went. With no record of what
    // was seen, the old heading, or any.
    const candidates = [...ANGLES];
    if (last) candidates.push(last.heading);
    let best = null;
    for (const angle of candidates) {
        const fresh = newGround(angle);
        if (fresh === null || fresh === undefined) continue;
        const score = fresh - (last ? 0.15 * turnBetween(last.heading, angle) / Math.PI : 0);
        if (!best || score > best.score + 1e-9) best = { angle, score };
    }
    const heading = best?.angle ?? last?.heading ?? wrap(random() * 2 * Math.PI);
    return { heading, bearing: false, origin: { x: here.x, z: here.z }, resumed: false };
}

/**
 * The ways to try for the next leg, best first: straight on, then turning further and further to either
 * side. Of two turns the same size, the one with more new ground goes first; a way blocked near here is
 * left out.
 * @param {object} options
 * @param {number} options.heading
 * @param {boolean} options.bearing - told a direction: never turn back past a quarter
 * @param {{x:number,z:number}} options.here
 * @param {{sector:number, at:{x:number,z:number}, reach?:number}[]} [options.blocked] - ways found blocked, and
 *   where from; `reach`, when given, is how far round that spot the way counts as blocked
 * @param {number} [options.blockedReach] - a way blocked from within this many blocks is blocked from here too
 * @param {(angle: number) => number|null} [options.newGround]
 * @returns {number[]} angles
 */
export function legOrder({ heading, bearing, here, blocked = [], blockedReach = 24, newGround = () => null }) {
    const shut = new Set(blocked.filter(b => flat(b.at, here) <= (b.reach ?? blockedReach)).map(b => b.sector));
    const turns = bearing ? BEARING_TURNS : FREE_TURNS;
    const ways = turns.map(turn => ({ turn, angle: wrap(heading + turn * EIGHTH) }))
        .filter(way => !shut.has(sectorOf(way.angle)));
    const freshOf = angle => newGround(angle) ?? 0;
    // Stable: same-sized turns are reordered only when one side leads to more new ground.
    return ways.map((way, i) => ({ ...way, i, fresh: freshOf(way.angle) }))
        .sort((a, b) => Math.abs(a.turn) - Math.abs(b.turn) || b.fresh - a.fresh || a.i - b.i)
        .map(way => way.angle);
}
