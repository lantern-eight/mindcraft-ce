# Changelog for Bedrock Edition

What changed on the `bedrock` branch, this fork's line for Minecraft Bedrock Edition, and not on `main`.
Everything else is in [CHANGELOG.md](CHANGELOG.md), which the two branches share: it comes to `bedrock`
whenever `main` is merged in, so lines that are only on `bedrock` are kept here, where that merge never
touches them.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A release of this line is numbered with the
version of `main` it is built on, then `-bedrock.` and the Bedrock line's own version, as in
`1.0.0-bedrock.1.0.0`. Merging a newer `main` changes the first part; a release of the Bedrock work bumps
the last.

## [Unreleased]

### Added

- A setting, `minecraft_edition`: `"bedrock"` (the default on this branch, with `minecraft_version` `"auto"`
  and `port` 19132) or `"java"`. Set to `"bedrock"`, the bot is started for a Bedrock Edition server:
  `minecraft_version` is then a Bedrock version such as `"1.26.60"` (or `"auto"`), a port of `-1` means
  Bedrock's usual 19132, and `auth: "microsoft"` signs in with an Xbox account. A Java version left in
  `minecraft_version` is refused with a message that says what to set. This is the connection; the lines
  below say what else works on Bedrock.
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
  pinned mineflayer branch.
- On Bedrock a click on a block is no longer ignored when the block changed after the bot looked it up. A
  Bedrock click names the block it lands on, and the adapter named the one it was handed, not the one that
  is there. Fixed in the pinned mineflayer branch.
- On Bedrock a block put back where the bot dug stays there. The server was never told that the bot had let
  go of a block it broke, and kept breaking whatever turned up in that spot next, leaving an item on the
  ground each time. Fixed in the pinned mineflayer branch.
- On Bedrock the bot no longer hangs in the air beside a hole. When the bot stops walking, the pathfinder
  shifts it to the middle of its block; a Bedrock server refuses that, and the adapter took only the height
  from the server's answer. The two then disagreed about where the bot stood, and at the rim of a hole it
  fell and was put back up without end. A bot that is standing still now goes where the server says it is,
  so after a walk it may stand a little off the middle of its block. Fixed in the pinned mineflayer branch.
- On Bedrock the bot can fill a bucket and empty one. Bedrock wants a bucket used on the water or the block
  in view, and the adapter used it in the air. Fixed in the pinned mineflayer branch.
- On Bedrock the bot no longer stops short of where it walks after a pause. When the bot had been busy for a
  moment (looking around for a door, say), the adapter made up every tick it had missed in one step, and the
  bot jumped ahead of where the server had it. The walk counted itself done there, and a second later the
  server pulled the bot back to where it started. So `useDoor` stopped short of the door, and shearing a
  sheep sometimes did nothing. Fixed in the pinned mineflayer branch.
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

- The libraries that speak Minecraft Bedrock Edition 1.26.60 are installed: mineflayer with the Bedrock
  edition adapter, the libraries under it with their Bedrock changes, and the `bedrock-protocol` transport.
  None of it is released, so each is pinned by commit to a branch that holds the Bedrock work on top of the
  26.3 work (listed under [For Bedrock Edition](docs/core-hooks.md#for-bedrock-edition)). The bot uses them
  only when `minecraft_edition` is `"bedrock"`; set to `"java"`, it plays Java Edition exactly as before.
- Installing has two new wrinkles. npm warns that three packages want Node 24; they run on Node 22. And one
  of the new packages builds a binary with CMake on most machines (Apple silicon and current Linux among
  them), which fails `npm install` where CMake is missing. Run `SKIP_BUILD=1 npm install` to skip that
  build; the bot does not need the binary.

### Fixed

- On Bedrock `useDoor` finds an oak door by itself, and walks through a door that is already open. It looked
  for the oak door by Java's name, `oak_door` (Bedrock's is `wooden_door`), and read whether a door was open
  from Java's `open`, so it took every Bedrock door for shut and closed an open one in its own way.
- On Bedrock `!entities` names each villager's job and level and lists children apart, and
  `!showVillagerTrades` shows a villager's trades. Bedrock names villagers `villager_v2` and keeps the job
  and level in fields of its own, which Mindcraft read the Java way, and showing a jobless villager's trades
  showed those of the villager opened before it. Making a trade is refused for now, so the bot keeps what it
  would have paid with: on a current server the trade took the goods and never happened.
- `useDoor` walks straight through a door that is already open. It turned to the corner of the door's block
  instead of the doorway, and walked into the edge of the open door. A shut door hid this: opening it turns
  the bot to face it.
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
