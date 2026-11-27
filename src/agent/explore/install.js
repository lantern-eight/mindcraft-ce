// SPDX-License-Identifier: CC0-1.0
// Turns exploring on for an agent. Called once from agent.js.
//
// Exploring is its own feature behind its own setting (`explore`). It needs nothing else from this fork: with
// fair play off it walks and looks the way stock Mindcraft does. With fair play on, everything it sees comes
// through perception and every leg is planned by fair legs, because it asks world.js and the pathfinder like
// any other skill. With world memory on as well, it heads for land the bot hasn't looked over yet, and knows
// what the bot remembers seeing farther off. It also gives the NPC's item goals a way of exploring for what
// they need (library/explore_way.js).
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import { setExploreWay } from '../library/explore_way.js';
import { createExploring } from './commands.js';

const NPC_STRETCH = 64;  // blocks per call when the NPC's item goal explores for something

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
    const { commands, run } = createExploring({ memoryOf: a => a.fairPlay?.memory ?? null, recorderOf: a => a.fairPlay?.recorder ?? null, ...deps });
    for (const command of commands) registerCommand(command, { action: true });
    // The NPC's item goals explore for what they need, a stretch at a time on a kept heading, instead of
    // stepping a few blocks any way at all. Each call is 64 blocks: the goal checks again after each.
    if (agent.bot) setExploreWay(agent.bot, what => run(agent, what, 'on', NPC_STRETCH));
    return { commands: commands.map(c => c.name) };
}
