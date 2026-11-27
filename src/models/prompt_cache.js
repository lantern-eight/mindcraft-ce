// SPDX-License-Identifier: CC0-1.0
// Prompt caching for Claude's requests: the native tool path, and the text path the legacy !command mode
// uses (see the end of this file).
//
// Claude reads a repeated start of a request from its cache, at a tenth of the input price or less, but only
// up to a block marked with cache_control. A request is laid out from what changes least to what changes
// most:
//
//   tools  ->  system prompt  ->  the conversation so far  ->  the fresh state (sent once, never again)
//
// and three of the four markers allowed go at the ends of the first three:
//
// - the last tool: the tool list changes only when the tool set does, so a new memory summary or goal in
//   the system prompt still finds the tools in the cache;
// - the system prompt;
// - the last block of the conversation that the next request will send again. In a tool loop the next
//   request is this one plus a turn or two, so it reads everything up to here and writes only what is new.
//
// The fresh state the prompter adds at the very end (stats, inventory) is new on every request and never
// sent again, so it is left after the last marker: writing it to the cache would cost a premium for nothing.
// A marker on less than a model's minimum (512 tokens on the newest models, more on some older ones) is
// ignored by the API without an error.
//
// The layout and the tools marker follow r77tchan/mindcraft (a cached system block, the changing part after
// the history) and appendix0/pincercraft (a marker on the last tool); see ATTRIBUTION.md.
import settings from '../agent/settings.js';

// prompt_caching: "5m" (the default) keeps an entry 5 minutes from its last use, "1h" an hour, "off" marks
// nothing. Reading an entry renews it, so "5m" is enough while a bot is busy; "1h" suits a bot that is
// spoken to with long pauses, at twice the price for each write.
const markers = { '5m': { type: 'ephemeral' }, '1h': { type: 'ephemeral', ttl: '1h' } };

// Content blocks that may carry a marker. A thinking block may not, and an empty text block is refused.
const markable = new Set(['text', 'image', 'tool_use', 'tool_result', 'document']);

export function cacheMarker(setting = settings.prompt_caching) {
    if (setting === undefined || setting === null) return markers['5m'];
    if (setting === 'off' || setting === false) return null;
    if (setting === true) return markers['5m'];
    if (!markers[setting]) throw new Error(`prompt_caching must be "5m", "1h" or "off", not ${JSON.stringify(setting)}`);
    return markers[setting];
}

// Mark the block a message ends on, if it can carry a marker. Returns whether it did.
function markMessage(message, marker) {
    if (typeof message.content === 'string') {
        if (!message.content) return false;
        message.content = [{ type: 'text', text: message.content, cache_control: marker }];
        return true;
    }
    if (!Array.isArray(message.content)) return false;
    for (let i = message.content.length - 1; i >= 0; i--) {
        const block = message.content[i];
        if (!markable.has(block?.type) || (block.type === 'text' && !block.text)) continue;
        message.content = message.content.map((b, j) => j === i ? { ...b, cache_control: marker } : b);
        return true;
    }
    return false;
}

// Adds cache markers to an Anthropic Messages request body and returns it. `uncachedTail` is how many
// messages at the end are sent once only. The body's own messages are replaced, not changed in place.
export function markForCache(body, { uncachedTail = 0, setting } = {}) {
    const marker = cacheMarker(setting);
    if (!marker) return body;
    if (Array.isArray(body.tools) && body.tools.length)
        body.tools = [...body.tools.slice(0, -1), { ...body.tools.at(-1), cache_control: marker }];
    if (typeof body.system === 'string' && body.system)
        body.system = [{ type: 'text', text: body.system, cache_control: marker }];
    if (Array.isArray(body.messages)) {
        body.messages = body.messages.map(message => ({ ...message }));
        // From the last message the next request repeats, back to the first that can carry a marker.
        for (let i = body.messages.length - 1 - uncachedTail; i >= 0; i--)
            if (markMessage(body.messages[i], marker)) break;
    }
    return body;
}

// The parts of a prompt template that change often. A system prompt that changes hides the whole conversation
// after it from the cache, so for Claude these parts are taken out of the system prompt and sent once, after
// the conversation, with the fresh state. Any template works this way, a profile's own included: nothing has
// to be marked in it.
//
// - The text path (legacy !command mode) puts everything in the system prompt: the stats and inventory read
//   this turn and the examples picked for this message.
// - Both paths put the memory summary there. It is rewritten whenever the stored history passes
//   max_messages, which during a task is every two or three steps, as each step stores two turns. A task
//   keeps every turn the new summary covers in its own history, so the model loses nothing by reading the
//   summary after the conversation instead of before it.
//
// The goal ($SELF_PROMPT) changes only when one is set or dropped, so it stays in the cached system prompt.
// Each part's line in the fresh block, where it needs a label of its own to make sense there.
const changing = { '$STATS': '$STATS', '$INVENTORY': '$INVENTORY', '$EXAMPLES': '$EXAMPLES', '$CODE_DOCS': '$CODE_DOCS',
    '$ACTION': '$ACTION', '$MEMORY': "Summarized memory: '$MEMORY'" };
const freshHeading = 'CURRENT STATE (fresh, takes precedence over older observations):';

// How to lay out a request from `template` for `model`, or null to send it as before: for a model other
// than Claude, or with prompt_caching off. `system` is the template without its changing parts (the first
// leaves a note in its place). `parts` is a template of those parts alone, in the template's own order, and
// `fresh` the same under a heading, to fill in and send after the conversation; both are empty for a
// template without any. `keep` names placeholders to leave in the system prompt (the tool path's fixed
// examples line).
export function cacheLayout(model, template, { setting, keep = [] } = {}) {
    if (!model?.anthropic || typeof template !== 'string' || !cacheMarker(setting)) return null;
    const found = Object.keys(changing).filter(placeholder => template.includes(placeholder) && !keep.includes(placeholder))
        .sort((a, b) => template.indexOf(a) - template.indexOf(b));
    let system = template;
    found.forEach((placeholder, i) =>
        system = system.replaceAll(placeholder, i === 0 ? '(given at the end of the conversation)' : ''));
    const parts = found.map(placeholder => changing[placeholder]).join('\n');
    return { system, parts, fresh: parts ? `${freshHeading}\n${parts}` : '' };
}

// Marks a text request body for the cache and puts the filled-in `fresh` text after the conversation, as a
// last block of its own in the last user turn, past the marker. `uncachedTail` is how many messages at the
// end are sent once only (a closing turn). Returns the body; its own messages are replaced, not changed.
export function markTextRequest(body, { fresh = '', uncachedTail = 0, setting } = {}) {
    body = markForCache(body, { uncachedTail, setting });
    if (!fresh) return body;
    const messages = body.messages.map(message => ({ ...message }));
    const last = messages.at(-1);
    if (last?.role !== 'user') messages.push({ role: 'user', content: fresh });
    else last.content = [...(typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content),
        { type: 'text', text: fresh }];
    body.messages = messages;
    return body;
}

// What the prompter calls for a text request: fills `template` with `fill` (its replaceStrings) and returns
// the system prompt to send, the text to log, and `send(messages)`, which sends it to `model`. For Claude with
// prompt caching on, the per-turn parts are filled in separately and go after the conversation; otherwise it
// is the request the prompter always sent.
export async function fillTextRequest(model, template, fill) {
    const layout = cacheLayout(model, template);
    const prompt = await fill(layout ? layout.system : template);
    const fresh = layout?.fresh ? await fill(layout.fresh) : '';
    return {
        prompt,
        logged: fresh ? `${prompt}\n${fresh}` : prompt,
        send: messages => layout
            ? model.sendRequest(messages, prompt, { cache: { fresh } })
            : model.sendRequest(messages, prompt),
    };
}
