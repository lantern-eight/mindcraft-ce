// SPDX-License-Identifier: CC0-1.0
// The real legs the explorer walks on: the pathfinder for walking, world.js for seeing, world memory (when on)
// for knowing which land is new.
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
            await bot.pathfinder.goto(new pf.goals.GoalNearXZ(point.x, point.z, 2));
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
    };
}
