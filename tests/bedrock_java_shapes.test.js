// SPDX-License-Identifier: CC0-1.0
// On Bedrock, what the bot hands back has to have the shape it has on Java, because the skills are written
// against that: an opened chest with deposit, withdraw and close on it, a recipe laid out the way
// mineflayer and the game data lay one out there, and a click on a block that can be followed by another
// straight away. No server; the adapter is stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';
import { javaShapes, recipesLikeGameData } from '../src/agent/bedrock/java_shapes.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A bot as the Bedrock adapter leaves it: openContainer clicks and hands back nothing, the window turns
// up a moment later as bot.currentWindow, and items are moved by calls on the bot.
function adapterBot({ opens = true, ignoredClicks = 0 } = {}) {
    const calls = [];
    let clicks = 0;
    const bot = {
        currentWindow: null,
        openContainer(block) {
            calls.push(['click', block.name]);
            // The server ignores the first few clicks when told to: they named the block as it no longer is.
            if (opens && ++clicks > ignoredClicks) setTimeout(() => { bot.currentWindow = { type: 'minecraft:container', containerItems: () => [] }; }, 20);
        },
        deposit: async (...args) => { calls.push(['deposit', ...args]); },
        withdraw: async (...args) => { calls.push(['withdraw', ...args]); },
        closeWindow(window) { calls.push(['close']); if (bot.currentWindow === window) bot.currentWindow = null; },
    };
    javaShapes(bot);
    return { bot, calls };
}

test('opening a chest hands back the window, with deposit, withdraw and close on it', async () => {
    const { bot, calls } = adapterBot();
    const chest = await bot.openContainer({ name: 'chest' });
    assert.equal(chest, bot.currentWindow);
    assert.equal(typeof chest.containerItems, 'function', 'it is the window the adapter made');
    await chest.deposit(4, null, 3);
    await chest.withdraw(4, null, 1);
    chest.close();
    assert.deepEqual(calls, [['click', 'chest'], ['deposit', 4, null, 3], ['withdraw', 4, null, 1], ['close']]);
    assert.equal(bot.currentWindow, null);
});

test('every way of opening goes through bot.openBlock, so one wrapper sees them all', async () => {
    // World memory wraps bot.openBlock to note what was in a chest. On Java the other two call it.
    const { bot } = adapterBot();
    const seen = [];
    const inner = bot.openBlock;
    bot.openBlock = async block => { seen.push(block.name); return inner(block); };
    await bot.openContainer({ name: 'chest' });
    bot.currentWindow = null;
    await bot.openChest({ name: 'barrel' });
    assert.deepEqual(seen, ['chest', 'barrel']);
});

test('a chest that does not open is an error for the caller who waits', async () => {
    const { bot } = adapterBot({ opens: false });
    await assert.rejects(bot.openContainer({ name: 'chest' }), /chest did not open/);
});

test('a click the server ignored is made once more, a moment later', async () => {
    // As with a barrel opened again straight after it was closed: the first click named it still open.
    const { bot, calls } = adapterBot({ ignoredClicks: 1 });
    const started = Date.now();
    const barrel = await bot.openContainer({ name: 'barrel' });
    assert.equal(barrel, bot.currentWindow);
    assert.deepEqual(calls, [['click', 'barrel'], ['click', 'barrel']]);
    assert.ok(Date.now() - started >= 900, 'not before a window could have come back');
});

test('an open still waiting gives way to a newer one, and never takes its window', async () => {
    const { bot } = adapterBot({ ignoredClicks: 1 });
    const older = bot.openContainer({ name: 'barrel' });
    await delay(100);
    const newer = bot.openContainer({ name: 'barrel' });
    await assert.rejects(older, /Something else was opened while waiting for the barrel/);
    assert.equal(await newer, bot.currentWindow);
});

test('and is not one for a caller who does not wait', async () => {
    // The adapter calls bot.openContainer on a crafting table and watches for the window itself. A failure
    // nobody is listening for would stop the whole process.
    const unheard = [];
    const listener = reason => unheard.push(reason);
    process.on('unhandledRejection', listener);
    try {
        const { bot } = adapterBot({ opens: false });
        bot.openContainer({ name: 'crafting_table' });
        bot.openBlock({ name: 'crafting_table' });
        await delay(5400);
        assert.deepEqual(unheard, []);
    } finally {
        process.off('unhandledRejection', listener);
    }
});

test('a window that already has the calls keeps its own', async () => {
    const { bot } = adapterBot({ opens: false });
    const own = () => 'own';
    setTimeout(() => { bot.currentWindow = { deposit: own, withdraw: own, close: own }; }, 20);
    const window = await bot.openBlock({ name: 'chest' });
    assert.equal(window.deposit, own);
    assert.equal(window.close, own);
});

test('a bot without containers is left alone', () => {
    const bot = {};
    javaShapes(bot);
    assert.deepEqual(Object.keys(bot), []);
});

// ---- Recipes ----

// A bot with the adapter's recipe book: its own form of a recipe, and its own calls.
function recipeBot({ holding = [] } = {}) {
    const items = { oak_log: 1, oak_planks: 2, birch_planks: 3, stick: 4, wooden_pickaxe: 5, crafting_table: 6 };
    const planksFromLog = { id: 900, type: 'shapeless', result: { type: items.oak_planks, count: 4 }, ingredients: [{ name: 'oak_log', id: items.oak_log, count: 1 }], shape: null, requiresTable: false };
    const pickaxe = { id: 901, type: 'shaped', width: 3, height: 3, result: { type: items.wooden_pickaxe, count: 1 }, requiresTable: true,
        ingredients: [{ tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { name: 'stick', id: items.stick, count: 1 }, { name: 'stick', id: items.stick, count: 1 }],
        shape: [{ tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 },
            null, { name: 'stick', id: items.stick, count: 1 }, null,
            null, { name: 'stick', id: items.stick, count: 1 }, null] };
    const book = { [items.oak_planks]: [planksFromLog], [items.wooden_pickaxe]: [pickaxe] };
    const crafted = [];
    const bot = {
        registry: { itemsArray: Object.entries(items).map(([name, id]) => ({ name, id })), itemsByName: Object.fromEntries(Object.entries(items).map(([name, id]) => [name, { id }])) },
        inventory: { items: () => holding.map(name => ({ name, type: items[name], count: 1 })) },
        recipesFor: id => book[id] ?? [],
        recipesAll: id => book[id] ?? [],
        craft: async (recipe, count, table) => { crafted.push([recipe, count, table]); },
    };
    javaShapes(bot);
    return { bot, items, crafted, planksFromLog, pickaxe };
}

test('a recipe without a shape reads as it does on Java: each ingredient once, counted down', () => {
    const { bot, items } = recipeBot();
    const [recipe] = bot.recipesFor(items.oak_planks, null, 1, null);
    assert.deepEqual(recipe.ingredients, [{ id: items.oak_log, metadata: null, count: -1 }]);
    assert.equal(recipe.inShape, null);
    assert.deepEqual(recipe.result, { id: items.oak_planks, metadata: null, count: 4 });
    assert.equal(recipe.requiresTable, false);
});

test('a shaped recipe reads as rows, with -1 for an empty cell', () => {
    const { bot, items } = recipeBot();
    const [recipe] = bot.recipesFor(items.wooden_pickaxe, null, 1, true);
    assert.equal(recipe.ingredients, null);
    assert.deepEqual(recipe.inShape.map(row => row.map(cell => cell.id)), [
        [items.oak_planks, items.oak_planks, items.oak_planks],
        [-1, items.stick, -1],
        [-1, items.stick, -1],
    ]);
    assert.ok(recipe.inShape.flat().every(cell => cell.count === 1));
    assert.equal(recipe.requiresTable, true);
});

test('"any planks" becomes the kind the bot is holding', () => {
    // The skills work out whether the bot holds enough of each ingredient, by name. A recipe that takes
    // any planks has to be counted against the planks that are there.
    const { bot, items } = recipeBot({ holding: ['birch_planks'] });
    const [recipe] = bot.recipesFor(items.wooden_pickaxe, null, 1, true);
    assert.equal(recipe.inShape[0][0].id, items.birch_planks);
});

test("crafting gets the adapter's own recipe back", async () => {
    const { bot, items, crafted, planksFromLog } = recipeBot();
    const [recipe] = bot.recipesFor(items.oak_planks, null, 1, null);
    await bot.craft(recipe, 2, null);
    assert.equal(crafted[0][0], planksFromLog, 'the form with the number the server knows the recipe by');
    assert.equal(crafted[0][1], 2);
    // A recipe that never went through the two calls is passed on untouched.
    await bot.craft(planksFromLog, 1, null);
    assert.equal(crafted[1][0], planksFromLog);
});

test('the game data answers "what makes this item" in the layout it has on Java', () => {
    const { bot, items } = recipeBot();
    assert.deepEqual(recipesLikeGameData(bot, items.oak_planks), [{ ingredients: [items.oak_log], result: { id: items.oak_planks, count: 4 } }]);
    assert.deepEqual(recipesLikeGameData(bot, items.wooden_pickaxe), [{
        inShape: [[items.oak_planks, items.oak_planks, items.oak_planks], [null, items.stick, null], [null, items.stick, null]],
        result: { id: items.wooden_pickaxe, count: 1 },
    }]);
    // Nothing at all for an item with no recipe: the code that asks tells "none" from "an empty list".
    assert.equal(recipesLikeGameData(bot, items.oak_log), undefined);
    assert.equal(recipesLikeGameData(null, items.oak_log), undefined, 'before the bot exists');
});

// ---- Clicks ----

function clickBot() {
    const bot = new EventEmitter();
    const clicks = [];
    bot.activateBlock = async block => { clicks.push(block); return 'clicked'; };
    javaShapes(bot);
    return { bot, clicks };
}

test('a click is done once the world shows what it did', async () => {
    // Tilling, then planting in the next line: the second click must not go out while the bot's copy of
    // the world still shows the block from before the first.
    const { bot } = clickBot();
    const block = { position: new Vec3(1, 63, 2) };
    setTimeout(() => bot.emit('blockUpdate:(1, 63, 2)'), 40);
    const started = Date.now();
    assert.equal(await bot.activateBlock(block), 'clicked');
    const took = Date.now() - started;
    assert.ok(took >= 30 && took < 300, `waited ${took} ms for the change`);
    assert.equal(bot.listenerCount('blockUpdate:(1, 63, 2)'), 0, 'nothing is left listening');
});

test('a click that changes nothing waits a moment and no longer', async () => {
    const { bot } = clickBot();
    const started = Date.now();
    await bot.activateBlock({ position: new Vec3(0, 0, 0) });
    const took = Date.now() - started;
    assert.ok(took >= 300 && took < 900, `waited ${took} ms`);
    assert.equal(bot.listenerCount('blockUpdate:(0, 0, 0)'), 0);
});
