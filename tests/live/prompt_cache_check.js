// SPDX-License-Identifier: CC0-1.0
// Checks that Claude really reads its requests from its prompt cache. PAID: every run calls the
// Anthropic API (with the ANTHROPIC_API_KEY in keys.json or the environment), so it refuses to start
// without --paid. No game server is needed.
//   node tests/live/prompt_cache_check.js --paid [--model=claude-haiku-5-5] [--steps=6] [--caching=5m|1h]
//     [--path=tools|text]
//
// A cache that stops hitting fails silently: requests still succeed, they only cost more. The unit tests
// (tests/prompt_caching.test.js) check where the markers go; only a real call shows the API reads them. Run
// this after changing how a request is put together (src/models/prompter.js, _tool_request.js,
// prompt_cache.js, claude.js, the prompt templates). It plays one task of a few steps, with the real system
// prompt, answering each command with a made-up result: through Prompter.requestTools and the real tools
// (`--path=tools`, the default), or through Prompter.promptConvo and the legacy !command prompt
// (`--path=text`). It checks that:
//   - every call after the first reads from the cache the whole start the call before it marked;
//   - the fresh state at the end of each request carries no marker.
// Haiku 5.5 is the cheapest model to run it on; six steps cost a fraction of a cent.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Imported from the repository folder: keys.json is read from there when these load.
import { Prompter } from '../../src/models/prompter.js';
import { setSettings } from '../../src/agent/settings.js';
import { getToolDefinitions } from '../../src/agent/commands/tool_registry.js';
import { toolCallMessage } from '../../src/models/_tool_request.js';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!process.argv.includes('--paid')) {
    console.error('This check calls the Anthropic API and is billed. Run it with --paid to go ahead.');
    process.exit(2);
}
const model = option('model') || 'claude-haiku-5-5';
const steps = Number(option('steps') || 6);
const caching = option('caching') || '5m';
const route = option('path') || 'tools';
if (!Number.isSafeInteger(steps) || steps < 2) throw new Error('--steps must be a whole number, 2 or more');
if (!['5m', '1h'].includes(caching)) throw new Error('--caching takes 5m or 1h');
if (!['tools', 'text'].includes(route)) throw new Error('--path takes tools or text');
const textPath = route === 'text';

// The prompter keeps its files under ./bots; keep them out of the repository.
process.chdir(mkdtempSync(path.join(tmpdir(), 'mindcraft-cache-check-')));
setSettings({base_profile: 'assistant', num_examples: 0, blocked_actions: [], prompt_caching: caching,
    use_function_calling: !textPath});

// A stand-in agent: enough for the prompter to build the real conversing prompt and the fresh state.
let logs = 0, tick = 0;
const agent = {name: 'CacheCheck', history: {memory: 'Met a player at spawn. Base is a small oak house nearby.'},
    blocked_actions: [], task: {}, self_prompter: {isStopped: () => true}, bot: {entity: {position: {}}, inventory: {}}};
const prompter = new Prompter(agent, {name: 'CacheCheck', model: `anthropic/${model}`, embedding: false, cooldown: 0,
    use_function_calling: !textPath});
const replaceStrings = prompter.replaceStrings.bind(prompter);
// The live stats and inventory need a game; made-up ones change on every step, as real ones do.
const stats = () => `Health 20/20, food 20/20, position 3,64,${tick++}, time: day.\nNearby entities: Steve (player, 4 blocks).\n` +
    'Nearby blocks: oak_log, oak_leaves, grass_block, dirt, stone.';
prompter.replaceStrings = (template, ...rest) => template.startsWith('CURRENT STATE') && !textPath
    ? Promise.resolve(`CURRENT STATE (fresh, takes precedence over older observations):\n${stats()}\n` +
        `INVENTORY: oak_log x${logs}, wooden_axe x1`)
    : replaceStrings(template.replaceAll('$STATS', template.includes('$STATS') ? stats() : '')
        .replaceAll('$INVENTORY', `INVENTORY: oak_log x${logs}, wooden_axe x1`), ...rest);
prompter.convo_examples = {createExampleMessage: () => Promise.resolve(`Examples of how to respond:\nExample 1:\n` +
    `User: get ${logs + 1} dirt\nYour output: Sure! !collectBlocks("dirt", ${logs + 1})`)};
const system = await prompter.replaceStrings(prompter.profile.conversing, [],
    {createExampleMessage: () => Promise.resolve('Use the native function interface, not inline !commands.')});
const tools = getToolDefinitions(agent);

// Keep each request body and its usage, as sent and as billed.
const calls = [];
const messages = prompter.chat_model.anthropic.messages;
const create = messages.create.bind(messages);
messages.create = async (body, options) => {
    const response = await create(body, options);
    const u = response.usage;
    calls.push({body, uncached: u.input_tokens, read: u.cache_read_input_tokens || 0,
        written: u.cache_creation_input_tokens || 0, output: u.output_tokens, stop: response.stop_reason});
    return response;
};

const history = [{role: 'user', content: 'Steve: hey, can you gather 6 oak logs for me, one at a time please'},
    {role: 'system', content: 'You died earlier and respawned. Your items were dropped.'}];
for (let step = 0; step < steps && textPath; step++) {
    const reply = await prompter.promptConvo(history);
    history.push({role: 'assistant', content: reply});
    if (reply.includes('!collectBlocks')) history.push({role: 'system', content: `Collected 1 oak_log. You now have ${++logs}.`});
    else history.push({role: 'user', content: 'Steve: keep going'});
}
for (let step = 0; step < steps && !textPath; step++) {
    const [text, toolCalls] = await prompter.requestTools(history, system, tools, null, prompter.chat_model);
    history.push(toolCallMessage(text, toolCalls));
    if (!toolCalls.length) { history.push({role: 'user', content: 'Steve: keep going'}); continue; }
    for (const call of toolCalls) {
        if (call.name === 'collectBlocks') logs++;
        history.push({role: 'tool', name: call.name, tool_call_id: call.id,
            content: call.name === 'collectBlocks' ? `Collected 1 oak_log. You now have ${logs}.` : 'Done.'});
    }
}

calls.forEach((c, i) => console.log(`call ${i + 1}: prompt ${c.uncached + c.read + c.written} tokens = ` +
    `${c.read} read + ${c.written} written + ${c.uncached} uncached; output ${c.output}; ${c.stop}`));
const total = calls.reduce((t, c) => ({read: t.read + c.read, prompt: t.prompt + c.uncached + c.read + c.written}), {read: 0, prompt: 0});
const summary = {status: 'failed', model, caching, path: route, calls: calls.length, prompt_tokens: total.prompt,
    read_share: Math.round(100 * total.read / total.prompt) / 100};
try {
    assert.equal(calls.length, steps, 'one API call per step');
    for (const [i, c] of calls.entries()) {
        // On the text path the fresh state is the last block of the last user turn, after its marked turn.
        const last = textPath ? c.body.messages.at(-1).content.at(-1) : c.body.messages.at(-1);
        assert.ok(!JSON.stringify(last).includes('cache_control'), `call ${i + 1}: the fresh state must carry no marker`);
        if (textPath) assert.match(last.text, /^CURRENT STATE/, `call ${i + 1}: the fresh state comes last`);
        if (i === 0) continue;
        // What the call before marked (it read some and wrote the rest) is the start of this one.
        const marked = calls[i - 1].read + calls[i - 1].written;
        assert.ok(c.read >= marked, `call ${i + 1} read ${c.read} tokens from the cache; the call before marked ${marked}`);
    }
    summary.status = 'passed';
} finally {
    console.log(JSON.stringify(summary));
}
