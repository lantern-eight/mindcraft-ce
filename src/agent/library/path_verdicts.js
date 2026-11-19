// SPDX-License-Identifier: CC0-1.0
// Remembered answers to "can the bot walk to that mob?" (world.isClearPath), so the reflexes don't ask
// the pathfinder anew every round.
//
// Each reflex round (about every 300 ms) the stock reflexes that deal with mobs and items ask isClearPath
// about the nearest one, and each ask is a path search of up to 100 ms. With mobs about, that is most of
// a round spent searching for the same answer again. An answer is kept for 3 s, unless the mob or the
// bot has moved 4 blocks since, which is when it could have changed.
//
// world.js asks here before it searches (core hook 26). With no cache installed for the bot, nothing is
// kept and every ask searches, as in Mindcraft. The setter lives here, not in world.js, because world.js
// is handed to generated code.

const caches = new WeakMap(); // bot -> { verdicts: Map(id -> entry), ttlMs, moveBlocks, now }

const far = (a, b, blocks) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= blocks;

/**
 * Starts keeping path verdicts for this bot.
 * @param {object} bot
 * @param {{ttlMs?: number, moveBlocks?: number, now?: () => number}} [options]
 * @returns {{stats: {asked: number, kept: number}}} counts of asks and of asks answered from the cache
 */
export function keepPathVerdicts(bot, { ttlMs = 3000, moveBlocks = 4, now = Date.now } = {}) {
    const cache = { verdicts: new Map(), ttlMs, moveBlocks, now, stats: { asked: 0, kept: 0 } };
    caches.set(bot, cache);
    return cache;
}

/** The verdict kept for walking to `target`, or undefined when there is none still good. */
export function keptVerdict(bot, target) {
    const cache = caches.get(bot);
    if (!cache) return undefined;
    cache.stats.asked++;
    const id = target?.id;
    if (id === undefined || id === null) return undefined;
    const entry = cache.verdicts.get(id);
    if (!entry) return undefined;
    if (cache.now() - entry.at > cache.ttlMs || far(entry.target, target.position, cache.moveBlocks)
        || far(entry.bot, bot.entity.position, cache.moveBlocks)) {
        cache.verdicts.delete(id);
        return undefined;
    }
    cache.stats.kept++;
    return entry.verdict;
}

/** Keeps the verdict just found for walking to `target`. */
export function keepVerdict(bot, target, verdict) {
    const cache = caches.get(bot);
    const id = target?.id;
    if (!cache || id === undefined || id === null) return;
    if (cache.verdicts.size > 256) cache.verdicts.clear(); // mobs come and go; never let it grow
    cache.verdicts.set(id, {
        verdict, at: cache.now(),
        target: { x: target.position.x, y: target.position.y, z: target.position.z },
        bot: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z },
    });
}
