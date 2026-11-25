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
import { fakeChestBot, stack } from './helpers/fake_chest_bot.js';

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
        // The hand-over: the player takes what is thrown, unless they are "Nobody", who never does.
        give: async (b, name, player, n) => {
            gifts.push({ name, player, count: n });
            if (player === 'Nobody') return { thrown: 0, taken: false, problem: 'you don\'t know where Nobody is' };
            let left = n;
            room.pockets = room.pockets.map(s => {
                if (!s || s.name !== name || left <= 0) return s;
                const take = Math.min(left, s.count);
                left -= take;
                return s.count === take ? null : { ...s, count: s.count - take };
            });
            return { thrown: n, taken: true };
        },
    },
});
const gifts = [];
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

test('putting away keeps out of a chest that is for something else, and out of the inbox', async () => {
    // The bot's own chest is for tools now, and the shared one is the inbox: the dirt it picks up has
    // nowhere it may go, so it stays in the bag and is named.
    assert.match(await during('Alice', '!chestFor', 0, 64, 0, 'tools'), /For tools/);
    assert.match(await during('Alice', '!chestFor', 4, 64, 0, 'inbox'), /The inbox/);
    const free = room.pockets.findIndex(s => !s);
    room.pockets[free] = stack('dirt x20');
    const before = { own: room.contents('0,64,0'), inbox: room.contents('4,64,0') };
    const text = await during('Alice', '!putAway', 'dirt', 'any', 16);
    assert.match(text, /Still carrying, with no room for it in the chests you may use: dirt 20/);
    assert.deepEqual(room.contents('0,64,0'), before.own, 'the tools chest took no dirt');
    assert.deepEqual(room.contents('4,64,0'), before.inbox, 'nor did the inbox');
    assert.equal(count(room.pockets, 'dirt'), 20);
    room.pockets[free] = null;
    // Said to be for anything again, the bot's own chest takes it.
    await during('Alice', '!chestFor', 0, 64, 0, 'anything');
    room.pockets[free] = stack('dirt x20');
    assert.match(await during('Alice', '!putAway', 'dirt', 'any', 16), /^Put away dirt 20 in 1 chest:\n- chest at 0, 64, 0 \(your own\)/);
});

test('filing the inbox: what players left there goes where it belongs, and the bot keeps its own things', async () => {
    // The shared chest is still the inbox. Someone drops logs and gold in it.
    room.chests.set('4,64,0', row(27, ['oak_log x10', 'gold_ingot x3']).map(stack));
    const bagBefore = room.pockets.map(s => (s ? `${s.name} ${s.count}` : null));
    const text = await during('Alice', '!fileInbox', 'any', 16);
    assert.match(text, /^Filed oak_log 10, gold_ingot 3 from the inbox \(chest at 4, 64, 0\) into 1 chest:\n- chest at 0, 64, 0 \(your own\): /);
    assert.deepEqual(room.contents('4,64,0').filter(Boolean), [], 'the inbox is empty');
    assert.deepEqual(room.pockets.map(s => (s ? `${s.name} ${s.count}` : null)), bagBefore, 'the bot carries what it did before');
    assert.match(await during('Alice', '!fileInbox', 'any', 16), /^The inbox \(chest at 4, 64, 0\) is empty: nothing to file\.$/);
    // No inbox at all: the bot is told how one is named.
    await during('Alice', '!chestFor', 4, 64, 0, 'unknown');
    assert.match(await during('Alice', '!fileInbox', 'any', 16), /^You know no inbox within 16 blocks\. A player can name the chest they leave things in with !chestFor/);
});

test('bringing a player something: what the bot carries first, the rest fetched, then handed over', async () => {
    const carried = () => count(room.pockets, 'iron_ingot');
    assert.equal(carried(), 12, 'the iron fetched earlier is still carried');
    const before = count(room.contents('2,64,0'), 'iron_ingot');
    const text = await during('Alice', '!bringItem', 'Alice', 'iron_ingot', 15);
    assert.match(text, /^Took 3 iron_ingot:\n- 3 from the chest at 2, 64, 0 \(Alice's\)/, text);
    assert.doesNotMatch(text, /!givePlayer/, 'the advice to hand it over is not given: it was handed over');
    assert.match(text, /Gave 15 iron_ingot to Alice\.$/);
    assert.deepEqual(gifts.at(-1), { name: 'iron_ingot', player: 'Alice', count: 15 });
    assert.equal(carried(), 0);
    assert.equal(count(room.contents('2,64,0'), 'iron_ingot'), before - 3);
});

test('bringing: to itself is refused, and a hand-over nobody takes says what the bot still carries', async () => {
    assert.match(await during('Alice', '!bringItem', 'Keeper', 'bread', 1), /can't bring things to yourself/);
    const text = await during('Alice', '!bringItem', 'Nobody', 'bread', 2);
    assert.match(text, /^Could not hand it to Nobody: .*\. You carry 6 bread\.$/, text);
    assert.equal(count(room.pockets, 'bread'), 6);
});
