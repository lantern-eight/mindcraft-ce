// SPDX-License-Identifier: CC0-1.0
// What fair play adds to what the model reads: a sentence on an empty-handed search. The commands for
// what the bot remembers (!recall, !places, !namePlace) come with world memory (memory/commands.js).

// Messages CE's skills use when a search comes back empty.
const NOT_FOUND = /could not find|no [\w ]+ nearby|there is no [\w ]+ nearby/i;
export const SEARCH_HINT = ' (Fair play: you only know of things you can see or have seen. Finding none means none is in view or remembered, not that none exists. Explore to look, or use !recall for what you remember.)';
// With world memory off the bot remembers nothing out of view, and has no !recall.
export const SEARCH_HINT_NO_MEMORY = ' (Fair play: you only know of things you can see now. Finding none means none is in view, not that none exists. Explore to look.)';

/**
 * Under fair play "Could not find any sand" no longer means there is none, only that the bot hasn't
 * seen any. Left as is, the model tends to give up instead of exploring. This adds one sentence saying
 * so to an action's result. It runs in one place, the action runner, rather than in each of the twenty
 * or so skills that word it their own way. `remembers` says whether world memory is on, which decides
 * whether the sentence can point at what the bot remembers.
 */
export function withSearchHint(result, { remembers = true } = {}) {
    if (!result || typeof result !== 'object') return result;
    const sentence = remembers ? SEARCH_HINT : SEARCH_HINT_NO_MEMORY;
    const hint = text => (typeof text === 'string' && NOT_FOUND.test(text) && !text.includes(sentence) ? text + sentence : text);
    const text = hint(result.text), message = hint(result.message);
    return text === result.text && message === result.message ? result : { ...result, text, message };
}
