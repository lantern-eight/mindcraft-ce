# Core Hooks

Every edit this fork makes to a file that came from Mindcraft-CE is listed here. New code lives in
`src/agent/fairplay/`, `src/agent/memory/`, `src/agent/storage/` and `src/agent/edition/` and needs no
entry.

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
| 13 | `src/utils/mcdata.js` (`isHuntable`) | One import and one call: whether a mob is a baby is asked of the edition seam (`editionOf(mcdata).isBaby(mob)`) instead of read from `mob.metadata[16]`. Java's answer reads that same entry, so stock behavior is unchanged | Where the game keeps a mob's age differs by edition, and `isHuntable` is what the hunting reflex in `modes.js` asks. Elsewhere the reflex would take a calf for a cow |
| 14 | `src/utils/mcdata.js` (new `villagerOf`), `src/agent/library/world.js` (`getVillagerProfession`), `src/agent/library/skills.js` (`findAndGoToVillager`), `src/agent/commands/queries.js` (`!entities`) | Whether a mob is a villager, whether it is a child, and its job and level are asked of the edition seam through `mc.villagerOf(entity)`, instead of read from its name and its metadata. `!entities` counts villagers under the name `villager` whatever the game calls them. Java's answer reads the same entries, so stock behavior is unchanged | Each edition names villagers and keeps their facts in its own place. Read Java's way elsewhere, `!entities` lists no jobs and the trading commands throw before they reach the villager |
| 15 | `src/utils/mcdata.js` (new `javaNameOf`), `src/agent/library/skills.js` (`breakBlockAt`, `placeBlock`, `digDown`, `useToolOnBlock`), `src/agent/modes.js` (`self_preservation`) | Where a block in front of the bot is checked against one of Mindcraft's lists of Java names (what may be built over, what is water, lava or fire, what not to step back for), the block's name is first put in Java's terms by the edition seam through `mc.javaNameOf(name)`. Java's answer is the name itself, so stock behavior is unchanged | Bedrock names some of those blocks its own way: `flowing_water`, `flowing_lava`, `snow_layer` for Java's `snow`, `golden_rail`. Read Java's way, `placeBlock` digs out a thin layer of snow and builds over a whole block of it, and a block named `flowing_lava` is not lava to `digDown` or the self-preservation reflex |

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
| The plugin that makes the bot eat when it is hungry, `mineflayer-auto-eat`, loaded in `src/utils/mcdata.js` and set up in `src/agent/agent.js` | `src/agent/bedrock/eating.js`, put at `bot.autoEat` by `initBedrockBot` | `minecraft_edition` is `"bedrock"` | A newer version of the plugin that decides differently when or what to eat, or new options the agent passes to `setOpts`. The eater reads `minHunger`, `minHealth`, `priority`, `bannedFood` and `returnToLastItem` and ignores the rest |

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
| `minecraft-data` | `lantern-eight/node-minecraft-data` `aa55657` | 26.3 game data. Release 3.119.0 with its data folder taken from `lantern-eight/minecraft-data` `e1bcac8`: PrismarineJS/minecraft-data#1345, merged with the 3.119.0 data, plus two fixes of this fork's: the 26.2 and 26.3 entity attribute lists (the 1.21 list, so movement speed was read under the wrong name), and Bedrock's biome numbers from 1.21.60 (the table numbered biomes alphabetically, where a Bedrock chunk carries Bedrock's own numbers, so every biome was named wrong). The data is checked in as files, not a submodule, because npm installs a GitHub dependency from a tarball, which has no submodules | A minecraft-data release has 26.3 with both fixes |

The `bedrock` branch pins more libraries, for Bedrock Edition, and its copy of this file lists them here,
under "For Bedrock Edition". `main` installs none of them.

## Hooks for Bedrock Edition

The Bedrock code lives in `src/agent/bedrock/`, behind the `minecraft_edition` setting, and the hooks
below are how inherited files reach it. They are numbered apart
from the table at the top (`B1`, `B2`, ...), so a hook added for Java Edition can never take the same number;
a commit message says `core hook B2`. With `minecraft_edition` set to `"java"` (`main`'s default;
the `bedrock` branch defaults to `"bedrock"`), none of them changes anything.

| # | File | What the hook does | Why it can't live in a new module |
|---|---|---|---|
| B1 | `settings.js`, `src/mindcraft/public/settings_spec.json` | New key `minecraft_edition`, `"java"` or `"bedrock"`, in both files. `main` defaults to `"java"`; the `bedrock` branch to `"bedrock"`, with `minecraft_version` `"auto"` and `port` 19132 beside it | Settings live there. As with hook 4, a setting missing from `settings_spec.json` is dropped from agents made through MindServer's page or API, and a Bedrock bot made that way would start as a Java one |
| B2 | `src/utils/mcdata.js` (`initBot`) | One import, and one line at the top of `initBot` that hands a Bedrock bot to `initBedrockBot` and returns what it made. Beside it, a three-line `useGameData`, which points this file's game data at the registry it is given | `initBot` is where every bot is made, and the game data the rest of the code reads through this file is private to it. On Bedrock that data has to be the bot's own registry: the server gives items and block states their numbers when the bot joins. Everything else `initBot` does is for Java and is skipped: the Fabric handshake, the position-packet throttle, the filter for unreadable Java packets, the seed read from Java's login packet |
| B3 | `src/mindcraft/mindcraft.js` (`createAgent`) | One import, and one line in front of the server lookup: on Bedrock the settings go through `bedrockServer` instead, and the inherited `try` gains an `else` | The lookup asks the server what it is in Java's protocol. A Bedrock server doesn't answer, so the lookup would wait out its timeout, warn, and clear a version of `"auto"`. Doing it here also means a version that can't work (a Java one left in the settings) fails the agent with a message before a process is started for it |
| B4 | `src/agent/library/skills.js` (`goToBed`) | The test for "is this block a bed" also takes a block named just `bed` | Bedrock Edition has one bed block for every color, named `bed`, where Java has a block per color, each ending in `_bed`. The skill picks its bed by name in a line of its own, written so that `bedrock` is not taken for one, and a second name has to go on that same line. No Java block is named `bed`, so nothing changes there |
| B5 | `src/utils/mcdata.js` (`HAND_OPENED_DOORS`), `src/agent/library/skills.js` (`useDoor`) | The list of doors a hand opens also names `wooden_door`; and whether a door is open is read from `open`, or else `open_bit` | Bedrock Edition calls the oak door `wooden_door` and keeps a door's open state as `open_bit` (0 or 1). Without the name, `useDoor` with no position found no oak door; without the state, it took every Bedrock door for shut, so it shut an open one and walked into it. The list already names doors a game may not have, so on Java the extra name matches nothing, and a Java door has `open`, so `open_bit` is never read there |

**One plugin is left out on Bedrock.** `mineflayer-auto-eat` can't be loaded there: a helper it loads compares
the game version with Java version numbers and stops, and the plugin itself eats by writing Java packets.
The agent sets eating up by name when it starts, so `initBedrockBot` puts this fork's own eater at
`bot.autoEat`, with the same switches and the same starting numbers (`src/agent/bedrock/eating.js`). It
is listed under [Replaced Pieces](#replaced-pieces): a change to how the plugin decides to eat has to be
carried over by hand.

## Housekeeping Edits

These inherited files are also changed, with no effect on how the bot behaves:

| File | Change |
|---|---|
| `README.md` | Rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to `docs/setup.md` |
| `package.json`, `package-lock.json` | A `version` field for this fork's own releases, and a `license` field naming both licenses. `mineflayer` and `minecraft-data` come from GitHub, and `overrides` pin `minecraft-protocol`, `prismarine-chunk` and `prismarine-physics` the same way, for Minecraft 26.3 (see [Dependencies Pinned to a Branch](#dependencies-pinned-to-a-branch)) |
| `.gitignore` | Ignores `plans/`, the folder for private working notes |
| `tests/live/vanilla_fixture.js` | Passes `-DbundlerRepoDir` from `tests/helpers/server_jar_cache.js`, so every throwaway server shares one folder for what the server jar unpacks on first start (`server_data/jar-cache`; `MC_TEST_JAR_CACHE` picks another, `off` turns it off) |
| `settings.js` | `minecraft_version` is `26.3`, the game version this fork is tested on (Mindcraft-CE's is `1.21.6`) |
| `tests/live/*.js`, `tests/gameplay_reliability.test.js` | The live scenarios take the game version from `tests/helpers/game_version.js` instead of each naming `1.21.11`, and need Java 25 as 26.1 does. The tool-speed test also checks 26.1's and 26.3's data, and its stand-in bot has the two methods newer mineflayer's digging calls |
