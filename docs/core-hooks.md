# Core Hooks

Every edit this fork makes to a file that came from Mindcraft-CE is listed here. New code lives in
`src/agent/fairplay/` and `src/agent/memory/` and needs no entry.

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
| 4 | `settings.js`, `src/mindcraft/public/settings_spec.json` | New keys `fair_play`, `fair_play_custom`, `good_neighbor` (this fork's default is strict) and `world_memory` (on by default), in both files | Settings live there. They must also be in `settings_spec.json`: MindServer removes any setting that isn't listed there from agents created through its page or API, which would switch fair play off without a word |
| 5 | `src/agent/coder.js` (`generateCode`, `_stageCode`) | Asks `agent.fairPlay.codeRunner()` first: refuses early when code writing is off, otherwise evaluates `!newAction` code through the fair runner instead of a compartment holding the raw bot | The compartment is created inside `_stageCode`; there is no other place to swap what the code receives |
| 6 | `src/agent/agents/executor.js` (`executeTask`, `_executeCode`) | Same early refusal; runs `executeCode` bodies through the runner instead of host `new Function` with the agent | As above |
| 7 | `src/agent/agents/code.js` (`generateAugment`, new `_registerFair`) | Under fair play, augments are compiled by the runner and kept in memory, instead of written into `src/` and imported | As above |
| 8 | `src/agent/commands/queries.js` (`!entities`) | Adds one line per sound the bot heard but can't see the source of, from `agent.fairPlay.heardLines()`. Nothing is added when fair play is off | `!entities` is what the model reads about its surroundings every turn, and its text is built inside the command |
| 9 | `src/agent/library/skills.js`, `src/agent/modes.js`, `src/agent/commands/actions.js`, `src/agent/vision/vision_interpreter.js`; one new helper `getPlayerEntity` in `world.js` | The last places that searched the bot directly now call `world.*`: finding a player by name (give, go to, follow, attack, look at), dropped items, beds, a villager by id, and what the idle bot stares at. Stock behavior is unchanged. `tests/fairplay_raw_search_lint.test.js` fails if a new raw search appears | These calls are inside CE's skills and reflexes. Until they ask `world.js`, they bypass whatever provider is installed |
| 10 | `src/agent/commands/index.js` | New `registerCommand(command)`: adds a command to the same map and list the built-in ones live in | Fair play adds a `!recall` command only when it is on. Without this the command would have to be written into CE's lists and exist for everyone |
| 11 | `src/agent/library/skills.js` (`goToGoal`; plus the new `travel_guide.js` beside it) | One import and one call at the top of `goToGoal`: `await followKnownWay(bot, goal, log)`. With no guide installed it does nothing, so stock travel is unchanged. A module can install a guide that first walks the bot along a way it already knows; `goToGoal` then plans the rest from wherever that left the bot | Every command and skill that walks ends in `goToGoal`, so one call there covers them all. The setter is kept out of `skills.js` because that file is handed to generated code, which could otherwise swap the guide |

## Replaced Pieces

Inherited code that this fork steps around when one of its own features is on. Git can't warn about
these: an upstream change to one merges cleanly, the tests pass, and the change has no effect here.

**After every upstream merge, read what upstream changed in these and carry over what matters:**
`git diff <old upstream>..<new upstream> -- <file>`.

| Inherited piece | Stepped around by | When | Upstream changes to look for |
|---|---|---|---|
| How model-written code is run: the compartment in `src/agent/coder.js`, the `new Function` call in `src/agent/agents/executor.js`, and augment modules written to disk by `src/agent/agents/code.js` | `src/agent/fairplay/code_runner.js` and `fair_bot.js` | `fair_play` on, unless `generated_code` is `"raw"` | What generated code is handed, how it is checked, timed out or stored. A new object given to that code must also be given, in a fair form, by the runner |
| The bot's own block and entity searches behind `src/agent/library/world.js` | The provider in `world_queries.js`, answered by `src/agent/fairplay/fair_queries.js` | `fair_play` on | A new kind of search added to `world.js`. The lint test catches a raw call; a new provider method needs a fair answer too |
| Anything that sends a slash command, and the cheat mode in `src/agent/modes.js` | The chat guard and mode lock in `src/agent/fairplay/install.js` | `fair_play` on | A new feature that relies on a command or on cheat mode. It will be dropped without an error under fair play |
| Mindcraft-CE's task harness (`settings.task`), which needs an operator bot | Every action is refused, with the reason, by `install.js` | `fair_play` on | Nothing to carry over. Listed so the refusal is no surprise |
| Saved places: the `MemoryBank` in `src/agent/memory_bank.js`, behind `!rememberHere`, `!goToRememberedPlace` and the saved-places query | `placeBank` in `src/agent/memory/install.js`, which offers the same five calls and keeps the names as places in world memory. The original bank is kept underneath and still holds everything | `world_memory` on | A new method on `MemoryBank`, or a new caller that expects one. The stand-in would not have it. No inherited file is edited for this: the stand-in is swapped in on `agent.memory_bank` |
| How a walk is planned: the two path searches and the walk in `goToGoal` (`src/agent/library/skills.js`) | `src/agent/memory/navigator.js`, called through `travel_guide.js`. It walks the bot along the trail first; `goToGoal` still plans whatever is left, so it is stepped around only for the part of a trip the bot knows a way for | `world_memory` on, and the bot has walked a way that leads there | A change to the movement settings `goToGoal` builds: which blocks may not be broken, and the costs of digging and placing. The navigator's own "careful" settings, used to get past a blockage, are a copy of them. Also any new way of walking that does not go through `goToGoal` |
| What the bot remembers seeing (this fork's own seen-world map, `src/agent/fairplay/seen_map.js`) | The store in `src/agent/memory/`, filled by `recorder.js` | `world_memory` on | Nothing upstream: both are this fork's. Listed so a change to one is checked against the other |

Add a row whenever a new feature takes over from inherited code. Keep the takeover in this fork's own
module with a small hook in the inherited file, so that most upstream edits to that code show up as a
conflict instead of passing silently.

## Housekeeping Edits

These inherited files are also changed, with no effect on how the bot behaves:

| File | Change |
|---|---|
| `README.md` | Rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to `docs/setup.md` |
| `package.json`, `package-lock.json` | A `version` field for this fork's own releases, and a `license` field naming both licenses |
| `.gitignore` | Ignores `plans/`, the folder for private working notes |
