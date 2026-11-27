# World Memory

World memory lets the bot remember the world the way a player who has been there does: what it saw and
where, what was in the chests it opened, where its base is, the ways it has walked, and whether a place
is as it left it.

Without it, the bot remembers nothing out of view. With it, the bot can answer "where is the iron?",
walk back to "the base" by the way it came, and say "two chests are gone" when it comes home.

- [Turning It On or Off](#turning-it-on-or-off)
- [What the Bot Remembers](#what-the-bot-remembers)
- [What the Model Can Ask](#what-the-model-can-ask)
- [Finding the Way](#finding-the-way)
- [Noticing Changes](#noticing-changes)
- [Is It Fair?](#is-it-fair)
- [Speed and Size](#speed-and-size)
- [Known Limits](#known-limits)
- [For Developers](#for-developers)

## Turning It On or Off

World memory is **on by default**. To turn it off, in `settings.js`:

```javascript
"world_memory": false,
```

It needs `fair_play` to be on (`"strict"` or `"custom"`), because it sees through fair play's eyes. With
fair play off it does nothing, whatever this setting says. With `world_memory` off, nothing here runs:
the bot knows only what it touches and sees now, has no `!recall`, and every walk is planned afresh.

Memory is kept per world and dimension, under `bots/<name>/memory/`. The Nether never mixes with the
overworld, and one world's base is never looked for in another. A world is known by its seed, as the server
shares it, not by the server's address, so a world opened to LAN keeps its memory though it gets a new port
every session. The `world_id` setting names a world instead; only a server that hides its seed is told apart
by its address. Memory saved by an older version, which went by the address, is carried over the first time
the bot is in that world again, and the old folder is left as it was. Deleting the folder makes the bot
forget.

## What the Bot Remembers

| Layer | What it holds | Example |
|---|---|---|
| **Cells** | Every block the bot has seen, exactly, in 16-block cubes | "sand, 30 blocks north" |
| **Things** | Single objects a player uses, with their state and when they were last seen: containers, workstations, doors, beds, signs, portals, spawners, ores | "an oak door, open, seen an hour ago" |
| **Contents** | What was in a container, taken when the bot opens it and again when it closes it. A shelf has no lid: what stands on it is taken whenever its front is in view, and a shelf seen only from behind, beside or above is one of unknown contents | "chest: iron_ingot 30, bread 6" |
| **Fields and herds** | Per area: how many plants of a crop and how many were ripe; which animals and how many | "wheat x12, 5 ripe", "cow x4" |
| **Trail** | Where the bot has walked, as spots joined by links it can route over and walk again | "about 40 seconds on foot by a way you know" |
| **Places** | Sites it found (things a player uses, close together), spots it was told the name of, and places a player told it the position of | "the base: chest 4, furnace 2, red_bed 1" |
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
- **What a player tells it is kept apart from what it saw.** See [Places a Player Told It Of](#places-a-player-told-it-of).

## What the Model Can Ask

The model never sees the store. It asks short questions and gets short answers, so the prompt stays small
however much the bot remembers.

| Command | What it does |
|---|---|
| `!recall(what)` | What the bot remembers, nearest first. `what` can be a block type (`sand`, `iron_ore`), a kind of thing (`chest`, `door`, `bed`, `containers`), an item (`iron`, answered from the containers it opened and the shelves whose fronts it saw), an animal (`cow`), a crop (`wheat`), a place name, or `changes` |
| `!places` | The places it knows, nearest first, and what is at each |
| `!namePlace(name)` | Names the place the bot is standing in |
| `!rememberHere(name)`, `!goToRememberedPlace(name)` | As before, now kept in world memory |
| `!rememberToldPlace(name, where)` | Remembers a place a player gave the position of: `"300 64 -120"`, or `"300 -120"` when they gave no height |
| `!goToPlace(name)` | Walks to any place it knows by name: found, named or told |
| `!forgetPlace(name)` | Forgets a told place it hasn't seen, when a player takes it back |

An answer says where, how far and which way, how long ago, and, when the trail joins the bot to the spot,
how long the walk is:

```
IN CONTAINERS YOU LOOKED INTO
- chest at 4, 70, 0: iron_ingot 30 (looked 10 minutes ago), 18 blocks east, about 4 seconds on foot by a way you know
```

Searches such as `!searchForBlock` use the same memory, for every kind of block.

### Places a Player Told It Of

Players tell each other where things are: "the village is at 300, -120", read off the debug screen or a
minimap. The bot can remember that with `!rememberToldPlace`, and walk there with `!goToPlace`. But it
hasn't seen the place, so until it does, the place is kept apart from everything it saw:

- **It is listed as told,** with who said it, when, and the position as it was said: `"village" (told by
  Steve 2 hours ago, not seen yet) at 300, ?, -120: 323 blocks east`.
- **Nothing seen joins it or is filed under it.** A chest seen beside it starts a site of its own, and a
  change seen there is not noted against it.
- **A name the bot gave something it saw keeps it.** Told a place under that name, the bot says so and
  saves nothing.
- **Only a player can tell.** When the bot is acting on its own idea, the command refuses, so the model
  can't make up a place and call it told.

**It becomes a place like any other once the bot sees the spot,** by the same sight test as everything
else in memory: after each look-around, a told place within 24 blocks counts as seen when memory holds
the cells there. When no height was given, the bot must be within 16 blocks across the ground, and the
highest block it saw in that column gives the height. The model hears of it once, in passing:

> Seen "village", which Steve told you of, at 300, 71, -120. It is the site where you saw chest 2, red_bed 1.

If the bot had found a site there with no name yet, the site takes the told name. If the site already
has one, the told place stays a spot of its own beside it. A spot the bot had seen before it was told
is confirmed at once. Seen means the bot has looked at the spot, not that what the player said about
it is true.

A told place with no height is walked to by its x and z; `!goToRememberedPlace` needs a height, so
`!goToPlace` is the way there. A player who takes a told place back can have the bot forget it with
`!forgetPlace`; a place the bot has seen stays.

#### Shared Waypoints

Map mods let a player share a waypoint as a line of chat. Xaero's Minimap posts
`xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints`, and JourneyMap
`[name:"Base", x:268, y:64, z:-160, dim:minecraft:overworld]`. A chat message that is one of these and
nothing else is a player telling the bot where a place is, so `src/agent/memory/waypoints.js` saves it as a
told place at once, with no model call to read it. The bot answers in a line of chat (`Got it, Steve: "Base"
at 268, 64, -160. I haven't seen it yet.`), and the model hears of it once, through the change notes.

A waypoint for another dimension goes into that dimension's own places, since each dimension keeps its own
memory: a Nether fortress shared in the Overworld is listed when the bot is in the Nether. A message with
anything more than the waypoint goes to the model as before, and the model can save it with
`!rememberToldPlace`. With world memory off, every message goes to the model.

## Finding the Way

Without world memory, a long walk is planned over blocks, and when that runs out of thinking time the
bot digs in a straight line at the target. With it, **a trip to somewhere the bot has been follows the
way it walked**: out of the cave by the tunnel, round the hill, through the door.

Nothing new to ask for. Every command and skill that walks does this by itself.

- **It follows the trail in hops.** Each hop goes to the farthest spot ahead it can reach **without
  digging or placing anything**. The trail is ground the bot crossed, so needing to dig means the way
  has changed.
- **It cuts corners it can see.** Where the way doubles back and a later part is close and walkable, it
  goes straight there.
- **Ordinary travel finishes the trip.** Where the trail stops short of the target, the rest is planned
  as before. Where the bot knows no way, nothing changes. Ordinary travel plans over the blocks the bot
  remembers too, so a wall it has seen is walked round even where it has never walked.
- **A blocked way is said, once:** "The way you walked before is blocked near 22, 70, 2." The bot then
  tries an ordinary path past the blockage, which may dig, and after that another way it knows. The
  blocked stretch is avoided for a day, or until the bot walks it again.

When the trail is used:

| The target | The trail is used |
|---|---|
| A spot the bot has stood at, or within 3 blocks of one | Yes, however long the way round is |
| A chest, door or other remembered thing | Yes, to where the bot saw it from |
| Somewhere beyond what it has walked | Only when the trail is a fairly direct way to get much closer |
| A spot with a wall the bot remembers between it and the trail | No. Being near through a wall is not a way there |
| A player or animal being followed, or moving away from something | No. Those are left to ordinary travel |
| A way that leads into a [danger zone](threat-reflexes.md#danger-zones) | No. Ordinary travel goes round it; a way out of one is still followed |

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
| A change that happened while the bot was watching that spot: it had that very cell in view under a minute ago, and standing still in front of it all along counts | No |
| Crops, leaves, grass, snow, fire, water, lava and falling sand changing | No. They change by themselves |

Small differences are dropped as noise: a note needs a thing (a chest, a door) or at least eight blocks.
A double chest, a bed or a door counts once, though it fills two cells.

### Who Changed a Cell

Apart from notes, memory keeps one tag per cell for who last changed it: `placed` and `dug` for the bot's
own work, and `built` for a block someone else put there. A cell is tagged `built` when a block stands where
the bot had seen empty space, or in place of a block it remembers, and nothing but a person could have put
it there. That holds whether or not the bot watched it go up, and whatever it is made of: dirt stacked
across a tunnel is built. Blocks that grow, fall, flow, freeze or weather into place are not (crops, trees,
gravel, water, ice, lava meeting water, copper turning green), and neither is the bot's own work. The rest of
a new wall, first seen in the same look and touching a built block of its kind, is tagged with it. A block
the bot placed is its own only while it stands: once the bot sees it gone, or someone else's block in its
place, the `placed` tag goes, and a block set there later is built.
[Good-neighbor rules](good-neighbor.md) leave built blocks alone.

## Is It Fair?

World memory holds only what a player in the bot's place could know:

- **Blocks and things** are recorded only when in view, by the same sight test as the rest of
  [fair play](fair-play.md). Buried ore is never recorded. That is what was on screen, the way the bot
  faced at the time: what is behind it is not recorded until it turns. A turn of more than a quarter of the
  screen starts a new look, as a step does. A look takes a few seconds, done a few milliseconds at a time;
  a turn while one is under way looks again first at the cubes already gone over that the new screen shows,
  so a turn of a second to look at something records it.
- **Container contents** are only what the bot saw by opening the container, or for a shelf, by seeing its
  front.
- **The trail** is the bot's own past positions, and a route is made only of spots it has stood on.
  Ordinary travel is held to what the bot has seen as well, but has to guess at what it has not
  ([how the bot plans a route](fair-play.md#how-the-bot-plans-a-route)). The trail guesses at nothing.
- **A change** is only noticed by looking again.
- **A told place** is only what a player said, and is never treated as seen until the bot has seen it.

It does remember perfectly, which a person doesn't. A player has coordinates on the debug screen and can
write things down; the bot's notes are just more thorough.

## Speed and Size

World memory is built so it never slows the game.

- **Looking around is spread out.** The bot looks over everything within 24 blocks in slices of a few
  milliseconds, and does nothing while it stands still in an unchanged world. It skips the cubes wholly
  off screen, and looks again when it turns.
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
| Deciding whether one hop can be walked | At most 200 ms, in slices of 10 ms with the game running in between |

On a real server, a trip of 84 blocks round a corridor took 15 seconds along the trail and broke
nothing. The same trip without it took 6 seconds, by digging through the wall.

| Stored | Size |
|---|---|
| One 16-block cube, on disk | 120 to 320 bytes; about 160 on average |
| One cube in memory | 4 KB, for the cubes near the bot |
| A kilometre of new ground walked | Roughly 50 to 150 KB of cells and 25 KB of trail |

Walking the same ground again adds nothing. Cells are kept in small region files (64 blocks a side) that
load only when something asks about that part of the world.

## Known Limits

- **The trail leads only where the bot has been.** To a spot it has only seen from afar, such as sand
  across a valley, travel is planned as before unless the trail happens to lead much closer.
- **Getting past a blockage may dig.** The bot does not yet tell a cave-in from a wall someone built.
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
| `places.js` | Sites found, named or told |
| `told.js` | Places a player told the bot of: reading the position, and seeing the spot |
| `changes.js` | Which differences are worth a note, and the notes |
| `kinds.js` | **The one file that knows what a chest, a door or a crop is,** by name pattern |
| `block_state.js` | Block states to named properties and back, through the [edition seam](edition-seam.md) (`src/agent/edition/`), since each edition of the game numbers states its own way |
| `store.js` | Opens the five layers for one world and saves them together |
| `recorder.js` | **The only part that touches the game.** Writes what the bot sees and does into the store |
| `navigator.js` | **The only part that drives the pathfinder.** Chooses where a trip ends and each hop along the trail |
| `commands.js` | What the model can ask, and how the answers read |
| `install.js` | Starts it for one agent, and stands in for the saved-places bank |
| `files.js` | Folders per world, atomic writes, damaged files set aside |

**The store never touches the game.** The five layers are plain data handed names, positions and a clock,
which is why their tests need no server. Only the recorder reads the world, through perception. The
navigator's choices are kept apart from its walking in the same way: it is handed a small set of "legs",
and the real ones wrap the pathfinder.

**Staying apart from the game.** The store keeps names, positions and times, never the game's numbers for
blocks, states or items, which change with every game version. A world saved under one version loads
under the next; a block name the new version dropped simply never matches. When a game update does need
a tweak, `kinds.js` is where it goes. Its names are Java Edition's; another edition of the game hands it
a translation of its own names (`translateNamesWith`), while memory keeps the names the game in play
uses. Which two blocks make one double chest is read from the state where the game keeps it there, and
otherwise asked of the [edition seam](edition-seam.md) (`otherHalfOf`), so a double chest is one thing
either way. What a sign says is asked of the seam too (`signSidesOf`): each edition keeps it in a block
entity of its own shape.

**How it hooks in.** Perception takes world memory as its memory (its `memory` option), and the
recorder does the looking around. Route planning asks perception in turn, so the pathfinder plans
over remembered blocks, and over the air above ground the bot has looked down on (`seenOpen` in `cells.js`). Saved places are swapped in through a stand-in with the same
calls as the place bank. Travel has one line added: before it plans a walk, it asks a guide whether the
bot knows a way, and the navigator is that guide. See [`core-hooks.md`](core-hooks.md).

**Tests.** `tests/memory_*.test.js` cover each layer and the recorder on hand-built worlds.
`tests/live/memory_scenarios.js` and `tests/live/navigator_scenarios.js` run the whole thing on a real
server with no model calls:

```bash
export MC_TEST_JAVA=/path/to/java
export MC_TEST_SERVER_JAR=/path/to/server.jar
node tests/live/memory_scenarios.js
node tests/live/navigator_scenarios.js
```
