// SPDX-License-Identifier: CC0-1.0
// What the model can ask about fields, and how the answers read.
//
//   !tendField(seed)              harvests what is ripe in the field nearest the bot, replants it, sows the
//                                 empty farmland, and picks up the drops
//   !markField(owner, tending)    says whose the field nearest the bot is, whether it may be tended
//                                 without being asked, or both
//
// Whether a field may be tended is decided in code (field_book.js `mayTend`) from what the field book was
// told and who is behind the request, never by the model. The model only decides to ask.
import { assertActionOwner } from '../action_context.js';
import { toolResult } from '../tool_result.js';
import { findField, fieldBox } from './field.js';
import { ME, SHARED, TENDING, defaultTending } from './field_book.js';
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
 * @returns {{command: object, action: boolean}[]}
 */
export function farmingCommands({ book, save = () => {}, asker = () => ({}), memory = () => null, tending = () => () => {} }) {
    const players = agent => Object.keys(agent.bot.players ?? {}).filter(p => p !== agent.name);
    return [
        { action: true, command: {
            name: '!tendField',
            description: 'Tend the field nearest you: harvest the crops you see are ripe, replant them, sow the empty farmland, and pick up what drops. '
                + 'Unripe crops are left to grow, and you never jump onto the farmland. On your own idea you only tend your own and shared fields.',
            params: { 'seed': { type: 'string', description: 'What to sow on empty farmland: "wheat_seeds", "carrot", "potato" or "beetroot_seeds"; or "any" to sow what grows beside each cell.' } },
            perform: asAction('tendField', async (agent, seed) => {
                try {
                    const wanted = unquote(seed).toLowerCase();
                    const result = await tendField(agent.bot, {
                        seed: wanted && wanted !== 'any' ? wanted : null, book: book(), behind: asker(),
                        name: agent.name, memory: memory(agent), tending,
                    });
                    assertActionOwner(agent.bot);
                    return result.status === 'ok' ? result.text : `[${result.status}] ${result.text}`;
                } finally { save(); }
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
