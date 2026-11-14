// SPDX-License-Identifier: CC0-1.0
// What a person or the model sees of chest sorting: which blocks count as a chest to sort, the
// !sortChests command and what it reports, and the `chest_sorting` setting that turns it on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import settings from '../settings.js';
import { ActionManager } from '../src/agent/action_manager.js';
import { getCommand, getCommands, isAction, parseCommandMessage } from '../src/agent/commands/index.js';
import { chestsFrom, isSortable } from '../src/agent/storage/chests.js';
import { sortChestsHere, sortText } from '../src/agent/storage/commands.js';
import { installStorage } from '../src/agent/storage/install.js';
import { fakeChestBot } from './helpers/fake_chest_bot.js';

const row = (size, stacks = []) => Array.from({ length: size }, (_, i) => stacks[i] ?? null);
const block = (name, x, y, z, props = null) => ({ name, position: { x, y, z }, getProperties: () => props });

test('chests, trapped chests and barrels are sorted; other containers are not', () => {
    for (const name of ['chest', 'trapped_chest', 'barrel']) assert.equal(isSortable(name), true, name);
    // An ender chest is one player's own, a hopper empties itself, a furnace is not storage, and a
    // shulker box cannot hold another shulker box, which a sort might try to put in it.
    for (const name of ['ender_chest', 'hopper', 'furnace', 'shulker_box', 'red_shulker_box', 'dispenser', 'stone']) assert.equal(isSortable(name), false, name);
});

test('the two halves of a double chest are one chest, whichever half is seen', () => {
    // A double chest facing west: seen from the front, the half marked left is the southern one.
    const north = block('chest', 4, 70, 0, { facing: 'west', type: 'right' });
    const south = block('chest', 4, 70, 1, { facing: 'west', type: 'left' });
    const single = block('chest', 8, 70, 0, { facing: 'north', type: 'single' });
    const barrel = block('barrel', 9, 70, 0, { facing: 'up' });
    const found = chestsFrom([south, north, single, barrel, block('furnace', 1, 70, 1), null]);
    assert.deepEqual(found, [
        { id: '4,70,0', x: 4, y: 70, z: 0, also: { x: 4, y: 70, z: 1 }, name: 'chest' },
        { id: '8,70,0', x: 8, y: 70, z: 0, also: null, name: 'chest' },
        { id: '9,70,0', x: 9, y: 70, z: 0, also: null, name: 'barrel' },
    ]);
    // Only one half in view: still the same chest, and the hands know where the other half is.
    assert.deepEqual(chestsFrom([south]), [found[0]]);
    assert.deepEqual(chestsFrom([north]), [found[0]]);
    // A remembered block that cannot say how it is turned is taken as a single chest.
    assert.deepEqual(chestsFrom([{ name: 'chest', position: { x: 1, y: 2, z: 3 } }])[0].also, null);
});

const chest = (x, slots, extra = {}) => ({ id: `${x},64,0`, x, y: 64, z: 0, also: null, name: 'chest', slots, ...extra });
const s = (name, count) => ({ name, count, key: name });

test('the report of a sort says what was done and what is in each chest now', () => {
    const report = {
        chests: [chest(0, row(27, [s('iron_pickaxe', 1), s('iron_ingot', 64), s('iron_ingot', 7)])), chest(2, row(27, [s('oak_log', 40)]), { also: { x: 2, y: 64, z: 1 } }), chest(4, row(27))],
        skipped: [], moves: 31, visits: 5, replans: 0, stacksBefore: 12, stacksAfter: 4, carrying: [], done: true,
    };
    assert.equal(sortText(report), [
        'Sorted 3 chests in 31 moves: 12 stacks are now 4.',
        '- chest at 0, 64, 0: tools, minerals (3 of 27 slots used)',
        '- double chest at 2, 64, 0: wood (1 of 27 slots used)',
        '- chest at 4, 64, 0: empty',
    ].join('\n'));
});

test('the report says so when nothing needed moving, when a chest was left out, and when it had to stop', () => {
    const tidy = { chests: [chest(0, row(27, [s('dirt', 3)]))], skipped: [], moves: 0, visits: 0, replans: 0, stacksBefore: 1, stacksAfter: 1, carrying: [], done: true };
    assert.match(sortText(tidy), /^The chest here is already in order\. Nothing was moved\.\n- chest at 0, 64, 0: earth/);

    const leftOut = { ...tidy, moves: 4, skipped: [{ ...chest(6, []), name: 'barrel', reason: 'it did not open' }] };
    assert.match(sortText(leftOut), /^Sorted 1 chest in 4 moves/);
    assert.match(sortText(leftOut), /\n- barrel at 6, 64, 0 was left out: it did not open$/);

    const stopped = { ...tidy, moves: 9, replans: 3, done: false, carrying: [s('oak_log', 64), s('oak_log', 20), s('dirt', 5)] };
    const text = sortText(stopped);
    assert.match(text, /^Stopped before the chest was in order/);
    assert.match(text, /You are still carrying what you took out and could not put back: oak_log 84, dirt 5\./);

    const none = { chests: [], skipped: [{ ...chest(6, []), reason: 'it did not open' }], moves: 0, visits: 0, replans: 0, stacksBefore: 0, stacksAfter: 0, carrying: [], done: false };
    assert.match(sortText(none), /^Could not open the chest here\.\n- chest at 6, 64, 0 was left out: it did not open$/);
});

/** The parts of an agent that an action needs, around a fake bot in a room of chests. */
function agentIn(room, bot) {
    const agent = { name: 'Sorter', bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {}, self_prompter: { isActive: () => false } };
    bot.emit = () => {};
    agent.actions = new ActionManager(agent);
    return agent;
}
const deps = room => ({
    nearestBlocks: () => [...room.chests.keys()].map(id => room.blockAt(Object.fromEntries(id.split(',').map((n, i) => ['xyz'[i], Number(n)])))),
    blockAt: (bot, pos) => room.blockAt(pos),
    goTo: async (bot, chest) => room.goTo(chest),
    hands: { pauseMs: 0 },
});

test('sorting the chests around the bot: found through the bot\'s own senses, sorted, and reported', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']), '2,64,0': row(27, ['oak_log x5', 'dirt x1']) } });
    const result = await sortChestsHere(bot, 8, deps(room));
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Sorted 2 chests in \d+ moves: 5 stacks are now 2\./);
    assert.deepEqual(room.contents('0,64,0').filter(Boolean), [{ name: 'dirt', count: 21 }]);
    assert.deepEqual(room.contents('2,64,0').filter(Boolean), [{ name: 'oak_log', count: 8 }]);

    const nothing = await sortChestsHere(bot, 8, { ...deps(room), nearestBlocks: () => [] });
    assert.equal(nothing.status, 'failed');
    assert.match(nothing.text, /don't see or remember a chest or barrel within 8 blocks/);
});

test('a chest that would not open makes the result partial, and none opening makes it a failure', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['dirt x10', null, 'dirt x10']), '2,64,0': row(27, ['oak_log x5']) } });
    room.blocked.add('2,64,0');
    const partial = await sortChestsHere(bot, 8, deps(room));
    assert.equal(partial.status, 'partial');
    assert.match(partial.text, /chest at 2, 64, 0 was left out/);
    room.blocked.add('0,64,0');
    assert.equal((await sortChestsHere(bot, 8, deps(room))).status, 'failed');
});

test('chest sorting is listed in MindServer\'s settings with the same default, or an agent made there would lose it', () => {
    const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));
    assert.ok(spec.chest_sorting, 'chest_sorting is missing from settings_spec.json');
    assert.equal(spec.chest_sorting.default, settings.chest_sorting);
    assert.equal(settings.chest_sorting, true);
});

test('the setting turns !sortChests on: an action the model can call, run as one action from start to finish', async () => {
    const { bot, room } = fakeChestBot({ chests: { '0,64,0': row(27, ['dirt x10', 'oak_log x3', 'dirt x10']) } });
    const agent = agentIn(room, bot);
    assert.equal(installStorage(agent, { config: { chest_sorting: false } }), null);
    assert.equal(installStorage(agent, { config: {} }), null, 'a config that leaves the key out gets nothing new');
    assert.equal(getCommand('!sortChests'), undefined);

    assert.ok(installStorage(agent, { config: { chest_sorting: true }, deps: deps(room) }));
    const command = getCommand('!sortChests');
    assert.ok(getCommands().includes(command));
    assert.equal(isAction('!sortChests'), true, 'it counts as an action, so asking for it stops the bot talking to itself meanwhile');
    assert.deepEqual(parseCommandMessage('!sortChests(8)'), { commandName: '!sortChests', args: [8] });
    assert.match(parseCommandMessage('!sortChests(200)'), /must be an element of/);

    const said = await command.perform(agent, 8);
    assert.match(said, /^Sorted 1 chest in \d+ moves: 3 stacks are now 2\./);
    const structured = await command.perform.structured(agent, 8);
    assert.equal(structured.status, 'ok');
    assert.match(structured.text, /already in order/);
    assert.equal(agent.actions.executing, false);
});
