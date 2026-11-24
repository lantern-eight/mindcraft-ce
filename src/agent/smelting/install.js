// SPDX-License-Identifier: CC0-1.0
// Turns smelting on for an agent. Called once from agent.js.
//
// Smelting is its own feature behind its own setting (`smelting`). It needs nothing else from this fork:
// with fair play off it finds furnaces the way stock Mindcraft does, and with fair play on only the ones
// the bot has seen or remembers, because it asks world.js. It takes over Mindcraft's `smeltItem` and
// `clearNearestFurnace` through library/smelt_way.js, so `!smeltItem`, `!clearFurnace`, model-written code
// and the NPC's item goals all smelt this way. It adds `!loadFurnace`, `!collectFurnace` and `!furnaces`
// for a furnace loaded and left, and says on the next result when one should be done.
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { setSmeltWay } from '../library/smelt_way.js';
import { editionOf } from '../edition/index.js';
import { lookBeforeSearch } from '../library/search_look.js';
import { scopeOf } from '../fairplay/install.js';
import { scopeDir } from '../memory/files.js';
import { loadJobs } from './jobs.js';
import { smeltingCommands, withReadyNotes } from './commands.js';
import { smeltingSkills } from './smelt.js';

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {string} [options.jobsDir] - the folder the smelting jobs are kept in, one folder per world
 * @returns {object|null} what was installed (the smelting skills, `jobs` and the `commands` added), or null
 *   when the setting is off
 */
export function installSmelting(agent, { config = settings, jobsDir = null } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.smelting !== true || !agent?.bot) return null;
    const baseDir = jobsDir ?? `./bots/${agent.name}/smelting`;

    // What the bot left smelting where, for the world it is in now. Opened when first asked for, and
    // again when the bot turns out to be somewhere else (the Nether has its own furnaces at the same
    // coordinates). Written out each time it changes: a job is worth keeping through a crash.
    let book = null;
    const jobs = () => {
        const scope = scopeOf(agent.bot, config);
        if (book?.scope !== scope) book = loadJobs(scopeDir(baseDir, scope), { scope });
        return book;
    };
    const saveJobs = () => {
        if (!book?.dirty) return;
        try { book.save(scopeDir(baseDir, book.scope)); }
        catch (error) { console.warn('[smelting] Could not save what is smelting where:', error.message); }
    };

    const way = smeltingSkills({
        world,
        skills,
        blockAt: (bot, pos) => worldQueries().blockAt(bot, pos),
        editionOf,
        lookAround: lookBeforeSearch,
        jobs,
        saveJobs,
    });
    setSmeltWay(agent.bot, way);

    const commands = smeltingCommands();
    for (const { command, action } of commands) registerCommand(command, { action });

    // A furnace left working should be done by now: said once, on the next result the model reads, as a
    // player glances at the time while doing something else.
    if (agent.actions?.runAction) {
        const runAction = agent.actions.runAction.bind(agent.actions);
        agent.actions.runAction = async (label, fn, options) => {
            const result = await runAction(label, fn, options);
            let notes = [];
            try { notes = way.readyNotes(agent.bot); }
            catch (error) { console.warn('[smelting] Could not check the furnaces left working:', error.message); }
            return withReadyNotes(result, notes);
        };
    }
    return { ...way, jobs, commands: commands.map(({ command }) => command.name) };
}
