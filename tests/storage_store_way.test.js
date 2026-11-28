// SPDX-License-Identifier: CC0-1.0
// Putting things away for another module (library/store_way.js): only into the chests near that are for
// them, by the same rules of whose as !putAway. Farming stores a round's harvest this way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand } from '../src/agent/commands/index.js';
import { installStorage } from '../src/agent/storage/install.js';
import { storerOf } from '../src/agent/library/store_way.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const posOf = id => Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)]));
const count = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0);

// The bot's own chests (0 and 2), a shared one (4) and Alice's (6). The tests run in order on one room:
// commands are registered once for the whole file.
const { bot, room } = fakeChestBot({
    chests: { '0,64,0': row(27), '2,64,0': row(27), '4,64,0': row(27), '6,64,0': row(27) },
    pockets: ['wheat x30', 'wheat_seeds x30', 'carrot x10', 'dirt x5'],
});
bot.on = () => {};
const agent = {
    name: 'Keeper', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false },
    async handleMessage(source, run) { return run(); },
};
agent.actions = new ActionManager(agent);
installStorage(agent, {
    config: { chest_sorting: true, store_and_fetch: true, host: 'localhost', port: 25565, world_id: 'store-way' },
    bookDir: mkdtempSync(path.join(tmpdir(), 'store-way-')),
    deps: {
        nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(posOf(id))),
        blockAt: (b, pos) => room.blockAt(pos),
        goTo: async (b, chest) => room.goTo(chest),
        inView: () => true,
        hands: { pauseMs: 0, settleMs: 0 },
    },
});
const during = (source, command, ...args) => agent.handleMessage(source, () => getCommand(command).perform(agent, ...args));
const store = (...args) => storerOf(bot)(...args);

test('with no chest near that is for it, nothing is opened and nothing is said', async () => {
    await during('Alice', '!markChest', 0, 64, 0, 'Keeper', 'same');
    await during('Alice', '!markChest', 2, 64, 0, 'Keeper', 'same');
    await during('Alice', '!markChest', 4, 64, 0, 'shared', 'same');
    await during('Alice', '!markChest', 6, 64, 0, 'Alice', 'same');
    const opens = room.opens.length;
    const result = await store([{ name: 'wheat', count: 20 }], { whose: 'any', asked: false });
    assert.deepEqual(result, { status: 'none', text: '', stored: 0 }, 'the bot\'s own chests are for anything: nobody said the harvest goes there');
    assert.equal(room.opens.length, opens);
    assert.equal(count(room.pockets, 'wheat'), 30);
});

test('the harvest goes only into the chests that are for it, never one for anything or a player\'s', async () => {
    await during('Alice', '!chestFor', 0, 64, 0, 'plants');
    await during('Alice', '!chestFor', 4, 64, 0, 'food');
    await during('Alice', '!chestFor', 6, 64, 0, 'plants');
    const result = await store([{ name: 'wheat', count: 20 }, { name: 'wheat_seeds', count: 21 }, { name: 'carrot', count: 4 }],
        { whose: 'any', distance: 16, asked: false });
    assert.equal(result.status, 'ok', result.text);
    assert.equal(result.stored, 45);
    assert.match(result.text, /^Put away .* in 2 chests:/);
    assert.equal(count(room.contents('0,64,0'), 'wheat'), 20, 'wheat into the chest for plants');
    assert.equal(count(room.contents('0,64,0'), 'wheat_seeds'), 21, 'and the seed it was given');
    assert.equal(count(room.contents('4,64,0'), 'carrot'), 4, 'carrots are food: into the shared chest for food');
    assert.deepEqual(room.contents('2,64,0').filter(Boolean), [], 'the chest for anything is left alone');
    assert.deepEqual(room.contents('6,64,0').filter(Boolean), [], 'Alice\'s chest is left alone');
    assert.equal(count(room.pockets, 'wheat'), 10, 'only as many as it was given went');
    assert.equal(count(room.pockets, 'wheat_seeds'), 9);
    assert.equal(count(room.pockets, 'dirt'), 5);
});

test('a player\'s chest for it takes their field\'s harvest when a player asked, not on the bot\'s own idea', async () => {
    const unasked = await store([{ name: 'wheat', count: 5 }], { whose: 'Alice', asked: false });
    assert.equal(unasked.status, 'none');
    const asked = await store([{ name: 'wheat', count: 5 }], { whose: 'Alice', asked: true });
    assert.equal(asked.status, 'ok', asked.text);
    assert.match(asked.text, /chest at 6, 64, 0 \(Alice's\): wheat 5/);
    assert.equal(count(room.contents('6,64,0'), 'wheat'), 5);
});
