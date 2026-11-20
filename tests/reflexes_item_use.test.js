// SPDX-License-Identifier: CC0-1.0
// One owner of the use-item channel: a meal and a raised shield never cut each other short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createItemUse, shareEating, EATING } from '../src/agent/reflexes/item_use.js';
import { bedrockEater } from '../src/agent/bedrock/eating.js';

test('the channel has one owner at a time, and nobody takes it from another', () => {
    const use = createItemUse();
    assert.equal(use.owner(), null);
    assert.equal(use.take('shield'), true);
    assert.equal(use.take('shield'), true, 'taking it again is fine');
    assert.equal(use.take(EATING), false, 'a meal waits for the shield');
    use.release(EATING);
    assert.equal(use.owner(), 'shield', 'only the owner gives it back');
    use.release('shield');
    assert.equal(use.take(EATING), true);
    assert.equal(use.take('shield'), false, 'the shield waits for the meal');
});

test('a meal by the Java plugin takes the channel, and is passed up while the shield has it', async () => {
    // As mineflayer-auto-eat does it: its look at hunger calls this.eat().
    const meals = [];
    let finish;
    const plugin = {
        _eating: false,
        async eat() { meals.push('eat'); await new Promise(resolve => { finish = resolve; }); },
        async statusCheck() { try { await this.eat(); } catch { /* the plugin swallows it */ } },
    };
    const bot = { autoEat: plugin };
    const use = createItemUse();
    assert.equal(shareEating(bot, use), true);
    assert.equal(shareEating(bot, use), true, 'shared once, however often asked');

    use.take('shield');
    await plugin.statusCheck();
    assert.deepEqual(meals, [], 'no meal while the shield is up');
    use.release('shield');

    const meal = plugin.statusCheck();
    await new Promise(setImmediate);
    assert.deepEqual(meals, ['eat']);
    assert.equal(use.owner(), EATING, 'the meal holds the channel');
    assert.equal(use.take('shield'), false, 'the shield waits');
    finish();
    await meal;
    assert.equal(use.owner(), null, 'given back when the meal ends');
});

test('a meal by the Bedrock eater goes through the same channel', async () => {
    const bot = new EventEmitter();
    const bread = { name: 'bread', type: 1, count: 1 };
    bot.registry = { itemsByName: { bread: { id: 1, name: 'bread' } } };
    Object.assign(bot, { food: 10, health: 20, heldItem: null, currentWindow: null, isSleeping: false });
    bot.inventory = { items: () => (bot.food < 20 ? [bread] : []) };
    bot.equip = async item => { bot.heldItem = item; };
    let owner = null;
    bot.consume = async () => { owner = use.owner(); bot.food = 20; };
    bot.autoEat = bedrockEater(bot, { log: () => {} });
    const use = createItemUse();
    shareEating(bot, use);

    use.take('shield');
    await bot.autoEat.check();
    assert.equal(bot.food, 10, 'passed up while the shield is up');
    use.release('shield');
    await bot.autoEat.check();
    assert.equal(bot.food, 20);
    assert.equal(owner, EATING, 'the meal held the channel while it ate');
    assert.equal(use.owner(), null);
});

test('a bot with no eating plugin has nothing to share', () => {
    assert.equal(shareEating({}, createItemUse()), false);
});
