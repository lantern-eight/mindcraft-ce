# Good-Neighbor Rules

A bot that shares a world with people should treat their things the way a decent player does. The first of
these rules is built: **the bot doesn't break what other players built.** It is enforced in code, under every
skill, so a message in chat can't talk the model out of it.

- [What Is Protected](#what-is-protected)
- [Trees](#trees)
- [Where It Is Enforced](#where-it-is-enforced)
- [Is It Fair?](#is-it-fair)
- [Settings](#settings)
- [Known Limits](#known-limits)
- [For Developers](#for-developers)

## What Is Protected

A block is someone's unless something says it is free to break. In this order:

| Block | May the bot break it? |
|---|---|
| One a player let it break ([below](#letting-the-bot-break-a-block)) | Yes, once |
| One the bot placed itself (its scaffolding, its crafting table) | Yes |
| Inside a protected area from the settings | No, whatever it is |
| One the bot saw turn up where there had been empty space, or in place of another block, with nobody but a person to have put it there ([world memory](world-memory.md#who-changed-a-cell)) | No, even dirt or stone |
| A log | Only as part of a natural tree ([below](#trees)) |
| Leaves | Yes when grown, no when placed by hand |
| Natural ground: stone, dirt, sand, gravel, ores, snow, wild plants, the Nether's and the End's own blocks | Yes |
| Anything else: planks, glass, cobblestone, bricks, wool, rails, torches, crops, doors, chests | No: someone made it |

It goes the safe way round on purpose. A list of what players build with would never be finished, and a
block missing from it would be fair game; a block missing from the list of natural ground is only protected.

When a route would have to break a protected block, the bot goes round, or the walk fails. When a command or
model-written code tries to dig one, the bot is refused with a message that says why:

> Breaking oak_planks at 12, 64, -3 refused: oak_planks isn't natural ground, so someone made it. Leave
> other players' builds alone: ask them (a player can let you break it by typing !allowBreak 12, 64, -3), or
> go another way.

## Letting the Bot Break a Block

A player lets the bot break protected blocks by typing it in chat:

```
!allowBreak 12 64 -3                  the block at 12, 64, -3
!allowBreak 10 64 -3 12 65 -3         every block in the box between two corners, at most 64
```

The bot answers ("Okay, Steve: I may break the block at 12, 64, -3, once each, in the next 10 minutes.") and
may then break those blocks, whatever protects them, a protected area included. A grant is narrow on purpose:

- **Exact blocks.** Never "anything round here".
- **Once each.** Breaking a block uses its grant up; if someone puts a block back there, it is protected again.
- **Ten minutes.** A grant not used by then lapses.
- **From a player only.** The grant is read from the player's own chat message, before any model sees it.
  It is not a command the model has, so the model can't let the bot break someone's build on its own say-so,
  whatever a player asks it, and neither can another bot.

## Trees

Logs are what a player both gathers from the wild and builds with as they are, so a log is free to break only
as part of a tree. A player tells the two apart at a glance, and the bot does the same from what it knows of
the cells around the log: the logs of its kind joined to it must touch only what a world puts beside a trunk
(air, water, leaves, the ground, vines, cocoa, a bee nest), and touch grown leaves above the lowest log in a
few places. A cabin's logs touch planks, glass, a door or a torch; a pillar of logs has no canopy.

There is no test of the ground under the trunk, so a tree the bot has started felling is still a tree. A tree
once recognized stays one for the session, log by log, so the bot can finish it after its leaves have started
to fall. From the foot of a tree, through a player's screen, the canopy is out of sight; so a bare trunk no
wider than a tree's (2 by 2) whose top the bot hasn't seen is taken for a tree, as a player at its foot would
take it, until the bot sees its top bare.

## Where It Is Enforced

| Where | What it covers |
|---|---|
| The pathfinder's "may I break this block?" | Every route by every skill: walks, block collecting, getting past a blockage on a remembered way. It also decides which blocks `!collectBlocks` may take, so it fells trees and leaves cabins |
| A remembered way that is blocked | With [world memory](world-memory.md) on: when someone's block stands across a way the bot walked before, the bot neither digs past it nor round it, and the rest of that trip digs nothing at all, so it can't tunnel through the natural ground beside a wall into someone's base. It says what blocks the way and goes by another way it knows, or stops |
| The bot's own dig | Commands, skills and model-written code, and the pathfinder's digging when its plan was made before the bot could see what it was digging |

## Is It Fair?

The rule only ever forbids, and it reads the world as the bot knows it. With [fair play](fair-play.md) on,
that is what the bot sees and remembers; a cell it knows nothing about is unknown, never read from the world.
So it can make the bot more careful than a player, never better informed. With fair play off, or set to see
all around, it reads the world as stock Mindcraft does.

## Settings

In `settings.js`:

```javascript
"good_neighbor": {
    "protect_builds": true,       // the protection rule above; false turns it off
    "protect_chests": true,       // reserved, not built yet
    "protect_animals": true,      // reserved, not built yet
    "protected_areas": [          // places where nothing is broken, natural or not
        // { "name": "Base", "min": { "x": 0, "y": -64, "z": 0 }, "max": { "x": 40, "y": 320, "z": 40 } },
        // { "name": "Farm", "x": 100, "z": -20, "radius": 16, "dimension": "overworld" },
    ],
},
```

An area is a box with two corners, or a circle on the map with a centre and a radius that reaches from the
bottom of the world to the top. `dimension` is optional. It works with fair play on or off. With world memory
off, nothing is known to have been built by someone, and the bot's own blocks are only those it placed since
it started.

## Known Limits

- **Some blocks the world made are protected too.** A mineshaft's planks and rails, a village's paths, a
  dungeon's cobblestone, a ruined portal's obsidian: from the blocks alone they can't be told from a player's
  tunnel or house. Wild sugar cane, pumpkins, melons and bamboo are protected for the same reason: a field of
  them is usually someone's farm.
- **Natural ground someone placed is free until the bot sees that it was placed.** Stone or dirt a player put
  up before the bot first saw the spot looks like any other stone or dirt.
- **Rarely, a block that got there by itself counts as built:** dirt an enderman set down, a huge mushroom grown
  where the bot had seen air.
- **A post of logs whose top the bot hasn't seen is taken for a tree** when nothing built touches it where
  the bot has looked. A wall of logs is wider than a trunk and stays protected.
- **Any player can grant, not only the block's owner.** The bot doesn't know whose a block is, only that it
  is someone's.
- **Leaves the bot only remembers count as grown.** Memory keeps blocks by name, not by state, so leaves out of
  view are taken for a tree's.
- **Chests and animals are not covered yet:** `protect_chests` and `protect_animals` are reserved for them.

## For Developers

The code is in `src/agent/neighbor/`:

| File | What it does |
|---|---|
| `natural.js` | Natural ground by name, what a trunk and a canopy are, what grows beside a trunk |
| `trees.js` | The natural-tree test, over a reader of what the bot knows |
| `protect.js` | The rule: why a block may not be broken, or nothing |
| `grants.js` | Blocks a player let the bot break: reading `!allowBreak` from a player's own chat message, keeping each grant for one break and ten minutes |
| `enforce.js` | Puts the rule under the pathfinder's `safeToBreak` and the bot's `dig` |
| `install.js` | Reads the settings, builds the reader (fair play's view, or the raw world), and guards the bot |

It is installed by one call in `src/agent/agent.js` ([core hook](core-hooks.md) 30). Its tests are
`tests/neighbor_*.test.js`, and `tests/live/neighbor_scenarios.js` checks it on a real server.
