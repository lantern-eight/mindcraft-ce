// SPDX-License-Identifier: CC0-1.0
// !explore and !exploreFor as the model calls them: reading the arguments, the setting, and carrying a walk
// on from one call to the next, on pretend legs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exploreCommands } from '../src/agent/explore/commands.js';
import { installExplore } from '../src/agent/explore/install.js';
import { getCommand } from '../src/agent/commands/index.js';
import { exploreWayOf } from '../src/agent/library/explore_way.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** An agent whose actions run at once, and legs that walk straight and see nothing unless told. */
function setup({ sees = null, memory = null } = {}) {
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
        bot, fairPlay: memory ? { memory } : null,
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

test('with world memory, the last walk is kept in its folder and carried on after a restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'explore-walk-'));
    try {
        const memory = { dir, scope: 'world-a/overworld' };
        const first = setup({ memory });
        await first.explore.perform.structured(first.agent, 'south-west', 32);
        const saved = JSON.parse(readFileSync(path.join(dir, 'explore.json'), 'utf8'));
        assert.equal(saved.scope, 'world-a/overworld');
        assert.equal(saved.trail.bearing, true);

        // A new process: nothing kept in it, the bot standing where the walk ended.
        const second = setup({ memory });
        Object.assign(second.pos, first.pos);
        const before = { ...second.pos };
        await second.explore.perform.structured(second.agent, 'on', 32);
        assert.ok(second.pos.x < before.x - 20 && second.pos.z > before.z + 20, 'went on south-west');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a saved walk of another world, or a damaged one, is not carried on', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'explore-walk-'));
    const quiet = console.warn;
    console.warn = () => {};
    try {
        const trail = { origin: { x: 0, z: 0 }, end: { x: 0, z: 0 }, heading: Math.PI / 2, bearing: false };
        writeFileSync(path.join(dir, 'explore.json'), JSON.stringify({ scope: 'world-b/overworld', trail }));
        const random = Math.random;
        Math.random = () => 0;   // a fresh start heads east
        try {
            const { agent, pos, explore } = setup({ memory: { dir, scope: 'world-a/overworld' } });
            await explore.perform.structured(agent, 'on', 32);
            assert.ok(pos.x > 20 && Math.abs(pos.z) < 1, `not south, as the other world's walk went: ${JSON.stringify(pos)}`);
            writeFileSync(path.join(dir, 'explore.json'), '{ not json');
            const fresh = setup({ memory: { dir, scope: 'world-a/overworld' } });
            const result = await fresh.explore.perform.structured(fresh.agent, 'on', 32);
            assert.equal(result.status, 'ok', 'a damaged file is set aside, and the walk starts afresh');
            assert.ok(fresh.pos.x > 20, JSON.stringify(fresh.pos));
        } finally { Math.random = random; }
    } finally { console.warn = quiet; rmSync(dir, { recursive: true, force: true }); }
});

test('the setting turns the commands on, and leaving it out leaves them out', () => {
    assert.equal(installExplore({}, { config: {} }), null);
    assert.equal(installExplore({}, { config: { explore: false } }), null);
    const installed = installExplore({}, { config: { explore: true } });
    assert.deepEqual(installed.commands, ['!explore', '!exploreFor']);
    assert.ok(getCommand('!explore'));
    assert.ok(getCommand('!exploreFor'));
});

test('installed, it gives the NPC\'s item goals a way of exploring for what they need', async () => {
    const { agent, pos } = setup({ sees: { name: 'sand', x: 0, y: 63, z: -60 } });
    // The same pretend legs as the commands get: walking straight, seeing the sand once within 20 blocks.
    const legsFor = (bot, options) => ({
        position: () => ({ ...pos }),
        interrupted: () => false,
        async walk(point) { pos.x = point.x; pos.z = point.z; return 'arrived'; },
        async lookAround() { return false; },
        newGround: angle => (Math.abs(angle + Math.PI / 2) < 1e-6 ? 1 : 0),
        find: () => (options.targets && Math.hypot(pos.x, pos.z + 60) < 20 ? { name: 'sand', x: 0, y: 63, z: -60 } : null),
        recall: () => null,
    });
    installExplore(agent, { config: { explore: true }, deps: { legsFor } });
    const way = exploreWayOf(agent.bot);
    assert.ok(way, 'installed for the bot');
    const result = await way('sand');
    assert.equal(result.status, 'ok');
    assert.match(result.text, /^Found sand/);
    assert.ok(pos.z < -30, 'it went north, towards the newest ground');
});
