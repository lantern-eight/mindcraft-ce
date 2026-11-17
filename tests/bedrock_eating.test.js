// SPDX-License-Identifier: CC0-1.0
// A Bedrock bot has to eat when it is hungry, as the Java bot does through a plugin that can't be loaded on
// Bedrock. No server; the bot is stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { bedrockEater, foodValues } from '../src/agent/bedrock/eating.js';

// What the bot may hold, with the numbers this pretend server gives the items.
const ITEMS = { bread: 1, cooked_beef: 2, rotten_flesh: 3, apple: 4, iron_pickaxe: 5, cobblestone: 6 };
const itemsByName = Object.fromEntries(Object.entries(ITEMS).map(([name, id]) => [name, { id, name }]));

function hungryBot({ holding = [], hand = null, food = 10, health = 20 } = {}) {
    const bot = new EventEmitter();
    const stacks = holding.map(name => ({ name, type: ITEMS[name], count: 1 }));
    const did = [];
    bot.registry = { itemsByName };
    bot.food = food;
    bot.health = health;
    bot.heldItem = hand ? stacks.find(item => item.name === hand) : null;
    bot.currentWindow = null;
    bot.isSleeping = false;
    bot.inventory = { items: () => stacks };
    bot.equip = async item => { did.push(`equip ${item.name}`); bot.heldItem = item; };
    bot.consume = async () => {
        did.push(`eat ${bot.heldItem.name}`);
        stacks.splice(stacks.indexOf(bot.heldItem), 1);
        bot.food = 20;
    };
    bot.deactivateItem = () => did.push('stop');
    // Quiet: what the eater says is watched in the tests at the end, which hand it a log of their own.
    return { bot, did, eater: bedrockEater(bot, { log: () => {} }) };
}

test('what is food, and how filling, comes from the Java game data, for the items this server has', () => {
    // The Bedrock game data has no table of foods. What a food is worth is the same in both editions.
    const foods = foodValues(itemsByName);
    assert.equal(foods.bread.foodPoints, 5);
    assert.equal(foods.cooked_beef.foodPoints, 8);
    assert.equal(foods.iron_pickaxe, undefined);
    assert.equal(foods.golden_carrot, undefined, 'a food this server has no item for is left out');
    assert.deepEqual(foodValues(undefined), {});
});

test('a hungry bot eats the most filling food it holds, then holds what it held before', async () => {
    const { bot, did, eater } = hungryBot({ holding: ['iron_pickaxe', 'bread', 'cooked_beef'], hand: 'iron_pickaxe' });
    await eater.check();
    assert.deepEqual(did, ['equip cooked_beef', 'eat cooked_beef', 'equip iron_pickaxe']);
    assert.equal(bot.heldItem.name, 'iron_pickaxe');
    assert.equal(eater.isEating, false);
});

test('a bot that is not hungry is left alone', async () => {
    const { did, eater } = hungryBot({ holding: ['bread'], food: 18 });
    await eater.check();
    assert.deepEqual(did, []);
});

test('a hurt bot eats before it is hungry, but not on a full stomach', async () => {
    // Health comes back from food, so a hurt bot tops up early. A full stomach takes no food at all.
    const hurt = hungryBot({ holding: ['bread'], food: 17, health: 8 });
    await hurt.eater.check();
    assert.deepEqual(hurt.did, ['equip bread', 'eat bread']);
    const full = hungryBot({ holding: ['bread'], food: 20, health: 8 });
    await full.eater.check();
    assert.deepEqual(full.did, []);
});

test('banned food is never eaten, and the agent can change the list', async () => {
    const { did, eater } = hungryBot({ holding: ['rotten_flesh', 'apple'] });
    await eater.check();
    assert.deepEqual(did, ['equip apple', 'eat apple'], 'rotten flesh is banned to begin with');
    const picky = hungryBot({ holding: ['apple'] });
    picky.eater.setOpts({ bannedFood: ['apple'] });
    await picky.eater.check();
    assert.deepEqual(picky.did, []);
});

test('the hunger at which the bot eats is the agent\'s to set', async () => {
    const { did, eater } = hungryBot({ holding: ['bread'], food: 10 });
    eater.setOpts({ minHunger: 8 });
    await eater.check();
    assert.deepEqual(did, []);
});

test('nothing is eaten with a chest open or in bed', async () => {
    // Changing what the bot holds while a window is open is refused by the server, and a bot can't eat asleep.
    const chest = hungryBot({ holding: ['bread'] });
    chest.bot.currentWindow = { id: 3 };
    await chest.eater.check();
    assert.deepEqual(chest.did, []);
    const bed = hungryBot({ holding: ['bread'] });
    bed.bot.isSleeping = true;
    await bed.eater.check();
    assert.deepEqual(bed.did, []);
});

test('one meal at a time', async () => {
    const { bot, did, eater } = hungryBot({ holding: ['bread', 'apple'] });
    let swallow;
    bot.consume = () => new Promise(resolve => { did.push(`eat ${bot.heldItem.name}`); swallow = resolve; });
    const first = eater.check();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(eater.isEating, true);
    await eater.check(); // the next look, a second later, while still chewing
    swallow();
    await first;
    assert.deepEqual(did, ['equip bread', 'eat bread']);
    assert.equal(eater.isEating, false);
});

test('a meal that goes wrong is not an error, and the bot can try again', async () => {
    const { bot, did, eater } = hungryBot({ holding: ['iron_pickaxe', 'bread'], hand: 'iron_pickaxe' });
    const consume = bot.consume;
    bot.consume = async () => { throw new Error('consume: timed out'); };
    await eater.check();
    assert.equal(eater.isEating, false);
    assert.equal(bot.heldItem.name, 'iron_pickaxe', 'the tool is back in hand');
    bot.consume = consume;
    did.length = 0;
    await eater.check();
    assert.deepEqual(did, ['equip bread', 'eat bread', 'equip iron_pickaxe']);
});

test('the bot looks at its hunger about once a second, and only once it is told to', async () => {
    const { bot, did, eater } = hungryBot({ holding: ['bread'] });
    for (let tick = 0; tick < 40; tick++) bot.emit('physicsTick');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(did, [], 'not before enableAuto');
    eater.enableAuto();
    eater.enableAuto(); // twice is once
    for (let tick = 0; tick < 19; tick++) bot.emit('physicsTick');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(did, []);
    bot.emit('physicsTick');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(did, ['equip bread', 'eat bread']);
    eater.disableAuto();
    assert.equal(bot.listenerCount('physicsTick'), 0);
});

test('cancelEat lets go of the food', async () => {
    const { bot, did, eater } = hungryBot({ holding: ['bread'] });
    bot.consume = () => new Promise(() => {}); // still chewing
    eater.check();
    await new Promise(resolve => setImmediate(resolve));
    eater.cancelEat();
    assert.ok(did.includes('stop'));
    const idle = hungryBot({ holding: ['bread'] });
    idle.eater.cancelEat();
    assert.deepEqual(idle.did, [], 'nothing to let go of');
});

// When a meal fails the bot is still hungry and tries again a second later, so a failure is no error. But it
// has to be told: once, a bot sat at no hunger with its bread untouched for most of a minute, and nothing said
// why.
function watchedBot(options, { noLookMs } = {}) {
    const made = hungryBot(options);
    const said = [];
    let clock = 0;
    const eater = bedrockEater(made.bot, { log: line => said.push(line), now: () => clock, slowMealMs: 5, noLookMs });
    return { ...made, eater, said, wait: ms => { clock += ms; } };
}

test('a meal that fails says which step failed and why, once until the reason changes or time passes', async () => {
    const { bot, eater, said, wait } = watchedBot({ holding: ['bread'] });
    bot.consume = async () => { throw new Error('consume: timed out waiting for completed_using_item'); };
    await eater.check();
    assert.equal(said.length, 1);
    assert.match(said[0], /bread/);
    assert.match(said[0], /eating/);
    assert.match(said[0], /timed out waiting for completed_using_item/);
    wait(1000);
    await eater.check();
    assert.equal(said.length, 1, 'the same failure a second later is not said again');
    bot.equip = async () => { throw new Error('the server refused the slot'); };
    await eater.check();
    assert.equal(said.length, 2, 'a new reason is said at once');
    assert.match(said[1], /taking .*bread.* in hand/);
    wait(30_000);
    await eater.check();
    assert.equal(said.length, 3, 'the same reason again, after a while');
});

test('a meal that hangs says where it is stuck, and the next look still waits for it', async () => {
    const { bot, did, eater, said } = watchedBot({ holding: ['bread'] });
    bot.equip = () => new Promise(() => { did.push('equip bread'); }); // never answers
    eater.check();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(said.length, 1);
    assert.match(said[0], /bread/);
    assert.match(said[0], /taking .*bread.* in hand/);
    assert.equal(eater.isEating, true);
    await eater.check();
    assert.deepEqual(did, ['equip bread'], 'one meal at a time still holds');
});

test('a look at hunger that throws is said, not swallowed', async () => {
    const { bot, eater, said } = watchedBot({ holding: ['bread'] });
    bot.inventory = { items: () => { throw new Error('inventory not ready'); } };
    eater.enableAuto();
    for (let tick = 0; tick < 20; tick++) bot.emit('physicsTick');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(said.length, 1);
    assert.match(said[0], /inventory not ready/);
    eater.disableAuto();
});

test('a meal that goes well says nothing', async () => {
    const { eater, said } = watchedBot({ holding: ['bread'] });
    await eater.check();
    assert.deepEqual(said, []);
});

// Once, a hungry bot sat with its bread untouched for most of a minute, and nothing was said at all: no meal
// was ever started. So every way a look at hunger can pass up a meal says why, now and then.

test('a hungry bot with a window open, or asleep, says why it is not eating, now and then', async () => {
    const { bot, did, eater, said, wait } = watchedBot({ holding: ['bread'], food: 3 });
    bot.currentWindow = { id: 3, type: 'minecraft:chest' };
    await eater.check();
    assert.equal(said.length, 1);
    assert.match(said[0], /hunger 3 of 20/);
    assert.match(said[0], /window is open \(minecraft:chest\)/);
    wait(1000);
    await eater.check();
    assert.equal(said.length, 1, 'not again a second later');
    bot.currentWindow = null;
    bot.isSleeping = true;
    await eater.check();
    assert.equal(said.length, 2, 'another reason is said at once');
    assert.match(said[1], /asleep/);
    bot.isSleeping = false;
    bot.currentWindow = { id: 4 };
    wait(30_000);
    await eater.check();
    assert.equal(said.length, 3, 'the first reason again, after a while');
    assert.match(said[2], /window is open/);
    assert.deepEqual(did, [], 'and nothing was eaten all the while');
});

test('a hungry bot with nothing it may eat says so, naming the food it won\'t eat', async () => {
    const banned = watchedBot({ holding: ['rotten_flesh', 'rotten_flesh', 'iron_pickaxe'] });
    await banned.eater.check();
    assert.equal(banned.said.length, 1);
    assert.match(banned.said[0], /only food it won't eat \(rotten_flesh\)/);
    const empty = watchedBot({ holding: ['cobblestone'] });
    await empty.eater.check();
    assert.match(empty.said[0], /nothing to eat/);
});

test('a hungry bot waiting on a meal that is taking long says what the meal is doing', async () => {
    const { bot, eater, said, wait } = watchedBot({ holding: ['bread'] });
    bot.consume = () => new Promise(() => {}); // the meal never ends
    eater.check();
    await new Promise(resolve => setTimeout(resolve, 20)); // past the stuck-meal line, after its own few milliseconds
    const stuck = said.length;
    assert.equal(stuck, 1);
    wait(2000);
    await eater.check();
    assert.equal(said.length, stuck, 'a meal two seconds old is just a meal');
    wait(5000);
    await eater.check();
    assert.equal(said.length, stuck + 1);
    assert.match(said.at(-1), /a meal is still under way from 7 s ago \(eating bread\)/);
});

test('hunger the bot can\'t read is said, not taken for a full stomach', async () => {
    const { bot, did, eater, said } = watchedBot({ holding: ['bread'] });
    bot.food = undefined;
    await eater.check();
    assert.deepEqual(did, []);
    assert.equal(said.length, 1);
    assert.match(said[0], /hunger reads undefined/);
});

test('a hungry bot whose looks at hunger have stopped says so, with whether physics is on', async () => {
    // The looks come on the game's ticks. When the ticks stop, a timer of its own notices.
    const { bot, eater, said, wait } = watchedBot({ holding: ['bread'], food: 2 }, { noLookMs: 10_000 });
    eater.enableAuto();
    wait(4000);
    eater.noticeNoLooks();
    assert.deepEqual(said, [], 'four seconds without a look is not yet news');
    wait(8000);
    bot.physicsEnabled = false;
    eater.noticeNoLooks();
    assert.equal(said.length, 1);
    assert.match(said[0], /not been looked at for 12 s/);
    assert.match(said[0], /physics is off/);
    eater.disableAuto();
});

test('looks that keep coming, or a bot that is not hungry, say nothing about stopped ticks', async () => {
    const { bot, eater, said, wait } = watchedBot({ holding: [], food: 2 }, { noLookMs: 10_000 });
    eater.enableAuto();
    for (let second = 0; second < 15; second++) {
        wait(1000);
        for (let tick = 0; tick < 20; tick++) bot.emit('physicsTick');
        eater.noticeNoLooks();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(said.every(line => !/looked at/.test(line)), said.join('\n'));
    const full = watchedBot({ holding: ['bread'], food: 20 }, { noLookMs: 10_000 });
    full.eater.enableAuto();
    full.wait(60_000);
    full.eater.noticeNoLooks();
    assert.deepEqual(full.said, []);
    eater.disableAuto();
    full.eater.disableAuto();
});

test('the timer that watches for stopped ticks goes with the eater, and with the bot', () => {
    const { bot, eater } = hungryBot({ holding: ['bread'] });
    eater.enableAuto();
    assert.equal(bot.listenerCount('end'), 1);
    eater.disableAuto();
    assert.equal(bot.listenerCount('end'), 0);
    eater.enableAuto();
    bot.emit('end');
    assert.equal(eater.enabled, false, 'a bot that left stops its eater');
    assert.equal(bot.listenerCount('physicsTick'), 0);
});
