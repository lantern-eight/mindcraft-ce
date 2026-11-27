// SPDX-License-Identifier: CC0-1.0
// !explore and !exploreFor as the model calls them: reading the arguments, the setting, and carrying a walk
// on from one call to the next, on pretend legs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exploreCommands } from '../src/agent/explore/commands.js';
import { installExplore } from '../src/agent/explore/install.js';
import { getCommand } from '../src/agent/commands/index.js';

/** An agent whose actions run at once, and legs that walk straight and see nothing unless told. */
function setup({ sees = null } = {}) {
    const pos = { x: 0, y: 64, z: 0 };
    const calls = [];
    const legsFor = (bot, options) => {
        calls.push(options);
        return {
            position: () => ({ ...pos }),
            interrupted: () => false,
            async walk(point) { pos.x = point.x; pos.z = point.z; return 'arrived'; },
            async lookAround() { return false; },
            newGround: () => null,
            find: () => (sees && Math.hypot(sees.x - pos.x, sees.z - pos.z) < 20 ? sees : null),
            recall: () => null,
        };
    };
    const bot = { registry: { blocksByName: { sand: {}, red_sand: {}, oak_log: {} }, entitiesByName: { cow: {} } }, game: { dimension: 'overworld' } };
    const agent = {
        bot, fairPlay: null,
        actions: { async runAction(label, fn) { const r = await fn(); return { ...r, message: r.text, interrupted: false, label }; } },
    };
    const [explore, exploreFor] = exploreCommands({ memoryOf: a => a.fairPlay?.memory ?? null, legsFor });
    return { agent, bot, pos, calls, explore, exploreFor };
}

test('the two commands are actions with a direction and a distance', () => {
    const { explore, exploreFor } = setup();
    assert.equal(explore.name, '!explore');
    assert.deepEqual(Object.keys(explore.params), ['direction', 'distance']);
    assert.equal(exploreFor.name, '!exploreFor');
    assert.deepEqual(Object.keys(exploreFor.params), ['what', 'direction', 'distance']);
    assert.deepEqual(explore.params.distance.domain, [16, 512, '[]']);
});

test('!explore walks the way it is told, and says where it got to', async () => {
    const { agent, pos, explore } = setup();
    const result = await explore.perform.structured(agent, 'north', 64);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Explored 64 blocks north, heading north; now at 0, 64, -64\./);
    assert.ok(pos.z <= -63);
});

test('a direction it can\'t read, or a thing it doesn\'t know, is refused before setting out', async () => {
    const { agent, calls, explore, exploreFor } = setup();
    const bad = await explore.perform.structured(agent, 'towards the sea', 64);
    assert.equal(bad.status, 'failed');
    assert.match(bad.text, /"towards the sea" is not a direction/);
    const unknown = await exploreFor.perform.structured(agent, 'beach, sand', 'east', 64);
    assert.equal(unknown.status, 'failed');
    assert.match(unknown.text, /Don't know "beach"/);
    assert.equal(calls.length, 0);
});

test('!exploreFor reads block and mob names, and stops when one is seen', async () => {
    const { agent, calls, exploreFor } = setup({ sees: { name: 'sand', x: 50, y: 62, z: 0 } });
    const result = await exploreFor.perform.structured(agent, 'Sand, red_sand,cow', 'east', 200);
    assert.deepEqual({ blocks: calls[0].targets.blocks, mobs: calls[0].targets.mobs }, { blocks: ['sand', 'red_sand'], mobs: ['cow'] });
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Found sand/);
});

test('exploring for something not found yet is progress, not a failure', async () => {
    const { agent, exploreFor } = setup();
    const result = await exploreFor.perform.structured(agent, 'oak_log', 'west', 32);
    assert.equal(result.status, 'partial');
    assert.match(result.text, /No oak_log seen yet/);
});

test('"on" carries the last walk on, in the same dimension only', async () => {
    const { agent, bot, pos, explore } = setup();
    await explore.perform.structured(agent, 'south-west', 32);
    const before = { ...pos };
    await explore.perform.structured(agent, 'on', 32);
    assert.ok(pos.x < before.x - 20 && pos.z > before.z + 20, 'went on south-west');

    bot.game.dimension = 'the_nether';
    const random = Math.random;
    Math.random = () => 0;   // a fresh start heads east
    try { await explore.perform.structured(agent, 'on', 32); } finally { Math.random = random; }
    assert.ok(pos.x > before.x - 20, 'in another dimension, the old walk is not carried on');
});

test('the setting turns the commands on, and leaving it out leaves them out', () => {
    assert.equal(installExplore({}, { config: {} }), null);
    assert.equal(installExplore({}, { config: { explore: false } }), null);
    const installed = installExplore({}, { config: { explore: true } });
    assert.deepEqual(installed.commands, ['!explore', '!exploreFor']);
    assert.ok(getCommand('!explore'));
    assert.ok(getCommand('!exploreFor'));
});
