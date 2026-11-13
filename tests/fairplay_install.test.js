// Installing fair play on an agent: the cheat-mode lock, the slash-command guard, the operator and
// game-mode watch, and the spawn-time wiring of perception, the seen-world map and the world.js provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import { initModes } from '../src/agent/modes.js';
import { getCommand } from '../src/agent/commands/index.js';
import * as world from '../src/agent/library/world.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { withAction } from '../src/agent/action_context.js';
import { installFairPlay, lockModes, makeChatGuard, guardChat, watchPermissions } from '../src/agent/fairplay/install.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { withSearchHint, SEARCH_HINT } from '../src/agent/fairplay/commands.js';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';

const STRICT = resolvePolicy({ fair_play: 'strict' });
const quiet = () => {};

function agentWithModes(initial) {
    const agent = { bot: {}, task: null, prompter: { getInitModes: () => initial } };
    initModes(agent);
    return agent;
}

test('L1: cheat mode stays off whether the profile, the model, a player, or code asks', async () => {
    const agent = agentWithModes({ cheat: true, hunting: false }); // a god_mode-style profile
    assert.equal(agent.bot.modes.isOn('cheat'), true);
    lockModes(agent.bot.modes, STRICT, quiet);
    assert.equal(agent.bot.modes.isOn('cheat'), false, 'the profile setting is undone');
    assert.equal(agent.bot.modes.setOn('cheat', true), false);
    agent.bot.modes.loadJson({ cheat: true });
    assert.equal(agent.bot.modes.isOn('cheat'), false);
    agent.bot.modes.setOn('hunting', true);
    assert.equal(agent.bot.modes.isOn('hunting'), true, 'other modes still work');
    // !setMode is how both the model and a player in chat would try; it now says it was refused.
    const reply = await getCommand('!setMode').perform(agent, 'cheat', true);
    assert.match(reply, /can't be turned on/);
    assert.equal(agent.bot.modes.isOn('cheat'), false);
});

test('L1b: with cheat_mode allowed by a custom policy, the lock stays out of the way', () => {
    const agent = agentWithModes({ cheat: false });
    lockModes(agent.bot.modes, resolvePolicy({ fair_play: 'custom', fair_play_custom: { cheat_mode: true } }), quiet);
    agent.bot.modes.setOn('cheat', true);
    assert.equal(agent.bot.modes.isOn('cheat'), true);
});

test('L2: only whispers get through as slash commands; a leading space makes plain chat', () => {
    const guard = makeChatGuard(STRICT);
    const verdicts = ['/give @s diamond 64', '/tp 0 100 0', '/skin clear', '/tell Alex hi', '/TELL Alex hi',
        '/minecraft:msg Alex hi', ' /give @s diamond', 'hello there'].map(m => guard(m).allowed);
    assert.deepEqual(verdicts, [false, false, false, true, true, true, true, true]);
    assert.equal(makeChatGuard(resolvePolicy({ fair_play: 'custom', fair_play_custom: { slash_commands: true } }))('/tp 0 0 0').allowed, true);

    const sent = [];
    const bot = { chat: message => sent.push(message) };
    guardChat(bot, guard, quiet);
    bot.chat('/skin clear');
    bot.chat('hi');
    bot.chat('/tell Alex hi');
    assert.deepEqual(sent, ['hi', '/tell Alex hi']);
});

test("the chat guard survives mineflayer injecting bot.chat after the install hook runs", () => {
    // Mirror mineflayer's order: createBot returns without bot.chat; plugins arrive on 'inject_allowed'.
    const agent = agentWithModes({});
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.modes = agent.bot.modes;
    agent.bot = bot;
    agent.prompter.profile = {};
    installFairPlay(agent, { config: { fair_play: 'strict', host: 'h', port: 1 }, seenDir: mkdtempSync(path.join(tmpdir(), 'fair-late-')) });
    const sent = [];
    bot.chat = message => sent.push(message); // the chat plugin injecting itself
    bot.emit('inject_allowed');
    bot.chat('/skin clear');
    bot.chat('hello');
    assert.deepEqual(sent, ['hello']);
    bot.emit('end');
});

test('L4: becoming an operator or leaving survival is noticed, and cleared when fixed', () => {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.entity = { id: 5 };
    bot.game = { gameMode: 'survival' };
    const events = [];
    const watch = watchPermissions(bot, { onViolation: r => events.push(['bad', r]), onClear: () => events.push(['ok']) });
    bot._client.emit('entity_status', { entityId: 99, entityStatus: 28 }); // someone else's status
    assert.equal(watch.violation, null);
    bot._client.emit('entity_status', { entityId: 5, entityStatus: 26 }); // the bot is now op level 2
    assert.match(watch.violation, /operator \(level 2\)/);
    bot.game.gameMode = 'creative';
    bot.emit('game');
    assert.match(watch.violation, /creative/);
    bot._client.emit('entity_status', { entityId: 5, entityStatus: 24 });
    bot.game.gameMode = 'survival';
    bot.emit('game');
    assert.equal(watch.violation, null);
    assert.deepEqual(events.map(e => e[0]), ['bad', 'bad', 'bad', 'ok']);
});

function fairAgent(build, config = { fair_play: 'strict', host: 'localhost', port: 1 }, prepare = () => {}) {
    const w = fixtureWorld({ min: [-16, -4, -16], max: [16, 16, 16] });
    w.fill('stone', [-16, 0, -16], [16, 0, 16]);
    build(w);
    const bot = stubBot(w);
    bot._client = new EventEmitter();
    bot.game = { gameMode: 'survival', dimension: 'overworld' };
    bot.worldIdentity = 'w1';
    bot.chat = () => {};
    prepare(bot);
    const ran = [];
    const agent = {
        name: 'Fairy', bot, task: null, openChat: () => {},
        prompter: { profile: {}, getInitModes: () => ({}) },
        // Stands in for CE's action runner: records the label; a label starting "search:" comes back empty-handed.
        actions: { runAction: async (label) => {
            ran.push(label);
            return label.startsWith('search:') ? { success: false, text: 'Could not find any sand in 64 blocks.', message: 'Could not find any sand in 64 blocks.' }
                : { success: true, message: 'done' };
        } },
    };
    initModes(agent);
    const seenDir = mkdtempSync(path.join(tmpdir(), 'fair-install-'));
    const handle = installFairPlay(agent, { config, seenDir, perceptionOptions: { getStateId: w.getStateId, ...NO_BUDGETS } });
    return { agent, bot, handle, ran, seenDir };
}

test('installing with fair_play off changes nothing', () => {
    const agent = agentWithModes({});
    agent.bot.on = () => {};
    assert.equal(installFairPlay(agent, { config: {} }), null);
    assert.equal(agent.fairPlay, undefined);
});

test('installing strict on a spawned bot makes world.js fair and saves the map when the bot leaves', () => {
    const { agent, bot, handle, seenDir } = fairAgent(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0); // buried
        w.set('diamond_ore', -6, 1, 0); // in the open
    });
    assert.ok(handle.perception && handle.seenMap);
    assert.equal(agent.fairPlay, handle);
    assert.equal(handle.seenMap.scope, 'localhost:1/w1/overworld');
    const found = world.getNearestBlocksWhere(bot, b => b.name === 'diamond_ore', 32, 5);
    assert.deepEqual(found.map(b => b.position.x), [-6]);
    bot.emit('end');
    assert.equal(readdirSync(seenDir).filter(f => f.endsWith('.json')).length, 1);
    setWorldQueries(null);
});

test('!entities lists what the bot heard but cannot see, without coordinates', () => {
    const { agent, bot, handle } = fairAgent(w => w.fill('stone', [4, 1, -3], [4, 6, 3])); // a wall to the east
    const zombie = { id: 7, type: 'hostile', name: 'zombie', position: new Vec3(8.5, 1, 0.5), height: 1.95 };
    const cow = { id: 8, type: 'animal', name: 'cow', position: new Vec3(-6.5, 1, 0.5), height: 1.4 };
    bot.entities[7] = zombie; bot.entities[8] = cow;
    handle.perception.hearSound('entity.zombie.ambient', zombie.position); // behind the wall
    handle.perception.hearSound('entity.cow.ambient', cow.position);       // in plain view
    assert.deepEqual(handle.heardLines(), ['heard: zombie (east, close)']);
    const report = getCommand('!entities').perform(agent);
    assert.match(report, /entities: 1 cow\(s\)/);
    assert.match(report, /heard: zombie \(east, close\)/);
    assert.doesNotMatch(report, /heard: cow/, 'something in view is not also reported as heard');
    assert.doesNotMatch(report, /8\.5/, 'no coordinates');
    bot.emit('end');
    setWorldQueries(null);
});

test('R1 end to end: once installed, a skill cannot open a chest it cannot see, but the pathfinder is left alone', async () => {
    const opened = [];
    const { bot } = fairAgent(w => {
        w.fill('stone', [2, 1, -2], [2, 4, 2]); // a wall
        w.set('chest', 3, 1, 0);                // a chest behind it, within reach
    }, undefined, b => { b.openContainer = async block => { opened.push(block.name); return 'window'; }; });
    const chest = bot.blockAt(new Vec3(3, 1, 0));
    // Skills, commands and generated code run inside one of CE's actions; that is what the guard looks for.
    const action = { bot, signal: new AbortController().signal, cleanups: new Set() };
    await assert.rejects(withAction(action, () => bot.openContainer(chest)), /can't see the block at 3, 1, 0/);
    assert.deepEqual(opened, []);
    assert.equal(await bot.openContainer(chest), 'window', 'a call from outside any action passes through');
    bot.emit('end');
    setWorldQueries(null);
});

test('!recall answers from memory: where, how far, which way, how long ago', async () => {
    const { agent, bot, handle } = fairAgent(w => {
        w.fill('sand', [6, 1, -1], [7, 1, 1]);      // a patch of sand in view to the east
        w.fill('stone', [-6, 1, -2], [-3, 4, 2]);
        w.set('diamond_ore', -4, 2, 0);             // buried
    });
    handle.perception.tick(); // the background pass notices the sand
    const recall = getCommand('!recall');
    assert.ok(recall, 'installing fair play registers the command');
    const sand = recall.perform(agent, 'sand');
    assert.match(sand, /^REMEMBERED sand \(nearest first\)\n- at 6, 1, 0: 6 blocks east, seen just now/);
    assert.match(sand, /and 1 more farther away/);
    assert.equal(recall.perform(agent, 'diamond_ore'), "You haven't seen any diamond_ore yet. Explore to find some.");
    assert.match(recall.perform(agent, 'stone'), /isn't a kind of block you keep track of/);
    bot.emit('end');
    setWorldQueries(null);
});

test('an empty-handed search is explained once: not found means not seen', async () => {
    const { agent, bot } = fairAgent(() => {});
    const found = await agent.actions.runAction('action:collectBlocks', async () => {});
    assert.equal(found.message, 'done', 'ordinary results are left alone');
    const empty = await agent.actions.runAction('search:sand', async () => {});
    assert.equal(empty.message, 'Could not find any sand in 64 blocks.' + SEARCH_HINT, 'the action runner adds the sentence');
    assert.deepEqual(withSearchHint({ status: 'failed', text: 'Could not find any sand in 64 blocks.', message: 'Could not find any sand in 64 blocks.' }).message,
        'Could not find any sand in 64 blocks.' + SEARCH_HINT);
    assert.equal(withSearchHint({ text: 'There is no furnace nearby and you have no furnace.' }).text.endsWith(SEARCH_HINT), true);
    assert.equal(withSearchHint({ text: 'Collected 3 oak_log.' }).text, 'Collected 3 oak_log.');
    const once = withSearchHint(withSearchHint({ text: 'Could not find a chest nearby.' }));
    assert.equal(once.text.split(SEARCH_HINT).length, 2, 'the sentence is not added twice');
    bot.emit('end');
    setWorldQueries(null);
});

test('a new dimension gets its own seen-world map on respawn', () => {
    const { bot, handle } = fairAgent(() => {});
    const first = handle.seenMap;
    bot.game.dimension = 'the_nether';
    bot.emit('spawn');
    assert.notEqual(handle.seenMap, first);
    assert.equal(handle.seenMap.scope, 'localhost:1/w1/the_nether');
    bot.emit('end');
    setWorldQueries(null);
});

test('while the bot is an operator, every action is refused with a reason', async () => {
    const { bot, agent, ran } = fairAgent(() => {});
    bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 28 });
    const result = await agent.actions.runAction('action:collectBlocks', async () => {});
    assert.equal(result.status, 'blocked');
    assert.match(result.message, /operator/);
    assert.deepEqual(ran, []);
    bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 24 });
    await agent.actions.runAction('action:collectBlocks', async () => {});
    assert.deepEqual(ran, ['action:collectBlocks']);
    bot.emit('end');
    setWorldQueries(null);
});

test("strict refuses CE's task harness, which needs an operator bot", async () => {
    const { agent, bot } = fairAgent(() => {}, { fair_play: 'strict', host: 'h', port: 1, task: { type: 'cooking' } });
    const result = await agent.actions.runAction('action:anything', async () => {});
    assert.match(result.message, /task harness/);
    bot.emit('end');
    setWorldQueries(null);
});
