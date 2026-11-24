// SPDX-License-Identifier: CC0-1.0
// What the model can ask for to put things away and fetch them, and how the answers read.
//
//   !putAway(what, whose, distance)    puts what the bot carries into the chests where those things
//                                      belong: "all" for everything it does not need to keep, or one item
//   !fetchItem(item_name, num)         takes an item out of the chests the bot remembers holding it
//
// Which chests may be used is decided in take_put.js from the chest book, never by the model. Where each
// thing goes, and which chests to fetch from, is worked out in stow_plan.js and done in stow.js, so the
// same bag and the same room always come out the same way, and it can be tested without a model.
//
// What the bot believes is in a chest comes from world memory: what it saw the last time it looked. A
// chest it has never looked into is opened to see. Nothing here knows of a chest the bot has not seen.
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import { botHands } from './bot_hands.js';
import { asAction, chestsAround, forgetGone, labelOf, ownerLabel, real } from './commands.js';
import { ME, SHARED } from './chest_book.js';
import { isSortable } from './chests.js';
import { grouper } from './item_groups.js';
import { cleanName, keepPlan } from './keep_plan.js';
import { fetchItem, putAway } from './stow.js';
import { ANY, putInto, takeFrom } from './take_put.js';

/** How far away chests may be to put things away in them, at most. A storage room, not the whole base. */
export const PUT_RANGE = 32;
/** How far away chests may be to fetch from. */
export const FETCH_RANGE = 64;

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const at = pos => `${pos.x}, ${pos.y}, ${pos.z}`;
const listOf = counts => Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(', ');
const sumOf = list => list.reduce((acc, { name, count }) => ({ ...acc, [name]: (acc[name] ?? 0) + count }), {});

/** The bag as the keep plan reads it: the bot's own slots 9 to 44, with how worn each tool is. */
export function bagOf(bot) {
    const slots = bot.inventory?.slots ?? [];
    const out = [];
    for (let slot = 9; slot < 45; slot++) {
        const item = slots[slot];
        if (!item?.name || !(item.count > 0)) continue;
        const usesLeft = item.maxDurability > 0 ? item.maxDurability - (item.durabilityUsed ?? 0) : null;
        const special = Boolean(item.customName) || (Array.isArray(item.enchants) && item.enchants.length > 0);
        out.push({ name: item.name, count: item.count, slot, usesLeft, special });
    }
    return out;
}

/** The chests around the bot, each with what the bot believes is in it and how far it is. */
function chestsWithBeliefs(bot, distance, env) {
    const feet = bot.entity?.position ?? { x: 0, y: 0, z: 0 };
    return chestsAround(bot, distance, env).map(chest => {
        const seen = env.contentsOf?.(chest) ?? null;
        return {
            ...chest,
            distance: Math.hypot(chest.x + 0.5 - feet.x, chest.y + 0.5 - feet.y, chest.z + 0.5 - feet.z),
            items: seen ? { ...seen.items } : null,
            free: seen ? seen.free : null,
        };
    });
}

/** One line per kind of chest left out, so the model learns to ask whose a chest is. */
function leftOutText(left) {
    const unknown = left.filter(entry => entry.why === 'unknown').map(entry => entry.chest);
    const others = new Map();
    for (const entry of left.filter(e => e.why !== 'unknown')) others.set(entry.owner, (others.get(entry.owner) ?? 0) + 1);
    const lines = [];
    if (unknown.length) lines.push(`- ${unknown.length} ${plural(unknown.length, 'chest')} with no known owner, not used: ${unknown.map(at).join('; ')}. `
        + `Ask whose ${unknown.length === 1 ? 'it is' : 'they are'} (then !markChest).`);
    for (const [owner, n] of others) lines.push(`- ${n} ${plural(n, 'chest')} ${owner === SHARED ? 'shared' : `of ${ownerLabel(owner)}`}, not used`);
    return lines.join('\n');
}

const hands = (bot, env) => botHands(bot, { goTo: chest => env.goTo(bot, chest), blockAt: pos => env.blockAt(bot, pos), isChest: isSortable, ...env.hands });
const sizeOf = bot => name => bot.registry.itemsByName[name]?.stackSize ?? 64;
const here = bot => bot.entity?.position ?? { x: 0, y: 0, z: 0 };

/**
 * !putAway: puts what the bot carries into the chests where those things belong.
 * @param {object} bot
 * @param {string} whatText - "all" for everything the keep plan does not keep, or one item's name
 * @param {string} whoseText - "any" (the bot's own chests, then shared), the bot's name, "shared", or a player's name
 * @param {number} distance
 * @param {object} deps - `book`, `name`, `asked`, `by`, `contentsOf`, and stand-ins for tests
 */
export async function putAwayHere(bot, whatText, whoseText, distance, deps = {}) {
    const env = { ...real, ...deps };
    const what = cleanName(String(whatText ?? '').replace(/^["']|["']$/g, '')) ?? 'all';
    const everything = ['all', 'everything', 'any', 'stuff'].includes(what);
    const bag = bagOf(bot);
    const plan = keepPlan(bag, { only: everything ? undefined : [what], foods: bot.registry.foodsByName });
    if (!everything && !bag.some(item => item.name === what)) return toolResult('failed', `You have no ${what} to put away.`);
    if (!plan.store.length) return toolResult('ok', 'Nothing to put away: everything you carry is something you keep with you.');

    const word = String(whoseText ?? ANY).trim().replace(/^["']|["']$/g, '').toLowerCase();
    const whose = !word || word === ANY ? ANY : word === String(env.name).toLowerCase() || ['self', 'own', 'yourself'].includes(word) ? ME
        : word === SHARED ? SHARED : env.book.spell?.(String(whoseText).trim()) ?? String(whoseText).trim();
    forgetGone(bot, env);
    const found = chestsWithBeliefs(bot, Math.min(distance, PUT_RANGE), env);
    const allowed = putInto(found, env.book, { whose, asked: env.asked ?? null });
    const leftOut = leftOutText(allowed.left);
    if (!allowed.usable.length) {
        return toolResult('failed', `You know no chest within ${distance} blocks that you may put things in${whose === ANY ? ' (your own or shared ones)' : ''}. `
            + `Nothing was put away.${leftOut ? `\n${leftOut}` : ''}`);
    }
    const chests = allowed.usable.map(({ chest, rank, owner }) => ({ ...chest, rank, owner }));
    const report = await putAway(chests, {
        items: plan.store, hands: hands(bot, env), from: here(bot), stackSize: sizeOf(bot),
        groupOf: grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) }), checkpoint: () => assertActionOwner(bot),
    });

    const stored = sumOf(report.stored.flatMap(({ items }) => Object.entries(items).map(([name, count]) => ({ name, count }))));
    const n = report.stored.length, lines = [];
    if (n) {
        lines.push(`Put away ${listOf(stored)} in ${n} ${plural(n, 'chest')}:`);
        for (const { chest, items } of report.stored) lines.push(`- ${labelOf(chest)} (${ownerLabel(chest.owner)}): ${listOf(items)}`);
    } else lines.push('Nothing was put away.');
    if (everything && plan.keep.length) lines.push(`Kept on you: ${plan.keep.map(({ name, count }) => `${name} ${count}`).join(', ')}.`);
    if (report.left.length) {
        lines.push(`Still carrying, with no room for it in the chests you may use: ${listOf(sumOf(report.left))}. `
            + 'Place a chest, or ask a player where it should go.');
    }
    for (const { chest, reason } of report.skipped) lines.push(`- ${labelOf(chest)} was left out: ${reason}`);
    if (leftOut) lines.push(`Left alone within ${distance} blocks:\n${leftOut}`);
    const status = !n ? 'failed' : report.left.length || report.skipped.length ? 'partial' : 'ok';
    return toolResult(status, lines.join('\n'));
}

/**
 * !fetchItem: takes up to `num` of an item out of the chests the bot may take from, nearest first.
 * @param {object} bot
 * @param {string} itemText - the item's exact name
 * @param {number} num
 * @param {object} deps - as for putAwayHere, plus `similar(name)`: items with a like name that the bot remembers in chests
 */
export async function fetchHere(bot, itemText, num, deps = {}) {
    const env = { ...real, ...deps };
    const name = cleanName(String(itemText ?? '').replace(/^["']|["']$/g, ''));
    if (!name) return toolResult('failed', 'Which item? Give its name, like iron_ingot.');
    forgetGone(bot, env);
    const found = chestsWithBeliefs(bot, FETCH_RANGE, env);
    const allowed = takeFrom(found, env.book, { asked: env.asked ?? null, by: env.by ?? null });
    const chests = allowed.usable.map(({ chest, rank, owner }) => ({ ...chest, rank, owner }));
    const report = chests.length
        ? await fetchItem(chests, { name, count: num, hands: hands(bot, env), from: here(bot), checkpoint: () => assertActionOwner(bot) })
        : { taken: [], total: 0, skipped: [], bagFull: false };

    const lines = [];
    if (report.total) {
        lines.push(`Took ${report.total}${report.total < num ? ` of the ${num}` : ''} ${name}:`);
        for (const { chest, count } of report.taken) lines.push(`- ${count} from the ${labelOf(chest)} (${ownerLabel(chest.owner)})`);
        if (report.total < num) lines.push(report.bagFull ? 'Your inventory has no room for more.' : `No other chest you may take from holds any more ${name}.`);
        if (env.by) lines.push(`If ${env.by} wanted it, hand it over with !givePlayer.`);
    } else {
        lines.push(report.bagFull ? `Could not take any ${name}: your inventory has no room for it.`
            : `You know of no ${name} in a chest you may take from within ${FETCH_RANGE} blocks.`);
    }
    // Chests left out that held it when last seen: the model can ask whose they are.
    const held = allowed.left.filter(({ chest }) => (chest.items?.[name] ?? 0) > 0);
    for (const { chest, owner, why } of held) {
        lines.push(`- The ${labelOf(chest)} held ${chest.items[name]} ${name} when you last looked, but ${why === 'unknown'
            ? 'nobody has said whose it is: ask, or take from that one chest with !takeFromChestAt if a player says so'
            : `it is ${ownerLabel(owner)} and no player asked`}.`);
    }
    for (const { chest, reason } of report.skipped) lines.push(`- ${labelOf(chest)} was left out: ${reason}`);
    if (!report.total && !held.length) {
        const like = (env.similar?.(name) ?? []).filter(other => other !== name);
        if (like.length) lines.push(`Chests you remember hold: ${like.slice(0, 6).join(', ')}. Did you mean one of those?`);
    }
    const status = !report.total ? 'failed' : report.total < num ? 'partial' : 'ok';
    return toolResult(status, lines.join('\n'));
}

/**
 * The put-away and fetch commands.
 * @param {object} context - as storageCommands takes it: `book`, `save`, `asker`, `deps`
 */
export function stowCommands({ book, save = () => {}, asker = () => ({}), deps = {} }) {
    const env = agent => ({ ...deps, book: book(agent), name: agent.name, ...asker(agent) });
    const run = (label, fn) => asAction(label, async (agent, ...args) => {
        try { return await fn(agent, ...args); }
        finally { save(agent); }
    });
    return [
        { action: true, command: {
            name: '!putAway',
            description: 'Put what you carry into the chests where those things belong: each kind with its own kind, else with related things, '
                + 'else into an empty chest. With "all" you keep what you need out in the world (best tools, armour, food, torches, a few blocks) '
                + 'and put away the rest. Uses your own and the shared chests, or one player\'s when they ask for theirs. Says what went where and what was kept.',
            params: {
                'what': { type: 'string', description: '"all" for everything you do not need to keep, or the name of one item to put all of it away.' },
                'whose': { type: 'string', description: '"any" for your own chests then the shared ones, "shared", your own name, or a player\'s name for that player\'s chests (only when a player asks).' },
                'distance': { type: 'int', description: 'How far from you to look for chests, in blocks.', domain: [1, PUT_RANGE, '[]'] },
            },
            perform: run('putAway', (agent, what, whose, distance) => putAwayHere(agent.bot, what, whose, distance, env(agent))),
        } },
        { action: true, command: {
            name: '!fetchItem',
            description: 'Take an item out of the chests you remember holding it, nearest first, from several if one is not enough. '
                + 'Uses your own and shared chests, and players\' chests when a player asks. Use the exact item name. To hand it to a player afterwards, use !givePlayer.',
            params: {
                'item_name': { type: 'ItemName', description: 'The exact name of the item to fetch, like iron_ingot.' },
                'num': { type: 'int', description: 'How many to fetch.', domain: [1, Number.MAX_SAFE_INTEGER] },
            },
            perform: run('fetchItem', (agent, itemName, num) => fetchHere(agent.bot, itemName, num, env(agent))),
        } },
    ];
}
