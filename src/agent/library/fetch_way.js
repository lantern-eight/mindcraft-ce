// SPDX-License-Identifier: CC0-1.0
// Where one module asks another to fetch an item from the chests, by the chest rules.
//
// Smelting fills a bucket at a lava farm, and a player short of an empty bucket would go and take one from
// their chests. Which chests the bot may take from, and how it opens them and their shelves, is chest
// storage's (src/agent/storage/), so storage installs a fetcher for the bot and smelting only asks it. With
// chest storage, or putting away and fetching, off, nothing is installed and the question has no answer.
//
// The setter lives here, not in skills.js, because that file is handed to generated code.

const fetchers = new WeakMap(); // bot -> async (name, count) => {status, text, taken}

/**
 * Installs how a bot fetches an item from its chests (null removes it). The fetcher gives the fetch
 * result: `status` ('ok', 'partial' or 'failed'), `text` for the model, and `taken`, a list of
 * `{label, owner, count}` saying where it took from.
 */
export function setFetcher(bot, fetcher) {
    if (fetcher) fetchers.set(bot, fetcher);
    else fetchers.delete(bot);
}

/** The fetcher installed for this bot, or null. */
export function fetcherOf(bot) {
    return fetchers.get(bot) ?? null;
}
