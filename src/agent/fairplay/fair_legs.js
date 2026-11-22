// SPDX-License-Identifier: CC0-1.0
// Fair legs: the pathfinder plans a route over what the bot has seen, not over every loaded block.
//
// The pathfinder searches for a route by asking, cell by cell, "what block is here?", and the stock answer
// comes from the chunk data: every block the server sent, seen or not. So its choice of route used caves
// the bot had never entered, knew how thick a hill was before digging into it, and stepped round lava
// that was still behind rock. Targets already came from the bot's eyes; this makes the route between
// them come from the eyes too.
//
// What the search is told instead, for each cell:
//   - in view right now, or touched: the block that is there;
//   - seen before: the block as it was last seen (from world memory, when that is on);
//   - seen to be empty, now or earlier: air;
//   - never seen: OPEN GROUND, a cell the bot may walk through and may stand on.
//
// That last rule is the whole policy for the unknown, and it is the optimistic one a person uses: "I
// have not been over that ridge, so I will assume I can walk there, and look when I get to it." A search
// through unseen country therefore heads straight for the goal. The price of optimism is that a wall is
// believed to be only as thick as what the bot has seen of it, so digging in can look cheaper than it
// turns out to be.
//
// Optimism needs a second half: looking. As the bot walks, the way ahead comes into view, and a step
// the route counted on may turn out to be a drop or a rock face. A few times a second the next steps of
// the route are put to the pathfinder again, under what the bot now believes. A step that is no longer
// there, or has become dearer, makes the pathfinder plan again from where the bot stands.
//
// How it hooks in: no file of Mindcraft-CE's or of the pathfinder's is edited. The pathfinder's
// `Movements` class has one method that reads the world, `getBlock`, and every route search, by every
// skill and plugin, goes through it. This module replaces that method on the class once, at run time,
// and answers from the believed world for bots that have fair legs. Any other bot gets the library's
// own answer, so stock behavior is untouched (the same arrangement as fair_queries.js). The walking
// itself, the step-by-step physics, still feels the real ground under the bot, as a player's legs do.
import pf from 'mineflayer-pathfinder';
import Move from 'mineflayer-pathfinder/lib/move.js';
import Vec3 from 'vec3';
import { patchRoutePricing } from '../library/place_costs.js';

const legsOf = new WeakMap();      // bot -> its fair legs
const VIEW = Symbol('believedView'); // on a Movements object: a copy of it that reads the believed world
const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const AIR_NAMES = ['air', 'cave_air', 'void_air'];
// A step the route planned may cost this much more under what the bot now believes before it counts as
// changed. Walking is 1 a step, digging or placing adds 1 at the very least, so half is a safe line.
const COST_SLACK = 0.5;

// Believed blocks are kept per cell while the bot stays in one cell. Cells are numbered from where the
// bot stood when the list was started, so the number fits the whole numbers JavaScript keeps exactly.
const SPAN = 65536, HALF = SPAN / 2;
// Air seen this session, as one bit a cell in 16-block cubes: 512 bytes a cube, and at most this many cubes.
const MAX_OPEN_CUBES = 4096;
const cubeNumber = (x, y, z) => (((x >> 4) + 2097152) * 4194304 + ((z >> 4) + 2097152)) * 64 + ((y >> 4) + 32);
const bitInCube = (x, y, z) => ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);

let patched = false;

// Replaces three Movements methods, once for the whole process: the one that reads a block, the one that
// lists the steps from a cell, and the one that notes where mobs stand (a route costs more through
// them). Each asks whether the bot it is planning for has fair legs, and is exactly the library's own
// method when it has not.
function patchMovements() {
    if (patched) return;
    patched = true;
    const proto = pf.Movements.prototype;
    const libraryGetBlock = proto.getBlock;
    const libraryGetNeighbors = proto.getNeighbors;
    const libraryUpdateCollisionIndex = proto.updateCollisionIndex;
    proto.getBlock = function (pos, dx, dy, dz) {
        const legs = pos ? legsOf.get(this.bot) : null;
        return legs ? legs.getBlock(this, libraryGetBlock, pos, dx, dy, dz) : libraryGetBlock.call(this, pos, dx, dy, dz);
    };
    proto.getNeighbors = function (node) {
        const neighbors = libraryGetNeighbors.call(this, node);
        const legs = legsOf.get(this.bot);
        if (!legs) return neighbors;
        legs.addUnseenDiagonals(this, node, neighbors);
        return legs.withoutBlindDrops(this, node, neighbors);
    };
    proto.updateCollisionIndex = function () {
        const legs = legsOf.get(this.bot);
        return legs ? legs.updateCollisionIndex(this, libraryUpdateCollisionIndex) : libraryUpdateCollisionIndex.call(this);
    };
    // Costs on places (danger zones) price every step a search considers, these legs' slantwise steps
    // included, so that pricing goes back on top of the wrap just made.
    patchRoutePricing();
}

/** The fair legs of a bot, or null when it plans as stock Mindcraft does. */
export function fairLegsOf(bot) {
    return legsOf.get(bot) ?? null;
}

/**
 * Puts one bot's route planning under fair play.
 *
 * @param {object} bot - the mineflayer bot, with the pathfinder plugin loaded
 * @param {object} options
 * @param {() => object|null} options.getPerception - the bot's perception service right now (it is
 *   replaced when the bot changes dimension), or null before the first spawn
 * @param {() => object[]} [options.getEntities] - the mobs and players the bot knows of right now. The
 *   default is what perception sees; the installer passes the fair query provider's answer, so that a
 *   policy that lets mobs be known through walls means the same here as everywhere else
 * @param {number} [options.sightRange] - how far a cell is checked for being in view right now. Farther
 *   cells are answered from memory alone. The default is as far as a look-around reaches
 * @param {number} [options.horizon] - how far ahead along the route, in blocks, steps are checked again
 * @param {number} [options.maxSteps] - and at most this many steps
 * @param {number} [options.minGapMs] - the shortest time between two forced plans
 * @param {number} [options.checkEveryMs] - how often the way ahead is checked; 0 for never (tests call check())
 * @param {number} [options.cacheMs] - how long a believed block is kept before it is asked for again
 * @param {() => number} [options.clock] - a clock in ms
 * @returns {{believed: function, check: function, stop: function, replans: number}}
 */
export function installFairLegs(bot, { getPerception, getEntities = () => getPerception()?.entities() ?? [], sightRange = 24,
    horizon = 16, maxSteps = 24, minGapMs = 400, checkEveryMs = 150, cacheMs = 250, clock = () => performance.now() } = {}) {
    if (typeof getPerception !== 'function') throw new Error('installFairLegs needs getPerception()');
    legsOf.get(bot)?.stop();
    patchMovements();

    const air = bot.registry.blocksByName.air;
    const airTypes = new Set(AIR_NAMES.map(name => bot.registry.blocksByName[name]?.id).filter(id => id != null));

    // ---- What the bot believes is in a cell ----

    const cache = new Map();        // cell number -> believed block, while the bot stays in one cell
    const openCubes = new Map();    // cube number -> one bit a cell: air the bot saw this session
    let cellX = NaN, cellY = NaN, cellZ = NaN, freshUntil = -Infinity, changed = true;
    let dimension = bot.game?.dimension;
    const onWorldChange = () => { changed = true; };
    const worldEvents = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload'];
    for (const event of worldEvents) bot.on(event, onWorldChange);

    // Starts the list of believed blocks afresh when the bot has moved to another cell, the world has
    // changed, or a moment has passed (memory fills in as the bot looks around, without saying so).
    function freshen() {
        const p = bot.entity?.position;
        const x = p ? Math.floor(p.x) : 0, y = p ? Math.floor(p.y) : 0, z = p ? Math.floor(p.z) : 0;
        const t = clock();
        if (!changed && t < freshUntil && x === cellX && y === cellY && z === cellZ) return;
        cache.clear();
        changed = false;
        freshUntil = t + cacheMs;
        cellX = x; cellY = y; cellZ = z;
        // Another dimension is another world with the same coordinates: what was open there says nothing here.
        if (bot.game?.dimension !== dimension) {
            dimension = bot.game?.dimension;
            openCubes.clear();
        }
    }

    // Seen air has to be kept somewhere. World memory does not record the air the bot looks through,
    // and without this a pit seen from its edge would be ground again as soon as the bot stepped back
    // far enough to lose sight of it: it would walk up, see the pit, turn away, and walk up again.
    function noteOpen(x, y, z, open) {
        const number = cubeNumber(x, y, z);
        let bits = openCubes.get(number);
        if (!bits) {
            if (!open) return;
            if (openCubes.size >= MAX_OPEN_CUBES) openCubes.delete(openCubes.keys().next().value); // the oldest goes
            openCubes.set(number, bits = new Uint8Array(512));
        }
        const bit = bitInCube(x, y, z);
        if (open) bits[bit >> 3] |= 1 << (bit & 7);
        else bits[bit >> 3] &= ~(1 << (bit & 7));
    }
    function wasOpen(x, y, z) {
        const bits = openCubes.get(cubeNumber(x, y, z));
        if (!bits) return false;
        const bit = bitInCube(x, y, z);
        return ((bits[bit >> 3] >> (bit & 7)) & 1) === 1;
    }

    // A block of air made up for a cell perception has no block for. `unseen` marks the ones the bot
    // knows nothing about; getBlock turns those into open ground.
    const emptyCell = (x, y, z, unseen) => ({ name: air.name, type: air.id, stateId: air.defaultState ?? air.minStateId,
        boundingBox: 'empty', shapes: [], position: new Vec3(x, y, z), unseen });

    /** The block the bot believes is at a cell. Never null: a cell it knows nothing of comes back marked `unseen`. */
    function believed(x, y, z) {
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        freshen();
        const dx = x - cellX + HALF, dz = z - cellZ + HALF;
        const listed = dx >= 0 && dx < SPAN && dz >= 0 && dz < SPAN && y >= -512 && y < 512;
        const number = listed ? (dx * SPAN + dz) * 1024 + (y + 512) : -1;
        if (listed) {
            const known = cache.get(number);
            if (known !== undefined) return known;
        }
        let block = getPerception()?.believedAt(x, y, z, sightRange) ?? null;
        if (block) {
            // A block perception read from the world just now (one from memory carries `rememberedAt`).
            if (block.rememberedAt === undefined) noteOpen(x, y, z, airTypes.has(block.type));
        } else {
            block = emptyCell(x, y, z, !wasOpen(x, y, z));
        }
        if (listed) cache.set(number, block);
        return block;
    }

    // The library's getBlock reads `this.bot.blockAt` and then works out, from its own lists, whether
    // the block can be walked through, stood on, climbed, and so on. It is run on a copy of the
    // Movements object whose `bot` answers from the believed world, so those rules stay the library's
    // and are not written out a second time here.
    const believer = { blockAt: pos => believed(pos.x, pos.y, pos.z) };
    function getBlock(movements, libraryGetBlock, pos, dx, dy, dz) {
        let view = movements[VIEW];
        if (view?.bot !== believer) { // none yet, or one left by legs the bot had before these
            view = Object.create(movements, { bot: { value: believer } });
            Object.defineProperty(movements, VIEW, { value: view, writable: true, configurable: true });
        }
        const block = libraryGetBlock.call(view, pos, dx, dy, dz);
        if (block.unseen) {
            // Open ground: the library has just judged it as air (walk through it), and this adds
            // that it will bear the bot's weight, with its top where a full block's would be.
            block.physical = true;
            block.height = Math.floor(pos.y + dy) + 1;
        }
        return block;
    }

    // The library plans a slantwise step onto a cell it can stand on as a step UP onto that cell, and
    // goToGoal's corner rule reads "can be stood on" as "is in the way". Both are right for real blocks
    // and wrong for open ground, which is both at once. Left alone, a search through unseen country
    // would have no level slantwise steps, and would be searched as a staircase of right angles that
    // its own distance estimate does not expect: thousands of cells looked at for a short trip. So
    // wherever an unseen cell is part of a slantwise step, the plain level step is added here.
    function addUnseenDiagonals(movements, node, neighbors) {
        for (const [dx, dz] of DIAGONALS) {
            const feet = movements.getBlock(node, dx, 0, dz);
            const sideA = [movements.getBlock(node, dx, 0, 0), movements.getBlock(node, dx, 1, 0)];
            const sideB = [movements.getBlock(node, 0, 0, dz), movements.getBlock(node, 0, 1, dz)];
            // All of it seen: the library's own answer stands.
            if (!feet.unseen && !sideA.some(b => b.unseen) && !sideB.some(b => b.unseen)) continue;
            const head = movements.getBlock(node, dx, 1, dz);
            const ground = movements.getBlock(node, dx, -1, dz);
            // Room for the body on the cell and past both corners, and something to stand on.
            if (!feet.safe || !head.safe || !ground.physical || [...sideA, ...sideB].some(b => !b.safe)) continue;
            // Nothing is dug: every cell here is passable. safeOrBreak then only adds what the library
            // adds for a passable cell, the cost of entities and of areas a caller has ruled out.
            const none = [];
            let cost = Math.SQRT2 + movements.safeOrBreak(feet, none) + movements.safeOrBreak(head, none)
                + Math.min(movements.safeOrBreak(sideA[0], none) + movements.safeOrBreak(sideA[1], none),
                    movements.safeOrBreak(sideB[0], none) + movements.safeOrBreak(sideB[1], none));
            if (movements.getBlock(node, 0, 0, 0).liquid) cost += movements.liquidCost;
            if (cost > 100) continue;
            neighbors.push(new Move(feet.position.x, feet.position.y, feet.position.z, node.remainingBlocks, cost));
        }
    }

    // Open ground is fine to walk on at the bot's own level: a step there is looked at before it is taken. A
    // drop is another matter. Off an edge the landing is below the edge, and the cells just under a lip are
    // hidden by the ground the bot stands on, so they are never seen until the bot stands at the edge and
    // looks down. Taken for open ground, they had routes drop off ledges and cliffs onto ground that wasn't
    // there: a bot leaving a creeper behind ran off a floor 40 blocks up. A player looks before they drop.
    // So a step down to the side, whichever move the library made it with, is kept only when the ground it
    // lands on has been seen. Straight down is digging down where the bot stands, and is left alone.
    function withoutBlindDrops(movements, node, neighbors) {
        return neighbors.filter(move => move.y >= node.y || (move.x === node.x && move.z === node.z)
            || !movements.getBlock(move, 0, -1, 0).unseen);
    }

    // A route costs more through a cell a mob stands in. The library notes where every mob the server
    // has told the client about stands, behind walls or not. Here it is shown only the ones the bot knows of.
    function updateCollisionIndex(movements, libraryUpdateCollisionIndex) {
        libraryUpdateCollisionIndex.call(Object.create(movements, { bot: { value: { entities: getEntities(), entity: bot.entity } } }));
    }

    // ---- Watching the way ahead ----

    let route = null;               // the list of steps the pathfinder is walking; it drops each one as it is passed
    let lastForced = -Infinity;
    let replans = 0;
    let looked = null;              // what the last look at the way ahead was of, so that nothing is looked at twice
    // Kept as the pathfinder's own list, which it empties step by step, so an empty one means the route is walked.
    const onPathUpdate = result => { route = Array.isArray(result?.path) && result.path.length ? result.path : null; };
    const dropRoute = () => { route = null; };
    const pathEvents = [['path_update', onPathUpdate], ['path_reset', dropRoute], ['path_stop', dropRoute], ['goal_reached', dropRoute]];
    for (const [event, listener] of pathEvents) bot.on(event, listener);

    // The cell a step of the route stands for. The pathfinder rewrites a step's x, y and z into the
    // exact spot to stand on, sometimes a block lower, but `hash` keeps the cell the search chose.
    const cellOf = step => {
        const [x, y, z] = step.hash.split(',').map(Number);
        return { x, y, z };
    };

    /**
     * Puts the next steps of the route to the pathfinder again, under what the bot believes now, and has
     * the route planned afresh when one of them is gone or has become dearer.
     * @returns {boolean} whether a new plan was asked for
     */
    function check() {
        const path = route, here = bot.entity?.position, movements = bot.pathfinder?.movements;
        if (!path || !here || !movements) return false;
        // The pathfinder is not going anywhere: whatever route was kept is over.
        if (!bot.pathfinder.goal) { route = null; return false; }
        const t = clock();
        if (t - lastForced < minGapMs) return false;
        // The route has run out, and the goal isn't reached. The search ended it on a cell the bot had never
        // seen, taken for open ground, from which the goal was in reach; walking there, the bot found it was
        // not (floor it had not seen, say, under the edge of its view). The pathfinder plans only once for a
        // route and then waits at its end for good, so it is asked to plan again, once for each route.
        if (path.length === 0) {
            route = null;
            if (bot.pathfinder.goal.isEnd?.(here.floored?.() ?? { x: Math.floor(here.x), y: Math.floor(here.y), z: Math.floor(here.z) })) return false;
            lastForced = t;
            replans++;
            bot.pathfinder.setMovements(movements);
            return true;
        }
        if (path.length < 2) return false;
        // A new plan stops the bot for a moment. Not in mid-air, where that could drop it short of the
        // far side of a jump, and not in the middle of a block it is digging or placing.
        if ((bot.entity.onGround === false && !bot.entity.isInWater) || bot.pathfinder.isMining?.() || bot.pathfinder.isBuilding?.()) return false;
        // Nothing new to see since the last look: the same route, from the same spot, in an unchanged
        // world. Memory can still fill in for a moment after the bot stops, so it is looked at again
        // once a second all the same.
        if (looked && looked.path === path && looked.length === path.length && !changed && t - looked.at < 1000
            && Math.hypot(here.x - looked.x, here.y - looked.y, here.z - looked.z) < 0.5) return false;
        looked = { path, length: path.length, at: t, x: here.x, y: here.y, z: here.z };
        changed = true; // look with fresh eyes: this is the moment news is wanted
        for (let i = 0; i < Math.min(path.length - 1, maxSteps); i++) {
            const from = cellOf(path[i]), to = path[i + 1];
            if (Math.hypot(from.x + 0.5 - here.x, from.y - here.y, from.z + 0.5 - here.z) > horizon) break;
            let cost = Infinity;
            for (const move of movements.getNeighbors({ ...from, remainingBlocks: path[i].remainingBlocks }))
                if (move.hash === to.hash && move.cost < cost) cost = move.cost;
            if (cost <= to.cost + COST_SLACK) continue;
            // Handing the pathfinder its own settings back is its one way of being told to plan again.
            lastForced = t;
            replans++;
            route = null;
            bot.pathfinder.setMovements(movements);
            return true;
        }
        return false;
    }

    let timer = null;
    if (checkEveryMs > 0) {
        timer = setInterval(() => { try { check(); } catch (error) { console.warn('[fair legs] Could not check the way ahead:', error.message); } }, checkEveryMs);
        timer.unref?.(); // never the only thing keeping the process alive
    }

    const legs = {
        believed, getBlock, addUnseenDiagonals, updateCollisionIndex, check, withoutBlindDrops,
        /** How many times a route was planned again because the way ahead was not as believed. */
        get replans() { return replans; },
        /** Takes the bot's fair legs off again: it plans as stock Mindcraft does, and nothing is left listening. */
        stop() {
            clearInterval(timer);
            for (const event of worldEvents) bot.off(event, onWorldChange);
            for (const [event, listener] of pathEvents) bot.off(event, listener);
            if (legsOf.get(bot) === legs) legsOf.delete(bot);
        },
    };
    legsOf.set(bot, legs);
    return legs;
}
