# Bedrock Edition

The `bedrock` branch is this bot for Minecraft Bedrock Edition, the edition on consoles, phones and
Windows. The port is **in progress**. This page says what works today, what doesn't, how to try it, and how
to test it.

The Java Edition bot lives on the `main` branch and is not affected by anything here. With
`minecraft_edition` left at `"java"`, this branch behaves as `main` does.

## Status

Checked against a Bedrock Dedicated Server, versions 1.26.60 and 1.26.63, in survival and offline mode.

| | |
|---|---|
| **Works** | Joining and spawning. Reading the blocks around the bot. Chat, both ways. Walking with the pathfinder, at a speed the server accepts. Digging, picking up drops, placing blocks. Putting items in a chest and taking them out. Crafting in the bot's own 2x2 grid. The whole agent starts, hears a player and answers through a model |
| **Does not work yet** | See [Known Gaps](#known-gaps). In short: fair play can't be relied on, world memory and chest sorting are not ported, most skills are untried and some are known to fail, and the bot does not eat by itself |
| **Not tried** | Signing in to a server in online mode. Realms. Other server software. The Nether and the End. The bot's view in a browser and screenshots |

Treat a Bedrock bot as something to experiment with on a world you can afford to lose.

## Trying It

1. Install as the [README](../README.md#quick-start) says, on this branch.
2. In `settings.js` set:

   ```js
   "minecraft_edition": "bedrock",
   "minecraft_version": "auto",   // or the server's version, such as "1.26.60"
   "host": "the server's address",
   "port": 19132,                 // the Bedrock server's game port; -1 also means 19132
   "auth": "offline",
   "fair_play": "off",            // see Known Gaps
   ```

3. Run `node main.js`.

| Setting | On Bedrock |
|---|---|
| `minecraft_edition` | `"bedrock"`. Anything else, or leaving it out, means Java |
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
over to it in three small places ([Hooks for Bedrock Edition](core-hooks.md#hooks-for-bedrock-edition)).
Under it, mineflayer's Bedrock edition adapter turns Bedrock's packets into the same `bot` the Java code
uses. None of those libraries are released with Bedrock support yet;
[For Bedrock Edition](core-hooks.md#for-bedrock-edition) lists where each comes from.

- **Finding the server.** The bot asks the address in three ways: the older transport, the newer one as
  it is announced on a local network, and the newer one over HTTP on the game port. A current dedicated
  server answers only the last. So the game port must be reachable over TCP, and the server's UDP port
  range (`server-udp-ports` in its `server.properties`) over UDP.
- **The server's key.** In the HTTP exchange the server shows a key. A stock server makes a new one every
  time it starts, in online mode and offline mode alike, so there is nothing to compare it with. The bot
  accepts it and prints it. It trusts whoever answers at the address in its settings, as a Java bot does
  on an offline-mode server.
- **Coming back after a crash.** A bot that is killed instead of leaving stays on the server's player list
  for some seconds. A bot of the same name that joins in that time is turned away. Wait half a minute.

## Known Gaps

Things that don't carry over from Java, or don't yet. Some will close as the libraries grow; some may
stay.

| Gap | What happens today |
|---|---|
| **Fair play** | Don't rely on it. Perception runs, but in a first check the bot named blocks under the ground it stood on, which a player could not see. The lists of what can be seen through are written for Java's blocks, and sounds, reach and world identity each read something Java-only. Set `fair_play: "off"` for now |
| **World memory, chest sorting** | Not ported. World memory keeps Java's names for block states; chest sorting moves items the way Java's windows work |
| **Chests, the way skills use them** | On Java, opening a chest hands back an object with `deposit` and `withdraw` on it, and the skills are written for that. The adapter hands back nothing and puts those calls on the bot. Done the adapter's way, chests work; the skills that use chests do not yet |
| **Crafting with something just crafted** | An item the bot made can't be used as an ingredient: the adapter records the new stack without the number the server gave it, and the server refuses to move it. Logs to planks works; those planks to a crafting table then fails |
| **Eating** | The bot does not eat by itself. The plugin that does it on Java can't be loaded |
| **Biome** | Reported as "unknown". The adapter doesn't read biomes from chunks |
| **Block and state names** | Bedrock names many states differently (a stair's `upside_down_bit` where Java has `half`) and some blocks too. Code that reads a block's properties expects Java's |
| **Recipes for a crafting table, furnaces, combat, sleeping, farming** | Not tried from this repo |

## Testing

`npm test` covers how the bot is started (`tests/bedrock_connect.test.js`) and that the installed
libraries work together (`tests/bedrock_stack.test.js`). Neither needs a server.

The live test needs a real one:

```bash
BEDROCK_TEST_HOST=<address> BEDROCK_TEST_PORT=19132 \
BEDROCK_TEST_CONSOLE="docker exec bedrock-test send-command" \
node tests/live/bedrock_smoke.js
```

It joins through the repo's own start-up code and goes through everything in the "Works" row above,
one step each, printing one line of JSON per step. It makes no model calls. Steps that hand out items use
the server console and are skipped without `BEDROCK_TEST_CONSOLE`. Two steps are marked as known gaps:
they report what happens and never fail the run, and when one starts passing the output says so.
`tests/live/bedrock_fixture.js` explains each variable.

**Never point it at a world you care about.** It digs, builds, hands out items and clears the bot's
inventory.

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
world. The console command for the test is then `docker exec bedrock-test send-command`, with
`ssh <machine>` in front when the server is on another machine.

The console line passes through a shell on its way, so the test only sends lines made of letters, digits,
spaces and `_ . : -`, and writes coordinates out in full.

## Where Things Are

| | |
|---|---|
| `src/agent/bedrock/connect.js` | Starting a Bedrock bot: the options, the server's key, what is left out, the game data the rest of the code reads |
| `tests/bedrock_connect.test.js`, `tests/bedrock_stack.test.js` | Unit tests, no server |
| `tests/live/bedrock_fixture.js`, `tests/live/bedrock_smoke.js` | The live test and where it finds its server |
| [core-hooks.md](core-hooks.md#hooks-for-bedrock-edition) | The edits to inherited files, and the pinned libraries |
