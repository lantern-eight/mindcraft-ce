// SPDX-License-Identifier: CC0-1.0
// Giving a Bedrock bot the shapes the rest of the code expects.
//
// mineflayer's Bedrock adapter offers the same `bot` as on Java, but here and there what a call hands
// back has another shape. The skills and this fork's modules are written against the Java shape, and
// there is one copy of them for both editions. So the difference is evened out here, once, on the bot
// itself, instead of in every caller.
//
// Only differences in shape belong in this file: what a call hands back, and how often an event fires.
// Something that is plainly a mistake in the adapter is fixed in the adapter; something Bedrock can't do at
// all is listed in docs/bedrock.md.
//
// This is a mineflayer plugin: load it after the bot is created and it runs once the adapter's own
// plugins are in place.

import Vec3 from 'vec3';
import { sideOfWindow, transferItems } from './window_moves.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// How long a chest gets to open. The adapter waits three seconds for the same thing.
const OPEN_TIMEOUT_MS = 5000;
// How long before a click that opened nothing is made again. A window comes back in a tenth of a second
// or so; a click the server ignored never brings one.
const RECLICK_MS = 1000;

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
 * A click that names a block in a state the server no longer has is ignored. A barrel is a different
 * block state open and shut, and for a moment after it is closed the bot still sees it open, so a click
 * to open it again straight away was ignored and the chest sorter, which does just that, gave up on the
 * barrel. So a click that brings no window is made once more, a second later, when the bot sees the
 * block as it is. And only the latest open waits for a window: an older one that is still waiting gives
 * way, instead of taking the window the newer one opened and handing it to a caller that gave up on it.
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
        let again = Date.now() + RECLICK_MS;
        while (Date.now() < deadline) {
            if (ticket !== latest) throw new Error(`Something else was opened while waiting for the ${block?.name ?? 'container'}`);
            const window = bot.currentWindow;
            if (window && window !== before) return withHands(window);
            if (again && Date.now() >= again) {
                again = 0;
                click(block); // the adapter names the block as the bot sees it now
            }
            await delay(50);
        }
        throw new Error(`The ${block?.name ?? 'container'} did not open`);
    }

    function withHands(window) {
        // A crafting table or a furnace opens a window too, and the adapter has its own calls for those.
        // These three are added to whatever opened and are simply not used there.
        // The adapter's own withdraw and deposit name a chest's slots, which the server refuses for a
        // barrel or a shulker box. Those get the same moves made with the right name (window_moves.js).
        const ownMoves = window.inventoryStart != null && sideOfWindow(bot, window) !== 'container';
        if (typeof window.deposit !== 'function') {
            window.deposit = ownMoves
                ? (itemType, metadata, count) => transferItems(bot, window, { itemType, count: count ?? null, into: 'container' })
                : (itemType, metadata, count) => bot.deposit(itemType, metadata ?? null, count ?? null);
        }
        if (typeof window.withdraw !== 'function') {
            window.withdraw = ownMoves
                ? (itemType, metadata, count) => transferItems(bot, window, { itemType, count: count ?? null, into: 'inventory' })
                : (itemType, metadata, count) => bot.withdraw(itemType, metadata ?? null, count ?? null);
        }
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
 * The bot's `move` event, as often as on Java.
 *
 * On Java, mineflayer fires `move` each time it tells the server where the bot is or which way it faces,
 * which it does on every tick the bot moved or turned. The Bedrock adapter tells the server on every tick
 * too, but fires `move` only when the server corrects the bot or teleports it. A walk of sixteen blocks
 * brought three of them, some five blocks apart. World memory lays its trail from `move`, a crumb every
 * few blocks: with so few events the trail had gaps, and two events more than ten blocks apart read as
 * a teleport, which breaks the trail where the bot simply walked.
 *
 * So after each physics tick in which the bot moved or turned, `move` is fired here, with where the bot
 * was before, as on Java. A `move` the adapter fires itself counts too, so the same change is never
 * announced twice. Nothing else changes: what the bot sends the server, and how it moves, are the
 * adapter's. Should the adapter one day fire `move` on every tick itself, this piece goes.
 */
function movesLikeJava(bot) {
    if (typeof bot.on !== 'function' || typeof bot.emit !== 'function') return;
    let last = null; // where the bot was, and which way it faced, when `move` last fired
    const pose = () => {
        const entity = bot.entity;
        if (!entity?.position) return null;
        const { x, y, z } = entity.position;
        return { x, y, z, yaw: entity.yaw, pitch: entity.pitch };
    };
    bot.on('move', () => { last = pose(); });
    bot.on('physicsTick', () => {
        const now = pose();
        if (!now) return;
        if (last && now.x === last.x && now.y === last.y && now.z === last.z && now.yaw === last.yaw && now.pitch === last.pitch) return;
        const before = last ?? now;
        bot.emit('move', new Vec3(before.x, before.y, before.z));
    });
}

/** The plugin. Each shape is its own function above, so the list of what is evened out stays readable. */
export function javaShapes(bot) {
    chestsLikeJava(bot);
    recipesLikeJava(bot);
    clicksThatSettle(bot);
    movesLikeJava(bot);
}
