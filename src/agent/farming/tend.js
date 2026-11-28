// SPDX-License-Identifier: CC0-1.0
// One round of tending a field: harvest what is ripe, replant it, sow the empty farmland, pick up the drops.
//
// It goes about it the way a player does. The field is the farmland the bot can see (or remembers), not a
// box read out of the world; a crop is cut only once the bot has seen that it is ripe, which means looking
// at it, since nobody remembers the age of every plant; and the bot walks on the field the way a careful
// player does, never jumping or dropping onto farmland, which would trample it back to dirt.
//
// Everything it knows of the world comes through world.js (perception, with fair play on): blocks by
// `worldQueries().blockAt`, dropped items by `world.getNearbyEntities`. Every walk is planned by the
// pathfinder, so fair play's route planning covers it, and every break and click goes through the reach
// guard like any other. The work loop follows akarkin1/mindcraft-fk's `harvestWork` (MIT, see
// ATTRIBUTION.md): visit the ripe cells in a plough's order, break, wait for the seeds, replant.
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import { actionContext, assertActionOwner, cancellable } from '../action_context.js';
import { editionOf } from '../edition/index.js';
import { lookBeforeSearch } from '../library/search_look.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { propsOfState } from '../memory/block_state.js';
import { isCrop, isRipe } from '../memory/kinds.js';
import { toolResult } from '../tool_result.js';
import { cellPlan, cropOf, cropOfBlock, keepHarvesting, seedsOwed, seedToSow } from './crops.js';
import { harvestPlan } from './harvest_plan.js';
import { visitOrder } from './visit_order.js';
import { ME, SHARED, mayTend, sameOwner } from './field_book.js';
import { fieldBox, findField, NO_STEP, stepCost } from './field.js';

/** How far from the bot a field is looked for among what it perceives. */
export const FIELD_RANGE = 32;
/** How far a remembered field may be for the bot to walk to it. */
export const REMEMBERED_RANGE = 128;
// Time: a start, plus a little per cell, and never more than this, so a huge field can't hold the bot.
const BASE_MS = 60_000, PER_CELL_MS = 4000, MAX_MS = 10 * 60_000;
// One walk to a cell, and the wait for a crop's drops and for a planted seed to show.
const WALK_MS = 15_000, DROPS_MS = 1500, PLANT_MS = 1000;
// How close to stand to the crop being worked: within reach, and near enough to step onto its drops.
const WORK_DISTANCE = 2;
// Passes over the field: later passes take in cells that came into view during the first.
const PASSES = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const posKey = p => `${p.x},${p.y},${p.z}`;

/**
 * What the bot knows is at a cell, in Java's names: null when it doesn't know. A crop seen now carries
 * whether it is ripe; a remembered one doesn't, because memory keeps no plant's age.
 */
export function blockReader(bot) {
    const edition = editionOf(bot.registry);
    return (x, y, z) => {
        const block = worldQueries().blockAt(bot, new Vec3(x, y, z));
        if (!block || block.name === 'unknown') return null;
        const name = edition.javaNameOf(bot.registry, block.name);
        const seenNow = block.rememberedAt === undefined;
        const ripe = isCrop(block.name) && seenNow && Number.isFinite(block.stateId)
            ? isRipe(block.name, propsOfState(bot.registry, block.stateId)) : null;
        return { name, ripe, block };
    };
}

/**
 * The pathfinder's rules for walking on and around a field: no digging, no placing, no parkour, no
 * sprinting among the plants; never a step that could land on the farmland (field.js `stepCost`), and
 * never into the field's water, which a player climbs out of onto the farmland.
 */
export function fieldMovements(bot, field) {
    const m = new pf.Movements(bot);
    m.canDig = false;
    m.allowParkour = false;
    m.allowSprinting = false;
    m.allow1by1towers = false;
    m.scafoldingBlocks = [];
    m.maxDropDown = 3;
    const onFarmland = stepCost(field.cells);
    const water = new Set(field.between.filter(c => c.name === 'water').flatMap(c => [posKey(c), posKey({ ...c, y: c.y + 1 })]));
    m.exclusionAreasStep.push(onFarmland);
    m.exclusionAreasStep.push(block => {
        const p = block?.position ?? block;
        return p && water.has(posKey({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })) ? NO_STEP : 0;
    });
    return m;
}

export const stopped = bot => Boolean(bot.interrupt_code || actionContext(bot)?.signal.aborted);

const eyeOf = bot => bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
const distanceFromEye = (bot, cell) => eyeOf(bot).distanceTo(new Vec3(cell.x + 0.5, cell.y + 1.25, cell.z + 0.5));

/** The farmland nearest the bot that it perceives (in view now, or remembered), or null. */
export function nearestFarmland(bot, range = FIELD_RANGE) {
    const edition = editionOf(bot.registry);
    const isFarmland = block => edition.javaNameOf(bot.registry, block?.name) === 'farmland';
    return world.getNearestBlocksWhere(bot, isFarmland, range, 1)[0] ?? null;
}

/**
 * Finds the field to work: the farmland nearest the bot that it perceives, looking round first when
 * there is none near, and with world memory, walking to the nearest remembered field.
 * @returns {Promise<{start: object|null, how: string}>}
 */
async function findStart(bot, memory) {
    const nearest = () => nearestFarmland(bot);
    let farmland = nearest();
    if (!farmland || bot.entity.position.distanceTo(farmland.position) > 6) {
        if (await lookBeforeSearch(bot, farmland?.position)) farmland = nearest() ?? farmland;
    }
    if (farmland) return { start: farmland.position, how: 'seen' };
    const fields = memory?.things?.fieldsNear?.(bot.entity.position, { maxDistance: REMEMBERED_RANGE, limit: 10 }) ?? [];
    const target = fields.find(f => f.ripe > 0) ?? fields[0];
    if (!target) return { start: null, how: 'none' };
    await skills.goToGoal(bot, new pf.goals.GoalNear(Math.round(target.x), Math.round(target.y), Math.round(target.z), 4));
    assertActionOwner(bot);
    await lookBeforeSearch(bot, null);
    farmland = nearest();
    return farmland ? { start: farmland.position, how: 'remembered' } : { start: null, how: 'gone' };
}

/**
 * Keeps the bot from jumping until the returned function is called.
 *
 * The pathfinder presses jump on its own between the steps it planned: when it reckons that walking straight
 * on won't reach the next step (the bot stands at the edge of the field's water, or on the line between two
 * cells), and whenever the bot is in water. Among the crops that jump comes down on farmland and tramples
 * it, whatever the plan said. So while walking a field a press of jump is let through as a release: a step
 * that needs a jump isn't made, the walk ends short, and the cell is reported out of reach.
 */
export function noJumping(bot) {
    const press = bot.setControlState;
    const guarded = function (control, state) { return press.call(this, control, control === 'jump' ? false : state); };
    bot.setControlState = guarded;
    press.call(bot, 'jump', false);
    return () => { if (bot.setControlState === guarded) bot.setControlState = press; };
}

/** Walks within `distance` of a cell's crop, on the field's own rules. True when there. */
export async function walkTo(bot, field, cell, distance = WORK_DISTANCE) {
    if (distanceFromEye(bot, cell) <= distance + 1) return true;
    const previous = bot.pathfinder.movements;
    bot.pathfinder.setMovements(fieldMovements(bot, field));
    const jumpAgain = noJumping(bot);
    try {
        await cancellable(bot, () => bot.pathfinder.goto(new pf.goals.GoalNear(cell.x, cell.y + 1, cell.z, distance)),
            WALK_MS, () => bot.pathfinder.setGoal(null));
    } catch {
        if (stopped(bot)) return false;
    } finally {
        jumpAgain();
        if (previous && !stopped(bot)) bot.pathfinder.setMovements(previous);
    }
    return distanceFromEye(bot, cell) <= distance + 1.5;
}

/** Turns to look at a cell's crop, so what stands there is seen now. */
export async function lookAt(bot, cell) {
    try { await bot.lookAt(new Vec3(cell.x + 0.5, cell.y + 1.2, cell.z + 0.5)); } catch { /* a turn cut short */ }
}

/** Waits until `test` holds, or `ms` passes. */
export async function until(bot, test, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (test()) return true;
        if (stopped(bot)) return false;
        await sleep(100);
    }
    return test();
}

export const counts = bot => world.getInventoryCounts(bot);

/** Picks up the dropped items lying on or beside a cell, walking onto them on the field's rules. */
async function collectDrops(bot, field, cell) {
    const near = item => Math.abs(item.position.x - (cell.x + 0.5)) <= 2.5 && Math.abs(item.position.z - (cell.z + 0.5)) <= 2.5
        && Math.abs(item.position.y - (cell.y + 1)) <= 2;
    const tried = new Set();
    for (let i = 0; i < 4 && !stopped(bot); i++) {
        const items = world.getNearbyEntities(bot, 8).filter(e => e.name === 'item' && !tried.has(e.id) && near(e));
        const item = items[0];
        if (!item) return;
        tried.add(item.id);
        const spot = { x: Math.floor(item.position.x), y: Math.floor(item.position.y) - 1, z: Math.floor(item.position.z) };
        // A drop floating in the field's water is picked up from beside it, as a player reaches over the edge:
        // walking onto it would leave the bot at the water's edge, or in it, with only a jump to get on.
        const inWater = field.between.some(c => c.name === 'water' && c.x === spot.x && c.z === spot.z && Math.abs(c.y - (spot.y + 1)) <= 1);
        await walkTo(bot, field, spot, inWater ? 1 : 0);
        await until(bot, () => item.isValid === false || !world.getNearbyEntities(bot, 8).some(e => e.id === item.id), 600);
    }
}

/** Breaks one ripe crop. True when it is gone. */
async function harvest(bot, read, cell, block) {
    try {
        await bot.dig(block, true);
    } catch (error) {
        if (stopped(bot)) return false;
        skills.log(bot, `Could not harvest the ${cell.above} at ${cell.x}, ${cell.y + 1}, ${cell.z}: ${error.message}`);
        return false;
    }
    return until(bot, () => read(cell.x, cell.y + 1, cell.z)?.name !== cell.above, 1000);
}

/** Plants a seed on one empty farmland cell. True when the crop shows. */
export async function plant(bot, read, cell, seed) {
    const row = cropOf(seed);
    const item = bot.inventory.items().find(i => i.name === seed);
    if (!row || !item) return false;
    const ground = read(cell.x, cell.y, cell.z);
    if (ground?.name !== 'farmland' || !ground.block) return false;
    try {
        await bot.equip(item, 'hand');
        await bot.activateBlock(ground.block, new Vec3(0, 1, 0));
    } catch (error) {
        if (stopped(bot)) return false;
        skills.log(bot, `Could not plant ${seed} at ${cell.x}, ${cell.y + 1}, ${cell.z}: ${error.message}`);
        return false;
    }
    return until(bot, () => cropOfBlock(read(cell.x, cell.y + 1, cell.z)?.name)?.seed === seed, PLANT_MS);
}

/** What the bag gained between two counts, as "12 wheat, 25 wheat_seeds". */
function gainText(before, after) {
    const parts = Object.keys(after).filter(k => (after[k] ?? 0) > (before[k] ?? 0)).sort()
        .map(k => `${after[k] - (before[k] ?? 0)} ${k}`);
    return parts.join(', ');
}

/** Whose a field is, in words. */
export function ownerText(owner, botName) {
    if (!owner) return 'nobody has said whose it is';
    if (sameOwner(owner, ME) || sameOwner(owner, botName)) return 'it is yours';
    if (sameOwner(owner, SHARED)) return 'it is shared';
    return `it is ${owner}'s`;
}

/**
 * Tends the field nearest the bot: harvests what it sees is ripe, replants it, sows empty farmland, picks
 * up what dropped, and says what it did and what is left.
 * @param {object} bot
 * @param {object} options
 * @param {string|null} [options.seed] - what to sow on empty farmland (a seed or crop name); by default
 *   what grows beside each cell, else the seed held most of
 * @param {object} options.book - the field book for this world
 * @param {{asked?: boolean|null, by?: string|null}} [options.behind] - who asked, from the request watcher
 * @param {string} [options.name] - the bot's own name, as players call it
 * @param {object|null} [options.memory] - world memory, to find a remembered field
 * @param {(cells: object[]) => () => void} [options.tending] - opens the field to good-neighbor rules for the
 *   round (neighborly.js), and returns its close
 * @param {Function|null} [options.store] - puts things away in the chests meant for them (library/store_way.js):
 *   with it, the round ends by taking the harvest to the field's chest
 * @returns {Promise<{status: string, text: string}>}
 */
export async function tendField(bot, { seed = null, book, behind = {}, name = '', memory = null, tending = () => () => {}, store = null } = {}) {
    assertActionOwner(bot);
    if (seed && !cropOf(seed)) {
        return toolResult('failed', `"${seed}" is not something you can sow on farmland. Use wheat_seeds, carrot, potato or beetroot_seeds, or leave it out.`, 'bad_args');
    }
    const read = blockReader(bot);
    const { start, how } = await findStart(bot, memory);
    if (!start) {
        const text = how === 'gone'
            ? 'You walked to the field you remembered, but see no farmland there now. Look around, or ask where the field is.'
            : `You see no farmland within ${FIELD_RANGE} blocks${memory ? ' and remember no field nearby' : ''}. Explore, or ask where the field is.`;
        return toolResult('failed', text, 'no_field');
    }
    let field = findField(read, start);
    const box = fieldBox(field.cells);
    const where = `${box.min.x}, ${box.min.y}, ${box.min.z} to ${box.max.x}, ${box.max.y}, ${box.max.z}`;

    // A player doesn't tend a stranger's field on their own idea. Asked by a player, the bot does.
    const whose = book.whose(field.cells);
    const may = mayTend(whose, behind);
    if (!may.ok) {
        const text = may.why === 'unknown'
            ? `The field at ${where} is not yours and nobody has said whose it is, so you leave it alone. Ask whose it is, or have a player ask you to tend it.`
            : `The field at ${where} is ${whose.owner}'s, and they have not said you may tend it whenever you like. Leave it, or have a player ask you to.`;
        return toolResult('blocked', text, 'not_yours');
    }

    // Good-neighbor rules let the bot cut this field's crops while the round lasts: it may tend the field, and
    // leaves it replanted. Closed again however the round ends.
    const closes = [tending(field.cells)];
    try {
        const deadline = Date.now() + Math.min(MAX_MS, BASE_MS + PER_CELL_MS * field.cells.length);
        const before = counts(bot);
        const tally = { cut: {}, replanted: 0, sown: 0, unreached: new Set(), unseen: new Set(), noSeed: new Set(),
            young: new Set(field.cells.filter(c => c.ripe === false).map(posKey)), planted: new Set(), didNotTake: new Set() };
        // A cell cut this round, and the seed it is to be replanted with: if planting there fails, a later pass
        // tries again with the same seed, and counts it as replanted, not sown.
        const cutHere = new Map();
        let brokenSinceGain = 0, gainedSoFar = 0, stopReason = null;
        const done = new Set();

        for (let pass = 0; pass < PASSES && !stopReason; pass++) {
            const have = { seeds: counts(bot) };
            const todo = field.cells.filter(c => !done.has(posKey(c)) && cellPlan(c, have).length > 0);
            if (!todo.length) break;
            for (const cell of visitOrder(todo, bot.entity.position)) {
                if (stopped(bot)) { stopReason = 'stopped'; break; }
                if (Date.now() > deadline) { stopReason = 'time'; break; }
                assertActionOwner(bot);
                if (!(await walkTo(bot, field, cell))) { tally.unreached.add(posKey(cell)); continue; }
                await lookAt(bot, cell);
                // What stands there now, seen from here: the plan was made from what was known before.
                const above = read(cell.x, cell.y + 1, cell.z);
                const now = { ...cell, above: above?.name ?? null, ripe: above?.ripe ?? null };
                const plan = cellPlan(now, { seeds: counts(bot) });
                if (plan[0] === 'look') { tally.unseen.add(posKey(cell)); continue; }
                if (now.ripe === false && !tally.planted.has(posKey(cell))) tally.young.add(posKey(cell));
                tally.unseen.delete(posKey(cell));
                tally.unreached.delete(posKey(cell));
                done.add(posKey(cell));
                let seedHere = null;
                if (plan[0] === 'harvest') {
                    const row = cropOfBlock(now.above);
                    if (!(await harvest(bot, read, now, above.block))) continue;
                    tally.cut[row.block] = (tally.cut[row.block] ?? 0) + 1;
                    cutHere.set(posKey(cell), row.seed);
                    // The drops show a moment after the crop goes; the seed to replant with comes from them.
                    const seedBefore = counts(bot)[row.seed] ?? 0;
                    await sleep(400);
                    await collectDrops(bot, field, cell);
                    await until(bot, () => (counts(bot)[row.seed] ?? 0) > seedBefore, DROPS_MS);
                    const after = counts(bot);
                    const total = Object.values(after).reduce((a, b) => a + b, 0) - Object.values(before).reduce((a, b) => a + b, 0)
                        + tally.replanted + tally.sown;
                    if (total > gainedSoFar) { gainedSoFar = total; brokenSinceGain = 0; } else brokenSinceGain++;
                    seedHere = row.seed;
                } else if (plan[0] === 'plant' && cutHere.has(posKey(cell))) {
                    // Cut earlier in this round and still bare: its planting didn't take, or its seed hadn't
                    // dropped yet. The same seed again, from what lies about it if the bag has none.
                    seedHere = cutHere.get(posKey(cell));
                    if (!counts(bot)[seedHere]) await collectDrops(bot, field, cell);
                } else if (plan[0] === 'plant') {
                    // Empty farmland: sow, holding back a seed for each ripe crop still to be replanted.
                    const owed = seedsOwed(field.cells.filter(c => !done.has(posKey(c))));
                    // And one for each cell cut this round that is still bare, waiting for its seed.
                    for (const [key, cutSeed] of cutHere) if (!tally.planted.has(key)) owed[cutSeed] = (owed[cutSeed] ?? 0) + 1;
                    const spare = Object.fromEntries(Object.entries(counts(bot)).map(([k, v]) => [k, v - (owed[k] ?? 0)]));
                    seedHere = seedToSow(now, field.cells, spare, seed);
                    if (!seedHere) { tally.noSeed.add(posKey(cell)); tally.didNotTake.delete(posKey(cell)); continue; }
                }
                if (seedHere) {
                    const key = posKey(cell);
                    if (!counts(bot)[seedHere]) {
                        tally.noSeed.add(key);
                        tally.didNotTake.delete(key);
                        // A crop's seed can drop after the wait for it, to be picked up later: try again next pass.
                        if (cutHere.has(key)) done.delete(key);
                    }
                    else if (await plant(bot, read, cell, seedHere)) {
                        if (cutHere.has(key)) tally.replanted++; else tally.sown++;
                        tally.noSeed.delete(key);
                        tally.didNotTake.delete(key);
                        tally.planted.add(key);
                        cell.above = cropOfBlock(read(cell.x, cell.y + 1, cell.z)?.name)?.block ?? cell.above;
                        cell.ripe = false;
                    } else if (!stopped(bot)) {
                        // The seed was held but nothing grew there (the click went astray, or the server was
                        // slow to show it). A player would try again; so does the next pass.
                        tally.didNotTake.add(key);
                        done.delete(key);
                    }
                }
                if (!keepHarvesting(brokenSinceGain)) { stopReason = 'no_gain'; break; }
            }
            // More of the field may have come into view on the way round: look it over again.
            if (!stopReason) {
                field = findField(read, start);
                closes.push(tending(field.cells)); // what came into view is the same field
                for (const c of field.cells) if (c.ripe === false && !tally.planted.has(posKey(c))) tally.young.add(posKey(c));
            }
        }

        // What lies on the field still: drops that rolled off while the bot worked elsewhere.
        if (!stopped(bot)) for (const cell of field.cells.slice(0, 1)) await collectDrops(bot, field, cell);

        // A field tended at a player's request, that nobody had said anything about, is that player's.
        if (behind.asked === true && behind.by) book.claimUnknown(field.cells, behind.by);

        const result = report(bot, { field, where, whose, tally, before, stopReason, name });
        if (!store || stopped(bot) || stopReason === 'stopped') return result;
        const stored = await storeHarvest(bot, field, book.whose(field.cells), behind, store);
        return stored ? { ...result, text: `${result.text}\n${stored}` } : result;
    } finally { for (const close of closes) close(); }
}

/** How far from the bot, at the end of a round, a chest counts as the field's. */
export const FIELD_CHEST_RANGE = 16;

/**
 * Takes the harvest to the chests near the field that are meant for it, keeping seed and food
 * (harvest_plan.js). Whose chests follows whose the field is: the bot's own, shared, or nobody's field fills
 * the bot's own and shared chests; a player's field fills that player's, and only when a player asked.
 * @returns {Promise<string|null>} what to add to the round's report, or null when nothing was meant to go anywhere
 */
export async function storeHarvest(bot, field, whose, behind, store) {
    // What can be eaten, from the edition seam: Bedrock's game data has no food table of its own.
    const foods = editionOf(bot.registry).foodsOf(bot.registry);
    const plan = harvestPlan(counts(bot), field.cells, { isFood: name => Boolean(foods[name]) });
    if (!plan.store.length) return null;
    const owner = whose?.owner;
    const mine = !owner || sameOwner(owner, ME) || sameOwner(owner, SHARED);
    let result;
    try {
        result = await store(plan.store, { whose: mine ? 'any' : owner, distance: FIELD_CHEST_RANGE, asked: behind?.asked ?? null });
    } catch (error) {
        if (stopped(bot)) return null;
        return `Could not put the harvest away: ${error.message}`;
    }
    if (!result || result.status === 'none' || !result.text) return null;
    const kept = plan.keep.length ? `\nKept on you, to sow the field again and to eat: ${plan.keep.map(({ name, count }) => `${name} ${count}`).join(', ')}.` : '';
    return `The harvest, to the field's chest: ${result.text}${result.stored ? kept : ''}`;
}

function report(bot, { field, where, whose, tally, before, stopReason, name }) {
    const after = counts(bot);
    const gained = gainText(before, after);
    const cut = Object.values(tally.cut).reduce((a, b) => a + b, 0);
    const cutText = Object.entries(tally.cut).map(([block, n]) => `${n} ${block}`).join(', ');
    const unripe = tally.young.size;
    const parts = [`The field at ${where} has ${field.cells.length} farmland (${ownerText(whose.owner, name)}).`];
    if (cut) parts.push(`Harvested ${cutText}${gained ? `, and gained ${gained}` : ', but none of it reached your inventory'}.`);
    else parts.push('Nothing in it was ripe.');
    if (tally.replanted) parts.push(`Replanted ${tally.replanted}.`);
    if (tally.sown) parts.push(`Sowed ${tally.sown} empty farmland.`);
    if (unripe) parts.push(`${unripe} not ripe yet, left to grow.`);
    if (tally.noSeed.size) parts.push(`${tally.noSeed.size} farmland left empty: no seed for it.`);
    if (tally.didNotTake.size) parts.push(`${tally.didNotTake.size} farmland left empty: planting there did not take, try again.`);
    if (tally.unreached.size) parts.push(`Could not reach ${tally.unreached.size} cells without jumping or dropping onto the farmland.`);
    if (tally.unseen.size) parts.push(`Could not see ${tally.unseen.size} cells to tell what grows there.`);
    if (field.unknownEdge) parts.push('More farmland may lie beyond what you have seen of it.');
    if (stopReason === 'no_gain') parts.push('Stopped: the crops you broke gave you nothing, so you stopped before breaking more.');
    if (stopReason === 'time') parts.push('Stopped: that took too long; tend it again to go on.');
    const text = parts.join(' ');
    if (stopReason === 'stopped') return toolResult('cancelled', text);
    if (cut && !gained) return toolResult('failed', text, 'no_gain');
    const left = tally.noSeed.size + tally.unreached.size + tally.unseen.size;
    return toolResult(stopReason || left ? 'partial' : 'ok', text);
}
