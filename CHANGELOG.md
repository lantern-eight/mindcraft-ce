# Changelog

All notable changes to this fork are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are this fork's own. Each release names the Mindcraft-CE commit it is built on.

## [Unreleased]

## [1.2.0-bedrock.1.3.0] - 2026-11-18

A release for both editions. World memory no longer takes a change that happened in plain view for news, and
the seen-world map that stood in when world memory is off is gone. Fixes to inherited skills, NPC goals, the
Novita provider and the MindServer, most of them also offered to Mindcraft-CE. Built on the same Mindcraft-CE
commit as 0.1.0.

### Removed

- The seen-world map, the smaller memory that stood in when `world_memory` is off. With world memory off,
  the bot now remembers nothing out of view and has no `!recall`, and an empty-handed search no longer
  points it at memory it doesn't have. The `bots/<name>/seen/` folders it saved are no longer read and can
  be deleted. World memory, on in the shipped settings, is unchanged.

### Fixed

- Item goals for things that can't be crafted, such as raw meat, wool or an ore's drop, no longer crash, and
  hunting for one runs. The goal treated "no recipe" as a list of recipes, and the hunting loop stored each
  attack's result in a variable it never declared.
- `craftRecipe` says so when it has no free spot for its crafting table, or the table can't be placed, and
  crafts nothing. It crashed on the missing spot, and after a failed placement tried the recipe with no table.
- `craftRecipe` asked for something with no crafting recipe, such as raw meat or a misspelled name, says so
  instead of crashing.
- Worn armor is no longer counted as carried. `!inventory` listed a worn helmet twice, once among the items
  and once under WEARING, and recipes counted it as material in the bag. An NPC goal for a piece of armor is
  still met by one the bot wears.
- With a Novita model, a conversation too long for the model is retried without its oldest turn, as meant.
  The retry crashed instead.
- A Bedrock agent set to a version that can't work no longer stays listed on the MindServer with no process
  behind it, its name refused when tried again from the page.
- `!attack` with no mob type says so, instead of pausing the bot's cowardice and looking for a mob with no
  name.
- After `!attackPlayer`, the bot says which player it killed, instead of "Successfully killed player."
- World memory no longer reports a change that happened in plain view as news, on either edition. A bot that
  stood a quiet minute looking at a wall took the wall coming down for something that happened while it was
  away, and a block it had not seen for minutes could count as watched because others near it were in view.

## [1.1.1-bedrock.1.2.1] - 2026-11-17

A documentation release for both editions; the code is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- `docs/upstream.md`: every fix this fork has offered back to Mindcraft-CE and to the libraries it uses, each
  linked to its pull request, and how to work on a fix in one of the library forks.
- The README lists what each Java live test script checks. `docs/bedrock.md` notes quirks of the Bedrock server
  that need no fix, and a few things that can make a Bedrock test run fail for reasons outside the bot.

## [1.1.0-bedrock.1.2.0] - 2026-11-17

A release for both editions. On Bedrock Edition, fair play holds the bot to a Bedrock player's reach, `digDown`
after a walk takes the bot down its hole, Mindcraft's lists of Java block names hold for Bedrock's names, a loom
keeps the dyes it doesn't use, the bot eats as the game's client does, and a hungry bot that isn't eating says
why. The loom and eating fixes are in the Bedrock adapter, which the `bedrock` branch now pins. On Java Edition,
the reach switches now start at `"survival"`, the game's own reach, which is the same 4.5 and 3 as before. The
Bedrock live tests gain a ready-made server to run against. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- A throwaway Bedrock server for the Bedrock live tests, ready to start: `tests/live/bedrock-server/` holds its
  Docker Compose file and a console script that also works on an Apple silicon Mac, where the server image's
  own console command can't find the server. `tests/live/bedrock_all.js` runs all seven Bedrock live scripts in
  turn, each into its own log, with a line for each. `tests/live/bedrock_spawn_check.js` shows what stands at
  the test world's spawn and, with `--clear`, takes it away: leftovers there lift the spawn, and the scenes with
  it, until several scripts fail at once while building them. `docs/bedrock.md` says how to use all three.

### Fixed

- On Bedrock, a loom keeps the dyes a pattern doesn't use. Given a stack of dye, the Bedrock adapter put the
  whole stack into the loom and used one, and the server kept the rest. The fix is in the Bedrock adapter,
  which the `bedrock` branch now pins. The enchanting table, the grindstone and the smithing table were
  checked on a server too, and work.
- On Bedrock, `digDown` straight after a walk takes the bot down the hole it digs. A walk can leave a Bedrock
  bot up to a third of a block off the middle of its block, standing partly on the next one, so it dug the
  hole and stayed on top. Before it digs the block under its feet, the bot now steps to the middle of its
  block, as a player would.
- On Bedrock, Mindcraft's lists of blocks, written in Java's names, now hold: `placeBlock` builds over a thin
  layer of snow and treats a block of snow as in the way (Bedrock calls them `snow_layer` and `snow`; before,
  it dug out the layer and built over the block), and the checks for water and lava in `digDown`,
  `breakBlockAt` and the reflex that keeps the bot alive take Bedrock's `flowing_water` and `flowing_lava` for
  water and lava too. Each check asks for the Java name of the block in front of the bot.

### Changed

- On Bedrock, fair play's reach guard holds the bot to a Bedrock player's reach: 5 blocks to a block and 3 to a
  mob. It used Java's numbers, 4.5 and 3, so a block a Bedrock player could dig was out of the bot's reach.
  The `reach_blocks` and `reach_entities` switches now start at `"survival"`, the reach of the game being
  played; a number set by hand still wins.
- On Bedrock, the bot eats the way the game's own client does: it marks the moment it starts eating, and lets
  go of the food when a meal doesn't finish, so the server doesn't still have it eating when the next meal
  starts. The change is in the Bedrock adapter, which the `bedrock` branch now pins.
- On Bedrock, a hungry bot that isn't eating now says why in its log: a window is open, it is asleep, a meal
  is still under way, it holds nothing it may eat, its hunger can't be read, or the game's ticks have stopped
  so it never looks. Each reason is repeated at most every 30 seconds.

## [1.0.0-bedrock.1.1.0] - 2026-11-17

A Bedrock Edition release: the bot can trade with villagers and knows which biome it is in, takes and puts
amounts spread over several stacks, and says why a meal failed. The fixes are in the libraries: the Bedrock
adapter and the pathfinder, which the `bedrock` branch now pins, and the game data, which both branches pin.
Java Edition is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- On Bedrock, the bot can make a trade with a villager (`tradeWithVillager`). The Bedrock adapter marked one
  part of its request to the server with the number that part had before 1.26.60, so the server dropped
  every trade; the `bedrock` branch now pins an adapter that reads the number from the game version, and this
  fork no longer refuses trades.

### Changed

- On Bedrock, taking from and putting into a chest, a barrel or a shulker box moves the amount asked for from
  as many stacks as it takes, and tops up a stack of the same item before it uses an empty slot, as on Java.
  Before, taking an amount spread over two stacks stopped part way and said the inventory had no room. The
  fix is in the Bedrock adapter, which the `bedrock` branch now pins.
- On Bedrock, the pathfinder no longer moves the bot to the middle of its block when it stops: the server
  refuses that move and corrects the bot. The bot now stays where it stopped. The fix is in the pathfinder,
  which the `bedrock` branch now pins.
- On Bedrock, a meal that fails or gets stuck is now said in the bot's log: which step (taking the food in
  hand, or eating it) and why. Before, a bot that stayed hungry with food in its pockets gave no reason. The
  same message is repeated at most every 30 seconds.

### Fixed

- On Bedrock, the bot knows which biome it is in. It was always "unknown": the Bedrock adapter never read
  biomes from the chunks a current server sends, and the game data numbered Bedrock's biomes alphabetically
  where a chunk carries Bedrock's own numbers. Both are fixed in the libraries, which `main` (the game data)
  and the `bedrock` branch (the adapter) now pin.

## [1.0.0-bedrock.1.0.2] - 2026-11-17

A Bedrock Edition patch: four mistakes in the Bedrock adapter that this fork had worked around are now fixed
in the adapter itself, which the `bedrock` branch now pins, and the workarounds are gone. Java Edition is
unchanged. Built on the same Mindcraft-CE
commit as 0.1.0.

### Changed

- On Bedrock, taking from and putting into a barrel or a shulker box is done by the Bedrock adapter's own
  calls, as for a chest. The adapter now names those containers' slots as Bedrock does; this fork had made
  the moves itself until it did.
- On Bedrock, a barrel opened again straight after it was closed (as chest sorting does) opens as soon as
  the server has shut it, instead of on a second click a second later. The Bedrock adapter now waits for
  that itself.
- On Bedrock, the bot's `move` event, from which world memory lays its trail, comes from the Bedrock adapter
  on every tick the bot moves or turns, as on Java. This fork had fired it itself until the adapter did.
- On Bedrock, closing a villager's trade screen, and not handing back another villager's trades when one
  opens nothing, are done by the Bedrock adapter. This fork had put both right itself until it did.

## [1.0.0-bedrock.1.0.1] - 2026-11-17

A Bedrock Edition patch: a steadier live test, and how to run the Bedrock test server on an Apple silicon
Mac. Java Edition is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Fixed

- The Bedrock skills live test no longer fails now and then on shearing a sheep. A plain summon on Bedrock
  makes a lamb one time in twenty, which can't be sheared, and wool of another color went uncounted once the
  bot had picked it up. The scene now summons an adult sheep and counts wool of any color.

### Changed

- [docs/bedrock.md](docs/bedrock.md#a-throwaway-server) says how to run the throwaway Bedrock server on an
  Apple silicon Mac: under Docker Desktop's emulation the image's console command can't find the server, and
  the page gives one that can.

## [1.0.0-bedrock.1.0.0] - 2026-11-16

Version 1, of both editions. Bedrock Edition joins the project: its code is on `main` with Java Edition's,
behind the `minecraft_edition` setting, and runs on the libraries the `bedrock` branch pins, which are not
released with Bedrock support yet. A version now has a part for each edition: Java Edition's 1.0.0, Bedrock
Edition's 1.0.0. For Java Edition this release brings fixes only. Built on the same Mindcraft-CE commit as
0.1.0.

### Added

- A setting, `minecraft_edition`: `"java"` (the default on `main`) or `"bedrock"` (the default on the
  `bedrock` branch, with `minecraft_version` `"auto"` and `port` 19132). Set to `"bedrock"`, the bot is
  started for a Bedrock Edition server: `minecraft_version` is then a Bedrock version such as `"1.26.60"`
  (or `"auto"`), a port of `-1` means Bedrock's usual 19132, and `auth: "microsoft"` signs in with an Xbox
  account. A Java version left in `minecraft_version` is refused with a message that says what to set. This
  is the connection; the lines below say what else works on Bedrock.
- On `main`, which doesn't install the Bedrock libraries, a bot set to Bedrock stops at once with a message
  that says to use the `bedrock` branch, or to set `minecraft_edition` to `"java"`. Before the libraries
  were checked, it failed deep inside mineflayer.
- The bot can join a current Bedrock Dedicated Server. Servers from 1.26.60 take a direct connection through
  a short HTTP exchange on their game port, which no released `bedrock-protocol` speaks; the open upstream
  work for it is now part of the pinned set. Checked against a dedicated server on 1.26.60: the bot joins,
  spawns in survival, reads the blocks around it and chats. The server shows a key during that exchange. The
  bot accepts it and prints it; a stock server makes a new key at every start, so there is nothing to
  compare it with.
- [docs/bedrock.md](docs/bedrock.md): what works on Bedrock Edition, what doesn't, how to try it, and how to
  test it. A live test, `tests/live/bedrock_smoke.js`, runs against a throwaway Bedrock server: joining,
  seeing blocks, chat, walking, digging, placing, a chest and crafting. It passes on 1.26.60 and on 1.26.63,
  which speaks the same protocol. The whole agent was also started there and answered a player through a
  model.
- A second live test, `tests/live/bedrock_skills.js`, runs Mindcraft's stock skills on a throwaway Bedrock
  server, each in a scene of its own, and checks the world afterwards. All 39 scenes pass on 1.26.63 with
  fair play off: gathering and mining, building, crafting, smelting, chests, farming, fighting, sleeping,
  doors, buckets, villagers, and walking to, following and handing things to another player.
  [docs/bedrock.md](docs/bedrock.md#skills) lists the skills, and the one that doesn't work yet.
- A Bedrock bot eats when it is hungry, as the Java bot does. The plugin that does it on Java can't be
  loaded on Bedrock, so the Bedrock module has its own, with the same switches and the same numbers: it eats
  the most filling food it holds that isn't on the banned list, then holds again what it held before.
- A chest opened on Bedrock is the same kind of object as on Java, with `deposit`, `withdraw` and `close` on
  it, so code written for Java chests has something to work with.
- On Bedrock the bot can use an item it just crafted, and an item it just took out of a chest. Both were
  refused by the server: the Bedrock adapter lost the number the server gives each stack. Fixed in the
  mineflayer branch the `bedrock` branch pins.
- On Bedrock a click on a block is no longer ignored when the block changed after the bot looked it up. A
  Bedrock click names the block it lands on, and the adapter named the one it was handed, not the one that
  is there. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock a block put back where the bot dug stays there. The server was never told that the bot had let
  go of a block it broke, and kept breaking whatever turned up in that spot next, leaving an item on the
  ground each time. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the bot no longer hangs in the air beside a hole. When the bot stops walking, the pathfinder
  shifts it to the middle of its block; a Bedrock server refuses that, and the adapter took only the height
  from the server's answer. The two then disagreed about where the bot stood, and at the rim of a hole it
  fell and was put back up without end. A bot that is standing still now goes where the server says it is,
  so after a walk it may stand a little off the middle of its block. Fixed in the mineflayer branch the
  `bedrock` branch pins.
- On Bedrock the bot can fill a bucket and empty one. Bedrock wants a bucket used on the water or the block
  in view, and the adapter used it in the air. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the bot no longer stops short of where it walks after a pause. When the bot had been busy for a
  moment (looking around for a door, say), the adapter made up every tick it had missed in one step, and the
  bot jumped ahead of where the server had it. The walk counted itself done there, and a second later the
  server pulled the bot back to where it started. So `useDoor` stopped short of the door, and shearing a
  sheep sometimes did nothing. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the stock crafting skill works, in the bot's own grid and at a crafting table. A Bedrock server
  sends its recipes when the bot joins, and the adapter keeps them in a layout of its own; the skills now
  get them in the layout they have on Java, a recipe that takes "any planks" included.
- On Bedrock the bot can till soil and plant on it. A click on a block now waits, for a moment at most,
  until the bot has seen what the click did. Code written for Java sends the next click straight away, and a
  Bedrock server ignores a click that still names the block from before.
- On Bedrock the bot finds a bed to sleep in. Bedrock has one bed block for every color, named `bed`; the
  skill looked only for Java's names, which end in `_bed`.
- The bot's status says "Biome: unknown" on Bedrock. Biomes are not read there yet, and the bot stopped with
  an error when it built its status for the model.
- Fair play's sight works on Bedrock. With fair play on, the bot knew blocks it could not have seen, such as
  the ground under its feet and ore inside rock: Bedrock numbers block states by hash, and fair play's list
  of what hides what came out empty. It now knows only what is in view, as on Java. A new live test,
  `tests/live/bedrock_perception.js`, checks it on a server.
- With fair play on, a Bedrock bot hears a mob cry out when it is hurt or dies, as a direction and a rough
  distance, and notices when the server makes it an operator. Both listened for Java's packets only. A mob's
  everyday noises are still not heard: a Bedrock client makes those up itself, and the server never sends
  them.
- World memory keeps a Bedrock world's files apart from other worlds', by a hash of the seed the server
  sends. Before, every Bedrock world was told apart only by the server's address.
- World memory works on Bedrock in part. It remembered a door's state as nonsense, and didn't know a Bedrock
  bed, spawner or beetroot for what they are: it read block states the way Java numbers them, and knew only
  Java's names. It now reads Bedrock's states, and judges Bedrock's names by the Java blocks they stand for,
  while keeping Bedrock's names. A double chest is one thing, paired by what its two blocks say of each
  other, which on Bedrock is not in their states. A new live test, `tests/live/bedrock_memory.js`, checks it
  on a server.
- A live test, `tests/live/bedrock_fair_play.js`, runs fair play as a whole on a Bedrock server, installed
  the way the agent installs it: skills that find and walk to only what the bot has seen, the reach guard,
  the reflex to flee a monster once it is in view, model-written code, refusing to act as an operator or in
  creative mode, and never sending a command. It passes on 1.26.60.
- Chest sorting works on Bedrock. A move in a chest is one item stack request there, not clicks on a cursor,
  and a barrel's slots go by another name than a chest's, which the server holds a request to. A new live
  test, `tests/live/bedrock_storage.js`, sorts a chest of part stacks, a full chest, and a chest, a double
  chest, a barrel and a trapped chest together on a server, and takes from and puts into a chest by name. It
  passes on 1.26.60.
- World memory works on Bedrock as the agent runs it. A new live test,
  `tests/live/bedrock_memory_scenarios.js`, installs it with fair play on a Bedrock server and checks what
  the bot is told: a double chest opened and walked away from, recalled with what was in it and the way
  back; the trail; a saved place; what a sign says; and the hut that went up and the chest that went away
  while the bot could not see, told once. It passes on 1.26.60.

### Changed

- On the `bedrock` branch, the libraries that speak Minecraft Bedrock Edition 1.26.60 are installed:
  mineflayer with the Bedrock edition adapter, the libraries under it with their Bedrock changes, and the
  `bedrock-protocol` transport. None of it is released, so each is pinned by commit to a branch that holds
  the Bedrock work on top of the 26.3 work (listed under [For Bedrock
  Edition](docs/core-hooks.md#for-bedrock-edition)). The bot uses them only when `minecraft_edition` is
  `"bedrock"`; set to `"java"`, it plays Java Edition exactly as before.
- Installing the `bedrock` branch has two wrinkles. npm warns that three packages want Node 24; they run on
  Node 22. And one of the new packages builds a binary with CMake on most machines (Apple silicon and
  current Linux among them), which fails `npm install` where CMake is missing. Run `SKIP_BUILD=1 npm
  install` to skip that build; the bot does not need the binary.

### Fixed

- `useDoor` walks straight through a door that is already open. It turned to the corner of the door's
  block instead of the doorway, and walked into the edge of the open door. A shut door hid this: opening
  it turns the bot to face it.
- Baby villagers are no longer taken for adults. `!entities` listed them among the adults, with a
  profession, and the trading skills walked up to one and tried to trade. The check compared the game's
  "is a baby" flag with 1, which it never equals. Now a baby is listed as one, and trading with it is
  refused with the reason.
- Villagers' jobs are known again on Minecraft 26.x. Their job and level moved to another metadata entry
  in 26.1, so `!entities` listed every grown villager as "Adult", with no job or level.
- World memory keeps what a sign says. A sign was remembered without its text: memory asked for the
  block in a way the real bot can't answer, and the error was quietly passed over.
- The bot no longer stops answering when it stands in a biome the installed game data has no entry
  for, such as on a server newer than the data. Its status then says "Biome: unknown". Before, building
  the status failed, and every message got the "having trouble" reply.
- On Bedrock `useDoor` finds an oak door by itself, and walks through a door that is already open. It looked
  for the oak door by Java's name, `oak_door` (Bedrock's is `wooden_door`), and read whether a door was open
  from Java's `open`, so it took every Bedrock door for shut and closed an open one in its own way.
- On Bedrock `!entities` names each villager's job and level and lists children apart, and
  `!showVillagerTrades` shows a villager's trades. Bedrock names villagers `villager_v2` and keeps the job
  and level in fields of its own, which Mindcraft read the Java way, and showing a jobless villager's trades
  showed those of the villager opened before it. Making a trade is refused for now, so the bot keeps what it
  would have paid with: on a current server the trade took the goods and never happened.
- On Bedrock the hunting reflex leaves young animals alone, as on Java. It read a mob's age where Java keeps
  it, which a Bedrock mob never fills in, so every calf passed for a cow. Bedrock keeps it among the mob's
  named flags, and the Bedrock module now answers from there.
- On Bedrock world memory lays its trail all along a walk. The Bedrock adapter fired the bot's `move` event
  only when the server corrected the bot or moved it, not on every tick the bot moved as mineflayer does on
  Java, so a walk left a few crumbs far apart, and a quick one read as a teleport. The Bedrock module now
  fires it after every tick in which the bot moved or turned.
- On Bedrock world memory keeps what a sign says. A current Bedrock sign keeps each side's text in a field
  of its own, and the library's reading of a Bedrock sign looks for the single field older signs had, so
  every sign was remembered blank. The Bedrock module now reads both sides.
- On Bedrock the bot can take from a barrel and put into one by name (`!takeFromChestAt`, `!putInChestAt`).
  The server refused both: the adapter's calls name a chest's slots whatever is open. A barrel (and a
  shulker box) now gets the same moves chest sorting makes, under its own name. A chest keeps the adapter's
  calls.
- On Bedrock a barrel opened again just after it was closed opens. The click named the barrel as still open,
  which it no longer was, and the server ignored it; now a click that brings no window is made once more, a
  second later. And an open that was given up on no longer takes the window of the open after it and closes
  it.
- Code the model writes runs on a Bedrock bot. Once the bot had joined a current Bedrock server, the sandbox
  that code runs in could not be set up, so `!newAction` failed every time, with fair play on or off: a
  library the connection loads leaves a property on JavaScript's `Reflect` that the sandbox can't remove.
  The bot now loads that library itself before it connects, with that property left removable.

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

[Unreleased]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.2.0-bedrock.1.3.0...HEAD
[1.2.0-bedrock.1.3.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.1.1-bedrock.1.2.1...v1.2.0-bedrock.1.3.0
[1.1.1-bedrock.1.2.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.1.0-bedrock.1.2.0...v1.1.1-bedrock.1.2.1
[1.1.0-bedrock.1.2.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.1.0...v1.1.0-bedrock.1.2.0
[1.0.0-bedrock.1.1.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.2...v1.0.0-bedrock.1.1.0
[1.0.0-bedrock.1.0.2]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.1...v1.0.0-bedrock.1.0.2
[1.0.0-bedrock.1.0.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.0...v1.0.0-bedrock.1.0.1
[1.0.0-bedrock.1.0.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.7.0...v1.0.0-bedrock.1.0.0
[0.7.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lantern-eight/mindcraft-ce/releases/tag/v0.1.0
