// SPDX-License-Identifier: CC0-1.0
// !putAway and !fetchItem as they are installed on an agent: which chests they may use follows the chest
// book and who asked, and the results say what went where, what was kept, and what was left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand } from '../src/agent/commands/index.js';
import { installStorage } from '../src/agent/storage/install.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);

// The bot's own chest (0), Alice's (2), a shared one (4) and one nobody has spoken for (6).
const { bot, room } = fakeChestBot({
    chests: {
        '0,64,0': row(27, ['cobblestone x10']), '2,64,0': row(27, ['iron_ingot x20']),
        '4,64,0': row(27, ['iron_ingot x5', 'oak_log x3']), '6,64,0': row(27, ['iron_ingot x30', 'gold_ingot x4']),
    },
    pockets: ['cobblestone x64', 'cobblestone x40', 'oak_log x12', 'bread x6', 'dirt x5'],
    sizes: { iron_pickaxe: 1 },
});
const listeners = {};
bot.on = (name, fn) => { (listeners[name] ??= []).push(fn); };
bot.off = (name, fn) => { listeners[name] = (listeners[name] ?? []).filter(listener => listener !== fn); };
bot.emit = (name, ...args) => { for (const fn of [...(listeners[name] ?? [])]) fn(...args); };
const agent = {
    name: 'Keeper', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false },
    async handleMessage(source, run) { return run(); },
};
agent.actions = new ActionManager(agent);
const installed = installStorage(agent, {
    config: { chest_sorting: true, store_and_fetch: true, host: 'localhost', port: 25565, world_id: 'test' },
    bookDir: mkdtempSync(path.join(tmpdir(), 'stow-install-')),
    deps: {
        nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
        blockAt: (b, pos) => room.blockAt(pos),
        goTo: async (b, chest) => room.goTo(chest),
        inView: () => true,
        hands: { pauseMs: 0, settleMs: 0 },
    },
});
const during = (source, command, ...args) => agent.handleMessage(source, () => getCommand(command).perform(agent, ...args));

test('the commands are added with the setting', async () => {
    assert.ok(installed.commands.includes('!putAway'));
    assert.ok(installed.commands.includes('!fetchItem'));
    await during('Alice', '!markChest', 0, 64, 0, 'Keeper', 'same');
    await during('Alice', '!markChest', 2, 64, 0, 'Alice', 'same');
    await during('Alice', '!markChest', 4, 64, 0, 'shared', 'same');
});

test('putting away everything: the bot\'s own and shared chests only, what it keeps stays, and the unknown chest is named', async () => {
    const before = { alice: room.contents('2,64,0'), unknown: room.contents('6,64,0') };
    const text = await during('Alice', '!putAway', 'all', 'any', 16);
    assert.match(text, /^Put away /);
    assert.match(text, /Kept on you: .*cobblestone 32/);
    assert.match(text, /1 chest with no known owner, not used: 6, 64, 0\. Ask whose it is/);
    assert.equal(count(room.contents('0,64,0'), 'cobblestone'), 10 + 72, 'cobblestone joined the bot\'s own cobblestone');
    assert.equal(count(room.contents('4,64,0'), 'oak_log'), 3 + 12, 'logs joined the logs in the shared chest');
    assert.equal(count(room.pockets, 'bread'), 6, 'food is kept');
    assert.deepEqual(room.contents('2,64,0'), before.alice, 'Alice\'s chest is as it was');
    assert.deepEqual(room.contents('6,64,0'), before.unknown, 'the unknown chest is as it was');
});

test('putting away one item the bot does not carry says so and opens nothing', async () => {
    const opens = room.opens.length;
    assert.equal(await during('Alice', '!putAway', 'diamond', 'any', 16), 'You have no diamond to put away.');
    assert.equal(room.opens.length, opens);
});

test('fetching for a player: own and shared first, then the asker\'s; never the unknown chest, which is named', async () => {
    const text = await during('Alice', '!fetchItem', 'iron_ingot', 12);
    assert.match(text, /^Took 12 iron_ingot:/);
    assert.match(text, /- 5 from the chest at 4, 64, 0 \(shared\)/);
    assert.match(text, /- 7 from the chest at 2, 64, 0 \(Alice's\)/);
    assert.match(text, /hand it over with !givePlayer/);
    assert.equal(count(room.contents('6,64,0'), 'iron_ingot'), 30, 'the unknown chest is untouched');
});

test('on the bot\'s own idea it does not take from a player\'s chest', async () => {
    const text = await during('system', '!fetchItem', 'iron_ingot', 5);
    assert.match(text, /^You know of no iron_ingot in a chest you may take from/);
    assert.equal(count(room.contents('2,64,0'), 'iron_ingot'), 13);
});

test('the setting is on by default, listed for MindServer, and off leaves the commands out', async () => {
    const { default: settings } = await import('../settings.js');
    const { readFileSync } = await import('node:fs');
    const spec = JSON.parse(readFileSync(new URL('../src/mindcraft/public/settings_spec.json', import.meta.url), 'utf8'));
    assert.equal(settings.store_and_fetch, true);
    assert.equal(spec.store_and_fetch?.default, settings.store_and_fetch);
    const other = { name: 'Other', bot: fakeChestBot().bot };
    other.bot.on = () => {};
    const off = installStorage(other, { config: { chest_sorting: true, store_and_fetch: false, host: 'h', port: 1, world_id: 'w2' },
        bookDir: mkdtempSync(path.join(tmpdir(), 'stow-off-')) });
    assert.ok(!off.commands.includes('!putAway'));
});
