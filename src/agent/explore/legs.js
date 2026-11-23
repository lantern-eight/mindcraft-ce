// SPDX-License-Identifier: CC0-1.0
// The real legs the explorer walks on: the pathfinder for walking, world.js for seeing, world memory (when on)
// for knowing which land is new.
//
// Nothing here looks at the world except through world.js, so under fair play every answer is what the bot
// perceives or remembers, and every route is planned by fair legs like any other walk. With fair play off it
// is stock Mindcraft's view of the world, as every other command has.
import pf from 'mineflayer-pathfinder';
import * as world from '../library/world.js';
import { squareCorners } from '../library/skills.js';
import { lookBeforeSearch } from '../library/search_look.js';
import { newGroundAlong } from './heading.js';
import { LEG } from './explorer.js';

const STALL_MS = 8000;         // a leg that hasn't moved a block in this long is stuck: end it and try another way
const SWIM_MS = 5000;          // swimming this long in one leg is setting out to sea, not crossing a stream
const WATCH_MS = 250;
const SIGHT = 64;              // how far a thing looked for counts as found: as far as the searches look

/**
 * The movements a leg walks with. Exploring goes over or round what is in the way, as a person does on foot:
 * it may break leaves (a forest's canopy comes down to the ground in places) and place a block to step up,
 * and it never digs into the ground. Water costs more than land, so a lake is walked round when it can be.
 * `goToGoal` is not used: its gentle try still digs, only at a higher price, so an explorer would tunnel.
 */
export function exploreMovements(bot) {
    const moves = squareCorners(new pf.Movements(bot));
    moves.exclusionAreasBreak.push(block => (/leaves/.test(block?.name ?? '') ? 0 : 100));
    moves.placeCost = 2;
    moves.liquidCost = 5;
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
 */
export function realLegs(bot, { targets = null, memory = null } = {}) {
    const position = () => bot.entity.position;
    const here = () => ({ x: position().x, y: position().y, z: position().z });

    async function walk(point) {
        if (bot.interrupt_code) return 'interrupted';
        bot.pathfinder.setMovements(exploreMovements(bot));
        let outcome = null;
        let mark = position().clone(), markAt = Date.now(), swum = 0, last = Date.now();
        // Felt, not seen: the block the bot's feet are in.
        const inWater = () => {
            const p = position();
            return /water/.test(world.getBlockAtPosition(bot, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))?.name ?? '');
        };
        const watch = setInterval(() => {
            const now = Date.now();
            if (inWater()) swum += now - last;
            last = now;
            if (position().distanceTo(mark) >= 1) { mark = position().clone(); markAt = now; }
            const stop = swum > SWIM_MS ? 'water' : now - markAt > STALL_MS ? 'stalled' : null;
            if (stop && !outcome) { outcome = stop; bot.pathfinder.setGoal(null); }
        }, WATCH_MS);
        try {
            await bot.pathfinder.goto(new pf.goals.GoalNearXZ(point.x, point.z, 2));
            return 'arrived';
        } catch (error) {
            if (bot.interrupt_code) return 'interrupted';
            if (outcome) return outcome;
            if (/NoPath|Timeout/i.test(error?.name ?? '') || /no path|timeout|took to long/i.test(error?.message ?? '')) return 'no_path';
            return 'stalled';
        } finally {
            clearInterval(watch);
        }
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
        newGround: memory?.cells ? angle => newGroundAlong((cx, cy, cz) => memory.cells.lookedAt(cx, cy, cz), here(), angle, LEG) : () => null,
        find,
        recall,
    };
}
