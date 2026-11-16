# Changelog

All notable changes to this fork are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are this fork's own. Each release names the Mindcraft-CE commit it is built on.

## [Unreleased]

### Fixed

- World memory keeps what a sign says. A sign was remembered without its text: memory asked for the
  block in a way the real bot can't answer, and the error was quietly passed over.
- The bot no longer stops answering when it stands in a biome the installed game data has no entry
  for, such as on a server newer than the data. Its status then says "Biome: unknown". Before, building
  the status failed, and every message got the "having trouble" reply.

## [0.7.0] - 2026-11-15

The bot plays Minecraft 26.3, on mineflayer and the libraries under it pinned to their open 26.3 work.
Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- Minecraft Java Edition 26.3, the current release. `minecraft_version` in `settings.js` is now `26.3`;
  set it to match your server, or to `"auto"`. The live tests run a 26.3 server and need Java 25. No
  mineflayer release supports 26.3 yet, so mineflayer and four of the libraries under it come from
  GitHub, pinned by commit to the open 26.3 work (listed in
  [Dependencies Pinned to a Branch](docs/core-hooks.md#dependencies-pinned-to-a-branch)). They go back to
  npm releases once those support 26.3.

### Fixed

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- On 26.3 the bot is no longer kicked with "Invalid move player packet received" soon after it starts
  walking. Mindcraft-CE holds back a position packet sent too soon after the last and sends it later; with a
  client that ends each game tick itself, as the 26.3 libraries do, that moved the packet into the next tick
  beside that tick's own, which 26.3 servers refuse. Such a client is no longer throttled.

## [0.6.0] - 2026-11-15

The bot plays Minecraft 26.1, and builders and `useDoor` know the newer woods and doors. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- Minecraft Java Edition 26.1 (26.1, 26.1.1 and 26.1.2). `minecraft_version` in `settings.js` is now
  `26.1.2`; set it to match your server, or to `"auto"`. The live tests run a 26.1.2 server and need Java 25.
  `minecraft-data` moves to 3.119.0, which fixes 26.1's list of entity attributes (the bot misread its own
  movement speed with 3.117.0).

### Fixed

- With `world_memory` off, a game update no longer brings remembered blocks back in the wrong state. The
  seen-world map saved each block's state as the game's number for it, and an update renumbers them, so a
  door could come back open, or a crop grown, though the bot had seen otherwise. The map now saves the game
  version, and under another version it keeps the blocks but not their states.

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- Builders use the wood they carry when a blueprint names none. Dark oak counted as oak, and a dark oak tree
  as a wood called "dark", so the bot went looking for oak. Pale oak and poplar are known woods too.
- `useDoor` finds copper, pale oak and poplar doors. Its list of doors predated them.

## [0.5.0] - 2026-11-15

Under fair play the bot plans its routes over what it has seen, not over every loaded block. Built on the
same Mindcraft-CE commit as 0.1.0.

### Added

- Fair legs: under fair play the bot plans its routes over what it has seen, not over every loaded block.
  The pathfinder used to know of caves the bot had never entered, how thick a hill was before digging into
  it, and where lava lay behind rock. Now a cell the bot has never seen counts as open ground, to walk
  through or stand on. The bot sets out straight for the goal, and plans again when the way ahead comes
  into view and is not as it believed. A wall it has seen before is walked round from the first step. Every
  command, skill and plugin that walks is covered. `"route_planning": "all"` in `fair_play_custom` gives
  the old planning back. See [How the Bot Plans a Route](docs/fair-play.md#how-the-bot-plans-a-route).

### Changed

- A trip to beyond the chunks the server has sent is planned at once. It used to end in "Path not found,
  but attempting to navigate anyway using destructive movements", because the pathfinder could not plan
  into chunks it had not been sent.
- Only mobs the bot knows of make a route cost more. A mob behind a wall used to count.

## [0.4.0] - 2026-11-15

A world keeps its memory and chest owners across LAN sessions, and travel and item pickup stop digging and
stalling where they had no need to. Built on the same Mindcraft-CE commit as 0.1.0.

### Changed

- World memory and the chest book follow the world, not the server's address. A world opened to LAN gets a new
  port every session, and the bot used to start over each time, forgetting even whose chests were whose. A world
  is now known by its seed, or by the `world_id` setting. Memory saved under the old address is carried over the
  first time the bot is back in that world, and the old folder is left as it was.

### Fixed

- After the bot's first death, world memory stopped marking the blocks it dug as its own, so a hole it dug
  itself could later be reported as a place that had changed. It now keeps track however often the bot dies.

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- Travel no longer gives up looking for a walkable route after 40 ms. `goToGoal` meant to search for a
  second, but read only the pathfinder's first slice, so a route that took longer to find counted as none and
  the bot dug and towered its way in a straight line instead.
- Travel no longer stalls at the turns of a tunnel one block wide. The pathfinder planned a diagonal step past
  the corner that the bot is too wide to take, stood still and planned it again; `goToGoal` now goes round
  such corners in two straight steps.
- Fetching dropped items no longer digs or places blocks to stand in the item's own cell. The bot walks to
  where it can reach the item, as a player would, and digs or places only when walking can't get close and
  the caller allows it (as mining does).

## [0.3.0] - 2026-11-14

The bot sorts chests, keeps whose each chest is, and can be told which chest to use. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- **Chest sorting.** One instruction and the bot tidies a player's chests, trapped chests and barrels:
  part stacks are merged, each kind of item is put together from the first slot, and related kinds (tools,
  food, minerals, wood and so on) share a chest. It is on by default, works with fair play on or off, and
  `chest_sorting: false` leaves the commands out. See `docs/chest-sorting.md`.
  - **Nothing is sorted by default.** The bot keeps whose each chest is (a player, `shared`, its own, or
    unknown) and how it may be sorted: `asked` (only when a player asks), `always`, or `never`. Players
    tell it, and the latest word wins.
  - `!sortChests(whose, distance)` sorts one owner's chests together, or with `approved` every chest
    marked `always`. `!sortChest(x, y, z)` sorts one chest by itself. `!chests(distance)` lists the chests
    the bot knows of. `!markChest` and `!markChests` record what a player says about one chest or about
    all the ones in view.
  - A sort never moves items between the chests of different owners, and covers only chests the bot can
    see from where it stands: "sort my chests" means the ones in this room.
  - Every sort ends by saying which chests it left alone and why, so the bot can ask whose an unclaimed
    chest is.
  - On its own idea the bot sorts only its own chests and those marked `always`. A player is never
    refused.
  - A chest the bot places is its own when that was its own idea, and the player's when it was doing what
    a player asked. One it digs up is forgotten.
  - A double chest is one chest. A full chest is sorted by swapping, so no free slot is needed.
  - A group of items stays in the chest that already holds most of it. Otherwise it goes to the chest
    that is least full for its size.
  - The bot's own inventory is left as it was: it carries chest items only in slots that were empty.
  - A chest within reach is opened from where the bot stands. It walks only to one it cannot reach, and
    that walk never digs or places a block.
  - If a chest changes while the bot works, it notices, puts down what it is carrying and plans again.
    A chest that will not open is left out and named. Nothing is lost either way.
- **Chest commands that say which chest.** `!viewChestAt(x, y, z)`, `!takeFromChestAt(x, y, z, item_name,
  num)` and `!putInChestAt(x, y, z, item_name, num)` look in, take from and put into the chest, trapped
  chest or barrel at a position, where `!viewChest`, `!takeFromChest` and `!putInChest` use whichever
  chest is nearest. They say whose the chest is, walk to it without digging or placing, and report
  what really moved when not all of it fitted. They come with chest sorting (`chest_sorting`).
- Live scenarios for chest sorting (`tests/live/storage_scenarios.js`), on a real server with no model
  calls: the server console fills the chests and reads them back itself. In a room several players
  share, every chest a sort was not approved for is checked to be slot for slot as it was.
- A scenario that tells the whole agent about chests in plain words (`tests/live/storage_agent_scenarios.js`):
  "that chest is mine", "sort my chests", "keep them tidy". It runs on recorded replies with no model.
  With `--live-model` it uses the model in `andy.json`, which costs money, and reports how often each
  step came out right over several runs.

## [0.2.0] - 2026-11-14

The bot remembers the world it has seen, and walks back the way it came. Built on the same Mindcraft-CE
commit as 0.1.0.

### Added

- **World memory.** The bot remembers the world the way a player who has been there does. It is on by
  default, needs fair play on, and `world_memory: false` turns it off. See `docs/world-memory.md`.
  - **Every block it has seen,** not only notable ones, per server, world and dimension.
  - **Things:** containers, workstations, doors, beds, signs, portals and ores, with their state and when
    they were last seen. A double chest, a bed and a door are each one thing.
  - **Container contents,** taken when the bot opens a container and again when it closes it.
  - **Fields and herds:** crops per area with how many were ripe, and the animals it saw.
  - **A trail** of where it has walked, which `!recall` uses to say how long a known way takes.
  - **Travel follows the trail.** A trip to somewhere the bot has been walks the way it came, in hops
    that neither dig nor place, instead of digging in a straight line. Every command and skill that
    walks does this by itself. A way found blocked is said once, and the bot looks for a way past.
  - **Places:** chests, workstations, beds, doors and signs close together become a site with no one
    having to save it, and it can be named later.
  - **Change notes:** when a place is not as the bot remembers it, one sentence is added to the result of
    the action it was doing, such as "Noticed at the base: Gone: chest 2. New: oak_planks 42."
- `!places` lists the places the bot knows and what is at each. `!namePlace` names the place it stands in.
- Live scenarios for world memory (`tests/live/memory_scenarios.js`, `tests/live/navigator_scenarios.js`),
  on a real server with no model calls.

### Changed

World memory is on by default, so each of these applies unless `world_memory` is set to `false`:

- `!recall` takes any text: a block type, a kind of thing ("chest", "door"), an item in the containers
  the bot opened ("iron"), an animal, a crop, a place name, or "changes". With world memory off it is
  unchanged.
- `!rememberHere` and `!goToRememberedPlace` keep their names as places in world memory. Places saved
  earlier are carried over, and nothing is lost if world memory is turned off again.
- Searches such as `!searchForBlock` remember every kind of block the bot has seen, not only notable
  ones.
- Every command and skill that walks follows the trail when the bot knows a way, as described above.
- The notable blocks remembered by earlier versions (under `bots/<name>/seen/`) are not carried into
  world memory, which starts from what the bot sees from now on. That file is left as it is, and is
  used again if world memory is turned off.

## [0.1.1] - 2026-11-13

Documentation only. Built on the same Mindcraft-CE commit as 0.1.0.

### Changed

- The README and `docs/core-hooks.md` say what to expect when merging an upstream update, including
  upstream changes to code this fork has replaced, which merge cleanly and then do nothing.

## [0.1.0] - 2026-11-13

The first version of this fork. Built on Mindcraft-CE's `agent-system` branch at commit `6a1ce8b`.

### Added

- **Fair play:** the bot may only know and do what a human survival player could. It is on by default
  (`fair_play: "strict"`), and `fair_play: "off"` gives stock behavior. See `docs/fair-play.md`.
  - **Perception.** Searches for blocks and mobs answer only with what the bot touches, sees in a straight
    line, remembers seeing, or hears. Players' name tags follow the vanilla rule: 64 blocks, unless
    sneaking.
  - **Memory of the world.** Notable blocks the bot has seen (ores, logs, sand, containers, workstations,
    beds, doors, crops) are remembered per server, world and dimension, exactly as last seen.
  - **`!recall` command.** The model can ask where it last saw a kind of block: where, how far, which way
    and how long ago.
  - **Hearing.** Sounds from sources the bot can't see are added to the `!entities` report with a direction
    and a rough distance, never coordinates.
  - **Reach guard.** Digging, placing, opening and hitting need the target within a survival player's reach
    (4.5 blocks, 3 for mobs) and in view.
  - **Locks.** Cheat mode stays off, slash commands are dropped before they reach the server, and the bot
    stops acting if it is made an operator or put outside survival mode.
  - **Switches.** `fair_play: "custom"` with `fair_play_custom` turns single rules off, to measure what
    each one is worth.
- A runner for model-written code that hands the code a stand-in for the bot. `!newAction`, the
  `executeCode` tool and generated augments all go through it when fair play is on.
- A lint test that fails when new code searches the bot directly instead of going through `world.js`.
- Live scenarios (`tests/live/fairplay_*.js`) that check fair play on a real server with no model calls.
- `docs/fair-play.md`, `docs/core-hooks.md`, `docs/setup.md` and this changelog.
- `ATTRIBUTION.md`, crediting the projects this fork builds on, and a CC0 1.0 dedication
  (`LICENSE-CC0`) for everything this fork adds. Inherited code stays under the MIT License.

### Changed

- Every block and entity search in `world.js` goes through one swappable provider. With fair play off the
  provider is the bot itself and nothing changes.
- Skills, reflexes and commands that searched the bot directly now go through `world.js`: finding a player
  by name, picking up items, finding a bed or a villager, and what the idle bot looks at.
- A search that finds nothing tells the model that this means "not seen", not "none nearby", when fair play
  is on.
- `!setMode` reports a refusal when a mode can't be changed, instead of claiming success.
- Agents created through the MindServer page or its API keep the fair-play settings, which are now listed
  in `settings_spec.json`.
- The README is rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to
  `docs/setup.md`.

### Fixed

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- `giveToPlayer`, `goToPlayer` and `followPlayer` no longer crash when the named player is not online.
- `goToBed` no longer mistakes bedrock for a bed.
- No `/skin` command is sent at login unless the profile sets a skin.
- `world.getNearestFreeSpace` rejects a spot with a block in it.
- `world.getNearestBlocksWhere` no longer returns an empty entry for a position it couldn't read.
- `useDoor` says so when there is no door nearby, instead of crashing.
- `useToolOn` tells the bot when it doesn't have the tool.
- `!stats` puts the current action on its own line.
- `giveToPlayer` no longer writes a stray number into its result.
- A blacklisted command is removed from the command list as well as from lookup.

### Security

- With fair play on, model-written code no longer receives the real bot, the agent, or host globals. This
  narrows what such code can do; it is not a full sandbox, and `allow_insecure_coding` stays off by default.

[Unreleased]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lantern-eight/mindcraft-ce/releases/tag/v0.1.0
