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
import { SPEED, cleanName, inputsFor, kindName, kindsFor, productOf } from './recipes.js';
import { LAVA, SMELT_MS, fuelPer, itemsFrom, nextFuel, planFuel } from './fuel.js';
import { furnaceHands } from './furnace_hands.js';
import { holdsOnly, leftToLoad, stillInFurnace } from './jobs.js';
import { BUCKET, lavaSource } from './lava.js';
import { GROUP_RANGE, MAX_FURNACES, MIN_SHARE, planShares, shareOut } from './shares.js';

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
    /** How long one item takes in a furnace block of this kind: half as long in a blast furnace or smoker. */
    const msFor = kind => smeltMs / (SPEED[kind] ?? 1);
    /**
     * Lava burns this long once it catches, smelting or not: when lava the bot put in at `at` burns out. It
     * smelts a hundred items whatever the block, so burns half as long in a faster one.
     */
    const lavaBurnsUntil = (at, ms = smeltMs) => at + fuelPer(LAVA) * ms;
    /**
     * The furnace blocks to smelt an item in, fastest first: a blast furnace for ores and a smoker for food,
     * where the edition lets the bot use them, and always a furnace.
     */
    const usableKinds = (bot, input) => {
        const usable = editionOf(bot.registry).usableFurnaceKinds?.() ?? ['furnace'];
        return kindsFor(input).filter(kind => usable.includes(kind));
    };
    /** Furnace blocks as found, the faster kinds first and then the nearest (the list comes nearest first). */
    const fastestFirst = (bot, blocks) => {
        const edition = editionOf(bot.registry);
        const speed = block => SPEED[edition.furnaceOf(block)?.kind] ?? 1;
        return blocks.map((block, i) => ({ block, i })).sort((a, b) => speed(b.block) - speed(a.block) || a.i - b.i).map(({ block }) => block);
    };

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
     * Places a furnace block the bot carries (`kind`: a furnace, blast furnace or smoker) next to it: on a cell
     * it knows is empty, with a full block under it, not where the bot itself stands. Gives where, or null.
     */
    async function placeFurnace(bot, kind = 'furnace') {
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
            try { placed = await skills.placeBlock(bot, kind, cell.x, cell.y, cell.z); }
            catch (error) { console.warn(`[smelting] Placing a ${kindName(kind)}:`, error?.message ?? error); }
            if (placed && edition.furnaceOf(blockAt(bot, cell))?.kind === kind) return cell;
        }
        return null;
    }

    /**
     * A furnace to smelt `input` in, opened: first one where the bot left some of it smelting (its own job),
     * then one it knows of nearby that is free, else its own, placed, else one farther off. Among those near,
     * and among those it carries, a blast furnace (for ores) or a smoker (for food) comes before a furnace:
     * they smelt twice as fast. A furnace with anything in its input or output is someone else's work and is
     * left alone, unless what is in it is only what the bot put there itself. Gives `{furnace, at, kind,
     * placed, mine}` or `{problem}`; `mine` is true when the furnace already holds the bot's own job for
     * this item.
     */
    async function freeFurnace(bot, hands, input) {
        const book = jobs(bot);
        const kinds = usableKinds(bot, input);
        const kindAt = block => editionOf(bot.registry).furnaceOf(block)?.kind ?? 'furnace';
        const tried = new Set();
        const notes = [];
        const key = pos => `${pos.x},${pos.y},${pos.z}`;
        const attempt = async block => {
            tried.add(key(block.position));
            const kind = kindAt(block);
            const opened = await reach(bot, block, hands);
            if (!opened.furnace) {
                notes.push(`I couldn't use the ${kindName(kind)} at ${where(block.position)}: ${opened.problem}.`);
                return null;
            }
            const slots = opened.furnace.slots();
            const job = book?.at(block.position) ?? null;
            const mine = holdsOnly(job, slots);
            if (slots.input || slots.output) {
                if (!mine || job.input !== input) {
                    const inside = [slots.input, slots.output].filter(Boolean).map(stack => plural(stack.count, stack.name));
                    notes.push(mine ? `The ${kindName(kind)} at ${where(block.position)} is smelting my ${job.input}, so I left it to that.`
                        : `The ${kindName(kind)} at ${where(block.position)} is in use (${listOf(inside)} in it), so I left it alone.`);
                    await opened.furnace.close();
                    return null;
                }
            } else if (job && job.input !== input) {
                // An old job of the bot's, and the furnace empty: someone took it all, or it was cleared.
                book.end(block.position);
            }
            return { furnace: opened.furnace, at: block.position.clone?.() ?? block.position, kind, mine: mine && job.input === input };
        };
        // A smelt of this item left in a furnace is gone on with first: the bot's things are in it.
        for (const job of book?.list({ from: bot.entity.position, input, maxDistance: FAR_RANGE }) ?? []) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const block = blockAt(bot, new Vec3(job.x, job.y, job.z));
            if (!editionOf(bot.registry).furnaceOf(block)) { book.end(job); continue; }
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes, tried };
        }
        // A player looks round before deciding there is no furnace near, or before walking to a far one.
        await lookAround(bot, knownFurnaces(bot, NEAR_RANGE, kinds)[0]?.position ?? null);
        for (const block of fastestFirst(bot, knownFurnaces(bot, NEAR_RANGE, kinds)).filter(block => !tried.has(key(block.position)))) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes, tried };
        }
        // Its own, the fastest kind it carries.
        const carried = kinds.find(kind => countOf(bot, kind) > 0);
        if (carried && !bot.interrupt_code) {
            const spot = await placeFurnace(bot, carried);
            if (!spot) notes.push(`I found no spot I could see to place my ${kindName(carried)}.`);
            else {
                const got = await attempt(blockAt(bot, spot));
                if (got) return { ...got, placed: true, notes, tried };
            }
        }
        for (const block of fastestFirst(bot, knownFurnaces(bot, FAR_RANGE, kinds)).filter(block => !tried.has(key(block.position)))) {
            if (bot.interrupt_code) return { problem: 'I was interrupted.' };
            const got = await attempt(block);
            if (got) return { ...got, placed: false, notes, tried };
        }
        if (bot.interrupt_code) return { problem: 'I was interrupted.' };
        if (notes.length > 0) return { problem: notes.join(' ') };
        // Worded so fair play adds its note that "none known" isn't "none there".
        return { problem: `There is no furnace nearby that I know of within ${FAR_RANGE} blocks, and I carry none.` };
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
     * name), `inFurnace` (input now), `covered` (how many items the fuel will smelt; `ms` is how long one
     * item takes in this furnace, for the lava still burning), `buckets` (empty
     * buckets taken out) and `lavaAt` (when lava went in, or null).
     */
    async function tend(furnace, { input, product, more, bag, lavaFirst = false, lavaUntil = 0, ms = smeltMs }) {
        const slots = furnace.slots();
        if ((slots.input && slots.input.name !== input) || (slots.output && slots.output.name !== product)) return { meddled: true };
        const took = slots.output ? (await furnace.take('output'))?.count ?? 0 : 0;
        const buckets = slots.fuel?.name === BUCKET ? (await furnace.take('fuel'))?.count ?? 0 : 0;
        const inputAtLook = slots.input?.count ?? 0;
        const toLoad = Math.max(0, Math.min(STACK - inputAtLook, more, bag[input] ?? 0));
        const fuel = furnace.slots().fuel;
        const fuelMoved = {};
        const burning = Math.floor(Math.max(0, lavaUntil - now()) / ms);
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
    const readyAfter = (inFurnace, covered, ms = smeltMs) => now() + Math.min(inFurnace, covered) * ms;

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
        // A smelt shared between furnaces leaves some in each: those in the row around the nearest all count.
        const lefts = book?.list({ from: bot.entity.position, input, maxDistance: FAR_RANGE }) ?? [];
        const left = lefts[0] ?? null;
        const group = left ? lefts.filter(job => Math.hypot(job.x - left.x, job.y - left.y, job.z - left.z) <= GROUP_RANGE) : [];
        const inside = group.reduce((n, job) => n + stillInFurnace(job), 0);
        if (have + inside === 0) { say(`I have no ${input} to smelt.`); return null; }
        let target = Math.min(wanted, have + inside);
        const leftIn = group.length > 1 ? `${group.length} furnaces near ${where(left)}` : `the ${kindName(left?.kind)} at ${left ? where(left) : ''}`;
        if (target < wanted) notes.push(`I had only ${plural(have + inside, input)}${inside ? `, counting ${inside} left in ${leftIn}` : ''}.`);
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
        const kind = site.kind;
        const ms = msFor(kind);
        if (site.placed) notes.push(`I placed my ${kindName(kind)} at ${where(site.at)}.`);
        const at = site.at;
        // What of its own is in this furnace already, counted from the slots, not from belief.
        const first = site.furnace.slots();
        const preloaded = site.mine ? (first.input?.count ?? 0) + (first.output?.count ?? 0) : 0;
        if (preloaded > 0) notes.push(`I went on with the ${input} I had left in the ${kindName(kind)} at ${where(at)}.`);
        // The other furnaces of the row that hold some of it of the bot's own are gone on with too (see
        // smeltItem), unless this search just found them not free. What was believed to be in this one or
        // those and isn't is that much less to smelt: only what it carries, and what is in them, counts.
        const keyOf = pos => `${pos.x},${pos.y},${pos.z}`;
        const owned = group.filter(job => keyOf(job) !== keyOf(at) && !site.tried?.has(keyOf(job)));
        const ownedInside = owned.reduce((n, job) => n + stillInFurnace(job), 0);
        target = Math.min(target, have + preloaded + ownedInside);
        const fromBag = Math.max(0, target - preloaded - ownedInside);
        const jobBefore = book?.at(at) ?? null;
        const placed = site.placed || (site.mine && (jobBefore?.placed ?? false));
        book?.start(at, { kind, input, product, total: target, placed });
        // The fuel of its own in this furnace: what an earlier smelt put in (if this is its job). Only as
        // much as is its own is ever taken back.
        const fuelBefore = site.mine ? { ...(jobBefore?.fuelPut ?? {}) } : {};
        const lavaUntil = site.mine ? (jobBefore?.lavaUntil ?? 0) : 0;
        return { say, input, product, wanted, notes, book, inventory, target, fromBag, owned, hands, furnace: site.furnace, at, kind, ms, preloaded,
            placed, fuelBefore, lavaFirst, lavaUntil };
    }

    /**
     * Other furnace blocks to share a big smelt with: the ones the bot knows of near the first, of the kinds
     * that smelt this item, fastest first, then the ones it carries, which are placed when their turn comes
     * (only with a pickaxe to pick them back up after: a furnace mined by hand drops nothing). One that holds
     * a smelt of the bot's own of something else is left to that. Whether each is free is seen when it is
     * opened. Up to MAX_FURNACES in all, counting the first.
     */
    function helpersFor(bot, first, input, { skip = [] } = {}) {
        const kinds = usableKinds(bot, input);
        const book = jobs(bot);
        const edition = editionOf(bot.registry);
        const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
        const room = MAX_FURNACES - 1;
        const near = fastestFirst(bot, knownFurnaces(bot, NEAR_RANGE + GROUP_RANGE, kinds))
            .filter(block => !same(block.position, first.at) && !skip.some(pos => same(block.position, pos)) && block.position.distanceTo(first.at) <= GROUP_RANGE)
            .filter(block => { const job = book?.at(block.position); return !job || job.input === input; })
            .slice(0, room)
            .map(block => ({ at: block.position.clone?.() ?? block.position, kind: edition.furnaceOf(block)?.kind ?? 'furnace' }));
        const pickaxe = Object.keys(world.getInventoryCounts(bot)).some(name => name.endsWith('_pickaxe'));
        const carried = [];
        if (pickaxe) for (const kind of kinds) for (let i = 0; i < countOf(bot, kind); i++) carried.push({ at: null, kind, carried: true });
        return [...near, ...carried].slice(0, room);
    }

    /**
     * A furnace taking part in a smelt, and how it is getting on: where and what it is, its share, what of
     * its own was in it already, what went in, what fuel of the bot's is in it, when to look in next, and
     * why it is done with (`reason`), once it is.
     */
    function siteOf({ at, kind, placed = false, share, preloaded = 0, furnace = null, fuelPut = {}, lavaUntil = 0, fresh = true, carried = false }) {
        const ms = msFor(kind);
        return { at, kind, name: kindName(kind), ms, placed, share, preloaded, furnace, fuelPut: { ...fuelPut }, fuelNow: {}, returned: {},
            lavaUntil, fresh, carried, loaded: 0, took: 0, lastInput: 0, stalls: 0, looks: 0, nextAt: now(), deadline: Infinity,
            reason: null, problem: null };
    }
    const setDeadline = site => { site.deadline = now() + site.share * limitPerItemMs * (site.ms / smeltMs) + limitExtraMs; };

    /**
     * Gets a furnace that is to share a smelt ready: places it if the bot carries it, opens it, and checks it
     * is free (or holds only the bot's own smelt of this item), as for the first. Starts its job. Gives true,
     * or false with the reason why it can't take part in `site.reason` (and a note in `notes`).
     */
    async function joinSite(bot, hands, site, { input, product, notes }) {
        const book = jobs(bot);
        if (site.carried) {
            const spot = await placeFurnace(bot, site.kind);
            if (!spot) { site.reason = 'skipped'; return false; }
            site.at = spot;
            site.placed = true;
            site.carried = false;
            notes.push(`I placed my ${site.name} at ${where(spot)}.`);
        }
        const block = blockAt(bot, site.at);
        if (!editionOf(bot.registry).furnaceOf(block)) { site.reason = 'skipped'; return false; }
        const opened = await reach(bot, block, hands);
        if (!opened.furnace) {
            site.reason = bot.interrupt_code ? 'interrupted' : 'skipped';
            if (!bot.interrupt_code) notes.push(`I couldn't use the ${site.name} at ${where(site.at)}: ${opened.problem}.`);
            return false;
        }
        site.furnace = opened.furnace;
        const slots = site.furnace.slots();
        const job = book?.at(site.at) ?? null;
        const mine = holdsOnly(job, slots) && job.input === input;
        if ((slots.input || slots.output) && !mine) {
            const inside = [slots.input, slots.output].filter(Boolean).map(stack => plural(stack.count, stack.name));
            notes.push(`The ${site.name} at ${where(site.at)} is in use (${listOf(inside)} in it), so I left it alone.`);
            await site.furnace.close();
            site.furnace = null;
            site.reason = 'skipped';
            return false;
        }
        if (job && !mine) book.end(site.at);
        site.preloaded = mine ? (slots.input?.count ?? 0) + (slots.output?.count ?? 0) : 0;
        site.share += site.preloaded;
        if (mine) { site.fuelPut = { ...(job.fuelPut ?? {}) }; site.lavaUntil = job.lavaUntil ?? 0; site.placed ||= job.placed ?? false; }
        book?.start(site.at, { kind: site.kind, input, product, total: site.share, placed: site.placed });
        site.fresh = false;
        setDeadline(site);
        return true;
    }

    /**
     * A share that a furnace couldn't take goes to the others still at work, in proportion to their speed,
     * so the smelt still gets through all of it. Their jobs are told.
     */
    function reassign(bot, sites, count) {
        const open = sites.filter(site => !site.reason);
        if (!(count > 0) || open.length === 0) return count;
        const extra = shareOut(count, open.map(site => SPEED[site.kind] ?? 1));
        open.forEach((site, i) => {
            site.share += extra[i];
            if (!site.fresh) { jobs(bot)?.note(site.at, { total: site.share - site.took }); setDeadline(site); }
        });
        return 0;
    }

    /**
     * The furnaces a smelt (or a load) uses, the first one first: the furnaces of the row that hold some of
     * this item of the bot's own always come along, and when what goes in from the bag is worth it, the other
     * free ones near and those it carries take shares, as the fuel allows (shares.js). `now` caps how many of
     * each share go in at once, for a load. Sets each one's share.
     */
    function sitesFor(bot, start, first, { now: atOnce = Infinity } = {}) {
        const { input, product, book } = start;
        const owned = start.owned.map(job => ({ at: new Vec3(job.x, job.y, job.z), kind: job.kind ?? 'furnace' }));
        const others = start.fromBag >= 2 * MIN_SHARE ? helpersFor(bot, start, input, { skip: owned.map(o => o.at) }) : [];
        const helpers = [...owned, ...others];
        const shares = start.fromBag >= 2 * MIN_SHARE && helpers.length
            ? planShares(start.fromBag, [start.kind, ...helpers.map(h => h.kind)], world.getInventoryCounts(bot), { input, product, lavaFirst: start.lavaFirst, now: atOnce })
            : [start.fromBag];
        first.share = start.preloaded + shares[0];
        book?.note(first.at, { total: first.share });
        const sites = [first];
        helpers.forEach((helper, i) => {
            const share = shares[i + 1] ?? 0;
            // One of the row's own with nothing new for it still comes along, to go on with what is in it.
            if (share > 0 || i < owned.length) sites.push(siteOf({ ...helper, share }));
        });
        return sites;
    }

    /**
     * Waits, windows shut, until `until`, glancing at the furnaces at work. Gives 'interrupted', the furnace
     * that went out (a lit furnace glows; when its fuel is spent the glow stops), or null when the time is up.
     */
    async function waitFor(bot, sites, until) {
        const edition = editionOf(bot.registry);
        const sawLit = new Set();
        while (now() < until) {
            if (bot.interrupt_code) return 'interrupted';
            await sleep(Math.max(1, Math.min(watchMs, until - now())));
            if (bot.interrupt_code) return 'interrupted';
            for (const site of sites) {
                if (!site.at || site.fresh) continue;
                const seen = edition.furnaceOf(blockAt(bot, site.at));
                if (seen?.lit) sawLit.add(site);
                else if (seen && sawLit.has(site)) return site;
            }
        }
        return null;
    }

    /**
     * Smelts `num` of an item. A big smelt is shared between the free furnaces near the first (and ones the
     * bot carries), each loaded with its share and the fuel for it, and each looked in on when its share
     * should be done or its fuel is nearly spent. Says what happened in the bot's output, as Mindcraft's
     * skills do.
     * @returns {Promise<boolean>} true when all of them were smelted
     */
    async function smeltItem(bot, itemName, num = 1) {
        const start = await begin(bot, itemName, num);
        if (!start) return false;
        const { say, input, product, wanted, notes, book, hands } = start;
        // Standing still beside a furnace for minutes isn't being stuck.
        bot.modes?.pause?.('unstuck');
        const baseline = countOf(bot, product);
        const lavaFirst = start.lavaFirst;

        const first = siteOf({ at: start.at, kind: start.kind, placed: start.placed, share: start.target, preloaded: start.preloaded,
            furnace: start.furnace, fuelPut: start.fuelBefore, lavaUntil: start.lavaUntil, fresh: false });
        // A big smelt is shared with the furnaces near this one, when there are any and the fuel covers it.
        const sites = sitesFor(bot, start, first);
        setDeadline(first);
        const active = () => sites.filter(site => !site.reason);

        /** Puts a furnace's things back in the bag when it is done with, and shuts it. */
        const finish = async site => {
            const keepsJob = site.reason === 'interrupted' || site.reason === 'lost';
            if (site.furnace && site.reason !== 'meddled') {
                const slots = site.furnace.slots();
                if (!keepsJob && slots.input?.name === input) book?.note(site.at, { collected: (await site.furnace.take('input'))?.count ?? 0 });
                const fuel = slots.fuel;
                if (!keepsJob && fuel && site.fuelPut[fuel.name] > 0) site.returned[fuel.name] = await site.furnace.takeSome('fuel', site.fuelPut[fuel.name]);
                // The bucket its lava left.
                else if (!keepsJob && fuel?.name === BUCKET && (site.fuelNow[LAVA] > 0 || site.lavaUntil > 0)) await site.furnace.take('fuel');
            }
            if (site.furnace) { await site.furnace.close(); site.furnace = null; }
            if (!keepsJob && site.reason !== 'skipped') book?.end(site.at);
            saveJobs(bot);
        };

        /** One look into a furnace: take out what is done, top it up, and decide when to look again. */
        const visit = async site => {
            if (site.fresh) {
                if (!(await joinSite(bot, hands, site, { input, product, notes }))) { reassign(bot, sites, site.share); return; }
            } else if (!site.furnace) {
                const block = blockAt(bot, site.at);
                if (!editionOf(bot.registry).furnaceOf(block)) { site.reason = 'gone'; return; }
                const opened = await reach(bot, block, hands);
                if (!opened.furnace) { site.reason = bot.interrupt_code ? 'interrupted' : 'lost'; site.problem = opened.problem; return; }
                site.furnace = opened.furnace;
            }
            const v = await tend(site.furnace, { input, product, more: site.share - site.preloaded - site.loaded, bag: world.getInventoryCounts(bot),
                lavaFirst, lavaUntil: site.lavaUntil, ms: site.ms });
            if (v.meddled) { site.reason = 'meddled'; return; }
            const { took, inputAtLook, movedIn, fuelMoved, inFurnace, covered } = v;
            site.loaded += movedIn;
            site.took += took;
            for (const [name, count] of Object.entries(keptFuel(fuelMoved))) site.fuelPut[name] = (site.fuelPut[name] ?? 0) + count;
            for (const [name, count] of Object.entries(fuelMoved)) site.fuelNow[name] = (site.fuelNow[name] ?? 0) + count;
            if (v.lavaAt !== null) site.lavaUntil = lavaBurnsUntil(v.lavaAt, site.ms);
            book?.note(site.at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered, site.ms), lavaUntil: site.lavaUntil });
            saveJobs(bot);
            const progressed = took > 0 || inputAtLook < site.lastInput;
            site.stalls = site.looks > 0 && !progressed ? site.stalls + 1 : 0;
            site.looks++;
            if (site.took >= site.share) site.reason = 'done';
            else if (site.stalls >= 2) site.reason = 'stalled';
            else if (now() >= site.deadline) site.reason = 'timeout';
            else if (inFurnace === 0) site.reason = site.preloaded + site.loaded >= site.share ? 'done' : 'short';
            else if (covered === 0 && !editionOf(bot.registry).furnaceOf(blockAt(bot, site.at))?.lit) site.reason = 'no_fuel';
            site.lastInput = inFurnace;
            if (site.reason) return;

            // Shut it, and look in again when the load is done, or when its fuel is nearly spent.
            await site.furnace.close();
            site.furnace = null;
            const items = Math.min(inFurnace, covered);
            let waitMs = covered >= inFurnace ? items * site.ms + slackMs
                : covered > 0 ? Math.max(3000, items * site.ms - 4000) : site.ms;
            waitMs = Math.max(1000, Math.min(waitMs, site.deadline - now() + slackMs));
            site.nextAt = now() + waitMs;
        };

        try {
            while (active().length > 0) {
                if (bot.interrupt_code) { for (const site of active()) site.reason = 'interrupted'; break; }
                const next = active().reduce((a, b) => (b.nextAt < a.nextAt ? b : a));
                if (next.nextAt > now()) {
                    for (const site of sites) if (site.furnace) { await site.furnace.close(); site.furnace = null; }
                    const woke = await waitFor(bot, active(), next.nextAt);
                    if (woke === 'interrupted') { for (const site of active()) site.reason = 'interrupted'; break; }
                    if (woke) woke.nextAt = now();
                    continue;
                }
                await visit(next);
                if (next.reason) await finish(next);
            }
            for (const site of sites) await finish(site);
            const smelted = countOf(bot, product) - baseline;

            // What burned, across the furnaces: what went in, less what came back.
            const burnedBy = {};
            for (const site of sites) for (const [name, put] of Object.entries(site.fuelNow)) {
                burnedBy[name] = (burnedBy[name] ?? 0) + put - Math.min(put, site.returned[name] ?? 0);
            }
            const burned = Object.entries(burnedBy).filter(([, count]) => count > 0).map(([name, count]) => plural(count, name));
            // The furnaces that took part: opened, and not left for being in use.
            const used = sites.filter(site => !site.fresh && site.reason !== 'skipped');
            const places = listOf(used.map(site => `the ${site.name} at ${where(site.at)}`));
            const did = smelted > 0
                ? `I smelted ${plural(smelted, input)} into ${product} in ${places}${burned.length ? `, burning ${listOf(burned)}` : ''}.`
                : `I smelted nothing in ${places}.`;
            const whyOf = site => ({
                done: null,
                short: `I had no more ${input} to put in.`,
                meddled: `Someone else put something in the ${site.name}${used.length > 1 ? ` at ${where(site.at)}` : ''}, so I stopped and left their things in it.`,
                stalled: `The ${site.name}${used.length > 1 ? ` at ${where(site.at)}` : ''} stopped making anything, so I took my things back out.`,
                timeout: 'It took far longer than it should, so I took my things back out.',
                no_fuel: 'I ran out of fuel, so I took the rest back out.',
                gone: `The ${site.name} at ${where(site.at)} is gone.`,
                lost: `I couldn't get back into the ${site.name}${used.length > 1 ? ` at ${where(site.at)}` : ''}: ${site.problem}. My ${input} is still in it; !smeltItem goes on with it.`,
                interrupted: `I was interrupted. The ${site.name} at ${where(site.at)} still has ${input} of mine in it and goes on smelting; ` +
                    '!smeltItem goes on with it.',
            })[site.reason] ?? null;
            const whys = [...new Set(used.map(whyOf).filter(Boolean))];

            // A furnace placed for this smelt goes back in the bag, if the bot can dig it up and nothing of
            // anyone's is left in it.
            for (const site of used) {
                if (!site.placed || ['interrupted', 'lost', 'meddled', 'gone'].includes(site.reason)) continue;
                const pickaxe = Object.keys(world.getInventoryCounts(bot)).some(name => name.endsWith('_pickaxe'));
                let back = false;
                if (pickaxe && !bot.interrupt_code) {
                    try {
                        back = await skills.breakBlockAt(bot, site.at.x, site.at.y, site.at.z);
                        if (back) await skills.pickupNearbyItems(bot);
                    } catch (error) { console.warn('[smelting] Picking the furnace back up:', error?.message ?? error); }
                }
                notes.push(back ? `I picked my ${site.name} back up.`
                    : pickaxe ? `I left my ${site.name} at ${where(site.at)}.` : `I left my ${site.name} at ${where(site.at)}: it takes a pickaxe to pick it back up.`);
            }
            say([did, ...whys, ...notes].filter(Boolean).join(' '));
            return smelted >= wanted;
        } finally {
            for (const site of sites) if (site.furnace) await site.furnace.close();
        }
    }

    /**
     * Loads a furnace and leaves it, as a player does with a long smelt: puts in up to a stack of the item
     * and the fuel for it, shuts it, and says when it will be done. A big load is shared between the free
     * furnaces near the first, as smeltItem shares a smelt, each with a job of its own. The jobs remember the
     * rest of `num`, and `collectFurnace` takes out what is done and puts in more.
     * @returns {Promise<boolean>} true when something went in
     */
    async function loadFurnace(bot, itemName, num = 1) {
        const start = await begin(bot, itemName, num, { atOnce: STACK });
        if (!start) return false;
        const { say, input, product, notes, book, hands } = start;
        const first = siteOf({ at: start.at, kind: start.kind, placed: start.placed, share: start.target, preloaded: start.preloaded,
            furnace: start.furnace, lavaUntil: start.lavaUntil, fresh: false });
        const sites = sitesFor(bot, start, first, { now: STACK });
        const lines = [];
        let loadedAny = false;
        try {
            for (const site of sites) {
                if (bot.interrupt_code) break;
                if (site.fresh && !(await joinSite(bot, hands, site, { input, product, notes }))) {
                    // Its share goes to the first furnace's job, to go in when it is collected.
                    if (first.reason !== 'meddled') { first.share += site.share; book?.note(first.at, { total: first.share - first.took }); }
                    continue;
                }
                const v = await tend(site.furnace, { input, product, more: site.share - site.preloaded, bag: world.getInventoryCounts(bot),
                    lavaFirst: start.lavaFirst, lavaUntil: site.lavaUntil, ms: site.ms });
                await site.furnace.close();
                site.furnace = null;
                if (v.meddled) {
                    site.reason = 'meddled';
                    book?.end(site.at);
                    saveJobs(bot);
                    lines.push(`Someone else's things went into the ${site.name} at ${where(site.at)}, so I left it.`);
                    continue;
                }
                const { took, movedIn, fuelMoved, inFurnace, covered } = v;
                site.took += took;
                const unfueled = Math.max(0, inFurnace - covered);
                book?.note(site.at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered, site.ms), unfueled,
                    ...(v.lavaAt !== null ? { lavaUntil: lavaBurnsUntil(v.lavaAt, site.ms) } : {}) });
                if (inFurnace === 0) book?.end(site.at);
                saveJobs(bot);
                if (inFurnace === 0) { lines.push(`I put nothing in the ${site.name} at ${where(site.at)}.`); continue; }
                loadedAny = true;
                const fuel = Object.entries(fuelMoved).map(([name, count]) => plural(count, name));
                const later = leftToLoad(book?.at(site.at));
                lines.push([
                    movedIn > 0 ? `I put ${plural(movedIn, input)}${fuel.length ? ` and ${listOf(fuel)}` : ''} in the ${site.name} at ${where(site.at)}.` : null,
                    took > 0 ? `I took out ${plural(took, product)} that was done.` : null,
                    unfueled === 0 ? `The ${inFurnace} ${input} in it will be ${product} in ${about(inFurnace * site.ms)}.`
                        : `Its fuel smelts ${covered} of the ${inFurnace} ${input} in it, in ${about(covered * site.ms)}; the rest need more fuel.`,
                    later > 0 ? `${later} more ${input} go in when there is room.` : null,
                ].filter(Boolean).join(' '));
            }
            if (!loadedAny) { say([...notes, ...lines].join(' ')); return false; }
            say([...notes, ...lines, '!collectFurnace takes out what is done.'].join(' '));
            return true;
        } finally {
            for (const site of sites) if (site.furnace) await site.furnace.close();
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
            const name = kindName(job.kind);
            const ms = msFor(job.kind);
            const block = blockAt(bot, at);
            if (!editionOf(bot.registry).furnaceOf(block)) {
                book.end(at);
                lines.push(`The ${name} at ${where(at)} is gone, and the ${job.input} I had in it.`);
                continue;
            }
            const opened = await reach(bot, block, hands);
            if (!opened.furnace) { lines.push(`I couldn't get into the ${name} at ${where(at)}: ${opened.problem}.`); continue; }
            let furnace = opened.furnace;
            let over = false;
            try {
                if (!holdsOnly(job, furnace.slots())) {
                    book.end(at);
                    lines.push(`The ${name} at ${where(at)} has someone else's things in it now, so I left it.`);
                    continue;
                }
                const visit = await tend(furnace, { input: job.input, product: job.product, more: leftToLoad(job), bag: world.getInventoryCounts(bot),
                    lavaFirst: Boolean(lava.farmNear(bot)), lavaUntil: job.lavaUntil ?? 0, ms });
                const { took, movedIn, fuelMoved, inFurnace, covered } = visit;
                const unfueled = Math.max(0, inFurnace - covered);
                const after = book.note(at, { loaded: movedIn, collected: took, fuelPut: keptFuel(fuelMoved), readyAt: readyAfter(inFurnace, covered, ms), unfueled,
                    ...(visit.lavaAt !== null ? { lavaUntil: lavaBurnsUntil(visit.lavaAt, ms) } : {}) });
                if (took > 0) tookAny = true;
                const parts = [took > 0 ? `From the ${name} at ${where(at)} I took ${plural(took, job.product)}.` : `Nothing in the ${name} at ${where(at)} was done yet.`];
                if (movedIn > 0) parts.push(`I put in ${plural(movedIn, job.input)} more.`);
                if (inFurnace > 0) {
                    parts.push(unfueled === 0 ? `${inFurnace} ${job.input} still smelting, done in ${about(inFurnace * ms)}.`
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
                    if (back) lines.push(`I picked my ${name} back up.`);
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
            return `- ${kindName(job.kind)} at ${where(job)}: ${inside} ${job.input} into ${job.product}${more}${job.collected ? `, ${job.collected} taken out so far` : ''}${when}`;
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
            ? `The ${kindName(job.kind)} at ${where(job)} has smelted what its fuel covered; ${job.unfueled} ${job.input} wait for more fuel (!collectFurnace).`
            : `The ${job.product} in the ${kindName(job.kind)} at ${where(job)} should be done (!collectFurnace).`));
    }

    /**
     * Takes everything out of the nearest furnace the bot knows of.
     * @returns {Promise<boolean>} true when the furnace was opened and emptied
     */
    async function clearFurnace(bot) {
        const say = text => skills.log(bot, text);
        // Any furnace block the bot can work on this edition.
        const kinds = editionOf(bot.registry).usableFurnaceKinds?.() ?? ['furnace'];
        await lookAround(bot, knownFurnaces(bot, CLEAR_RANGE, kinds)[0]?.position ?? null);
        const block = knownFurnaces(bot, CLEAR_RANGE, kinds)[0];
        if (!block) { say('There is no furnace nearby to clear.'); return false; }
        const hands = furnaceHands(bot, { wait: sleep, ...handOptions });
        const name = kindName(editionOf(bot.registry).furnaceOf(block)?.kind);
        const opened = await reach(bot, block, hands);
        if (!opened.furnace) { say(`I couldn't open the ${name} at ${where(block.position)}: ${opened.problem}.`); return false; }
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
                ? `The ${name} at ${where(block.position)} was already empty.`
                : `I cleared the ${name} at ${where(block.position)}${took.length ? `, taking ${listOf(took)}` : ''}.` +
                    (left.length ? ` My inventory was too full to take ${listOf(left.map(s => plural(s.count, s.name)))}.` : ''));
            return left.length === 0;
        } finally {
            await opened.furnace.close();
        }
    }

    return { smeltItem, clearFurnace, loadFurnace, collectFurnace, furnacesText, readyNotes };
}
