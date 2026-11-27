import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cacheLayout, markTextRequest } from '../src/models/prompt_cache.js';
import { Prompter } from '../src/models/prompter.js';
import { setSettings } from '../src/agent/settings.js';

process.env.ANTHROPIC_API_KEY ??= 'test-key-not-used';
const { Claude } = await import('../src/models/claude.js');

// The text path (legacy !command mode) for Claude: the system prompt without the parts that change each
// turn, marked for the cache with the conversation so far, and those parts sent once after the conversation.

const root = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), 'mindcraft-prompt-cache-text-'));
test.before(() => process.chdir(temporary));
test.after(() => { process.chdir(root); rmSync(temporary, {recursive: true, force: true}); });
test.beforeEach(() => setSettings({}));

const five = {type: 'ephemeral'};
const markers = pack => JSON.stringify(pack).match(/cache_control/g)?.length || 0;
const textOf = content => typeof content === 'string' ? content : content.map(block => block.text).join('');

function claude() {
    const model = new Claude('claude-test', null, {});
    const packs = [];
    model.anthropic = {messages: {create: pack => {
        packs.push(structuredClone(pack));
        return Promise.resolve({stop_reason: 'end_turn', content: [{type: 'text', text: 'ok'}]});
    }}};
    return {model, packs};
}

test('the parts that change leave the system prompt, in the template\'s order; the goal stays', () => {
    const layout = cacheLayout({anthropic: {}}, 'RULES\n$COMMAND_DOCS\n$SELF_PROMPT\nMemory: $MEMORY\n$STATS\n$INVENTORY\n$EXAMPLES\nBegin:');
    assert.equal(layout.system, 'RULES\n$COMMAND_DOCS\n$SELF_PROMPT\nMemory: (given at the end of the conversation)\n\n\n\nBegin:');
    assert.equal(layout.parts, "Summarized memory: '$MEMORY'\n$STATS\n$INVENTORY\n$EXAMPLES");
    assert.match(layout.fresh, /^CURRENT STATE .*:\nSummarized memory: '\$MEMORY'\n\$STATS/);
    assert.deepEqual(cacheLayout({anthropic: {}}, 'RULES $SELF_PROMPT'), {system: 'RULES $SELF_PROMPT', parts: '', fresh: ''});
    assert.equal(cacheLayout({anthropic: {}}, 'A $MEMORY $EXAMPLES', {keep: ['$EXAMPLES']}).system,
        'A (given at the end of the conversation) $EXAMPLES');
});

test('another provider, or prompt caching off, keeps the request as it was', () => {
    assert.equal(cacheLayout({}, 'RULES $STATS'), null);
    assert.equal(cacheLayout({anthropic: {}}, 'RULES $STATS', {setting: 'off'}), null);
});

test('the system prompt and the last repeated turn are marked; the fresh part comes after, unmarked', () => {
    const body = markTextRequest({system: 'SYSTEM', messages: [
        {role: 'user', content: 'Steve: hi'}, {role: 'assistant', content: 'Hi!'}, {role: 'user', content: 'Steve: get wood'},
    ]}, {fresh: 'CURRENT STATE: hp 20'});
    assert.deepEqual(body.system, [{type: 'text', text: 'SYSTEM', cache_control: five}]);
    assert.deepEqual(body.messages[2].content, [
        {type: 'text', text: 'Steve: get wood', cache_control: five},
        {type: 'text', text: 'CURRENT STATE: hp 20'},
    ]);
    assert.equal(markers(body), 2);
});

test('Claude\'s text requests repeat the last one up to its marker, and only when asked', async () => {
    const {model, packs} = claude();
    const turns = [{role: 'user', content: 'Steve: get wood'}];
    await model.sendRequest(turns, 'SYSTEM', {cache: {fresh: 'STATE 1'}});
    turns.push({role: 'assistant', content: '!collectBlocks("oak_log", 3)'});
    // The bot's own turn last: the closing turn and the fresh part stay out of the cache.
    await model.sendRequest(turns, 'SYSTEM', {cache: {fresh: 'STATE 2'}});
    turns.push({role: 'system', content: 'collectBlocks: Collected 3 oak_log.'});
    await model.sendRequest(turns, 'SYSTEM', {cache: {fresh: 'STATE 3'}});

    const [first, second, third] = packs;
    for (const pack of packs) assert.deepEqual(pack.system, [{type: 'text', text: 'SYSTEM', cache_control: five}]);
    assert.deepEqual(first.messages[0].content.at(-1), {type: 'text', text: 'STATE 1'});
    assert.deepEqual(second.messages.at(-1), {role: 'user', content: [{type: 'text', text: '_'}, {type: 'text', text: 'STATE 2'}]});
    assert.equal(second.messages[1].content[0].cache_control.type, 'ephemeral');
    assert.equal(textOf(second.messages[0].content), 'Steve: get wood');
    // The third repeats the second's marked start: the player's turn and the bot's command.
    assert.equal(textOf(third.messages[0].content), 'Steve: get wood');
    assert.equal(textOf(third.messages[1].content), '!collectBlocks("oak_log", 3)');
    assert.equal(textOf(third.messages[2].content.slice(0, 1)), 'SYSTEM: collectBlocks: Collected 3 oak_log.');
    assert.equal(third.messages[2].content.at(-1).text, 'STATE 3');

    packs.length = 0;
    await model.sendRequest([{role: 'user', content: 'Steve: hi'}], 'SYSTEM');
    assert.equal(markers(packs[0]), 0);
    assert.equal(packs[0].system, 'SYSTEM');
});

function prompter(model, extraSettings = {}) {
    setSettings({base_profile: 'assistant', num_examples: 0, blocked_actions: [], ...extraSettings});
    const agent = {name: 'TestBot', history: {memory: 'MEMORY TEXT'}, blocked_actions: [], self_prompter: {isStopped: () => true}};
    const p = new Prompter(agent, {name: 'TestBot', model: 'ollama/test', cooldown: 0, use_function_calling: false,
        conversing: 'RULES\nSummarized memory: $MEMORY\n$EXAMPLES\nBegin:'});
    p.chat_model = model;
    p.convo_examples = {createExampleMessage: () => Promise.resolve('EXAMPLE TEXT')};
    p._saveLog = () => Promise.resolve();
    return p;
}

test('the prompter sends Claude the per-turn parts after the conversation, and anyone else the whole prompt', async () => {
    const calls = [];
    const record = anthropic => ({...(anthropic ? {anthropic: {}} : {}), sendRequest: (...args) => { calls.push(args); return Promise.resolve('ok'); }});
    const turns = [{role: 'user', content: 'Steve: hi'}];

    await prompter(record(true)).promptConvo(turns);
    const [messages, system, options] = calls[0];
    assert.equal(messages, turns);
    assert.ok(!system.includes('MEMORY TEXT') && !system.includes('EXAMPLE TEXT'));
    assert.match(options.cache.fresh, /Summarized memory: 'MEMORY TEXT'\nEXAMPLE TEXT$/);

    calls.length = 0;
    await prompter(record(false)).promptConvo(turns);
    assert.equal(calls[0].length, 2);
    assert.equal(calls[0][1], 'RULES\nSummarized memory: MEMORY TEXT\nEXAMPLE TEXT\nBegin:');

    calls.length = 0;
    await prompter(record(true), {prompt_caching: 'off'}).promptConvo(turns);
    assert.equal(calls[0].length, 2);
});

test('on the tool path, Claude gets the memory summary with the fresh state, not in the system prompt', async () => {
    setSettings({base_profile: 'assistant', num_examples: 0, blocked_actions: []});
    const agent = {name: 'TestBot', history: {memory: 'MEMORY TEXT'}, blocked_actions: [], self_prompter: {isStopped: () => true}};
    const p = new Prompter(agent, {name: 'TestBot', model: 'ollama/test', cooldown: 0});
    p._saveLog = () => Promise.resolve();
    const packs = [];
    p.chat_model = {model_name: 'claude-test', anthropic: {messages: {create: pack => {
        packs.push(structuredClone(pack));
        return Promise.resolve({stop_reason: 'end_turn', content: [{type: 'text', text: 'ok'}]});
    }}}};
    await p.promptTools([{role: 'user', content: 'Steve: hi'}], []);
    const system = textOf(packs[0].system);
    assert.ok(!system.includes('MEMORY TEXT'), 'the summary is not in the system prompt');
    assert.match(system, /native function interface/, 'the fixed examples line stays in it');
    const last = packs[0].messages.at(-1);
    assert.equal(last.role, 'user');
    assert.match(textOf(last.content), /Summarized memory: 'MEMORY TEXT'/);
    assert.ok(!JSON.stringify(last).includes('cache_control'), 'the fresh part is not marked');
});
