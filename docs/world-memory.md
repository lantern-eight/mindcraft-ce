# World Memory

World memory lets the bot remember the world the way a player who has been there does: what it saw and
where, what was in the chests it opened, where its base is, the ways it has walked, and whether a place
is as it left it.

Without it, the bot remembers a short list of notable blocks. With it, the bot can answer "where is the
iron?", walk back to "the base", and say "two chests are gone" when it comes home.

- [Turning It On](#turning-it-on)
- [What the Bot Remembers](#what-the-bot-remembers)
- [What the Model Can Ask](#what-the-model-can-ask)
- [Noticing Changes](#noticing-changes)
- [Is It Fair?](#is-it-fair)
- [Speed and Size](#speed-and-size)
- [Known Limits](#known-limits)
- [For Developers](#for-developers)

## Turning It On

In `settings.js`:

```javascript
"world_memory": true,
```

It is **off by default** while it is new. It needs `fair_play` to be on (`"strict"` or `"custom"`),
because it sees through fair play's eyes. With `world_memory` off, nothing here runs and the bot behaves
as before.

Memory is kept per server, world and dimension, under `bots/<name>/memory/`. The Nether never mixes with
the overworld, and one server's base is never looked for on another. Deleting that folder makes the bot
forget.

## What the Bot Remembers

| Layer | What it holds | Example |
|---|---|---|
| **Cells** | Every block the bot has seen, exactly, in 16-block cubes | "sand, 30 blocks north" |
| **Things** | Single objects a player uses, with their state and when they were last seen: containers, workstations, doors, beds, signs, portals, spawners, ores | "an oak door, open, seen an hour ago" |
| **Contents** | What was in a container, taken when the bot opens it and again when it closes it | "chest: iron_ingot 30, bread 6" |
| **Fields and herds** | Per area: how many plants of a crop and how many were ripe; which animals and how many | "wheat x12, 5 ripe", "cow x4" |
| **Trail** | Where the bot has walked, as spots joined by links it can route over | "about 40 seconds on foot by a way you know" |
| **Places** | Sites it found (things a player uses, close together) or was told the name of | "the base: chest 4, furnace 2, red_bed 1" |
| **Changes** | Short notes for when a place is not as it remembers it | "Gone: chest 2. New: oak_planks 42" |

How it behaves:

- **Memory is a belief, not the truth.** A chest emptied while the bot was away is still remembered full
  until the bot opens it again. A furnace someone removed is still "there" until the bot looks.
- **A double chest, a bed and a door are each one thing,** as they are to a player.
- **Something seen to be gone is marked gone, not deleted,** so the bot can say what used to be there.
- **A place needs no one to save it.** Chests, workstations, beds, doors and signs close together become
  a site as soon as they are seen. It can be named later, by the model or a player.
- **Saved places move in.** `!rememberHere` and `!goToRememberedPlace` work as before, and a name saved
  that way is now a place.

## What the Model Can Ask

The model never sees the store. It asks short questions and gets short answers, so the prompt stays small
however much the bot remembers.

| Command | What it does |
|---|---|
| `!recall(what)` | What the bot remembers, nearest first. `what` can be a block type (`sand`, `iron_ore`), a kind of thing (`chest`, `door`, `bed`, `containers`), an item (`iron`, answered from the containers it opened), an animal (`cow`), a crop (`wheat`), a place name, or `changes` |
| `!places` | The places it knows, nearest first, and what is at each |
| `!namePlace(name)` | Names the place the bot is standing in |
| `!rememberHere(name)`, `!goToRememberedPlace(name)` | As before, now kept in world memory |

An answer says where, how far and which way, how long ago, and, when the trail joins the bot to the spot,
how long the walk is:

```
IN CONTAINERS YOU OPENED
- chest at 4, 70, 0: iron_ingot 30 (looked 10 minutes ago), 18 blocks east, about 4 seconds on foot by a way you know
```

Searches such as `!searchForBlock` use the same memory, for every kind of block.

## Noticing Changes

When the bot looks at a place again and what it sees differs from what it remembers, the differences are
gathered into one note per place:

> Noticed at the base: Gone: chest 2. New: oak_planks 42, glass 6.

A note is added once to the result of the action the bot was doing when it noticed, and kept in a short
log that `!recall("changes")` shows. It states what was seen and carries no instruction.

| What the bot sees | Reported? |
|---|---|
| A remembered block is now a different block, or gone | Yes, whichever side it is seen from |
| A block where the bot had seen empty space | Yes: it appeared |
| More of the same kind of block, first seen in the same look and touching one that appeared | Yes, counted with it: it is the rest of the new wall |
| Any other block the bot simply had not seen before | No. It is newly seen, not changed |
| A chest, door or other thing it never recorded, in a place it had looked over on an earlier visit | Yes, as "first seen" |
| What the bot dug or placed itself | No |
| A change that happened while the bot was watching that spot | No |
| Crops, leaves, grass, snow, fire, water, lava and falling sand changing | No. They change by themselves |

Small differences are dropped as noise: a note needs a thing (a chest, a door) or at least eight blocks.
A double chest, a bed or a door counts once, though it fills two cells.

## Is It Fair?

World memory holds only what a player in the bot's place could know:

- **Blocks and things** are recorded only when in view, by the same sight test as the rest of
  [fair play](fair-play.md). Buried ore is never recorded.
- **Container contents** are only what the bot saw by opening the container.
- **The trail** is the bot's own past positions.
- **A change** is only noticed by looking again.

It does remember perfectly, which a person doesn't. A player has coordinates on the debug screen and can
write things down; the bot's notes are just more thorough.

## Speed and Size

World memory is built so it never slows the game.

- **Looking around is spread out.** The bot looks over everything within 24 blocks in slices of a few
  milliseconds, and does nothing while it stands still in an unchanged world.
- **No model calls.** Recording, routing and noticing changes are plain code.
- **Reading and writing a remembered block** take tens of nanoseconds.
- **Saving** happens once a minute, only for what changed, a few milliseconds at a time.

Measured with the bot standing in a normal world (one laptop; your numbers will differ):

| Where the bot stood | A whole look-around, first time | The same ground again | Slices of work |
|---|---|---|---|
| On the surface | 14 ms | 11 ms | 2, the longest 4.2 ms |
| In a cave | 23 ms | 19 ms | 5, the longest 4.1 ms |
| Inside a house full of chests | 10 ms | 3 ms | 1 |

| Asked of memory | Time |
|---|---|
| The nearest five blocks of one type | About 0.1 ms |
| The text of a `!recall` answer | Under 0.01 ms |
| A route across a trail of 1,000 spots (4 km walked) | 0.5 ms |
| A route across 100,000 spots (400 km walked) | 24 ms |

| Stored | Size |
|---|---|
| One 16-block cube, on disk | 120 to 320 bytes; about 160 on average |
| One cube in memory | 4 KB, for the cubes near the bot |
| A kilometre of new ground walked | Roughly 50 to 150 KB of cells and 25 KB of trail |

Walking the same ground again adds nothing. Cells are kept in small region files (64 blocks a side) that
load only when something asks about that part of the world.

## Known Limits

- **The trail is recorded but not yet walked.** `!recall` says how long a known way takes, but travel
  still uses the pathfinder alone. Following the trail on long trips is planned.
- **It needs fair play on.** Recording with fair play off is planned.
- **Only names are kept for ordinary blocks,** not which way a stair faces or how grown one plant is.
  Things (chests, doors, beds) keep their full state.
- **Ridden travel is not on the trail:** boats, minecarts, elytra and portals. On foot, ladders and
  swimming are.
- **The same-spot rule is not used yet.** A block that turns up where the bot had recorded nothing is
  reported only if the bot had seen that cell empty, which covers anything built on ground it has seen.
- **Memory never fades.** A much-travelled world grows by the sizes above and nothing is thinned out yet.
- **The trail is saved as one file.** That is quick for a long time (under 3 ms at 40 km walked) and
  grows with the trail: about 50 ms at 400 km walked, which would be felt once a minute.

## For Developers

All of it lives in `src/agent/memory/`:

| File | What it is |
|---|---|
| `cells.js` | Every block seen, one byte per cell in 16-block cubes, in region files with an index of which regions hold which names |
| `things.js` | Single objects with state, container contents, fields and herds |
| `trail.js` | Crumbs and links, and the quickest route between two crumbs |
| `places.js` | Sites found or named |
| `changes.js` | Which differences are worth a note, and the notes |
| `kinds.js` | **The one file that knows what a chest, a door or a crop is,** by name pattern |
| `block_state.js` | Block states to named properties and back |
| `store.js` | Opens the five layers for one world and saves them together |
| `recorder.js` | **The only part that touches the game.** Writes what the bot sees and does into the store |
| `commands.js` | What the model can ask, and how the answers read |
| `install.js` | Starts it for one agent, and stands in for the saved-places bank |
| `files.js` | Folders per world, atomic writes, damaged files set aside |

**The store never touches the game.** The five layers are plain data handed names, positions and a clock,
which is why their tests need no server. Only the recorder reads the world, through perception.

**Staying apart from the game.** The store keeps names, positions and times, never the game's numbers for
blocks, states or items, which change with every game version. A world saved under one version loads
under the next; a block name the new version dropped simply never matches. When a game update does need
a tweak, `kinds.js` is where it goes.

**How it hooks in.** Perception takes world memory as its memory in place of the seen-world map, and
leaves the looking around to the recorder. No Mindcraft file is edited for this beyond the new setting:
saved places are swapped in through a stand-in with the same calls as the place bank. See
[`core-hooks.md`](core-hooks.md).

**Tests.** `tests/memory_*.test.js` cover each layer and the recorder on hand-built worlds.
`tests/live/memory_scenarios.js` runs the whole thing on a real server with no model calls:

```bash
export MC_TEST_JAVA=/path/to/java
export MC_TEST_SERVER_JAR=/path/to/server.jar
node tests/live/memory_scenarios.js
```
