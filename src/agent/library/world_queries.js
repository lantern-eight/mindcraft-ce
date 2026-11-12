// Where world.js gets its block and entity searches from.
//
// Every search in world.js (nearest blocks, nearby entities, the block at a spot) goes through the
// provider below. The default reads the bot directly, exactly as Mindcraft always has. Another module can
// install a different provider, for example one that answers only from what the bot has actually seen,
// and every caller of world.js (commands, skills, reflexes, prompts) follows without being edited.
//
// The setter lives here rather than in world.js on purpose: world.js is handed to generated code, so a
// setter there would let that code swap the provider back.

const rawQueries = Object.freeze({
    /** Positions of matching blocks, nearest first (mineflayer's findBlocks options). */
    findBlocks: (bot, options) => bot.findBlocks(options),
    /** The block at a position, or null. */
    blockAt: (bot, position) => bot.blockAt(position),
    /** Every entity the bot knows about, itself included. */
    entities: (bot) => Object.values(bot.entities),
    /** The nearest entity (not the bot itself) that matches. */
    nearestEntity: (bot, match) => bot.nearestEntity(match),
});

let current = rawQueries;

export function worldQueries() {
    return current;
}

/** Installs a provider; missing methods fall back to the raw ones. Pass null to restore the default. */
export function setWorldQueries(provider) {
    current = provider ? Object.freeze({ ...rawQueries, ...provider }) : rawQueries;
}
