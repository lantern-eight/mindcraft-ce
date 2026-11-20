// SPDX-License-Identifier: CC0-1.0
// Giving a Bedrock bot the shapes the rest of the code expects.
//
// mineflayer's Bedrock adapter offers the same `bot` as on Java, but here and there what a call hands
// back has another shape. The skills and this fork's modules are written against the Java shape, and
// there is one copy of them for both editions. So the difference is evened out here, once, on the bot
// itself, instead of in every caller.
//
// Only differences in shape belong in this file: what a call hands back, how often an event fires, where
// the bot stands when it digs straight down, and which call letting go of the keys goes through.
// Something that is plainly a mistake in the adapter belongs fixed in the adapter; when it comes with a
// call this file already reshapes, it is put right here too until the adapter has it, and said so where it
// is done. Something Bedrock can't do at all is listed in docs/bedrock.md.
//
// This is a mineflayer plugin: load it after the bot is created and it runs once the adapter's own
// plugins are in place.

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// How long a chest gets to open. The adapter waits three seconds for the same thing.
const OPEN_TIMEOUT_MS = 5000;

/**
 * Chests, barrels and the like.
 *
 * On Java, opening one hands back the window with `deposit`, `withdraw` and `close` on it:
 *
 *     const chest = await bot.openContainer(block);
 *     await chest.deposit(item.type, null, 3);
 *     chest.close();
 *
 * On Bedrock the adapter's `openContainer` only clicks the block and hands back nothing. The window
 * arrives a moment later as `bot.currentWindow`, and moving items is done by calls on the bot. After this,
 * `openContainer`, `openChest` and `openBlock` all wait for the window and hand it back with those three
 * calls on it.
 *
 * As on Java, the first two go through `bot.openBlock`, looked up when they are called. World memory
 * wraps `bot.openBlock` to note what was in a chest, and that one wrapper has to see every way in.
 *
 * Only the latest open waits for a window: an older one that is still waiting gives way, instead of
 * taking the window the newer one opened and handing it to a caller that gave up on it.
 */
function chestsLikeJava(bot) {
    if (typeof bot.openContainer !== 'function') return; // an adapter without containers: nothing to shape
    const click = bot.openContainer.bind(bot);

    // The adapter itself calls bot.openContainer and then watches for the window in its own way, without
    // waiting for what the call hands back. A promise that fails with nobody waiting on it stops Node, so
    // every promise handed out here is given a listener of its own. A caller that does wait still gets
    // the failure.
    const neverUnheard = promise => {
        promise.catch(() => {});
        return promise;
    };

    let latest = 0; // the open asked for last
    async function openAndWait(block) {
        const ticket = ++latest;
        const before = bot.currentWindow;
        click(block);
        const deadline = Date.now() + OPEN_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (ticket !== latest) throw new Error(`Something else was opened while waiting for the ${block?.name ?? 'container'}`);
            const window = bot.currentWindow;
            if (window && window !== before) return withHands(window);
            await delay(50);
        }
        throw new Error(`The ${block?.name ?? 'container'} did not open`);
    }

    function withHands(window) {
        // A crafting table or a furnace opens a window too, and the adapter has its own calls for those.
        // These three are added to whatever opened and are simply not used there.
        if (typeof window.deposit !== 'function') window.deposit = (itemType, metadata, count) => bot.deposit(itemType, metadata ?? null, count ?? null);
        if (typeof window.withdraw !== 'function') window.withdraw = (itemType, metadata, count) => bot.withdraw(itemType, metadata ?? null, count ?? null);
        if (typeof window.close !== 'function') window.close = () => { if (bot.currentWindow === window) bot.closeWindow(window); };
        return window;
    }

    bot.openBlock = block => neverUnheard(openAndWait(block));
    bot.openContainer = block => neverUnheard(Promise.resolve().then(() => bot.openBlock(block)));
    bot.openChest = bot.openContainer;
}

// ---- Recipes ----------------------------------------------------------------------------------------
//
// On Java a recipe is one of two shapes, and the skills read both:
//   - from mineflayer (`bot.recipesFor`): `inShape`, rows of `{ id, count: 1 }` with id -1 for an empty
//     cell, or `ingredients`, a list of `{ id, count: -1 }`; and `result: { id, count }`.
//   - from the game data (`recipes[itemId]`): the same two, with plain item numbers in place of the objects.
// The adapter keeps its own: one list of `{ name, id, count }` or `{ tag, count }`, a flat `shape` for
// shaped recipes, and the number the server knows the recipe by. `bot.craft` needs that last form back.
//
// Bedrock's recipes come from the server when the bot joins, not from installed game data, so what is
// handed out here is what this server will accept.

const ADAPTER_RECIPE = Symbol("the adapter's own form of a recipe");

// A recipe may ask for "any planks" instead of one kind. For the arithmetic the skills do (do I hold
// enough?) that has to be one item: the kind the bot is holding if it holds one, else the first kind the
// game data lists. The match is by name, as the adapter's own is: it has no table of what belongs to a tag.
function itemForTag(bot, tag) {
    const stem = String(tag).replace(/^minecraft:/, '').replace(/s$/, '');
    const fits = name => typeof name === 'string' && name.includes(stem);
    const held = bot.inventory?.items?.().find(item => fits(item.name));
    if (held) return held.type;
    const listed = (bot.registry?.itemsArray ?? []).find(item => fits(item.name));
    return listed ? listed.id : -1;
}

function ingredientId(bot, ingredient) {
    if (!ingredient) return -1;
    if (ingredient.tag) return itemForTag(bot, ingredient.tag);
    return ingredient.id ?? bot.registry?.itemsByName?.[ingredient.name]?.id ?? -1;
}

// The grid of a shaped recipe as rows of item numbers, -1 where a cell is empty.
function shapeRows(bot, recipe) {
    if (recipe.type !== 'shaped' || !recipe.shape || !recipe.width) return null;
    const rows = [];
    for (let start = 0; start < recipe.shape.length; start += recipe.width) {
        rows.push(recipe.shape.slice(start, start + recipe.width).map(cell => ingredientId(bot, cell)));
    }
    return rows;
}

// Every ingredient of a recipe without a shape, once for each one needed.
function looseIds(bot, recipe) {
    return recipe.ingredients.flatMap(ingredient => new Array(ingredient.count || 1).fill(ingredientId(bot, ingredient)));
}

const resultOf = recipe => ({ id: recipe.result.type ?? recipe.result.id, metadata: recipe.result.metadata ?? null, count: recipe.result.count ?? 1 });

/** A recipe from the adapter in the form mineflayer gives on Java, with the adapter's own form tucked in. */
function recipeLikeJava(bot, recipe) {
    const rows = shapeRows(bot, recipe);
    return {
        result: resultOf(recipe),
        inShape: rows ? rows.map(row => row.map(id => ({ id, metadata: null, count: 1 }))) : null,
        outShape: null,
        ingredients: rows ? null : looseIds(bot, recipe).map(id => ({ id, metadata: null, count: -1 })),
        requiresTable: Boolean(recipe.requiresTable),
        [ADAPTER_RECIPE]: recipe,
    };
}

/**
 * The recipes that make an item, in the form the installed game data has them for Java: what
 * `recipes[itemId]` holds there. Nothing, not an empty list, when the server has no recipe for it.
 */
export function recipesLikeGameData(bot, itemId) {
    if (typeof bot?.recipesAll !== 'function') return undefined;
    const recipes = (bot.recipesAll(itemId, null, true) ?? []).map(found => found[ADAPTER_RECIPE] ?? found);
    if (recipes.length === 0) return undefined;
    return recipes.map(recipe => {
        const rows = shapeRows(bot, recipe);
        const { id, count } = resultOf(recipe);
        const plain = number => (number < 0 ? null : number);
        return rows
            ? { inShape: rows.map(row => row.map(plain)), result: { id, count } }
            : { ingredients: looseIds(bot, recipe).filter(number => number >= 0), result: { id, count } };
    });
}

function recipesLikeJava(bot) {
    if (typeof bot.recipesFor !== 'function' || typeof bot.craft !== 'function') return;
    for (const name of ['recipesFor', 'recipesAll']) {
        const find = bot[name]?.bind(bot);
        if (find) bot[name] = (...args) => (find(...args) ?? []).map(recipe => recipeLikeJava(bot, recipe));
    }
    // Crafting takes back what the two calls above handed out. A recipe in the adapter's own form is
    // passed through as it is.
    const craft = bot.craft.bind(bot);
    bot.craft = (recipe, ...rest) => craft(recipe?.[ADAPTER_RECIPE] ?? recipe, ...rest);
}

// ---- Clicks -----------------------------------------------------------------------------------------

// How long a click waits for the world to show what it did. On a local network the answer is back within
// a tick or two; a click that changes nothing (opening a chest) waits this long and no longer.
const CLICK_SETTLE_MS = 300;

/**
 * A click on a block, and what may follow it.
 *
 * On Java the next click can be sent straight away: a click names only the place. On Bedrock a click
 * also names the block it lands on, and the server ignores one that names a block which is no longer
 * there. Code written for Java does exactly that without knowing: it tills a patch of grass with a hoe
 * and plants on it in the next line, while the bot's copy of the world still says grass. The seed is
 * never planted and nothing reports it.
 *
 * So here a click is not done until the world has shown its effect at that spot, or a moment has passed.
 */
function clicksThatSettle(bot) {
    if (typeof bot.activateBlock !== 'function') return;
    const activate = bot.activateBlock.bind(bot);
    bot.activateBlock = async (block, ...rest) => {
        const changed = blockChangesAt(bot, block?.position);
        const result = await activate(block, ...rest);
        await changed;
        return result;
    };
}

// Resolves when the block at a spot changes, or after a moment. Listening starts before the click is
// sent, so an answer that comes back at once is not missed.
function blockChangesAt(bot, position) {
    if (!position || typeof bot.once !== 'function') return Promise.resolve();
    const event = `blockUpdate:${position}`; // mineflayer's name for it: "blockUpdate:(x, y, z)"
    return new Promise(resolve => {
        const done = () => {
            clearTimeout(timer);
            bot.removeListener(event, done);
            resolve();
        };
        const timer = setTimeout(done, CLICK_SETTLE_MS + 150); // the adapter itself waits 120 ms before it sends
        bot.once(event, done);
    });
}

/**
 * Villagers' trade windows.
 *
 * On Java, `openVillager` hands back a window whose `slots` hold the trade's own slots and then the
 * player's inventory, and the trading skill counts from there whether the bot can pay. The adapter's trade
 * window has no slots: the bot's inventory stays its own while it trades. So the window's `slots` are
 * the bot's inventory, read when asked.
 *
 * A villager with no job, or one that is asleep, opens nothing. On Java openVillager then fails; the
 * adapter's hands back nothing instead. Here that is an error, as a chest that does not open is.
 */
function tradesLikeJava(bot) {
    const open = bot.openVillager;
    if (typeof open !== 'function') return;
    bot.openVillager = async (...args) => {
        const window = await open.apply(bot, args);
        if (!window) throw new Error('The villager opened no trade window');
        if (!('slots' in window)) Object.defineProperty(window, 'slots', { get: () => bot.inventory.slots, configurable: true });
        return window;
    };
}

/**
 * A biome, read from the world.
 *
 * On Java `bot.world.getBiome(position)` answers with the biome's number, and Mindcraft and world memory
 * look its name up in the game data by that number. The Bedrock chunk answers with a biome object instead,
 * so the lookup found nothing. Here it answers with the object's number. The adapter makes a new world when
 * the bot changes dimension and puts it at `bot.world`, so each world is evened out as it is put there.
 */
const NUMBERED = Symbol('biomes answered as numbers');
function biomesLikeJava(bot) {
    if (!('world' in bot)) return; // the adapter puts a world in place before this plugin loads
    const numbered = world => {
        if (!world || typeof world.getBiome !== 'function' || world.getBiome[NUMBERED]) return world;
        const getBiome = world.getBiome;
        world.getBiome = Object.assign(function (...args) {
            const biome = getBiome.apply(this, args);
            return biome && typeof biome === 'object' ? biome.id : biome;
        }, { [NUMBERED]: true });
        return world;
    };
    let world = numbered(bot.world);
    Object.defineProperty(bot, 'world', {
        configurable: true,
        enumerable: true,
        get: () => world,
        set: next => { world = numbered(next); },
    });
}

// Java's pathfinder puts a bot that stops more than this far off the middle of its block (along either
// side) back in the middle: within it, the bot's box, 0.6 wide, is inside its own block.
const OFF_MIDDLE = 0.2;
// Where the steps to the middle aim: well inside OFF_MIDDLE.
const NEAR_MIDDLE = 0.08;
// A Bedrock server has the last word on where a walk stopped, and gives it up to about 0.8 s after the stop,
// by moving the bot. Steps taken before that are undone by it. So the steps wait for the bot to have stood
// still sideways this long.
const SETTLE_MS = 1000;
// All of it (the waiting, the steps, the check afterwards) gives up after this long.
const STEP_TIMEOUT_MS = 6000;

const offMiddle = (position, middle) => Math.max(Math.abs(position.x - middle.x), Math.abs(position.z - middle.z));
const nextTick = (bot, ms) => new Promise(resolve => {
    const done = () => { clearTimeout(timer); bot.removeListener('physicsTick', done); resolve(); };
    const timer = setTimeout(done, ms);
    bot.on('physicsTick', done);
});

// When each bot last moved sideways, whether it walked or the server moved it. Watched on every tick.
const lastSideways = new WeakMap(); // bot -> { x, z, at }
function watchSideways(bot) {
    if (typeof bot.on !== 'function') return;
    const seen = { x: NaN, z: NaN, at: 0 };
    lastSideways.set(bot, seen);
    bot.on('physicsTick', () => {
        const p = bot.entity?.position;
        if (!p || (Math.abs(p.x - seen.x) < 0.001 && Math.abs(p.z - seen.z) < 0.001)) return;
        seen.x = p.x; seen.z = p.z; seen.at = Date.now();
    });
}

async function standingStill(bot, settleMs, deadline) {
    const seen = lastSideways.get(bot);
    while (seen && Date.now() - seen.at < settleMs && Date.now() < deadline) await delay(Math.min(100, settleMs));
}

// Steps to the middle, facing it, sneaking so as to go slowly. A step carries the bot on after it lets go, so
// it lets go early and coasts in: pressing until it got there would overshoot, and turn about, and overshoot.
async function stepsTo(bot, middle, deadline) {
    const here = () => bot.entity.position; // read afresh: the adapter puts a new position on the bot as it moves
    const inTheBlock = () => Math.abs(here().x - middle.x) < 0.5 && Math.abs(here().z - middle.z) < 0.5;
    const { yaw, pitch } = bot.entity;
    try {
        bot.setControlState('sneak', true);
        while (Date.now() < deadline && inTheBlock()) {
            const dx = middle.x - here().x, dz = middle.z - here().z;
            if (Math.max(Math.abs(dx), Math.abs(dz)) <= NEAR_MIDDLE) break;
            const v = bot.entity.velocity;
            const coasting = Math.hypot(dx, dz) <= 1.5 * (v ? Math.hypot(v.x, v.z) : 0);
            // Face the middle the pathfinder's own way, and step, or let go and coast.
            if (!coasting) await bot.look(Math.atan2(-dx, -dz), pitch, true);
            bot.setControlState('forward', !coasting);
            await nextTick(bot, Math.max(1, Math.min(200, deadline - Date.now())));
        }
    } finally {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', false);
        try { await bot.look(yaw, pitch, true); } catch { /* a bot that has left looks nowhere */ }
    }
}

/**
 * Walks the bot to the middle of its block, if it is more than 0.2 off it, the way a player would: once it
 * has stood still long enough for the server to have said where it is, facing the middle and sneaking. Then
 * it faces where it faced before, and waits to see that the server took the steps; if the server moved it
 * off again, it steps again. Only onto ground: a bot held up by the next block, over nothing, stays put.
 *
 * @returns {Promise<boolean>} true when the bot ends within 0.2 of the middle
 */
export async function stepToTheMiddle(bot, { settleMs = SETTLE_MS, timeoutMs = STEP_TIMEOUT_MS, rounds = 3 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (let round = 0; round < rounds; round++) {
        const entity = bot.entity;
        if (!entity?.position || !entity.onGround || entity.isInWater || entity.isInLava || bot.vehicle) return false;
        await standingStill(bot, settleMs, deadline);
        const position = bot.entity.position;
        const middle = { x: Math.floor(position.x) + 0.5, z: Math.floor(position.z) + 0.5 };
        if (offMiddle(position, middle) <= OFF_MIDDLE) return true;
        if (Date.now() >= deadline) return false;
        // What the bot would stand on in the middle. Walking reads the world as it is, not as the bot has seen
        // it: fair play leaves where exactly to stand to the legs (docs/fair-play.md).
        const below = bot.blockAt?.(position.offset(middle.x - position.x, -0.01, middle.z - position.z).floored());
        if (below?.boundingBox !== 'block') return false;
        await stepsTo(bot, middle, deadline);
    }
    const position = bot.entity.position;
    return offMiddle(position, { x: Math.floor(position.x) + 0.5, z: Math.floor(position.z) + 0.5 }) <= OFF_MIDDLE;
}

/**
 * Digging the block under the bot's feet.
 *
 * On Java the pathfinder ends a walk with the bot in the middle of its block: one that stops more than 0.2 off
 * it is moved there in one go. Mindcraft's `digDown` counts on that. It digs the column under the bot's feet,
 * and a bot off the middle stands partly on the next block and doesn't drop into the hole it digs. A Bedrock
 * server refuses a move like that, so on Bedrock the pathfinder leaves the bot where it stopped, up to a third
 * of a block off, and the server then has the last word on where that is, up to a second later.
 *
 * Moving to the middle after every walk would make every walk a second longer, for the sake of the few things
 * that need it. So it is done where it is needed: before the block under the bot's feet is dug, the bot steps
 * to the middle of its block. The pathfinder digging its own way down is left to itself.
 */
function digsUnderItselfFromTheMiddle(bot) {
    if (typeof bot.dig !== 'function') return; // an adapter that can't dig: nothing to shape
    watchSideways(bot);
    const dig = bot.dig;
    const underFeet = block => {
        const feet = bot.entity?.position, cell = block?.position;
        return Boolean(feet && cell) && cell.x === Math.floor(feet.x) && cell.z === Math.floor(feet.z) && cell.y === Math.floor(feet.y - 0.01);
    };
    bot.dig = async function (block, ...rest) {
        if (underFeet(block) && !bot.pathfinder?.isMining?.()) await stepToTheMiddle(bot);
        return await dig.call(this, block, ...rest);
    };
}

/** The plugin. Each shape is its own function above, so the list of what is evened out stays readable. */
// ---- Keys -------------------------------------------------------------------------------------------
//
// On Java, `bot.clearControlStates()` lets go of each key through `bot.setControlState`. The adapter's lets
// go of them all by writing its own table directly. The difference matters to anything that wraps
// `setControlState`: the agent does (action_context.js), so that an action it has stopped can't press or let
// go of a key once a newer one owns the bot. With the adapter's own, a stopped action tidying up as it ended
// let go of the keys of the action that came after it: a retreat begun as a fight ended stood still, its
// sprint undone a moment after it started. After this, letting go of every key goes through
// `setControlState`, looked up when it is called, as on Java.
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

function keysLikeJava(bot) {
    if (typeof bot.clearControlStates !== 'function') return; // an adapter without keys: nothing to shape
    bot.clearControlStates = () => {
        const keys = Object.keys(bot.controlState ?? {});
        for (const key of keys.length ? keys : KEYS) bot.setControlState(key, false);
    };
}

export function javaShapes(bot) {
    biomesLikeJava(bot);
    chestsLikeJava(bot);
    recipesLikeJava(bot);
    clicksThatSettle(bot);
    tradesLikeJava(bot);
    digsUnderItselfFromTheMiddle(bot);
    keysLikeJava(bot);
}
