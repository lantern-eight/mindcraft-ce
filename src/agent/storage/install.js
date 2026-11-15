// SPDX-License-Identifier: CC0-1.0
// Turns chest sorting on for an agent. Called once from agent.js.
//
// Chest sorting is its own feature behind its own setting (`chest_sorting`). It needs nothing else from
// this fork to be on: with fair play off it finds and opens chests the way stock Mindcraft does, and
// with fair play on it follows the same rules as every other skill, because it asks world.js. With
// world memory on, what the bot saw in each chest is remembered as it goes, with no code here for that.
//
// What the bot was told about chests (whose each is, and whether it may be sorted unasked) is kept in
// the chest book, one file per server, world and dimension, under the bot's own folder.
import settings from '../settings.js';
import { registerCommand } from '../commands/index.js';
import { isFormerScope, scopeOf } from '../fairplay/install.js';
import { log } from '../library/skills.js';
import { adoptFormerScope, scopeDir } from '../memory/files.js';
import { requestWatcher } from './asker.js';
import { loadChestBook } from './chest_book.js';
import { storageCommands } from './commands.js';
import { watchMadeChests } from './made_chests.js';

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {object} [options.deps] - stand-ins for finding and reaching chests, for tests
 * @param {string} [options.bookDir] - the folder the chest books are kept in
 * @returns {{commands: string[], book: () => object, save: () => void, behind: () => object}|null} what
 *   was added, or null when the setting is off
 */
export function installStorage(agent, { config = settings, deps = {}, bookDir = null } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.chest_sorting !== true) return null;
    const baseDir = bookDir ?? `./bots/${agent.name}/storage`;

    // The book for the world the bot is in now. It is opened when first asked for, and again when the
    // bot turns out to be somewhere else (the Nether has its own chests at the same coordinates), so
    // nothing here has to listen for the bot changing dimension.
    let book = null;
    const save = () => {
        if (!book?.dirty) return;
        try { book.save(scopeDir(baseDir, book.scope)); }
        catch (error) { console.warn('[chest sorting] Could not save what is known about chests:', error.message); }
    };
    const bookNow = () => {
        const scope = scopeOf(agent.bot, config);
        if (book?.scope !== scope) {
            save();
            // Chest owners kept under this world's old name (scopes once included the address) come along.
            adoptFormerScope(baseDir, scope, { isFormer: old => isFormerScope(old, scope), say: note => console.log(`[chest sorting] ${note}`) });
            book = loadChestBook(scopeDir(baseDir, scope), { scope });
        }
        return book;
    };

    // A player reads the sign on a chest to see whose it is. Where the bot remembers what a sign next
    // to a chest says (world memory keeps that), the list of chests shows it. Only shows: the bot
    // never takes an owner from a sign.
    const signNear = (bot, chest) => {
        const things = agent.fairPlay?.memory?.things;
        if (!things) return null;
        const cells = [chest, chest.also].filter(Boolean);
        const edge = (axis, pick, by) => pick(...cells.map(cell => cell[axis])) + by;
        const min = { x: edge('x', Math.min, -1), y: edge('y', Math.min, -1), z: edge('z', Math.min, -1) };
        const max = { x: edge('x', Math.max, 1), y: edge('y', Math.max, 1), z: edge('z', Math.max, 1) };
        return things.within(min, max, { kinds: ['sign'] }).find(sign => sign.text)?.text ?? null;
    };

    // Who is behind what the bot is doing: a chest that is not the bot's own and not marked "always"
    // is sorted only when a player asks, so the bot's own ideas have to be told from a player's request.
    const watcher = requestWatcher(agent);

    const commands = storageCommands({ book: bookNow, save, asker: () => watcher.behind(), deps: { signNear, ...deps } });
    for (const { command, action } of commands) registerCommand(command, { action });

    // A chest the bot places itself needs nobody to say whose it is: that follows from who it was
    // placed for. What was noted goes into the result of whatever the bot is doing, so the model can
    // put it right. A chest the bot digs up is forgotten.
    watchMadeChests(agent.bot, { book: bookNow, behind: () => watcher.behind(), save, say: text => log(agent.bot, text) });
    return { commands: commands.map(({ command }) => command.name), book: bookNow, save, behind: () => watcher.behind() };
}
