// SPDX-License-Identifier: CC0-1.0
// Turns smelting on for an agent. Called once from agent.js.
//
// Smelting is its own feature behind its own setting (`smelting`). It needs nothing else from this fork:
// with fair play off it finds furnaces the way stock Mindcraft does, and with fair play on only the ones
// the bot has seen or remembers, because it asks world.js. It takes over Mindcraft's `smeltItem` and
// `clearNearestFurnace` through library/smelt_way.js, so `!smeltItem`, `!clearFurnace`, model-written code
// and the NPC's item goals all smelt this way.
import settings from '../settings.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { setSmeltWay } from '../library/smelt_way.js';
import { editionOf } from '../edition/index.js';
import { lookBeforeSearch } from '../library/search_look.js';
import { smeltingSkills } from './smelt.js';

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @returns {{smeltItem: Function, clearFurnace: Function}|null} what was installed, or null when the
 *   setting is off
 */
export function installSmelting(agent, { config = settings } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.smelting !== true || !agent?.bot) return null;
    const way = smeltingSkills({
        world,
        skills,
        blockAt: (bot, pos) => worldQueries().blockAt(bot, pos),
        editionOf,
        lookAround: lookBeforeSearch,
    });
    setSmeltWay(agent.bot, way);
    return way;
}
