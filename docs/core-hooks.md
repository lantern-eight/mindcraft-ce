# Core Hooks

Every edit this fork makes to a file that came from Mindcraft-CE is listed here. New code lives in
`src/agent/fairplay/`, `src/agent/memory/` and `src/agent/storage/` and needs no entry.

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
| 4 | `settings.js`, `src/mindcraft/public/settings_spec.json` | New keys `fair_play`, `fair_play_custom`, `good_neighbor` (this fork's default is strict), `world_memory` and `chest_sorting` (both on by default), in both files | Settings live there. They must also be in `settings_spec.json`: MindServer removes any setting that isn't listed there from agents created through its page or API, which would switch fair play off without a word |
| 5 | `src/agent/coder.js` (`generateCode`, `_stageCode`) | Asks `agent.fairPlay.codeRunner()` first: refuses early when code writing is off, otherwise evaluates `!newAction` code through the fair runner instead of a compartment holding the raw bot | The compartment is created inside `_stageCode`; there is no other place to swap what the code receives |
| 6 | `src/agent/agents/executor.js` (`executeTask`, `_executeCode`) | Same early refusal; runs `executeCode` bodies through the runner instead of host `new Function` with the agent | As above |
| 7 | `src/agent/agents/code.js` (`generateAugment`, new `_registerFair`) | Under fair play, augments are compiled by the runner and kept in memory, instead of written into `src/` and imported | As above |
| 8 | `src/agent/commands/queries.js` (`!entities`) | Adds one line per sound the bot heard but can't see the source of, from `agent.fairPlay.heardLines()`. Nothing is added when fair play is off | `!entities` is what the model reads about its surroundings every turn, and its text is built inside the command |
| 9 | `src/agent/library/skills.js`, `src/agent/modes.js`, `src/agent/commands/actions.js`, `src/agent/vision/vision_interpreter.js`; one new helper `getPlayerEntity` in `world.js` | The last places that searched the bot directly now call `world.*`: finding a player by name (give, go to, follow, attack, look at), dropped items, beds, a villager by id, and what the idle bot stares at. Stock behavior is unchanged. `tests/fairplay_raw_search_lint.test.js` fails if a new raw search appears | These calls are inside CE's skills and reflexes. Until they ask `world.js`, they bypass whatever provider is installed |
| 10 | `src/agent/commands/index.js` | New `registerCommand(command, { action })`: adds a command to the same map and list the built-in ones live in. With `action: true` it also joins the list `isAction` answers from, so the agent treats it like a built-in action | A module's command should exist only while its feature is on (fair play's `!recall`, for one). Without this it would have to be written into CE's lists and exist for everyone. The action flag is there because the agent stops prompting itself when a player's message leads to an action, and it finds that out by asking `isAction` |
| 11 | `src/agent/library/skills.js` (`goToGoal`; plus the new `travel_guide.js` beside it) | One import and one call at the top of `goToGoal`: `await followKnownWay(bot, goal, log)`. With no guide installed it does nothing, so stock travel is unchanged. A module can install a guide that first walks the bot along a way it already knows; `goToGoal` then plans the rest from wherever that left the bot | Every command and skill that walks ends in `goToGoal`, so one call there covers them all. The setter is kept out of `skills.js` because that file is handed to generated code, which could otherwise swap the guide |
| 12 | `src/agent/agent.js` | One import and one call: `installStorage(this)` right after `installFairPlay(this)` | Chest sorting adds its commands when the agent starts, and only when `chest_sorting` is on. It is its own call, not part of the fair-play one, because it works with fair play off |

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
| What the pathfinder is told about the world while it plans a route: `getBlock`, `getNeighbors` and `updateCollisionIndex` of the `Movements` class in the mineflayer-pathfinder library, as Mindcraft-CE patches it (`patches/mineflayer-pathfinder+2.4.5.patch`) | `src/agent/fairplay/fair_legs.js`, which replaces those three methods on the class when the bot starts and answers from what the bot has seen. No file of the library or of Mindcraft-CE is edited, and no patch is added. A bot without fair legs gets the library's own methods | `fair_play` on, unless `route_planning` is `"all"` | A newer pathfinder, or a change to Mindcraft-CE's patch of it: how `getBlock` decides that a block can be walked through or stood on; how `getNeighbors` builds a slantwise step; any new place where planning reads the world or the list of mobs; and whether each step of a route still keeps its cell in `hash`. `tests/fairplay_legs.test.js` runs the real search and fails when these drift |
| What the bot remembers seeing (this fork's own seen-world map, `src/agent/fairplay/seen_map.js`) | The store in `src/agent/memory/`, filled by `recorder.js` | `world_memory` on | Nothing upstream: both are this fork's. Listed so a change to one is checked against the other |

Add a row whenever a new feature takes over from inherited code. Keep the takeover in this fork's own
module with a small hook in the inherited file, so that most upstream edits to that code show up as a
conflict instead of passing silently.

## Dependencies Pinned to a Branch

Libraries that `package.json` takes from a commit on GitHub instead of an npm release, because a fix or a
newer game version is not released yet. Each goes back to the npm release as soon as one has the change.

All are forks under `lantern-eight`, on a branch named `pc26_3-combined`, pinned by commit. Each fork branch
holds exactly the upstream work named below, so the commits stay reachable whatever happens to the branches
they came from. `overrides` in `package.json` make every package in the tree use the same copy.

| Package | Pinned to | Why | Back to npm when |
|---|---|---|---|
| `mineflayer` | `lantern-eight/mineflayer` `ad4af12` | Minecraft 26.3. The head of PrismarineJS/mineflayer#4206 (26.3 branch `pc26_3` with master and the open 26.3 fixes merged). Mindcraft-CE's `patches/mineflayer+4.39.0.patch` applies to it unchanged | A mineflayer release lists 26.3 |
| `minecraft-protocol` | `lantern-eight/node-minecraft-protocol` `3473413` | 26.3 packets, including the stepped entity-move encoding. The head of PrismarineJS/node-minecraft-protocol#1553 | A minecraft-protocol release lists 26.3 |
| `prismarine-chunk` | `lantern-eight/prismarine-chunk` `a96fd70` | 26.2 and 26.3 chunk mapping and light masks. The head of PrismarineJS/prismarine-chunk#347 | A release maps 26.3 |
| `prismarine-physics` | `lantern-eight/prismarine-physics` `e641ceb` | 26.3's liquid gravity. PrismarineJS/prismarine-physics#145 merged onto master | A release has #145 |
| `minecraft-data` | `lantern-eight/node-minecraft-data` `194d7f6` | 26.3 game data. Release 3.119.0 with its data folder taken from `lantern-eight/minecraft-data` `cf005a2`: PrismarineJS/minecraft-data#1345, merged with the 3.119.0 data, plus this fork's fix of the 26.2 and 26.3 entity attribute lists (the 1.21 list, so movement speed was read under the wrong name). The data is checked in as files, not a submodule, because npm installs a GitHub dependency from a tarball, which has no submodules | A minecraft-data release has 26.3 with the attribute fix |

### For Bedrock Edition

This branch plays Bedrock Edition, and no released mineflayer does. The work for it is unmerged and spread
over several people's forks, so each library below is a branch named `bedrock-combined` on a fork under
`lantern-eight`, pinned by commit. Each one is **the 26.3 commit from the table above with the Bedrock work
merged in**, so one install serves both editions and the Java tests keep running here. Where the table
above and this one name the same package, this one is what `package.json` installs.

| Package | Pinned to | What it is | Back to npm when |
|---|---|---|---|
| `mineflayer` | `lantern-eight/mineflayer` `4422a45` | `ad4af12` (26.3) with the Bedrock edition adapter merged in: the proof of concept from PrismarineJS/mineflayer#4145, branch `feat/bedrock-edition-adapter` of `Pix3lPirat3/mineflayer` at `b24015a`. One conflict, the list of tested versions in `lib/version.js`. Mindcraft-CE's `patches/mineflayer+4.39.0.patch` applies unchanged; it patches Java plugins only | A mineflayer release has Bedrock support and 26.3 |
| `prismarine-registry` | `lantern-eight/prismarine-registry` `9f6206a` | The head of PrismarineJS/prismarine-registry#57, unchanged. It turns the block ids a current Bedrock server sends, which are hashes, into blocks | A release has #57 |
| `prismarine-chunk` | `lantern-eight/prismarine-chunk` `51132c7` | `a96fd70` (26.3) with PrismarineJS/prismarine-chunk#335, #337 and #338 merged: Bedrock 1.26 chunks, hashed ids on block writes, zero-bit palettes. The only conflicts were in `test/bedrock.test.js`, where each adds a test | A release has all three and maps 26.3 |
| `prismarine-block` | `lantern-eight/prismarine-block` `e4fcd1c` | The head of PrismarineJS/prismarine-block#129, unchanged: a block's states and shapes when ids are hashes | A release has #129 |
| `prismarine-physics` | `lantern-eight/prismarine-physics` `81b4157` | `e641ceb` (26.3) with PrismarineJS/prismarine-physics#152 merged: Bedrock's walking numbers. #152 is a draft. One conflict, in a comment | A release has #145 and #152 |
| `mineflayer-pathfinder` | `lantern-eight/mineflayer-pathfinder` `ee36727` | Release 2.4.5 with the one commit of PrismarineJS/mineflayer-pathfinder#388 on top: sorting Bedrock blocks into fences, carpets and the rest. It starts from the release, not from master, because Mindcraft-CE's patch is made for the release | A release has #388. Mindcraft-CE's patch is for 2.4.5 and will need redoing for it |
| `bedrock-protocol` | npm release `3.61.0`, named in `overrides` | Not a fork. mineflayer asks for `^3.59.0`, and on Node 22 npm picks 3.59.0, the newest release whose `engines` field allows Node 22. That one cannot reach a current server, which speaks the NetherNet transport added in 3.60.0. 3.61.0 asks for Node 24 but runs on Node 22: a login over each transport was checked | mineflayer asks for 3.61.0 or later, or this fork moves to Node 24 |

`minecraft-data` needs nothing more: the pin in the table above is release 3.119.0, which has Bedrock data up
to 1.26.60.

**When a pin in the first table moves,** the matching `bedrock-combined` branch has to be merged again on
top of the new commit, and its pin here moved too. `tests/bedrock_stack.test.js` checks the installed set as
a whole.

**Two patches had to move.** patch-package places a change by its exact line number, and the Bedrock work
adds lines above two of Mindcraft-CE's patches: 22 lines in `prismarine-block`'s `index.js`, 3 in the
pathfinder's `lib/movements.js`. The patch files here have the new line numbers and are otherwise as
Mindcraft-CE wrote them. Going back to an npm release moves them back.

**Installing.** npm warns that `bedrock-protocol` and two packages under it want Node 24; they run on
Node 22. `raknet-native`, which `bedrock-protocol` brings in for the transport older servers speak, ships a
built binary only for Windows on x64 and for older Linux and macOS on x64. Anywhere else, Apple silicon and
current Linux included, its install step builds the binary with CMake, and `npm install` fails if CMake is
missing. `SKIP_BUILD=1 npm install` skips that build. Nothing is lost for now: current Bedrock servers speak
the other transport, and without the binary `bedrock-protocol` falls back to a JavaScript one.

## Housekeeping Edits

These inherited files are also changed, with no effect on how the bot behaves:

| File | Change |
|---|---|
| `README.md` | Rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to `docs/setup.md` |
| `package.json`, `package-lock.json` | A `version` field for this fork's own releases, and a `license` field naming both licenses. `mineflayer` and `minecraft-data` come from GitHub, and `overrides` pin `minecraft-protocol`, `prismarine-chunk` and `prismarine-physics` the same way, for Minecraft 26.3 (see [Dependencies Pinned to a Branch](#dependencies-pinned-to-a-branch)). On this branch the pins are the Bedrock set: `mineflayer-pathfinder` comes from GitHub too, and `overrides` also pin `prismarine-registry`, `prismarine-block` and the `bedrock-protocol` release |
| `.gitignore` | Ignores `plans/`, the folder for private working notes |
| `patches/prismarine-block+1.23.0.patch`, `patches/mineflayer-pathfinder+2.4.5.patch` | Line numbers moved to fit the Bedrock branches of those two libraries (see [For Bedrock Edition](#for-bedrock-edition)). The changes they make are untouched |
| `tests/live/vanilla_fixture.js` | Passes `-DbundlerRepoDir` from `tests/helpers/server_jar_cache.js`, so every throwaway server shares one folder for what the server jar unpacks on first start (`server_data/jar-cache`; `MC_TEST_JAR_CACHE` picks another, `off` turns it off) |
| `settings.js` | `minecraft_version` is `26.3`, the game version this fork is tested on (Mindcraft-CE's is `1.21.6`) |
| `tests/live/*.js`, `tests/gameplay_reliability.test.js` | The live scenarios take the game version from `tests/helpers/game_version.js` instead of each naming `1.21.11`, and need Java 25 as 26.1 does. The tool-speed test also checks 26.1's and 26.3's data, and its stand-in bot has the two methods newer mineflayer's digging calls |
