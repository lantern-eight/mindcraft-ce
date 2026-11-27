// SPDX-License-Identifier: CC0-1.0
// The real legs the explorer walks on: the pathfinder for walking, world.js for seeing, world memory (when on)
// for knowing which land is new, what lies at the end of a leg, and where there is room to walk underground.
//
// Nothing here looks at the world except through world.js, so under fair play every answer is what the bot
// perceives or remembers, and every route is planned by fair legs like any other walk. With fair play off it
// is stock Mindcraft's view of the world, as every other command has.
import pf from 'mineflayer-pathfinder';
import * as world from '../library/world.js';
import { lookBeforeSearch } from '../library/search_look.js';
import { newGroundAlong } from './heading.js';
import { LEG } from './explorer.js';

const STALL_MS = 8000;         // a leg that hasn't moved a block in this long is stuck: end it and try another way
const SWIM_MS = 5000;          // swimming this long without a break is setting out to sea, not crossing a stream
const SHORE_MS = 15000;        // how long the swim back to the shore may take before the next try starts anyway
const BANK_REACH = 16;         // how far off a bank to climb out on is looked for, when the way back is lost
const DETOUR = 2.5;            // a leg that has walked this many times its length (and a little) is going the long way round
const WATCH_MS = 250;
const SIGHT = 64;              // how far a thing looked for counts as found: as far as the searches look
const KINDS_REACH = 32;        // how far round the bot the kinds of ground worth naming are looked for
const DROP = 8;                // a leg's end this far below the bot's level, over open air, is a drop
const ROOF = 24;               // how far above the head a roof makes the bot underground
const CAVE_MIN = 3;            // underground, a spot nearer than this is no way on
const BEEN = 4;                // underground, a spot this near one where the bot has stood or been sent is not gone to again
const LOOK_DEPTH = 16;         // how far down open air is known over ground the bot looked at (as route planning asks)

// The kinds of ground worth naming when a walk comes across them: what a player exploring would mention.
// Not every block: stone and grass are everywhere, and a list of them says nothing.
const NOTABLE = /^(water|lava|sand|red_sand|gravel|clay|snow_block|powder_snow|ice|packed_ice|blue_ice|mycelium|podzol|mud|moss_block|obsidian|magma_block|amethyst_block|dripstone_block|sculk|pumpkin|melon|sugar_cane|bamboo|cactus|[a-z_]*_log|[a-z_]*_ore|[a-z_]*terracotta|[a-z_]*_mushroom_block)$/;
const WET = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/;

/**
 * The movements a leg walks with. Exploring goes over or round what is in the way, as a person does on foot:
 * it may break leaves (a forest's canopy comes down to the ground in places) and place a block to step up,
 * and it never digs into the ground. A block of water costs a route as much as twenty of land, so a stream is
 * crossed but a lake is walked round.
 * `goToGoal` is not used: its gentle try still digs, only at a higher price, so an explorer would tunnel.
 */
export function exploreMovements(bot) {
    const moves = new pf.Movements(bot);
    moves.exclusionAreasBreak.push(block => (/leaves/.test(block?.name ?? '') ? 0 : 100));
    moves.placeCost = 2;
    moves.liquidCost = 20;
    return moves;
}

/** Splits "sand, red_sand" into block names and mob names the game knows, and the words it doesn't. */
export function targetsOf(registry, what) {
    const words = String(what ?? '').split(',').map(w => w.trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_')).filter(Boolean);
    const blocks = [], mobs = [], unknown = [];
    for (const word of words) {
        if (registry.blocksByName?.[word]) blocks.push(word);
        else if (registry.entitiesByName?.[word]) mobs.push(word);
        else unknown.push(word);
    }
    return { blocks, mobs, unknown, all: [...blocks, ...mobs] };
}

/**
 * @param {object} bot
 * @param {object} [options]
 * @param {{blocks: string[], mobs: string[]}|null} [options.targets] - what to look for
 * @param {object|null} [options.memory] - world memory, open for this world, or null
 * @param {number} [options.swimMs], [options.stallMs], [options.watchMs], [options.shoreMs] - the limits above, shorter in tests
 * @param {(bot: object) => object} [options.movements] - the pathfinder movements to walk with (tests hand in a stand-in)
 */
export function realLegs(bot, { targets = null, memory = null, swimMs = SWIM_MS, stallMs = STALL_MS, watchMs = WATCH_MS, shoreMs = SHORE_MS,
    movements = exploreMovements } = {}) {
    const position = () => bot.entity.position;
    const here = () => ({ x: position().x, y: position().y, z: position().z });

    // Felt, not seen: the game's own "in water" for the bot's body, or the block its feet are in (an offset of
    // nothing from where it stands).
    const inWaterNow = () => Boolean(bot.entity.isInWater) || /water/.test(world.getBlockAtPosition(bot, 0, 0, 0)?.name ?? '');
    // The last ground the bot stood on out of the water, kept from one leg to the next: after turning back
    // from a lake it heads there, not out into the lake again.
    let dry = null;
    // When the bot last went into the water, kept from one leg to the next and cleared only on dry ground, so
    // the limit is on swimming without a break, however many legs it is spread over.
    let wetSince = null;
    const feel = now => {
        if (inWaterNow()) wetSince ??= now;
        else if (bot.entity.onGround) { wetSince = null; dry = position().clone(); }
    };

    async function walk(point) {
        if (bot.interrupt_code) return 'interrupted';
        // Underground there is no level line to follow: the rock all round is never seen, so a route planned
        // into it as open ground leads into the wall. A person in a cave follows the open air they can see,
        // so the leg ends at the farthest spot that way the bot has seen room to stand.
        let goal = new pf.goals.GoalNearXZ(point.x, point.z, 2);
        if (memory?.cells && underground()) {
            stood.push(here());
            const spot = caveSpot(point);
            if (!spot) return 'unseen';
            goal = new pf.goals.GoalNear(spot.x, spot.y, spot.z, 1);
            stood.push(spot);
        }
        bot.pathfinder.setMovements(movements(bot));
        let outcome = null;
        let mark = position().clone(), markAt = Date.now();
        // A leg whose end is out in a lake, or across a ravine, has no dry way there: the pathfinder would walk
        // all the way round looking for one. A person gives that spot up once the way round gets long.
        let walked = 0, previous = position().clone();
        const budget = DETOUR * Math.hypot(point.x - previous.x, point.z - previous.z) + 16;
        feel(Date.now());
        const watch = setInterval(() => {
            const now = Date.now();
            feel(now);
            if (position().distanceTo(mark) >= 1) { mark = position().clone(); markAt = now; }
            walked += position().distanceTo(previous);
            previous = position().clone();
            const stop = wetSince !== null && now - wetSince > swimMs ? 'water' : now - markAt > stallMs ? 'stalled' : walked > budget ? 'detour' : null;
            if (stop && !outcome) { outcome = stop; bot.pathfinder.setGoal(null); }
        }, watchMs);
        try {
            await bot.pathfinder.goto(goal);
            return 'arrived';
        } catch (error) {
            if (bot.interrupt_code) return 'interrupted';
            if (outcome === 'water') await backToShore();
            if (outcome) return outcome;
            if (/NoPath|Timeout/i.test(error?.name ?? '') || /no path|timeout|took to long/i.test(error?.message ?? '')) return 'no_path';
            return 'stalled';
        } finally {
            clearInterval(watch);
        }
    }

    // Having turned back from open water, the bot swims back to where it last stood dry, as a person does,
    // rather than starting its next try out in the lake.
    // If there is no way back there, it climbs out at the nearest bank it knows of instead.
    async function backToShore() {
        if (bot.interrupt_code) return;
        const ways = [() => dry, nearestBank];
        for (const way of ways) {
            if (bot.interrupt_code || !inWaterNow()) return;
            const spot = way();
            if (!spot) continue;
            const goal = new pf.goals.GoalNear(spot.x, spot.y, spot.z, 1);
            const timer = setTimeout(() => bot.pathfinder.setGoal(null), shoreMs);
            try { await bot.pathfinder.goto(goal); return; }
            catch { /* no way there: try the next */ }
            finally { clearTimeout(timer); }
        }
    }

    // The nearest solid ground in sight or remembered (through world.js, so only what the bot knows) with room
    // above it to stand: where to climb out of the water. The spot to stand on, or null.
    function nearestBank() {
        const p = position();
        const base = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        const ground = world.getNearestBlocksWhere(bot, block => block?.boundingBox === 'block' && !/water|leaves|ice/.test(block.name ?? ''), BANK_REACH, 64);
        for (const block of ground) {
            const at = block.position;
            const room = [1, 2].every(dy => world.getBlockAtPosition(bot, at.x - base.x, at.y + dy - base.y, at.z - base.z)?.boundingBox === 'empty'
                && !/water|lava/.test(world.getBlockAtPosition(bot, at.x - base.x, at.y + dy - base.y, at.z - base.z)?.name ?? ''));
            if (room) return { x: at.x, y: at.y + 1, z: at.z };
        }
        return null;
    }

    // Under a roof: something solid the bot knows of above its head, other than leaves (a forest is not a
    // cave). A spot it has never seen ends the look up: it can't tell, so it isn't underground.
    function underground() {
        for (let dy = 2; dy <= ROOF; dy++) {
            const block = world.getBlockAtPosition(bot, 0, dy, 0);
            const name = block?.name ?? 'unknown';
            if (name === 'unknown') return false;
            if (block.boundingBox === 'block' && !/leaves/.test(name)) return true;
        }
        return false;
    }

    // What the bot remembers at a cell, from world memory: a block name, 'air', or null when it never saw it.
    // Air it only looked through counts as air too (`seenOpen`): the cells over ground it saw, as route
    // planning counts them.
    const remembered = (x, y, z) => {
        const name = memory.cells.read(x, y, z);
        if (name !== null) return name;
        return memory.cells.seenOpen(x, y, z, LOOK_DEPTH) ? 'air' : null;
    };
    const isAir = name => name === 'air' || name === 'cave_air';
    const isFloor = name => Boolean(name) && !isAir(name) && !WET.test(name) && name !== 'lava';

    // Where the bot has stood and been sent underground: a cave leg never goes back to one of these, or a
    // bend in a passage would have it step back and forth between two corners.
    const stood = [];
    const beenNear = (x, z) => stood.some(p => Math.hypot(p.x - x, p.z - z) < BEEN);

    // The farthest spot towards a leg's end the bot has seen room to stand on: two open cells over a floor,
    // near the straight line there, within a few blocks of its level, and not where it has already been.
    // Null when there is none.
    function caveSpot(point) {
        const p = position();
        const angle = Math.atan2(point.z - p.z, point.x - p.x);
        const length = Math.hypot(point.x - p.x, point.z - p.z);
        const side = { x: -Math.sin(angle), z: Math.cos(angle) };
        const y0 = Math.floor(p.y);
        for (let d = Math.floor(length); d >= CAVE_MIN; d -= 2) {
            for (const off of [0, 2, -2, 4, -4]) {
                const x = Math.floor(p.x + Math.cos(angle) * d + side.x * off);
                const z = Math.floor(p.z + Math.sin(angle) * d + side.z * off);
                for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
                    const y = y0 + dy;
                    if (beenNear(x + 0.5, z + 0.5)) break;
                    if (isAir(remembered(x, y, z)) && isAir(remembered(x, y + 1, z)) && isFloor(remembered(x, y - 1, z))) return { x: x + 0.5, y, z: z + 0.5 };
                }
            }
        }
        return null;
    }

    // What the bot remembers at a leg's end that it would not walk into: water or lava where the ground should
    // be, or a drop. Asked of world memory only: what the bot saw from afar, not what is there now. Five
    // columns round the end must mostly agree, so a puddle or a hole is no reason to turn.
    function knownHazard(point) {
        if (!memory?.cells) return null;
        const x0 = Math.floor(point.x), y0 = Math.floor(point.y), z0 = Math.floor(point.z);
        const at = (x, z) => {
            for (let y = y0 + 6; y >= y0 - 16; y--) {
                const name = remembered(x, y, z);
                if (name === null || isAir(name)) continue;
                if (WET.test(name)) return 'water';
                if (name === 'lava') return 'lava';
                return y < y0 - DROP && openDown(x, y + 1, y0, z) ? 'drop' : null;
            }
            return openDown(x, y0 - DROP, y0, z) ? 'drop' : null;
        };
        // Open air all the way from the bot's level down to `bottom`, as far as the bot knows.
        const openDown = (x, bottom, top, z) => {
            for (let y = top - 1; y >= bottom; y--) if (!isAir(remembered(x, y, z))) return false;
            return true;
        };
        const middle = at(x0, z0);
        if (!middle) return null;
        const agree = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dz]) => at(x0 + dx, z0 + dz) === middle).length;
        return agree >= 2 ? middle : null;
    }

    // The kinds of ground worth naming that are in view or remembered near the bot, through world.js.
    function kinds() {
        const names = new Set();
        for (const block of world.getNearestBlocksWhere(bot, block => NOTABLE.test(block?.name ?? ''), KINDS_REACH, 1024)) names.add(block.name);
        return [...names];
    }

    function find() {
        if (!targets) return null;
        const p = position();
        const hits = [];
        if (targets.blocks.length) {
            const block = world.getNearestBlocks(bot, targets.blocks, SIGHT, 1)[0];
            if (block?.position) hits.push({ name: block.name, x: block.position.x, y: block.position.y, z: block.position.z });
        }
        if (targets.mobs.length) {
            const mob = world.getNearestEntityWhere(bot, e => targets.mobs.includes(e.name), SIGHT);
            if (mob?.position) hits.push({ name: mob.name, x: mob.position.x, y: mob.position.y, z: mob.position.z });
        }
        const far = hit => Math.hypot(hit.x - p.x, hit.y - p.y, hit.z - p.z);
        return hits.sort((a, b) => far(a) - far(b))[0] ?? null;
    }

    // Blocks remembered farther than a search looks. Mobs move, so a remembered one is no reason to go there.
    function recall(maxDistance) {
        if (!memory?.cells || !targets?.blocks.length) return null;
        const hit = memory.cells.nearest(targets.blocks, here(), { maxDistance, limit: 1 })[0];
        return hit ? { name: hit.name, x: hit.x, y: hit.y, z: hit.z } : null;
    }

    return {
        position: here,
        interrupted: () => Boolean(bot.interrupt_code),
        walk,
        lookAround: () => lookBeforeSearch(bot, null),
        settle: async () => { if (inWaterNow()) await backToShore(); },
        newGround: memory?.cells ? angle => newGroundAlong((cx, cy, cz) => memory.cells.lookedAt(cx, cy, cz), here(), angle, LEG) : () => null,
        find,
        recall,
        knownHazard,
        kinds,
    };
}
