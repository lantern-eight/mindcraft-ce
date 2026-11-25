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
// (fuel.js). The window is touched only through furnace_hands.js. What the bot has left smelting where is
// kept in jobs.js, so a smelt that is stopped can be gone on with, and its own furnace isn't taken for
// someone else's.
import { Vec3 } from 'vec3';
import { cleanName, inputsFor, productOf } from './recipes.js';
import { LAVA, SMELT_MS, fuelPer, itemsFrom, nextFuel, planFuel } from './fuel.js';
import { furnaceHands } from './furnace_hands.js';
import { holdsOnly, leftToLoad, stillInFurnace } from './jobs.js';
import { BUCKET, lavaSource } from './lava.js';

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
/** A wait, as a player would say it: "about 40 seconds", "about 8 minutes". */
const about = ms => (ms < 90000 ? `about ${Math.max(10, Math.round(ms / 10000) * 10)} seconds` : `about ${Math.round(ms / 60000)} minutes`);
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
 * @param {(bot: object) => object|null} [deps.jobs] - the jobs store for the world the bot is in (jobs.js),
 *   or null to keep none
 * @param {(bot: object) => void} [deps.saveJobs] - writes the jobs out when they changed
 * @param {(bot: object) => {x: number, y: number, z: number}[]} [deps.knownBuckets] - furnaces the bot
 *   remembers holding an empty bucket (world memory), for filling one from a lava farm
 * @param {(bot: object, name: string, count: number) => Promise<object|null>} [deps.fetchItem] - fetches an
 *   item from the chests (chest storage's, through library/fetch_way.js): an empty bucket for a lava farm
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function smeltingSkills({ world, skills, blockAt, editionOf, lookAround = async () => false, timing = {}, jobs = () => null,
    saveJobs = () => {}, knownBuckets = () => [], fetchItem = async () => null, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const { smeltMs = SMELT_MS, slackMs = 2000, limitPerItemMs = 12000, limitExtraMs = 30000, watchMs = 1000,
        hands: handOptions = {} } = timing;

    const isBedrock = bot => bot.registry?.version?.type === 'bedrock';
    const countOf = (bot, name) => world.getInventoryCounts(bot)[name] ?? 0;
    const lava = lavaSource({ world, skills, blockAt, editionOf, knownBuckets, fetchItem, sleep,
        openFurnace: (bot, block) => reach(bot, block, furnaceHands(bot, { wait: sleep, ...handOptions })) });
    /** Lava burns this long once it catches, smelting or not: when lava the bot put in at `at` burns out. */
    const lavaBurnsUntil = at => at + fuelPer(LAVA) * smeltMs;

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
     * A furnace to smelt `input` in, opened: first one where the bot left some of it smelting (its own job),
     * then one it knows of nearby that is free, else its own, placed, else one farther off. A furnace with
     * anything in its input or output is someone else's work and is left alone, unless what is in it is
     * only what the bot put there itself. Gives `{furnace, at, placed, mine}` or `{problem}`; `mine` is
     * true when the furnace already holds the bot's own job for this item.
     */
    async function freeFurnace(bot, hands, input) {
        const book = jobs(bot);
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
            const slots = opened.furnace.slots();
            const job = book?.at(block.position) ?? null;
            const mine = holdsOnly(job, slots);
            if (slots.input || slots.output) {
                if (!mine || job.input !== input) {
                    const inside = [slots.input, slots.output].filter(Boolean).map(stack => plural(stack.count, stack.name));
                    notes.push(mine ? `The furnace at ${where(block.position)} is smelting my ${job.input}, so I left it to that.`
                        : `The furnace at ${where(block.position)} is in use (${listOf(inside)} in it), so I left it alone.`);
                    await opened.furnace.close();
                    return null;
                }
            } else if (job && job.input !== input) {
                // An old job of the bot's, and the furnace empty: someone took it all, or it was cleared.
                book.end(block.position);
            }
            return { furnace: opened.furnace, at: block.position.clone?.() ?? block.position, mine: mine && job.input === input };
        };
        // A smelt of this item left in a furnace is gone on with first: the bot's things are in it.
        for (const job of book?.list({ from: bot.entity.position, input, maxDistance: FAR_RANGE }) ?? []) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const block = blockAt(bot, new Vec3(job.x, job.y, job.z));
            if (!editionOf(bot.registry).furnaceOf(block)) { book.end(job); continue; }
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes };
        }
        // A player looks round before deciding there is no furnace near, or before walking to a far one.
        await lookAround(bot, knownFurnaces(bot, NEAR_RANGE)[0]?.position ?? null);
        for (const block of knownFurnaces(bot, NEAR_RANGE).filter(block => !tried.has(key(block.position)))) {
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
     * One visit to an open furnace: take out what is done, then add fuel and up to `more` of the input,
     * as much as one stack and the bot's bag allow. Fuel goes in first: a furnace with input in it starts
     * burning fuel the moment it goes in, and the slot would then show less than was put.
     *
     * An empty bucket in the fuel slot (lava leaves it there when it catches) is taken out first: it blocks
     * the slot. Lava the bot put in burns on for a fixed time after it catches, and the slot no longer shows
     * it, so `lavaUntil` (when it burns out) counts towards what the fuel covers. With `lavaFirst` a lava
     * bucket is the first fuel to go in (it came from a lava farm).
     *
     * Gives what it did: `{meddled}` when something of someone else's is in it now (nothing is touched
     * then), else `took` (output taken), `inputAtLook` (input there before), `movedIn`, `fuelMoved` (by
     * name), `inFurnace` (input now), `covered` (how many items the fuel will smelt), `buckets` (empty
     * buckets taken out) and `lavaAt` (when lava went in, or null).
     */
    async function tend(furnace, { input, product, more, bag, lavaFirst = false, lavaUntil = 0 }) {
        const slots = furnace.slots();
        if ((slots.input && slots.input.name !== input) || (slots.output && slots.output.name !== product)) return { meddled: true };
        const took = slots.output ? (await furnace.take('output'))?.count ?? 0 : 0;
        const buckets = slots.fuel?.name === BUCKET ? (await furnace.take('fuel'))?.count ?? 0 : 0;
        const inputAtLook = slots.input?.count ?? 0;
        const toLoad = Math.max(0, Math.min(STACK - inputAtLook, more, bag[input] ?? 0));
        const fuel = furnace.slots().fuel;
        const fuelMoved = {};
        const burning = Math.floor(Math.max(0, lavaUntil - now()) / smeltMs);
        let covered = (fuel ? itemsFrom(fuelPer(fuel.name), fuel.count) : 0) + burning;
        let lavaAt = null;
        if (inputAtLook + toLoad > covered) {
            const add = nextFuel(bag, inputAtLook + toLoad - covered, fuel, { input, product, lavaFirst });
            if (add) {
                const moved = await furnace.put('fuel', add.name, add.units);
                bag[add.name] = (bag[add.name] ?? 0) - moved;
                if (moved > 0) fuelMoved[add.name] = moved;
                if (moved > 0 && add.name === LAVA) lavaAt = now();
                covered += itemsFrom(fuelPer(add.name), moved);
            }
        }
        const movedIn = toLoad > 0 ? await furnace.put('input', input, toLoad) : 0;
        bag[input] = (bag[input] ?? 0) - movedIn;
        return { meddled: false, took, buckets, inputAtLook, movedIn, fuelMoved, inFurnace: inputAtLook + movedIn, covered, lavaAt };
    }

    /**
     * The fuel a visit put in that stays the bot's to take back: all of it but lava, which catches at once
     * and is spent (its empty bucket is taken out on a later visit).
     */
    const keptFuel = moved => Object.fromEntries(Object.entries(moved).filter(([name]) => name !== LAVA));

    /** When a furnace holding `inFurnace` items, with fuel for `covered` of them, will be done or out. */
    const readyAfter = (inFurnace, covered) => now() + Math.min(inFurnace, covered) * smeltMs;

    /**
     * The start of a smelt, and of a load: what the item makes, how many to smelt (counting any of its own
     * left in a furnace from a smelt that was stopped), the fuel for them (logs made into planks first), and
     * the furnace, opened, with a job started in it. `atOnce` caps how many the fuel is planned for now: a
     * load puts in one stack. Says why and gives null when it can't start.
     */
    async function begin(bot, itemName, num, { atOnce = Infinity } = {}) {
        const say = text => skills.log(bot, text);
        const input = cleanName(itemName);
        const product = productOf(input, { edition: isBedrock(bot) ? 'bedrock' : 'java' });
        if (!product) {
            const from = inputsFor(input);
            say(from.length > 0
                ? `${input} isn't smelted, it is made: smelt ${listOf(from)} to get it.`
                : `${input ?? itemName} doesn't smelt into anything. Smelt raw ores, sand, cobblestone, logs or raw food.`);
            return null;
        }
        const wanted = Number.isFinite(num) && num >= 1 ? Math.floor(num) : 1;
        const notes = [];
        const book = jobs(bot);

        // What to smelt, and the fuel for it. Some may be in a furnace already, from a smelt that was
        // stopped: those count, and their fuel is in there with them.
        let inventory = world.getInventoryCounts(bot);
        const have = inventory[input] ?? 0;
        const left = book?.list({ from: bot.entity.position, input, maxDistance: FAR_RANGE })[0] ?? null;
        const inside = stillInFurnace(left);
        if (have + inside === 0) { say(`I have no ${input} to smelt.`); return null; }
        let target = Math.min(wanted, have + inside);
        if (target < wanted) notes.push(`I had only ${plural(have + inside, input)}${inside ? `, counting ${inside} left in the furnace at ${where(left)}` : ''}.`);
        const need = Math.max(0, Math.min(target, atOnce) - inside);
        // A lava farm near: a bucket of its lava is the first fuel.
        const lavaFarm = need > 0 ? await lava.fill(bot) : { farm: false };
        if (lavaFarm.note) notes.push(lavaFarm.note);
        if (bot.interrupt_code) return null;
        const lavaFirst = lavaFarm.farm;
        if (lavaFarm.farm) inventory = world.getInventoryCounts(bot);
        let plan = planFuel(inventory, need, { input, product, lavaFirst });
        const noFuel = `I have no fuel to smelt ${input}: coal, charcoal, planks and logs burn, and lava from a cauldron.`;
        if (need > 0 && plan.covers === 0 && inside === 0) { say(noFuel); return null; }
        for (const craft of plan.crafts) {
            if (bot.interrupt_code) return null;
            let made = false;
            try { made = await skills.craftRecipe(bot, craft.planks, craft.times); }
            catch (error) { console.warn('[smelting] Making planks for fuel:', error?.message ?? error); }
            if (made) notes.push(`I made ${plural(craft.times, craft.log)} into ${craft.planks} for fuel.`);
        }
        if (plan.crafts.length > 0) {
            inventory = world.getInventoryCounts(bot);
            plan = planFuel(inventory, need, { input, product, craftPlanks: false, lavaFirst });
        }
        if (plan.covers < need) {
            notes.push(`I had fuel for only ${plan.covers + inside}.`);
            target = inside + plan.covers;
        }

        // A furnace: the one with its own smelt in it, or one that is free.
        const hands = furnaceHands(bot, { wait: sleep, ...handOptions });
        const site = await freeFurnace(bot, hands, input);
        if (!site.furnace) { say([...notes, site.problem].join(' ')); return null; }
        notes.push(...site.notes);
        if (site.placed) notes.push(`I placed my furnace at ${where(site.at)}.`);
        const at = site.at;
        // What of its own is in this furnace already, counted from the slots, not from belief.
        const first = site.furnace.slots();
        const preloaded = site.mine ? (first.input?.count ?? 0) + (first.output?.count ?? 0) : 0;
        if (preloaded > 0) notes.push(`I went on with the ${input} I had left in the furnace at ${where(at)}.`);
        // What it believed was left in a furnace isn't here after all: only what it carries, and what is here.
        if (preloaded < inside) target = Math.min(target, have + preloaded);
        const jobBefore = book?.at(at) ?? null;
        const placed = site.placed || (site.mine && (jobBefore?.placed ?? false));
        book?.start(at, { input, product, total: target, placed });
        // The fuel of its own in this furnace: what an earlier smelt put in (if this is its job). Only as
        // much as is its own is ever taken back.
        const fuelBefore = site.mine ? { ...(jobBefore?.fuelPut ?? {}) } : {};
        const lavaUntil = site.mine ? (jobBefore?.lavaUntil ?? 0) : 0;
        return { say, input, product, wanted, notes, book, inventory, target, hands, furnace: site.furnace, at, preloaded, placed, fuelBefore,
            lavaFirst, lavaUntil };
    }

    /**
     * Smelts `num` of an item. Says what happened in the bot's output, as Mindcraft's skills do.
     * @returns {Promise<boolean>} true when all of them were smelted
     */
    async function smeltItem(bot, itemName, num = 1) {
        const start = await begin(bot, itemName, num);
        if (!start) return false;
        const { say, input, product, wanted, notes, book, inventory, hands, at, preloaded, placed } = start;
        let { target } = start;
        // Standing still beside a furnace for minutes isn't being stuck.
        bot.modes?.pause?.('unstuck');

        const baseline = countOf(bot, product);
        const deadline = now() + target * limitPerItemMs + limitExtraMs;
        // The fuel of its own in this furnace, before and now, and what went in this time.
        const fuelPut = { ...start.fuelBefore };
        const fuelNow = {};
        let furnace = start.furnace, bag = { ...inventory }, loaded = 0, smelted = 0, lastInput = 0, stalls = 0;
        let lavaUntil = start.lavaUntil;
        let reason = null, problem = null;
        try {
            for (let look = 0; ; look++) {
                const visit = await tend(furnace, { input, product, more: target - preloaded - loaded, bag, lavaFirst: start.lavaFirst, lavaUntil });
                if (visit.meddled) { reason = 'meddled'; break; }
                const { took, inputAtLook, movedIn, fuelMoved, inFurnace, covered } = visit;
                loaded += movedIn;
                for (const [name, count] of Object.entries(keptFuel(fuelMoved))) fuelPut[name] = (fuelPut[name] ?? 0) + count;
                for (const [name, count] of Object.entries(fuelMoved)) fuelNow[name] = (fuelNow[name] ?? 0) + count;
                if (visit.lavaAt !== null) lavaUntil = lavaBurnsUntil(visit.lavaAt);
                book?.note(at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered), lavaUntil });
                saveJobs(bot);
                const progressed = took > 0 || inputAtLook < lastInput;
                stalls = look > 0 && !progressed ? stalls + 1 : 0;
                if (smelted + took >= target) { reason = 'done'; break; }
                if (stalls >= 2) { reason = 'stalled'; break; }
                if (now() >= deadline) { reason = 'timeout'; break; }
                if (inFurnace === 0) { reason = preloaded + loaded >= target ? 'done' : 'short'; break; }
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

            // Take back what is the bot's: what it put in and didn't smelt, and what is left of its fuel. A
            // smelt that was stopped leaves them, and its job says so.
            const returned = {};
            if (furnace && reason !== 'meddled') {
                const slots = furnace.slots();
                if (slots.input?.name === input) book?.note(at, { collected: (await furnace.take('input'))?.count ?? 0 });
                const fuel = slots.fuel;
                if (fuel && fuelPut[fuel.name] > 0) returned[fuel.name] = await furnace.takeSome('fuel', fuelPut[fuel.name]);
                // The bucket its lava left.
                else if (fuel?.name === BUCKET && (fuelNow[LAVA] > 0 || lavaUntil > 0)) await furnace.take('fuel');
            }
            if (furnace) { await furnace.close(); furnace = null; }
            smelted = countOf(bot, product) - baseline;
            // The job is over unless the bot left its things in the furnace.
            if (reason !== 'interrupted' && reason !== 'lost') book?.end(at);
            saveJobs(bot);

            const burned = Object.entries(fuelNow).map(([name, put]) => [name, put - Math.min(put, returned[name] ?? 0)])
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
                lost: `I couldn't get back into the furnace: ${problem}. My ${input} is still in it; !smeltItem goes on with it.`,
                interrupted: `I was interrupted. The furnace at ${where(at)} still has ${input} of mine in it and goes on smelting; ` +
                    '!smeltItem goes on with it.',
            }[reason];

            // A furnace placed for this smelt goes back in the bag, if the bot can dig it up and nothing of
            // anyone's is left in it.
            if (placed && reason !== 'interrupted' && reason !== 'lost' && reason !== 'meddled' && reason !== 'gone') {
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
     * Loads a furnace and leaves it, as a player does with a long smelt: puts in up to a stack of the item
     * and the fuel for it, shuts it, and says when it will be done. The job remembers the rest of `num`, and
     * `collectFurnace` takes out what is done and puts in more.
     * @returns {Promise<boolean>} true when something went in
     */
    async function loadFurnace(bot, itemName, num = 1) {
        const start = await begin(bot, itemName, num, { atOnce: STACK });
        if (!start) return false;
        const { say, input, product, notes, book, inventory, at, preloaded } = start;
        let furnace = start.furnace;
        try {
            const visit = await tend(furnace, { input, product, more: start.target - preloaded, bag: { ...inventory },
                lavaFirst: start.lavaFirst, lavaUntil: start.lavaUntil });
            await furnace.close();
            furnace = null;
            if (visit.meddled) {
                book?.end(at);
                saveJobs(bot);
                say([...notes, `Someone else's things went into the furnace at ${where(at)}, so I left it.`].join(' '));
                return false;
            }
            const { took, movedIn, fuelMoved, inFurnace, covered } = visit;
            const unfueled = Math.max(0, inFurnace - covered);
            book?.note(at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered), unfueled,
                ...(visit.lavaAt !== null ? { lavaUntil: lavaBurnsUntil(visit.lavaAt) } : {}) });
            if (inFurnace === 0) book?.end(at);
            saveJobs(bot);
            if (inFurnace === 0) { say([...notes, `I put nothing in the furnace at ${where(at)}.`].join(' ')); return false; }
            const fuel = Object.entries(fuelMoved).map(([name, count]) => plural(count, name));
            const later = leftToLoad(book?.at(at));
            say([
                ...notes,
                movedIn > 0 ? `I put ${plural(movedIn, input)}${fuel.length ? ` and ${listOf(fuel)}` : ''} in the furnace at ${where(at)}.` : null,
                took > 0 ? `I took out ${plural(took, product)} that was done.` : null,
                unfueled === 0 ? `The ${inFurnace} ${input} in it will be ${product} in ${about(inFurnace * smeltMs)}.`
                    : `Its fuel smelts ${covered} of the ${inFurnace} ${input} in it, in ${about(covered * smeltMs)}; the rest need more fuel.`,
                later > 0 ? `${later} more ${input} go in when there is room.` : null,
                '!collectFurnace takes out what is done.',
            ].filter(Boolean).join(' '));
            return true;
        } finally {
            if (furnace) await furnace.close();
        }
    }

    /**
     * Goes back to each furnace the bot left smelting, nearest first: takes out what is done, puts in more of
     * the job (and fuel for it) when there is more to go in and the bot carries it, and when a job is over
     * takes back the fuel of its own that is left, and picks up a furnace it placed for the job.
     * @returns {Promise<boolean>} true when it took anything out
     */
    async function collectFurnace(bot) {
        const say = text => skills.log(bot, text);
        const book = jobs(bot);
        const list = book?.list({ from: bot.entity.position, maxDistance: FAR_RANGE }) ?? [];
        if (list.length === 0) { say('I have nothing smelting in any furnace that I know of.'); return false; }
        const hands = furnaceHands(bot, { wait: sleep, ...handOptions });
        const lines = [];
        let tookAny = false;
        bot.modes?.pause?.('unstuck');
        for (const job of list) {
            if (bot.interrupt_code) break;
            const at = new Vec3(job.x, job.y, job.z);
            const block = blockAt(bot, at);
            if (!editionOf(bot.registry).furnaceOf(block)) {
                book.end(at);
                lines.push(`The furnace at ${where(at)} is gone, and the ${job.input} I had in it.`);
                continue;
            }
            const opened = await reach(bot, block, hands);
            if (!opened.furnace) { lines.push(`I couldn't get into the furnace at ${where(at)}: ${opened.problem}.`); continue; }
            let furnace = opened.furnace;
            let over = false;
            try {
                if (!holdsOnly(job, furnace.slots())) {
                    book.end(at);
                    lines.push(`The furnace at ${where(at)} has someone else's things in it now, so I left it.`);
                    continue;
                }
                const visit = await tend(furnace, { input: job.input, product: job.product, more: leftToLoad(job), bag: world.getInventoryCounts(bot),
                    lavaFirst: Boolean(lava.farmNear(bot)), lavaUntil: job.lavaUntil ?? 0 });
                const { took, movedIn, fuelMoved, inFurnace, covered } = visit;
                const unfueled = Math.max(0, inFurnace - covered);
                const after = book.note(at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered), unfueled,
                    ...(visit.lavaAt !== null ? { lavaUntil: lavaBurnsUntil(visit.lavaAt) } : {}) });
                if (took > 0) tookAny = true;
                const parts = [took > 0 ? `From the furnace at ${where(at)} I took ${plural(took, job.product)}.` : `Nothing in the furnace at ${where(at)} was done yet.`];
                if (movedIn > 0) parts.push(`I put in ${plural(movedIn, job.input)} more.`);
                if (inFurnace > 0) {
                    parts.push(unfueled === 0 ? `${inFurnace} ${job.input} still smelting, done in ${about(inFurnace * smeltMs)}.`
                        : `${inFurnace} ${job.input} still in it; its fuel smelts ${covered} of them, and the rest need more fuel.`);
                } else {
                    // Nothing of the job left in it: take back what is left of the fuel the bot put in.
                    const fuel = furnace.slots().fuel;
                    if (fuel && after.fuelPut[fuel.name] > 0) {
                        const back = await furnace.takeSome('fuel', after.fuelPut[fuel.name]);
                        if (back > 0) parts.push(`I took back ${plural(back, fuel.name)}.`);
                    }
                    const short = leftToLoad(after);
                    if (short > 0) parts.push(`${short} more ${job.input} were to go in, but I carry none.`);
                    over = true;
                }
                lines.push(parts.join(' '));
            } finally {
                if (furnace) { await furnace.close(); furnace = null; }
            }
            if (over) {
                book.end(at);
                if (job.placed) {
                    const pickaxe = Object.keys(world.getInventoryCounts(bot)).some(name => name.endsWith('_pickaxe'));
                    let back = false;
                    if (pickaxe && !bot.interrupt_code) {
                        try {
                            back = await skills.breakBlockAt(bot, at.x, at.y, at.z);
                            if (back) await skills.pickupNearbyItems(bot);
                        } catch (error) { console.warn('[smelting] Picking the furnace back up:', error?.message ?? error); }
                    }
                    if (back) lines.push('I picked my furnace back up.');
                }
            }
            saveJobs(bot);
        }
        saveJobs(bot);
        say(lines.join(' '));
        return tookAny;
    }

    /**
     * What the bot has smelting where, as it believes: what is in each furnace and when it should be done.
     * Answers at once, without going to look.
     */
    function furnacesText(bot) {
        const list = jobs(bot)?.list({ from: bot.entity.position }) ?? [];
        if (list.length === 0) return 'I have nothing smelting in any furnace.';
        const lines = list.map(job => {
            const inside = stillInFurnace(job);
            const left = job.readyAt === null ? null : job.readyAt - now();
            const when = left === null ? '' : left <= 0
                ? (job.unfueled > 0 ? `; it should have run out of fuel by now, with ${job.unfueled} still to smelt` : '; it should be done by now')
                : `; done in ${about(left)}${job.unfueled > 0 ? `, but it needs more fuel for ${job.unfueled}` : ''}`;
            const more = leftToLoad(job) > 0 ? `, ${leftToLoad(job)} more to put in` : '';
            return `- furnace at ${where(job)}: ${inside} ${job.input} into ${job.product}${more}${job.collected ? `, ${job.collected} taken out so far` : ''}${when}`;
        });
        return `What I left smelting (as of when I last looked in each):\n${lines.join('\n')}\n!collectFurnace takes out what is done.`;
    }

    /**
     * A line for each job that should be done by now and that the bot hasn't been told about, once. Goes on
     * the next result the model reads, so a bot busy with something else is reminded, as a player glances
     * at the time.
     */
    function readyNotes(bot) {
        const book = jobs(bot);
        const ready = (book?.list() ?? []).filter(job => job.readyAt !== null && job.readyAt <= now() && !job.toldReady);
        for (const job of ready) book.toldReady(job);
        if (ready.length) saveJobs(bot);
        return ready.map(job => (job.unfueled > 0
            ? `The furnace at ${where(job)} has smelted what its fuel covered; ${job.unfueled} ${job.input} wait for more fuel (!collectFurnace).`
            : `The ${job.product} in the furnace at ${where(job)} should be done (!collectFurnace).`));
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
            // Whatever the bot had smelting in it has come out with the rest.
            if (left.length === 0 && jobs(bot)?.at(block.position)) { jobs(bot).end(block.position); saveJobs(bot); }
            say(took.length === 0 && left.length === 0
                ? `The furnace at ${where(block.position)} was already empty.`
                : `I cleared the furnace at ${where(block.position)}${took.length ? `, taking ${listOf(took)}` : ''}.` +
                    (left.length ? ` My inventory was too full to take ${listOf(left.map(s => plural(s.count, s.name)))}.` : ''));
            return left.length === 0;
        } finally {
            await opened.furnace.close();
        }
    }

    return { smeltItem, clearFurnace, loadFurnace, collectFurnace, furnacesText, readyNotes };
}
