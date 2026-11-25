// SPDX-License-Identifier: CC0-1.0
// What the model can ask about chests, and how the answers read.
//
//   !chests(distance)                           the chests the bot knows of nearby: whose each is, what
//                                               it is for, and whether it may be sorted without asking
//   !markChest(x, y, z, owner, sorting)         says whose one chest is, how it may be sorted, or both
//   !markChests(which, distance, owner, sorting)   the same for several chests in view at once
//   !chestFor(x, y, z, what)                    says what one chest is for: a group, items, or the inbox
//   !sortChest(x, y, z)                         tidies one chest, by itself
//   !sortChests(whose, distance)                tidies one owner's chests in view together: part
//                                               stacks merged, each kind of item together, related
//                                               kinds in the same chest
//   !viewChestAt(x, y, z)                       what one chest holds, and whose it is
//   !takeFromChestAt(x, y, z, item_name, num)   takes an item out of one chest
//   !putInChestAt(x, y, z, item_name, num)      puts an item the bot carries into one chest
//
// Nothing is sorted unless that was approved for the chest: a player asks now, or the chest is marked
// "always". Which chests a request may touch is decided in permit.js from what the chest book
// (chest_book.js) was told, never by the model. The model only decides to ask. Which stack goes where
// is worked out in code (sort_plan.js) and done by the bot's own clicks (sorter.js, bot_hands.js), so
// the same mess is always sorted the same way, and a sort can be tested without a model.
import Vec3 from 'vec3';
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import { buildStopsSightTable, createSight } from '../fairplay/sight.js';
import { editionOf } from '../edition/index.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { ago } from '../memory/commands.js';
import { pathfinderLegs } from '../memory/navigator.js';
import { botHands } from './bot_hands.js';
import { ME, SHARED, SORTING, sameOwner } from './chest_book.js';
import { chestsFrom, isShelf, isSortable, SORTABLE } from './chests.js';
import { GROUPS, groupOf as groupByName, grouper } from './item_groups.js';
import { APPROVED, poolsFor } from './permit.js';
import { runSort } from './sorter.js';
import { isInbox, purposeOf, purposeText, readPurpose } from './purposes.js';

// How long a walk to a chest may take before it is called off: a start, plus time for each block of the way.
const WALK_MS = 8000, WALK_MS_PER_BLOCK = 1500;
// How near a chest the walk to it ends. Two blocks is within reach, and also covers a chest that sits
// on top of another, which nobody can stand level with.
const WALK_WITHIN = 2;
// How far away one chest named by where it is may be. The same as the widest sort.
const NAMED_CHEST_RANGE = 32;

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const at = pos => `${pos.x}, ${pos.y}, ${pos.z}`;
/** "double chest at 3, 70, 11": a chest as the model reads it. */
export const labelOf = chest => `${chest.also ? 'double ' : ''}${chest.name ?? 'chest'} at ${at(chest)}`;
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

// ---- Words ----

/** "Alice's", "shared", "your own", "owner unknown": whose a chest is, as the model reads it. */
export const ownerLabel = owner => (owner === ME ? 'your own' : owner === SHARED ? 'shared' : owner === null ? 'owner unknown' : `${owner}'s`);
/** "2 chests of Alice's", "1 shared chest", "3 chests with no known owner". */
function countOf(n, owner) {
    const chests = `${n} ${owner === SHARED ? 'shared ' : ''}${plural(n, 'chest')}`;
    return owner === SHARED ? chests : `${chests} ${owner === ME ? 'of your own' : owner === null ? 'with no known owner' : `of ${owner}'s`}`;
}
export const SORTING_TEXT = { always: 'may always be sorted', asked: 'sorted only when asked', never: 'never sorted' };

// The model speaks for several people, so "me" and "mine" could mean the player who is talking or
// the bot. Neither is guessed: the bot's own chests go by the bot's own name.
const AMBIGUOUS = new Set(['me', 'mine', 'my', 'i', 'myself']);
const OWN = new Set(['self', 'yourself', 'own', 'bot']);
const NOBODY = new Set(['unknown', 'nobody', 'none', 'no one', 'noone']);
const whoseHelp = name => `Give a player's name, "shared", or your own name (${name}) for your own chests.`;

/**
 * Reads an owner as the model gives it.
 * @returns {{owner?: string|null, same?: boolean, error?: string}} `owner` is a player's name, SHARED,
 *   ME, or null for unknown
 */
export function readOwner(text, { name = '', book = null, players = [] } = {}) {
    const said = String(text ?? '').trim().replace(/^["']|["']$/g, '');
    const word = said.toLowerCase();
    if (!word) return { error: `Whose? ${whoseHelp(name)}` };
    if (word === 'same') return { same: true };
    if (AMBIGUOUS.has(word)) return { error: `"${said}" could be you or the player you are talking to. ${whoseHelp(name)}` };
    if (OWN.has(word) || word === String(name).toLowerCase()) return { owner: ME };
    if (word === SHARED || word === 'everyone') return { owner: SHARED };
    if (NOBODY.has(word)) return { owner: null };
    // A name is spelled the way the book or the player list already has it, so two spellings are one owner.
    const known = book?.spell(said);
    const online = players.find(player => player.toLowerCase() === word);
    return { owner: known && known !== said ? known : online ?? said };
}

/** Reads a sorting permission as the model gives it. */
export function readSorting(text) {
    const word = String(text ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (word === 'same') return { same: true };
    const sorting = { ask: 'asked', 'when asked': 'asked', once: 'asked' }[word] ?? word;
    return SORTING.includes(sorting) ? { sorting } : { error: 'How it may be sorted is "always", "asked" or "never" (or "same" to leave that as it is).' };
}

// ---- What a sort reports ----

/**
 * The report of sorting one pool, as the model reads it: what was done, then one line per chest saying
 * what kinds of thing it holds now. That last part is what lets the model answer "where are the
 * tools?" without opening anything.
 * @param {object} report - from runSort
 * @param {object} [options]
 * @param {(name: string) => string} [options.groupOf] - the grouping the sort used
 * @param {string} [options.label] - whose chests these are ("Alice's"), when that is worth saying
 */
export function sortText(report, { groupOf = groupByName, label = '' } = {}) {
    const sorted = report.chests.length, all = sorted + report.skipped.length;
    const tag = label ? ` (${label})` : '';
    const these = n => (n === 1 ? 'the chest' : `the ${n} chests`);
    const lines = [];
    if (!sorted) {
        lines.push(`Could not open ${all === 1 ? 'the chest' : `any of the ${all} chests`} here${tag}.`);
    } else if (!report.done) {
        lines.push(`Stopped before ${these(sorted)}${tag} ${sorted === 1 ? 'was' : 'were'} in order: what was inside kept turning out different from what `
            + 'you had just seen, as if someone else is using them. Nothing was lost.');
        if (report.carrying.length) {
            const totals = new Map();
            for (const stack of report.carrying) totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
            lines.push(`You are still carrying what you took out and could not put back: ${[...totals].map(([name, n]) => `${name} ${n}`).join(', ')}.`);
        }
    } else if (!report.moves) {
        lines.push(`${capital(these(sorted))} here${tag} ${sorted === 1 ? 'is' : 'are'} already in order. Nothing was moved.`);
    } else {
        lines.push(`Sorted ${sorted} ${plural(sorted, 'chest')}${tag} in ${report.moves} ${plural(report.moves, 'move')}: `
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

/**
 * The chests in view that a request did not sort, and why, one line per reason. Doing nothing must
 * never be silent: this is how the model learns to ask whose a chest is, and can tell a player why
 * their neighbour's chests were not touched.
 * @param {{left: object[], hidden: number}} picked - from poolsFor
 * @param {object} [options]
 * @param {string|null} [options.whose] - whose chests were asked for (ME, SHARED, a name), or APPROVED
 */
export function leftText({ left = [], hidden = 0 }, { whose = null } = {}) {
    const lines = [];
    const groups = new Map();       // "why|owner" -> the chests left for that reason
    for (const entry of left) {
        const key = `${entry.why}|${entry.owner === null ? '' : entry.owner.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { why: entry.why, owner: entry.owner, chests: [] });
        groups.get(key).chests.push(entry.chest);
    }
    const where = chests => chests.map(at).join('; ');
    for (const { why, owner, chests } of groups.values()) {
        const n = chests.length;
        if (why === 'never') lines.push(`- ${countOf(n, owner)} marked never sort: ${where(chests)}`);
        else if (why === 'unknown') lines.push(`- ${countOf(n, null)}: ${where(chests)}. Ask whose ${n === 1 ? 'it is' : 'they are'} before sorting ${n === 1 ? 'it' : 'them'}.`);
        else if (why === 'not_always') lines.push(`- ${countOf(n, owner)}, sorted only when asked`);
        else if (why === 'not_asked') lines.push(`- ${countOf(n, owner)}: nobody asked for ${n === 1 ? 'this' : 'these'} to be sorted. Sort chests that are not `
            + 'your own only when a player asks, or when they are marked always.');
        else lines.push(`- ${countOf(n, owner)}`);
    }
    if (hidden) {
        const more = sameOwner(whose, APPROVED) ? `${hidden} more that may always be sorted ${hidden === 1 ? 'is' : 'are'}`
            : `${hidden} more ${ownerLabel(whose)} ${hidden === 1 ? 'is' : 'are'}`;
        lines.push(`- ${more} nearby but out of sight from here. Only chests you can see from where you stand are sorted.`);
    }
    return lines.join('\n');
}

// ---- Finding chests on a real bot ----

const sights = new WeakMap();
/** Line of sight over the blocks the bot has loaded: the same check fair play uses for everything it sees. */
function sightOf(bot) {
    if (!sights.has(bot)) {
        const local = { x: 0, y: 0, z: 0 };
        const edition = editionOf(bot.registry);
        const getStateId = (x, y, z) => {
            const column = bot.world?.getColumn?.(x >> 4, z >> 4);
            if (!column) return null;       // not loaded: nothing is seen through it
            local.x = x & 15; local.y = y; local.z = z & 15;
            return edition.readStateId(column, local);
        };
        sights.set(bot, createSight({ getStateId, stopsSight: buildStopsSightTable(bot.registry) }));
    }
    return sights.get(bot);
}

// How the chests are found and reached on a real bot. Everything goes through world.js, so with fair
// play on the bot knows only chests it has seen, and opens one only from where it can see and reach it.
export const real = {
    /** The chest blocks the bot knows of around it, nearest first, and the shelves when asked for. */
    nearestBlocks(bot, distance, { shelves = false } = {}) {
        const ids = SORTABLE.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
        if (shelves) ids.push(...(bot.registry.blocksArray ?? []).filter(block => isShelf(block.name)).map(block => block.id));
        return world.getNearestBlocksWhere(bot, ids, distance);
    },
    blockAt: (bot, pos) => worldQueries().blockAt(bot, new Vec3(pos.x, pos.y, pos.z)),
    /**
     * Could the bot see this chest by looking around from where it stands? A straight line from its
     * eyes to some face of either half, with nothing solid in between. This only ever narrows the
     * chests found above, so it gives the bot no knowledge it did not have.
     */
    inView(bot, chest) {
        const feet = bot.entity?.position;
        if (!feet) return false;
        const eye = { x: feet.x, y: feet.y + (bot.entity.eyeHeight ?? 1.62), z: feet.z };
        const sight = sightOf(bot);
        return [chest, chest.also].some(half => half && sight.canSeeBlock(eye, half.x, half.y, half.z));
    },
    /** What a sign right next to the chest says, when the bot knows. A hint to show, never an owner to assume. */
    signNear: () => null,
    /**
     * Walks to within reach of a chest, on foot only. Tidying a chest is never a reason to dig through
     * a wall or build a bridge, least of all in somebody's base, so this is the walk that neither digs
     * nor places: when there is no such way, the chest counts as one the bot could not get to.
     *
     * `within` is how near it has to get: a shelf is walked up to the cell in front of it, within a block.
     *
     * It is also the walk that goes round a corner squarely. Chests stand in rows, and the pathfinder
     * will plan a diagonal step past the corner of one and then stand still for good.
     */
    async goTo(bot, chest, within = WALK_WITHIN) {
        // A walk across a room of chests takes seconds, so one that is going nowhere is called off.
        const far = bot.entity.position.distanceTo(new Vec3(chest.x + 0.5, chest.y, chest.z + 0.5));
        const legs = pathfinderLegs(bot, { hopTimeoutMs: WALK_MS + WALK_MS_PER_BLOCK * far });
        try { await legs.walkTo(chest, within); }
        catch (error) {
            assertActionOwner(bot);     // a sort that was stopped is not a chest that could not be reached
            throw new Error(/no path/i.test(error.message) ? 'there is no way to walk to it without digging or placing a block' : 'the walk to it did not get there');
        }
    },
};

// Some games keep which two chest blocks make one double chest outside the blocks' states; the edition
// says where. Asked of the blocks the bot knows, so a remembered chest is taken as it was seen.
const halvesOn = bot => ({ otherHalfOf: block => editionOf(bot.registry).otherHalfOf(block) });

/**
 * The chests the bot knows of within `distance`, nearest first, each marked with whether it is in view now.
 * With `shelves`, the shelves too, each marked `shelf`.
 */
export function chestsAround(bot, distance, env, { shelves = false } = {}) {
    const blocks = shelves ? env.nearestBlocks(bot, distance, { shelves }) : env.nearestBlocks(bot, distance);
    return chestsFrom(blocks, { ...halvesOn(bot), shelves }).map(chest => ({ ...chest, inView: Boolean(env.inView(bot, chest)) }));
}

/**
 * The chest at a spot, as far as the bot knows: either half of a double chest names it. Null when there is
 * none. With `shelves`, a shelf there counts too: saying whose it is and what it is for works on shelves.
 */
function chestAt(bot, pos, env, { shelves = false } = {}) {
    const cell = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    const feet = bot.entity?.position;
    if (feet && Math.hypot(cell.x + 0.5 - feet.x, cell.y + 0.5 - feet.y, cell.z + 0.5 - feet.z) > NAMED_CHEST_RANGE) return null;
    const block = env.blockAt(bot, cell);
    if (!block || !(isSortable(block.name) || (shelves && isShelf(block.name)))) return null;
    return chestsFrom([{ name: block.name, position: cell, entity: block.entity, getProperties: () => block.getProperties?.() ?? null }], { ...halvesOn(bot), shelves })[0];
}

/**
 * Forgets what was said about chests the bot can see are gone. An entry stays while its spot is out
 * of sight: the bot cannot know, and a chest it merely cannot see is still someone's.
 */
export function forgetGone(bot, env) {
    const feet = bot.entity?.position;
    for (const entry of env.book.list()) {
        for (const cell of [{ x: entry.x, y: entry.y, z: entry.z }, entry.also].filter(Boolean)) {
            if (feet && Math.hypot(cell.x - feet.x, cell.y - feet.y, cell.z - feet.z) > NAMED_CHEST_RANGE) continue;
            const block = env.blockAt(bot, cell);
            if (block && block.name !== entry.name) env.book.dropCell(cell.x, cell.y, cell.z);
        }
    }
}

const NONE_HERE = distance => `You don't see or remember a chest or barrel within ${distance} blocks of you.`;

/** "3 iron_ingot, 1 diamond_pickaxe; one slot free": what a shelf held when last seen from in front. */
function shelfContentsText(seen) {
    if (!seen) return 'What is on it has not been seen from in front';
    const items = Object.entries(seen.items ?? {}).map(([name, count]) => `${count} ${name}`);
    const free = seen.free === 1 ? 'one slot free' : `${seen.free} slots free`;
    return items.length ? `On it: ${items.join(', ')}; ${free}` : 'Empty when last seen';
}

/**
 * Why a command that opens a chest does nothing at a shelf, or null when there is no shelf there. A shelf
 * has no lid: what is on it shows on its front, and !chests says what the bot saw there.
 */
function shelfRefusal(bot, pos, env, doing) {
    const cell = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    const block = env.blockAt(bot, cell);
    if (!block || !isShelf(block.name)) return null;
    return toolResult('failed', `The ${block.name} at ${at(cell)} is a shelf, which has no lid to open, so it can't be ${doing} like a chest. `
        + 'What is on a shelf shows on its front: !chests says what you saw there.');
}

// ---- The commands, as plain functions ----

/**
 * Text for !chests: every chest the bot knows of nearby, whose it is and how it may be sorted. Shelves are
 * listed with them: whose each is, and what was on it when the bot last saw its front.
 */
export function chestsText(bot, distance, deps = {}) {
    const env = { ...real, now: Date.now, ...deps };
    forgetGone(bot, env);
    const chests = chestsAround(bot, distance, env, { shelves: true });
    if (!chests.length) return NONE_HERE(distance);
    const t = env.now();
    const lines = chests.map(chest => {
        const entry = env.book.of(chest);
        const owner = entry?.owner ?? null;
        const parts = [`${owner === null ? 'owner unknown' : ownerLabel(owner)}${entry?.madeBy === ME ? ' (you placed it)' : ''}`];
        // A shelf is arranged by hand and never sorted. What is on it is what the bot saw on its front.
        if (chest.shelf) parts.push('A shelf: never sorted', shelfContentsText(env.contentsOf?.(chest) ?? null));
        else parts.push(capital(SORTING_TEXT[env.book.sortingOf(chest)]));
        if (entry?.lastSorted) parts.push(`Last sorted ${ago(t - entry.lastSorted.at)}`);
        if (!chest.inView) parts.push('Out of sight from here');
        const purpose = purposeLine(purposesOn(bot, env)(chest));
        if (purpose) parts.push(purpose);
        const sign = env.signNear(bot, chest);
        if (sign) parts.push(`A sign beside it says "${String(sign).replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
        return `- ${labelOf(chest)}: ${parts.join('. ')}`;
    });
    return `CHESTS YOU KNOW WITHIN ${distance} BLOCKS (nearest first)\n${lines.join('\n')}`;
}

/** What marking says about a new name: an owner may be offline, but a slip of the pen should be noticed. */
function newNameNote(owner, wasKnown, env, bot) {
    if (owner === null || owner === ME || owner === SHARED || wasKnown) return '';
    const online = Object.keys(bot.players ?? {}).some(player => player.toLowerCase() === owner.toLowerCase());
    return online ? '' : ` Nobody called "${owner}" is online or owns another chest you know of: check the name.`;
}

/** Both words of a marking command, read. `error` when either cannot be. */
function readMarking(bot, ownerText, sortingText, env) {
    const owner = readOwner(ownerText, { name: env.name, book: env.book, players: Object.keys(bot.players ?? {}) });
    const sorting = readSorting(sortingText);
    if (owner.error || sorting.error) return { error: owner.error ?? sorting.error };
    if (owner.same && sorting.same) return { error: 'Nothing to change: both the owner and the sorting were "same".' };
    const word = { by: env.by ?? null };
    if (!owner.same) word.owner = owner.owner;
    if (!sorting.same) word.sorting = sorting.sorting;
    const wasKnown = owner.same || owner.owner === null || env.book.list({ owner: owner.owner }).length > 0;
    return { word, wasKnown };
}

const nowText = (book, chest) => `${ownerLabel(book.ownerOf(chest))}, ${chest.shelf ? 'a shelf, never sorted' : SORTING_TEXT[book.sortingOf(chest)]}`;

/**
 * What each chest is for, as this bot knows it: what a player said, else a sign on it the bot has seen
 * (purposes.js). Items are the game's own, so "Iron ingots" on a sign is iron_ingot.
 */
export const purposesOn = (bot, env) => chest => purposeOf(chest, {
    book: env.book, signText: c => env.signNear(bot, c), isItem: name => Boolean(bot.registry?.itemsByName?.[name]),
});

/** "For tools", "For ores, going by its sign", "The inbox": a chest's purpose as the model reads it, or null for none. */
export function purposeLine({ holds, from }) {
    if (from === null) return null;
    if (isInbox(holds)) return `The inbox: players leave things in it for you to file (!fileInbox)${from === 'sign' ? ', going by its sign' : ''}`;
    if (!holds.length) return 'For anything (a player said so)';
    return `For ${purposeText(holds)}${from === 'sign' ? ', going by its sign' : ''}`;
}

const ANYTHING = ['anything', 'any', 'everything', 'all'];
const FORGET = ['unknown', 'forget', 'nothing said'];

/**
 * !chestFor: what one chest is for. A group of items, items, several of either, the inbox; "anything" for a
 * chest with no purpose (which also overrides a sign on it), or "unknown" to forget what was said and go by
 * its sign again. An inbox nobody has said whose it is becomes shared: it is for everyone to drop things in.
 */
export function chestFor(bot, pos, whatText, deps = {}) {
    const env = { ...real, ...deps };
    const chest = chestAt(bot, pos, env, { shelves: true });
    if (!chest) return toolResult('failed', `You don't know of a chest or barrel at ${at(pos)}. Use !chests to see the ones you know of.`);
    const word = String(whatText ?? '').trim().replace(/^["']|["']$/g, '');
    let holds;
    if (ANYTHING.includes(word.toLowerCase())) holds = [];
    else if (FORGET.includes(word.toLowerCase())) holds = null;
    else {
        const read = readPurpose(word, { isItem: name => Boolean(bot.registry?.itemsByName?.[name]) });
        if (!read.holds.length || read.unknown.length) {
            const missing = read.unknown.length ? read.unknown : [word];
            return toolResult('failed', `"${missing.join('", "')}" is not a group of items or an item you know. Say a group (${GROUPS.filter(g => g !== 'other').join(', ')}), `
                + 'an item name such as iron_ingot, several joined by commas, "inbox" for the chest players leave things in for you to file, '
                + '"anything" for a chest with no purpose, or "unknown" to forget what was said.');
        }
        holds = read.holds;
    }
    // Players leave things in the inbox for the bot to file: a chest's job, not a shelf's, whose three
    // slots are for showing things.
    if (chest.shelf && isInbox(holds)) return toolResult('failed', `The ${labelOf(chest)} is a shelf, and a shelf can't be the inbox: name a chest for that.`);
    const was = purposesOn(bot, env)(chest);
    const { changed } = env.book.mark(chest, { holds, by: env.by ?? null });
    let shared = '';
    if (isInbox(holds) && env.book.ownerOf(chest) === null) {
        env.book.mark(chest, { owner: SHARED, by: env.by ?? null });
        shared = ' Nobody had said whose it is, so it is now shared: anyone may leave things in it, and you may file them.';
    }
    const now = purposeLine(purposesOn(bot, env)(chest)) ?? 'With nothing said about what it is for';
    if (!changed && !shared) return toolResult('ok', `The ${labelOf(chest)} was already so. ${now}. Nothing changed.`);
    const before = purposeLine(was);
    return toolResult('ok', `The ${labelOf(chest)}: ${now}.${before ? ` It was: ${before}.` : ''}${shared}`);
}

/** !markChest: says whose one chest is, how it may be sorted, or both. */
export function markChest(bot, pos, ownerText, sortingText, deps = {}) {
    const env = { ...real, ...deps };
    const chest = chestAt(bot, pos, env, { shelves: true });
    if (!chest) return toolResult('failed', `You don't know of a chest or barrel at ${at(pos)}. Use !chests to see the ones you know of.`);
    const marking = readMarking(bot, ownerText, sortingText, env);
    if (marking.error) return toolResult('failed', marking.error);
    // A shelf is never sorted, so only whose it is can be said of one.
    let shelfNote = '';
    if (chest.shelf && marking.word.sorting !== undefined) {
        delete marking.word.sorting;
        if (marking.word.owner === undefined) return toolResult('failed', `The ${labelOf(chest)} is a shelf: shelves are never sorted, so there is no sorting to mark. Nothing changed.`);
        shelfNote = ' Shelves are never sorted, so only whose it is was noted.';
    }
    const { was, changed } = env.book.mark(chest, marking.word);
    if (!changed) return toolResult('ok', `The ${labelOf(chest)} was already ${nowText(env.book, chest)}. Nothing changed.${shelfNote}`);
    const wasText = chest.shelf ? ownerLabel(was.owner) : `${ownerLabel(was.owner)}, ${SORTING_TEXT[was.sorting]}`;
    return toolResult('ok', `The ${labelOf(chest)} is now ${nowText(env.book, chest)}. It was ${wasText}.${shelfNote}`
        + newNameNote(marking.word.owner ?? null, marking.wasKnown, env, bot));
}

/** !markChests: the same for several chests in view at once, chosen by who owns them now. */
export function markChests(bot, whichText, distance, ownerText, sortingText, deps = {}) {
    const env = { ...real, ...deps };
    const which = readOwner(whichText, { name: env.name, book: env.book, players: Object.keys(bot.players ?? {}) });
    if (which.error || which.same) return toolResult('failed', `Which chests? "unknown" for the ones with no owner yet, or whose they are now. ${whoseHelp(env.name)}`);
    const marking = readMarking(bot, ownerText, sortingText, env);
    if (marking.error) return toolResult('failed', marking.error);
    forgetGone(bot, env);
    const mine = chestsAround(bot, distance, env).filter(chest => sameOwner(env.book.ownerOf(chest), which.owner));
    const seen = mine.filter(chest => chest.inView), hidden = mine.length - seen.length;
    const outOfSight = hidden ? ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} out of sight from here and ${hidden === 1 ? 'was' : 'were'} not marked.` : '';
    if (!seen.length) {
        return toolResult('failed', `You see no chest ${which.owner === null ? 'with no known owner' : `that is ${ownerLabel(which.owner)}`} within ${distance} blocks.${outOfSight}`);
    }
    for (const chest of seen) env.book.mark(chest, marking.word);
    return toolResult('ok', `Marked ${seen.length} ${plural(seen.length, 'chest')} as ${nowText(env.book, seen[0])}: ${seen.map(at).join('; ')}.${outOfSight}`
        + newNameNote(marking.word.owner ?? null, marking.wasKnown, env, bot));
}

/**
 * Sorts the pools a request came down to, one after another, and says what was done and what was left.
 * Each pool is sorted by itself, so nothing moves between the chests of different owners.
 */
async function sortPools(bot, picked, { whose = null, distance = null } = {}, env) {
    // The game's own answers where it has them: how many of an item fit in a slot, and what is food.
    const groupOf = grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) });
    const blocks = [];
    let opened = 0, clean = true;
    // What each chest is for goes with it into the plan. The inbox is not sorted: what is in it is waiting
    // to be filed into the other chests (!fileInbox), not to be tidied where it is.
    const purposes = purposesOn(bot, env);
    const inboxes = [];
    for (const [i, pool] of picked.pools.entries()) {
        const chests = pool.chests.map(chest => ({ ...chest, holds: purposes(chest).holds }));
        inboxes.push(...chests.filter(chest => isInbox(chest.holds)));
        const sorted = chests.filter(chest => !isInbox(chest.holds));
        if (!sorted.length) continue;
        // Hands are made anew for each pool: the slots the bot may carry in are the ones empty now.
        const hands = botHands(bot, { goTo: chest => env.goTo(bot, chest), blockAt: pos => env.blockAt(bot, pos), isChest: isSortable, ...env.hands });
        const report = await runSort(sorted, {
            hands, groupOf, groupOrder: GROUPS,
            stackSize: name => bot.registry.itemsByName[name]?.stackSize ?? 64,
            checkpoint: () => assertActionOwner(bot),
        });
        for (const chest of report.chests) env.book.sorted(chest, { by: env.by ?? null });
        opened += report.chests.length;
        clean &&= report.done && !report.skipped.length;
        const several = picked.pools.length > 1 || whose !== null;
        blocks.push(sortText(report, { groupOf, label: several ? ownerLabel(pool.owner) : '' }));
        if (report.carrying.length && i < picked.pools.length - 1) {
            // What it holds belongs in the chests it just left. Going on to someone else's would mix them up.
            const rest = picked.pools.length - 1 - i;
            blocks.push(`Stopped there, with ${rest} more ${plural(rest, 'set')} of chests not started, because you are carrying items that belong in the ones above.`);
            break;
        }
    }
    const left = leftText(picked, { whose });
    if (left) blocks.push(`Left alone${distance ? ` within ${distance} blocks` : ''}:\n${left}`);
    if (inboxes.length) blocks.push(`Not sorted: the inbox (${inboxes.map(labelOf).join('; ')}). What players leave there is filed with !fileInbox.`);
    const status = !opened ? 'failed' : clean ? 'ok' : 'partial';
    return toolResult(status, blocks.join('\n'));
}

/**
 * !sortChests: sorts one owner's chests in view within `distance` blocks of the bot, or with
 * "approved" every chest there that may always be sorted.
 * @param {object} bot - the mineflayer bot
 * @param {string} whoseText - a player's name, "shared", the bot's own name, or "approved"
 * @param {number} distance
 * @param {object} deps - `book` (the chest book) and `name` (the bot's name); `asked` and `by` when
 *   it is known who is behind the request; and stand-ins for finding and reaching chests, for tests
 * @returns {Promise<{status: string, text: string}>} a tool result
 */
export async function sortChestsHere(bot, whoseText, distance, deps = {}) {
    const env = { ...real, ...deps };
    const word = String(whoseText ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    let whose = APPROVED;
    if (word !== APPROVED && word !== 'always') {
        const read = readOwner(whoseText, { name: env.name, book: env.book, players: Object.keys(bot.players ?? {}) });
        if (read.error || read.same) return toolResult('failed', `Whose chests? ${whoseHelp(env.name)} Or "approved" for every chest that may always be sorted.`);
        if (read.owner === null) return toolResult('failed', 'Chests with no known owner are not sorted together: they may be different people\'s. '
            + 'Sort one with !sortChest, or ask whose they are and mark them first.');
        whose = read.owner;
    }
    forgetGone(bot, env);
    const chests = chestsAround(bot, distance, env);
    if (!chests.length) return toolResult('failed', NONE_HERE(distance));
    const picked = poolsFor(chests, env.book, { whose, asked: env.asked ?? null });
    if (!picked.pools.length) {
        const none = whose === APPROVED ? 'No chest you can see from here may be sorted without being asked.'
            : `You see no chest from here that is ${ownerLabel(whose)}${whose === ME ? '' : ' and may be sorted'}.`;
        const left = leftText(picked, { whose });
        return toolResult('failed', `${none} Nothing was sorted.${left ? `\nLeft alone within ${distance} blocks:\n${left}` : ''}`);
    }
    return sortPools(bot, picked, { whose, distance }, env);
}

/** !sortChest: sorts the one chest at a spot, by itself. */
export async function sortChestAt(bot, pos, deps = {}) {
    const env = { ...real, ...deps };
    const chest = chestAt(bot, pos, env);
    if (!chest) return shelfRefusal(bot, pos, env, 'sorted') ?? toolResult('failed', `You don't know of a chest or barrel at ${at(pos)}. Use !chests to see the ones you know of.`);
    const picked = poolsFor([chest], env.book, { chest, asked: env.asked ?? null });
    if (!picked.pools.length) {
        const why = picked.left[0]?.why === 'never' ? `The ${labelOf(chest)} is marked never sort, so it was left as it is. To sort it, the mark has to be changed first (!markChest).`
            : `Nobody asked for the ${labelOf(chest)} to be sorted, and it is not your own or marked always. It was left as it is.`;
        return toolResult('failed', why);
    }
    return sortPools(bot, picked, {}, env);
}

// ---- One chest, named by where it is: looking in, taking out, putting in ----
//
// The commands the bot came with for this use the nearest chest, whichever that is. In a room of
// chests the model needs to say which one, and !chests gives it the positions to say it with. These
// open the chest the way a sort does: from where the bot stands when it is within reach, and
// otherwise after a walk that neither digs nor places. They say whose the chest is. They refuse
// nothing: whose chests the bot may take from is not decided here.

const NO_CHEST_AT = pos => `You don't know of a chest or barrel at ${at(pos)}. Use !chests to see the ones you know of.`;
const whoseText = (book, chest) => { const owner = book.ownerOf(chest); return owner === null ? 'which has no known owner' : `which is ${ownerLabel(owner)}`; };
/** "oak_log 70, bread 3": what is in some slots, added up by kind, in the order the kinds first appear. */
function contentsOf(slots) {
    const totals = new Map();
    for (const stack of slots) if (stack) totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
    return [...totals].map(([name, count]) => `${name} ${count}`);
}
const countOfItem = (slots, name) => slots.reduce((n, stack) => n + (stack?.name === name ? stack.count : 0), 0);

/**
 * Opens the chest at a spot, hands it to `use`, and closes it again whatever happens.
 * @returns {Promise<{status: string, text: string}>} what `use` returned, or why the chest could not be opened
 */
async function withChestAt(bot, pos, env, use) {
    const chest = chestAt(bot, pos, env);
    if (!chest) return shelfRefusal(bot, pos, env, 'opened') ?? toolResult('failed', NO_CHEST_AT(pos));
    const hands = botHands(bot, { goTo: found => env.goTo(bot, found), blockAt: cell => env.blockAt(bot, cell), isChest: isSortable, ...env.hands });
    let opened;
    try { opened = await hands.open(chest); }
    catch (error) {
        assertActionOwner(bot);     // stopped, which is not the same as a chest that will not open
        return toolResult('failed', `Could not open the ${labelOf(chest)}: ${error.message}`);
    }
    try { return await use(opened, chest, `${labelOf(chest)}, ${whoseText(env.book, chest)}`); }
    finally { await opened.close(); }
}

/** !viewChestAt: what the chest at a spot holds, and whose it is. */
export async function viewChestAt(bot, pos, deps = {}) {
    const env = { ...real, ...deps };
    return withChestAt(bot, pos, env, async (opened, chest, label) => {
        const slots = opened.slots(), used = slots.filter(Boolean).length;
        const purpose = purposeLine(purposesOn(bot, env)(chest));
        const forWhat = purpose ? ` ${purpose}.` : '';
        if (!used) return toolResult('ok', `The ${label}, is empty.${forWhat}`);
        return toolResult('ok', `The ${label}, holds (${used} of ${slots.length} slots used):\n${contentsOf(slots).map(line => `- ${line}`).join('\n')}${forWhat ? `\n${forWhat.trim()}` : ''}`);
    });
}

/** !takeFromChestAt: takes up to `num` of an item out of the chest at a spot. */
export async function takeFromChestAt(bot, pos, itemName, num, deps = {}) {
    const env = { ...real, ...deps };
    return withChestAt(bot, pos, env, async (opened, chest, label) => {
        const had = countOfItem(opened.slots(), itemName);
        if (!had) {
            const holds = contentsOf(opened.slots());
            return toolResult('failed', `There is no ${itemName} in the ${label}. ${holds.length ? `It holds: ${holds.join(', ')}.` : 'It is empty.'}`);
        }
        const want = Math.min(num, had);
        try { await opened.takeOut(itemName, want); }
        catch { assertActionOwner(bot); /* not all of it fitted: what did is counted below */ }
        // The bot's own copy of the window is a guess. What moved is what the server says is left.
        await opened.settle();
        const taken = had - countOfItem(opened.slots(), itemName);
        if (taken <= 0) return toolResult('failed', `Could not take any ${itemName} from the ${labelOf(chest)}: your inventory has no room for it.`);
        if (taken < want) return toolResult('partial', `Took ${taken} of the ${want} ${itemName} asked for from the ${label}: your inventory has no room for more.`);
        return toolResult('ok', `Took ${taken} ${itemName} from the ${label}.${num > had ? ' That was all of it.' : ''}`);
    });
}

/** !putInChestAt: puts up to `num` of an item the bot carries into the chest at a spot. */
export async function putInChestAt(bot, pos, itemName, num, deps = {}) {
    const env = { ...real, ...deps };
    // What a chest window can reach: the bot's main inventory and hotbar. Checked first, so the bot
    // does not walk to a chest with nothing to put in it.
    const carried = (bot.inventory?.slots ?? []).slice(9, 45).reduce((n, item) => n + (item?.name === itemName ? item.count : 0), 0);
    if (!carried) return toolResult('failed', `You have no ${itemName} to put in a chest.`);
    return withChestAt(bot, pos, env, async (opened, chest, label) => {
        const before = countOfItem(opened.slots(), itemName), want = Math.min(num, carried);
        try { await opened.deposit(itemName, want); }
        catch { assertActionOwner(bot); /* not all of it fitted: what did is counted below */ }
        await opened.settle();
        const put = countOfItem(opened.slots(), itemName) - before;
        if (put <= 0) return toolResult('failed', `Could not put any ${itemName} in the ${labelOf(chest)}: it has no room for it.`);
        if (put < want) return toolResult('partial', `Put ${put} of the ${want} ${itemName} asked for in the ${label}: it has no room for more.`);
        return toolResult('ok', `Put ${put} ${itemName} in the ${label}.${num > carried ? ' That was all you had.' : ''}`);
    });
}

// ---- The commands, as the model calls them ----

/**
 * Makes a command's `perform` run as one of the bot's actions, the way the built-in action commands
 * do: it takes over from whatever the bot was doing, can be interrupted, and gives a result the model
 * can read (with `.structured` for native tool calls).
 */
export function asAction(label, fn) {
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

const COORDS = {
    'x': { type: 'int', description: 'The x coordinate of the chest.', domain: [-Infinity, Infinity] },
    'y': { type: 'int', description: 'The y coordinate of the chest.', domain: [-64, 320] },
    'z': { type: 'int', description: 'The z coordinate of the chest.', domain: [-Infinity, Infinity] },
};
const OWNER_PARAM = 'A player\'s name, "shared" (everyone\'s, yours too), your own name for a chest of your own, "unknown", or "same" to leave the owner as it is.';
const SORTING_PARAM = '"always" (you may tidy it whenever), "asked" (only when a player asks), "never" (leave it as it is), or "same".';

/**
 * The chest commands.
 * @param {object} context
 * @param {(agent: object) => object} context.book - the chest book for the world the bot is in now
 * @param {(agent: object) => void} [context.save] - writes the book down after a change
 * @param {(agent: object) => {asked?: boolean|null, by?: string|null}} [context.asker] - who is behind
 *   the request, as far as the code can tell
 * @param {object} [context.deps] - stand-ins for finding and reaching chests, for tests
 * @returns {{command: object, action: boolean}[]}
 */
export function storageCommands({ book, save = () => {}, asker = () => ({}), deps = {} }) {
    const env = agent => ({ ...deps, book: book(agent), name: agent.name, ...asker(agent) });
    // A quick command answers at once and does not take over from what the bot is doing.
    const quick = fn => (agent, ...args) => {
        const result = fn(agent, ...args);
        save(agent);
        return typeof result === 'string' ? result : result.text;
    };
    const sorting = (label, fn) => asAction(label, async (agent, ...args) => {
        try { return await fn(agent, ...args); }
        finally { save(agent); }
    });
    const item = what => ({
        'item_name': { type: 'ItemName', description: `The name of the item to ${what}.` },
        'num': { type: 'int', description: `How many to ${what}. A number larger than what is there moves all of it.`, domain: [1, Number.MAX_SAFE_INTEGER] },
    });
    return [
        { action: false, command: {
            name: '!chests',
            description: 'List the chests, barrels and shelves you know of nearby: where each is, whose it is, what it is for, and whether you may sort it without being asked. '
                + 'A shelf is never sorted; it shows what you last saw on its front.',
            params: { 'distance': { type: 'int', description: 'How far from you to look, in blocks.', domain: [1, 64, '[]'] } },
            perform: quick((agent, distance) => chestsText(agent.bot, distance, env(agent))),
        } },
        { action: false, command: {
            name: '!markChest',
            description: 'Record whose a chest is and how it may be sorted, when a player tells you. The latest word wins. Works on a shelf too, which is never sorted: say "same" for its sorting.',
            params: { ...COORDS, 'owner': { type: 'string', description: OWNER_PARAM }, 'sorting': { type: 'string', description: SORTING_PARAM } },
            perform: quick((agent, x, y, z, owner, sorting) => markChest(agent.bot, { x, y, z }, owner, sorting, env(agent))),
        } },
        { action: false, command: {
            name: '!chestFor',
            description: 'Record what a chest is for, when a player says "this chest is for tools" or "put iron in that one", or names the chest players leave things in for you to sort (the inbox). '
                + 'Putting away then uses it for those things and nothing else, and sorting keeps them there. The latest word wins, and it beats a sign on the chest.',
            params: { ...COORDS, 'what': { type: 'string', description: 'A group (tools, combat, food, minerals, wood, stone, earth, plants, mob_drops, redstone, building), '
                + 'an item name such as iron_ingot, several joined by commas, "inbox", "anything" for no purpose, or "unknown" to forget what was said and go by the chest\'s sign.' } },
            perform: quick((agent, x, y, z, what) => chestFor(agent.bot, { x, y, z }, what, env(agent))),
        } },
        { action: false, command: {
            name: '!markChests',
            description: 'Record the owner and sorting of several chests you can see at once, when a player says "these are all mine" or "always keep my chests tidy".',
            params: {
                'which': { type: 'string', description: '"unknown" for every chest in view with no owner yet, or whose they are now (a player\'s name, "shared", your own name).' },
                'distance': { type: 'int', description: 'How far from you to look, in blocks.', domain: [1, 32, '[]'] },
                'owner': { type: 'string', description: OWNER_PARAM },
                'sorting': { type: 'string', description: SORTING_PARAM },
            },
            perform: quick((agent, which, distance, owner, sorting) => markChests(agent.bot, which, distance, owner, sorting, env(agent))),
        } },
        { action: true, command: {
            name: '!sortChest',
            description: 'Tidy one chest or barrel by itself, when a player asks for that chest: merges part stacks and puts each kind of item together.',
            params: COORDS,
            perform: sorting('sortChest', (agent, x, y, z) => sortChestAt(agent.bot, { x, y, z }, env(agent))),
        } },
        { action: true, command: {
            name: '!sortChests',
            description: 'Tidy one owner\'s chests and barrels together: merges part stacks, puts each kind of item together and related kinds in the same chest. '
                + 'Only chests you can see from where you stand are sorted: do not go looking for more unless asked. '
                + 'Sort a player\'s or the shared chests only when a player asks. On your own, use your own name or "approved". Says what each chest holds afterwards and which were left alone.',
            params: {
                'whose': { type: 'string', description: 'A player\'s name, "shared", your own name for your own chests, or "approved" for every chest that may always be sorted.' },
                'distance': { type: 'int', description: 'How far from you to look for chests, in blocks.', domain: [1, 32, '[]'] },
            },
            perform: sorting('sortChests', (agent, whose, distance) => sortChestsHere(agent.bot, whose, distance, env(agent))),
        } },
        { action: true, command: {
            name: '!viewChestAt',
            description: 'Look in the chest or barrel at these coordinates: what it holds and whose it is. !chests lists the chests you know of and where they are.',
            params: COORDS,
            perform: asAction('viewChestAt', (agent, x, y, z) => viewChestAt(agent.bot, { x, y, z }, env(agent))),
        } },
        { action: true, command: {
            name: '!takeFromChestAt',
            description: 'Take an item out of the chest or barrel at these coordinates. Use this when it matters which chest: !takeFromChest uses whichever chest is nearest.',
            params: { ...COORDS, ...item('take') },
            perform: asAction('takeFromChestAt', (agent, x, y, z, itemName, num) => takeFromChestAt(agent.bot, { x, y, z }, itemName, num, env(agent))),
        } },
        { action: true, command: {
            name: '!putInChestAt',
            description: 'Put an item you carry into the chest or barrel at these coordinates. Use this when it matters which chest: !putInChest uses whichever chest is nearest.',
            params: { ...COORDS, ...item('put in') },
            perform: asAction('putInChestAt', (agent, x, y, z, itemName, num) => putInChestAt(agent.bot, { x, y, z }, itemName, num, env(agent))),
        } },
    ];
}
