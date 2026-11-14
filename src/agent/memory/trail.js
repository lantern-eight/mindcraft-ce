// SPDX-License-Identifier: CC0-1.0
// The trail: where this bot has walked, kept as a graph it can find its way back along.
//
// A person who walked into a cave remembers the way out as a string of spots: the entrance, the turn
// at the lava, the ladder. The trail is that. As the bot moves it drops a "crumb" every few blocks and
// links each crumb to the one before. Where a walk comes close to an older crumb, the old one is reused,
// and that is what turns separate walks into one connected map.
//
// Why it matters: the pathfinder plans over blocks, and a long trip (down a winding cave, through two
// doors) is more than it can plan in one go, so today it gives up and digs in a straight line. A route
// over crumbs is a few hundred steps at most and is ground the bot knows it can walk, because it did.
//
// This is a plain store. It never touches the game: it is handed positions, a clock, and one question it
// can ask ("could I walk straight from here to there?"). Everything in it is the bot's own past
// positions, which a player knows too, so there is nothing here to keep fair.
//
// Words used below:
//   crumb    a spot the bot stood on
//   link     a way it moved from one crumb to another, with how long that took. Links are kept per
//            direction, so a fall it can't climb back up is simply a link with no return link
//   stretch  one unbroken walk. A teleport or a death ends it, and no link joins the two sides
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from './files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'trail.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const GRID = 4;       // crumbs are indexed in cells this wide, so "what is near me" looks at a few cells
const CLIMB = 1.25;   // the highest step a player can jump back up. A fall beyond this is one-way
const STEP = 1.5;     // crumbs more than this far above or below are on another level
const FASTEST = 10;   // blocks a second. No link may claim to be quicker; it keeps route search honest
const KINDS = new Set(['walk', 'door', 'ladder', 'water']);

const round = v => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const NONE = [];

/**
 * @param {object} options
 * @param {string} options.scope - `host:port/world/dimension`; one trail per scope
 * @param {() => number} [options.now]
 * @param {(a, b) => boolean} [options.canWalkStraight] - could the bot walk in a straight line between
 *   these two spots? Asked before reusing an old crumb, so that two tunnels either side of a wall never
 *   merge into one. Without it everything close enough merges, which is right only in the open.
 * @param {number} [options.spacing] - blocks between crumbs
 * @param {number} [options.joinRadius] - an older crumb this close (and walkable to) is reused. It has
 *   to be more than half the spacing, or a path crossing an old one midway between two crumbs is missed.
 * @param {number} [options.jumpLimit] - moving farther than this between two visits is a teleport
 * @param {number} [options.blockedForMs] - how long a blocked link is avoided before it is tried again
 */
export function createTrail({ scope, now = Date.now, canWalkStraight = () => true, spacing = 4, joinRadius = 2.5,
    jumpLimit = 10, blockedForMs = DAY_MS } = {}) {
    if (!scope) throw new Error('A trail needs a scope (server/world/dimension)');
    const crumbs = new Map(); // id -> crumb
    const grid = new Map();   // "gx,gy,gz" -> the crumbs in that cell
    let nextId = 1;
    let dirty = false;        // changed since the last save

    // The walk in progress.
    let current = null;       // the crumb the bot is at, or passed last
    let lastPos = null;       // where the previous visit was
    let lastSupported = null; // the last spot with something underfoot (ground, a ladder, water)
    let lastKind = 'walk';
    let lastVisitAt = 0;
    let travelMs = 0;         // time spent moving since `current` became current; standing still adds none
    let checkedAt = null;     // where the bot last looked for an older crumb to join

    const gridKey = (x, y, z) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)},${Math.floor(z / GRID)}`;

    function index(crumb) {
        const key = gridKey(crumb.x, crumb.y, crumb.z);
        const cell = grid.get(key);
        if (cell) cell.push(crumb); else grid.set(key, [crumb]);
    }

    function addCrumb(p, kind, t) {
        const crumb = { id: nextId++, x: round(p.x), y: round(p.y), z: round(p.z), kind, firstVisit: t, lastVisit: t, visits: 0, links: [] };
        crumbs.set(crumb.id, crumb);
        index(crumb);
        return crumb;
    }

    /** Calls `visit` for every crumb in the grid cells a box around `p` touches. */
    function eachNear(p, radius, visit) {
        const lo = v => Math.floor((v - radius) / GRID), hi = v => Math.floor((v + radius) / GRID);
        for (let gx = lo(p.x); gx <= hi(p.x); gx++)
            for (let gy = lo(p.y); gy <= hi(p.y); gy++)
                for (let gz = lo(p.z); gz <= hi(p.z); gz++)
                    for (const crumb of grid.get(`${gx},${gy},${gz}`) ?? NONE) visit(crumb);
    }

    /** The nearest older crumb the bot could count as "here": close, on this level, and walkable to. */
    function findJoin(p, exclude) {
        let best = null, bestDistance = Infinity;
        eachNear(p, joinRadius, crumb => {
            if (crumb === exclude || Math.abs(crumb.y - p.y) >= STEP) return;
            const d = flat(p, crumb);
            if (d > joinRadius || d >= bestDistance || !canWalkStraight(p, crumb)) return;
            best = crumb; bestDistance = d;
        });
        return best;
    }

    const linkTo = (from, to) => from.links.find(link => link.to === to);

    function newLink(from, to, cost) {
        const link = { to, cost, uses: 0, lastUsed: 0, blockedAt: null };
        from.links.push(link);
        return link;
    }

    // The bot just moved from `a` to `b`. That proves the way is open, so any "blocked" mark is cleared.
    // The return link is added too unless this was a fall: what was walked one way can be walked back.
    function connect(a, b, seconds, t, oneWay) {
        const cost = Math.max(seconds, dist(a, b) / FASTEST);
        const forward = linkTo(a, b) ?? newLink(a, b, cost);
        forward.cost = Math.min(forward.cost, cost); // the best time seen: a detour once shouldn't count forever
        forward.uses++;
        forward.lastUsed = t;
        forward.blockedAt = null;
        if (oneWay) return;
        const back = linkTo(b, a) ?? newLink(b, a, cost);
        back.cost = Math.min(back.cost, cost);
        back.blockedAt = null;
    }

    function arrive(crumb, t, { oneWay = false } = {}) {
        if (current && current !== crumb) connect(current, crumb, travelMs / 1000, t, oneWay);
        current = crumb;
        crumb.lastVisit = t;
        crumb.visits++;
        travelMs = 0;
        dirty = true;
    }

    const isBlocked = (link, t) => link.blockedAt !== null && t - link.blockedAt < blockedForMs;
    const snapshot = crumb => ({ id: crumb.id, x: crumb.x, y: crumb.y, z: crumb.z, kind: crumb.kind });

    const trail = {
        scope,

        get size() { return crumbs.size; },
        get dirty() { return dirty; },
        /** The id of the crumb the bot is at or passed last, or null at the start of a stretch. */
        get current() { return current ? current.id : null; },

        /**
         * The bot is at `pos` now. Call this as it moves; it is cheap, and most calls change nothing.
         * @param {{x:number,y:number,z:number}} pos - the bot's feet
         * @param {object} [how]
         * @param {'walk'|'door'|'ladder'|'water'} [how.kind] - what the bot is standing in
         * @param {boolean} [how.supported] - false while it is in the air (jumping or falling)
         * @returns {number|null} the id of the crumb it is at
         */
        visit(pos, { kind = 'walk', supported = true } = {}) {
            if (!KINDS.has(kind)) throw new Error(`Unknown crumb kind: ${kind}`);
            const t = now();
            const p = { x: pos.x, y: pos.y, z: pos.z };
            if (lastPos && dist(p, lastPos) > jumpLimit) trail.breakStretch(); // a teleport: nothing was walked
            if (lastPos && dist(p, lastPos) > 0.01) travelMs += Math.min(Math.max(t - lastVisitAt, 0), 1000);
            lastPos = p;
            lastVisitAt = t;
            if (!supported) return trail.current; // in the air there is no spot to remember

            const tookOff = lastSupported;
            const previousKind = lastKind;
            lastSupported = p;
            lastKind = kind;

            if (!current) {
                // The start of a stretch. If the bot is standing on ground it knows, the stretch joins it.
                arrive(findJoin(p, null) ?? addCrumb(p, kind, t), t);
                checkedAt = p;
                return current.id;
            }

            if (tookOff && tookOff.y - p.y > CLIMB) {
                // A fall too high to jump back up. Mark the edge it fell from and the spot it landed on,
                // and join them one way only, so a route never tries to go up it.
                if (dist(tookOff, current) > 1) arrive(findJoin(tookOff, current) ?? addCrumb(tookOff, previousKind, t), t);
                arrive(findJoin(p, current) ?? addCrumb(p, kind, t), t, { oneWay: true });
                checkedAt = p;
                return current.id;
            }

            const here = current;
            const d = dist(p, here);

            // Passing an older crumb joins it, even between drops. It only counts when the old crumb is
            // clearly nearer than the current one, so standing midway between two never flips back and forth.
            if (!checkedAt || dist(p, checkedAt) >= 0.5) {
                checkedAt = p;
                const other = findJoin(p, here);
                if (other && dist(p, other) + 0.5 < d) {
                    arrive(other, t);
                    return other.id;
                }
            }

            // Time for a crumb: far enough along, a level up or down, or a door, ladder or water begins or ends.
            const kindChanged = kind !== previousKind;
            if (d >= spacing || Math.abs(p.y - here.y) >= 2 || (kindChanged && d > 1)) {
                arrive(findJoin(p, here) ?? addCrumb(p, kind, t), t);
                checkedAt = p;
            } else if (kindChanged && kind !== 'walk' && here.kind === 'walk') {
                here.kind = kind; // the crumb turned out to be in a doorway or at the foot of a ladder
                dirty = true;
            }
            return current.id;
        },

        /** Ends the walk in progress (a death, a respawn, a forced move). The next visit starts a new one. */
        breakStretch() {
            current = null; lastPos = null; lastSupported = null; checkedAt = null;
            travelMs = 0;
            lastKind = 'walk';
        },

        /** One crumb with its links, as a copy. */
        get(id) {
            const crumb = crumbs.get(id);
            if (!crumb) return null;
            const t = now();
            return {
                ...snapshot(crumb), firstVisit: crumb.firstVisit, lastVisit: crumb.lastVisit, visits: crumb.visits,
                links: crumb.links.map(link => ({ to: link.to.id, seconds: link.cost, uses: link.uses, blocked: isBlocked(link, t) })),
            };
        },

        /**
         * The crumb nearest a point, or null when none is within reach.
         * @param {object} [options]
         * @param {number} [options.maxDistance]
         * @param {number} [options.levelWeight] - above 1 prefers crumbs at the same height: a crumb on
         *   the floor above is often a long walk away
         * @param {(crumb) => boolean} [options.filter]
         */
        nearest(pos, { maxDistance = 32, levelWeight = 1, filter = null } = {}) {
            let best = null, bestScore = Infinity;
            const consider = crumb => {
                if (dist(pos, crumb) > maxDistance) return;
                const score = Math.hypot(crumb.x - pos.x, (crumb.y - pos.y) * levelWeight, crumb.z - pos.z);
                if (score >= bestScore || (filter && !filter(snapshot(crumb)))) return;
                best = crumb; bestScore = score;
            };
            // Walk only the grid cells in range, unless that is more cells than there are crumbs.
            const cells = (2 * Math.ceil(maxDistance / GRID) + 1) ** 3;
            if (cells > crumbs.size) for (const crumb of crumbs.values()) consider(crumb);
            else eachNear(pos, maxDistance, consider);
            return best ? { ...snapshot(best), distance: dist(pos, best) } : null;
        },

        /**
         * The quickest known way from one crumb to another, or null when the trail doesn't join them.
         * Blocked links are left out until they have been blocked for `blockedForMs`.
         * @returns {{ids:number[], points:object[], seconds:number}|null}
         */
        route(fromId, toId, { useBlocked = false } = {}) {
            const start = crumbs.get(fromId), goal = crumbs.get(toId);
            if (!start || !goal) return null;
            const t = now();
            // A* search. The guess for what is left is the straight distance at the fastest speed any
            // link may claim, which never overestimates, so the first route to reach the goal is the best.
            const guess = crumb => dist(crumb, goal) / FASTEST;
            const cheapest = new Map([[start, 0]]);
            const cameFrom = new Map();
            const open = createHeap();
            open.push(guess(start), 0, start);
            while (open.size) {
                const { cost, item: crumb } = open.pop();
                if (cost > cheapest.get(crumb)) continue; // an older, worse entry for a crumb already settled
                if (crumb === goal) {
                    // Walk back from the goal and turn the list round at the end. Adding each step to
                    // the front instead would redo the whole list every time, which shows on a long route.
                    const way = [goal];
                    while (cameFrom.has(way.at(-1))) way.push(cameFrom.get(way.at(-1)));
                    way.reverse();
                    return { ids: way.map(c => c.id), points: way.map(snapshot), seconds: cost };
                }
                for (const link of crumb.links) {
                    if (!useBlocked && isBlocked(link, t)) continue;
                    const next = cost + link.cost;
                    if (next >= (cheapest.get(link.to) ?? Infinity)) continue;
                    cheapest.set(link.to, next);
                    cameFrom.set(link.to, crumb);
                    open.push(next + guess(link.to), next, link.to);
                }
            }
            return null;
        },

        /**
         * The way between two neighbouring crumbs turned out to be shut (a wall, a filled tunnel). Both
         * directions are marked. Routes avoid it for a while, then try it again: things get reopened.
         */
        markBlocked(aId, bId) {
            const a = crumbs.get(aId), b = crumbs.get(bId);
            if (!a || !b) return false;
            const t = now();
            let marked = false;
            for (const link of [linkTo(a, b), linkTo(b, a)]) {
                if (link) { link.blockedAt = t; marked = true; }
            }
            dirty ||= marked;
            return marked;
        },

        toJSON() {
            const links = [];
            for (const crumb of crumbs.values())
                for (const link of crumb.links)
                    links.push([crumb.id, link.to.id, Math.round(link.cost * 100) / 100, link.uses, link.lastUsed, link.blockedAt ?? 0]);
            return {
                version: FORMAT_VERSION, scope, savedAt: now(), nextId,
                crumbs: [...crumbs.values()].map(c => [c.id, c.x, c.y, c.z, c.kind, c.firstVisit, c.lastVisit, c.visits]),
                links,
            };
        },

        /** Writes the trail into its scope folder. */
        save(dir) {
            const file = path.join(dir, FILE_NAME);
            writeFileAtomic(file, JSON.stringify(trail.toJSON()));
            dirty = false;
            return file;
        },

        /** Internal: fills an empty trail from a saved file's data. */
        _restore(data) {
            for (const [id, x, y, z, kind, firstVisit, lastVisit, visits] of data.crumbs ?? []) {
                const crumb = { id, x, y, z, kind: KINDS.has(kind) ? kind : 'walk', firstVisit, lastVisit, visits, links: [] };
                crumbs.set(id, crumb);
                index(crumb);
                nextId = Math.max(nextId, id + 1);
            }
            for (const [fromId, toId, cost, uses, lastUsed, blockedAt] of data.links ?? []) {
                const from = crumbs.get(fromId), to = crumbs.get(toId);
                if (!from || !to || from === to) continue; // a link to a crumb that isn't there is dropped
                Object.assign(newLink(from, to, cost), { uses, lastUsed, blockedAt: blockedAt || null });
            }
            nextId = Math.max(nextId, data.nextId ?? 1);
        },
    };
    return trail;
}

/**
 * Loads the trail kept in a scope folder, or starts an empty one. The walk in progress is not saved: a
 * new session starts a new stretch, which joins the old trail as soon as the bot stands near a crumb.
 */
export function loadTrail(dir, options = {}) {
    const trail = createTrail(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
    });
    if (data) trail._restore(data);
    return trail;
}

// A small binary heap ordered by `priority`, for the route search. Entries carry the cost so far, so a
// stale entry for a crumb that has since been reached more cheaply can be recognised and skipped.
function createHeap() {
    const items = [];
    const swap = (i, j) => { const tmp = items[i]; items[i] = items[j]; items[j] = tmp; };
    return {
        get size() { return items.length; },
        push(priority, cost, item) {
            items.push({ priority, cost, item });
            let i = items.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (items[parent].priority <= items[i].priority) break;
                swap(i, parent);
                i = parent;
            }
        },
        pop() {
            const top = items[0];
            const last = items.pop();
            if (items.length) {
                items[0] = last;
                let i = 0;
                for (;;) {
                    const left = 2 * i + 1, right = left + 1;
                    let smallest = i;
                    if (left < items.length && items[left].priority < items[smallest].priority) smallest = left;
                    if (right < items.length && items[right].priority < items[smallest].priority) smallest = right;
                    if (smallest === i) break;
                    swap(i, smallest);
                    i = smallest;
                }
            }
            return top;
        },
    };
}
