// SPDX-License-Identifier: CC0-1.0
// Who is behind what the bot is doing: a player who asked, or the bot's own idea?
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWatcher } from '../src/agent/storage/asker.js';

/** An agent whose handling of a message lasts until the test lets it finish. */
function agentWith() {
    const open = [];
    const agent = {
        name: 'Sorter',
        handled: [],
        async handleMessage(source, message) {
            this.handled.push([source, message]);
            await new Promise(resolve => open.push(resolve));
            return `answered ${source}`;
        },
    };
    return { agent, finish: () => open.shift()() };
}
const UNKNOWN = { asked: null, by: null }, OWN_IDEA = { asked: false, by: null };

test('with nothing to go on, who asked is unknown', () => {
    assert.deepEqual(requestWatcher({ name: 'Sorter' }).behind(), UNKNOWN);
});

test('while a player\'s message is being handled, that player is behind what the bot does', async () => {
    const { agent, finish } = agentWith();
    const watcher = requestWatcher(agent);
    assert.deepEqual(watcher.behind(), UNKNOWN);
    const answer = agent.handleMessage('Alice', 'sort my chests');
    assert.deepEqual(watcher.behind(), { asked: true, by: 'Alice' });
    finish();
    assert.equal(await answer, 'answered Alice', 'the agent\'s own handling is passed through untouched');
    assert.deepEqual(agent.handled, [['Alice', 'sort my chests']]);
    assert.deepEqual(watcher.behind(), UNKNOWN);
});

test('while the bot is prompting itself, nobody asked', async () => {
    const { agent, finish } = agentWith();
    const watcher = requestWatcher(agent);
    const own = agent.handleMessage('system', 'keep going');
    assert.deepEqual(watcher.behind(), OWN_IDEA);
    finish(); await own;
    const self = agent.handleMessage('Sorter', 'keep going');
    assert.deepEqual(watcher.behind(), OWN_IDEA);
    finish(); await self;
});

test('a player anywhere in the picture counts as asked: the bot never refuses a player on a guess', async () => {
    const { agent, finish } = agentWith();
    const watcher = requestWatcher(agent);
    const own = agent.handleMessage('system', 'keep going');
    const alice = agent.handleMessage('Alice', '!sortChests("Alice", 8)');
    const bob = agent.handleMessage('Bob', 'hello');
    assert.deepEqual(watcher.behind(), { asked: true, by: 'Bob' }, 'the latest player');
    finish(); await own;
    assert.deepEqual(watcher.behind(), { asked: true, by: 'Bob' });
    finish(); await alice;
    finish(); await bob;
    assert.deepEqual(watcher.behind(), UNKNOWN);
});

test('a task that outlives its message still knows who it is for', () => {
    const agent = { name: 'Sorter', taskAgent: { is_running: true, source: 'Alice' } };
    const watcher = requestWatcher(agent);
    assert.deepEqual(watcher.behind(), { asked: true, by: 'Alice' });
    agent.taskAgent.source = 'system';
    assert.deepEqual(watcher.behind(), OWN_IDEA);
    agent.taskAgent.source = 'Sorter';
    assert.deepEqual(watcher.behind(), OWN_IDEA);
    // A task that has finished says nothing about now, whoever it was for.
    agent.taskAgent = { is_running: false, source: 'system' };
    assert.deepEqual(watcher.behind(), UNKNOWN);
    agent.taskAgent = { is_running: true };
    assert.deepEqual(watcher.behind(), UNKNOWN);
});

test('a player typing a command while the bot is busy on its own idea is still a player asking', async () => {
    const { agent, finish } = agentWith();
    agent.taskAgent = { is_running: true, source: 'system' };
    const watcher = requestWatcher(agent);
    assert.deepEqual(watcher.behind(), OWN_IDEA);
    const typed = agent.handleMessage('Alice', '!sortChest(1, 64, 1)');
    assert.deepEqual(watcher.behind(), { asked: true, by: 'Alice' });
    finish(); await typed;
    assert.deepEqual(watcher.behind(), OWN_IDEA);
});

test('a message whose handling fails is no longer being answered, and stopping puts the agent back as it was', async () => {
    const agent = { name: 'Sorter', async handleMessage() { throw new Error('the model is down'); } };
    const original = agent.handleMessage;
    const watcher = requestWatcher(agent);
    await assert.rejects(agent.handleMessage('Alice', 'hi'), /the model is down/);
    assert.deepEqual(watcher.behind(), UNKNOWN);
    const thrower = { name: 'Sorter', handleMessage() { throw new Error('at once'); } };
    const second = requestWatcher(thrower);
    assert.throws(() => thrower.handleMessage('Alice', 'hi'), /at once/);
    assert.deepEqual(second.behind(), UNKNOWN);
    watcher.stop();
    assert.equal(agent.handleMessage, original);
});
