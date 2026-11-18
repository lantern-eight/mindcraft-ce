# Fair Play

Fair play makes the bot play Minecraft the way a person does: **it may only know and do what a human
survival player in its place could.**

Stock Mindcraft doesn't work that way. The bot's library is sent every block in every loaded chunk and
every mob the server tracks, so the bot "sees" ore inside solid stone, chests in sealed rooms and zombies
behind walls. It can open a chest through a wall, switch itself into a cheat mode that uses `/tp` and
`/setblock`, and run model-written code with full access to the bot and to your computer.

With fair play on, none of that is possible. Everything below is enforced in code, so the model can't be
talked out of it.

## Turning It On

In `settings.js` (a profile can override it):

```js
"fair_play": "strict",   // "strict" | "custom" | "off"
```

| Value | Meaning |
|---|---|
| `"strict"` | Every rule on. This fork's default |
| `"off"` | Stock Mindcraft. Nothing is installed, and nothing behaves differently |
| `"custom"` | Start from strict, and loosen single rules with `fair_play_custom` (see "The Switches") |

If the setting is missing entirely, it counts as `"off"`.

## What the Bot Can Know

| Sense | Rule |
|---|---|
| **Touch** | The cells its body is in, the ones just above and below, and the four beside it |
| **Sight** | A block is seen when a straight line from the bot's eye reaches one of its sides without crossing a full, opaque block. A mob is seen the same way |
| **Memory** | Blocks it saw before are remembered exactly as they were last seen. A furnace that someone removed while the bot was away is still "there" until the bot looks again |
| **Hearing** | Mob sounds the server actually sent, reported as "zombie (north-east, close)". A direction and a rough distance, never coordinates |
| **Name tags** | Players within 64 blocks are known even through walls, unless they are sneaking. Vanilla shows name tags the same way |

Details that matter:

- **You can see through** glass, leaves, water, ice, and anything that isn't a full cube: single slabs,
  stairs, fences, chests, doors, torches. That is slightly generous (a slab does hide a little).
- **Chunks the client hasn't been sent count as walls,** so the bot can't see into them.
- **The view is all around (360°)** and light is ignored, as if the bot glances around constantly with
  brightness turned up. Both can be tightened later.
- **A mob that steps out of view stays known for 3 seconds,** so reflexes don't flicker when something
  walks behind a tree.
- **Memory is per world and dimension.** With [world memory](world-memory.md) on, which is the
  default, the bot remembers every block it has seen, what was in the chests it opened, places, the ways
  it has walked, and whether a place has changed. It records only what was in view.
- **With world memory off, the bot remembers nothing:** it knows only what it touches and sees now, and
  has no `!recall`.
- **Coordinates are fair.** Players have them on the debug screen.

This applies to everything that decides what the bot does: the state summary the model reads each turn,
every command's result, every skill choosing a target, every reflex, model-written code, and the route
the bot plans to get somewhere.

## What the Bot Can Do

| Rule | What happens |
|---|---|
| **Reach** | Clicking, digging, placing against or hitting something needs it within a survival player's reach of the bot's eye (on Java 4.5 blocks for a block and 3 for a mob, on Bedrock 5 and 3) **and in view right now**. To place a block, the side being clicked must be in view |
| **No slash commands** | A chat message starting with `/` is dropped before it reaches the server, except whispers (`/tell`, `/msg`, `/w`) |
| **No cheat mode** | Mindcraft's `cheat` mode stays off whoever asks: the model, a player typing `!setMode("cheat", true)`, a profile, or generated code |
| **Never an operator** | If the server makes the bot an operator, or puts it outside survival, it stops acting and says why until that is undone |
| **Model-written code** | Runs in a compartment that is handed a stand-in for the bot: reads are copies, searches answer from what the bot perceives, actions go through the same reach rule, and the protocol client, raw world and events simply aren't there. `allow_insecure_coding` is still off by default |

A refusal is a message the model can act on, for example:

> You can't see the block at 3, 1, 0 from here, so you can't open it. Move to where you can see it.

## How the Bot Plans a Route

The pathfinder turns "go there" into steps. Stock, it plans over every loaded block, so its choice of
route used caves the bot had never entered, knew how thick a hill was before digging into it, and stepped
round lava that was still behind rock. With fair play on, it plans over what the bot knows:

| A cell that is | Counts as |
|---|---|
| In view right now (within 24 blocks), or touched | The block that is there |
| Seen before | The block as it was last seen. This is [world memory](world-memory.md): without it only what is in view is known |
| Seen to be empty, now or earlier | Air |
| Never seen | **Open ground:** the bot may walk through it and may stand on it |

Open ground is the optimism a person walks with: "I have not been over that ridge, so I will assume I can
walk there, and look when I get to it."

- **A trip into country the bot has not seen is planned straight at the goal,** at once, even to beyond
  the chunks the server has sent.
- **It looks as it goes.** A few times a second the next steps of the route are checked against what is
  now in view. When a step turns out to be a drop or a rock face, the route is planned again from where
  the bot stands. It waits for the bot to land or to finish a block it is digging first.
- **What it has seen, it plans round from the first step.** A wall it met yesterday is walked round today,
  not walked up to.
- **A wall is believed to be as thick as what the bot has seen of it.** Digging in can look cheaper than
  it turns out to be, and lava behind a rock face is no reason not to dig until the bot has seen it.
- **Only mobs the bot knows of** make a route cost more.

Skills, commands, mining, combat and the trail all plan through the same pathfinder, so this covers them
all. The walking itself, the step-by-step physics, still feels the real ground under the bot, as a
player's legs do.

## What Changes for the Model

- `!nearbyBlocks` and `!entities` (and the state summary built from them) list only what the bot perceives.
- `!entities` adds lines such as `heard: zombie (east, close)` for sounds whose source isn't in view.
- With world memory on, `!recall("sand")` lists the nearest sand the bot remembers seeing: where, how far,
  which way, how long ago. Searches like `!searchForBlock` use the same memory.
- "Could not find any sand" now means "haven't seen any". An empty-handed search says so, so the model
  explores instead of giving up.

## The Server's Part

The bot checks itself, but a server can remove whole classes of cheating before they start:

- **Survival mode, and never make the bot an operator.** Then no code can spawn items or teleport.
- **Anti-xray, if you run Paper** (`anti-xray.enabled: true`, `engine-mode: 1`, and raise
  `max-block-height` to cover the whole world). Buried ores are then never sent to any client. Use mode 1,
  not mode 2: mode 2 sends fake ores, which the bot would chase.

Anti-xray hides only fully buried ore. Chests in hidden rooms, mobs behind walls and ore in sealed caves
are still sent, which is why the bot-side rules exist. The live tests run with anti-xray **off**, so they
pass on the bot's rules alone.

## The Switches

With `"fair_play": "custom"`, list only the rules you want to change. Each one is checked in exactly one
place in the code, so flipping one changes that rule and nothing else.

```js
"fair_play": "custom",
"fair_play_custom": { "ores_through_walls": true },
```

| Switch | Strict value | Other values |
|---|---|---|
| `sight` | `"rays"` | `"open_face"` (a block counts as seen if any side touches a see-through cell), `"all"` (no limit) |
| `ores_through_walls` | `false` | `true` |
| `containers_through_walls` | `false` | `true` (chests, barrels, furnaces, hoppers) |
| `stations_through_walls` | `false` | `true` (crafting tables, beds, doors, anvils) |
| `mobs_through_walls` | `false` | `true` |
| `players_through_walls` | `"nametag"` | `true`, `false` |
| `fov_degrees` | `360` | a narrower field of view, such as `110` |
| `sight_distance` | `"server"` (whatever is loaded) | a number of blocks |
| `entity_distance` | `64` | blocks |
| `hearing_radius` | `16` | blocks |
| `route_planning` | `"seen"` | `"all"` (routes are planned over every loaded block, as stock Mindcraft does) |
| `interact_through_walls` | `false` | `true` (keeps the reach limit, drops the "in view" rule) |
| `reach_blocks`, `reach_entities` | `"survival"` (the game's own: 4.5 and 3 on Java, 5 and 3 on Bedrock) | a number of blocks |
| `slash_commands` | `false` | `true` |
| `slash_allowlist` | `["tell", "msg", "w"]` | a list of command names |
| `cheat_mode` | `false` | `true` |
| `generated_code` | `"wrapped"` | `"off"` (refuse to write code), `"raw"` (stock behavior, for measuring only) |

A misspelled switch is an error at startup, not a rule silently left on.

**Why switches:** to measure what a "cheat" is worth. Run a task under strict, then again with one switch
flipped, and compare. When a strict run fails, flipping switches one at a time shows which limit caused it.

**Two things a switch can't do.** It can only loosen what the *bot* filters, so `ores_through_walls: true`
changes nothing on a server whose anti-xray never sends buried ore. And `cheat_mode: true` only matters on
a server where the bot is an operator.

## Known Limits

Fair play is honest about what it doesn't cover yet:

- **Route planning is optimistic, and pays for it sometimes.** The bot may dig into a hill expecting it to
  be thin, or walk up to a drop it could not have known about and turn aside there. Having started to
  dig, it tends to keep digging: at every step the rock ahead is again believed to be as thick as what
  is in view.
- **Open air the bot looked through is kept only for the session.** World memory keeps the blocks, and
  knows the air over ground the bot looked down on. A drop whose bottom it never saw is remembered until
  the bot restarts, and then met again.
- **Without world memory the bot forgets a wall once it is out of view,** and may walk back to it.
- **For planning, "in view" reaches 24 blocks,** as far as the bot looks around. A wall across an open
  field is planned for when the bot is that close, not from the far side of the field.
- **The walking still reads the real blocks:** where exactly to stand on a step, and whether a jump can
  be made. So does the pathfinder's test of whether a block to be mined, or a spot to build on, could be
  reached from where a route would end. The target itself was seen; the cells between are not asked of
  perception.
- **The pathfinder and the combat plugin aren't held to the reach rule.** They act from their own timers
  while carrying out an action that was itself checked.
- **A few skills name a block before the bot has looked at it** when given exact coordinates
  (`breakBlockAt`, `placeBlock`, `tillAndSow`). No command passes them arbitrary coordinates; generated
  code can.
- **`!digDown` checks for lava and water under the block it is about to dig,** which a player couldn't see.
- **Good-neighbor rules** (don't break players' builds, loot their chests, or hurt their animals) are
  planned and not built yet. The `good_neighbor` setting is reserved for them.
- **The code runner isn't a CPU sandbox.** Model-written code that loops forever without waiting stalls
  the agent. Keep `allow_insecure_coding` off unless you need it.

## For Developers

All of it lives in `src/agent/fairplay/`:

| File | What it is |
|---|---|
| `sight.js` | The geometry: can a straight line from the eye reach this block, point or mob? Pure, no mineflayer |
| `block_scan.js` | A fast private read of chunk data, for perception only |
| `perception.js` | **The boundary.** The one place that reads raw world data; it returns only what touch, sight, memory and hearing allow |
| `policy.js` | Turns the settings into one frozen object of rules |
| `fair_queries.js` | The provider plugged into `world.js`, where the through-walls switches are applied |
| `reach_guard.js` | Reach and line of sight for clicking, digging, placing and hitting |
| `fair_legs.js` | What the pathfinder is told while it plans a route, and the watch on the way ahead |
| `fair_bot.js`, `code_runner.js` | The stand-in bot and the compartment for model-written code |
| `commands.js` | The "not found means not seen" sentence added to an empty-handed search. `!recall` comes with world memory |
| `install.js` | Switches all of the above on for one agent |

**What depends on the edition of the game.** How block states are numbered, how a chunk section lists the
blocks it holds, which sounds the server sends and how it tells the bot it is an operator are asked for by
name from the edition seam (`src/agent/edition/`), never read straight from game data, chunks or packets.
Sight's tables, the block search, hearing and the operator check all go through it, and so do world memory
and chest sorting. [`edition-seam.md`](edition-seam.md) lists every question with Java's and Bedrock's
answers, and says when new code has to ask it.

**How it hooks into Mindcraft.** Nearly every search in Mindcraft goes through `src/agent/library/world.js`.
Those calls now pass through one swappable provider (`world_queries.js`), and fair play installs its own.
That is why commands, skills, reflexes and prompts all became fair without being edited one by one. Every
edit to a Mindcraft file is listed in [`core-hooks.md`](core-hooks.md).

**How route planning hooks in.** The pathfinder's `Movements` class reads the world in one method,
`getBlock`, and every route search by every skill and plugin goes through it. `fair_legs.js` replaces that
method on the class at run time, for bots under fair play only, and answers from perception (`believedAt`).
No file of the pathfinder or of Mindcraft is edited. The rules for what can be walked through or stood on
stay the library's: its own `getBlock` is run on a copy of the `Movements` object whose `bot` answers from
what the bot believes. Two more methods are wrapped: `getNeighbors`, to add level slantwise steps over
unseen ground, and `updateCollisionIndex`, so that only mobs the bot knows of are counted. See "Replaced
Pieces" in [`core-hooks.md`](core-hooks.md).

**Writing or porting a skill.** Plan walks with the pathfinder, never with a search of your own over
`bot.blockAt`, so that fair legs cover them. Find blocks and entities with `world.*`, never with `bot.findBlocks`,
`bot.findBlock`, `bot.nearestEntity`, `bot.entities` or `bot.players[name].entity`. A test
(`tests/fairplay_raw_search_lint.test.js`) fails the build if one of those appears outside the fair-play
modules. Don't send slash commands, write the bot's position, or touch `bot._client`.

**Tests.**

```bash
npm test                                      # all unit tests; fair-play ones are tests/fairplay_*.test.js
node tests/live/fairplay_scenarios.js         # the whole stack on a real server, about 90 seconds
node tests/live/fairplay_scenarios.js --no-world-memory   # the same, with world memory off
node tests/live/legs_scenarios.js             # route planning: a wall and a trench not seen from the start, and a long trip
node tests/live/fairplay_perception_smoke.js  # perception alone on a real server
```

The live tests need Node 22, Java 25, and `MC_TEST_SERVER_JAR` pointing at a Minecraft 26.3 server jar
(`MC_TEST_VERSION` names another version, for a jar of that version).
They start their own throwaway server, build each scene from the server console, and make no model calls.
`tests/live/fairplay_perception_bench.js` times perception against a server that is already running.
