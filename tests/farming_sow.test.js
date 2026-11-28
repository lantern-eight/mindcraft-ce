// SPDX-License-Identifier: CC0-1.0
// Making a field, the parts that need no server: what !sowField refuses before it sets off, how the command
// reads, and whose a remembered field is in !recall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCommandMessage, registerCommand } from '../src/agent/commands/index.js';
import { farmingCommands } from '../src/agent/farming/commands.js';
import { ME, SHARED, createFieldBook, fieldOwnerWords } from '../src/agent/farming/field_book.js';
import { sowField } from '../src/agent/farming/sow.js';
import { fieldOwnersOf, setFieldOwners } from '../src/agent/library/field_owners.js';
import { recallText } from '../src/agent/memory/commands.js';
import { openMemory } from '../src/agent/memory/store.js';

// A bot holding these, in slots after the armor (where world.getInventoryCounts looks).
const holding = (...items) => {
    const stacks = items.map(([name, count = 1]) => ({ name, count }));
    return { inventory: { items: () => stacks, slots: [...Array(9).fill(null), ...stacks] } };
};
const book = () => createFieldBook({ scope: 'test/overworld' });

test('!sowField needs a hoe and seeds before it tills anything, and says how to get them', async () => {
    const noHoe = await sowField(holding(['wheat_seeds', 8]), { book: book() });
    assert.equal(noHoe.code, 'no_hoe');
    assert.match(noHoe.text, /!getTool\("hoe", "any"\)/);
    const noSeed = await sowField(holding(['stone_hoe']), { book: book() });
    assert.equal(noSeed.code, 'no_seed');
    assert.match(noSeed.text, /Bare farmland turns back to dirt/);
    const notThat = await sowField(holding(['stone_hoe'], ['wheat_seeds', 8]), { seed: 'carrot', book: book() });
    assert.equal(notThat.code, 'no_seed');
    assert.match(notThat.text, /no carrot to sow/);
    const notASeed = await sowField(holding(['stone_hoe'], ['wheat_seeds', 8]), { seed: 'cobblestone', book: book() });
    assert.equal(notASeed.code, 'bad_args');
    const stems = await sowField(holding(['stone_hoe'], ['melon_seeds', 8]), { seed: 'melon_seeds', book: book() });
    assert.equal(stems.code, 'bad_args', 'a field tilled edge to edge leaves a stem no room for its fruit');
    assert.match(stems.text, /!tendField\("melon_seeds"\)/);
    const onlyStems = await sowField(holding(['stone_hoe'], ['pumpkin_seeds', 8]), { book: book() });
    assert.equal(onlyStems.code, 'no_seed', '"any" never takes stem seed');
});

test('!sowField reads its seed and size', () => {
    for (const { command, action } of farmingCommands({ book })) registerCommand(command, { action });
    assert.deepEqual(parseCommandMessage('!sowField("carrot", 12)'), { commandName: '!sowField', args: ['carrot', 12] });
});

test('whose a remembered field is, in a few words, from the farmland under its crops', () => {
    const b = book();
    const field = { min: { x: 0, y: 65, z: 0 }, max: { x: 2, y: 65, z: 2 } };
    assert.equal(fieldOwnerWords(b, field, 'Andy'), null, 'nobody has said');
    b.mark([{ x: 1, y: 64, z: 1 }], { owner: 'Alice' });
    assert.equal(fieldOwnerWords(b, field, 'Andy'), "Alice's field");
    b.mark([{ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 2 }], { owner: ME });
    assert.equal(fieldOwnerWords(b, field, 'Andy'), 'your field', 'the owner of most of its cells');
    b.mark([{ x: 0, y: 64, z: 1 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 1 }], { owner: SHARED });
    assert.equal(fieldOwnerWords(b, field, 'Andy'), 'a shared field');
    assert.equal(fieldOwnerWords(b, { min: null, max: null }), null);
});

test('!recall names whose a field is when something knows, and nothing otherwise', () => {
    const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'sow-recall-')), scope: 'test/overworld' });
    memory.things.setField(1, 4, 1, 'wheat', { count: 12, ripe: 5, min: { x: 16, y: 64, z: 16 }, max: { x: 19, y: 64, z: 18 } });
    const here = { x: 0.5, y: 64, z: 0.5 };
    assert.match(recallText(memory, here, 'wheat'), /- wheat x12 \(5 ripe when last seen\) near/);
    const said = recallText(memory, here, 'wheat', { ownerOf: field => (field.min.x === 16 ? "Alice's field" : null) });
    assert.match(said, /- wheat x12 \(5 ripe when last seen, Alice's field\) near/);
    const broken = recallText(memory, here, 'wheat', { ownerOf: () => { throw new Error('no book'); } });
    assert.match(broken, /\(5 ripe when last seen\) near/, 'a failing owner lookup says nothing');

    const bot = {};
    assert.equal(fieldOwnersOf(bot)({}), null, 'nothing installed');
    setFieldOwners(bot, () => 'your field');
    assert.equal(fieldOwnersOf(bot)({}), 'your field');
    setFieldOwners(bot, null);
    assert.equal(fieldOwnersOf(bot)({}), null);
});

test('a field command\'s answer reaches the model through the action runner, not only the log', async () => {
    const { EventEmitter } = await import('node:events');
    const { ActionManager } = await import('../src/agent/action_manager.js');
    const { getCommand } = await import('../src/agent/commands/index.js');
    for (const { command, action } of farmingCommands({ book })) registerCommand(command, { action });
    const bot = Object.assign(new EventEmitter(), holding(['wheat_seeds', 4]), { output: '', interrupt_code: false });
    bot.stopDigging = () => {};
    bot.pathfinder = { setGoal() {} };
    bot.clearControlStates = () => {};
    const agent = { name: 'Andy', bot, requestInterrupt: () => {}, clearBotLogs: () => { bot.output = ''; } };
    agent.actions = new ActionManager(agent);
    const said = await getCommand('!sowField').perform(agent, 'any', 4);
    assert.match(String(said), /no hoe to till the ground with/);
});
