// SPDX-License-Identifier: CC0-1.0
// Fair-play code runner: code the model writes may only steer the player the way a person could.
//
// Today `!newAction` code gets the raw mineflayer bot, and `executeCode` / generated augments run with
// full host access. The runner hands generated code a fair facade instead: snapshots to read, normal
// player inputs, and world actions that go through perception and guards. These tests use a stub
// "real" bot that records what reaches it, so each test can prove a cheat never got through.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { createCodeRunner } from '../src/agent/fairplay/code_runner.js';

function stubWorld() {
    // Blocks the bot's perception knows about (seen or touched). Anything else is unknown to it.
    const known = new Map();
    const addBlock = (name, x, y, z, type = 1) => known.set(`${x},${y},${z}`,
        { name, type, stateId: type, metadata: 0, displayName: name, position: new Vec3(x, y, z), hardness: 1, diggable: true, boundingBox: 'block' });
    addBlock('oak_log', 2, 64, 0, 46);
    addBlock('chest', 0, 64, 3, 54);
    return { known, addBlock };
}

function stubBot() {
    const calls = [];
    const record = name => (...args) => { calls.push([name, ...args]); return Promise.resolve(); };
    const zombie = { id: 7, name: 'zombie', type: 'hostile', displayName: 'Zombie', position: new Vec3(4, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, height: 1.95, width: 0.6, onGround: true, isValid: true, metadata: [{ secret: 'mob health 17' }] };
    const hidden = { id: 8, name: 'creeper', type: 'hostile', position: new Vec3(20, 40, 0), height: 1.7 };
    const bot = {
        username: 'Fairy', version: '1.21.11', calls, output: '', interrupt_code: false,
        entity: { id: 1, position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: true, height: 1.8, width: 0.6 },
        health: 20, food: 18, foodSaturation: 5, oxygenLevel: 20,
        game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' },
        time: { timeOfDay: 1000, day: 3, isDay: true },
        entities: { 7: zombie, 8: hidden },
        players: { Fairy: { username: 'Fairy', entity: null }, Alex: { username: 'Alex', entity: null } },
        inventory: {
            items: () => [{ name: 'oak_planks', type: 23, count: 12, slot: 36, metadata: 0, displayName: 'Oak Planks', stackSize: 64 }],
            slots: [], emptySlotCount: () => 30,
        },
        heldItem: null,
        _client: { write: record('_client.write') },
        world: { getBlock: () => { throw new Error('raw world read'); } },
        creative: { setInventorySlot: record('creative') },
        modes: { setOn: record('modes.setOn'), isOn: () => false },
        findBlocks: () => { throw new Error('raw findBlocks reached'); },
        nearestEntity: () => { throw new Error('raw nearestEntity reached'); },
        chat: msg => { calls.push(['chat', msg]); },
        whisper: (user, msg) => { calls.push(['whisper', user, msg]); },
        dig: record('dig'), placeBlock: record('placeBlock'), activateBlock: record('activateBlock'),
        attack: (e) => { calls.push(['attack', e]); }, equip: record('equip'), consume: record('consume'),
        setControlState: (c, s) => { calls.push(['control', c, s]); }, clearControlStates: () => calls.push(['clear']),
        lookAt: record('lookAt'), look: record('look'), waitForTicks: record('waitForTicks'),
    };
    return { bot, zombie, hidden };
}

function setup({ guard, cheatOn = false } = {}) {
    const { bot, zombie, hidden } = stubBot();
    const { known, addBlock } = stubWorld();
    const perceived = new Set([zombie.id]); // the creeper is behind a wall
    const perception = {
        blockAt: pos => known.get(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`) ?? null,
        findBlocks: ({ matching, count = 1 }) => [...known.values()]
            .filter(b => typeof matching === 'function' ? matching(b) : [].concat(matching).includes(b.type))
            .slice(0, count).map(b => b.position),
        entities: () => Object.values(bot.entities).filter(e => perceived.has(e.id)),
    };
    const skillCalls = [];
    const skills = {
        collectBlock: async (b, type, num) => { skillCalls.push(['collectBlock', b, type, num]); return true; },
        attackEntity: async (b, entity) => { skillCalls.push(['attackEntity', b, entity]); return true; },
        collectBlockResult: async () => ({ status: 'ok', text: 'Broke 1/1', code: null, data: { gains: { oak_log: 1 } } }),
    };
    const world = {
        getNearestBlock: (b, name) => { skillCalls.push(['getNearestBlock', b, name]); return known.get('2,64,0'); },
        getPosition: b => b.entity.position,
        getNearestBlocksWhere: (b, predicate) => [...known.values()].filter(block => predicate(block)),
    };
    const log = (b, message) => { b.output += message + '\n'; };
    const runner = createCodeRunner({
        realBot: bot, skills, world, log, Vec3, perception,
        guard, isCheatOn: () => cheatOn,
        chatGuard: message => message.startsWith('/') && !/^\/(tell|msg|w) /i.test(message)
            ? { allowed: false, reason: 'Slash commands are off in fair play.' } : { allowed: true },
    });
    const run = (body, ...params) => runner.compileBody(params.map(p => p[0]), body)(...params.map(p => p[1]));
    return { bot, runner, run, skillCalls, perceived, addBlock, zombie, hidden };
}

test('C1: a slash command from generated code is refused and never reaches the real bot', async () => {
    const { bot, run } = setup();
    await assert.rejects(run(`bot.chat('/give @s diamond 64');`), /Slash commands are off/);
    await run(`bot.chat('hello'); bot.whisper('Alex', 'hi');`);
    assert.deepEqual(bot.calls.filter(c => c[0] === 'chat' || c[0] === 'whisper'),
        [['chat', 'hello'], ['whisper', 'Alex', 'hi']]);
});

test('C2: the raw protocol client, world, creative inventory and modes are not on the facade', async () => {
    const { run } = setup();
    const kinds = await run(`return [typeof bot._client, typeof bot.world, typeof bot.creative, typeof bot.modes,
        typeof bot.physics, typeof bot.on, typeof bot.findBlocks];`);
    assert.deepEqual(kinds, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'function']);
});

test('C3: writing the bot position does nothing to the real bot (snapshots are frozen)', async () => {
    const { bot, run } = setup();
    await assert.rejects(run(`bot.entity.position.x = 100;`), TypeError);
    await assert.rejects(run(`bot.entity.position = new Vec3(100, 64, 0);`), TypeError);
    assert.equal(bot.entity.position.x, 0.5);
});

test('C3b: generated code cannot rewrite vector math that the guards rely on', async () => {
    const { run } = setup();
    await assert.rejects(run(`Object.getPrototypeOf(bot.entity.position).distanceTo = () => 0;`), TypeError);
    assert.notEqual(new Vec3(0, 0, 0).distanceTo(new Vec3(3, 4, 0)), 0);
});

test('C4: searches answer only from perception; raw searches are never called', async () => {
    const { run } = setup();
    const found = await run(`return bot.findBlocks({ matching: b => b.name === 'oak_log', maxDistance: 64, count: 5 })
        .map(p => [p.x, p.y, p.z]);`);
    assert.deepEqual(found, [[2, 64, 0]]);
    assert.equal(await run(`return bot.blockAt(new Vec3(9, 9, 9));`), null, 'unknown cells read as null');
    const seen = await run(`return Object.values(bot.entities).map(e => e.name);`);
    assert.deepEqual(seen, ['zombie'], 'the creeper behind the wall is not listed');
    assert.equal(await run(`return bot.nearestEntity(e => e.name === 'creeper');`), null);
});

test('C4b: entity snapshots carry what a player can see, not hidden metadata like mob health', async () => {
    const { run } = setup();
    const keys = await run(`return Object.keys(bot.nearestEntity(e => e.name === 'zombie')).sort();`);
    assert.ok(!keys.includes('metadata'));
    assert.ok(keys.includes('position') && keys.includes('name'));
});

test('C5: host globals, dynamic import and the agent are unreachable', async () => {
    const { run, runner } = setup();
    const kinds = await run(`return [typeof process, typeof require, typeof agent, typeof globalThis.process,
        typeof setTimeout];`);
    assert.deepEqual(kinds, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    assert.throws(() => runner.compileBody([], `await import('fs');`), /import/i);
});

test('C8: skills still work: they receive the real bot, and snapshots turn back into live objects', async () => {
    const { bot, run, skillCalls, zombie } = setup();
    assert.equal(await run(`return await skills.collectBlock(bot, 'oak_log', 1);`), true);
    assert.equal(skillCalls[0][1], bot, 'the skill got the real bot, not the facade');
    await run(`const z = bot.nearestEntity(e => e.name === 'zombie'); return await skills.attackEntity(bot, z);`);
    assert.equal(skillCalls[1][2], zombie, 'the snapshot was swapped for the live entity');
    const result = await run(`return await skills.collectBlockResult(bot, 'oak_log', 1);`);
    assert.equal(result.data.gains.oak_log, 1);
    assert.ok(Object.isFrozen(result), 'results come back as frozen copies');
});

test('world functions get the real bot and return snapshots', async () => {
    const { bot, run, skillCalls } = setup();
    const name = await run(`const b = world.getNearestBlock(bot, 'oak_log'); return [b.name, b.position.x, Object.isFrozen(b)];`);
    assert.deepEqual(name, ['oak_log', 2, true]);
    assert.equal(skillCalls[0][1], bot);
});

test('predicates passed to world functions receive snapshots, never live objects', async () => {
    const { run } = setup();
    const result = await run(`
        let stashed = null;
        const found = world.getNearestBlocksWhere(bot, b => { stashed = b; return b.name === 'oak_log'; });
        return [found.map(b => b.name), Object.isFrozen(stashed), typeof stashed.getProperties];`);
    assert.deepEqual(result, [['oak_log'], true, 'undefined']);
});

test('world actions need a perceived target', async () => {
    const { bot, run, perceived, zombie } = setup();
    await run(`await bot.dig(bot.blockAt(new Vec3(2, 64, 0)));`);
    assert.equal(bot.calls.find(c => c[0] === 'dig')[1].name, 'oak_log');
    await assert.rejects(run(`await bot.dig({ position: new Vec3(5, 40, 5) });`), /haven't seen/);
    await assert.rejects(run(`await bot.attack({ id: 8 });`), /can't see/, 'the hidden creeper cannot be targeted by id');
    perceived.delete(zombie.id);
    await assert.rejects(run(`await bot.attack({ id: 7 });`), /can't see/, 'a mob that went out of sight cannot be hit');
});

test('guards (reach, good neighbor) see every world action and can refuse it', async () => {
    const seen = [];
    const { bot, run } = setup({ guard: (action, target) => {
        seen.push([action, target.name]);
        if (target.name === 'chest') throw new Error('That chest is protected.');
    } });
    await run(`await bot.dig(bot.blockAt(new Vec3(2, 64, 0)));`);
    await assert.rejects(run(`await bot.activateBlock(bot.blockAt(new Vec3(0, 64, 3)));`), /protected/);
    assert.deepEqual(seen, [['dig', 'oak_log'], ['activate', 'chest']]);
    assert.equal(bot.calls.some(c => c[0] === 'activateBlock'), false);
});

test('player inputs pass through, with control names checked', async () => {
    const { bot, run } = setup();
    await run(`bot.setControlState('forward', true); bot.clearControlStates(); await bot.lookAt(new Vec3(1, 65, 1));`);
    assert.deepEqual(bot.calls.filter(c => c[0] === 'control'), [['control', 'forward', true]]);
    await assert.rejects(run(`bot.setControlState('fly', true);`), /Unknown control/);
});

test('skills refuse to run while cheat mode is on', async () => {
    const { run, skillCalls } = setup({ cheatOn: true });
    await assert.rejects(run(`await skills.collectBlock(bot, 'oak_log', 1);`), /cheat mode/);
    assert.equal(skillCalls.length, 0);
});

test('log(bot, ...) writes to the real bot output', async () => {
    const { bot, run } = setup();
    await run(`log(bot, 'hello from code'); console.log('and console');`);
    assert.match(bot.output, /hello from code/);
    assert.match(bot.output, /and console/);
});

test('each compiled snippet gets a fresh compartment, so code cannot leave traps for later code', async () => {
    const { run } = setup();
    await run(`globalThis.trap = 1;`);
    assert.equal(await run(`return typeof globalThis.trap;`), 'undefined');
});

test('parameters are passed by name and must be plain identifiers', async () => {
    const { run, runner } = setup();
    assert.equal(await run(`return count * 2;`, ['count', 21]), 42);
    assert.throws(() => runner.compileBody(['a) => {}; (b'], 'return 1;'), /parameter/i);
});
