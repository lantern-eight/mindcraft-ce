import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { markForCache, cacheMarker } from '../src/models/prompt_cache.js';
import { sendToolRequest, toolCallMessage } from '../src/models/_tool_request.js';
import { Prompter } from '../src/models/prompter.js';
import { setSettings } from '../src/agent/settings.js';

// Claude's native tool requests carry cache markers at the end of the tools, the system prompt and the
// conversation so far, never on the fresh state sent once at the end.

const root = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), 'mindcraft-prompt-cache-'));
test.before(() => process.chdir(temporary));
test.after(() => { process.chdir(root); rmSync(temporary, {recursive: true, force: true}); });
test.beforeEach(() => setSettings({}));

const tools = ['stats', 'inventory', 'collectBlocks'].map(name => ({type: 'function', function: {
    name, description: `The ${name} tool`, parameters: {type: 'object', properties: {}},
}}));
const five = {type: 'ephemeral'};
function claude(replies) {
    const packs = [];
    const provider = {model_name: 'claude-test', anthropic: {messages: {create: pack => {
        packs.push(structuredClone(pack));
        return Promise.resolve(replies[Math.min(packs.length, replies.length) - 1]);
    }}}};
    return {provider, packs};
}
const markers = pack => JSON.stringify(pack).match(/cache_control/g)?.length || 0;
// A request as the cache sees it: markers aside, and string content as the one text block it stands for.
// (The API renders the two forms the same; r77tchan's measured hits relied on it.)
function unmarked(value) {
    if (Array.isArray(value)) return value.map(unmarked);
    if (value && typeof value.content === 'string' && value.role)
        return unmarked({...value, content: [{type: 'text', text: value.content}]});
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cache_control').map(([k, v]) => [k, unmarked(v)]));
}

test('markers go on the last tool, the system prompt and the last repeated message', () => {
    const body = markForCache({
        tools: [{name: 'a'}, {name: 'b'}],
        system: 'SYSTEM',
        messages: [{role: 'user', content: 'Steve: hi'}, {role: 'user', content: 'CURRENT STATE: hp 20'}],
    }, {uncachedTail: 1});
    assert.equal(body.tools[0].cache_control, undefined);
    assert.deepEqual(body.tools[1].cache_control, five);
    assert.deepEqual(body.system, [{type: 'text', text: 'SYSTEM', cache_control: five}]);
    assert.deepEqual(body.messages[0].content, [{type: 'text', text: 'Steve: hi', cache_control: five}]);
    assert.equal(body.messages[1].content, 'CURRENT STATE: hp 20');
    assert.equal(markers(body), 3);
});

test('a thinking block or an empty text block never carries a marker', () => {
    const thinking = {type: 'thinking', thinking: 'plan', signature: 'signed'};
    const body = markForCache({messages: [
        {role: 'user', content: 'hi'},
        {role: 'assistant', content: [{type: 'tool_use', id: 't1', name: 'stats', input: {}}, thinking, {type: 'text', text: ''}]},
    ]});
    assert.deepEqual(body.messages[1].content[0].cache_control, five);
    assert.deepEqual(body.messages[1].content[1], thinking);
    assert.equal(body.messages[1].content[2].cache_control, undefined);
    const onlyThinking = markForCache({messages: [{role: 'user', content: 'hi'}, {role: 'assistant', content: [thinking]}]});
    assert.deepEqual(onlyThinking.messages[0].content[0].cache_control, five);
    assert.deepEqual(onlyThinking.messages[1].content, [thinking]);
});

test('the setting picks the lifetime, and off leaves the request as it was', () => {
    const request = () => ({tools: [{name: 'a'}], system: 'SYSTEM', messages: [{role: 'user', content: 'hi'}]});
    assert.deepEqual(markForCache(request(), {setting: 'off'}), request());
    assert.deepEqual(markForCache(request(), {setting: '1h'}).tools[0].cache_control, {type: 'ephemeral', ttl: '1h'});
    setSettings({prompt_caching: 'off'});
    assert.equal(cacheMarker(), null);
    setSettings({prompt_caching: '1h'});
    assert.equal(cacheMarker().ttl, '1h');
    setSettings({});
    assert.deepEqual(cacheMarker(), five);
    assert.throws(() => cacheMarker('10m'), /prompt_caching/);
});

test('each step of a tool loop repeats the last one up to its marker, and marks only what is new', async () => {
    const call = {content: [{type: 'tool_use', id: 'tool-1', name: 'stats', input: {}}], stop_reason: 'tool_use'};
    const {provider, packs} = claude([call, {content: [{type: 'text', text: 'Done'}], stop_reason: 'end_turn'}]);
    const state = n => ({role: 'user', content: `CURRENT STATE: step ${n}`});
    const history = [{role: 'user', content: 'Steve: how are you?'}];
    const [text, calls] = await sendToolRequest(provider, [...history, state(1)], 'SYSTEM', tools, null, {uncachedTail: 1});
    history.push(toolCallMessage(text, calls), {role: 'tool', name: 'stats', tool_call_id: calls[0].id, content: 'Health 20'});
    await sendToolRequest(provider, [...history, state(2)], 'SYSTEM', tools, null, {uncachedTail: 1});

    for (const pack of packs) {
        assert.equal(markers(pack), 3);
        assert.equal(typeof pack.messages.at(-1).content, 'string', 'the fresh state carries no marker');
    }
    // The first request's marked start reappears byte for byte at the start of the second.
    const first = unmarked(packs[0]), second = unmarked(packs[1]);
    assert.deepEqual(second.tools, first.tools);
    assert.deepEqual(second.system, first.system);
    assert.deepEqual(second.messages[0], first.messages[0]);
    assert.ok(packs[1].messages[2].content[0].cache_control, 'the newest tool result is marked');
});

test('prompt caching off sends the request it sent before', async () => {
    setSettings({prompt_caching: 'off'});
    const {provider, packs} = claude([{content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn'}]);
    await sendToolRequest(provider, [{role: 'user', content: 'hi'}], 'SYSTEM', tools);
    assert.equal(markers(packs[0]), 0);
    assert.equal(packs[0].system, 'SYSTEM');
});

test('the prompter leaves the fresh state it adds out of the cache', async () => {
    setSettings({base_profile: 'assistant', num_examples: 0});
    const agent = {name: 'TestBot', history: {memory: ''}, blocked_actions: [], task: {},
        bot: {entity: {position: {x: 0, y: 64, z: 0}}, inventory: {}}};
    const prompter = new Prompter(agent, {name: 'TestBot', model: 'ollama/test', cooldown: 0});
    prompter.replaceStrings = prompt => Promise.resolve(prompt.startsWith('CURRENT STATE') ? 'CURRENT STATE: hp 20' : prompt);
    const {provider, packs} = claude([{content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn'}]);
    await prompter.requestTools([{role: 'user', content: 'Steve: hi'}], 'SYSTEM', tools, null, provider);
    assert.equal(packs[0].messages.at(-1).content, 'CURRENT STATE: hp 20');
    assert.deepEqual(packs[0].messages.at(-2).content, [{type: 'text', text: 'Steve: hi', cache_control: five}]);
});
