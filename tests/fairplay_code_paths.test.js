// CE's three ways to run model-written code all go through the fair-play runner when fair play is on:
// !newAction (Coder), the executeCode tool (ExecutorCodeAgent), and generated augments (CodeAgent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setSettings } from '../src/agent/settings.js';
import { initModes } from '../src/agent/modes.js';
import { Coder } from '../src/agent/coder.js';
import { ExecutorCodeAgent } from '../src/agent/agents/executor.js';
import { CodeAgent, getAugmentRegistry } from '../src/agent/agents/code.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { installFairPlay } from '../src/agent/fairplay/install.js';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';

function agentWith(custom = {}, build = () => {}) {
    setSettings({ allow_insecure_coding: true, code_timeout_mins: -1, relevant_docs_count: 1 });
    const w = fixtureWorld({ min: [-8, -2, -8], max: [8, 8, 8] });
    w.fill('stone', [-8, 0, -8], [8, 0, 8]);
    build(w);
    const bot = stubBot(w);
    bot._client = new EventEmitter();
    bot._client.write = () => { throw new Error('raw packet sent'); };
    bot.game = { gameMode: 'survival', dimension: 'overworld' };
    const chats = [];
    bot.chat = message => chats.push(message);
    bot.output = '';
    bot.interrupt_code = false;
    const agent = {
        name: 'FairCodeTest', bot, task: null, openChat: () => {},
        prompter: { profile: {}, getInitModes: () => ({}), promptCoding: () => { throw new Error('the model was called'); } },
        actions: {
            runAction: async (label, fn) => { await fn(); return { message: '' }; },
            getBotOutputSummary: () => bot.output,
        },
    };
    initModes(agent);
    installFairPlay(agent, {
        config: { fair_play: Object.keys(custom).length ? 'custom' : 'strict', fair_play_custom: custom, host: 'h', port: 1 },
        seenDir: mkdtempSync(path.join(tmpdir(), 'fair-code-')),
        perceptionOptions: { getStateId: w.getStateId, ...NO_BUDGETS },
    });
    const done = () => { bot.emit('end'); setWorldQueries(null); };
    return { agent, bot, chats, done, world: w };
}

test('C6a: !newAction code runs with the fair facade, not the raw bot', async () => {
    const { agent, chats, done } = agentWith();
    const coder = new Coder(agent);
    const staged = await coder._stageCode("return [typeof bot._client, typeof bot.world, typeof agent, typeof process];");
    assert.deepEqual(await staged.func.main(agent.bot), ['undefined', 'undefined', 'undefined', 'undefined'],
        'main() ignores the raw bot it is handed');
    const cheat = await coder._stageCode("bot.chat('/give @s diamond 64');");
    await assert.rejects(cheat.func.main(agent.bot), /Slash commands are off/);
    assert.deepEqual(chats, []);
    done();
});

test('C6b: executeCode runs without the agent or host globals', async () => {
    const { agent, done } = agentWith();
    const result = await new ExecutorCodeAgent(agent)._executeCode(
        'return [typeof agent, typeof process, typeof bot._client, typeof skills.collectBlock];');
    assert.deepEqual(result, ['undefined', 'undefined', 'undefined', 'function']);
    done();
});

test('C6c/C7: a generated augment runs in the runner, keeps named params and args, and writes no module', async () => {
    const { agent, done } = agentWith();
    const tool = new CodeAgent(agent)._registerFair(agent.fairPlay.codeRunner(), {
        augment_name: 'doubleIt', description: 'Doubles a number.',
        parameters: [{ name: 'n', type: 'integer', description: 'the number', required: true }],
    }, "return (typeof agent === 'undefined' && typeof process === 'undefined') ? n * 2 + args.n * 0 : -1;");
    assert.equal(getAugmentRegistry(agent).get('doubleIt'), tool);
    assert.equal(await tool.execute(agent, 21), '42');
    assert.deepEqual(tool.parameters, [{ name: 'n', description: 'the number', type: 'integer', is_required: true }]);
    assert.equal(existsSync(path.resolve('src/agent/commands/tools/augments/FairCodeTest-doubleIt.js')), false);
    done();
});

test('a custom switch means the same thing in generated code as it does for commands', async () => {
    // A diamond buried in a lump of stone: hidden under strict, findable when ores_through_walls is on.
    const buried = w => { w.fill('stone', [3, 1, -1], [5, 3, 1]); w.set('diamond_ore', 4, 2, 0); };
    const search = id => `return [bot.findBlocks({ matching: ${id}, maxDistance: 16, count: 5 }).length,
        world.getNearestBlocksWhere(bot, b => b.name === 'diamond_ore', 16, 5).length, bot.blockAt(new Vec3(4, 2, 0))?.name ?? null];`;

    const strict = agentWith({}, buried);
    const diamond = strict.world.registry.blocksByName.diamond_ore.id;
    assert.deepEqual(await new ExecutorCodeAgent(strict.agent)._executeCode(search(diamond)), [0, 0, null]);
    strict.done();

    const xray = agentWith({ ores_through_walls: true }, buried);
    assert.deepEqual(await new ExecutorCodeAgent(xray.agent)._executeCode(search(diamond)), [1, 1, 'diamond_ore']);
    xray.done();
});

test('before the bot has spawned, generated code is told nothing rather than raw data', async () => {
    const { agent, bot, done, world } = agentWith({}, w => w.set('diamond_ore', 3, 1, 0)); // in plain view
    const diamond = world.registry.blocksByName.diamond_ore.id;
    const runner = agent.fairPlay.codeRunner();
    agent.fairPlay.perception = null; // as it is between startup and the first spawn
    const result = await runner.compileBody([], `return [bot.findBlocks({ matching: ${diamond}, maxDistance: 16, count: 5 }).length,
        bot.blockAt(new Vec3(3, 1, 0)), Object.keys(bot.entities).length];`)();
    assert.deepEqual(result, [0, null, 0]);
    assert.equal(bot.findBlocks({ matching: diamond, maxDistance: 16, count: 5 }).length, 1, 'the raw bot does know');
    done();
});

test('with generated_code "off", code writing is refused before any model call', async () => {
    const { agent, done } = agentWith({ generated_code: 'off' });
    assert.match(await new Coder(agent).generateCode({ getHistory: () => [] }), /turned off by fair play/);
    assert.match(await new ExecutorCodeAgent(agent).executeTask('anything'), /turned off by fair play/);
    await assert.rejects(new CodeAgent(agent).generateAugment({ augment_name: 'x', description: 'd', parameters: [] }), /turned off/);
    done();
});

test('with generated_code "raw", CE runs code exactly as before (measuring only)', async () => {
    const { agent, done } = agentWith({ generated_code: 'raw' });
    assert.equal(agent.fairPlay.codeRunner(), null);
    const staged = await new Coder(agent)._stageCode('return typeof bot._client;');
    assert.equal(await staged.func.main(agent.bot), 'object');
    done();
});
