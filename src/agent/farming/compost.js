// SPDX-License-Identifier: CC0-1.0
// Making bone meal at a composter, the way a player does: click it with plant matter in hand until it is
// full, wait the second it takes to ripen, and click it once more for the bone meal it gives.
//
// Only when a player asks (`!compost`). Each item has a chance to raise the composter's level, a seed only
// three times in ten, so a stack of seeds makes about two bone meal: rarely worth it, and nothing the bot
// should spend its harvest on by its own idea. The player names what to compost and how much; the bot puts
// in nothing else.
//
// The composter is found with world.js, so under fair play only one the bot has seen; it is walked to with
// the pathfinder and clicked through the reach rule. Its level is read through the edition seam
// (`composterOf`), which knows each edition's name for it.
import Vec3 from 'vec3';
import { assertActionOwner } from '../action_context.js';
import { editionOf } from '../edition/index.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { worldQueries } from '../library/world_queries.js';
import { toolResult } from '../tool_result.js';

/** How far from the bot a composter is looked for. */
export const COMPOSTER_RANGE = 16;
/** How long a composter at 7 takes to turn ready, with room for a slow server. */
const RIPEN_MS = 2500;
/** How long the bot waits for the server to take an item or give the bone meal. */
const CLICK_MS = 1200;
/** Clicks in a row that took nothing before the bot gives up. */
const MISSES = 3;

// The chance, in percent, that an item raises a composter's level: the game's own table, the same in both
// editions. Leaves, saplings and flowers go by their names' endings below.
const CHANCE = new Map([
    ...['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'short_grass', 'kelp',
        'dried_kelp', 'seagrass', 'sweet_berries', 'glow_berries', 'hanging_roots', 'mangrove_roots', 'moss_carpet',
        'pink_petals', 'pitcher_pod', 'small_dripleaf', 'leaf_litter', 'short_dry_grass'].map(name => [name, 30]),
    ...['cactus', 'sugar_cane', 'melon_slice', 'tall_grass', 'vine', 'glow_lichen', 'twisting_vines', 'weeping_vines',
        'nether_sprouts', 'dried_kelp_block', 'flowering_azalea_leaves', 'tall_dry_grass'].map(name => [name, 50]),
    ...['wheat', 'carrot', 'potato', 'beetroot', 'apple', 'melon', 'pumpkin', 'carved_pumpkin', 'cocoa_beans', 'fern',
        'large_fern', 'lily_pad', 'moss_block', 'nether_wart', 'sea_pickle', 'shroomlight', 'spore_blossom',
        'big_dripleaf', 'azalea', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_roots',
        'warped_roots', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower',
        'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'open_eyeblossom',
        'closed_eyeblossom', 'wildflowers', 'cactus_flower', 'firefly_bush', 'bush'].map(name => [name, 65]),
    ...['baked_potato', 'bread', 'cookie', 'hay_block', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
        'nether_wart_block', 'warped_wart_block', 'flowering_azalea', 'torchflower', 'pitcher_plant'].map(name => [name, 85]),
    ...['cake', 'pumpkin_pie'].map(name => [name, 100]),
]);

/** The chance in percent that an item raises a composter's level, or 0 for one it won't take. */
export function compostChance(name) {
    if (CHANCE.has(name)) return CHANCE.get(name);
    if (name.endsWith('_leaves') || name.endsWith('_sapling') || name.endsWith('_propagule')) return 30;
    if (name.endsWith('_tulip')) return 65;
    return 0;
}

const where = p => `${p.x}, ${p.y}, ${p.z}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The composting skill, with what it uses of the world and the bot handed in (tests stand in for them).
 * @param {object} [deps]
 * @param {object} [deps.world] - `getNearestBlocksWhere`, `getInventoryCounts` (library/world.js)
 * @param {object} [deps.skills] - `goToPosition`, `pickupNearbyItems` (library/skills.js)
 * @param {(bot: object, pos: Vec3) => object|null} [deps.blockAt] - a block as the bot may know it
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function composting({ world: w = world, skills: s = skills, blockAt = (bot, pos) => worldQueries().blockAt(bot, pos),
    sleep: wait = sleep } = {}) {
    const countOf = (bot, name) => w.getInventoryCounts(bot)[name] ?? 0;
    const stopped = bot => Boolean(bot.interrupt_code);
    const until = async (bot, test, ms) => {
        for (let waited = 0; waited < ms; waited += 100) {
            if (test() || stopped(bot)) return test();
            await wait(100);
        }
        return test();
    };

    /**
     * Puts up to `count` of an item into the composter nearest the bot, and takes out the bone meal it gives.
     * @param {object} bot
     * @param {string} item - what to compost, by its item name
     * @param {number} count - how many at most
     * @param {object} [options]
     * @param {{asked?: boolean|null}} [options.behind] - who is behind the request
     */
    async function compost(bot, item, count, { behind = {} } = {}) {
        assertActionOwner(bot);
        if (behind.asked === false) {
            return toolResult('blocked', 'You use the composter only when a player asks: it takes a lot of plant matter for a little bone meal.', 'not_asked');
        }
        const chance = compostChance(item);
        if (!chance) return toolResult('failed', `A composter doesn't take ${item}. Seeds, crops, leaves, saplings and flowers go in.`, 'bad_args');
        const held = countOf(bot, item);
        if (!held) return toolResult('failed', `You have no ${item}.`, 'missing_items');
        const edition = editionOf(bot.registry);
        const found = w.getNearestBlocksWhere(bot, block => block?.name === 'composter', COMPOSTER_RANGE, 1)?.[0];
        if (!found) {
            return toolResult('failed', `You see no composter within ${COMPOSTER_RANGE} blocks. Go to one, or craft one (from 7 wooden slabs) and place it.`, 'no_composter');
        }
        const pos = found.position;
        await s.goToPosition(bot, pos.x, pos.y, pos.z, 2);
        assertActionOwner(bot);
        try { await bot.lookAt(new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5)); } catch { /* a turn cut short */ }

        const levelNow = () => edition.composterOf(blockAt(bot, pos));
        const mealBefore = countOf(bot, 'bone_meal');
        let left = Math.min(count, held), put = 0, misses = 0, problem = null;
        const click = async () => {
            const block = blockAt(bot, pos);
            if (!block) return false;
            await bot.activateBlock(block);
            return true;
        };
        const deadline = Date.now() + 20_000 + left * 1500;
        while (!stopped(bot)) {
            if (Date.now() > deadline) { problem = 'it took too long'; break; }
            const now = levelNow();
            if (!now) { problem = `the composter at ${where(pos)} is not there, or you can't see how full it is`; break; }
            if (now.ready) {
                // Full and ripe: one click gives the bone meal, which pops out on top.
                try { await click(); } catch (error) { problem = error.message; break; }
                await until(bot, () => (levelNow()?.level ?? 0) === 0, CLICK_MS);
                await s.pickupNearbyItems(bot);
                continue;
            }
            if (now.level === 7) {
                // Full: it turns ready by itself a second later, and takes nothing meanwhile.
                if (!await until(bot, () => levelNow()?.ready === true, RIPEN_MS)) { problem = 'it filled but did not give bone meal'; break; }
                continue;
            }
            if (left <= 0) break;
            const stack = bot.inventory.items().find(i => i.name === item);
            if (!stack) break;
            const before = countOf(bot, item);
            try {
                await bot.equip(stack, 'hand');
                await click();
            } catch (error) { problem = error.message; break; }
            // The server takes the item whether or not the level rises.
            if (await until(bot, () => countOf(bot, item) < before, CLICK_MS)) {
                const took = before - countOf(bot, item);
                put += took; left -= took; misses = 0;
            } else if (++misses >= MISSES) { problem = `the composter didn't take the ${item}`; break; }
        }

        const meal = countOf(bot, 'bone_meal') - mealBefore;
        const level = levelNow()?.level;
        const parts = [`Put ${put} ${item} in the composter at ${where(pos)}`];
        parts.push(meal > 0 ? `and took ${meal} bone_meal out` : 'and it gave no bone meal yet');
        let text = parts.join(' ') + '.';
        if (Number.isInteger(level) && level < 8) text += ` It is at level ${level} of 7 now; each ${item} has a ${chance}% chance to raise it.`;
        if (meal > 0) text += ` You have ${countOf(bot, 'bone_meal')} bone_meal.`;
        if (stopped(bot)) return toolResult('cancelled', `${text} Stopped.`, 'interrupted');
        if (problem) return toolResult(put || meal ? 'partial' : 'failed', `${text} Stopped: ${problem}.`, 'incomplete');
        return toolResult('ok', text);
    }

    return { compost };
}
