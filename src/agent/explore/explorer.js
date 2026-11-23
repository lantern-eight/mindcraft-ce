// SPDX-License-Identifier: CC0-1.0
// Exploring: walking leg after leg into new ground on a kept heading, and stopping when the thing looked for
// comes into view.
//
// A person exploring walks a stretch, stops, looks round, and goes on. When the way ahead turns out to be
// water or a cliff, they try a little to one side, then more, and take up their heading again once past it.
// When they see what they came for, they stop. This file is that loop and nothing else: how the bot walks a
// leg, looks round and recognises the thing are handed to it as "legs" (install.js has the real ones), so
// its tests need no game, and it never reads the world itself.
import { compassName, legOrder, sectorOf, startHeading } from './heading.js';

export const LEG = 32;           // blocks per leg: a stretch walked before stopping to look round
const MIN_LEG = 8;               // the last leg is cut to what is left, but not shorter than this
const GOT_THROUGH = 1 / 4;       // a leg that gets this share of its length along its heading got through

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const spot = p => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

/** "12 blocks north-east", as a player says it. */
export function whereFrom(here, to) {
    const distance = Math.round(Math.hypot(to.x - here.x, to.y - here.y, to.z - here.z));
    if (flat(here, to) < 1.5) return to.y > here.y ? `${distance} blocks above` : `${distance} blocks below`;
    return `${distance} blocks ${compassName(Math.atan2(to.z - here.z, to.x - here.x))}`;
}

/**
 * Explores. Resolves with what happened, in words for the model and as data.
 * @param {object} options
 * @param {object} options.legs - how the bot moves and looks:
 *   `position()` where it stands; `interrupted()` whether it was told to stop;
 *   `walk(point)` walk towards a point on its level, resolving to 'arrived', 'stalled', 'water' (it found
 *   itself swimming and turned back), 'detour' (the way there grew too long), 'no_path' or 'interrupted';
 *   `lookAround()` look every way if it should; `newGround(angle)` how much of the ground that way it has
 *   never looked over (0..1), or null when it keeps no record;
 *   with `targets`: `find()` the nearest one in view or remembered close by, {name,x,y,z} or null, and
 *   `recall(maxDistance)` the nearest one remembered farther off, or null
 * @param {number|'on'} options.direction - from parseDirection
 * @param {number} options.distance - how far from where it starts to go, in blocks
 * @param {string[]|null} [options.targets] - names of what to look for, or null just to explore
 * @param {object|null} [options.last] - the `trail` an earlier call returned, so a walk carries on
 * @param {number} [options.leg]
 * @param {() => number} [options.random]
 * @returns {Promise<{status: 'explored'|'found'|'known'|'blocked'|'interrupted', text: string,
 *   trail: object|null, found?: object}>}
 */
export async function explore({ legs, direction, distance, targets = null, last = null, leg = LEG, random = Math.random }) {
    const start = legs.position();
    const looking = targets?.length ? targets.join(' or ') : null;
    const newGround = angle => legs.newGround?.(angle) ?? null;

    // Already in view, or remembered: no need to go anywhere.
    if (looking) {
        const hit = legs.find();
        if (hit) return { status: 'found', found: hit, trail: last,
            text: `${hit.name} is ${whereFrom(start, hit)}, at ${spot(hit)}. No need to explore for it.` };
        const far = legs.recall?.(distance);
        if (far) return { status: 'known', found: far, trail: last,
            text: `You remember ${far.name} ${whereFrom(start, far)}, at ${spot(far)}. Go there, or explore another way to look for more.` };
    }

    const plan = startHeading({ direction, here: start, last, leg, newGround, random });
    const { bearing, origin } = plan;
    let heading = plan.heading;
    const blocked = [];
    const turnedFrom = new Map(); // compass word -> 'water' or 'no way'
    let tries = 0;
    const maxTries = Math.ceil(distance / leg) * 3 + 4;

    const trailNow = () => ({ origin, end: { x: legs.position().x, z: legs.position().z }, heading, bearing });
    const finish = (status, text, extra = {}) => ({ status, text, trail: trailNow(), ...extra });
    const travelled = () => flat(start, legs.position());
    const turnsText = () => {
        if (!turnedFrom.size) return '';
        const water = [...turnedFrom].filter(([, why]) => why === 'water').map(([way]) => way);
        const other = [...turnedFrom].filter(([, why]) => why !== 'water').map(([way]) => way);
        const parts = [];
        if (water.length) parts.push(`water to the ${water.join(', ')}`);
        // Walled in on most sides, a list of every way says less than a count does.
        if (other.length > 3) parts.push(`no way through ${other.length} ways`);
        else if (other.length) parts.push(`no way through to the ${other.join(', ')}`);
        return ` Turned aside for ${parts.join(' and ')}.`;
    };
    const summary = () => {
        const here = legs.position();
        const gone = Math.round(travelled());
        const way = gone >= 2 ? ` ${compassName(Math.atan2(here.z - start.z, here.x - start.x))}` : '';
        return `Explored ${gone} blocks${way}, heading ${compassName(heading)}; now at ${spot(here)}.${turnsText()}`;
    };

    while (travelled() < distance - 2) {
        if (legs.interrupted()) return finish('interrupted', 'Exploring stopped.');
        if (++tries > maxTries) break;
        const here = legs.position();
        const ways = legOrder({ heading, bearing, here, blocked, newGround });
        if (!ways.length) {
            return finish('blocked', `Could not go on from ${spot(here)}: every way${bearing ? ` towards the ${compassName(heading)}` : ''} is blocked.`
                + `${turnsText()} Explored ${Math.round(travelled())} blocks.${looking ? ` No ${looking} seen.` : ''}`);
        }
        const angle = ways[0];
        const length = Math.max(MIN_LEG, Math.min(leg, distance - travelled() + 4));
        const target = { x: here.x + Math.cos(angle) * length, y: here.y, z: here.z + Math.sin(angle) * length };
        const outcome = await legs.walk(target);
        if (legs.interrupted() || outcome === 'interrupted') return finish('interrupted', 'Exploring stopped.');

        const now = legs.position();
        const along = (now.x - here.x) * Math.cos(angle) + (now.z - here.z) * Math.sin(angle);
        if (outcome !== 'water' && along >= length * GOT_THROUGH) {
            // Exploring freely, a turn that got through becomes the heading. On a bearing, the bearing stays,
            // and the next leg tries it again from the far side of whatever was in the way.
            if (!bearing) heading = angle;
        } else {
            blocked.push({ sector: sectorOf(angle), at: { x: now.x, z: now.z } });
            const way = compassName(angle);
            if (turnedFrom.get(way) !== 'water') turnedFrom.set(way, outcome === 'water' ? 'water' : 'no way');
        }

        // Stop and look round, as a person does after a stretch, then check for what was looked for.
        await legs.lookAround();
        if (legs.interrupted()) return finish('interrupted', 'Exploring stopped.');
        if (looking) {
            const hit = legs.find();
            if (hit) return finish('found', `Found ${hit.name} ${whereFrom(legs.position(), hit)}, at ${spot(hit)}, after exploring `
                + `${Math.round(travelled())} blocks.${turnsText()}`, { found: hit });
        }
    }
    return finish('explored', `${summary()}${looking ? ` No ${looking} seen yet: explore on to look further.` : ''}`);
}
