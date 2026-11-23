# Prompt Caching

Every call to the model sends the tool list, the bot's instructions and the conversation so far, and most of
that is the same as on the call before. Model providers can read a repeated start of a request from a cache
instead of processing it again: cheaper (a tenth of the input price or less on Claude) and quicker to answer.
This page says how this fork lays out a request so that its start repeats, and how Claude is told what to
cache.

## The Layout

A native tool request (the default, `use_function_calling: true`) goes from what changes least to what changes
most:

| Part | Changes when |
|---|---|
| The tools | The tool set changes (a blocked action, a new augment), or another role asks (the Brain's tools differ from the Task's) |
| The system prompt: the profile's instructions, then the current goal and the memory summary at its end | A goal is set or dropped, or the history is summarized |
| The conversation so far: player messages, the bot's replies and tool calls, tool results, and system notes (deaths, mode changes) where they happened | It only grows during a task; summarizing cuts its start |
| The fresh state: stats, nearby entities and blocks, inventory | Every call. It is sent once and never kept |

Two things used to break this, for every provider, and are fixed:

- The system prompt held a second copy of the whole tool list, about 7,000 tokens, besides the tools field.
  It now says the tools come through the native interface; the `help` tool still prints the list.
- For Claude and Gemini, every system note in the history was added to the end of the system prompt, so the
  system prompt changed on every conversation. The notes now stay where they happened, as user turns
  marked `SYSTEM:`.

OpenAI, DeepSeek and Gemini 2.5 and later cache a repeated start by themselves, and local servers (Ollama,
llama.cpp, LM Studio, vLLM) reuse the work they did for one. They need nothing more than the layout.

## Claude

Claude caches only what a request marks. `src/models/prompt_cache.js` puts three markers (of the four
allowed) on every native tool request to Claude:

1. the last tool, so a changed goal or memory summary still finds the tools in the cache;
2. the end of the system prompt;
3. the last block of the conversation that the next call will send again, which leaves the fresh state out.

During a task each call is the last one plus a turn or two, so it reads everything up to its newest turn
from the cache and writes only that turn. Writing costs a quarter more than plain input (twice as much with
the one-hour lifetime), and a read a tenth or less, so a cached start pays for itself on the second call.

`prompt_caching` in `settings.js`:

| Value | What it does |
|---|---|
| `"5m"` (default) | A cached start lasts 5 minutes from its last use. Each call renews it, so a busy bot keeps it |
| `"1h"` | An hour, for a bot spoken to with long pauses. Writing costs twice the input price instead of 1.25 times |
| `"off"` | No markers: the request is sent as it was before prompt caching |

## Checking That It Works

Usage is counted per role (conversation, task, brain, and so on) and shown with the bot's state on the
MindServer: `cached` is the input tokens read from the cache. In a task of
several steps, `cached` should soon be most of `input`. If it stays at zero:

- The request may be shorter than the model's minimum for caching (512 tokens on the newest Claude models,
  up to 4,096 on some older ones). The API ignores the markers then, with no error.
- Something early in the request changes on every call. Set `log_all_prompts` and compare two prompts.

## Known Limits

- Between two conversations the history is stored as text ("Tool call ..." lines and `SYSTEM` results), while
  a task sends tool calls as structured turns. The first call of a new conversation therefore reads only the
  tools and system prompt from the cache, not the turns of the last task.
- The legacy `!command` mode (`use_function_calling: false`) puts stats and inventory inside its system
  prompt, so only its start before them can repeat, and Claude's text requests carry no markers yet.
- A cache belongs to one model. Roles set to different models (`brain_model`, `task_model`) each keep their
  own.
