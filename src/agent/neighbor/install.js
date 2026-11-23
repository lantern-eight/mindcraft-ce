// SPDX-License-Identifier: CC0-1.0
// Turns good-neighbor rules on for an agent. Called once from agent.js.
//
// Today that is the protection rule: the bot doesn't break what other players built (protect.js says
// what counts, enforce.js where it is enforced). It is its own feature behind `good_neighbor.protect_builds`,
// and needs nothing else from this fork to be on:
//   - with fair play on, it reads the world as the bot knows it (what it sees and remembers); with fair
//     play off, or seeing all around, it reads the world as stock Mindcraft does;
//   - with world memory on, a block the bot saw someone put up is protected whatever it is made of, and
//     the bot's own blocks are known across restarts; without it, only what it placed this session is its own.
import Vec3 from 'vec3';
import settings from '../settings.js';
import { resolvePolicy } from '../fairplay/policy.js';
import { editionOf } from '../edition/index.js';
import { compileArea, createProtector } from './protect.js';
import { guardBot } from './enforce.js';

const SIGHT_RANGE = 32; // how far a cell is checked for being in view right now; farther ones come from memory

/**
 * @param {object} agent - the agent, once it has a bot
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @returns {{protector: object, stop: () => void}|null} null when the rule is off
 */
export function installGoodNeighbor(agent, { config = settings } = {}) {
    const policy = resolvePolicy(config);
    if (policy.good_neighbor?.protect_builds !== true) return null;
    const bot = agent.bot;
    const edition = () => editionOf(bot.registry);
    const javaName = name => (bot.registry ? edition().javaNameOf(bot.registry, name) : name);

    // The areas from the settings. One that can't be read is said once and left out, not guessed at.
    const areas = [];
    for (const area of policy.good_neighbor.protected_areas ?? []) {
        const compiled = compileArea(area);
        if (compiled) areas.push(compiled);
        else console.warn(`[good neighbor] A protected area needs a name and either min and max corners or x, z and radius: ${JSON.stringify(area)}`);
    }

    // What the bot knows at a cell. Under fair play it is what it sees or remembers; a cell it knows
    // nothing of is unknown, never read from the world.
    const fair = () => agent.fairPlay && agent.fairPlay.policy?.sight !== 'all' ? agent.fairPlay : null;
    const blockAt = (x, y, z) => {
        const fp = fair();
        if (!fp) return bot.blockAt?.(new Vec3(x, y, z)) ?? null;
        if (fp.legs) {
            const block = fp.legs.believed(x, y, z);
            return block?.unseen ? null : block;
        }
        return fp.perception?.believedAt(x, y, z, SIGHT_RANGE) ?? null;
    };
    const leavesPersist = stateId => Boolean(bot.registry) && edition().leavesPersist(bot.registry, stateId);
    const read = (x, y, z) => {
        const block = blockAt(x, y, z);
        if (!block?.name) return null;
        const name = javaName(block.name);
        const live = block.stateId != null && block.rememberedAt === undefined;
        return { name, placedLeaves: name.endsWith('_leaves') && live ? leavesPersist(block.stateId) : null };
    };

    // What the bot placed this session, for when world memory is off (or hasn't caught up yet).
    const placed = new Set();
    const cellKey = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    const onPlaced = (oldBlock, newBlock) => { const p = (newBlock ?? oldBlock)?.position; if (p) placed.add(cellKey(p)); };
    const onDug = block => { if (block?.position) placed.delete(cellKey(block.position)); };
    bot.on?.('blockPlaced', onPlaced);
    bot.on?.('diggingCompleted', onDug);
    // mineflayer's digging plugin removes every 'diggingCompleted' listener when the bot dies; put this one back.
    const onDeath = () => queueMicrotask(() => { bot.off?.('diggingCompleted', onDug); bot.on?.('diggingCompleted', onDug); });
    bot.on?.('death', onDeath);

    const protector = createProtector({
        read, javaName, areas, leavesPersist,
        tagOf: (x, y, z) => agent.fairPlay?.memory?.cells?.tagOf(x, y, z) ?? null,
        placedNow: (x, y, z) => placed.has(`${x},${y},${z}`),
        dimension: () => bot.game?.dimension ?? 'overworld',
    });
    const unguard = guardBot(bot, protector);
    console.log(`[good neighbor] Protecting other players' builds${areas.length ? `, and ${areas.length} protected area(s)` : ''}.`);
    return {
        protector,
        stop() { unguard(); bot.off?.('blockPlaced', onPlaced); bot.off?.('diggingCompleted', onDug); bot.off?.('death', onDeath); },
    };
}
