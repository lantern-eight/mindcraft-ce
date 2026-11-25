// SPDX-License-Identifier: CC0-1.0
// Lava from a lava farm, for fuel. A cauldron full of lava under pointed dripstone fills itself again: a
// player who built one has fuel without end, and a bucket of it smelts a hundred items. So when the bot
// knows of a full lava cauldron near, lava is the first fuel, before coal.
//
// The bot fills a bucket the way a player does: walks up to the cauldron, holds an empty bucket and uses it
// on the cauldron. For the bucket: one it carries, else an empty bucket it knows is lying in a furnace's
// fuel slot (lava leaves its bucket there when it catches), which it takes out, else one fetched from the
// chests and shelves it remembers holding one. Which of those it may take from is for the chest rules to
// say, so that last step is chest storage's fetch (library/fetch_way.js), the same as `!fetchItem`.
//
// The cauldron is found through world.js like any block (under fair play: one the bot has seen or
// remembers), and asked of the edition seam (`cauldronOf`), since Bedrock's cauldron is one block with the
// liquid as a state where Java has a block per liquid.
import { Vec3 } from 'vec3';
import { LAVA } from './fuel.js';

/** A lava cauldron this near the bot is used; a player doesn't walk far for one bucket. */
export const LAVA_RANGE = 32;
/** The empty bucket a lava bucket leaves behind. */
export const BUCKET = 'bucket';

const where = pos => `${pos.x}, ${pos.y}, ${pos.z}`;

/**
 * @param {object} deps
 * @param {object} deps.world - `getNearestBlocksWhere`, `getInventoryCounts` (library/world.js)
 * @param {object} deps.skills - `goToPosition` (library/skills.js)
 * @param {(bot: object, pos: Vec3) => object|null} deps.blockAt - a block as the bot may know it
 * @param {(registry: object) => object} deps.editionOf - the edition seam
 * @param {(bot: object, block: object) => Promise<{furnace?: object, problem?: string}>} deps.openFurnace -
 *   walks to a furnace and opens it (smelt.js's)
 * @param {(bot: object) => {x: number, y: number, z: number}[]} [deps.knownBuckets] - furnaces the bot
 *   remembers holding an empty bucket, nearest first (world memory)
 * @param {(bot: object, name: string, count: number) => Promise<{text: string, taken?: object[]}|null>} [deps.fetchItem] -
 *   fetches an item from the chests and shelves the bot may take from (library/fetch_way.js), or gives null
 *   when chest storage isn't there to ask
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function lavaSource({ world, skills, blockAt, editionOf, openFurnace, knownBuckets = () => [], fetchItem = async () => null,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const countOf = (bot, name) => world.getInventoryCounts(bot)[name] ?? 0;

    /** The nearest full lava cauldron the bot knows of near it, or null. */
    function farmNear(bot) {
        const edition = editionOf(bot.registry);
        const full = block => { const c = edition.cauldronOf?.(block); return c?.liquid === 'lava' && c.full; };
        return world.getNearestBlocksWhere(bot, full, LAVA_RANGE, 1)?.[0] ?? null;
    }

    /** Takes an empty bucket out of a furnace's fuel slot. True when the bot now has one more bucket. */
    async function bucketFromFurnace(bot, pos) {
        const block = blockAt(bot, new Vec3(pos.x, pos.y, pos.z));
        if (!editionOf(bot.registry).furnaceOf(block)) return false;
        const opened = await openFurnace(bot, block);
        if (!opened.furnace) return false;
        try {
            if (opened.furnace.slots().fuel?.name !== BUCKET) return false;
            return Boolean(await opened.furnace.take('fuel'));
        } finally {
            await opened.furnace.close();
        }
    }

    /**
     * Fills a bucket with lava from a lava farm near the bot, if it knows of one and can get a bucket. Gives
     * `{farm, filled, note}`: `farm` whether it knows of a full lava cauldron near (lava then goes first),
     * `filled` whether it now carries a lava bucket for this smelt, and a sentence for what it did or why
     * not. A lava bucket the bot already carries is used, and the cauldron left full for next time.
     */
    async function fill(bot) {
        const cauldron = farmNear(bot);
        if (!cauldron) return { farm: false, filled: countOf(bot, LAVA) > 0, note: null };
        if (countOf(bot, LAVA) > 0) return { farm: true, filled: true, note: null };
        const at = cauldron.position;
        let note = null;
        if (countOf(bot, BUCKET) === 0) {
            for (const pos of knownBuckets(bot)) {
                if (bot.interrupt_code) return { farm: true, filled: false, note: null };
                if (await bucketFromFurnace(bot, pos)) { note = `I took an empty bucket out of the furnace at ${where(pos)}.`; break; }
            }
        }
        // Last, the chests and shelves, as a player would go and get one from their storage.
        let fetched = null;
        if (countOf(bot, BUCKET) === 0 && !bot.interrupt_code) {
            try { fetched = await fetchItem(bot, BUCKET, 1); }
            catch (error) { console.warn('[smelting] Fetching an empty bucket:', error?.message ?? error); }
            const from = fetched?.taken?.[0];
            if (countOf(bot, BUCKET) > 0) note = from ? `I took an empty bucket from the ${from.label} (${from.owner}).` : 'I fetched an empty bucket.';
        }
        if (bot.interrupt_code) return { farm: true, filled: false, note };
        if (countOf(bot, BUCKET) === 0) {
            // A chest that held a bucket the bot may not take, as the fetch named it, so the model can ask whose
            // it is. Not the rest of what the fetch said: its "did you mean" is for a player typing a name.
            const held = String(fetched?.text ?? '').split('\n').filter(line => line.startsWith('- '));
            const why = held.length ? `\n${held.join('\n')}` : '';
            return { farm: true, filled: false, note: `There is lava in the cauldron at ${where(at)}, but I have no empty bucket for it.${why}` };
        }

        // Up to it, the bucket in hand, and use it on the cauldron.
        await skills.goToPosition(bot, at.x, at.y, at.z, 2);
        if (bot.interrupt_code) return { farm: true, filled: false, note };
        const before = countOf(bot, LAVA);
        try {
            const bucket = bot.inventory.items().find(item => item.name === BUCKET);
            await bot.equip(bucket, 'hand');
            await bot.lookAt(new Vec3(at.x + 0.5, at.y + 0.5, at.z + 0.5));
            const block = blockAt(bot, at) ?? cauldron;
            await bot.activateBlock(block);
        } catch (error) {
            console.warn('[smelting] Filling a bucket with lava:', error?.message ?? error);
        }
        // The server's answer: the bucket in the bot's hand turns into a lava bucket.
        for (let i = 0; i < 10 && countOf(bot, LAVA) <= before; i++) await sleep(100);
        const filled = countOf(bot, LAVA) > before;
        const did = filled ? `I filled a bucket with lava from the cauldron at ${where(at)}.` : `I couldn't fill a bucket from the cauldron at ${where(at)}.`;
        return { farm: true, filled, note: [note, did].filter(Boolean).join(' ') };
    }

    return { farmNear, fill };
}
