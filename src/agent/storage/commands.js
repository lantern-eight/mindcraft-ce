// SPDX-License-Identifier: CC0-1.0
// What the model can ask of chest sorting, and how the answer reads.
//
//   !sortChests(distance)   tidies every chest and barrel the bot can see or remember within that many
//                           blocks: part stacks merged, each kind of item together, related kinds in
//                           the same chest
//
// The model only decides to ask. Which stack goes where is worked out in code (sort_plan.js) and done
// by the bot's own clicks (sorter.js, bot_hands.js), so the same mess is always sorted the same way,
// and a sort can be tested without a model.
import Vec3 from 'vec3';
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { botHands } from './bot_hands.js';
import { chestsFrom, isSortable, SORTABLE } from './chests.js';
import { GROUPS, groupOf as groupByName, grouper } from './item_groups.js';
import { runSort } from './sorter.js';

// How long a walk to a chest may take before it is called off: a start, plus time for each block of the way.
const WALK_MS = 8000, WALK_MS_PER_BLOCK = 1500;

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const labelOf = chest => `${chest.also ? 'double ' : ''}${chest.name ?? 'chest'} at ${chest.x}, ${chest.y}, ${chest.z}`;

/**
 * The report of a sort, as the model reads it: what was done, then one line per chest saying what
 * kinds of thing it holds now. That last part is what lets the model answer "where are the tools?"
 * without opening anything.
 * @param {object} report - from runSort
 * @param {object} [options]
 * @param {(name: string) => string} [options.groupOf] - the grouping the sort used
 */
export function sortText(report, { groupOf = groupByName } = {}) {
    const sorted = report.chests.length, all = sorted + report.skipped.length;
    const these = n => (n === 1 ? 'the chest' : `the ${n} chests`);
    const lines = [];
    if (!sorted) {
        lines.push(`Could not open ${all === 1 ? 'the chest' : `any of the ${all} chests`} here.`);
    } else if (!report.done) {
        lines.push(`Stopped before ${these(sorted)} ${sorted === 1 ? 'was' : 'were'} in order: what was inside kept turning out different from what `
            + 'you had just seen, as if someone else is using them. Nothing was lost.');
        if (report.carrying.length) {
            const totals = new Map();
            for (const stack of report.carrying) totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
            lines.push(`You are still carrying what you took out and could not put back: ${[...totals].map(([name, n]) => `${name} ${n}`).join(', ')}.`);
        }
    } else if (!report.moves) {
        lines.push(`${these(sorted).replace(/^t/, 'T')} here ${sorted === 1 ? 'is' : 'are'} already in order. Nothing was moved.`);
    } else {
        lines.push(`Sorted ${sorted} ${plural(sorted, 'chest')} in ${report.moves} ${plural(report.moves, 'move')}: `
            + `${report.stacksBefore} ${plural(report.stacksBefore, 'stack')} ${report.stacksBefore === 1 ? 'is' : 'are'} now ${report.stacksAfter}.`);
    }
    for (const chest of report.chests) {
        const stacks = chest.slots.filter(Boolean);
        const groups = [...new Set(stacks.map(stack => groupOf(stack.name)))];
        lines.push(`- ${labelOf(chest)}: ${stacks.length ? `${groups.join(', ')} (${stacks.length} of ${chest.slots.length} slots used)` : 'empty'}`);
    }
    for (const chest of report.skipped) lines.push(`- ${labelOf(chest)} was left out: ${chest.reason}`);
    return lines.join('\n');
}

// How the chests are found and reached on a real bot. Everything goes through world.js, so with fair
// play on the bot sorts only chests it has seen, and opens one only from where it can see and reach it.
const real = {
    /** The chest blocks the bot knows of around it, nearest first. */
    nearestBlocks(bot, distance) {
        const ids = SORTABLE.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
        return world.getNearestBlocksWhere(bot, ids, distance);
    },
    blockAt: (bot, pos) => worldQueries().blockAt(bot, new Vec3(pos.x, pos.y, pos.z)),
    /** Walks to within reach of a chest. What the walk says along the way is kept out of the report. */
    async goTo(bot, chest) {
        const before = bot.output;
        // A walk across a room of chests takes seconds. The pathfinder can also plan a step past a
        // corner it cannot cut and then stand still for good, so a walk gets a deadline: when it
        // passes, the walk is called off and the chest counts as one the bot could not get to.
        const far = bot.entity.position.distanceTo(new Vec3(chest.x + 0.5, chest.y, chest.z + 0.5));
        const timer = setTimeout(() => bot.pathfinder?.setGoal(null), WALK_MS + WALK_MS_PER_BLOCK * far);
        let arrived = false;
        try { arrived = await skills.goToPosition(bot, chest.x, chest.y, chest.z, 2); }
        finally { clearTimeout(timer); }
        const said = String(bot.output ?? '').slice(String(before ?? '').length).trim();
        bot.output = before;
        if (!arrived) throw new Error(said.split('\n').pop() || 'you could not get to it');
    },
};

/**
 * Sorts the chests within `distance` blocks of the bot.
 * @param {object} bot - the mineflayer bot
 * @param {number} distance
 * @param {object} [deps] - stand-ins for finding and reaching chests, for tests
 * @returns {Promise<{status: string, text: string}>} a tool result
 */
export async function sortChestsHere(bot, distance, deps = {}) {
    const { nearestBlocks, blockAt, goTo, hands: handOptions } = { ...real, ...deps };
    const chests = chestsFrom(nearestBlocks(bot, distance));
    if (!chests.length) return toolResult('failed', `You don't see or remember a chest or barrel within ${distance} blocks of you.`);
    const hands = botHands(bot, { goTo: chest => goTo(bot, chest), blockAt: pos => blockAt(bot, pos), isChest: isSortable, ...handOptions });
    // The game's own answers where it has them: how many of an item fit in a slot, and what is food.
    const groupOf = grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) });
    const report = await runSort(chests, {
        hands, groupOf, groupOrder: GROUPS,
        stackSize: name => bot.registry.itemsByName[name]?.stackSize ?? 64,
        checkpoint: () => assertActionOwner(bot),
    });
    const status = !report.chests.length ? 'failed' : report.done && !report.skipped.length ? 'ok' : 'partial';
    return toolResult(status, sortText(report, { groupOf }));
}

/**
 * Makes a command's `perform` run as one of the bot's actions, the way the built-in action commands
 * do: it takes over from whatever the bot was doing, can be interrupted, and gives a result the model
 * can read (with `.structured` for native tool calls).
 */
function asAction(label, fn) {
    const run = async (agent, args, structured) => {
        const result = await agent.actions.runAction(`action:${label}`, () => fn(agent, ...args), { timeout: -1 });
        if (structured) return result;
        if (result.interrupted && !result.timedout) return;
        return result.message;
    };
    const perform = (agent, ...args) => run(agent, args, false);
    perform.structured = (agent, ...args) => run(agent, args, true);
    return perform;
}

/** The !sortChests command. `deps` is for tests. */
export const sortChestsCommand = (deps = {}) => ({
    name: '!sortChests',
    description: 'Tidy the chests and barrels around you: merges part stacks, puts each kind of item together and related kinds in the same chest. '
        + 'Sorts every one you can see or remember within the given distance, and says what each holds afterwards.',
    params: { 'distance': { type: 'int', description: 'How far from you to look for chests, in blocks.', domain: [1, 32, '[]'] } },
    perform: asAction('sortChests', (agent, distance) => sortChestsHere(agent.bot, distance, deps)),
});
