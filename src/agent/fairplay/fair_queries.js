// SPDX-License-Identifier: CC0-1.0
// The fair query provider for world.js: searches answer from what the bot has seen, not from chunk data.
//
// Installed with setWorldQueries(fairQueries). From then on every caller of world.js (the prompt's
// "current state", !nearbyBlocks, !entities, !collectBlocks, chests, furnaces, beds, reflexes, NPC code,
// and generated code through the code runner) gets fair answers without being edited.
//
// Bots opt in one at a time with registerFairPlay(bot, { perception, policy }). An unregistered bot keeps
// raw behavior, so tests, CE's own live scenarios and multi-bot setups aren't surprised.
//
// The policy's through-walls switches are applied here, and only here: a category the policy allows
// (say ores_through_walls) is searched raw as well and merged in by distance. That is the single check
// each of those switches needs.
import { allowsRawBlock, allowsRawEntity, anyRawBlocks } from './policy.js';

const registrations = new WeakMap();

/** Puts one bot under fair play. `perception` provides blockAt(pos), findBlocks(options), entities(). */
export function registerFairPlay(bot, { perception, policy }) {
    if (!perception || !policy) throw new Error('registerFairPlay needs a perception service and a policy');
    registrations.set(bot, { perception, policy });
}

export function unregisterFairPlay(bot) {
    registrations.delete(bot);
}

export function fairPlayOf(bot) {
    return registrations.get(bot) ?? null;
}

const keyOf = p => `${p.x},${p.y},${p.z}`;

// Narrows a findBlocks `matching` (an id, a list of ids, or a predicate) to the block types the policy
// lets through walls. Returns null when nothing in the request qualifies, so no raw search runs at all.
function restrictToRaw(bot, matching, allowed) {
    if (typeof matching === 'function') return block => allowed(block?.name) && matching(block);
    const ids = [].concat(matching).filter(id => allowed(bot.registry?.blocks?.[id]?.name));
    return ids.length ? ids : null;
}

function mergeNearest(first, second, origin, count) {
    const seen = new Set();
    const all = [];
    for (const p of [...first, ...second]) {
        const k = keyOf(p);
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(p);
    }
    all.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
    return all.slice(0, count);
}

export const fairQueries = Object.freeze({
    findBlocks(bot, options) {
        const reg = registrations.get(bot);
        if (!reg || reg.policy.sight === 'all') return bot.findBlocks(options);
        const fair = reg.perception.findBlocks(options);
        if (!anyRawBlocks(reg.policy)) return fair;
        const rawMatching = restrictToRaw(bot, options.matching, name => allowsRawBlock(reg.policy, name));
        if (!rawMatching) return fair;
        const extra = bot.findBlocks({ ...options, matching: rawMatching });
        return mergeNearest(fair, extra, options.point ?? bot.entity.position, options.count ?? 1);
    },

    blockAt(bot, position) {
        const reg = registrations.get(bot);
        if (!reg || reg.policy.sight === 'all') return bot.blockAt(position);
        const known = reg.perception.blockAt(position);
        if (known) return known;
        if (anyRawBlocks(reg.policy)) {
            const block = bot.blockAt(position);
            if (block && allowsRawBlock(reg.policy, block.name)) return block;
        }
        return null;
    },

    entities(bot) {
        const reg = registrations.get(bot);
        if (!reg) return Object.values(bot.entities);
        const { policy } = reg;
        const known = new Set(reg.perception.entities());
        if (bot.entity) known.add(bot.entity); // the bot always knows where it is
        if (policy.mobs_through_walls === true || policy.players_through_walls === true) {
            const here = bot.entity.position;
            for (const entity of Object.values(bot.entities)) {
                if (allowsRawEntity(policy, entity) && entity.position.distanceTo(here) <= policy.entity_distance)
                    known.add(entity);
            }
        }
        return [...known];
    },

    nearestEntity(bot, match = () => true) {
        if (!registrations.has(bot)) return bot.nearestEntity(match);
        const here = bot.entity.position;
        let best = null, bestDistance = Infinity;
        for (const entity of fairQueries.entities(bot)) {
            if (entity === bot.entity || !match(entity)) continue;
            const d = entity.position.distanceSquared(here);
            if (d < bestDistance) { best = entity; bestDistance = d; }
        }
        return best;
    },
});
