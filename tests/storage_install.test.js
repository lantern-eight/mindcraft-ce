// SPDX-License-Identifier: CC0-1.0
// Chest sorting as it is installed on an agent: who is behind a request decides what may be sorted,
// and a chest the bot places itself is written down as it is placed.
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
const found = (id, extra = {}) => ({ id, ...posOf(id), also: null, name: 'chest', ...extra });

// One agent for the whole file: commands are registered once for the process, as they are for a bot.
const { bot, room } = fakeChestBot({ chests: {
    '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']), '2,64,0': row(27, ['stone x3', null, 'stone x4']),
} });
const listeners = {};
bot.on = (name, fn) => { (listeners[name] ??= []).push(fn); };
bot.off = (name, fn) => { listeners[name] = (listeners[name] ?? []).filter(listener => listener !== fn); };
bot.emit = (name, ...args) => { for (const fn of [...(listeners[name] ?? [])]) fn(...args); };
const agent = {
    name: 'Sorter', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false },
    // A message here is a piece of the test to run while that message is being handled.
    async handleMessage(source, run) { return run(); },
};
agent.actions = new ActionManager(agent);
const installed = installStorage(agent, {
    config: { chest_sorting: true, host: 'localhost', port: 25565, world_id: 'test' },
    bookDir: mkdtempSync(path.join(tmpdir(), 'chest-install-')),
    deps: {
        nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
        blockAt: (b, pos) => room.blockAt(pos),
        goTo: async (b, chest) => room.goTo(chest),
        inView: () => true,
        hands: { pauseMs: 0, settleMs: 0 },
    },
});
const book = () => installed.book();
const during = (source, command, ...args) => agent.handleMessage(source, () => getCommand(command).perform(agent, ...args));

test('what a player says about a chest is written down with who said it', async () => {
    assert.match(await during('Alice', '!markChest', 0, 64, 0, 'Alice', 'same'), /is now Alice's/);
    assert.equal(book().of(found('0,64,0')).said[0].by, 'Alice');
    assert.match(await during('Bob', '!markChest', 2, 64, 0, 'Bob', 'same'), /is now Bob's/);
});

test('on its own idea the bot leaves other people\'s chests alone, and says that nobody asked', async () => {
    for (const source of ['system', 'Sorter']) {
        assert.match(await during(source, '!sortChests', 'Alice', 8), /- 1 chest of Alice's: nobody asked for this to be sorted\./, source);
        assert.match(await during(source, '!sortChest', 2, 64, 0), /^Nobody asked for the chest at 2, 64, 0 to be sorted/, source);
    }
    assert.equal(room.opens.length, 0, 'no chest was even opened');
    assert.deepEqual(installed.behind(), { asked: null, by: null });
});

test('a player asking is enough, whoever the chest belongs to, and who asked is kept', async () => {
    assert.match(await during('Bob', '!sortChests', 'Alice', 8), /^Sorted 1 chest \(Alice's\) in \d+ moves: 3 stacks are now 2\./);
    assert.equal(book().of(found('0,64,0')).lastSorted.by, 'Bob');
});

test('a chest marked always may be sorted on the bot\'s own idea', async () => {
    await during('Bob', '!markChest', 2, 64, 0, 'same', 'always');
    assert.match(await during('system', '!sortChests', 'approved', 8), /^Sorted 1 chest \(Bob's\) in \d+ moves?: 2 stacks are now 1\./);
});

test('when it cannot tell who asked, it does not refuse', async () => {
    await during('Alice', '!markChest', 0, 64, 0, 'same', 'asked');
    assert.match(await getCommand('!sortChests').perform(agent, 'Alice', 8), /^The chest here \(Alice's\) is already in order/);
});

test('a chest the bot places is written down as it is placed, and one it digs up is forgotten', async () => {
    const placed = x => ({ name: 'chest', position: { x, y: 64, z: 0 }, getProperties: () => ({ facing: 'north', type: 'single' }) });
    bot.output = '';
    await agent.handleMessage('Alice', () => bot.emit('blockPlaced', null, placed(10)));
    assert.equal(book().ownerOf(found('10,64,0')), 'Alice');
    assert.equal(book().sortingOf(found('10,64,0')), 'asked');
    assert.match(bot.output, /^The chest at 10, 64, 0 is noted as Alice's, because you placed it while doing what Alice asked/, 'the result of what the bot is doing says so');

    await agent.handleMessage('system', () => bot.emit('blockPlaced', null, placed(12)));
    assert.equal(book().ownerOf(found('12,64,0')), 'me');
    assert.equal(book().sortingOf(found('12,64,0')), 'always');

    bot.emit('diggingCompleted', { name: 'air', position: { x: 12, y: 64, z: 0 } });
    assert.equal(book().of(found('12,64,0')), null);
    assert.equal(book().dirty, false, 'each change was saved as it happened');
});
