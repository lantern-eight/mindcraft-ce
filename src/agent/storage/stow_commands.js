// SPDX-License-Identifier: CC0-1.0
// What the model can ask for to put things away and fetch them, and how the answers read.
//
//   !putAway(what, whose, distance)    puts what the bot carries into the chests where those things
//                                      belong: "all" for everything it does not need to keep, or one item
//   !fetchItem(item_name, num)         takes an item out of the chests the bot remembers holding it
//   !fileInbox(whose, distance)        files what players left in the inbox into the chests where it belongs
//   !bringItem(player_name, item_name, num)   fetches an item if the bot doesn't carry enough, and hands it over
//   !getTool(kind, material)           a tool from the bag, else from the chests, else crafted (tool_kit.js)
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
import { handOver } from './hand_over.js';
import { craftRecipe } from '../library/skills.js';
import * as world from '../library/world.js';
import { carriedTool, craftOrder, craftPlan, fetchOrder, isLog, isPlanks, planksOf, readKind, readMaterial, SHAPES } from './tool_kit.js';
import { asAction, chestsAround, forgetGone, labelOf, ownerLabel, purposesOn, real } from './commands.js';
import { ME, SHARED } from './chest_book.js';
import { isSortable } from './chests.js';
import { grouper } from './item_groups.js';
import { cleanName, keepPlan } from './keep_plan.js';
import { fileInbox } from './inbox.js';
import { isInbox } from './purposes.js';
import { fetchItem, lookInto, putAway } from './stow.js';
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

/** Whose chests a request is about: ANY (the bot's own, then shared), ME, SHARED, or a player's name as the book spells it. */
function readWhose(whoseText, env) {
    const word = String(whoseText ?? ANY).trim().replace(/^["']|["']$/g, '').toLowerCase();
    return !word || word === ANY ? ANY : word === String(env.name).toLowerCase() || ['self', 'own', 'yourself'].includes(word) ? ME
        : word === SHARED ? SHARED : env.book.spell?.(String(whoseText).trim()) ?? String(whoseText).trim();
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

    const whose = readWhose(whoseText, env);
    forgetGone(bot, env);
    const found = chestsWithBeliefs(bot, Math.min(distance, PUT_RANGE), env);
    const allowed = putInto(found, env.book, { whose, asked: env.asked ?? null });
    const leftOut = leftOutText(allowed.left);
    if (!allowed.usable.length) {
        return toolResult('failed', `You know no chest within ${distance} blocks that you may put things in${whose === ANY ? ' (your own or shared ones)' : ''}. `
            + `Nothing was put away.${leftOut ? `\n${leftOut}` : ''}`);
    }
    // What each chest is for (a player's word, else its sign): put-away keeps things out of a chest meant
    // for something else, and out of the inbox.
    const purposeOf = purposesOn(bot, env);
    const chests = allowed.usable.map(({ chest, rank, owner }) => ({ ...chest, rank, owner, holds: purposeOf(chest).holds }));
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

/** How many of an item the bot carries. */
const carriedOf = (bot, name) => bagOf(bot).filter(item => item.name === name).reduce((n, item) => n + item.count, 0);

/**
 * !bringItem: gets an item to a player. What the bot carries goes first, as a player hands over what is in
 * their bag; only what it is short of is fetched from the chests, by the same rules as !fetchItem. Then it
 * walks up to the player and throws it to them (hand_over.js). Which chests it may take from follows who
 * asked, never who receives: bringing Bob something from Alice's chests takes Alice asking.
 * @param {object} bot
 * @param {string} playerText - who gets it
 * @param {string} itemText - the item's exact name
 * @param {number} num
 * @param {object} deps - as for fetchHere, plus `give(bot, name, player, count)` to stand in for handOver
 */
export async function bringHere(bot, playerText, itemText, num, deps = {}) {
    const env = { give: handOver, ...real, ...deps };
    const player = String(playerText ?? '').trim().replace(/^["']|["']$/g, '');
    const name = cleanName(String(itemText ?? '').replace(/^["']|["']$/g, ''));
    if (!player) return toolResult('failed', 'Bring it to whom? Give the player\'s name.');
    if (!name) return toolResult('failed', 'Which item? Give its name, like iron_ingot.');
    if ([bot.username, env.name].some(self => self && player.toLowerCase() === String(self).toLowerCase())) return toolResult('failed', 'You can\'t bring things to yourself: use !fetchItem.');

    const lines = [];
    const short = num - carriedOf(bot, name);
    let fetched = null;
    if (short > 0) {
        fetched = await fetchHere(bot, name, short, { ...deps, by: deps.by ?? null });
        // The fetch's own advice to hand it over is what happens next, here.
        lines.push(...fetched.text.split('\n').filter(line => !/hand it over with !givePlayer/.test(line)));
    }
    const have = Math.min(num, carriedOf(bot, name));
    if (!have) return toolResult('failed', [...lines, `Nothing to bring ${player}.`].join('\n'));

    let given;
    try { given = await env.give(bot, name, player, have); }
    catch (error) { assertActionOwner(bot); given = { thrown: 0, taken: false, problem: error?.message ?? String(error) }; }
    const handed = given.thrown;
    if (handed && given.taken) {
        lines.push(`Gave ${handed} ${name} to ${player}${handed < num ? ` (of the ${num} asked for)` : ''}.`);
    } else if (handed) {
        // Thrown to them, and not picked up: it lies on the ground at their feet.
        lines.push(`Threw ${handed} ${name} to ${player}, but they didn't pick it up: it is on the ground at their feet.`);
    } else {
        lines.push(`Could not hand it to ${player}: ${given.problem ?? 'they never took it'}. You carry ${carriedOf(bot, name)} ${name}.`);
    }
    const status = !handed ? 'failed' : !given.taken || handed < num ? 'partial' : 'ok';
    return toolResult(status, lines.join('\n'));
}

const an = name => (/^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`);
/** The bag's counts by name. */
const countsOf = bot => bagOf(bot).reduce((acc, item) => ({ ...acc, [item.name]: (acc[item.name] ?? 0) + item.count }), {});
const sumWhere = (counts, test) => Object.entries(counts).reduce((n, [name, count]) => n + (test(name) ? count : 0), 0);
/** A fetch's lines, less its advice to hand the item over: the tool is for the bot. */
const fetchLines = result => result.text.split('\n').filter(line => !/hand it over with !givePlayer/.test(line));

/**
 * !getTool: a tool of a kind and material for the bot. One it carries, else one from the chests it may take
 * from, else one crafted, fetching what the recipe is short of first (tool_kit.js says what that is).
 * @param {object} bot
 * @param {string} kindText - pickaxe, axe, shovel, hoe or sword
 * @param {string} materialText - wooden, stone, golden, iron, diamond, netherite, or "any" for the best it can get
 * @param {object} deps - as for fetchHere, plus `craft(bot, name, times)` and `tableNear(bot)` to stand in for the game
 */
export async function getToolHere(bot, kindText, materialText, deps = {}) {
    const env = { craft: craftRecipe, tableNear: b => Boolean(world.getNearestBlock(b, 'crafting_table', 16)), ...real, ...deps };
    const kind = readKind(kindText), material = readMaterial(materialText);
    if (!kind) return toolResult('failed', `"${kindText}" is not a tool: say ${Object.keys(SHAPES).join(', ')}.`);
    if (!material) return toolResult('failed', `"${materialText}" is not a material: say wooden, stone, golden, iron, diamond, netherite, or "any".`);
    const wanted = material === 'any' ? kind : `${material} ${kind}`;

    // 1. The bag.
    const carried = carriedTool(bagOf(bot), kind, material);
    if (carried) return toolResult('ok', `You already have ${an(carried)}.`);

    // 2. The chests, as fetching would use them, best first for "any".
    forgetGone(bot, env);
    const allowed = takeFrom(chestsWithBeliefs(bot, FETCH_RANGE, env), env.book, { asked: env.asked ?? null, by: env.by ?? null });
    // Chests it has never looked into are opened first, as for putting away: what they hold decides between
    // fetching the tool, fetching its makings, and neither.
    await lookInto(allowed.usable.map(({ chest }) => chest), { hands: hands(bot, env), from: here(bot), checkpoint: () => assertActionOwner(bot) });
    const stored = {};
    for (const { chest } of allowed.usable) for (const [name, n] of Object.entries(chest.items ?? {})) stored[name] = (stored[name] ?? 0) + n;
    const lines = [];
    for (const m of fetchOrder(material)) {
        const name = `${m}_${kind}`;
        if (!(stored[name] > 0)) continue;
        const fetched = await fetchHere(bot, name, 1, deps);
        if (carriedOf(bot, name) > 0) return toolResult('ok', fetchLines(fetched).join('\n'));
        lines.push(...fetchLines(fetched));
    }

    // 3. Crafted: the best material the bag and the chests have enough for.
    const plans = craftOrder(material).map(m => ({ m, plan: craftPlan(kind, m, countsOf(bot), stored, { table: env.tableNear(bot) }) }));
    const chosen = plans.find(({ plan }) => plan.possible);
    if (!chosen) {
        const lacking = plans.at(-1)?.plan.missing;
        return toolResult('failed', [...lines, `No ${wanted} in your bag or the chests you may use${lacking ? `, and not enough to craft one: it needs ${lacking}` : ''}${material === 'netherite' ? ' (netherite is made at a smithing table, not crafted)' : ''}.`].join('\n'));
    }
    const { m } = chosen;
    // What is crafted lands in the bag: with no slot free, the crafting table hands nothing back.
    if (bot.inventory?.emptySlotCount?.() === 0) {
        return toolResult('failed', [...lines, `To craft ${an(`${m}_${kind}`)} you need a free slot in your bag: put things away (!putAway) first.`].join('\n'));
    }
    for (const { name, count } of chosen.plan.fetch) lines.push(...fetchLines(await fetchHere(bot, name, count, deps)));
    // Planks from logs, sticks from planks, a table from planks, then the tool: what a player does at the table.
    const [headCount, stickCount] = SHAPES[kind];
    const sticksShort = Math.max(0, stickCount - (countsOf(bot).stick ?? 0));
    const tableShort = !env.tableNear(bot) && !(countsOf(bot).crafting_table > 0);
    const planksNeeded = (m === 'wooden' ? headCount : 0) + (sticksShort ? 2 : 0) + (tableShort ? 4 : 0);
    // Each step must come out, or the next has nothing to work with: the first that doesn't is the answer.
    const make = async (name, times, made = () => carriedOf(bot, name) > 0) => {
        const mark = String(bot.output ?? '').length;
        await env.craft(bot, name, times);
        // The server's copy of the bag comes a moment after the craft: look again for a second or two.
        for (let tries = 0; tries < 10 && !made(); tries++) await new Promise(resolve => setTimeout(resolve, 200));
        if (made()) return null;
        const said = String(bot.output ?? '').slice(mark).trim().split('\n').filter(Boolean).at(-1);
        return `Could not craft ${name}${said ? `: ${said.replace(/\.+$/, '')}` : ''}.`;
    };
    const tool = `${m}_${kind}`;
    const steps = [];
    let planksShort = planksNeeded - sumWhere(countsOf(bot), isPlanks);
    let planksBefore = sumWhere(countsOf(bot), isPlanks);
    for (const [log, n] of Object.entries(countsOf(bot)).filter(([name]) => isLog(name))) {
        if (planksShort <= 0) break;
        const times = Math.min(n, Math.ceil(planksShort / 4));
        const enough = planksBefore + 4 * times;
        steps.push([planksOf(log), times, () => sumWhere(countsOf(bot), isPlanks) >= enough]);
        planksBefore = enough;
        planksShort -= 4 * times;
    }
    if (sticksShort) steps.push(['stick', 1, () => (countsOf(bot).stick ?? 0) >= stickCount]);
    if (tableShort) steps.push(['crafting_table', 1, () => carriedOf(bot, 'crafting_table') > 0 || env.tableNear(bot)]);
    steps.push([tool, 1]);
    // Mineflayer keeps one state id for every window: after a chest is closed it is the chest's, and the first
    // crafting clicks in the bot's own inventory go to the server with it. The server answers each with the
    // whole inventory again, which lands in the middle of the craft and left a stack on the cursor and no
    // sticks (checked live on Java 26.3). Asking for the inventory's own state first puts the id right.
    for (const [name, times, made] of steps) {
        if (typeof bot._syncWindow === 'function' && bot.inventory) {
            await Promise.race([Promise.resolve(bot._syncWindow(bot.inventory)).catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
        }
        const problem = await make(name, times, made);
        if (problem) return toolResult('failed', [...lines, problem].join('\n'));
    }
    return toolResult('ok', [...lines, `Crafted ${an(tool)}.`].join('\n'));
}

/**
 * !fileInbox: takes what players left in the inbox and puts it where it belongs, by the rules of putting
 * away. What fits nowhere goes back into the inbox.
 * @param {object} bot
 * @param {string} whoseText - as for putAwayHere: whose inbox, and whose chests it is filed into
 * @param {number} distance
 * @param {object} deps - as for putAwayHere
 */
export async function fileInboxHere(bot, whoseText, distance, deps = {}) {
    const env = { ...real, ...deps };
    const whose = readWhose(whoseText, env);
    const range = Math.min(distance, PUT_RANGE);
    forgetGone(bot, env);
    const purposeOf = purposesOn(bot, env);
    const found = chestsWithBeliefs(bot, range, env).map(chest => ({ ...chest, holds: purposeOf(chest).holds }));
    const inboxes = found.filter(chest => isInbox(chest.holds));
    if (!inboxes.length) {
        return toolResult('failed', `You know no inbox within ${range} blocks. A player can name the chest they leave things in with !chestFor(x, y, z, "inbox").`);
    }
    // The inbox is taken from, and filed into the other chests, by the same rules as putting away: the
    // bot's own and shared ones, or one player's when that player asks.
    const mayUse = putInto(found, env.book, { whose, asked: env.asked ?? null });
    const usable = mayUse.usable.map(({ chest, rank, owner }) => ({ ...chest, rank, owner }));
    const fromInboxes = usable.filter(chest => isInbox(chest.holds));
    const leftOut = leftOutText(mayUse.left.filter(entry => isInbox(entry.chest.holds)));
    if (!fromInboxes.length) {
        return toolResult('failed', `No inbox within ${range} blocks is one you may file${whose === ANY ? ' (your own or a shared one)' : ''}. Nothing was filed.`
            + `${leftOut ? `\n${leftOut}` : ''}`);
    }
    const report = await fileInbox(fromInboxes, usable.filter(chest => !isInbox(chest.holds)), {
        hands: hands(bot, env), from: here(bot), stackSize: sizeOf(bot),
        groupOf: grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) }), checkpoint: () => assertActionOwner(bot),
    });

    const filed = {};
    for (const { items } of report.filed) for (const [name, n] of Object.entries(items)) filed[name] = (filed[name] ?? 0) + n;
    const n = report.filed.length, lines = [];
    const where = fromInboxes.map(labelOf).join('; ');
    if (n) {
        lines.push(`Filed ${listOf(filed)} from the inbox (${where}) into ${n} ${plural(n, 'chest')}:`);
        for (const { chest, items } of report.filed) lines.push(`- ${labelOf(chest)} (${ownerLabel(chest.owner)}): ${listOf(items)}`);
    } else if (!report.back.length && !report.more && !report.skipped.length) {
        return toolResult('ok', `The inbox (${where}) is empty: nothing to file.`);
    } else lines.push('Nothing was filed.');
    for (const { chest, items } of report.back) {
        lines.push(`Put back in the ${labelOf(chest)}, with no room for it in the chests you may use: ${listOf(items)}. `
            + 'Place a chest, or ask a player where it should go.');
    }
    if (Object.keys(report.carrying).length) lines.push(`Still carrying, since the inbox had no room to take it back: ${listOf(report.carrying)}.`);
    if (report.more) lines.push('The inbox still holds more: your inventory had no room for it. Put away what you carry (!putAway) and file again.');
    for (const { chest, reason } of report.skipped) lines.push(`- ${labelOf(chest)} was left out: ${reason}`);
    if (leftOut) lines.push(`Inboxes left alone:\n${leftOut}`);
    const status = !n ? 'failed' : report.back.length || report.more || report.skipped.length || Object.keys(report.carrying).length ? 'partial' : 'ok';
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
        { action: true, command: {
            name: '!bringItem',
            description: 'Bring a player an item: hand over what you carry, fetching from the chests what you are short of '
                + '(by the same rules as !fetchItem), then walk to the player and give it. Use the exact item name.',
            params: {
                'player_name': { type: 'string', description: 'The player to bring it to.' },
                'item_name': { type: 'ItemName', description: 'The exact name of the item, like iron_ingot.' },
                'num': { type: 'int', description: 'How many to bring.', domain: [1, Number.MAX_SAFE_INTEGER] },
            },
            perform: run('bringItem', (agent, player, itemName, num) => bringHere(agent.bot, player, itemName, num, env(agent))),
        } },
        { action: true, command: {
            name: '!getTool',
            description: 'Get yourself a tool: one you carry, else one from the chests (by the rules of !fetchItem), else craft it, '
                + 'fetching from the chests what the recipe is short of (planks, logs, sticks, cobblestone, ingots, diamonds, a crafting table).',
            params: {
                'kind': { type: 'string', description: 'pickaxe, axe, shovel, hoe or sword.' },
                'material': { type: 'string', description: 'wooden, stone, golden, iron, diamond or netherite, or "any" for the best you can get.' },
            },
            perform: run('getTool', (agent, kind, material) => getToolHere(agent.bot, kind, material, env(agent))),
        } },
        { action: true, command: {
            name: '!fileInbox',
            description: 'File what players left in the inbox (the chest marked with !chestFor as the inbox) into the chests where those things belong, '
                + 'by the same rules as !putAway. Only what was in the inbox is filed: you keep your own things. What fits nowhere goes back into the inbox.',
            params: {
                'whose': { type: 'string', description: '"any" for your own or a shared inbox, filed into your own and the shared chests, or a player\'s name for their inbox and chests (only when they ask).' },
                'distance': { type: 'int', description: 'How far from you to look for the inbox and the chests, in blocks.', domain: [1, PUT_RANGE, '[]'] },
            },
            perform: run('fileInbox', (agent, whose, distance) => fileInboxHere(agent.bot, whose, distance, env(agent))),
        } },
    ];
}
