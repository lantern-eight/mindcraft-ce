// SPDX-License-Identifier: CC0-1.0
// Making a field: till ground the bot can see and sow it, the way a careful player does.
//
// A player making a field picks wet, free soil (ground.js), makes a field they already have bigger rather than
// starting a second one beside it, and keeps off a neighbour's field. They till only as much as they have seed
// for, because bare farmland turns back to dirt, and they walk on what they have tilled without jumping on it.
// The new farmland goes in the field book: the bot's own, or the player's who asked for it, like a field
// tended at a player's asking.
//
// Everything it knows comes through world.js (perception, with fair play on), every walk is planned by the
// pathfinder on the field's own rules, and every stroke of the hoe and every seed goes through the reach
// guard like any other click.
import Vec3 from 'vec3';
import { assertActionOwner } from '../action_context.js';
import { editionOf } from '../edition/index.js';
import { lookBeforeSearch } from '../library/search_look.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { toolResult } from '../tool_result.js';
import { CROPS, bestHoe, cropOf } from './crops.js';
import { ME, mayTend } from './field_book.js';
import { fieldBox, findField } from './field.js';
import { GROUND_RANGE, TWO_STROKES, WEEDS, chooseGround } from './ground.js';
import { blockReader, counts, lookAt, ownerText, plant, stopped, until, walkTo } from './tend.js';
import { visitOrder } from './visit_order.js';

/** The most cells one call tills. */
export const MAX_SOW = 64;
const BASE_MS = 60_000, PER_CELL_MS = 6000, MAX_MS = 10 * 60_000;
const STROKE_MS = 1000, WEED_MS = 1000;
const posKey = p => `${p.x},${p.y},${p.z}`;

/** The seed to sow: the one asked for, else the one held most of. Null when the bag holds none. */
function seedFor(bot, wanted) {
    const held = counts(bot);
    if (wanted) {
        const row = cropOf(wanted);
        return row && (held[row.seed] ?? 0) > 0 ? row.seed : null;
    }
    let best = null;
    // Not melon or pumpkin seed: a field sown full of stems leaves their fruit nowhere to grow.
    for (const row of CROPS) if (!row.fruit && (held[row.seed] ?? 0) > (best ? held[best] : 0)) best = row.seed;
    return best;
}

/** The fields the bot knows near it, each as findField gives it, nearest first. */
function fieldsNear(bot, read, range) {
    const edition = editionOf(bot.registry);
    const isFarmland = block => edition.javaNameOf(bot.registry, block?.name) === 'farmland';
    const farmland = world.getNearestBlocksWhere(bot, isFarmland, range, 4096);
    const grouped = new Set();
    const fields = [];
    for (const block of farmland) {
        if (grouped.has(posKey(block.position))) continue;
        const field = findField(read, block.position);
        for (const c of field.cells) grouped.add(posKey(c));
        if (field.cells.length) fields.push(field);
    }
    return fields;
}

/** What the bot says when there is nowhere to till. */
function nowhereText(why) {
    if (why === 'no_water') {
        return `You see no water within ${GROUND_RANGE} blocks. Farmland dries out without water within 4 blocks of it, at its level or one above: `
            + 'go near water (or place some), look around, then try again.';
    }
    return `You see no free soil within 4 blocks of the water near you: grass or dirt with room above it, not a path, a build or `
        + 'a field you may not tend. Go to other water, or clear some ground, then try again.';
}

/**
 * Tills and sows ground near the bot: the field it may tend nearest it made bigger, or a new field by water.
 * @param {object} bot
 * @param {object} options
 * @param {string|null} [options.seed] - what to sow (a seed or crop name); by default the seed held most of
 * @param {number} [options.size] - how many cells to till at most
 * @param {object} options.book - the field book for this world
 * @param {{asked?: boolean|null, by?: string|null}} [options.behind] - who asked, from the request watcher
 * @param {string} [options.name] - the bot's own name
 * @param {(x: number, y: number, z: number, name: string) => boolean} [options.mayTill] - false for soil that
 *   is someone's (good-neighbor rules, world memory's "built")
 * @returns {Promise<{status: string, text: string}>}
 */
export async function sowField(bot, { seed = null, size = 9, book, behind = {}, name = '', mayTill = () => true } = {}) {
    assertActionOwner(bot);
    if (seed && !cropOf(seed)) {
        return toolResult('failed', `"${seed}" is not something you can sow on farmland. Use wheat_seeds, carrot, potato or beetroot_seeds, or leave it out.`, 'bad_args');
    }
    if (cropOf(seed)?.fruit) {
        // Every stem needs a free block beside it for its fruit, which a field tilled edge to edge hasn't got.
        return toolResult('failed', `A ${cropOf(seed).fruit} stem bears its fruit on a free block beside it, and a field made by tilling leaves none. `
            + `Sow ${cropOf(seed).seed} on farmland with room around it instead: !tendField("${cropOf(seed).seed}") sows a field's empty farmland.`, 'bad_args');
    }
    const hoe = bestHoe(bot.inventory.items());
    if (!hoe) return toolResult('failed', 'You have no hoe to till the ground with. Get one (!getTool("hoe", "any")), then try again.', 'no_hoe');
    const sowing = seedFor(bot, seed);
    if (!sowing) {
        const text = seed ? `You have no ${cropOf(seed).seed} to sow.` : 'You have no seeds to sow (wheat_seeds, carrot, potato or beetroot_seeds).';
        return toolResult('failed', `${text} Bare farmland turns back to dirt, so you till only what you can sow. Get some seeds first.`, 'no_seed');
    }
    const wanted = Math.max(1, Math.min(MAX_SOW, Math.floor(Number(size) || 9), counts(bot)[sowing] ?? 0));

    const read = blockReader(bot);
    const from = bot.entity.position.floored();
    // The field to make bigger: the nearest one the bot may tend. Every other field is kept clear of.
    const plan = async () => {
        const fields = fieldsNear(bot, read, GROUND_RANGE + 4);
        let target = null, whose = null;
        for (const field of fields) {
            const said = book.whose(field.cells);
            if (!target && mayTend(said, behind).ok) { target = field; whose = said; }
        }
        const avoid = fields.filter(f => f !== target).flatMap(f => f.cells);
        return { target, whose, ...chooseGround(read, { from, size: wanted, field: target?.cells ?? [], avoid, mayTill }) };
    };
    let choice = await plan();
    if (choice.why === 'no_water' || choice.why === 'no_ground') {
        // Water or soil may be about, out of sight: look round once, as a player would.
        if (await lookBeforeSearch(bot, null)) choice = await plan();
    }
    if (!choice.cells.length) return toolResult('blocked', nowhereText(choice.why), choice.why);

    const { target, whose } = choice;
    const owner = target
        ? (whose?.owner ?? (behind.asked === true && behind.by ? behind.by : null))
        : (behind.asked === true && behind.by ? behind.by : ME);

    const deadline = Date.now() + Math.min(MAX_MS, BASE_MS + PER_CELL_MS * choice.cells.length);
    const tilled = [], sown = [], unreached = [], notTilled = [], didNotTake = [];
    let stopReason = null;
    // The farmland the walks keep off: the field being made bigger, and each cell as it is tilled.
    const plot = { cells: [...(target?.cells ?? [])], between: choice.water.map(w => ({ ...w, name: 'water' })) };

    for (const cell of visitOrder(choice.cells, bot.entity.position)) {
        if (stopped(bot)) { stopReason = 'stopped'; break; }
        if (Date.now() > deadline) { stopReason = 'time'; break; }
        if (!(counts(bot)[sowing] > 0)) { stopReason = 'seeds'; break; }
        assertActionOwner(bot);
        if (!(await walkTo(bot, plot, cell))) { unreached.push(cell); continue; }
        await lookAt(bot, cell);
        // What is there now, seen from here: the plan was made from what was known before.
        const above = read(cell.x, cell.y + 1, cell.z);
        if (above && WEEDS.includes(above.name) && above.block) {
            try { await bot.dig(above.block, true); } catch (error) {
                if (stopped(bot)) { stopReason = 'stopped'; break; }
                skills.log(bot, `Could not cut the ${above.name} at ${cell.x}, ${cell.y + 1}, ${cell.z}: ${error.message}`);
            }
            await until(bot, () => !WEEDS.includes(read(cell.x, cell.y + 1, cell.z)?.name), WEED_MS);
        }
        if (!(await till(bot, read, cell, hoe))) {
            if (stopped(bot)) { stopReason = 'stopped'; break; }
            notTilled.push(cell);
            continue;
        }
        tilled.push(cell);
        plot.cells.push({ x: cell.x, y: cell.y, z: cell.z });
        if (await plant(bot, read, cell, sowing)) sown.push(cell);
        else didNotTake.push(cell);
    }

    // The new farmland is the field's owner's, or, for a new field, the bot's own or the player's who asked.
    if (owner && tilled.length) book.mark(tilled, { owner });
    return report({ tilled, sown, unreached, notTilled, didNotTake, sowing, target, owner, name, stopReason, water: choice.water });
}

/** Turns one cell of soil into farmland: one stroke of the hoe, two for coarse or rooted dirt. True when it is farmland. */
async function till(bot, read, cell, hoe) {
    const item = bot.inventory.items().find(i => i.name === hoe);
    if (!item) return false;
    for (let stroke = 0; stroke < 2; stroke++) {
        const ground = read(cell.x, cell.y, cell.z);
        if (ground?.name === 'farmland') return true;
        if (!ground?.block || (stroke === 1 && ground.name !== 'dirt')) return false;
        try {
            await bot.equip(item, 'hand');
            await bot.activateBlock(ground.block, new Vec3(0, 1, 0));
        } catch (error) {
            if (stopped(bot)) return false;
            skills.log(bot, `Could not till the ${ground.name} at ${cell.x}, ${cell.y}, ${cell.z}: ${error.message}`);
            return false;
        }
        const was = ground.name;
        await until(bot, () => read(cell.x, cell.y, cell.z)?.name !== was, STROKE_MS);
        if (!TWO_STROKES.includes(was)) break;
    }
    return read(cell.x, cell.y, cell.z)?.name === 'farmland';
}

const where = cells => {
    const box = fieldBox(cells);
    return box ? `${box.min.x}, ${box.min.y}, ${box.min.z} to ${box.max.x}, ${box.max.y}, ${box.max.z}` : '';
};

function report({ tilled, sown, unreached, notTilled, didNotTake, sowing, target, owner, name, stopReason, water }) {
    const parts = [];
    if (!tilled.length) {
        parts.push('You tilled nothing.');
    } else {
        const what = target ? `Made the field beside you bigger by ${tilled.length} farmland` : `Made a field of ${tilled.length} farmland`;
        parts.push(`${what} at ${where(tilled)}, and sowed ${sown.length} with ${sowing}. ${ownerText(owner, name).replace(/^./, c => c.toUpperCase())}.`);
        const wet = water[0];
        if (wet) parts.push(`The water at ${wet.x}, ${wet.y}, ${wet.z} keeps it wet.`);
    }
    if (unreached.length) parts.push(`Could not reach ${unreached.length} of the ground you chose.`);
    if (notTilled.length) parts.push(`${notTilled.length} would not till (something stood on it, or it was out of reach).`);
    if (didNotTake.length) parts.push(`${didNotTake.length} tilled but not sown: sow them with !tendField, or they turn back to dirt.`);
    if (stopReason === 'seeds') parts.push(`You ran out of ${sowing}.`);
    if (stopReason === 'time') parts.push('You stopped: it was taking too long.');
    const left = unreached.length + notTilled.length + didNotTake.length;
    const status = !tilled.length ? 'failed' : stopReason || left ? 'partial' : 'ok';
    return toolResult(status, parts.join(' '), status === 'failed' ? 'not_tilled' : undefined);
}
