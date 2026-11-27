// SPDX-License-Identifier: CC0-1.0
// What the model can ask: !explore and !exploreFor.
//
// Both are actions, so they take over from whatever the bot was doing and stop when it is told to stop, like
// every walk. The words they answer with are the explorer's; this file reads the arguments, picks the legs,
// and keeps each bot's last walk so the next call can carry it on: in the process, and with world memory (when
// it is on) so that it carries on after a restart too.
import { toolResult } from '../tool_result.js';
import { explore } from './explorer.js';
import { parseDirection } from './heading.js';
import { realLegs, targetsOf } from './legs.js';
import { loadWalk, saveWalk } from './saved.js';

const STATUS = { explored: 'ok', found: 'ok', known: 'ok', blocked: 'blocked', interrupted: 'cancelled' };

const DIRECTION = { type: 'string', description: 'Which way: north, south, east, west, north-east, north-west, '
    + 'south-east or south-west; or "on" to keep going the way you were exploring (a new way if you weren\'t).' };
const DISTANCE = { type: 'int', description: 'How far to go from here, in blocks.', domain: [16, 512, '[]'] };

/** Runs a command's body as one of the bot's actions, as the built-in action commands do. */
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
 * @param {object} options
 * @param {(agent: object) => object|null} options.memoryOf - the agent's open world memory, or null
 * @param {(bot: object, options: object) => object} [options.legsFor] - the legs to walk on (tests hand in their own)
 * @returns {object[]} the two commands
 */
export function exploreCommands(options) {
    return createExploring(options).commands;
}

/**
 * Exploring for one or more agents: the two commands, and `run(agent, what, direction, distance)`, the same
 * walk for callers that are already inside an action (the NPC's item goal). `what` is null just to explore.
 * @param {object} options - as for exploreCommands
 * @returns {{commands: object[], run: (agent: object, what: string|null, direction: string, distance: number) => Promise<object>}}
 */
export function createExploring({ memoryOf, legsFor = realLegs }) {
    // Each bot's last walk, and the dimension it was in: a walk in the Nether doesn't carry on in the overworld.
    const lastWalks = new WeakMap();

    // World memory's folder is the world and dimension the bot is in now, so a walk saved there is one made here.
    const savedWalk = memory => {
        if (!memory?.dir) return null;
        try { return loadWalk(memory.dir, memory.scope); }
        catch { return null; }
    };
    const keepWalk = (memory, trail) => {
        if (!memory?.dir) return;
        try { saveWalk(memory.dir, memory.scope, trail); }
        catch (error) { console.warn('[explore] Could not save the last walk:', error.message); }
    };

    async function run(agent, what, directionWord, distance) {
        const bot = agent.bot;
        const direction = parseDirection(directionWord);
        if (direction === null) return toolResult('failed', `"${directionWord}" is not a direction. Use north, south, east, west, `
            + 'north-east, north-west, south-east, south-west, or "on".', 'bad_direction');
        let targets = null;
        if (what !== null) {
            targets = targetsOf(bot.registry, what);
            if (targets.unknown.length) return toolResult('failed', `Don't know ${targets.unknown.map(w => `"${w}"`).join(', ')}: `
                + 'name a block or a mob as the game does, such as sand, oak_log or cow.', 'unknown_target');
            if (!targets.all.length) return toolResult('failed', 'Say what to look for: a block or a mob.', 'unknown_target');
        }
        const dimension = bot.game?.dimension ?? null;
        const memory = memoryOf(agent);
        const kept = lastWalks.get(bot);
        const last = kept?.dimension === dimension ? kept.trail : savedWalk(memory);
        const legs = legsFor(bot, { targets, memory });
        const result = await explore({ legs, direction, distance, targets: targets?.all ?? null, last });
        if (result.trail) {
            lastWalks.set(bot, { dimension, trail: result.trail });
            keepWalk(memory, result.trail);
        }
        // Exploring for something and not finding it is progress made, not a failure.
        const status = what !== null && result.status === 'explored' ? 'partial' : STATUS[result.status];
        return toolResult(status, result.text, status === 'ok' ? null : result.status);
    }

    const commands = [
        {
            name: '!explore',
            description: 'Explore new ground: walk about that far in a direction, keeping to it from one call to the next, '
                + 'going round water and steep ground, and looking round on the way. Use it to find what is not near.',
            params: { direction: DIRECTION, distance: DISTANCE },
            perform: asAction('explore', (agent, direction, distance) => run(agent, null, direction, distance)),
        },
        {
            name: '!exploreFor',
            description: 'Explore until you see something: like !explore, stopping as soon as it is in view. '
                + 'If you already see or remember one, says where instead of setting out.',
            params: {
                what: { type: 'string', description: 'What to look for: a block or mob name, or several separated by commas, such as "sand,red_sand".' },
                direction: DIRECTION,
                distance: DISTANCE,
            },
            perform: asAction('exploreFor', (agent, what, direction, distance) => run(agent, what, direction, distance)),
        },
    ];
    return { commands, run };
}
