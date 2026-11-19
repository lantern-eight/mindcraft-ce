// SPDX-License-Identifier: CC0-1.0
// registerMode: a module adds a reflex of its own at a chosen place in the mode list, and it behaves like
// the built-in ones: the profile can name it, !setMode can switch it, and a pause meant for another mode
// doesn't reach it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initModes, registerMode } from '../src/agent/modes.js';
import { getCommand } from '../src/agent/commands/index.js';

function agentWith(profileModes) {
    const agent = {
        task: null, isIdle: () => true, actions: { currentActionLabel: '' },
        prompter: { getInitModes: () => profileModes },
        bot: {},
    };
    initModes(agent);
    return agent;
}

// One agent for the file: the mode list belongs to the process, as it does for a bot.
const calls = [];
const agent = agentWith({ late_reflex: false, cowardice: false });
const mode = name => ({ name, description: `${name} for a test`, interrupts: ['all'], on: true,
    update() { calls.push(name); } });

test('a mode registered after the profile was loaded still takes the profile\'s value', () => {
    registerMode(mode('late_reflex'), { after: 'self_preservation' });
    assert.equal(agent.bot.modes.isOn('late_reflex'), false, 'the profile turned it off');
    registerMode(mode('unnamed_reflex'), { after: 'late_reflex' });
    assert.equal(agent.bot.modes.isOn('unnamed_reflex'), true, 'a profile that doesn\'t name it leaves its own value');
});

test('a mode goes where it is put, and runs in that order', async () => {
    registerMode(mode('first_reflex'), { before: 'self_preservation' });
    registerMode(mode('after_unstuck'), { after: 'unstuck' });
    const names = Object.keys(agent.bot.modes.getJson());
    assert.deepEqual(names.slice(0, 5), ['first_reflex', 'self_preservation', 'late_reflex', 'unnamed_reflex', 'unstuck']);
    assert.equal(names[5], 'after_unstuck');
    // Only these two run here: the others are off or wouldn't fire with nothing around.
    for (const name of names) if (!['first_reflex', 'after_unstuck'].includes(name)) agent.bot.modes.setOn(name, false);
    calls.length = 0;
    await agent.bot.modes.update();
    assert.deepEqual(calls, ['first_reflex', 'after_unstuck']);
    for (const name of names) agent.bot.modes.setOn(name, true);
});

test('registering a name again replaces the mode instead of adding a second', () => {
    const before = Object.keys(agent.bot.modes.getJson()).length;
    registerMode(mode('first_reflex'), { before: 'self_preservation' });
    assert.equal(Object.keys(agent.bot.modes.getJson()).length, before);
});

test('pausing every other mode by name, as !stay does, doesn\'t pause it', async () => {
    const names = Object.keys(agent.bot.modes.getJson());
    for (const name of names) agent.bot.modes.setOn(name, name === 'unnamed_reflex');
    for (const name of names) if (name !== 'unnamed_reflex') agent.bot.modes.pause(name);
    agent.isIdle = () => false; // paused modes are only let go when the agent is idle
    calls.length = 0;
    await agent.bot.modes.update();
    assert.deepEqual(calls, ['unnamed_reflex']);
    agent.isIdle = () => true;
    agent.bot.modes.unPauseAll();
    for (const name of names) agent.bot.modes.setOn(name, true);
});

test('getJson and loadJson include it, and !setMode switches it', async () => {
    assert.equal(agent.bot.modes.getJson().unnamed_reflex, true);
    agent.bot.modes.loadJson({ unnamed_reflex: false });
    assert.equal(agent.bot.modes.getJson().unnamed_reflex, false);
    const setMode = getCommand('!setMode');
    assert.match(await setMode.perform(agent, 'unnamed_reflex', true), /now on/);
    assert.equal(agent.bot.modes.isOn('unnamed_reflex'), true);
    assert.match(await setMode.perform(agent, 'unnamed_reflex', false), /now off/);
    assert.match(agent.bot.modes.getDocs(), /unnamed_reflex\(OFF\): unnamed_reflex for a test/);
});
