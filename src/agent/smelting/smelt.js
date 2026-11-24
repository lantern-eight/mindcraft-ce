// SPDX-License-Identifier: CC0-1.0
// Smelting the way a player does it: find a furnace that isn't in use, put in the items and enough fuel,
// shut it, wait, come back for what is done, top it up, and when it is all done take back what is left of
// the fuel. This takes over Mindcraft's `smeltItem` and `clearNearestFurnace` (see install.js).
//
// What the bot knows and does goes through the same doors as every other skill: furnaces are found with
// world.js (so under fair play, only ones it has seen or remembers), it walks with the pathfinder, and
// opening a furnace goes through the reach rule. Nothing here reads the world past those.
//
// The decisions are in the pure files beside this one: what smelts into what (recipes.js) and what to burn
// (fuel.js). The window is touched only through furnace_hands.js.
import { Vec3 } from 'vec3';
import { cleanName, inputsFor, productOf } from './recipes.js';
import { SMELT_MS, fuelPer, itemsFrom, nextFuel, planFuel } from './fuel.js';
import { furnaceHands } from './furnace_hands.js';

/** A furnace the bot knows of this near is used before one it carries is placed. */
export const NEAR_RANGE = 16;
/** Then one it knows of this near, walked to: a player goes back to the furnace at their base. */
export const FAR_RANGE = 64;
/** The furnace `clearFurnace` empties is the nearest the bot knows of within this distance. */
export const CLEAR_RANGE = 32;
/** A furnace the bot carries is placed within this distance of where it stands. */
export const PLACE_RANGE = 4;
/** A furnace this close to the bot's eyes is opened from where it stands. */
const ARMS_REACH = 4;
/** One input slot holds one stack. */
const STACK = 64;

const where = pos => `${pos.x}, ${pos.y}, ${pos.z}`;
const plural = (count, name) => `${count} ${name}`;
const listOf = parts => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

/**
 * Smelting for a bot, on the given helpers. install.js hands it the real ones; tests hand it stand-ins.
 *
 * @param {object} deps
 * @param {object} deps.world - `getNearestBlocksWhere`, `getInventoryCounts` (library/world.js)
 * @param {object} deps.skills - `log`, `goToPosition`, `placeBlock`, `breakBlockAt`, `craftRecipe`,
 *   `pickupNearbyItems` (library/skills.js)
 * @param {(bot: object, pos: Vec3) => object|null} deps.blockAt - a block as the bot may know it
 * @param {(registry: object) => object} deps.editionOf - the edition seam
 * @param {(bot: object, nearest: object|null) => Promise<boolean>} [deps.lookAround] - looks round before a
 *   search when it should (library/search_look.js): under a player's screen, a furnace behind the bot isn't
 *   known until it turns
 * @param {object} [deps.timing] - `smeltMs` (one item), `slackMs` (added to a wait), `limitPerItemMs`,
 *   `limitExtraMs` (the whole smelt's time limit), `watchMs` (how often the bot glances while it waits),
 *   and `hands` (options for furnace_hands.js)
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function smeltingSkills({ world, skills, blockAt, editionOf, lookAround = async () => false, timing = {}, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const { smeltMs = SMELT_MS, slackMs = 2000, limitPerItemMs = 12000, limitExtraMs = 30000, watchMs = 1000,
        hands: handOptions = {} } = timing;

    const isBedrock = bot => bot.registry?.version?.type === 'bedrock';
    const countOf = (bot, name) => world.getInventoryCounts(bot)[name] ?? 0;

    /** Walks within reach of a furnace, faces it and opens it. `{furnace}` or `{problem}`. */
    async function reach(bot, block, hands) {
        const pos = block.position;
        const center = new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        const feet = bot.entity?.position;
        const eye = feet ? new Vec3(feet.x, feet.y + (bot.entity.eyeHeight ?? 1.62), feet.z) : null;
        if (!eye || eye.distanceTo(center) > ARMS_REACH) {
            await skills.goToPosition(bot, pos.x, pos.y, pos.z, 2);
            if (bot.interrupt_code) return { problem: 'I was interrupted' };
        }
        try { await bot.lookAt(center); } catch { /* the reach rule turns the bot if it has to */ }
        // Read the block again where it is now: it may be lit (Bedrock makes that another block) or gone.
        const fresh = blockAt(bot, pos) ?? block;
        if (!editionOf(bot.registry).furnaceOf(fresh)) return { problem: `there is no furnace at ${where(pos)} any more` };
        return hands.open(fresh);
    }

    /** The furnaces the bot knows of within `range`, nearest first. */
    function knownFurnaces(bot, range, kinds = ['furnace']) {
        const edition = editionOf(bot.registry);
        return world.getNearestBlocksWhere(bot, block => kinds.includes(edition.furnaceOf(block)?.kind), range, 8) ?? [];
    }

    /**
     * Places the furnace the bot carries next to it: on a cell it knows is empty, with a full block under
     * it, not where the bot itself stands. Gives where, or null.
     */
    async function placeFurnace(bot) {
        const feet = bot.entity.position.floored();
        const edition = editionOf(bot.registry);
        const cells = (world.getNearestBlocksWhere(bot, block => block?.name === 'air' || block?.name === 'cave_air', PLACE_RANGE, 64) ?? [])
            .map(block => block.position)
            .filter(p => !(p.x === feet.x && p.z === feet.z && (p.y === feet.y || p.y === feet.y + 1)))
            .filter(p => Math.abs(p.y - feet.y) <= 1)
            .filter(p => blockAt(bot, p.offset(0, -1, 0))?.boundingBox === 'block');
        for (const cell of cells.slice(0, 3)) {
            if (bot.interrupt_code) return null;
            let placed = false;
            try { placed = await skills.placeBlock(bot, 'furnace', cell.x, cell.y, cell.z); }
            catch (error) { console.warn('[smelting] Placing a furnace:', error?.message ?? error); }
            if (placed && edition.furnaceOf(blockAt(bot, cell))) return cell;
        }
        return null;
    }

    /**
     * A furnace that is free, opened: one the bot knows of nearby, else its own, placed, else one farther
     * off. A furnace with anything in its input or output is someone else's work and is left alone.
     * Gives `{furnace, at, placed}` or `{problem}`.
     */
    async function freeFurnace(bot, hands) {
        const tried = new Set();
        const notes = [];
        const key = pos => `${pos.x},${pos.y},${pos.z}`;
        const attempt = async block => {
            tried.add(key(block.position));
            const opened = await reach(bot, block, hands);
            if (!opened.furnace) {
                notes.push(`I couldn't use the furnace at ${where(block.position)}: ${opened.problem}.`);
                return null;
            }
            const { input, output } = opened.furnace.slots();
            if (input || output) {
                const inside = [input, output].filter(Boolean).map(stack => plural(stack.count, stack.name));
                notes.push(`The furnace at ${where(block.position)} is in use (${listOf(inside)} in it), so I left it alone.`);
                await opened.furnace.close();
                return null;
            }
            return { furnace: opened.furnace, at: block.position.clone?.() ?? block.position };
        };
        // A player looks round before deciding there is no furnace near, or before walking to a far one.
        await lookAround(bot, knownFurnaces(bot, NEAR_RANGE)[0]?.position ?? null);
        for (const block of knownFurnaces(bot, NEAR_RANGE)) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes };
        }
        if (countOf(bot, 'furnace') > 0 && !bot.interrupt_code) {
            const spot = await placeFurnace(bot);
            if (!spot) notes.push('I found no spot I could see to place my furnace.');
            else {
                const got = await attempt(blockAt(bot, spot));
                if (got) return { ...got, placed: true, notes };
            }
        }
        for (const block of knownFurnaces(bot, FAR_RANGE).filter(block => !tried.has(key(block.position)))) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes };
        }
        if (bot.interrupt_code) return { problem: 'I was interrupted.' };
        if (notes.length > 0) return { problem: notes.join(' ') };
        // Worded so fair play adds its note that "none known" isn't "none there".
        return { problem: `There is no furnace nearby that I know of within ${FAR_RANGE} blocks, and I carry none.` };
    }

    /**
     * Waits while the furnace works, the window shut. Gives 'time' when the wait is up, 'out' when the bot
     * sees the furnace go out (a lit furnace glows; when its fuel is spent the glow stops), or
     * 'interrupted'.
     */
    async function waitAt(bot, at, ms) {
        const edition = editionOf(bot.registry);
        const end = now() + ms;
        let sawLit = false;
        while (now() < end) {
            if (bot.interrupt_code) return 'interrupted';
            await sleep(Math.max(1, Math.min(watchMs, end - now())));
            if (bot.interrupt_code) return 'interrupted';
            const seen = edition.furnaceOf(blockAt(bot, at));
            if (seen?.lit) sawLit = true;
            else if (seen && sawLit) return 'out';
        }
        return 'time';
    }

    /**
     * Smelts `num` of an item. Says what happened in the bot's output, as Mindcraft's skills do.
     * @returns {Promise<boolean>} true when all of them were smelted
     */
    async function smeltItem(bot, itemName, num = 1) {
        const say = text => skills.log(bot, text);
        const input = cleanName(itemName);
        const product = productOf(input, { edition: isBedrock(bot) ? 'bedrock' : 'java' });
        if (!product) {
            const from = inputsFor(input);
            say(from.length > 0
                ? `${input} isn't smelted, it is made: smelt ${listOf(from)} to get it.`
                : `${input ?? itemName} doesn't smelt into anything. Smelt raw ores, sand, cobblestone, logs or raw food.`);
            return false;
        }
        const wanted = Number.isFinite(num) && num >= 1 ? Math.floor(num) : 1;
        const notes = [];

        // What to smelt, and the fuel for it.
        let inventory = world.getInventoryCounts(bot);
        const have = inventory[input] ?? 0;
        if (have === 0) { say(`I have no ${input} to smelt.`); return false; }
        let target = Math.min(wanted, have);
        if (target < wanted) notes.push(`I had only ${plural(have, input)}.`);
        let plan = planFuel(inventory, target, { input, product });
        const noFuel = `I have no fuel to smelt ${input}: coal, charcoal, planks and logs burn.`;
        if (plan.covers === 0) { say(noFuel); return false; }
        for (const craft of plan.crafts) {
            if (bot.interrupt_code) return false;
            let made = false;
            try { made = await skills.craftRecipe(bot, craft.planks, craft.times); }
            catch (error) { console.warn('[smelting] Making planks for fuel:', error?.message ?? error); }
            if (made) notes.push(`I made ${plural(craft.times, craft.log)} into ${craft.planks} for fuel.`);
        }
        if (plan.crafts.length > 0) {
            inventory = world.getInventoryCounts(bot);
            plan = planFuel(inventory, target, { input, product, craftPlanks: false });
        }
        if (plan.covers < target) {
            if (plan.covers === 0) { say(noFuel); return false; }
            notes.push(`I had fuel for only ${plan.covers}.`);
            target = plan.covers;
        }

        // A furnace that is free.
        const hands = furnaceHands(bot, { wait: sleep, ...handOptions });
        const site = await freeFurnace(bot, hands);
        if (!site.furnace) { say([...notes, site.problem].join(' ')); return false; }
        notes.push(...site.notes);
        if (site.placed) notes.push(`I placed my furnace at ${where(site.at)}.`);
        const at = site.at;
        // Standing still beside a furnace for minutes isn't being stuck.
        bot.modes?.pause?.('unstuck');

        const baseline = countOf(bot, product);
        const deadline = now() + target * limitPerItemMs + limitExtraMs;
        const fuelPut = {};
        let furnace = site.furnace, bag = { ...inventory }, loaded = 0, smelted = 0, lastInput = 0, stalls = 0;
        let reason = null, problem = null;
        try {
            for (let look = 0; ; look++) {
                const slots = furnace.slots();
                // Something of someone else's in it now: hands off, and stop.
                if ((slots.input && slots.input.name !== input) || (slots.output && slots.output.name !== product)) {
                    reason = 'meddled';
                    break;
                }
                const took = slots.output ? (await furnace.take('output'))?.count ?? 0 : 0;
                const inputAtLook = slots.input?.count ?? 0;
                const progressed = took > 0 || inputAtLook < lastInput;
                stalls = look > 0 && !progressed ? stalls + 1 : 0;
                if (smelted + took >= target) { reason = 'done'; break; }
                if (stalls >= 2) { reason = 'stalled'; break; }
                if (now() >= deadline) { reason = 'timeout'; break; }

                // Fuel first, for what the input will be once topped up: a furnace with input in it starts
                // burning fuel the moment it goes in, and the slot would then show less than was put.
                const toLoad = Math.min(STACK - inputAtLook, target - loaded, bag[input] ?? 0);
                const fuel = slots.fuel;
                let covered = fuel ? itemsFrom(fuelPer(fuel.name), fuel.count) : 0;
                if (inputAtLook + toLoad > covered) {
                    const add = nextFuel(bag, inputAtLook + toLoad - covered, fuel, { input, product });
                    if (add) {
                        const moved = await furnace.put('fuel', add.name, add.units);
                        bag[add.name] = (bag[add.name] ?? 0) - moved;
                        fuelPut[add.name] = (fuelPut[add.name] ?? 0) + moved;
                        covered += itemsFrom(fuelPer(add.name), moved);
                    }
                }
                const movedIn = toLoad > 0 ? await furnace.put('input', input, toLoad) : 0;
                loaded += movedIn;
                bag[input] = (bag[input] ?? 0) - movedIn;
                const inFurnace = inputAtLook + movedIn;
                if (inFurnace === 0) { reason = loaded >= target ? 'done' : 'short'; break; }
                const lit = editionOf(bot.registry).furnaceOf(blockAt(bot, at))?.lit;
                if (covered === 0 && !lit) { reason = 'no_fuel'; break; }
                lastInput = inFurnace;

                // Shut it and wait: for the whole load, or until the fuel in it is nearly spent.
                await furnace.close();
                furnace = null;
                smelted = countOf(bot, product) - baseline;
                const items = Math.min(inFurnace, covered);
                let waitMs = covered >= inFurnace ? items * smeltMs + slackMs
                    : covered > 0 ? Math.max(3000, items * smeltMs - 4000) : smeltMs;
                waitMs = Math.max(1000, Math.min(waitMs, deadline - now() + slackMs));
                if (await waitAt(bot, at, waitMs) === 'interrupted') { reason = 'interrupted'; break; }

                // Back to it.
                bag = world.getInventoryCounts(bot);
                const block = blockAt(bot, at);
                if (!editionOf(bot.registry).furnaceOf(block)) { reason = 'gone'; break; }
                const opened = await reach(bot, block, hands);
                if (!opened.furnace) {
                    reason = bot.interrupt_code ? 'interrupted' : 'lost';
                    problem = opened.problem;
                    break;
                }
                furnace = opened.furnace;
            }

            // Take back what is the bot's: what it put in and didn't smelt, and what is left of its fuel.
            const returned = {};
            if (furnace && reason !== 'meddled') {
                const slots = furnace.slots();
                if (slots.input?.name === input) await furnace.take('input');
                const fuel = slots.fuel;
                if (fuel && fuelPut[fuel.name] > 0) returned[fuel.name] = await furnace.takeSome('fuel', fuelPut[fuel.name]);
            }
            if (furnace) { await furnace.close(); furnace = null; }
            smelted = countOf(bot, product) - baseline;

            const burned = Object.entries(fuelPut).map(([name, put]) => [name, put - (returned[name] ?? 0)])
                .filter(([, count]) => count > 0).map(([name, count]) => plural(count, name));
            const did = smelted > 0
                ? `I smelted ${plural(smelted, input)} into ${product} in the furnace at ${where(at)}${burned.length ? `, burning ${listOf(burned)}` : ''}.`
                : `I smelted nothing in the furnace at ${where(at)}.`;
            const why = {
                done: null,
                short: `I had no more ${input} to put in.`,
                meddled: 'Someone else put something in the furnace, so I stopped and left their things in it.',
                stalled: 'The furnace stopped making anything, so I took my things back out.',
                timeout: 'It took far longer than it should, so I took my things back out.',
                no_fuel: 'I ran out of fuel, so I took the rest back out.',
                gone: `The furnace at ${where(at)} is gone.`,
                lost: `I couldn't get back into the furnace: ${problem}.`,
                interrupted: `I was interrupted. The furnace at ${where(at)} still has ${input} of mine in it and goes on smelting; ` +
                    '!clearFurnace takes everything out of it.',
            }[reason];

            // A furnace placed for this smelt goes back in the bag, if the bot can dig it up and nothing of
            // anyone's is left in it.
            if (site.placed && reason !== 'interrupted' && reason !== 'meddled' && reason !== 'gone') {
                const pickaxe = Object.keys(world.getInventoryCounts(bot)).some(name => name.endsWith('_pickaxe'));
                let back = false;
                if (pickaxe && !bot.interrupt_code) {
                    try {
                        back = await skills.breakBlockAt(bot, at.x, at.y, at.z);
                        if (back) await skills.pickupNearbyItems(bot);
                    } catch (error) { console.warn('[smelting] Picking the furnace back up:', error?.message ?? error); }
                }
                notes.push(back ? 'I picked my furnace back up.'
                    : pickaxe ? `I left my furnace at ${where(at)}.` : `I left my furnace at ${where(at)}: it takes a pickaxe to pick it back up.`);
            }
            say([did, why, ...notes].filter(Boolean).join(' '));
            return smelted >= wanted;
        } finally {
            if (furnace) await furnace.close();
        }
    }

    /**
     * Takes everything out of the nearest furnace the bot knows of.
     * @returns {Promise<boolean>} true when the furnace was opened and emptied
     */
    async function clearFurnace(bot) {
        const say = text => skills.log(bot, text);
        const kinds = ['furnace', 'blast_furnace', 'smoker'];
        await lookAround(bot, knownFurnaces(bot, CLEAR_RANGE, kinds)[0]?.position ?? null);
        const block = knownFurnaces(bot, CLEAR_RANGE, kinds)[0];
        if (!block) { say('There is no furnace nearby to clear.'); return false; }
        const hands = furnaceHands(bot, { wait: sleep, ...handOptions });
        const opened = await reach(bot, block, hands);
        if (!opened.furnace) { say(`I couldn't open the furnace at ${where(block.position)}: ${opened.problem}.`); return false; }
        const took = [];
        try {
            // The input first: with it gone the furnace stops burning the fuel.
            for (const which of ['input', 'fuel', 'output']) {
                const stack = await opened.furnace.take(which);
                if (stack) took.push(plural(stack.count, stack.name));
            }
            const left = Object.values(opened.furnace.slots()).filter(Boolean);
            say(took.length === 0 && left.length === 0
                ? `The furnace at ${where(block.position)} was already empty.`
                : `I cleared the furnace at ${where(block.position)}${took.length ? `, taking ${listOf(took)}` : ''}.` +
                    (left.length ? ` My inventory was too full to take ${listOf(left.map(s => plural(s.count, s.name)))}.` : ''));
            return left.length === 0;
        } finally {
            await opened.furnace.close();
        }
    }

    return { smeltItem, clearFurnace };
}
