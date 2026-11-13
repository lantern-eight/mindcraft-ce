// SPDX-License-Identifier: CC0-1.0
// Commands that fair play adds for the model.
//
// !recall is the model's window into the seen-world map: "where did I see sand?" answered from memory,
// with how far, which way, and how long ago. It is what turns "the bot only knows what it has seen"
// from a limit into something useful: the bot can find its way back to the beach, the furnace, the
// chest, without anyone having told it to save the spot.
import { describeDirection } from './perception.js';

const ago = ms => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 30) return 'just now';
    if (seconds < 90) return 'a minute ago';
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
    if (seconds < 5400) return 'an hour ago';
    if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
    return seconds < 129600 ? 'a day ago' : `${Math.round(seconds / 86400)} days ago`;
};

/** Text for !recall: the nearest remembered blocks of one type. */
export function recallText(handle, bot, type, { limit = 5, now = Date.now } = {}) {
    const { seenMap, perception } = handle;
    if (!seenMap || !perception) return "You can't recall anything until you have spawned.";
    if (!perception.remembers(type))
        return `${type} isn't a kind of block you keep track of. You remember ores, logs, sand, gravel, clay, chests and other containers, crafting stations, beds, doors, crops and a few rarer blocks.`;
    const here = bot.entity.position;
    const hits = seenMap.nearest([type], here, { limit });
    if (hits.length === 0) return `You haven't seen any ${type} yet. Explore to find some.`;
    const lines = hits.map(hit => {
        const { direction } = describeDirection(here, { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
        const where = hit.distance < 1.5 ? 'right here' : `${Math.round(hit.distance)} blocks ${direction}`;
        return `- at ${hit.x}, ${hit.y}, ${hit.z}: ${where}, seen ${ago(now() - hit.lastSeen)}`;
    });
    const more = seenMap.count(type) - hits.length;
    return `REMEMBERED ${type} (nearest first)\n${lines.join('\n')}${more > 0 ? `\n- and ${more} more farther away` : ''}`;
}

export const recallCommand = {
    name: '!recall',
    description: 'List the nearest blocks of a type that you remember seeing, however far away. Use it to find your way back to things like sand, ore, a furnace or a chest.',
    params: { 'type': { type: 'BlockName', description: 'The block type to recall.' } },
    perform: function (agent, type) {
        if (!agent.fairPlay) return 'Nothing is remembered: fair play is off.';
        return recallText(agent.fairPlay, agent.bot, type);
    },
};

// Messages CE's skills use when a search comes back empty.
const NOT_FOUND = /could not find|no [\w ]+ nearby|there is no [\w ]+ nearby/i;
export const SEARCH_HINT = ' (Fair play: you only know of things you can see or have seen. Finding none means none is in view or remembered, not that none exists. Explore to look, or use !recall for what you remember.)';

/**
 * Under fair play "Could not find any sand" no longer means there is none, only that the bot hasn't
 * seen any. Left as is, the model tends to give up instead of exploring. This adds one sentence saying
 * so to an action's result. It runs in one place, the action runner, rather than in each of the twenty
 * or so skills that word it their own way.
 */
export function withSearchHint(result) {
    if (!result || typeof result !== 'object') return result;
    const hint = text => (typeof text === 'string' && NOT_FOUND.test(text) && !text.includes(SEARCH_HINT) ? text + SEARCH_HINT : text);
    const text = hint(result.text), message = hint(result.message);
    return text === result.text && message === result.message ? result : { ...result, text, message };
}
