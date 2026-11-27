// SPDX-License-Identifier: CC0-1.0
// The commands smelting adds for the model: loading a furnace and leaving it, coming back for what is done,
// and asking what is smelting where. `!smeltItem` and `!clearFurnace` are Mindcraft's own, and go through
// the same module by its hook in skills.js.
//
// Each command finds the bot's smelting through library/smelt_way.js, so it always uses the way installed
// for the bot it is run for.
import { smeltWayOf } from '../library/smelt_way.js';

const OFF = 'Smelting is off (set smelting to true in settings.js).';

/**
 * Makes a command's `perform` run as one of the bot's actions, the way the built-in action commands do:
 * it takes over from whatever the bot was doing, can be interrupted, and gives a result the model can read
 * (with `.structured` for native tool calls).
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

/** The commands, as `{action, command}` for registerCommand. */
export function smeltingCommands() {
    const way = agent => smeltWayOf(agent.bot);
    return [
        { action: true, command: {
            name: '!loadFurnace',
            description: 'Load a furnace with an item to smelt and the fuel for it, and leave it working while you do something else, '
                + 'as a player does with a long smelt. Puts in up to a stack; the rest go in when you collect. Says when it will be done. '
                + 'Use !smeltItem instead when you need the result right away.',
            params: {
                'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
                'num': { type: 'int', description: 'How many to smelt in all.', domain: [1, Number.MAX_SAFE_INTEGER] },
            },
            perform: asAction('loadFurnace', async (agent, itemName, num) => {
                if (!way(agent)) return OFF;
                return await way(agent).loadFurnace(agent.bot, itemName, num);
            }),
        } },
        { action: true, command: {
            name: '!collectFurnace',
            description: 'Go back to the furnaces you left smelting, take out what is done, and put in more of what was to be smelted.',
            params: {},
            perform: asAction('collectFurnace', async agent => {
                if (!way(agent)) return OFF;
                return await way(agent).collectFurnace(agent.bot);
            }),
        } },
        { action: false, command: {
            name: '!furnaces',
            description: 'List what you left smelting in furnaces, and when each should be done.',
            params: {},
            perform: agent => (way(agent) ? way(agent).furnacesText(agent.bot) : OFF),
        } },
    ];
}

/**
 * Adds the "should be done" lines to a result the model is about to read, the way fair play adds what world
 * memory noticed. Each job is mentioned once.
 */
export function withReadyNotes(result, notes) {
    if (!notes.length || !result || typeof result !== 'object') return result;
    const add = text => (typeof text === 'string' ? `${text}\n${notes.join('\n')}` : text);
    return { ...result, text: add(result.text), message: add(result.message) };
}
