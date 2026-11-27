import test from 'node:test';
import assert from 'node:assert/strict';
import { sendToolRequest } from '../src/models/_tool_request.js';

// System notes in the conversation (tool results kept in the history, deaths, mode changes) stay where they
// happened. Claude and Gemini take one system prompt, and gluing the notes onto it put them out of order and
// changed the system prompt on every conversation.

// The text of a system prompt or a message, whether sent as a string or as text blocks (prompt caching
// sends marked parts as blocks).
const textOf = content => typeof content === 'string' ? content : content.map(block => block.text).join('');

const tools = [{type: 'function', function: {name: 'stats', description: 'Stats', parameters: {type: 'object', properties: {}}}}];
const history = [
    {role: 'user', content: 'Steve: get wood'},
    {role: 'assistant', content: 'Tool call collectBlocks: {"type":"oak_log","num":3}'},
    {role: 'system', content: 'collectBlocks: Collected 3 oak_log.'},
    {role: 'user', content: 'Steve: thanks'},
];

test('Claude gets a system note in place, and the system prompt alone', async () => {
    const packs = [];
    const provider = {model_name: 'claude-test', anthropic: {messages: {create: pack => {
        packs.push(pack);
        return Promise.resolve({content: [{type: 'text', text: 'ok'}]});
    }}}};
    await sendToolRequest(provider, history, 'TEMPLATE', tools);
    assert.equal(textOf(packs[0].system), 'TEMPLATE');
    assert.deepEqual(packs[0].messages.map(m => m.role), ['user', 'assistant', 'user', 'user']);
    assert.equal(textOf(packs[0].messages[2].content), 'SYSTEM: collectBlocks: Collected 3 oak_log.');
    assert.equal(textOf(packs[0].messages[3].content), 'Steve: thanks');
});

test('a conversation that opens with a system note still starts on a user turn', async () => {
    const packs = [];
    const provider = {model_name: 'claude-test', anthropic: {messages: {create: pack => {
        packs.push(pack);
        return Promise.resolve({content: [{type: 'text', text: 'ok'}]});
    }}}};
    await sendToolRequest(provider, [{role: 'system', content: 'You died.'}, {role: 'user', content: 'Steve: hi'}], 'TEMPLATE', tools);
    assert.equal(packs[0].messages[0].role, 'user');
    assert.equal(textOf(packs[0].messages[0].content), 'SYSTEM: You died.');
});

test('Gemini gets a system note in place, and the system instruction alone', async () => {
    const packs = [];
    const provider = {model_name: 'gemini-test', genAI: {models: {generateContent: pack => {
        packs.push(pack);
        return Promise.resolve({text: 'ok', functionCalls: [], candidates: [{content: {parts: []}}]});
    }}}};
    await sendToolRequest(provider, history, 'TEMPLATE', tools);
    assert.equal(packs[0].config.systemInstruction, 'TEMPLATE');
    assert.deepEqual(packs[0].contents.map(c => c.role), ['user', 'model', 'user', 'user']);
    assert.deepEqual(packs[0].contents[2].parts, [{text: 'SYSTEM: collectBlocks: Collected 3 oak_log.'}]);
});
