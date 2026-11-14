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
- **Memory is per server, world and dimension.** With [world memory](world-memory.md) on, which is the
  default, the bot remembers every block it has seen, what was in the chests it opened, places, the ways
  it has walked, and whether a place has changed. It records only what was in view.
- **With world memory off, the bot remembers less:** only "notable" blocks, saved under
  `bots/<name>/seen/`. Those are ores, logs, sand, gravel, clay, containers, crafting stations, beds,
  doors, crops and a few rarer ones. Other blocks are known only while in view.
- **Coordinates are fair.** Players have them on the debug screen.

This applies to everything that decides what the bot does: the state summary the model reads each turn,
every command's result, every skill choosing a target, every reflex, and model-written code.

## What the Bot Can Do

| Rule | What happens |
|---|---|
| **Reach** | Clicking, digging, placing against or hitting something needs it within a survival player's reach of the bot's eye (4.5 blocks for a block, 3 for a mob) **and in view right now**. To place a block, the side being clicked must be in view |
| **No slash commands** | A chat message starting with `/` is dropped before it reaches the server, except whispers (`/tell`, `/msg`, `/w`) |
| **No cheat mode** | Mindcraft's `cheat` mode stays off whoever asks: the model, a player typing `!setMode("cheat", true)`, a profile, or generated code |
| **Never an operator** | If the server makes the bot an operator, or puts it outside survival, it stops acting and says why until that is undone |
| **Model-written code** | Runs in a compartment that is handed a stand-in for the bot: reads are copies, searches answer from what the bot perceives, actions go through the same reach rule, and the protocol client, raw world and events simply aren't there. `allow_insecure_coding` is still off by default |

A refusal is a message the model can act on, for example:

> You can't see the block at 3, 1, 0 from here, so you can't open it. Move to where you can see it.

## What Changes for the Model

- `!nearbyBlocks` and `!entities` (and the state summary built from them) list only what the bot perceives.
- `!entities` adds lines such as `heard: zombie (east, close)` for sounds whose source isn't in view.
- `!recall("sand")` lists the nearest sand the bot remembers seeing: where, how far, which way, how long
  ago. Searches like `!searchForBlock` use the same memory.
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
| `interact_through_walls` | `false` | `true` (keeps the reach limit, drops the "in view" rule) |
| `reach_blocks`, `reach_entities` | `4.5`, `3` | blocks |
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

- **Route planning.** The pathfinder still plans with every loaded block, so its *choice of route* can use
  terrain the bot hasn't seen. Targets always come from what the bot perceives; only the path between
  uses more. With [world memory](world-memory.md) on (the default), a trip to somewhere the bot has been
  follows the way it walked, which uses nothing it hasn't seen.
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
| `seen_map.js` | What the bot has seen, saved per world. With `world_memory` on, the store in `src/agent/memory/` takes its place |
| `policy.js` | Turns the settings into one frozen object of rules |
| `fair_queries.js` | The provider plugged into `world.js`, where the through-walls switches are applied |
| `reach_guard.js` | Reach and line of sight for clicking, digging, placing and hitting |
| `fair_bot.js`, `code_runner.js` | The stand-in bot and the compartment for model-written code |
| `commands.js` | `!recall` (world memory registers a fuller one in its place when it is on), and the "not found means not seen" sentence |
| `install.js` | Switches all of the above on for one agent |

**How it hooks into Mindcraft.** Nearly every search in Mindcraft goes through `src/agent/library/world.js`.
Those calls now pass through one swappable provider (`world_queries.js`), and fair play installs its own.
That is why commands, skills, reflexes and prompts all became fair without being edited one by one. Every
edit to a Mindcraft file is listed in [`core-hooks.md`](core-hooks.md).

**Writing or porting a skill.** Find blocks and entities with `world.*`, never with `bot.findBlocks`,
`bot.findBlock`, `bot.nearestEntity`, `bot.entities` or `bot.players[name].entity`. A test
(`tests/fairplay_raw_search_lint.test.js`) fails the build if one of those appears outside the fair-play
modules. Don't send slash commands, write the bot's position, or touch `bot._client`.

**Tests.**

```bash
npm test                                      # all unit tests; fair-play ones are tests/fairplay_*.test.js
node tests/live/fairplay_scenarios.js         # the whole stack on a real server, about 90 seconds
node tests/live/fairplay_scenarios.js --no-world-memory   # the same, with world memory off
node tests/live/fairplay_perception_smoke.js  # perception alone on a real server
```

The live tests need Node 22, Java 21, and `MC_TEST_SERVER_JAR` pointing at a Minecraft 1.21.11 server jar.
They start their own throwaway server, build each scene from the server console, and make no model calls.
`tests/live/fairplay_perception_bench.js` times perception against a server that is already running.
