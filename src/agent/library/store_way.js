// SPDX-License-Identifier: CC0-1.0
// Where one module asks another to put things away in the chests meant for them, by the chest rules.
//
// Farming ends a round by taking the harvest to the field's chest, as a player whose farm has a chest beside
// it would. Which chests the bot may put into, what each chest is for and how it opens one is chest
// storage's (src/agent/storage/), so storage installs a storer for the bot and farming only asks it. With
// chest storage, or putting away and fetching, off, nothing is installed and the harvest stays in the bag.
//
// The setter lives here, not in skills.js, because that file is handed to generated code.

const storers = new WeakMap(); // bot -> async (items, request) => {status, text, stored}

/**
 * Installs how a bot puts items away in the chests meant for them (null removes it). The storer takes the
 * items (`{name, count}` each) and a request (`whose`: "any" for the bot's own and shared chests, or a
 * player's name; `distance`; `asked`: whether a player is behind it), and gives `status` ('ok', 'partial',
 * 'failed', or 'none' when no chest near is meant for them), `text` for the model, and `stored`, how many
 * items went into chests.
 */
export function setStorer(bot, storer) {
    if (storer) storers.set(bot, storer);
    else storers.delete(bot);
}

/** The storer installed for this bot, or null. */
export function storerOf(bot) {
    return storers.get(bot) ?? null;
}
