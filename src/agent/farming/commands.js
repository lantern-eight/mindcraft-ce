// SPDX-License-Identifier: CC0-1.0
// What the model can ask about fields, and how the answers read.
//
//   !tendField(seed)              harvests what is ripe in the field nearest the bot, replants it, sows the
//                                 empty farmland, and picks up the drops
//   !markField(owner, tending)    says whose the field nearest the bot is, whether it may be tended
//                                 without being asked, or both
//   !sowField(seed, size)         tills wet, free soil near the bot and sows it: the field it may tend made
//                                 bigger, or a new field by water
//   !compost(item, count)         puts plant matter in the composter nearest the bot and takes out the bone
//                                 meal it gives; only when a player asks
//   !boneMealField(count)         uses bone meal on the young crops of the field nearest the bot, a plant at
//                                 a time until it is ripe; only when a player asks
//
// Whether a field may be tended is decided in code (field_book.js `mayTend`) from what the field book was
// told and who is behind the request, never by the model. The model only decides to ask.
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import { findField, fieldBox } from './field.js';
import { ME, SHARED, TENDING, defaultTending } from './field_book.js';
import { MAX_SOW, sowField } from './sow.js';
import { boneMealField } from './bone_meal.js';
import { composting } from './compost.js';
import { FIELD_RANGE, blockReader, nearestFarmland, ownerText, tendField } from './tend.js';

// The model speaks for several people, so "me" and "mine" could mean the player who is talking or the
// bot. Neither is guessed: the bot's own fields go by the bot's own name.
const AMBIGUOUS = new Set(['me', 'mine', 'my', 'i', 'myself']);
const OWN = new Set(['self', 'yourself', 'own', 'bot']);
const NOBODY = new Set(['unknown', 'nobody', 'none', 'no one', 'noone']);
const whoseHelp = name => `Give a player's name, "shared", or your own name (${name}) for a field of your own.`;
const unquote = text => String(text ?? '').trim().replace(/^["']|["']$/g, '');

/**
 * Reads an owner as the model gives it.
 * @returns {{owner?: string|null, same?: boolean, error?: string}} `owner` is a player's name, SHARED, ME,
 *   or null for unknown
 */
export function readOwner(text, { name = '', players = [] } = {}) {
    const said = unquote(text);
    const word = said.toLowerCase();
    if (!word) return { error: `Whose? ${whoseHelp(name)}` };
    if (word === 'same') return { same: true };
    if (AMBIGUOUS.has(word)) return { error: `"${said}" could be you or the player you are talking to. ${whoseHelp(name)}` };
    if (OWN.has(word) || word === String(name).toLowerCase()) return { owner: ME };
    if (word === SHARED || word === 'everyone') return { owner: SHARED };
    if (NOBODY.has(word)) return { owner: null };
    return { owner: players.find(player => player.toLowerCase() === word) ?? said };
}

/** Reads a tending permission as the model gives it. */
export function readTending(text) {
    const word = unquote(text).toLowerCase();
    if (word === 'same' || word === '') return { same: true };
    const tending = { ask: 'asked', 'when asked': 'asked', once: 'asked', whenever: 'always' }[word] ?? word;
    return TENDING.includes(tending) ? { tending } : { error: 'Whether it may be tended unasked is "always" or "asked" (or "same" to leave that as it is).' };
}

const TENDING_TEXT = { always: 'you may tend it whenever you like', asked: 'you tend it only when a player asks' };

/** The field nearest the bot that it perceives, or null. */
export function nearestField(bot) {
    const farmland = nearestFarmland(bot);
    if (!farmland) return null;
    const field = findField(blockReader(bot), farmland.position);
    return field.cells.length ? field : null;
}

/** `!markField`: says whose the field nearest the bot is, and how it may be tended. */
export function markField(bot, ownerWord, tendingWord, { book, name = '', players = [] } = {}) {
    const owner = readOwner(ownerWord, { name, players });
    if (owner.error) return toolResult('failed', owner.error, 'bad_args');
    const tending = readTending(tendingWord);
    if (tending.error) return toolResult('failed', tending.error, 'bad_args');
    if (owner.same && tending.same) return toolResult('failed', 'Nothing to change: give an owner, a permission, or both.', 'bad_args');
    const field = nearestField(bot);
    if (!field) return toolResult('failed', `You see no farmland within ${FIELD_RANGE} blocks. Go to the field first.`, 'no_field');
    const was = book.whose(field.cells);
    const who = owner.same ? was.owner : owner.owner;
    if (!who && !tending.same) return toolResult('failed', 'A field with no known owner has no permission to set. Say whose it is too.', 'bad_args');
    book.mark(field.cells, { owner: who, tending: tending.same ? null : tending.tending });
    const now = book.whose(field.cells);
    const box = fieldBox(field.cells);
    const how = now.owner ? `; ${TENDING_TEXT[now.tending] ?? TENDING_TEXT[defaultTending(now.owner)]}` : '';
    return toolResult('ok', `The field of ${field.cells.length} farmland at ${box.min.x}, ${box.min.y}, ${box.min.z}: ${ownerText(now.owner, name)}${how}.`
        + (owner.owner && owner.owner !== ME && owner.owner !== SHARED && !players.some(p => p.toLowerCase() === String(owner.owner).toLowerCase())
            ? ` (${owner.owner} is not a player you have met; check the spelling.)` : ''));
}

/**
 * Makes a command's `perform` run as one of the bot's actions, as the built-in action commands do: it takes
 * over from what the bot was doing, can be interrupted, and gives a result the model can read.
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

/**
 * The field commands.
 * @param {object} context
 * @param {() => object} context.book - the field book for the world the bot is in now
 * @param {() => void} [context.save] - writes the book down after a change
 * @param {() => {asked?: boolean|null, by?: string|null}} [context.asker] - who is behind the request
 * @param {(agent: object) => object|null} [context.memory] - world memory, when on
 * @param {(cells: object[]) => () => void} [context.tending] - opens the field a round tends to good-neighbor
 *   rules, and returns its close (neighborly.js)
 * @param {(agent: object) => (x: number, y: number, z: number, name: string) => boolean} [context.mayTill] -
 *   whether soil is free to till (not someone's), for a bot
 * @param {(agent: object) => Function|null} [context.store] - puts things away in the chests meant for them
 *   (library/store_way.js), when chest storage installed that for the bot
 * @returns {{command: object, action: boolean}[]}
 */
export function farmingCommands({ book, save = () => {}, asker = () => ({}), memory = () => null, tending = () => () => {},
    mayTill = () => () => true, store = () => null }) {
    const players = agent => Object.keys(agent.bot.players ?? {}).filter(p => p !== agent.name);
    const { compost } = composting();
    return [
        { action: true, command: {
            name: '!tendField',
            description: 'Tend the field nearest you: harvest the crops you see are ripe, replant them, sow the empty farmland, and pick up what drops. '
                + 'Unripe crops are left to grow, and you never jump onto the farmland. On your own idea you only tend your own and shared fields. '
                + 'A chest near the field that is for crops takes the harvest, and you keep seed and food.',
            params: { 'seed': { type: 'string', description: 'What to sow on empty farmland: "wheat_seeds", "carrot", "potato" or "beetroot_seeds"; or "any" to sow what grows beside each cell.' } },
            perform: asAction('tendField', async (agent, seed) => {
                try {
                    const wanted = unquote(seed).toLowerCase();
                    const result = await tendField(agent.bot, {
                        seed: wanted && wanted !== 'any' ? wanted : null, book: book(), behind: asker(),
                        name: agent.name, memory: memory(agent), tending, store: store(agent),
                    });
                    assertActionOwner(agent.bot);
                    // The result itself, not its text: the action runner reads a result's status and text, and
                    // takes anything else for a skill's return value, keeping only the log.
                    return result;
                } finally { save(); }
            }),
        } },
        { action: true, command: {
            name: '!sowField',
            description: 'Make a field: till wet, free soil near you with your hoe and sow it. Makes the field near you bigger when you may tend it, '
                + 'else starts a new one by water you can see. Tills only as much as you have seed for, and never a path, a build or someone else\'s field.',
            params: {
                'seed': { type: 'string', description: 'What to sow: "wheat_seeds", "carrot", "potato" or "beetroot_seeds"; or "any" for the seed you have most of.' },
                'size': { type: 'int', description: 'How many blocks of ground to till at most.', domain: [1, MAX_SOW, '[]'] },
            },
            perform: asAction('sowField', async (agent, seed, size) => {
                try {
                    const wanted = unquote(seed).toLowerCase();
                    const result = await sowField(agent.bot, {
                        seed: wanted && wanted !== 'any' ? wanted : null, size, book: book(), behind: asker(),
                        name: agent.name, mayTill: mayTill(agent),
                    });
                    assertActionOwner(agent.bot);
                    // The result itself, not its text: the action runner reads a result's status and text, and
                    // takes anything else for a skill's return value, keeping only the log.
                    return result;
                } finally { save(); }
            }),
        } },
        { action: true, command: {
            name: '!compost',
            description: 'Only when a player asks: put plant matter in the composter nearest you, and take out the bone meal it gives when full. '
                + 'Each item has only a chance to fill it (a seed 30%), so it takes about a stack of seeds for two bone meal.',
            params: {
                'item': { type: 'ItemName', description: 'What to compost, e.g. "wheat_seeds". Only what the player said.' },
                'count': { type: 'int', description: 'How many to put in at most.', domain: [1, Number.MAX_SAFE_INTEGER] },
            },
            perform: asAction('compost', async (agent, item, count) => {
                const result = await compost(agent.bot, unquote(item).toLowerCase(), count, { behind: asker() });
                assertActionOwner(agent.bot);
                return result;
            }),
        } },
        { action: true, command: {
            name: '!boneMealField',
            description: 'Only when a player asks: use bone meal on the young crops of the field nearest you, a plant at a time until it is ripe. '
                + 'Cuts nothing; !tendField harvests what ripened.',
            params: { 'count': { type: 'int', description: 'The most bone meal to use.', domain: [1, Number.MAX_SAFE_INTEGER] } },
            perform: asAction('boneMealField', async (agent, count) => {
                const result = await boneMealField(agent.bot, { count, book: book(), behind: asker(), memory: memory(agent) });
                assertActionOwner(agent.bot);
                return result;
            }),
        } },
        { action: false, command: {
            name: '!markField',
            description: 'Say whose the field nearest you is, whether you may tend it without being asked, or both. '
                + 'Only what someone told you; never guess an owner.',
            params: {
                'owner': { type: 'string', description: 'A player\'s name, "shared" (everyone\'s, yours too), your own name for a field of your own, "unknown", or "same" to leave the owner as it is.' },
                'tending': { type: 'string', description: '"always" (you may tend it whenever), "asked" (only when a player asks), or "same".' },
            },
            perform: (agent, owner, tending) => {
                const result = markField(agent.bot, owner, tending, { book: book(), name: agent.name, players: players(agent) });
                save();
                return result.text;
            },
        } },
    ];
}
