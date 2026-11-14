// SPDX-License-Identifier: CC0-1.0
// Turns chest sorting on for an agent. Called once from agent.js.
//
// Chest sorting is its own feature behind its own setting (`chest_sorting`). It needs nothing else from
// this fork to be on: with fair play off it finds and opens chests the way stock Mindcraft does, and
// with fair play on it follows the same rules as every other skill, because it asks world.js. With
// world memory on, what the bot saw in each chest is remembered as it goes, with no code here for that.
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import { sortChestsCommand } from './commands.js';

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {object} [options.deps] - stand-ins for finding and reaching chests, for tests
 * @returns {{commands: string[]}|null} what was added, or null when the setting is off
 */
export function installStorage(agent, { config = settings, deps = {} } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.chest_sorting !== true) return null;
    const commands = [sortChestsCommand(deps)];
    for (const command of commands) registerCommand(command, { action: true });
    return { commands: commands.map(command => command.name) };
}
