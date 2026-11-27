// SPDX-License-Identifier: CC0-1.0
// The bot's hands on a furnace (smelting/furnace_hands.js): what it counts as gone in, against the pretend
// furnace and against a window shaped as Java's, with the bot's inventory as a part of the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { furnaceHands } from '../src/agent/smelting/furnace_hands.js';
import { fakeFurnaceWorld } from './helpers/fake_furnace.js';

test('fuel put into a furnace with something to smelt catches at once, and still counts as gone in', async () => {
    const w = fakeFurnaceWorld({ inventory: { coal: 3 }, furnaces: [{ at: [3, 64, 0], input: { name: 'sand', count: 8 } }] });
    const hands = furnaceHands(w.bot, { openSettleMs: 0, wait: w.sleep });
    const { furnace } = await hands.open({ position: w.furnaceAt(3, 64, 0).position });
    assert.equal(await furnace.put('fuel', 'coal', 1), 1);
    assert.equal(furnace.slots().fuel, null, 'the slot shows none: it is burning');
    assert.equal(w.bag.coal, 2);
    await furnace.close();
});

test('on a window holding the bot\'s inventory, what left it is read from the window, not the stale bot inventory', async () => {
    // Java: the furnace window's slots 3 on are the bot's inventory, kept up to date while bot.inventory
    // still shows what the bot had when the window opened.
    const slots = [null, null, null, { name: 'coal', count: 5 }, ...Array(35).fill(null)];
    const window = {
        slots, inventoryStart: 3,
        async putFuel(_id, _meta, count) {
            slots[3] = { name: 'coal', count: slots[3].count - count };
            slots[1] = null; // caught at once
        },
    };
    const bot = {
        registry: { itemsByName: { coal: { id: 1 } } },
        inventory: { items: () => [{ name: 'coal', count: 5 }] }, // stale
        currentWindow: null,
        openFurnace: async () => { bot.currentWindow = window; return window; },
        closeWindow: () => { bot.currentWindow = null; },
    };
    const { furnace } = await furnaceHands(bot, { openSettleMs: 0, settleMs: 0 }).open({ position: { x: 0, y: 0, z: 0 } });
    assert.equal(await furnace.put('fuel', 'coal', 2), 2);
});
