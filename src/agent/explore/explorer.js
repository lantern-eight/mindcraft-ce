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
    const blocks = `${distance} ${distance === 1 ? 'block' : 'blocks'}`;
    if (flat(here, to) < 1.5) return to.y > here.y ? `${blocks} above` : `${blocks} below`;
    return `${blocks} ${compassName(Math.atan2(to.z - here.z, to.x - here.x))}`;
}

/**
 * Explores. Resolves with what happened, in words for the model and as data.
 * @param {object} options
 * @param {object} options.legs - how the bot moves and looks:
 *   `position()` where it stands; `interrupted()` whether it was told to stop;
 *   `walk(point)` walk towards a point on its level, resolving to 'arrived', 'stalled', 'water' (it found
 *   itself swimming and turned back), 'detour' (the way there grew too long), 'no_path', 'unseen' (no way
 *   that way it can see from here, as in a cave; it didn't set out) or 'interrupted';
 *   `lookAround()` look every way if it should; `settle()` (optional) end on dry ground; `newGround(angle)` how much of the ground that way it has
 *   never looked over (0..1), or null when it keeps no record;
 *   with `targets`: `find()` the nearest one in view or remembered close by, {name,x,y,z} or null, and
 *   `recall(maxDistance)` the nearest one remembered farther off, or null;
 *   optionally `knownHazard(point)` what the bot remembers at a point on a leg that it would not walk into
 *   ('water', 'lava', 'drop') or null, and `kinds()` the kinds of ground worth naming that are in view now
 * @param {number|'on'} options.direction - from parseDirection
 * @param {number} options.distance - how far from where it starts to go, in blocks
 * @param {string[]|null} [options.targets] - names of what to look for, or null just to explore
 * @param {object|null} [options.last] - the `trail` an earlier call returned, so a walk carries on
 * @param {number} [options.leg]
 * @param {() => number} [options.random]
 * @returns {Promise<{status: 'explored'|'found'|'known'|'blocked'|'interrupted', text: string,
 *   trail: object|null, found?: object, newKinds?: string[]}>} `newKinds` are the kinds of ground first seen on
 *   the way: in view after a stretch, and not in view or remembered where the walk began
 */
export async function explore(options) {
    const result = await exploreLegs(options);
    // However it ended, the bot isn't left treading water: a walk that stops in a lake swims back to the shore.
    if (result.status !== 'interrupted' && options.legs.settle) await options.legs.settle();
    return result;
}

async function exploreLegs({ legs, direction, distance, targets = null, last = null, leg = LEG, random = Math.random }) {
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
    const turnedFrom = new Map(); // compass word -> 'water', 'lava', 'drop' or 'no way'
    let tries = 0;
    const maxTries = Math.ceil(distance / leg) * 3 + 4;

    // The kinds of ground in view or remembered where the walk begins, so that what turns up on the way can be
    // named: "came across: sand, birch_log" tells the model what the walk found, not only where it ended.
    const kindsNow = () => legs.kinds?.() ?? [];
    const before = new Set(kindsNow());
    const newKinds = new Set();

    const trailNow = () => ({ origin, end: { x: legs.position().x, z: legs.position().z }, heading, bearing });
    const kindsText = () => (newKinds.size ? ` Came across: ${[...newKinds].slice(0, 8).join(', ')}.` : '');
    const finish = (status, text, extra = {}) => ({ status, text: text + kindsText(), trail: trailNow(), newKinds: [...newKinds], ...extra });
    const travelled = () => flat(start, legs.position());
    // A way turned from for something it is, rather than for finding no way through, says what it was.
    const turnFrom = (way, why) => { if (!turnedFrom.has(way) || turnedFrom.get(way) === 'no way') turnedFrom.set(way, why); };
    const turnsText = () => {
        if (!turnedFrom.size) return '';
        const waysFor = why => [...turnedFrom].filter(([, w]) => w === why).map(([way]) => way);
        const parts = [];
        for (const [why, words] of [['water', 'water'], ['lava', 'lava'], ['drop', 'a drop']]) {
            const ways = waysFor(why);
            if (ways.length) parts.push(`${words} to the ${ways.join(', ')}`);
        }
        const other = waysFor('no way');
        // Walled in on most sides, a list of every way says less than a count does.
        if (other.length > 3) parts.push(`no way through ${other.length} ways`);
        else if (other.length) parts.push(`no way through to the ${other.join(', ')}`);
        return ` Turned aside for ${parts.join(' and ')}.`;
    };
    const pointAt = (here, angle, length) => ({ x: here.x + Math.cos(angle) * length, y: here.y, z: here.z + Math.sin(angle) * length });

    // What the bot remembers on the far half of a leg that it would not walk into, or null. Asked at a few
    // points, not only at the end: memory reaches about as far as a look round does, so a lake across the way
    // is often remembered at its near shore and not at all at the leg's end.
    const hazardAlong = (here, angle, length) => {
        for (const share of [0.5, 0.75, 1]) {
            const hazard = legs.knownHazard(pointAt(here, angle, length * share));
            if (hazard) return hazard;
        }
        return null;
    };
    // The way for the next leg: the first of the ways in order that the bot doesn't remember leading into
    // water, lava or a drop. A person who saw a lake from the hill doesn't walk down to its shore to find out.
    // A way that is bad farther on may still do at half the length. When memory says every way is bad, the
    // first is walked anyway: memory can be out of date, and the walk itself turns back from what is there.
    const chooseLeg = (here, ways, length) => {
        if (!legs.knownHazard) return { angle: ways[0], length, steered: [] };
        const steered = [];
        for (const angle of ways) {
            const hazard = hazardAlong(here, angle, length);
            if (!hazard) return { angle, length, steered };
            const half = length / 2;
            if (half >= MIN_LEG && !hazardAlong(here, angle, half)) return { angle, length: half, steered };
            steered.push({ angle, hazard });
        }
        return { angle: ways[0], length, steered: [] };
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
        const { angle, length, steered } = chooseLeg(here, ways, Math.max(MIN_LEG, Math.min(leg, distance - travelled() + 4)));
        for (const way of steered) {
            blocked.push({ sector: sectorOf(way.angle), at: { x: here.x, z: here.z } });
            turnFrom(compassName(way.angle), way.hazard);
        }
        const outcome = await legs.walk(pointAt(here, angle, length));
        if (legs.interrupted() || outcome === 'interrupted') return finish('interrupted', 'Exploring stopped.');
        // A way the bot can see no way along costs no walking, so it costs no try: it is shut from here (see
        // below), and once every way is shut the walk ends as blocked.
        if (outcome === 'unseen') tries--;

        const now = legs.position();
        const along = (now.x - here.x) * Math.cos(angle) + (now.z - here.z) * Math.sin(angle);
        // Arriving counts however short the leg turned out: underground a leg ends where the passage the bot
        // can see ends, which may be just round the next corner.
        if (outcome === 'arrived' || (outcome !== 'water' && along >= length * GOT_THROUGH)) {
            // Exploring freely, a turn that got through becomes the heading. On a bearing, the bearing stays,
            // and the next leg tries it again from the far side of whatever was in the way.
            if (!bearing) heading = angle;
        } else {
            // A way the bot can't see on from here is blocked from here only: a few steps on, round a corner,
            // it may open up. A way walked and found blocked stays blocked for a while round about.
            blocked.push({ sector: sectorOf(angle), at: { x: now.x, z: now.z }, ...(outcome === 'unseen' ? { reach: 2 } : {}) });
            turnFrom(compassName(angle), outcome === 'water' ? 'water' : 'no way');
        }

        // Stop and look round, as a person does after a stretch, then check for what was looked for.
        await legs.lookAround();
        if (legs.interrupted()) return finish('interrupted', 'Exploring stopped.');
        for (const kind of kindsNow()) if (!before.has(kind)) newKinds.add(kind);
        if (looking) {
            const hit = legs.find();
            if (hit) return finish('found', `Found ${hit.name} ${whereFrom(legs.position(), hit)}, at ${spot(hit)}, after exploring `
                + `${Math.round(travelled())} blocks.${turnsText()}`, { found: hit });
        }
    }
    return finish('explored', `${summary()}${looking ? ` No ${looking} seen yet: explore on to look further.` : ''}`);
}
