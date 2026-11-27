// SPDX-License-Identifier: CC0-1.0
// The navigator: long trips follow the trail the bot has walked.
//
// The pathfinder plans over blocks. That works well for a short walk and badly for a long one: down a
// winding cave or round a hill it runs out of thinking time, and travel then falls back to digging in a
// straight line at the target. But the bot often knows a way already, because it walked it. The trail
// (trail.js) is that way, as a string of spots a few blocks apart.
//
// The navigator joins the two. It asks the trail for a route, then asks the pathfinder for one short
// hop at a time along it: to the farthest spot ahead it can reach without digging or placing anything.
// The pathfinder still does all the stepping, jumping, swimming and door-opening; the navigator only
// chooses where the next hop ends. Where the trail stops short of the target, ordinary travel takes
// over from there, and where the bot knows no way at all, travel works exactly as before.
//
// It is fair by construction: a route is made only of spots the bot itself has stood on.
//
// The deciding is kept apart from the walking. `createNavigator` works on the memory store and a small
// set of "legs" it is handed, so its tests need no game. `pathfinderLegs` is the real pair of legs.
import pf from 'mineflayer-pathfinder';
import { cancellable } from '../action_context.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const NOT_FOLLOWED = reason => ({ followed: false, reason });
const spot = p => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
// Blocks that fall: one across a way the bot walked most likely fell there, and a player would dig it out.
const FALLS = /^(gravel|sand|red_sand|suspicious_sand|suspicious_gravel|[a-z_]*concrete_powder)$/;
// How many times a trip re-plans round links that memory says are walled up, before it sets off anyway.
const WALL_CHECKS = 4;

/**
 * Reads a fixed spot out of a pathfinder goal, or null when the goal has none: following something that
 * moves, moving away from a spot, or a goal with no height. Those are left to ordinary travel.
 * @returns {{x:number,y:number,z:number,range:number}|null}
 */
export function targetOf(goal) {
    if (!goal || goal.entity || goal.goal || goal.goals) return null;
    const { x, y, z } = goal;
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x, y, z, range: Number.isFinite(goal.rangeSq) ? Math.sqrt(goal.rangeSq) : 0 };
}

/**
 * @param {object} options
 * @param {object} options.memory - the open memory: its `trail`, and its `things` and `cells` when it has them
 * @param {object} options.legs - how the bot moves:
 *   `position()` where it stands; `interrupted()` whether it was told to stop;
 *   `canWalkTo(point, budgetMs)` whether a walk there needs no digging or placing;
 *   `walkTo(point, within)` that walk, to within that many blocks (1 when left out); `pushThrough(point, budgetMs)` an ordinary walk there, which may dig,
 *   resolving to whether it got there
 * @param {(name: string) => boolean} [options.blocksWay] - is a remembered block of this name solid,
 *   so that it stands in the way? Without it, memory of walls is not consulted
 * @param {(name: string) => boolean} [options.isDoor] - is it a door or gate, which may be shut? Only used
 *   to name what blocks a way
 * @param {(cell: {x:number,y:number,z:number,name:string}) => ({why: string, text: string}|null)} [options.ownerOf] -
 *   is a remembered block someone's (good-neighbor rules, `refusal`)? A way blocked by someone's block is
 *   not dug past or round. Without it, every blocker is treated as one a player would dig out
 * @param {(point: object) => number} [options.priceAt] - what a spot costs a route to be in (place_costs.js),
 *   or none. A way that goes deeper into a priced place is left to ordinary travel, which goes round it
 * @param {number} [options.hopReach] - how far ahead one hop may end, in blocks. The pathfinder plans
 *   this far quickly and reliably
 * @param {number} [options.lookAhead] - how many spots ahead to look for a short cut
 * @param {number} [options.planMs] - thinking time allowed for one "can I walk there?"
 * @param {number} [options.startReach] - the bot must be this close to the trail to join it
 * @param {number} [options.arriveWithin] - a route that ends this close to the target ends "there"
 * @param {number} [options.minGain] - a route that ends short must bring the bot this much closer,
 * @param {number} [options.detourLimit] - and may be at most this many times longer than what it gains
 */
export function createNavigator({ memory, legs, blocksWay = null, isDoor = () => false, ownerOf = () => null, priceAt = null,
    hopReach = 20, lookAhead = 32, planMs = 200, startReach = 8, arriveWithin = 3, minGain = 8, detourLimit = 1.5, maxDetours = 3 } = {}) {
    const { trail } = memory;
    let busy = false;

    /** How long a route is, in blocks. */
    const lengthOf = points => points.slice(1).reduce((sum, point, i) => sum + dist(points[i], point), 0);

    // Does a route go deeper into a place the bot's routes pay to enter (a danger zone)? Then it isn't
    // followed: every hop would have to come back to the trail inside the place. Ordinary travel prices
    // those places and goes round them. Going down the price, out of one, is no reason to leave the trail.
    const RISE_ALLOWED = 1; // about a block's walk
    const climbs = points => {
        let rise = 0;
        for (let i = 1; i < points.length && rise <= RISE_ALLOWED; i++)
            rise += Math.max(0, priceAt(points[i]) - priceAt(points[i - 1]));
        return rise > RISE_ALLOWED;
    };

    /**
     * Does the bot remember a wall on the straight line from a spot to the target?
     *
     * A crumb two blocks from the target can be on the far side of a wall, and then it is no way there
     * at all. So can a crumb twenty blocks from it, in the tunnel next door. Memory knows: the bot saw
     * that wall as it walked past. The line is followed at foot and head height, a step up or down
     * allowed, the way the ground rises and falls. A cell the bot never saw counts as open, so this
     * only ever rules a spot out on what was really seen. The whole line is checked, up to `reach`:
     * a check of only the first few blocks misses a wall the line meets at a shallow angle.
     */
    function facesWall(from, target, reach = 64) {
        return Boolean(wallOnLine(from, target, { reach, skipTarget: true }));
    }

    /**
     * The first remembered block on the straight line from a spot to another that leaves no room to pass
     * (see facesWall), as {x, y, z, name}, or null. `skipTarget` leaves the target's own cell out: a target
     * may well be a block, such as a chest. `solid` says which remembered blocks stand in the way.
     */
    function wallOnLine(from, target, { reach = 64, skipTarget = false, solid = solidAt } = {}) {
        if (!blocksWay || !memory.cells) return null;
        const flat = Math.hypot(target.x - from.x, target.z - from.z);
        if (flat < 0.5) return null;
        const targetCell = `${Math.floor(target.x)},${Math.floor(target.z)}`;
        let level = Math.floor(from.y + 0.2);
        for (let walked = 0.5; walked <= Math.min(flat, reach); walked += 0.5) {
            const x = Math.floor(from.x + (target.x - from.x) * (walked / flat));
            const z = Math.floor(from.z + (target.z - from.z) * (walked / flat));
            if (skipTarget && `${x},${z}` === targetCell) break;
            const open = [level, level + 1, level - 1].find(y => !solid(x, y, z) && !solid(x, y + 1, z));
            if (open === undefined) {
                const y = solid(x, level, z) ? level : level + 1;
                return { x, y, z, name: memory.cells.read(x, y, z) };
            }
            level = open;
        }
        return null;
    }
    // A remembered block that stands in the way.
    function solidAt(x, y, z) {
        const name = memory.cells.read(x, y, z);
        return name != null && blocksWay(name);
    }
    // A remembered block in the way that the bot saw someone put up: it appeared where the bot had seen
    // something else (world memory's 'built' tag). Across a link the bot walked, that is a way walled up
    // since. Any other remembered block is no such sign: a straight line between two spots on the trail can
    // clip a corner the bot really walked round.
    const builtAt = (x, y, z) => solidAt(x, y, z) && memory.cells.tagOf?.(x, y, z) === 'built';

    // A door or gate on the straight line between two spots, as {x, y, z, name}, or null: when a hop fails
    // there and no wall is remembered, it is most likely shut.
    function doorOnLine(from, to) {
        if (!memory.cells) return null;
        const flat = Math.hypot(to.x - from.x, to.z - from.z);
        const level = Math.floor(from.y + 0.2);
        for (let walked = 0.5; walked <= flat; walked += 0.5) {
            const x = Math.floor(from.x + (to.x - from.x) * (walked / flat));
            const z = Math.floor(from.z + (to.z - from.z) * (walked / flat));
            for (const y of [level, level + 1]) {
                const name = memory.cells.read(x, y, z);
                if (name && isDoor(name)) return { x, y, z, name };
            }
        }
        return null;
    }

    /**
     * What blocks a link, in words for the model, and whether it is someone's. Only what the bot remembers
     * seeing is named: a blocker it never saw is "something I can't see from here".
     * @returns {{text: string, someones: boolean}}
     */
    function blockerOf(from, to) {
        // Something seen put up there first, then anything remembered in the way.
        const built = wallOnLine(from, to, { solid: builtAt });
        if (built) return { text: `${built.name} someone built`, someones: Boolean(ownerOf(built)) };
        const wall = wallOnLine(from, to);
        if (wall) {
            const owner = ownerOf(wall);
            if (owner?.why === 'area') return { text: `${wall.name} in a protected area`, someones: true };
            if (owner?.why === 'built') return { text: `${wall.name} someone built`, someones: true };
            if (owner) return { text: `${wall.name}, which isn't natural ground, so someone's`, someones: true };
            if (FALLS.test(wall.name)) return { text: `${wall.name} that fell in`, someones: false };
            return { text: wall.name, someones: false };
        }
        const door = doorOnLine(from, to);
        if (door) return { text: `a shut ${door.name}`, someones: false };
        return { text: `something I can't see from here`, someones: false };
    }

    /**
     * The first link on a route that memory says someone has walled up since the bot walked it, as an index
     * into `points`, or -1. Asked of memory alone, before setting off: no path search, nothing read from the
     * world. (The idea is akarkin1's dry scan of a route, which asked the pathfinder about every hop.)
     */
    function walledLink(points) {
        for (let i = 0; i + 1 < points.length; i++) {
            if (points[i].id == null || points[i + 1].id == null) continue;
            if (walledUp(points[i], points[i + 1])) return i;
        }
        return -1;
    }
    // A link is walled up when the straight line between its two spots is blocked by something seen built,
    // and so are both L-shaped ways between them (along x then z, and along z then x). Round a corner the
    // straight line clips the inside of the bend, but the bot walked one of the L-shaped ways; a wall built
    // across a corridor blocks all three.
    function walledUp(a, b) {
        const blocked = (from, to) => Boolean(wallOnLine(from, to, { reach: Infinity, solid: builtAt }));
        if (!blocked(a, b)) return false;
        const viaX = { x: b.x, y: a.y, z: a.z }, viaZ = { x: a.x, y: a.y, z: b.z };
        return (blocked(a, viaX) || blocked(viaX, b)) && (blocked(a, viaZ) || blocked(viaZ, b));
    }

    /**
     * Where a trip to `target` could end, best first: `arrives` when being there is as good as being
     * at the target, otherwise a spot that only gets the bot closer.
     */
    function endsFor(target) {
        // A chest seen through a gap from one tunnel may be nearer, as the crow flies, to a crumb in the
        // next tunnel over. The crumb it was seen from is the one known to lead to it.
        const thing = memory.things?.get(target.x, target.y, target.z);
        const seenFrom = thing?.from != null ? trail.get(thing.from) : null;
        if (seenFrom) return [{ crumb: seenFrom, arrives: true }];
        // Otherwise the nearest few crumbs, leaning towards the target's own level (the floor above is
        // close in a straight line and often a long walk), leaving out any that face a remembered wall.
        // Close by is looked at first because that is quick however long the trail has grown; the whole
        // trail is only searched when nothing near the target will do.
        const ends = [], tried = new Set();
        for (const [maxDistance, tries] of [[48, 4], [Infinity, 2]]) {
            for (let i = 0; i < tries; i++) {
                const crumb = trail.nearest(target, { maxDistance, levelWeight: 2, filter: c => !tried.has(c.id) });
                if (!crumb) break;
                tried.add(crumb.id);
                if (facesWall(crumb, target)) continue;
                ends.push({ crumb, arrives: dist(crumb, target) <= target.range + arriveWithin });
            }
            if (ends.length) break;
        }
        return ends;
    }

    /**
     * The route worth following from `here` towards `target`, or null when ordinary travel should do it.
     * @returns {{points: object[], end: object, seconds: number}|null}
     */
    function plan(here, target) {
        if (!trail.size || dist(here, target) <= target.range) return null;
        // Where to join. The crumb the bot is at is linked to the ground it just walked. After a
        // teleport or a respawn that crumb is new and linked to nothing, so the nearest older one is
        // tried as well.
        const starts = [];
        const current = trail.current != null ? trail.get(trail.current) : null;
        if (current && dist(here, current) <= startReach) starts.push(current);
        // Not one the bot remembers a wall between it and: the nearest crumb may be in the next tunnel over.
        const near = trail.nearest(here, { maxDistance: startReach, levelWeight: 2, filter: crumb => crumb.id !== current?.id && !facesWall(here, crumb, startReach) });
        if (near) starts.push(near);

        for (const { crumb: end, arrives } of endsFor(target)) {
            for (const start of starts) {
                if (start.id === end.id) break; // already standing where this route would end
                const route = trail.route(start.id, end.id);
                if (!route || route.points.length < 2) continue;
                if (!arrives) {
                    // A route that ends short is only worth it when it is a fairly direct way to get
                    // much closer. Otherwise the bot would walk a long way round to a spot from which
                    // ordinary travel still has most of the trip to do.
                    const gain = dist(here, target) - dist(end, target);
                    if (gain < minGain || lengthOf(route.points) > detourLimit * gain) continue;
                }
                if (priceAt && climbs(route.points)) continue;
                return { points: route.points, end, seconds: route.seconds };
            }
        }
        return null;
    }

    /**
     * Where the next hop could end, best first. `at` is the spot on the route the bot has reached, or
     * -1 before it has joined the route.
     */
    function candidates(points, at, pos, shortCuts) {
        const last = points.length - 1;
        // The farthest spot within a hop's length along the route. This one is almost always walkable:
        // it is ground the bot crossed.
        let stride = at + 1;
        let along = at < 0 ? dist(pos, points[0]) : dist(points[at], points[at + 1]);
        while (stride < last && along + dist(points[stride], points[stride + 1]) <= hopReach) {
            along += dist(points[stride], points[stride + 1]);
            stride++;
        }
        // A short cut: a spot farther along the route that is close in a straight line, where the route
        // doubles back or zigzags. Worth one try; when rock is in the way the stride is used instead.
        let shortCut = -1;
        if (shortCuts) {
            for (let j = Math.min(at + lookAhead, last); j > stride; j--) {
                if (dist(pos, points[j]) <= hopReach) { shortCut = j; break; }
            }
        }
        return { shortCut, order: [...new Set([shortCut, stride, at + 1])].filter(index => index > at) };
    }

    /** The farthest spot in (from, to] the bot is standing at, or `from` when it is at none of them. */
    function passed(points, from, to, pos) {
        for (let index = to; index > from; index--) if (dist(pos, points[index]) <= 2.5) return index;
        return from;
    }

    return {
        plan,

        /**
         * Walks the bot along the trail towards `target`, as far as the trail helps.
         * @param {{x:number,y:number,z:number,range?:number}} target
         * @param {object} [options]
         * @param {(text: string) => void} [options.say] - told what the model should hear: a blocked way, a detour
         * @returns {Promise<{followed: boolean, reached?: 'end'|'part', hops?: number, reason?: string,
         *   noDigging?: boolean}>} `followed` is false when nothing was walked. `noDigging` is true when a way
         *   was found blocked by someone's block: the rest of the trip, ordinary travel included, should dig
         *   nothing, or it would tunnel round their wall into what they built. Rejects only when the trip was
         *   interrupted.
         */
        async follow(target, { say = () => {} } = {}) {
            if (busy) return NOT_FOLLOWED('busy');
            const goal = { range: 0, ...target };
            let noDigging = false;
            // Once a way turns out to be blocked by someone's block, the rest of the trip digs nothing. Said
            // once, with what the player can do about it.
            const someones = what => {
                if (!what.someones || noDigging) return;
                noDigging = true;
                say('It is someone\'s, so I won\'t dig past or round it. Ask whoever built it, or go another way.');
            };
            const blockedNear = (from, to) => {
                trail.markBlocked(from.id, to.id);
                const what = blockerOf(from, to);
                say(`The way you walked before is blocked near ${spot(to)}: ${what.text}.`);
                someones(what);
            };
            // Before setting off, the route is checked against memory: a link someone has walled up since is
            // marked blocked and the route planned again, rather than found by walking up to the wall.
            let trip = plan(legs.position(), goal);
            for (let checks = 0; trip && checks < WALL_CHECKS; checks++) {
                const walled = walledLink(trip.points);
                if (walled < 0) break;
                blockedNear(trip.points[walled], trip.points[walled + 1]);
                trip = plan(legs.position(), goal);
            }
            if (!trip) return { ...NOT_FOLLOWED('no known way'), noDigging };
            busy = true;
            try {
                let points = trip.points;
                let at = -1, hops = 0, rest = 0, detours = 0;
                // Worth a word when it is more than a hop: the bot may set off away from the target.
                if (lengthOf(points) > hopReach) say('Following a way you have walked before.');

                while (at < points.length - 1) {
                    if (legs.interrupted()) throw new Error('Travel interrupted');
                    let moved = false;
                    const { shortCut, order } = candidates(points, at, legs.position(), rest === 0);
                    for (const index of order) {
                        if (index <= at) continue;
                        if (!(await legs.canWalkTo(points[index], planMs))) {
                            // A failed plan costs thinking time, so after one the short cut rests a while.
                            if (index === shortCut) rest = 4;
                            continue;
                        }
                        try {
                            await legs.walkTo(points[index]);
                        } catch (error) {
                            if (legs.interrupted()) throw error;
                            // Stuck part-way. It may have passed some spots before it stuck; carry on
                            // from the last of those, and try a nearer spot.
                            at = passed(points, at, index, legs.position());
                            continue;
                        }
                        at = index;
                        hops++;
                        moved = true;
                        break;
                    }
                    if (moved) { rest = Math.max(0, rest - 1); continue; }

                    // Not even the next spot can be walked to.
                    if (at < 0) return hops ? { followed: true, reached: 'part', hops, reason: 'left the trail', noDigging } : { ...NOT_FOLLOWED('cannot reach the trail'), noDigging };
                    const from = points[at], next = points[at + 1];
                    blockedNear(from, next);
                    // First an ordinary path past the blockage: a fallen block or a shut gap is usually
                    // a step or two to get past, and the rest of the way is still good. It aims for the
                    // farthest spot ahead that is close by, and only then for the very next one, or a
                    // bot that has dug its way round would walk back to the wall's far side to carry on.
                    // Not past someone's block: that path may dig, if not through their wall then round it.
                    const ahead = candidates(points, at, legs.position(), true).shortCut;
                    let pushed = false;
                    for (const index of noDigging ? [] : new Set([ahead, at + 1])) {
                        if (index <= at) continue;
                        if (await legs.pushThrough(points[index], planMs)) { at = index; hops++; pushed = true; break; }
                        if (legs.interrupted()) throw new Error('Travel interrupted');
                    }
                    if (pushed) continue;
                    // Then another way the bot knows, now that routes avoid this link, and any other link
                    // memory says is walled up the same way.
                    let around = detours < maxDetours ? trail.route(from.id, trip.end.id) : null;
                    for (let checks = 0; around && checks < WALL_CHECKS; checks++) {
                        const walled = walledLink(around.points);
                        if (walled < 0) break;
                        blockedNear(around.points[walled], around.points[walled + 1]);
                        around = trail.route(from.id, trip.end.id);
                    }
                    if (around && around.points.length >= 2) {
                        detours++;
                        say('Going around by another way you know.');
                        points = around.points;
                        at = 0;
                        rest = 0;
                        continue;
                    }
                    return { followed: hops > 0, reached: 'part', hops, reason: 'blocked', noDigging };
                }
                return { followed: true, reached: 'end', hops, noDigging };
            } finally { busy = false; }
        },
    };
}

/**
 * The real legs: the bot's pathfinder.
 * @param {object} bot - the mineflayer bot, with the pathfinder plugin loaded
 * @param {object} [options]
 * @param {number} [options.hopTimeoutMs] - a hop that takes longer than this is given up. It is a last
 *   resort: a hop that is going nowhere is caught much sooner, by the pathfinder saying it is stuck
 */
export function pathfinderLegs(bot, { hopTimeoutMs = 120000 } = {}) {
    // A hop never plans a slantwise step past a solid corner, which the bot is too wide to cut: Mindcraft-CE's
    // pathfinder patch refuses those steps for every Movements object.
    // For following the trail: no digging and no placing. The trail is ground the bot walked, so a
    // hop that needs either means the way has changed, and that should be noticed, not dug through.
    // Doors and gates are still opened; the pathfinder does that by itself.
    const strict = () => {
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        movements.scafoldingBlocks = [];
        movements.allow1by1towers = false;
        return movements;
    };
    // For getting past a blockage: the same careful settings ordinary travel tries first. Digging and
    // placing are allowed but dear, and glass is left alone.
    const careful = () => {
        const movements = new pf.Movements(bot);
        for (const name of ['glass', 'glass_pane']) {
            const id = bot.registry.blocksByName[name]?.id;
            if (id != null) movements.blocksCantBreak.add(id);
        }
        movements.placeCost = 2;
        movements.digCost = 10;
        return movements;
    };
    const near = (point, within = 1) => new pf.goals.GoalNear(point.x, point.y, point.z, within);
    const nextTick = () => new Promise(resolve => setImmediate(resolve));

    // Thinks in short slices and lets the game run between them, so a hard question never freezes the bot.
    async function canPlan(movements, point, budgetMs) {
        const search = bot.pathfinder.getPathFromTo(movements, bot.entity.position, near(point), { timeout: budgetMs, tickTimeout: 10 });
        for (const { result } of search) {
            if (result.status === 'success') return true;
            if (result.status !== 'partial') return false;
            if (bot.interrupt_code) return false;
            await nextTick();
        }
        return false;
    }

    async function go(movements, point, within) {
        const previous = bot.pathfinder.movements;
        // The pathfinder says "stuck" when it has stood still for a few seconds, then plans again.
        // Twice in one hop means it is not going to get there, and waiting out the clock helps no one.
        let stuck = 0;
        const onReset = reason => { if (reason === 'stuck' && ++stuck >= 2) bot.pathfinder.setGoal(null); };
        bot.on('path_reset', onReset);
        bot.pathfinder.setMovements(movements);
        try {
            await cancellable(bot, () => bot.pathfinder.goto(near(point, within)), hopTimeoutMs, () => bot.pathfinder.setGoal(null));
        } finally {
            bot.off('path_reset', onReset);
            if (previous) bot.pathfinder.setMovements(previous);
        }
    }

    return {
        position: () => ({ x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }),
        interrupted: () => Boolean(bot.interrupt_code),
        canWalkTo: (point, budgetMs) => canPlan(strict(), point, budgetMs),
        // `within` is how near is near enough, in blocks: 1 unless the caller says otherwise.
        walkTo: (point, within) => go(strict(), point, within),
        async pushThrough(point, budgetMs) {
            const movements = careful();
            if (!(await canPlan(movements, point, budgetMs))) return false;
            try { await go(movements, point); return true; } catch (error) {
                if (bot.interrupt_code) throw error;
                return false;
            }
        },
    };
}
