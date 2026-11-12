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
