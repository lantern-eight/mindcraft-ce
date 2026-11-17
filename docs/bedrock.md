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
| **Works** | Joining and spawning. Reading the blocks around the bot. Chat, both ways. Walking with the pathfinder, at a speed the server accepts. Digging, picking up drops, placing blocks. Chests, crafting, smelting, farming, fighting, sleeping and the rest of Mindcraft's stock skills, listed under [Skills](#skills). Eating by itself when hungry. Fair play, world memory and chest sorting. The whole agent starts, hears a player and answers through a model |
| **Does not work yet** | See [Known Gaps](#known-gaps). In short: fair play hears less than on Java, code that reads a block's properties expects Java's names for them, and the bot can't make a trade with a villager |
| **Not tried** | Signing in to a server in online mode. Realms. Other server software. The Nether and the End. The bot's view in a browser and screenshots |

Treat a Bedrock bot as something to experiment with on a world you can afford to lose.

## Skills

The skills are Mindcraft's own. They were written for Java Edition, and there is one copy of them for both
editions. Each one below was run on a Bedrock server with fair play off, in a small scene of its own, and
the world was checked afterwards:

| | |
|---|---|
| **Gathering and building** | `collectBlock` (logs by hand and overhead, ore in view and buried in stone, obsidian, stopped partway and asked again, with an enchanted pickaxe), `breakBlockAt`, `placeBlock`, `digDown`, `pickupNearbyItems`, `tillAndSow` |
| **Making things** | `craftRecipe` (in the bot's own grid, and at a crafting table), `smeltItem`, `clearNearestFurnace` |
| **Items** | `equip` (a tool, armor), `discard`, `consume`, `putInChest`, `takeFromChest`, `viewChest`, `useToolOn` (shears on a sheep, a bucket on water) |
| **Getting around** | `goToPosition`, `goToNearestBlock`, `goToNearestEntity`, `goToSurface`, `moveAway`, `stay`, `wait`, `useDoor`, `activateNearestBlock`, `goToBed` |
| **Other players** | `goToPlayer`, `followPlayer`, `giveToPlayer` |
| **Villagers** | `showVillagerTrades`, and `!entities` naming each villager's job and level and listing children apart |
| **Fighting** | `attackNearest`, `defendSelf` |

`avoidEnemies` runs in `bedrock_fair_play.js` instead, with fair play on: the reflex that flees a monster
in view calls it. **Doesn't work yet:** `tradeWithVillager` (see [Known Gaps](#known-gaps)).

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
| **Fair play** | Works, with the two limits in the next rows. Checked on a server by `bedrock_perception.js`: sight (the bot knows the blocks and mobs in view, and not ore inside rock, a chest in a sealed room, a mob behind a wall or the ground under its feet), hearing a mob's cry from behind a wall, and noticing that the server made the bot an operator. And by `bedrock_fair_play.js`, as the agent runs it: what the model is told, skills that find and walk to only what the bot has seen, the reach guard, the reflex to flee a monster in view, model-written code, refusing to act as an operator or in creative mode, and no slash command sent. Reach uses Java's numbers |
| **Mobs' everyday noises** | Not heard. A Bedrock client makes a mob's moos and groans up by itself, and the server never sends them, so the bot hears a mob only when it is hurt or dies, or does something the server plays a sound for |
| **A chunk still arriving** | Bedrock sends a chunk in sections, and never sends one that is all air. Until a section arrives the bot takes it for air, as mineflayer does, so for a moment after a chunk loads the bot can see through a part of it that isn't there yet |
| **World memory** | Works. Checked on a server by `bedrock_memory.js`: what is in view is remembered and what is buried is not; doors, beds, chests and fields are remembered as the things they are, under Bedrock's names, a double chest as one; a door out of sight is known as it was last seen. And by `bedrock_memory_scenarios.js`, as the agent runs it: a chest opened and walked away from is recalled with what was in it and the way back; the trail, saved places, what a sign says, and the changes found after a minute out of sight, told once; memory saved to disk. Each world has its own memory, named by a hash of the seed the server sends |
| **Biome** | Reported as "unknown". The adapter doesn't read biomes from chunks |
| **Standing in the middle of a block** | After a walk the bot may stand up to a third of a block off the middle. On Java the pathfinder shifts the bot there when it stops; a Bedrock server refuses the shift, and the bot goes by the server |
| **Block and state names** | Bedrock names many states differently (a stair's `upside_down_bit` where Java has `half`) and some blocks too. Code that reads a block's properties expects Java's. A few of Mindcraft's lists name blocks by Java's names only: `placeBlock` takes Java's `snow` (a thin layer) for empty space where it may build, which on Bedrock is a whole block of snow, and does not take Bedrock's `flowing_water` or `snow_layer` for empty space |
| **Making a trade** | `tradeWithVillager` is refused: the bot says the trade failed and keeps what it would have paid with. Showing a villager's trades works. Tried, the trade failed and did harm: the bot put the goods it pays with into the trade, the server never answered the request that makes it, the goods didn't come back, and afterwards the bot no longer saw a player who joined. The adapter's trading was checked on Bedrock 1.26.51; this was on 1.26.63 (the 1.26.60 protocol) |

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

node tests/live/bedrock_smoke.js                       # the layer under the skills
node tests/live/bedrock_skills.js                      # every skill, a scene each
node tests/live/bedrock_skills.js --only=craftRecipe,goToBed   # only the scenes whose names start so
node tests/live/bedrock_perception.js                  # fair play's sight and hearing
node tests/live/bedrock_memory.js                      # world memory's look-around
node tests/live/bedrock_memory_scenarios.js            # world memory as the agent runs it (about 3 minutes)
node tests/live/bedrock_fair_play.js                   # fair play as a whole, as the agent runs it
node tests/live/bedrock_storage.js                     # chest sorting
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
- **`bedrock_storage.js`** installs chest sorting with fair play and world memory, fills containers from
  the console, has the bot sort them, and reads them back by opening them with the test's own hands: a
  chest of part stacks, a full chest of twenty kinds, and a chest, a double chest, a barrel and a trapped
  chest sorted together. Then it takes from one chest by name, puts that into a barrel and takes some
  back. The Bedrock twin of
  the sorting steps of `storage_scenarios.js`; the rules about whose chest is sorted are the same code on
  both editions and are left to that one.

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
tests run on. It doesn't have to: the test only needs its address. One way to run it is the
[itzg/minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server) image, on any
machine with Docker that the test machine can reach:

```yaml
# docker-compose.yml: a Bedrock server to test against. Not for a world you want to keep.
services:
  bedrock-test:
    image: itzg/minecraft-bedrock-server
    container_name: bedrock-test
    restart: "no"
    stdin_open: true
    tty: true
    ports:
      - "19132:19132/tcp"               # the game port: the bot's first contact is HTTP on it
      - "19140-19155:19140-19155/udp"   # the range the connection itself uses
    environment:
      EULA: "TRUE"                      # setting this accepts Minecraft's end user license agreement
      VERSION: "1.26.60.6"              # a full build number, or LATEST
      LEVEL_TYPE: "FLAT"
      GAMEMODE: "survival"
      DIFFICULTY: "peaceful"
      ONLINE_MODE: "false"
      ALLOW_CHEATS: "true"              # for the console commands the test uses
      # The address the bot will reach this machine at, then the same range twice.
      SERVER_UDP_PORTS: "<address>:19140-19155:19140-19155"
    volumes:
      - ./data:/data
```

`docker compose up -d` starts it and `docker compose down` stops it; deleting the folder removes the
world. The console command for the tests is then `docker exec bedrock-test send-command`, with
`ssh <machine>` in front when the server is on another machine.

The console line passes through a shell on its way, so the tests only send lines made of letters, digits,
spaces and `_ . : -`, and write coordinates out in full.

**On an Apple silicon Mac** the server runs too, under Docker Desktop's x86-64 emulation (add `platform:
linux/amd64` to the service), and all the Bedrock live tests pass on it. Two things differ:

- The image's `send-command` doesn't find the server there. It looks for the server's own program, and
  under the emulation every program in the container is the emulator. A console command that finds the
  server by its command line works instead, saved as a script of its own:

  ```bash
  #!/bin/sh
  # Sends one console line to the Bedrock server in the container named bedrock-test.
  exec docker exec bedrock-test bash -c '
  for p in /proc/[0-9]*; do
    cmd=$(tr "\0" " " < "$p/cmdline" 2>/dev/null)
    case "$cmd" in ./bedrock_server-*) echo "$*" > "$p/fd/0"; exit 0 ;; esac
  done
  echo "unable to find the bedrock server process"; exit 2' _ "$@"
  ```

- `BEDROCK_TEST_CONSOLE` is split on spaces, so give the script a path that has none.

Set `SERVER_UDP_PORTS` to `127.0.0.1:19140-19155:19140-19155` when the tests run on the same Mac.

## Where Things Are

| | |
|---|---|
| `src/agent/bedrock/connect.js` | Starting a Bedrock bot: the options, the server's key, what is left out, the game data the rest of the code reads |
| `src/agent/bedrock/eating.js` | Eating when hungry. The plugin that does it on Java can't be loaded on Bedrock, so this does the same with the same switches |
| `src/agent/bedrock/edition.js` | Bedrock's answers to the [edition seam](edition-seam.md)'s questions: how Bedrock numbers block states (by hash), lays out a chunk, sends sounds and operator rights, pairs a double chest, keeps a sign's text and a mob's age, and moves a stack |
| `src/agent/bedrock/names.js` | Bedrock's names for blocks and states in Java's terms, so world memory knows a Bedrock bed or door for what it is. Memory itself keeps Bedrock's names |
| `src/agent/bedrock/window_moves.js` | Moving a stack in an open chest, one item stack request a move, for chest sorting |
| `src/agent/bedrock/lockdown_ready.js` | Loads a library the connection uses before the connection does, so that the sandbox for model-written code can still be set up afterwards |
| `src/agent/bedrock/java_shapes.js` | Where the adapter hands back something of another shape than mineflayer does on Java, the Java shape is put back, once, on the bot. Today: an opened chest, recipes, a click on a block, and the `move` event on every tick the bot moves |
| `tests/bedrock_*.test.js` | Unit tests, no server |
| `tests/live/bedrock_fixture.js` | Where the live tests find their server, and how they report |
| `tests/live/bedrock_smoke.js`, `tests/live/bedrock_skills.js`, `tests/live/bedrock_perception.js`, `tests/live/bedrock_memory.js`, `tests/live/bedrock_memory_scenarios.js`, `tests/live/bedrock_fair_play.js`, `tests/live/bedrock_storage.js` | The live tests: the layer under the skills, the skills, fair play's senses, world memory, fair play as a whole, and chest sorting |
| [core-hooks.md](core-hooks.md#hooks-for-bedrock-edition) | The edits to inherited files. The `bedrock` branch's copy also lists the libraries it pins |
