# Core Hooks

Every edit this fork makes to a file that came from Mindcraft-CE is listed here. New code lives in
`src/agent/fairplay/` and needs no entry.

**Why this list exists:** when CE updates, merge it, then re-check each hook below and run the tests. A short
list keeps that a small job instead of a hunt.

**Finding a hook's commit:** each hook's commit message says `core hook N`, so
`git log --grep "core hook 3"` finds it, and `git log --oneline -- <file>` lists everything that touched a
file.

| # | File | What the hook does | Why it can't live in a new module |
|---|---|---|---|
| 1 | `src/agent/library/world.js` (plus the new `world_queries.js` beside it) | Every block and entity search in world.js (`findBlocks`, `blockAt`, `entities`, `nearestEntity`) goes through a swappable provider. The default is the raw bot, so stock behavior is unchanged. `getNearestBlocksWhere` also drops positions that come back without a block | All of CE's commands, skills, reflexes and prompts search through world.js, so one provider changes them all at once. The setter lives in `world_queries.js`, not world.js, because world.js is handed to generated code |
| 2 | `src/agent/agent.js` | One import and one call: `installFairPlay(this)` right after `initModes(this)` | Fair play needs the agent's bot, modes and action runner at startup. The install does nothing when `fair_play` is off |
| 3 | `src/agent/commands/actions.js` (`!setMode`) | Reports a refusal when `modes.setOn` returns `false`, instead of claiming the mode changed | The cheat-mode lock wraps `setOn`. Without this the model would be told cheat mode is on when it isn't |
| 4 | `settings.js` | New keys `fair_play`, `fair_play_custom`, `good_neighbor` (this fork's default is strict) | Settings live there |
| 5 | `src/agent/coder.js` (`generateCode`, `_stageCode`) | Asks `agent.fairPlay.codeRunner()` first: refuses early when code writing is off, otherwise evaluates `!newAction` code through the fair runner instead of a compartment holding the raw bot | The compartment is created inside `_stageCode`; there is no other place to swap what the code receives |
| 6 | `src/agent/agents/executor.js` (`executeTask`, `_executeCode`) | Same early refusal; runs `executeCode` bodies through the runner instead of host `new Function` with the agent | As above |
| 7 | `src/agent/agents/code.js` (`generateAugment`, new `_registerFair`) | Under fair play, augments are compiled by the runner and kept in memory, instead of written into `src/` and imported | As above |
