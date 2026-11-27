// SPDX-License-Identifier: CC0-1.0
// Prompt caching for Claude's native tool requests.
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
