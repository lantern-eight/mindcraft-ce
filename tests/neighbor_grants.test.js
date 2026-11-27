// SPDX-License-Identifier: CC0-1.0
// Grants: a player lets the bot break exact protected blocks, by typing it in chat. Never the model, never
// another bot; each block once, for ten minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrants, grantListener, parseGrant } from '../src/agent/neighbor/grants.js';
import { createProtector } from '../src/agent/neighbor/protect.js';

test('a grant is read as a player types it: one block, or two corners of a small box', () => {
    assert.deepEqual(parseGrant('!allowBreak 10 64 -5'), { min: { x: 10, y: 64, z: -5 }, max: { x: 10, y: 64, z: -5 }, count: 1 });
    assert.deepEqual(parseGrant('!allowBreak(10, 64, -5)'), parseGrant('!allowBreak 10 64 -5'));
    assert.deepEqual(parseGrant('allowbreak 10.7 64 -5.2'), { min: { x: 10, y: 64, z: -6 }, max: { x: 10, y: 64, z: -6 }, count: 1 });
    assert.deepEqual(parseGrant('!allowBreak 2 64 0 0 65 1'), { min: { x: 0, y: 64, z: 0 }, max: { x: 2, y: 65, z: 1 }, count: 12 });
    assert.equal(parseGrant('can you allowBreak the door?')?.error, undefined, 'only a message that starts with it');
    assert.equal(parseGrant('can you allowBreak the door?'), null);
    assert.equal(parseGrant('hello'), null);
    assert.match(parseGrant('!allowBreak the plank').error, /Say which block/);
    assert.match(parseGrant('!allowBreak 0 0 0 10 10 10').error, /That is 1331 blocks\. I take at most 64/);
});

test('a granted block may be broken once, and for ten minutes only', () => {
    let t = 0;
    const grants = createGrants({ now: () => t });
    grants.grant(parseGrant('!allowBreak 1 64 0 2 64 0'), 'Steve');
    assert.equal(grants.grantedBy(1, 64, 0), 'Steve');
    assert.equal(grants.grantedBy(3, 64, 0), null, 'only the cells granted');
    grants.use(1, 64, 0);
    assert.equal(grants.grantedBy(1, 64, 0), null, 'used up');
    assert.equal(grants.size, 1);
    t = 10 * 60 * 1000;
    assert.equal(grants.grantedBy(2, 64, 0), null, 'run out');
    assert.equal(grants.size, 0);
});

test('a granted block is let through before every other rule, a protected area too', () => {
    const grants = createGrants();
    const area = { name: 'Base', contains: () => true };
    const protector = createProtector({ read: () => null, tagOf: () => 'built', areas: [area], grantedBy: (x, y, z) => grants.grantedBy(x, y, z) });
    const plank = { name: 'oak_planks', position: { x: 5, y: 64, z: 5 } };
    assert.equal(protector.refusal(plank).why, 'area');
    grants.grant(parseGrant('!allowBreak 5 64 5'), 'Alex');
    assert.equal(protector.refusal(plank), null);
    assert.equal(protector.refusal({ ...plank, position: { x: 6, y: 64, z: 5 } }).why, 'area', 'the block beside it is still protected');
});

/** An agent whose own handleMessage records what reached it. */
function chatAgent() {
    const reached = [], said = [];
    const agent = { name: 'Bot', handleMessage: async (source, message) => { reached.push([source, message]); return false; } };
    return { agent, reached, said };
}

test('a player\'s grant in chat is taken and answered, and never reaches the model', async () => {
    const { agent, reached, said } = chatAgent();
    const grants = createGrants();
    grantListener(agent, { grants, say: text => said.push(text) });
    assert.equal(await agent.handleMessage('Steve', '!allowBreak 3 70 -2'), true);
    assert.equal(grants.grantedBy(3, 70, -2), 'Steve');
    assert.deepEqual(reached, []);
    assert.deepEqual(said, ['Okay, Steve: I may break the block at 3, 70, -2, once each, in the next 10 minutes.']);
    await agent.handleMessage('Steve', '!allowBreak 0 64 0 1 65 0');
    assert.match(said.at(-1), /the 4 blocks from 0, 64, 0 to 1, 65, 0/);
    await agent.handleMessage('Steve', 'please break it');
    assert.deepEqual(reached, [['Steve', 'please break it']], 'anything else goes on as before');
});

test('the bot itself, the system and another bot can\'t grant: their messages go on untouched', async () => {
    const { agent, reached, said } = chatAgent();
    const grants = createGrants();
    grantListener(agent, { grants, isBot: name => name === 'OtherBot', say: text => said.push(text) });
    for (const source of ['Bot', 'system', 'OtherBot']) await agent.handleMessage(source, '!allowBreak 1 2 3');
    assert.equal(grants.size, 0);
    assert.equal(reached.length, 3);
    assert.deepEqual(said, []);
});

test('a grant that can\'t be used is said back to the player, and grants nothing', async () => {
    const { agent, reached, said } = chatAgent();
    const grants = createGrants();
    grantListener(agent, { grants, say: text => said.push(text) });
    await agent.handleMessage('Steve', '!allowBreak that plank');
    assert.equal(grants.size, 0);
    assert.deepEqual(reached, []);
    assert.match(said[0], /Say which block/);
});

test('the model has no command to grant with', async () => {
    const { getCommand } = await import('../src/agent/commands/index.js');
    assert.equal(getCommand('!allowBreak'), undefined);
});
