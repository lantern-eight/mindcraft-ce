// SPDX-License-Identifier: CC0-1.0
// A module can add a command of its own without editing the built-in lists, and can say whether the
// command is an action (it makes the bot do something) or a question (it only answers).
//
// The difference matters to the agent: when a player's message leads to an action, the bot stops
// prompting itself, so the two do not fight over what the bot does next.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandExists, getCommand, getCommands, isAction, registerCommand } from '../src/agent/commands/index.js';

test('a registered command is found like a built-in one, and a name already taken is refused', () => {
    const command = { name: '!testRegisteredQuestion', description: 'For this test.', perform: () => 'answer' };
    assert.equal(registerCommand(command), true);
    assert.equal(getCommand('!testRegisteredQuestion'), command);
    assert.ok(getCommands().includes(command));
    assert.equal(commandExists('!testRegisteredQuestion'), true);
    assert.equal(registerCommand({ ...command, description: 'A second one of the same name.' }), false);
    assert.equal(getCommand('!testRegisteredQuestion'), command, 'the first one stays');
    assert.throws(() => registerCommand({ name: 'noBang', perform: () => {} }), /name starting with "!"/);
    assert.throws(() => registerCommand({ name: '!noPerform' }), /perform function/);
});

test('a command is an action only when it is registered as one', () => {
    registerCommand({ name: '!testRegisteredQuestion2', description: 'For this test.', perform: () => 'answer' });
    registerCommand({ name: '!testRegisteredAction', description: 'For this test.', perform: () => 'done' }, { action: true });
    assert.equal(isAction('!testRegisteredQuestion2'), false);
    assert.equal(isAction('!testRegisteredAction'), true);
    // The built-in ones are as they were.
    assert.equal(isAction('!goToCoordinates'), true);
    assert.equal(isAction('!inventory'), false);
});
