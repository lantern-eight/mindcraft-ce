# Exploring

Exploring lets the bot go and look for what isn't near, the way a player does: pick a direction, keep to it,
walk round what is in the way, stop now and then to look round, and stop when the thing turns up.

Without it, the only way to "go look elsewhere" is `!moveAway`, which picks any direction each time. A bot
sent to find sand that way walks back and forth around where it started.

## Turning It On or Off

Exploring is **on by default**. To turn it off, in `settings.js`:

```javascript
"explore": false,
```

It works with fair play on or off. With fair play on, it sees only what the bot perceives and plans each
stretch over what the bot knows, like every other walk. With [world memory](world-memory.md) on as well, it
heads for land the bot hasn't looked over yet, and knows what the bot remembers seeing farther off.

## The Commands

| Command | What it does |
|---|---|
| `!explore(direction, distance)` | Walks about `distance` blocks (16 to 512) from where the bot stands, the way it is told: `north`, `south`, `east`, `west`, `north-east`, `north-west`, `south-east`, `south-west`, or `"on"` to keep going the way it was exploring |
| `!exploreFor(what, direction, distance)` | The same, stopping as soon as `what` is in view: a block or a mob, by the game's name (`sand`, `oak_log`, `cow`), or several separated by commas (`"sand,red_sand"`) |

Both are actions: they take over from what the bot was doing, and `!stop` stops them.

An answer says where the bot got to and what turned it aside:

```
Explored 96 blocks east, heading east; now at 140, 71, -12. Turned aside for water to the east.
Found sand 12 blocks north, at 150, 63, -30, after exploring 64 blocks.
You remember sand 180 blocks west, at -40, 63, 2. Go there, or explore another way to look for more.
```

## How It Explores

- **It keeps its heading.** Told a direction, it keeps to it as a bearing. Told `"on"`, it carries on the walk
  it was making when it last stopped, from about where it stopped, so several short calls add up to one long
  walk. Starting afresh with `"on"`, it heads for the land it has seen least of, preferring to keep the way it
  went last; with no memory, the way it went last, or any.
- **It walks in stretches of 32 blocks,** and at the end of each one it looks round (through a player's
  screen, it turns to look every way, as a player scanning the land does), then checks for what it is looking
  for.
- **What is in the way is gone round, not through.** It tries a little to one side, then more, and takes up
  its heading again once past. Told a direction, it never turns back past a quarter: a person told "go east"
  goes round a lake, not west.
- **It doesn't dig.** A person exploring goes over or round a hill. It may break leaves where a forest comes
  down to the ground, and place a block it carries to step up.
- **It doesn't swim out to sea.** A block of water costs a route as much as twenty of land, so a stream is
  crossed and a lake walked round. Five seconds of swimming without a break ends a stretch: the bot swims back to the
  last dry ground it stood on and tries another way, and a walk never ends with the bot in the water.
- **It gives up a spot whose way round grows long.** A stretch whose end turns out to be in a lake, or across a
  ravine, has no dry way there, and the pathfinder would walk all the way round looking for one. Once a
  stretch has walked two and a half times its length, it ends there and the bot tries another way.
- **It stops when it can't go on:** every way from where it stands was tried and blocked.
- **Already seen or remembered, it doesn't set out.** `!exploreFor` first checks what is in view and what the
  bot remembers: within a search's reach (64 blocks) it says where; with world memory, farther off within the
  distance it was given, it says where the bot remembers one. The model can go there, or explore another way.

## Is It Fair?

- **What it finds** comes through `world.js`, so under fair play it is what the bot sees or remembers seeing,
  as for every search. It never reads a block it can't see.
- **Where it goes** is planned by the pathfinder like any walk, which fair play plans over what the bot
  knows: land never seen is taken for open ground, and looked at on the way.
- **Which way is new** is asked only of the bot's own record of where it has looked (world memory's cubes).
- **Water** is felt, not seen: the block the bot's feet are in.
- **The answer** names only what the bot saw or felt.

## Known Limits

- **It explores the surface.** Underground it walks level towards its heading, which in rock means a wall at
  every turn. Exploring caves is not built yet.
- **It doesn't steer round water or drops it remembers before it sets out.** It meets them on the way and
  turns there. Walking along a long shore takes a stretch for each try east.
- **The heading is kept until the bot restarts.** After a restart, `"on"` heads for the land it has seen least
  of, which usually carries on the same way.
- **A mob remembered far off is not looked for:** mobs move.
- **Ridden travel** (boats, horses) is not used.

## For Developers

All of it lives in `src/agent/explore/`:

| File | What it is |
|---|---|
| `heading.js` | Which way: directions as players say them, the heading kept and how a walk carries on, the ways round a blocked one, and how new the ground along a heading is. Plain arithmetic |
| `explorer.js` | The loop: a stretch, a look round, a check, and the answer's words. Handed its "legs", so it never reads the world itself |
| `legs.js` | The real legs: the pathfinder with exploring's own movements, a watch for a stretch that is stuck, swimming or going the long way round, `world.js` for finding, world memory for new ground |
| `commands.js` | `!explore` and `!exploreFor`, and each bot's last walk |
| `install.js` | Adds the commands when `explore` is on |

`agent.js` calls `installExplore(this)` once (core hook 35 in [`core-hooks.md`](core-hooks.md)).

**Tests.** `tests/explore_*.test.js` cover the heading, the loop on a pretend world and the commands.
`tests/live/explore_scenarios.js` runs the commands on a real Java server, and `tests/live/bedrock_explore.js`
on a Bedrock one, with no model calls:

```bash
node tests/live/explore_scenarios.js     # needs MC_TEST_JAVA and MC_TEST_SERVER_JAR
node tests/live/bedrock_explore.js       # needs BEDROCK_TEST_HOST and BEDROCK_TEST_CONSOLE (docs/bedrock.md)
```

The ideas behind it come from other forks of Mindcraft; [`ATTRIBUTION.md`](../ATTRIBUTION.md) credits them.
