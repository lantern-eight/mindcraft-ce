// SPDX-License-Identifier: CC0-1.0
// On Bedrock, what the bot hands back has to have the shape it has on Java, because the skills are written
// against that: an opened chest with deposit, withdraw and close on it, a recipe laid out the way
// mineflayer and the game data lay one out there, a click on a block that can be followed by another
// straight away, and a villager's trade window. No server; the adapter is stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';
import { javaShapes, keepOpensHeard, recipesLikeGameData, stepToTheMiddle } from '../src/agent/bedrock/java_shapes.js';

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

test('an open still waiting gives way to a newer one, and never takes its window', async () => {
    // The server ignored the first click; the second, a moment later, opens the barrel.
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

test('nor once other code has wrapped the opens again, as the action guard does', async () => {
    // A wrapper added later hands out a promise of its own. The adapter doesn't wait for that one either,
    // so a furnace that never opened stopped the whole bot.
    const unheard = [];
    const listener = reason => unheard.push(reason);
    process.on('unhandledRejection', listener);
    try {
        const { bot } = adapterBot({ opens: false });
        const open = bot.openContainer;
        bot.openContainer = async function (...args) { return await open.apply(this, args); };
        keepOpensHeard(bot);
        bot.openContainer({ name: 'furnace' });
        await assert.rejects(bot.openContainer({ name: 'furnace' }), /furnace did not open/, 'a caller who waits still hears it');
        await delay(300);
        assert.deepEqual(unheard, []);
    } finally {
        process.off('unhandledRejection', listener);
    }
});

test('a barrel\'s window takes and puts with the adapter\'s calls, as a chest\'s does', async () => {
    // The adapter names a barrel's slots as Bedrock names them, so nothing here has to.
    const { bot, calls } = adapterBot({ opens: false });
    setTimeout(() => { bot.currentWindow = { inventoryStart: 27, position: { x: 7, y: 0, z: 0 }, slots: [] }; }, 20);
    const barrel = await bot.openBlock({ name: 'barrel' });
    await barrel.withdraw(9, null, 10);
    await barrel.deposit(9, null, 4);
    assert.deepEqual(calls.slice(-2), [['withdraw', 9, null, 10], ['deposit', 9, null, 4]]);
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
function recipeBot({ holding = [], more = () => ({}) } = {}) {
    const items = { oak_log: 1, oak_planks: 2, birch_planks: 3, stick: 4, wooden_pickaxe: 5, crafting_table: 6 };
    const planksFromLog = { id: 900, type: 'shapeless', result: { type: items.oak_planks, count: 4 }, ingredients: [{ name: 'oak_log', id: items.oak_log, count: 1 }], shape: null, requiresTable: false };
    const pickaxe = { id: 901, type: 'shaped', width: 3, height: 3, result: { type: items.wooden_pickaxe, count: 1 }, requiresTable: true,
        ingredients: [{ tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { name: 'stick', id: items.stick, count: 1 }, { name: 'stick', id: items.stick, count: 1 }],
        shape: [{ tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 },
            null, { name: 'stick', id: items.stick, count: 1 }, null,
            null, { name: 'stick', id: items.stick, count: 1 }, null] };
    const book = { [items.oak_planks]: [planksFromLog], [items.wooden_pickaxe]: [pickaxe], ...more(items) };
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
    const { bot, items } = recipeBot({ holding: ['oak_log'] });
    const [recipe] = bot.recipesFor(items.oak_planks, null, 1, null);
    assert.deepEqual(recipe.ingredients, [{ id: items.oak_log, metadata: null, count: -1 }]);
    assert.equal(recipe.inShape, null);
    assert.deepEqual(recipe.result, { id: items.oak_planks, metadata: null, count: 4 });
    assert.equal(recipe.requiresTable, false);
});

test('a shaped recipe reads as rows, with -1 for an empty cell', () => {
    const { bot, items } = recipeBot({ holding: ['oak_planks', 'oak_planks', 'oak_planks', 'stick', 'stick'] });
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
    const { bot, items } = recipeBot({ holding: ['birch_planks', 'birch_planks', 'oak_planks', 'stick', 'stick'] });
    const [recipe] = bot.recipesFor(items.wooden_pickaxe, null, 1, true);
    assert.equal(recipe.inShape[0][0].id, items.birch_planks);
});

test("crafting gets the adapter's own recipe back", async () => {
    const { bot, items, crafted, planksFromLog } = recipeBot({ holding: ['oak_log'] });
    const [recipe] = bot.recipesFor(items.oak_planks, null, 1, null);
    await bot.craft(recipe, 2, null);
    assert.equal(crafted[0][0], planksFromLog, 'the form with the number the server knows the recipe by');
    assert.equal(crafted[0][1], 2);
    // A recipe that never went through the two calls is passed on untouched.
    await bot.craft(planksFromLog, 1, null);
    assert.equal(crafted[1][0], planksFromLog);
});

test('only recipes the bot holds every ingredient of are handed out, as on Java', () => {
    // The server lists a stick from "bamboo:0" first, a name the adapter finds no item for, and the adapter
    // let it through for a bot with planks and no bamboo.
    const sticks = items => ({ [items.stick]: [
        { id: 910, type: 'shaped', width: 1, height: 2, result: { type: items.stick, count: 4 }, requiresTable: false,
            ingredients: [{ name: 'bamboo:0', count: 1 }, { name: 'bamboo:0', count: 1 }], shape: null },
        { id: 911, type: 'shaped', width: 1, height: 2, result: { type: items.stick, count: 4 }, requiresTable: false,
            ingredients: [{ tag: 'minecraft:planks', count: 1 }, { tag: 'minecraft:planks', count: 1 }], shape: null },
    ] });
    const { bot, items } = recipeBot({ holding: ['oak_planks', 'birch_planks'], more: sticks });
    const found = bot.recipesFor(items.stick, null, 1, null);
    assert.equal(found.length, 1, 'the bamboo one is left out');
    assert.deepEqual(found[0].ingredients.map(cell => cell.id), [items.oak_planks, items.oak_planks], 'the planks one is handed out');
    assert.equal(bot.recipesAll(items.stick).length, 2, 'recipesAll still lists every recipe');
    // One plank is not enough for a recipe that takes two.
    const short = recipeBot({ holding: ['oak_planks'], more: sticks });
    assert.deepEqual(short.bot.recipesFor(short.items.stick, null, 1, null), []);
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

// A bot whose villagers open as the adapter opens them: a trade window comes when the villager sends its
// trade list, and when none comes the adapter hands back nothing. The window closes itself.
function tradingBot() {
    const closed = [];
    const bot = {
        tradeWindow: null,
        closed,
        inventory: { slots: [] },
        openVillager: async villager => {
            bot.tradeWindow = villager.trades
                ? { id: 7, type: 'trading', trades: villager.trades, close() { closed.push(this.id); } }
                : null;
            return bot.tradeWindow;
        },
        traded: 0,
        trade: async () => { bot.traded++; },
    };
    javaShapes(bot);
    return bot;
}

test('a trade window\'s slots are the bot\'s own, where the trading skill counts what it can pay with', async () => {
    const bot = tradingBot();
    const window = await bot.openVillager({ id: 1, trades: [{ inputItem1: { name: 'paper', count: 24 } }] });
    assert.equal(window.trades.length, 1);
    bot.inventory.slots = [null, { name: 'paper', count: 30 }];
    assert.deepEqual(window.slots, bot.inventory.slots, 'read when asked, so it is never out of date');
});

test('a villager that opens no trade window is an error, as on Java', async () => {
    const bot = tradingBot();
    await bot.openVillager({ id: 1, trades: [{ inputItem1: { name: 'paper', count: 24 } }] });
    await assert.rejects(bot.openVillager({ id: 2 }), /no trade window/);
});

test('a trade window keeps the adapter\'s own close()', async () => {
    const bot = tradingBot();
    const window = await bot.openVillager({ id: 1, trades: [{ inputItem1: { name: 'paper', count: 24 } }] });
    window.close();
    assert.deepEqual(bot.closed, [7]);
});

test('a trade goes to the adapter\'s own trade', async () => {
    const bot = tradingBot();
    const window = await bot.openVillager({ id: 1, trades: [{ inputItem1: { name: 'paper', count: 24 } }] });
    await bot.trade(window, 0, 1);
    assert.equal(bot.traded, 1);
});

// A world as the adapter's: getBiome answers with a biome object (prismarine-biome), where Java's answers
// with the biome's number, which Mindcraft and world memory look up in the game data.
function biomeWorld(id) {
    return { getBiome: () => ({ id, name: 'whatever the table says' }) };
}

test('a biome is read as its number, as on Java', () => {
    const bot = { world: biomeWorld(1) };
    javaShapes(bot);
    assert.equal(bot.world.getBiome(new Vec3(0, 64, 0)), 1);
});

test('a world the adapter puts in place later (a new dimension) also answers with numbers', () => {
    const bot = { world: biomeWorld(1) };
    javaShapes(bot);
    bot.world = biomeWorld(8);
    assert.equal(bot.world.getBiome(new Vec3(0, 64, 0)), 8);
    bot.world = biomeWorld(8);
    const world = bot.world;
    bot.world = world; // the same world again is not wrapped twice
    assert.equal(bot.world.getBiome(new Vec3(0, 64, 0)), 8);
});

test('a world that already answers with a number, or has no answer, is left as it is', () => {
    const bot = { world: { getBiome: () => 3 } };
    javaShapes(bot);
    assert.equal(bot.world.getBiome(new Vec3(0, 64, 0)), 3);
    const unloaded = { world: { getBiome: () => null } };
    javaShapes(unloaded);
    assert.equal(unloaded.world.getBiome(new Vec3(0, 64, 0)), null);
});

// A bot that walks, with the adapter's physics in small: forward pushes it the way it faces each tick, less
// while sneaking, and it slows by friction, so a step carries it on a little after it lets go. Ticks come
// every few milliseconds. Its dig only records what it was asked to dig, and where the bot stood.
function walkerBot({ at = [0.8, 64, 0.5], ground = 'block', ticking = true } = {}) {
    const bot = new EventEmitter();
    bot.entity = { position: new Vec3(...at), yaw: 1.2, pitch: -0.3, onGround: true, velocity: new Vec3(0, 0, 0) };
    const controls = {};
    const dug = [];
    bot.setControlState = (name, on) => { controls[name] = on; };
    bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
    bot.blockAt = position => ({ position, boundingBox: ground });
    bot.dig = async block => { dug.push({ cell: block.position.toString(), stoodAt: bot.entity.position.clone() }); };
    bot.pathfinder = { isMining: () => false };
    // The adapter puts a new position on the bot each tick rather than changing the one it has.
    const tick = () => {
        const v = bot.entity.velocity;
        if (controls.forward) {
            const push = controls.sneak ? 0.03 : 0.1;
            v.x += -Math.sin(bot.entity.yaw) * push;
            v.z += -Math.cos(bot.entity.yaw) * push;
        }
        bot.entity.position = bot.entity.position.offset(v.x, 0, v.z);
        v.x *= 0.546; v.z *= 0.546;
        bot.emit('physicsTick');
    };
    const timer = ticking ? setInterval(tick, 2) : null;
    javaShapes(bot);
    const under = () => bot.entity.position.offset(0, -0.01, 0).floored();
    return { bot, controls, dug, under, stop: () => clearInterval(timer) };
}

const offMiddle = position => Math.max(Math.abs(position.x - Math.floor(position.x) - 0.5), Math.abs(position.z - Math.floor(position.z) - 0.5));

test('digging the block under its feet, a bot off the middle of its block first steps to the middle', async () => {
    // Java's pathfinder leaves a bot in the middle of its block, which a Bedrock server refuses, and digDown
    // counts on it: a bot off the middle stands partly on the next block and doesn't drop into the hole.
    for (const at of [[0.8, 64, 0.5], [0.18, 64, 0.82], [-3.2, 70, 5.15]]) {
        const { bot, controls, dug, under, stop } = walkerBot({ at });
        try {
            const below = under();
            await bot.dig({ position: below });
            assert.equal(dug.length, 1);
            assert.equal(dug[0].cell, below.toString(), 'the block asked for is dug');
            assert.ok(offMiddle(dug[0].stoodAt) <= 0.2, `${at}: dug standing ${offMiddle(dug[0].stoodAt).toFixed(2)} off the middle`);
            assert.equal(dug[0].stoodAt.floored().toString(), new Vec3(...at).floored().toString(), 'in the block it stood in');
            assert.equal(controls.forward, false);
            assert.equal(controls.sneak, false);
            assert.equal(bot.entity.yaw, 1.2, 'looking where it looked before');
        } finally { stop(); }
    }
});

test('digging anything else, or near enough the middle, or with no ground there, the bot stays put', async () => {
    const beside = walkerBot();
    await beside.bot.dig({ position: beside.under().offset(1, 0, 0) });
    beside.stop();
    assert.deepEqual(beside.controls, {}, 'the block beside it');
    // Java leaves a bot within 0.2 of the middle alone: its box is then inside its own block.
    const near = walkerBot({ at: [0.65, 64, 0.4] });
    await near.bot.dig({ position: near.under() });
    near.stop();
    assert.deepEqual(near.controls, {});
    assert.equal(near.dug[0].stoodAt.x, 0.65);
    // A bot held up by the next block, over nothing: the middle of its own block would drop it.
    const ledge = walkerBot({ ground: 'empty' });
    await ledge.bot.dig({ position: ledge.under() });
    ledge.stop();
    assert.deepEqual(ledge.controls, {});
});

test('the pathfinder digging its own way down is left to itself', async () => {
    const { bot, controls, dug, under, stop } = walkerBot();
    bot.pathfinder.isMining = () => true;
    await bot.dig({ position: under() });
    stop();
    assert.deepEqual(controls, {});
    assert.equal(dug.length, 1);
});

test('the steps wait for the server\'s word on where the bot is, and step again when it moves the bot off', async () => {
    const { bot, controls, stop } = walkerBot({ at: [0.5, 64, 0.5] });
    try {
        await new Promise(resolve => setTimeout(resolve, 30));
        // The server puts the bot a third of a block off, as it does a moment after a walk.
        bot.entity.position = new Vec3(0.83, 64, 0.5);
        const started = Date.now();
        let moved = false;
        const watch = setInterval(() => {
            // And once more, after the first steps, as a server that disagreed with them would.
            if (!moved && controls.forward === false && offMiddle(bot.entity.position) < 0.1 && Date.now() - started > 60) {
                moved = true;
                bot.entity.position = new Vec3(0.2, 64, 0.5);
            }
        }, 5);
        assert.equal(await stepToTheMiddle(bot, { settleMs: 40 }), true);
        clearInterval(watch);
        assert.ok(Date.now() - started >= 40, 'it waited for the bot to stand still first');
        assert.ok(moved, 'the server moved it off once');
        assert.ok(offMiddle(bot.entity.position) <= 0.2, `ended ${offMiddle(bot.entity.position).toFixed(2)} off the middle`);
    } finally { stop(); }
});

test('with no ticks coming, the steps give up in time and let go of the controls', async () => {
    const { bot, controls } = walkerBot({ ticking: false });
    assert.equal(await stepToTheMiddle(bot, { settleMs: 0, timeoutMs: 60 }), false);
    assert.equal(controls.forward, false);
    assert.equal(controls.sneak, false);
});

// The adapter lets go of every key by writing its own table; on Java each goes through setControlState, which
// the agent wraps so that a stopped action can't touch the keys of the one after it.
test('letting go of every key goes through setControlState, so a wrapper of it sees each key', () => {
    const pressed = { forward: true, back: false, left: false, right: false, jump: false, sprint: true, sneak: false };
    const bot = {
        setControlState(key, state) { pressed[key] = state; },
        clearControlStates() { for (const key of Object.keys(pressed)) pressed[key] = false; },
        controlState: {},
    };
    for (const key of Object.keys(pressed)) Object.defineProperty(bot.controlState, key, { enumerable: true, get: () => pressed[key] });
    javaShapes(bot);
    // As the agent's guard does once an action is stopped: its key presses are ignored, so must be its letting go.
    const original = bot.setControlState;
    let stopped = true;
    bot.setControlState = (key, state) => { if (!stopped) original(key, state); };
    bot.clearControlStates();
    assert.equal(pressed.forward, true, 'a stopped action let go of nothing');
    assert.equal(pressed.sprint, true);
    stopped = false;
    bot.clearControlStates();
    assert.ok(Object.values(pressed).every(state => state === false), 'the owner lets go of every key');
});
