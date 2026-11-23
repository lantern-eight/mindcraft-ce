// SPDX-License-Identifier: CC0-1.0
// Turns exploring on for an agent. Called once from agent.js.
//
// Exploring is its own feature behind its own setting (`explore`). It needs nothing else from this fork: with
// fair play off it walks and looks the way stock Mindcraft does. With fair play on, everything it sees comes
// through perception and every leg is planned by fair legs, because it asks world.js and the pathfinder like
// any other skill. With world memory on as well, it heads for land the bot hasn't looked over yet, and knows
// what the bot remembers seeing farther off.
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import { exploreCommands } from './commands.js';

/**
 * @param {object} agent
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {object} [options.deps] - stand-ins for the legs, for tests
 * @returns {{commands: string[]}|null} what was added, or null when the setting is off
 */
export function installExplore(agent, { config = settings, deps = {} } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.explore !== true) return null;
    const commands = exploreCommands({ memoryOf: a => a.fairPlay?.memory ?? null, ...deps });
    for (const command of commands) registerCommand(command, { action: true });
    return { commands: commands.map(c => c.name) };
}
