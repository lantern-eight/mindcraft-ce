// SPDX-License-Identifier: CC0-1.0
// Turns farming on for an agent. Called once from agent.js.
//
// Farming is its own feature behind its own setting (`farming`). It needs nothing else from this fork to be
// on: with fair play off it sees the world the way stock Mindcraft does, and with fair play on it follows
// the same rules as every other skill, because it asks world.js. With world memory on, `!tendField` can
// walk to a field the bot remembers when none is in view.
//
// What the bot was told about fields (whose each is, and whether it may be tended unasked) is kept in the
// field book, one file per world and dimension, under the bot's own folder.
//
// With good-neighbor rules on, the field book also answers them about crops (neighborly.js): the bot may cut
// the crops of a field it is tending, or of one it may always tend. good-neighbor rules are installed first
// (agent.js), so their protector is there to answer.
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import { scopeOf } from '../fairplay/install.js';
import { scopeDir } from '../memory/files.js';
import { requestWatcher } from '../storage/asker.js';
import { farmingCommands } from './commands.js';
import { loadFieldBook } from './field_book.js';
import { cropPermits } from './neighborly.js';
import { protectorOf } from '../neighbor/enforce.js';

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {string} [options.bookDir] - the folder the field books are kept in
 * @returns {{commands: string[], book: () => object, save: () => void, stop: () => void}|null} what was added,
 *   or null when the setting is off
 */
export function installFarming(agent, { config = settings, bookDir = null } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.farming !== true) return null;
    const baseDir = bookDir ?? `./bots/${agent.name}/farming`;

    // The book for the world the bot is in now, opened when first asked for and again when the bot turns
    // out to be somewhere else (the Nether's farmland at the same coordinates is another field).
    let book = null;
    const save = () => {
        if (!book?.dirty) return;
        try { book.save(scopeDir(baseDir, book.scope)); }
        catch (error) { console.warn('[farming] Could not save what is known about fields:', error.message); }
    };
    const bookNow = () => {
        const scope = scopeOf(agent.bot, config);
        if (book?.scope !== scope) {
            save();
            book = loadFieldBook(scopeDir(baseDir, scope), { scope });
        }
        return book;
    };

    // Who is behind what the bot is doing: on its own idea it tends only fields it may always tend.
    const watcher = requestWatcher(agent);

    // The field book's say over crops, when good-neighbor rules guard the bot.
    const permits = cropPermits({ book: bookNow, behind: () => watcher.behind() });
    const unpermit = protectorOf(agent.bot)?.permit(permits.permit) ?? (() => {});

    const commands = farmingCommands({
        book: bookNow, save, asker: () => watcher.behind(),
        memory: a => a.fairPlay?.memory ?? null, tending: permits.tending,
    });
    for (const { command, action } of commands) registerCommand(command, { action });
    return { commands: commands.map(({ command }) => command.name), book: bookNow, save, stop: unpermit };
}
