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

The NPC's item goals explore too. When the block or mob a goal needs isn't in sight a second time, the bot
explores 64 blocks for it, carrying on the same heading at each try, instead of Mindcraft's step of 8 blocks
any way at all.

An answer says where the bot got to and what turned it aside:

```
Explored 96 blocks east, heading east; now at 140, 71, -12. Turned aside for water to the east. Came across: sand, birch_log.
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
  down to the ground, and place a block it carries to step up. With good-neighbor rules on, leaves someone put
  up (a hedge) are a build like any other, and the route goes round them
  ([`good-neighbor.md`](good-neighbor.md)).
- **It doesn't swim out to sea.** A block of water costs a route as much as twenty of land, so a stream is
  crossed and a lake walked round. Five seconds of swimming without a break ends a stretch: the bot swims back to the
  last dry ground it stood on and tries another way, and a walk never ends with the bot in the water.
- **It gives up a spot whose way round grows long.** A stretch whose end turns out to be in a lake, or across a
  ravine, has no dry way there, and the pathfinder would walk all the way round looking for one. Once a
  stretch has walked two and a half times its length, it ends there and the bot tries another way.
- **It doesn't set out for what it remembers is in the way.** With world memory on, before each stretch it
  checks what it remembers on the stretch's far half (halfway, three quarters, the end): water or lava where
  the ground should be, or a drop of more than 8 blocks over open air. Memory reaches about as far as a look
  round, so a lake across the way is often remembered only at its near shore; that is enough. A person who saw a lake from the hill doesn't walk down to its shore to find
  out. It tries the stretch at half its length, then the next way round. When memory says every way is bad,
  it walks the first anyway: memory can be out of date, and the walk turns back from what is really there.
  The answer says what it turned from: "water to the east", "lava to the north", "a drop to the west".
- **Underground, it follows the open air it has seen.** Under a roof (something solid over its head that
  isn't leaves), a level line runs into rock the bot has never seen. A stretch there ends at the farthest
  spot towards its heading where the bot has seen room to stand, as a person in a cave follows the passage
  they can see, however short. It never goes back to a spot it has stood on during the walk, so it doesn't
  step back and forth round a bend. A way it can see no room along is shut from that spot only: a few steps
  on, round a corner, it may open up. This needs world memory; without it, a stretch underground is a level
  line as on the surface.
- **It says what it came across.** After each stretch it notes the kinds of ground worth naming in view
  (water, sand, gravel, clay, snow, ice, ores, each kind of log, mushrooms, pumpkins, terracotta and the
  like), and the answer lists those that weren't in view or remembered where the walk began: "Came across:
  sand, birch_log."
- **It keeps its heading after a restart.** With world memory on, the last walk is saved with the memory of
  the world and dimension it was made in, so `"on"` carries it on after the bot restarts.
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
- **What lies ahead** (water, lava, a drop) and **where there is room underground** are asked only of what
  the bot remembers seeing. A cell it never saw is no reason to turn, and no spot to walk to.
- **What it came across** comes through `world.js`, like what it finds.
- **Water** is felt, not seen: the block the bot's feet are in.
- **The answer** names only what the bot saw or felt.

## Known Limits

- **Underground, it goes only as far as it has seen.** A cave is explored a stretch at a time, each ending
  where the bot last saw room to stand, and it looks round there before going on. It doesn't dig to open a
  way, and a passage it hasn't seen is not taken. Without world memory it walks level, as on the surface.
- **Water and drops it hasn't seen** are met on the way and turned from there, as before. Seeing all around
  helps: the narrow view sees less of what lies ahead.
- **Without world memory, the heading is kept until the bot restarts.**
- **A mob remembered far off is not looked for:** mobs move.
- **Ridden travel** (boats, horses) is not used.

## For Developers

All of it lives in `src/agent/explore/`:

| File | What it is |
|---|---|
| `heading.js` | Which way: directions as players say them, the heading kept and how a walk carries on, the ways round a blocked one, and how new the ground along a heading is. Plain arithmetic |
| `explorer.js` | The loop: a stretch, a look round, a check, and the answer's words. Handed its "legs", so it never reads the world itself |
| `legs.js` | The real legs: the pathfinder with exploring's own movements, a watch for a stretch that is stuck, swimming or going the long way round, `world.js` for finding and for what it came across, world memory for new ground, for what lies at a stretch's end, and for where there is room underground |
| `commands.js` | `!explore` and `!exploreFor`, and each bot's last walk |
| `saved.js` | The last walk, saved with world memory (`explore.json` in the memory folder of the world and dimension) |
| `install.js` | Adds the commands when `explore` is on, and gives the NPC's item goals their way of exploring (`library/explore_way.js`, core hook 36) |

`agent.js` calls `installExplore(this)` once (core hook 35 in [`core-hooks.md`](core-hooks.md)).

**Tests.** `tests/explore_*.test.js` cover the heading, the loop on a pretend world and the commands.
`tests/live/explore_scenarios.js` runs the commands on a real Java server, and `tests/live/bedrock_explore.js`
on a Bedrock one, with no model calls:

```bash
node tests/live/explore_scenarios.js     # needs MC_TEST_JAVA and MC_TEST_SERVER_JAR
node tests/live/bedrock_explore.js       # needs BEDROCK_TEST_HOST and BEDROCK_TEST_CONSOLE (docs/bedrock.md)
```

The ideas behind it come from other forks of Mindcraft; [`ATTRIBUTION.md`](../ATTRIBUTION.md) credits them.
