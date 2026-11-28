// SPDX-License-Identifier: CC0-1.0
// Bone meal on a field's young crops, only when a player asks (`!boneMealField`).
//
// A crop ripens on its own, and bone meal is dear (a stack of seeds in a composter makes about two), so a
// player uses it when they want food now. The bot does the same and no more: never on its own idea. It
// works one plant at a time until it is ripe, as a player does, rather than spreading the bone meal thin
// over plants none of which then ripen. It cuts nothing: the ripe plants are left for `!tendField`.
//
// Like a round of tending, it goes by what the bot sees: the field is found the same way, it walks the field
// on the same rules (never jumping onto the farmland), and a plant's stage is read only from a plant in view.
// Each click goes through the reach rule.
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import { cropOfBlock } from './crops.js';
import { fieldBox, findField } from './field.js';
import { mayTend } from './field_book.js';
import { FIELD_RANGE, blockReader, counts, findStart, lookAt, stopped, until, walkTo } from './tend.js';
import { visitOrder } from './visit_order.js';

/** How long the bot waits for the server to take a bone meal. */
const CLICK_MS = 1200;
/** The longest a field gets bone meal, however much the bot carries. */
const MAX_MS = 5 * 60_000;

const posKey = c => `${c.x},${c.y},${c.z}`;
// A crop that ripens in its own block. A melon or pumpkin stem grows fruit beside it, which bone meal on the
// stem only sometimes makes: not worth spending it on.
const growsInPlace = name => { const row = cropOfBlock(name); return Boolean(row) && !row.fruit; };

/**
 * Uses bone meal on the young crops of the field nearest the bot.
 * @param {object} bot
 * @param {object} options
 * @param {number} [options.count] - the most bone meal to use; all the bot carries by default
 * @param {object} options.book - the field book for this world
 * @param {{asked?: boolean|null}} [options.behind] - who is behind the request
 * @param {object|null} [options.memory] - world memory, to walk to a remembered field when none is in view
 */
export async function boneMealField(bot, { count = Infinity, book, behind = {}, memory = null } = {}) {
    assertActionOwner(bot);
    if (behind.asked === false) {
        return toolResult('blocked', 'You use bone meal only when a player asks: crops ripen on their own, and bone meal is hard to come by.', 'not_asked');
    }
    const have = () => counts(bot).bone_meal ?? 0;
    if (!have()) return toolResult('failed', 'You have no bone_meal. !compost makes it from spare seeds at a composter.', 'missing_items');

    const read = blockReader(bot);
    const { start, how } = await findStart(bot, memory);
    if (!start) {
        const text = how === 'gone'
            ? 'You walked to the field you remembered, but see no farmland there now.'
            : `You see no farmland within ${FIELD_RANGE} blocks${memory ? ' and remember no field nearby' : ''}.`;
        return toolResult('failed', text, 'no_field');
    }
    const field = findField(read, start);
    const box = fieldBox(field.cells);
    const where = `${box.min.x}, ${box.min.y}, ${box.min.z} to ${box.max.x}, ${box.max.y}, ${box.max.z}`;
    const whose = book.whose(field.cells);
    if (!mayTend(whose, behind).ok) {
        return toolResult('blocked', `The field at ${where} is not yours to tend unasked. Have a player ask you to.`, 'not_yours');
    }

    // The plants to go to: every crop not seen ripe. One not seen now is looked at when the bot gets there.
    const todo = field.cells.filter(c => growsInPlace(c.above) && c.ripe !== true);
    const before = have();
    const budget = Math.min(count, before);
    const deadline = Date.now() + MAX_MS;
    const tally = { ripened: new Set(), grew: new Set(), unreached: new Set(), refused: new Set() };
    let stopReason = null;
    for (const cell of visitOrder(todo, bot.entity.position)) {
        if (stopped(bot)) { stopReason = 'stopped'; break; }
        if (Date.now() > deadline) { stopReason = 'time'; break; }
        if (before - have() >= budget || !have()) break;
        assertActionOwner(bot);
        if (!(await walkTo(bot, field, cell))) { tally.unreached.add(posKey(cell)); continue; }
        await lookAt(bot, cell);
        let misses = 0;
        // One plant until it is ripe, the bone meal runs out, or the server stops taking it.
        while (!stopped(bot) && before - have() < budget) {
            const now = read(cell.x, cell.y + 1, cell.z);
            if (!now || !growsInPlace(now.name) || now.ripe !== false) break;
            const meal = bot.inventory.items().find(i => i.name === 'bone_meal');
            if (!meal) break;
            const held = have();
            try {
                await bot.equip(meal, 'hand');
                await bot.activateBlock(now.block);
            } catch { misses++; }
            if (await until(bot, () => have() < held, CLICK_MS)) { tally.grew.add(posKey(cell)); misses = 0; }
            else if (++misses >= 2) { tally.refused.add(posKey(cell)); break; }
        }
        // The stage the server shows a moment later.
        await until(bot, () => read(cell.x, cell.y + 1, cell.z)?.ripe === true, 400);
        if (read(cell.x, cell.y + 1, cell.z)?.ripe === true && tally.grew.has(posKey(cell))) {
            tally.grew.delete(posKey(cell));
            tally.ripened.add(posKey(cell));
        }
    }

    const used = before - have();
    let text = `Used ${used} bone_meal on the field at ${where}`;
    if (!todo.length) text = `Nothing in the field at ${where} needs bone meal: every crop you see there is ripe, or nothing grows there`;
    const parts = [];
    if (tally.ripened.size) parts.push(`${tally.ripened.size} plant${tally.ripened.size === 1 ? ' is' : 's are'} ripe now`);
    if (tally.grew.size) parts.push(`${tally.grew.size} grew but ${tally.grew.size === 1 ? 'is' : 'are'} not ripe yet`);
    if (tally.unreached.size) parts.push(`${tally.unreached.size} out of reach`);
    if (tally.refused.size) parts.push(`${tally.refused.size} took no bone meal`);
    text += (parts.length ? `: ${parts.join(', ')}` : '') + `. You have ${have()} bone_meal left.`;
    if (tally.ripened.size) text += ' !tendField harvests what is ripe.';
    if (stopReason === 'stopped') return toolResult('cancelled', `${text} Stopped.`, 'interrupted');
    if (stopReason === 'time') return toolResult('partial', `${text} Stopped: it took too long.`, 'incomplete');
    if (!used && todo.length) return toolResult('failed', text, 'incomplete');
    return toolResult('ok', text);
}
