// SPDX-License-Identifier: CC0-1.0
// On Bedrock, opening a chest has to hand back what it does on Java: the window, with deposit, withdraw
// and close on it. The skills are written against that. No server; the adapter is stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { javaShapes } from '../src/agent/bedrock/java_shapes.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A bot as the Bedrock adapter leaves it: openContainer clicks and hands back nothing, the window turns
// up a moment later as bot.currentWindow, and items are moved by calls on the bot.
function adapterBot({ opens = true } = {}) {
    const calls = [];
    const bot = {
        currentWindow: null,
        openContainer(block) {
            calls.push(['click', block.name]);
            if (opens) setTimeout(() => { bot.currentWindow = { type: 'minecraft:container', containerItems: () => [] }; }, 20);
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
