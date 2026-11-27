// SPDX-License-Identifier: CC0-1.0
// Handing an item to a player (src/agent/storage/hand_over.js), on a fake bot: it walks up, aims chest high,
// throws only what was asked, and says whether the player took it. No game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Vec3 from 'vec3';
import { HAND_OVER_DISTANCE, handOver } from '../src/agent/storage/hand_over.js';

/** A bot with stacks in its bag and Alice standing 6 blocks east. `takes`: whether Alice picks up what is thrown. */
function fakeBot({ stacks, takes = true }) {
    const bot = new EventEmitter();
    bot.entity = { position: new Vec3(0, 64, 0) };
    bot.entities = { 7: { type: 'player', username: 'Alice', position: new Vec3(6, 64, 0) } };
    const bag = stacks.map(([name, count]) => ({ name, count, type: name }));
    bot.inventory = { items: () => bag.filter(s => s.count > 0) };
    bot.looks = [];
    bot.lookAt = async at => { bot.looks.push(at); };
    bot.thrown = [];
    bot.toss = async (type, meta, n) => {
        const stack = bag.find(s => s.name === type && s.count > 0);
        stack.count -= n;
        bot.thrown.push([type, n]);
        if (takes) setTimeout(() => bot.emit('playerCollect', { username: 'Alice' }, {}), 20);
    };
    return bot;
}
const walks = [];
const walk = async (bot, player, distance) => { walks.push([player, distance]); };

test('it walks up close, throws chest high, only as many as asked, and sees them taken', async () => {
    const bot = fakeBot({ stacks: [['iron_ingot', 3], ['iron_ingot', 64], ['bread', 6]] });
    const result = await handOver(bot, 'iron_ingot', 'Alice', 10, { walk, takeMs: 500 });
    assert.deepEqual(result, { thrown: 10, taken: true });
    assert.deepEqual(walks.at(-1), ['Alice', HAND_OVER_DISTANCE]);
    assert.equal(bot.looks[0].y, 65.1, 'aimed at the chest, not the feet');
    assert.deepEqual(bot.thrown, [['iron_ingot', 3], ['iron_ingot', 7]]);
    assert.equal(bot.inventory.items().find(s => s.name === 'bread').count, 6);
});

test('a player it does not know is there gets nothing, and one who never picks it up is said so', async () => {
    const nobody = await handOver(fakeBot({ stacks: [['bread', 6]] }), 'bread', 'Bob', 2, { walk, takeMs: 100 });
    assert.equal(nobody.thrown, 0);
    assert.match(nobody.problem, /don't know where Bob is/);
    const untaken = await handOver(fakeBot({ stacks: [['bread', 6]], takes: false }), 'bread', 'Alice', 2, { walk, takeMs: 100 });
    assert.deepEqual(untaken, { thrown: 2, taken: false });
});

test('a player out of view is looked round for first, as one who fetched something turns back to the asker', async () => {
    // Alice is behind the bot until it has turned: the second look round brings her into view.
    const bot = fakeBot({ stacks: [['iron_ingot', 5]] });
    const alice = bot.entities[7];
    delete bot.entities[7];
    let turns = 0;
    const lookFor = async (b, found) => {
        while (!found() && turns < 8) if (++turns === 2) bot.entities[7] = alice;
    };
    const result = await handOver(bot, 'iron_ingot', 'Alice', 5, { walk, lookFor, takeMs: 500 });
    assert.deepEqual(result, { thrown: 5, taken: true });
    assert.equal(turns, 2, 'it stopped turning once she was in view');
    // Nowhere in view after a whole look round: it says so, and throws nothing.
    const away = fakeBot({ stacks: [['bread', 6]] });
    delete away.entities[7];
    let looked = false;
    const nobody = await handOver(away, 'bread', 'Alice', 2, { walk, lookFor: async () => { looked = true; }, takeMs: 100 });
    assert.ok(looked);
    assert.equal(nobody.thrown, 0);
    assert.match(nobody.problem, /don't know where Alice is/);
});

test('the turn toward the player reaches the server before the throw', async () => {
    // The server throws the way it last heard the bot face; a turn goes out with the next movement packet.
    const bot = fakeBot({ stacks: [['iron_ingot', 5]] });
    const order = [];
    const look = bot.lookAt, toss = bot.toss;
    bot.lookAt = async at => { order.push('turn'); return look(at); };
    bot.waitForTicks = async ticks => { order.push(`wait ${ticks} ticks`); };
    bot.toss = async (...args) => { order.push('throw'); return toss(...args); };
    await handOver(bot, 'iron_ingot', 'Alice', 5, { walk, takeMs: 200 });
    assert.deepEqual(order, ['turn', 'wait 2 ticks', 'throw']);
});
