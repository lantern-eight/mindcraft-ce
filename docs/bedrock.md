# Bedrock Edition

This bot plays Minecraft Bedrock Edition too, the edition on consoles, phones and Windows. Bedrock support
is **experimental**: it works, with the gaps this page lists. This page says what works, what doesn't, how
to try it, and how to test it.

The code for Bedrock is on `main`, beside Java's, behind the `minecraft_edition` setting, and none of it
runs for a Java bot. The rest of what Bedrock needs is in the libraries under the bot, whose Bedrock work
isn't released yet. So the `bedrock` branch is `main` with those libraries pinned, and set for Bedrock out
of the box. On `main`, a bot set to Bedrock stops with a message that says to use that branch. On
`bedrock`, a bot set to `"java"`, with a Java server's version and port, plays Java Edition as on `main`.

## Status

Checked against a Bedrock Dedicated Server, versions 1.26.60 and 1.26.63, in survival and offline mode.

| | |
|---|---|
| **Works** | Joining and spawning. Reading the blocks around the bot, and the biome it is in. Chat, both ways. Walking with the pathfinder, at a speed the server accepts. Digging, picking up drops, placing blocks. Chests, crafting, smelting, farming, fighting, sleeping and the rest of Mindcraft's stock skills, listed under [Skills](#skills). Eating by itself when hungry. Fair play, world memory and chest sorting. The whole agent starts, hears a player and answers through a model |
| **Does not work yet** | See [Known Gaps](#known-gaps). In short: fair play hears less than on Java, and cheat mode writes a block that faces a way in Java's terms |
| **Not tried** | Signing in to a server in online mode. Realms. Other server software. The Nether and the End. The bot's view in a browser and screenshots |

Treat a Bedrock bot as something to experiment with on a world you can afford to lose.

## Skills

The skills are Mindcraft's own. They were written for Java Edition, and there is one copy of them for both
editions. Each one below was run on a Bedrock server with fair play off, in a small scene of its own, and
the world was checked afterwards:

| | |
|---|---|
| **Gathering and building** | `collectBlock` (logs by hand and overhead, ore in view and buried in stone, obsidian, stopped partway and asked again, with an enchanted pickaxe), `breakBlockAt`, `placeBlock` (over a thin layer of snow, and not over a block of it), `digDown` (also straight after a walk), `pickupNearbyItems`, `tillAndSow` |
| **Making things** | `craftRecipe` (in the bot's own grid, and at a crafting table), `smeltItem`, `clearNearestFurnace` |
| **Items** | `equip` (a tool, armor), `discard`, `consume`, `putInChest`, `takeFromChest`, `viewChest`, `useToolOn` (shears on a sheep, a bucket on water) |
| **Getting around** | `goToPosition`, `goToNearestBlock`, `goToNearestEntity`, `goToSurface`, `moveAway`, `stay`, `wait`, `useDoor`, `activateNearestBlock`, `goToBed` |
| **Other players** | `goToPlayer`, `followPlayer`, `giveToPlayer` |
| **Villagers** | `showVillagerTrades`, `tradeWithVillager`, and `!entities` naming each villager's job and level and listing children apart |
| **Fighting** | `attackNearest`, `defendSelf` |

`avoidEnemies` runs in `bedrock_fair_play.js` instead, with fair play on: the reflex that flees a monster
in view calls it.

One scene on flat ground shows that a skill works, not that it works everywhere. The scenes are in
`tests/live/bedrock_skills.js` ([Testing](#testing)).

## Trying It

1. Install as the [README](../README.md#quick-start) says, on the `bedrock` branch.
2. `settings.js` on that branch already says `"minecraft_edition": "bedrock"`, `"minecraft_version":
   "auto"` and `"port": 19132`. Set the server:

   ```js
   "minecraft_edition": "bedrock",
   "minecraft_version": "auto",   // or the server's version, such as "1.26.60"
   "host": "the server's address",
   "port": 19132,                 // the Bedrock server's game port; -1 also means 19132
   "auth": "offline",
   ```

3. Run `node main.js`.

| Setting | On Bedrock |
|---|---|
| `minecraft_edition` | `"bedrock"`, the `bedrock` branch's default. `"java"`, `main`'s default, plays Java Edition |
| `minecraft_version` | A Bedrock version, or `"auto"` to take the server's. A Java version left here is refused when the bot starts, with a message that says what to set |
| `port` | The Bedrock server's game port. `-1` means 19132, Bedrock's usual port. Nothing is scanned for |
| `auth` | `"offline"` for a server in offline mode. `"microsoft"` signs in with an Xbox account; this has not been tried |

## Versions

A Bedrock server refuses a client that speaks another protocol version, and the libraries learn a new
version some days after it is released. What that means in practice:

- **The bot speaks 1.26.60.** Releases 1.26.61 to 1.26.63 use the same protocol, and the bot joins them
  as it joins 1.26.60: every step of the smoke test below passes on 1.26.63. With `minecraft_version` on
  `"auto"` nothing needs setting for them.
- **A release that changes the protocol locks the bot out** until the libraries have it. Small releases
  usually don't change it; a new second or third number (1.26.70, 1.27) usually does.
- **Consoles can't be held back.** They update themselves, and they join only a server whose version
  matches theirs. A server that consoles play on therefore has to be kept current, and on such a server
  the bot will be shut out for a while after an update that changes the protocol. Holding the server back
  keeps the bot in and the consoles out. No setting fixes this; it is worth knowing before relying on the
  bot.

## How the Connection Works

A Bedrock bot is started by its own module, `src/agent/bedrock/connect.js`. Inherited start-up code hands
over to it in three small places, and two more hooks give skills Bedrock's names for a bed and a door
([Hooks for Bedrock Edition](core-hooks.md#hooks-for-bedrock-edition)).
Under it, mineflayer's Bedrock edition adapter turns Bedrock's packets into the same `bot` the Java code
uses. None of those libraries are released with Bedrock support yet; the `bedrock` branch pins them, and
its copy of [core-hooks.md](core-hooks.md#dependencies-pinned-to-a-branch) lists where each comes from.

- **Finding the server.** The bot asks the address in three ways: the older transport, the newer one as
  it is announced on a local network, and the newer one over HTTP on the game port. A current dedicated
  server answers only the last. So the game port must be reachable over TCP, and the server's UDP port
  range (`server-udp-ports` in its `server.properties`) over UDP.
- **The server's key.** In the HTTP exchange the server shows a key. A stock server makes a new one every
  time it starts, in online mode and offline mode alike, so there is nothing to compare it with. The bot
  accepts it and prints it. It trusts whoever answers at the address in its settings, as a Java bot does
  on an offline-mode server.
- **One copy of the skills.** The skills and this fork's modules are written against the `bot` mineflayer
  gives on Java, and are not copied for Bedrock. Where the adapter's `bot` differs in shape, the Bedrock
  module puts the Java shape back on the bot (`java_shapes.js`); where the adapter is simply wrong, it is
  fixed in the adapter; what Bedrock can't do is listed under Known Gaps.
- **One copy of fair play, world memory and chest sorting.** What those read below the `bot` (how block
  states are numbered, what a chunk section holds, the sound packets, what a block entity keeps) they ask
  of the [edition seam](edition-seam.md), and the Bedrock module answers its questions for Bedrock
  (`src/agent/bedrock/edition.js`). A question the Bedrock module leaves unanswered fails a unit test.
- **Coming back after a crash.** A bot that is killed instead of leaving stays on the server's player list
  for some seconds. A bot of the same name that joins in that time is turned away. Wait half a minute.

## Known Gaps

Things that don't carry over from Java, or don't yet. Some will close as the libraries grow; some may
stay.

| Gap | What happens today |
|---|---|
| **Fair play** | Works, with the two limits in the next rows. Checked on a server by `bedrock_perception.js`: sight (the bot knows the blocks and mobs in view, and not ore inside rock, a chest in a sealed room, a mob behind a wall or the ground under its feet), hearing a mob's cry from behind a wall, and noticing that the server made the bot an operator. And by `bedrock_fair_play.js`, as the agent runs it: what the model is told, skills that find and walk to only what the bot has seen, the reach guard, the reflex to flee a monster in view, model-written code, refusing to act as an operator or in creative mode, and no slash command sent. The reach guard holds the bot to a Bedrock player's reach, 5 blocks to a block and 3 to a mob, and a block 4.8 blocks away, past Java's reach, is dug |
| **Mobs' everyday noises** | Not heard. A Bedrock client makes a mob's moos and groans up by itself, and the server never sends them, so the bot hears a mob only when it is hurt or dies, or does something the server plays a sound for |
| **Creepers' own rules** | The creeper reflex backs off the same way as on Java, and a lit creeper is read from its `ignited` flag and heard by its hiss (`fuse`), both checked by `bedrock_threats.js`. What a Bedrock creeper does is not measured yet: at what distances its fuse lights and runs down, and whether it needs to see its target. So the reflex finishes with a creeper that keeps following only by leaving it behind, never by going back in to hit it |
| **A chunk still arriving** | Bedrock sends a chunk in sections, and never sends one that is all air. Until a section arrives the bot takes it for air, as mineflayer does, so for a moment after a chunk loads the bot can see through a part of it that isn't there yet |
| **World memory** | Works. Checked on a server by `bedrock_memory.js`: what is in view is remembered and what is buried is not; doors, beds, chests and fields are remembered as the things they are, under Bedrock's names, a double chest as one; a door out of sight is known as it was last seen. And by `bedrock_memory_scenarios.js`, as the agent runs it: a chest opened and walked away from is recalled with what was in it and the way back; the trail, saved places, what a sign says, and the changes found after a minute out of sight, told once; memory saved to disk. Each world has its own memory, named by a hash of the seed the server sends |
| **Standing in the middle of a block** | After a walk the bot may stand up to a third of a block off the middle. On Java the pathfinder moves the bot there in one go when it stops; a Bedrock server refuses that move, and has the last word on where a walk stopped up to a second later. Before the bot digs the block under its feet (as `digDown` does), it steps to the middle of its block, so it drops into the hole it digs. Nothing else is known to need the middle |
| **Coming back after dying** | Sometimes the bot stays dead. The server starts a respawn in steps, and the pinned libraries don't always see it through: after the first step (searching for a place to respawn) nothing more happens, and the bot waits with no health. It happened in about half of the deaths tried on a 1.26.63 server, in a scene and alone. With the world's `doimmediaterespawn` rule on (no death screen) it came back from every death given by the console, but still not always from one in a fight; so `bedrock_fight_arena.js` turns the rule on and heals the bot at 4 health, counting that round as lost. Not yet looked into in the libraries |
| **Block and state names in cheat mode** | Bedrock names some blocks and most block states its own way (a stair's `upside_down_bit` where Java has `half`). Mindcraft's lists of blocks are in Java's names, and each check against one asks the [edition seam](edition-seam.md) for the Java name of the block in front of the bot, so `placeBlock` builds over a thin layer of snow (`snow_layer`) and not over a block of snow (`snow`), and the checks for water and lava (in `digDown`, `breakBlockAt` and the reflex that keeps the bot alive) take Bedrock's `flowing_water` and `flowing_lava` for water and lava too. What is left: with fair play off and cheat mode on, `placeBlock` writes its `/setblock` line in Java's terms for a block that faces a way (a torch on a wall, a lever, stairs, a door's top half, a bed's head), which Bedrock writes another way. Not tried; fair play keeps cheat mode off |

## Quirks Worth Knowing

Seen on a Bedrock Dedicated Server (1.26.63) and the adapter, and left as they are. None needs a fix here;
they are written down so nobody looks into them again.

- **The server doesn't hold players to reach** by default: it accepts digging from about 10 blocks away,
  opening a trapdoor from 7 and a hit from 6 (it doesn't check attack range unless told to). Set to enforce
  it with no tolerance, it refuses hits past 3. Fair play holds the bot to 5 blocks for blocks and 3 for
  hits by itself, on either edition.
- **Spreading water and lava aren't named `flowing_water` and `flowing_lava`** as on Java. They read as
  `water` and `lava` with a `liquid_depth` state.
- **The adapter's `updateSign` is ignored** unless the server opened that sign for the bot first. No skill
  writes signs.
- **mineflayer warns that 1.26.60 to 1.26.63 are untested.** They work.

## Testing

`npm test` covers how the bot is started (`tests/bedrock_connect.test.js`), that the installed
libraries work together (`tests/bedrock_stack.test.js`), fair play's sight and hearing on Bedrock game
data and chunks (`tests/bedrock_edition.test.js`), world memory there (`tests/bedrock_memory.test.js`),
chest sorting's moves and double chests (`tests/bedrock_storage.test.js`), and that the sandbox for
model-written code can be set up once the connection's libraries are loaded
(`tests/bedrock_lockdown.test.js`). None needs a server.

The live tests need a real one. They take the same three variables, make no model calls, and print
one line of JSON for each step:

```bash
export BEDROCK_TEST_HOST=<address> BEDROCK_TEST_PORT=19132
export BEDROCK_TEST_CONSOLE="docker exec bedrock-test send-command"

node tests/live/bedrock_all.js                         # all fourteen below, one after another
node tests/live/bedrock_smoke.js                       # the layer under the skills
node tests/live/bedrock_skills.js                      # every skill, a scene each
node tests/live/bedrock_skills.js --only=craftRecipe,goToBed   # only the scenes whose names start so
node tests/live/bedrock_perception.js                  # fair play's sight and hearing
node tests/live/bedrock_memory.js                      # world memory's look-around
node tests/live/bedrock_memory_scenarios.js            # world memory as the agent runs it (about 3 minutes)
node tests/live/bedrock_fair_play.js                   # fair play as a whole, as the agent runs it
node tests/live/bedrock_storage.js                     # chest sorting
node tests/live/bedrock_stow.js                        # putting away and fetching
node tests/live/bedrock_smelting.js                    # smelting
node tests/live/bedrock_farming.js                     # tending and making a field, storing the harvest
node tests/live/bedrock_neighbor.js                    # good-neighbor rules
node tests/live/bedrock_turning.js                     # work that turns a lot, timed
node tests/live/bedrock_explore.js                     # exploring
node tests/live/bedrock_threats.js                     # the threat reflexes
node tests/live/bedrock_fight_arena.js                 # how well the bot fights, measured (not in bedrock_all.js)
```

- **`bedrock_smoke.js`** joins through the repo's own start-up code and checks what every skill leans on:
  seeing blocks, chat, walking, digging, picking up, placing, a chest, crafting. Steps that hand out items
  use the server console and are skipped without `BEDROCK_TEST_CONSOLE`.
- **`bedrock_skills.js`** calls each stock skill the way the agent does, with fair play off, and checks
  the world afterwards. It builds each scene from the console, so it needs one. A second bot joins for
  the skills that need another player. Two scenes, the one with a monster and the one where the bot gets
  hungry, set the difficulty to normal and back to peaceful.
- **`bedrock_perception.js`** builds a scene on a platform high above the ground (a buried diamond, a
  sealed chest, a cow walled in and one behind glass, dirt under the floor) and checks that fair play's
  perception knows only what is in view, though the server sends the bot all of it. It walls in the hidden
  cow to hear it cry out, and has the server make the bot an operator and take it back. The Bedrock twin
  of `fairplay_perception_smoke.js`.
- **`bedrock_memory.js`** puts a door, a bed, a double chest and a crop on such a platform, runs world
  memory's look-around, and checks what it kept: each thing as one thing, nothing buried, and the door
  as it was once the bot is walled in.
- **`bedrock_memory_scenarios.js`** installs world memory with fair play, the way the agent does, and checks
  what the bot is told: a double chest it opened and walked away from, recalled with what was in it and
  how far it is; the trail it walked back there; a place it saved; what a sign says; and, after a minute
  boxed in where it can see nothing, the hut that went up and the chest that went away, told once.
  Then that memory is saved and that no command was sent. The Bedrock twin of `memory_scenarios.js`.
- **`bedrock_fair_play.js`** installs fair play the way the agent does, with world memory, and runs
  Mindcraft's real skills and reflexes on such a platform: diamonds buried in rock and one in view, a chest
  in a sealed room, a zombie in a pit under a lid. It checks that the bot finds and digs only what it has
  seen, can't open the chest through the wall, flees the zombie only once it sees it, runs model-written
  code that sees no more than it does, refuses to act while an operator or in creative mode, and never
  sends a command. The Bedrock twin of `fairplay_scenarios.js`.
- **`bedrock_turning.js`** times work that turns a lot on a floor of stone high up: gathering logs from a
  tree ahead and one behind and stone from a boulder beside, a bridge one block wide over a pit, and a gap
  of two blocks to jump. Each must succeed at any turning speed and in either view; slower is fine, a fall
  or a stall is not. The Bedrock twin of `turning_scenarios.js`, less its ladder, which the console can't
  set facing a way.
- **`bedrock_explore.js`** runs `!explore` and `!exploreFor` on four strips of stone high up: a heading kept
  from one call to the next, a stone wall gone round and none of it dug, sand behind the bot found and
  stopped at, and a tunnel that bends followed under a stone roof. The Bedrock twin of
  `explore_scenarios.js`, less its lakes and its remembered sand.
- **`bedrock_threats.js`** installs fair play and the creeper reflex, lights creepers with Bedrock's own
  start-exploding event, penned in glass where the bot can see them, and checks that the bot reads the fuse
  from the `ignited` flag, steps away the moment the hiss arrives, is 7 or more blocks off at each blast and
  takes no damage; that it backs off on the hiss alone from a creeper around a corner; and that a creeper
  following it is left behind, never gone back in to hit, even with a sword. Then the mob reflex and the
  fight: what the server shows of a zombie's target and a skeleton's aim (nothing, so the edition seam goes
  by the mob's kind and where it faces), the side a hit came from (the push the server gives the bot), two
  zombies backed away from, and a lone one fought. Mob griefing is turned off for the run, and hostile mobs
  are cleared by switching to peaceful, since a console line can't name them. The Bedrock twin of
  `threat_scenarios.js` and, in brief, `mob_scenarios.js`.
- **`bedrock_fight_arena.js`** measures the fight rather than checking it: the same rounds and kits as
  `fight_arena.js` on Java (zombies, skeletons and spiders against bare hands up to an iron kit), each run
  several times, with wins, time, damage and swings per kill (`--runs`, `--only`, `--kit`, `--out`). A
  zombie is summoned with the event that makes it an adult. It is a yardstick for changes to how the bot
  fights, so `bedrock_all.js` doesn't run it. It changes the world's rules for its run (the bot keeps its
  inventory, respawns at once) and puts them back when it ends; if it was killed before that, start the
  other scripts on a fresh world.
- **`bedrock_stow.js`** puts things away and fetches them in a storage room of the bot's own chests, a
  shared one, a player's and one nobody has claimed, and reads the chests back with the test's own hands.
  The Bedrock twin of `stow_scenarios.js`. On Bedrock a move between a chest and the bot is an item stack
  request, and part of a stack moved slot to slot goes whole, so a part goes by count.
- **`bedrock_neighbor.js`** installs good-neighbor rules with fair play and world memory: a player's plank wall
  that is the only way on stays whole, a plank the bot is told to break is refused with the reason, and
  collecting logs fells a tree and leaves a log cabin standing. The Bedrock twin of `neighbor_scenarios.js`.
- **`bedrock_storage.js`** installs chest sorting with fair play and world memory, fills containers from
  the console, has the bot sort them, and reads them back by opening them with the test's own hands: a
  chest of part stacks, a full chest of twenty kinds, and a chest, a double chest, a barrel and a trapped
  chest sorted together. Then it takes from one chest by name, puts that into a barrel and takes some
  back. The Bedrock twin of
  the sorting steps of `storage_scenarios.js`; the rules about whose chest is sorted are the same code on
  both editions and are left to that one.
- **`bedrock_smelting.js`** installs smelting with fair play and world memory: glass from sand and coal, with
  the bot finding its furnace again while it burns (a burning furnace is another block on Bedrock,
  `lit_furnace`); a furnace in use left alone for a free one; the bot's own furnace placed and picked back
  up; a furnace cleared; a furnace loaded and left, and collected; and lava from a lava cauldron (Bedrock's
  one cauldron block, read through its states), with the empty bucket for it in the bag, in the bot's own
  chest, or on its shelf; sand shared between a row of three furnaces; raw iron taken to a blast furnace over
  a nearer furnace, and raw beef to a smoker, each in half a furnace's time. The Bedrock twin of
  `smelting_scenarios.js`.
- **`bedrock_farming.js`** builds a field from the console with random ticks off (they are turned back on at
  the end), and has the bot tend it: ripe wheat, carrots and beetroot cut and replanted, young wheat left at
  its stage, the empty farmland sown and none of it trampled; then `!collectBlocks`' search for wheat, which
  must pass over the young plants; with good-neighbor rules on, a stranger's wheat left standing; and a field
  made by water and the bot's own field made bigger with a hoe; and the harvest taken to the chests by the field
  that are for it, seed and food kept, read back by opening each chest; and the melons and pumpkins beside a
  field's stems picked, the stems left, and the gap among melon stems sown with melon seed. Bedrock calls a crop's stage `growth`,
  which is what it checks. The Bedrock twin of `farming_scenarios.js`; whose field it is is the same code on both
  editions and is left to that one.

For a server on another machine, `BEDROCK_TEST_CONSOLE` starts with `ssh <that machine>`. The scenes
send hundreds of console lines, and ssh's connection sharing (`-o ControlMaster=auto -o
ControlPath=<a short path>/%C -o ControlPersist=120`) about halves the time each one takes.

A step marked as a known gap reports what happens and never fails the run, and when it starts passing
the output says so. `tests/live/bedrock_fixture.js` explains each variable.

**Never point them at a world you care about.** They dig, build, hand out items, clear inventories,
summon and kill animals and a zombie, change the time and the difficulty, and turn off mobs spawning by
themselves.

### A Throwaway Server

The Bedrock Dedicated Server runs on Linux (x86-64) and Windows, so it often can't run on the machine the
tests run on. It doesn't have to: the tests only need its address. `tests/live/bedrock-server/` holds one ready
to start, in the [itzg/minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server)
image, for any machine with Docker:

- `docker-compose.yml`: a flat survival world, peaceful, offline, cheats on for the console, on the Bedrock
  version the tests last passed on. `docker compose up -d` in that folder starts it and `docker compose down`
  stops it. The world goes in `data/` beside it, which git ignores; delete that folder for a fresh world.
  Starting it accepts Minecraft's end user license agreement (`EULA` in the file).
- `console.sh`: types one line into that server's console, for `BEDROCK_TEST_CONSOLE`.

With the server on the machine the tests run on, from the repo's root:

```bash
docker compose -f tests/live/bedrock-server/docker-compose.yml up -d
export BEDROCK_TEST_HOST=127.0.0.1 BEDROCK_TEST_PORT=19132
export BEDROCK_TEST_CONSOLE=tests/live/bedrock-server/console.sh
node tests/live/bedrock_all.js
```

It listens on 127.0.0.1 only, on game port 19132. `BEDROCK_TEST_HOST` and `BEDROCK_TEST_PORT`, set when it
starts, move it: for tests run from another machine, start it with `BEDROCK_TEST_HOST` set to the IP address
they will reach this machine at, and give the tests `BEDROCK_TEST_CONSOLE="ssh <that machine> docker exec
bedrock-test send-command"`.

What depends on the machine the server runs on:

- **Docker on x86-64 Linux** runs the server as it is, and the image's own `send-command` is a console that
  works.
- **Docker Desktop on an Apple silicon Mac** runs it under x86-64 emulation (the file's `platform:
  linux/amd64`, which changes nothing on an x86-64 machine), and all the Bedrock live tests pass on it. The
  image's `send-command` doesn't find the server there: it looks for the server's own program, and under the
  emulation every program in the container is the emulator. `console.sh` finds the server by its command line
  instead, so use it as the console.

`BEDROCK_TEST_CONSOLE` is split on spaces, so give the console a path that has none. The relative path above has
none, even when a folder above the repo does.

The console line passes through a shell on its way, so the tests only send lines made of letters, digits,
spaces and `_ . : -`, and write coordinates out in full. A line with a selector (`kill @e[type=...]`) can't
pass that rule; type it into the server's console by hand, with a player near, or it finds nothing.

**If the computer sleeps during a run,** Docker Desktop's clock falls behind, and every join after that fails
with "jwt expired". Wait for its clock to catch up, then run again.

**Summoning on the server isn't exact.** `summon villager ~ ~ ~ minecraft:spawn_<job>` often gives another
job or none, so the scenes summon several and use whichever has the job; a plain `summon sheep` makes a lamb
one time in twenty, so they use the `minecraft:spawn_adult` event.

### When Several Scripts Fail at Once

A player joining for the first time is put above whatever stands at the world spawn, and the scripts build their
scenes where the bot then is, most of them 40 blocks above it. Whatever is left standing there lifts every later
spawn and the scenes with it: a scene from a run stopped part way through, or something built by hand. Once
the scenes run into the top of the world, several scripts fail at once while building them: a buried block the
bot was never sent, a chest it can't find, a walk that comes up short.

`node tests/live/bedrock_spawn_check.js` prints, layer by layer, what stands above the flat ground within 32
blocks of the spawn. With `--clear` it fills that space with air from the console, and then looks again. It
does so only on a flat world like the one above (grass at y -61), and stops without changing anything on any
other.

The world is shared between runs, so each script starts by putting back what it can from the console
(`freshStart` in `bedrock_fixture.js`): the game's default rules (a script then changes what it needs for its
run), peaceful, noon, its bots in survival with empty hands and no effects, and each bot back down on the
world's own ground if a run left it standing on something built. That keeps a rule, an inventory or a position
one run left behind from failing the next. The scripts that build a floor of their own (`bedrock_threats.js`
and the arena) take it away when they end, the bot first brought back down. What a run stopped part way through
built stays; for that, `bedrock_spawn_check.js --clear`, or a fresh world (stop the server, delete or move its
world folder, start it again).

### When the Server Goes Quiet

Now and then the bot's connection goes silent part way through a run, with no error and no disconnect: the
bot hears of nothing more, so a block set, a mob summoned or an item given never reaches it, and every scene
after that fails as if the bot or the server had done nothing. The server drops the bot some time later. The
fixture keeps the time of each bot's last packet: a line `{"connection":"quiet",...}` in the log says when a
bot heard nothing for over 5 seconds (the server sends something every fraction of a second, 300 ms apart at
most in a normal run), a failed step says so in its `connection` field, and each summary gives the longest
silence each bot met (`longestQuietMs`). A failure with that note is the connection's, not what the step
tests: run the script again.

## Where Things Are

| | |
|---|---|
| `src/agent/bedrock/connect.js` | Starting a Bedrock bot: the options, the server's key, what is left out, the game data the rest of the code reads |
| `src/agent/bedrock/eating.js` | Eating when hungry. The plugin that does it on Java can't be loaded on Bedrock, so this does the same with the same switches |
| `src/agent/bedrock/edition.js` | Bedrock's answers to the [edition seam](edition-seam.md)'s questions: how Bedrock numbers block states (by hash), lays out a chunk, sends sounds and operator rights, pairs a double chest, keeps a sign's text and a mob's age, and moves a stack |
| `src/agent/bedrock/names.js` | Bedrock's names for blocks and states in Java's terms, so world memory knows a Bedrock bed or door for what it is. Memory itself keeps Bedrock's names |
| `src/agent/bedrock/window_moves.js` | Moving a stack in an open chest, one item stack request a move, for chest sorting |
| `src/agent/bedrock/lockdown_ready.js` | Loads a library the connection uses before the connection does, so that the sandbox for model-written code can still be set up afterwards |
| `src/agent/bedrock/java_shapes.js` | Where the adapter hands back something of another shape than mineflayer does on Java, the Java shape is put back, once, on the bot. Today: an opened chest, recipes, a click on a block, a villager's trade window, and letting go of every key (through `setControlState`, as on Java, so that an action the agent stopped can't let go of the keys of the one after it). A plain mistake in the adapter is fixed in the adapter and offered upstream; it is put right here only until the pinned adapter has the fix |
| `tests/bedrock_*.test.js` | Unit tests, no server |
| `tests/live/bedrock_fixture.js` | Where the live tests find their server, and how they report |
| `tests/live/bedrock_smoke.js`, `tests/live/bedrock_skills.js`, `tests/live/bedrock_perception.js`, `tests/live/bedrock_memory.js`, `tests/live/bedrock_memory_scenarios.js`, `tests/live/bedrock_fair_play.js`, `tests/live/bedrock_storage.js`, `tests/live/bedrock_stow.js`, `tests/live/bedrock_smelting.js`, `tests/live/bedrock_farming.js`, `tests/live/bedrock_neighbor.js`, `tests/live/bedrock_explore.js` | The live tests: the layer under the skills, the skills, fair play's senses, world memory, fair play as a whole, chest sorting, putting away and fetching, smelting, farming, good-neighbor rules, and exploring |
| `tests/live/bedrock_all.js`, `tests/live/bedrock_spawn_check.js` | Running all of them in turn; what stands at the world spawn, and clearing it |
| `tests/live/bedrock-server/` | A throwaway server to run them against: its Docker Compose file and a console that works under emulation |
| [core-hooks.md](core-hooks.md#hooks-for-bedrock-edition) | The edits to inherited files. The `bedrock` branch's copy also lists the libraries it pins |
