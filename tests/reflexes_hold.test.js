// SPDX-License-Identifier: CC0-1.0
// The hold a reflex sets before an action that must not be stopped part way (src/agent/action_hold.js):
// lower reflexes are turned down and not even run, anything else waits, and the hold always ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionManager } from '../src/agent/action_manager.js';
import { holdActions, heldFrom } from '../src/agent/action_hold.js';
import { initModes } from '../src/agent/modes.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeAgent() {
    const agent = {
        bot: { output: '', emit: () => {} },
        clearBotLogs() {}, requestInterrupt() {},
        self_prompter: { isActive: () => false, stopLoop() {} },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    return agent;
}
const reflexAndAbove = label => ['mode:creeper_safety', 'mode:self_preservation'].includes(label);

// A back-off that runs until told to end, and says whether something stopped it.
function backOff(agent) {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const result = agent.actions.runAction('mode:creeper_safety', () => done);
    return { finish, result };
}

test('the race: a lower reflex that asks to start after the hold is set is turned down, and the back-off runs on', async () => {
    const agent = makeAgent();
    // The lower reflex asks first, in the same round, but reaches the front of the line after the hold.
    const lower = agent.actions.runAction('mode:self_defense', async () => 'fought');
    const hold = holdActions(agent, { lets: reflexAndAbove, reason: 'backing off from a creeper' });
    const back = backOff(agent);
    const refused = await lower;
    assert.equal(refused.success, false);
    assert.equal(refused.interrupted, true, 'a reflex turned down tells nobody');
    assert.match(refused.text, /self_defense was not started: backing off from a creeper/);
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:creeper_safety');
    // Asked again in the middle of the back-off, still turned down, and the back-off isn't stopped.
    const again = await agent.actions.runAction('mode:self_defense', async () => 'fought');
    assert.equal(again.success, false);
    back.finish(true);
    assert.equal((await back.result).interrupted, false);
    hold.release();
});

test('a command from the model during a back-off waits for it, then runs', async () => {
    const agent = makeAgent();
    const hold = holdActions(agent, { lets: reflexAndAbove, reason: 'backing off from a creeper' });
    const back = backOff(agent);
    await delay(10);
    const order = [];
    const command = agent.actions.runAction('action:goToPlayer', async () => { order.push('command'); });
    await delay(50);
    assert.equal(agent.actions.currentActionLabel, 'mode:creeper_safety', 'the command waits');
    order.push('back-off done');
    back.finish(true);
    assert.equal((await back.result).interrupted, false, 'nothing stopped the back-off');
    hold.release(30);
    await delay(10);
    assert.deepEqual(order, ['back-off done'], 'it waits out the time after, too');
    const ran = await command;
    assert.equal(ran.success, true);
    assert.deepEqual(order, ['back-off done', 'command']);
});

test('a command already in line when the hold begins is turned down with the reason', async () => {
    const agent = makeAgent();
    let finishFirst;
    agent.actions.runAction('action:collectBlocks', () => new Promise(resolve => { finishFirst = resolve; }));
    await delay(5);
    const command = agent.actions.runAction('action:goToPlayer', async () => 'went');
    const hold = holdActions(agent, { lets: reflexAndAbove, reason: 'backing off from a creeper' });
    const refused = await command;
    assert.equal(refused.success, false);
    assert.equal(refused.interrupted, false, 'the model is told');
    assert.match(refused.text, /goToPlayer was not started: backing off from a creeper\. Try again/);
    finishFirst();
    hold.release();
});

test('a reflex more urgent than the holder still starts', async () => {
    const agent = makeAgent();
    const hold = holdActions(agent, { lets: reflexAndAbove, reason: 'backing off' });
    const ran = await agent.actions.runAction('mode:self_preservation', async () => true);
    assert.equal(ran.success, true);
    hold.release();
});

test('the hold ends on its own after its longest time', async () => {
    const agent = makeAgent();
    holdActions(agent, { lets: () => false, reason: 'stuck', maxMs: 40 });
    assert.equal(heldFrom(agent, 'action:x'), 'stuck');
    const started = Date.now();
    const ran = await agent.actions.runAction('action:x', async () => true);
    assert.equal(ran.success, true);
    assert.ok(Date.now() - started < 1000);
    assert.equal(heldFrom(agent, 'action:x'), null);
});

test('every reflex below the holder is skipped while it holds, and runs again after', async () => {
    const agent = makeAgent();
    agent.task = null;
    agent.prompter = { getInitModes: () => null };
    initModes(agent);
    const ran = [];
    // Watch which built-in reflexes are asked, without letting them act.
    const names = Object.keys(agent.bot.modes.getJson());
    for (const name of names) agent.bot.modes.setOn(name, false);
    for (const name of ['self_preservation', 'unstuck', 'self_defense', 'hunting', 'idle_staring']) agent.bot.modes.setOn(name, true);
    const { registerMode } = await import('../src/agent/modes.js');
    for (const name of ['self_preservation', 'unstuck', 'self_defense', 'hunting', 'idle_staring']) {
        registerMode({ name, description: name, interrupts: ['all'], on: true, update() { ran.push(name); } },
            { before: names[names.indexOf(name) + 1] });
    }
    const hold = holdActions(agent, { lets: label => label === 'mode:self_preservation', reason: 'backing off' });
    await agent.bot.modes.update();
    assert.deepEqual(ran, ['self_preservation']);
    hold.release();
    ran.length = 0;
    await agent.bot.modes.update();
    assert.deepEqual(ran, ['self_preservation', 'unstuck', 'self_defense', 'hunting', 'idle_staring']);
});
