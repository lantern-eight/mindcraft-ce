# Changelog

All notable changes to this fork are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are this fork's own. Each release names the Mindcraft-CE commit it is built on.

## [Unreleased]

### Added

- Exploring steers by what the bot remembers, on both editions: before each stretch it checks what world
  memory holds at the stretch's end, and doesn't set out for water, lava or a drop of more than 8 blocks it
  saw from afar. It tries half the stretch, then the next way round, and says what it turned from ("a drop
  to the west"). When memory says every way is bad, it walks the first anyway.
- Exploring underground: under a roof, a stretch ends at the farthest spot towards the heading where the bot
  has seen room to stand, so it follows the cave it can see instead of walking into rock. Needs world memory.
- An exploring answer says what the walk came across: the kinds of ground worth naming (water, sand, ores,
  each kind of log and the like) in view or remembered on the way that weren't around where it began.
- Exploring keeps its heading after a restart: with world memory on, the last walk is saved with the memory
  of the world and dimension it was made in, and `"on"` carries it on.
- The NPC's item goals explore for what they need (`explore` on): when the block or mob a goal needs isn't
  in sight a second time, the bot explores 64 blocks for it on a kept heading, stopping when it is in view,
  instead of stepping 8 blocks any way at all.

## [1.27.0-bedrock.1.29.0] - 2026-11-27

Exploring that keeps its heading, for both editions. Built on the same Mindcraft-CE commit as
1.25.0-bedrock.1.27.0.

### Added

- Exploring, on both editions (`explore`, on by default): `!explore(direction, distance)` walks into new ground
  the way it is told, or with `"on"` carries on the way it was going, so short calls add up to one walk instead
  of wandering back and forth as `!moveAway` does. It goes round water and steep ground rather than digging
  through or swimming out, and looks round after each stretch. `!exploreFor(what, direction, distance)` stops
  as soon as what it looks for (a block or a mob) is in view, and says where one is when the bot already sees
  or remembers it. Under fair play it sees and plans only what the bot does; with world memory it heads for
  land it hasn't looked over. See `docs/explore.md`.

## [1.26.0-bedrock.1.28.0] - 2026-11-27

Shared waypoints from map mods become told places, for both editions. Built on the same Mindcraft-CE commit
as 1.25.0-bedrock.1.27.0.

### Added

- Shared waypoints: a chat line from Xaero's Minimap (`xaero-waypoint:...`) or JourneyMap (`[name:"...", x:..,
  y:.., z:.., dim:...]`) is saved as a told place at once, with no model call, and the bot answers in chat. A
  waypoint for another dimension is kept with that dimension's places, for when the bot gets there.
- `!forgetPlace(name)` forgets a told place the bot hasn't seen, when a player takes it back.

## [1.25.0-bedrock.1.27.0] - 2026-11-27

Places a player told the bot of, for both editions, and a fix to `!bringItem`. Built on the same Mindcraft-CE
commit as 1.24.0-bedrock.1.26.0.

### Added

- World memory keeps places a player told the bot of. `!rememberToldPlace(name, where)` takes the position
  as the player gave it, with or without a height, and only a player can prompt it. Until the bot sees the
  spot the place is listed as told, with who said it, and nothing it sees is joined to it; once seen, it
  becomes a place like any other (the name of the site found there, if that has none), and the model hears
  of it once. `!goToPlace(name)` walks to any place by name, told ones included.

### Fixed

- `!bringItem` throws toward the player. When the bot already knew where they were (seeing all around), it
  turned to them and threw at once, and the server, which had not yet heard of the turn, threw the item the
  way the bot faced before: from the chest it had just emptied, away from the player. About one hand-over in
  four was left on the ground. The bot now lets the turn reach the server first.

## [1.24.0-bedrock.1.26.0] - 2026-11-27

Claude's prompt cache keeps hitting through a long task, for both editions: the memory summary, rewritten every
few steps, no longer sits in the cached start of the request. Built on the same Mindcraft-CE commit as 1.23.0-bedrock.1.25.0.

### Changed

- Claude's prompt cache keeps hitting while the memory summary is rewritten. The summary is rewritten every two
  or three steps of a task, and it sat in the system prompt, so each rewrite lost the cached conversation after
  it. For Claude it now goes after the conversation with the fresh state, on both the native tool path and the
  legacy `!command` path, as do the live stats in the RP agent's prompt. In a measured session, every call
  after the first read all it could from the cache, where 4 of 11 had read only the tools.

## [1.23.0-bedrock.1.25.0] - 2026-11-27

Prompt caching for the legacy `!command` mode, for both editions: Claude reads each step of a task from its
cache there too, and other providers can reuse the start of the prompt. Built on the same Mindcraft-CE commit
as 1.22.0-bedrock.1.24.0.

### Added

- Prompt caching for Claude in the legacy `!command` mode too (`use_function_calling: false`): the system prompt
  and the conversation so far are marked for the cache, and the stats, inventory and examples of each turn go
  once after the conversation instead of inside the system prompt. Each step of a task then reads about 95% of
  its prompt from the cache, where it read none. Coding requests work the same way. `prompt_caching` `"off"`
  sends the request as before.

### Changed

- With native tools off (`use_function_calling: false`), the conversing prompt puts its fixed instructions and the
  command list first, and the goal, memory summary, stats, inventory and examples after them. Providers that
  cache a repeated start of a request by themselves (OpenAI, DeepSeek, Gemini, local servers) can then reuse
  the command list, the largest part, on every call instead of only the first few lines.

## [1.22.0-bedrock.1.24.0] - 2026-11-26

Prompt caching for Claude, and fixes to how the bot's requests are laid out, for both editions. With native
tools on (the default) every model call is about 7,000 tokens shorter, and on Claude each step of a task reads
almost all of its request from the prompt cache. Built on the same Mindcraft-CE commit as 1.21.1-bedrock.1.23.0.

### Added

- Prompt caching for Claude (`prompt_caching`, on by default): native tool requests mark the tools, the
  system prompt and the conversation so far for Claude's prompt cache, so each step of a task reads all but
  its newest turn at a tenth of the input price or less. `"1h"` keeps the cache an hour, `"off"` sends no
  markers. See docs/prompt-caching.md.
- Model usage counts the input tokens written to a prompt cache per role (`written`, beside `cached`), and
  `model_pricing` takes a `cache_write_per_million` rate for them.

### Fixed

- With native tools on (the default), the system prompt no longer holds a second copy of the whole tool list,
  which already reaches the model as its tools: about 7,000 tokens less on every model call.
- With native tools on, Claude and Gemini read the conversation's system notes (tool results, deaths, mode
  changes) where they happened, as the other providers do, instead of all of them at the end of the system
  prompt, out of order.
- Claude 4.6 and later (Claude 5.x included) on the text path: a request no longer ends on the bot's own turn,
  which these models reject; long turns are no longer cut off by a 4,096-token limit that their thinking
  counts toward (the default is now 16,000, and it no longer leaks into the native tool path); a declined
  request says so instead of "No response from Claude."; and an empty reply is tried once more. From
  r77tchan's fork.
- The same on the native tool path (the default): a request no longer ends on the bot's own turn, long turns
  are no longer reported as "truncated" at 4,096 tokens (the default is now 16,000), and a declined request
  is logged as declined instead of as an empty reply.

## [1.21.1-bedrock.1.23.0] - 2026-11-26

Blast furnaces and smokers for Bedrock Edition, and a fix to gathering for both editions. Built on the same
Mindcraft-CE commit as 1.21.0-bedrock.1.22.0.

### Added

- Blast furnaces and smokers on Bedrock Edition too. As on Java, ores and raw metal go to a free blast furnace
  and food to a smoker before a furnace, and smelt in half the time: the library the bot runs on now fills
  their windows, which it couldn't before.

### Fixed

- Gathering picks up a drop that fell out of sight, under fair play's view through a screen. When a block the
  bot broke gave nothing, it looks at the floor where the block was, and steps over to the hole if no item is
  to be seen. A drop lying in the hole the bot had just dug, a block from its feet but out of view, was left
  on the ground: four stone dug out of the floor came back as three.

## [1.21.0-bedrock.1.22.0] - 2026-11-26

### Added

- Blast furnaces and smokers, on Java Edition. Ores and raw metal go to a free blast furnace and food to a
  smoker before a furnace, and the bot places one it carries before its furnace: they smelt in half the time.
  Its waits, the time it says a load takes, and its results go by the block it used. On Bedrock Edition the
  bot keeps to furnaces, since the library it runs on can't fill the other two yet.
- Several furnaces at once. A big smelt or load is shared between the free furnaces near the first, up to
  four, and those the bot carries when it has a pickaxe to pick them back up: 60 glass in about three and a
  half minutes in three furnaces instead of ten in one. Shares follow each block's speed, and a furnace is
  added only when the fuel covers every share. A stopped smelt is gone on with in all of them.

## [1.20.1-bedrock.1.21.1] - 2026-11-26

Fixes for both editions, found by running the live scenes over and over until each passed every time. No
fixes to inherited code. Built on the same Mindcraft-CE commit as 1.19.0-bedrock.1.20.0.

### Fixed

- A skeleton (or any mob) seen aiming at the bot is remembered as a danger zone whenever the bot takes cover
  from it. The zones were noted once a second, and the walk to cover could take the archer out of view first,
  so the bot then hid from it but later walked back through the spot it shot from.
- `!bringItem` looks round for the player before handing over. Through a player's screen, the bot came back
  from the chest facing it, with its back to the player, and said it didn't know where they were.
- A teleport that turns the bot (a `/tp` with a facing) now sticks. A turn the bot was still making carried on
  from the new facing toward its old target and swung it back round, so it could end up facing away from
  what it was turned to see.

## [1.20.0-bedrock.1.21.0] - 2026-11-25

### Added

- Load and leave: `!loadFurnace` loads a furnace with up to a stack and the fuel for it and leaves it
  working, `!collectFurnace` goes back for what is done and puts in the rest, and `!furnaces` says what is
  smelting where. The next result after a furnace should be done says so, once.
- Lava from a lava farm is smelting's first fuel: with a full lava cauldron near, the bot fills a bucket
  (its own, an empty one it remembers in a furnace's fuel slot, or one it fetches from the chests and shelves
  it may take from, as `!fetchItem` does) and smelts on the lava, keeping its coal. It counts the lava still
  burning, and takes the empty bucket back out.
- Smelting remembers what it leaves in a furnace, per world. A smelt that was stopped (or a bot that
  restarted) is gone on with by the next `!smeltItem` of that item, and a furnace holding only the bot's own
  smelt is no longer taken for someone else's.

### Fixed

- Fuel topped up while a furnace has something in it to smelt catches at once, and smelting counted it as
  not gone in: it then said it burned less than it did, and could put in more than was needed.
- Fetching from a shelf the bot had walked up to with its back to it said what was on the shelf had "not come
  through yet". Through a player's screen the bot knew the shelf only from memory then, which doesn't keep
  what stands on it. It now turns to look at the shelf first, as a player does before clicking it.

## [1.19.0-bedrock.1.20.0] - 2026-11-25

A release for both editions that brings this fork level with Mindcraft-CE's `develop` branch, which has
taken in the `agent-system` branch this fork was built on and is now Mindcraft-CE's one working branch. It
has every fix this fork offered except two still open, and the maintainer combined two of them into a new
creeper retreat. Also vanilla's shears speeds on Java Edition 26.3's new shears tags. Built on Mindcraft-CE's
`develop` branch at commit `0fb1bd1`.

### Changed

- With the threat reflexes off, Mindcraft's `self_defense` reflex backs away from a nearby creeper instead
  of leaving it alone, cowardice on or off. From Mindcraft-CE's maintainer, who combined this fork's two
  creeper and retreat fixes into one.
- While the bot runs from mobs (`avoidEnemies`), fire and lava still make it get out, as before, but low
  health alone no longer cuts the retreat short to run somewhere else. From the same change.

### Fixed

- A resumable action that fails is no longer started again when the bot goes idle, and one that was
  cancelled while waiting its turn to resume doesn't start, or stop the action running then. From
  Mindcraft-CE.
- On Java Edition 1.21.2 and later, a position update held back in the first moments after login is no
  longer sent late, in a later tick beside that tick's own update, which a newer server can kick for.
- On Java Edition 26.3, shears cut wool stairs and slabs as fast as a wool block. The game data the bot
  runs on had them no faster than a hand, so the bot took longer than it should and judged its tools by
  wrong numbers.

## [1.18.0-bedrock.1.19.0] - 2026-11-25

### Added

- Shelves. The bot remembers what stands on a shelf when it sees the shelf's front, and `!chests` lists shelves
  with what was on them. `!markChest` and `!chestFor` say whose a shelf is and what it is for. Fetching
  (`!fetchItem`, `!bringItem`, `!getTool`) takes from shelves by the same rules as from chests: the bot stands
  in front, takes the stack with an empty hand, and puts back what it didn't need. `!putAway` puts things onto
  a shelf only when a player has said what it is for, into an empty slot. A shelf is never sorted, and a
  powered one is never clicked.

## [1.17.0-bedrock.1.18.0] - 2026-11-25

### Added

- Bringing a player something. `!bringItem("Alice", "iron_ingot", 10)` hands over what the bot carries and
  fetches the rest from the chests, then walks up to the player and throws it to them, and says whether they
  took it. It throws from close by and chest high, so the item lands at their feet; Mindcraft's own hand-over
  threw at the feet from three blocks, which on Bedrock fell short enough for the bot to pick it back up.
- Gathering with a full bag. Collecting used to go on breaking blocks with a full bag, leaving the drops on the
  ground. Now it checks for room before each block: with the bot's own or shared chests within 32 blocks it
  puts things away and goes on, saying so in its result; otherwise it stops with "Inventory full".
- Getting a tool. `!getTool("pickaxe", "iron")` uses the one the bot carries, else takes one from the chests,
  else crafts one: it fetches what the recipe is short of (the head, logs or planks for sticks and a table),
  then makes the planks, sticks, table and tool. `"any"` tries the best material first.

### Fixed

- Mindcraft's chest commands (`!viewChest`, `!takeFromChest`, `!putInChest`) use the nearest chest, trapped
  chest or barrel. They looked for chests alone, so a bot standing by a barrel said there was no chest nearby.
- Crafting just after using a chest lost the crafted item on Java. The pinned mineflayer kept one state number
  for every window, so the first crafting clicks after a chest closed went out with the chest's, and the
  server resent the whole inventory in the middle of the craft. It now keeps one for each window, as the
  game's client does (PrismarineJS/mineflayer#4103, pinned until a release has it).
- Crafting on Bedrock took a recipe the bot had nothing for. The server lists a stick from bamboo first, and
  the library let it through for a bot with planks and no bamboo, so crafting sticks failed. Only recipes the
  bot holds every ingredient of are handed out now, as on Java.
- Crafting on Bedrock at a table, right after crafting in the bot's own grid, failed. The library left the
  inventory screen open after a craft, and the craft at the table took it for the table's. A screen a craft
  opens is closed after it now, as on Java.

## [1.16.0-bedrock.1.17.0] - 2026-11-24

### Added

- What a chest is for. `!chestFor(x, y, z, "tools")` says a chest is for a group of items, an item, several
  of those, or the inbox, where players drop things for the bot to file; a sign over a chest saying "Ores"
  or "Iron ingots" counts too, until a player says otherwise. Putting away puts each thing in the chest for
  it and never in a chest for something else; a sort places things in the chest for them first; the inbox
  is left out of both. `!chests` says what each chest is for, and whether that comes from a sign.
- Filing the inbox. `!fileInbox("any", 16)` takes what players left in the inbox and puts it where it belongs,
  by the rules of putting away, a bagful at a time; what fits nowhere goes back into the inbox. Only the
  inbox's things are filed: the bot keeps its own, even of the same kind.

## [1.15.0-bedrock.1.16.0] - 2026-11-24

### Added

- Putting away and fetching (`store_and_fetch`, on by default with chest sorting). `!putAway("all", "any", 16)`
  puts what the bot carries into the chests where those things belong: each kind with its own kind, else with
  related things, else into an empty chest, keeping what it needs out in the world (its best tools and a spare
  pickaxe, armour, food, torches, a few blocks). `!fetchItem("iron_ingot", 10)` takes an item out of the chests
  it remembers holding it, from several if one is not enough. Both use the bot's own and shared chests, and
  players' chests when a player asks; a chest nobody has said is anyone's is left alone and named, so the bot
  asks. Each chest is checked on opening, so a chest someone changed since the bot looked is no surprise.

### Fixed

- Backing away from a skeleton behind a shield, with nowhere to go, the bot no longer lowers the shield just
  as an arrow comes: when the move runs out of time, it ends just after a shot lands, not in the middle of one
  or just before the next.
- Backing away from zombies through a player's screen, the bot no longer stops while they are still close behind:
  it takes a mob that chases to keep coming while out of view, as a player running from zombies does, instead of
  going by where it last saw them.
- Fighting one mob through a player's screen, the bot now turns to look when it is hit from another side, and
  backs away from the second mob it finds there. Before, it kept fighting while the other hit it from behind.

## [1.14.0-bedrock.1.15.0] - 2026-11-24

### Added

- Good-neighbor rules, first part: the bot doesn't break what other players built. Planks, glass,
  cobblestone and everything else that isn't natural ground are left alone, and so is any block it saw
  someone put up, even dirt. Logs are felled only from trees, never from a cabin. Routes go round, block
  collecting skips them, and a dig of one is refused with the reason. Places listed in
  `good_neighbor.protected_areas` are left alone entirely. On by default; `good_neighbor.protect_builds: false`
  turns it off. See docs/good-neighbor.md.
- World memory tags each cell someone else built, beside the bot's own placed and dug cells.

### Fixed

- A block the bot placed no longer stays its own after someone takes it away or puts another block in its
  place: world memory notes the change, and the new block is theirs.

## [1.13.0-bedrock.1.14.0] - 2026-11-24

### Added

- Smelting (`smelting`, on by default): `!smeltItem` uses a furnace that isn't in use, or places the bot's
  own beside it, loads it with the fuel it needs, shuts it and comes back for what is done, a stack at a
  time, as a player does. Fuel is planned: coal and charcoal first, then planks, and logs are made into
  planks before burning (a log goes four times as far that way), two kinds one after the other when one
  doesn't cover it, never what is being smelted or made. The result counts what reached the inventory. See
  [docs/smelting.md](docs/smelting.md).

### Fixed

- Smelting no longer hangs on a furnace that never opens, and never leaves a furnace window open.
- Smelting no longer takes someone else's items out of a furnace's output, uses a furnace with another
  item in it, or digs up the nearest furnace afterwards in place of the one it placed. A furnace it placed
  is picked up only with a pickaxe; without one it is left, instead of being broken for nothing.
- Smelting more than a stack works: it goes in a stack at a time. Fuel is topped up as the smelt goes, so one
  plank left in the slot no longer stops a smelt after one item.
- On Bedrock, a furnace that is burning (`lit_furnace`) is found too.
- World memory finds a block by name again when it was gone at the moment memory was saved and came back
  later: a chest broken and set down again, or on Bedrock a furnace that was burning (another block there)
  when memory was saved.
- On Bedrock, a furnace or a crafting table that did not open could stop the whole bot. It is now an error
  for the skill that asked, as on Java.

## [1.12.0-bedrock.1.13.0] - 2026-11-21

### Changed

- Strict fair play turns the bot's head as a player on a controller does, a half turn in a second
  (`turn_speed` 180), instead of at once. Looking round, turning to a block or a mob, and the reflexes all
  take that time; work that turns a lot is a little slower (gathering from two trees and a boulder, about a
  tenth). `turn_speed: "instant"` turns at once as before.

### Fixed

- With `turn_speed` set, a walk goes the way its route heads while the head is still turning, on the keys a
  player would hold (left, back, a diagonal), instead of the way the bot happens to face. Round a corner it
  swung wide: off a narrow bridge, into a trench beside the path, or stuck in a tight spot.
- With `turn_speed` set, building a pillar under itself the bot looks down before it jumps, as a player does;
  it had jumped first and landed again before its head came round to place the block. And `goToSurface`
  climbs out more surely at any turning speed: it waits to land before judging where it got to, looks up
  again when a newer look cut the first short, climbs again when the pillar's last block didn't go down,
  and steps up out of a hole a block deep at the top instead of calling the hole the surface.
- With `turn_speed` set, the threat reflexes no longer stand still through a turn. Turning to run from a creeper,
  the bot backs away on the keys while its head comes round, and sprints once it faces the way out; a creeper lit
  2 blocks off had gone off while it was still turning. Walled in with no way out, it keeps facing the creeper
  and has its shield up at once, instead of turning its back to look for a way. To hit a creeper it turns to it
  from outside the range that lights it and goes in once it faces it; and after backing off from one it means to
  hit, it turns to face it again.
- Under fair play, `attackEntity` told to land one hit turns the bot to face the mob first, as a player does;
  turning at a player's speed, the walk up could end facing away, and a hit at a mob out of view is refused.
- A creeper's hiss from near where the bot sees one, or saw one lately, is taken for that creeper lighting, not
  a second creeper. Seeing through a player's screen, a creeper the bot had stepped back from was soon behind it,
  and its hiss had the bot back off again from a creeper that wasn't there.
- With world memory on, gathering goes on to blocks it remembers out of sight, such as a tree behind it, after
  breaking the ones in view. A block it had just broken under its own feet turned away every remembered block
  of that kind, so it stopped with "No reachable oak_log found nearby".
- Under fair play, a fresh drop the server reports a little sunk into the block under it is seen, as the item
  drawn bobbing on top of that block is. It had counted as hidden inside the block, and gathering could leave
  such a drop behind.
- Under fair play, a route drops off an edge only onto ground the bot has seen. The cells just under an edge,
  hidden by the ground the bot stands on, counted as ground, so a route could step off a ledge or a cliff:
  leaving a creeper behind, the bot ran off a floor 40 blocks up.

## [1.11.0-bedrock.1.12.0] - 2026-11-21

A release for both editions. Under strict fair play the bot sees through a player's screen instead of all
around: 70° tall on a 16:9 screen, Java's default field of view, and what is behind it it doesn't know until it
turns. Hearing and touch still reach all around, and `fov_degrees: 360` brings the view all around back. The
bot turns to look as a player does: before acting on a block, round about when a search finds nothing in
front, toward a hit or a sound it can't place, and about the whole circle while idle. `turn_speed` makes
every turn take time (off by default for now), and `!lookAround` lets the model have it look. World memory
records only what was on screen. The reflexes were fitted to a bot that can't see behind it: it runs looking
at the ground ahead, backs out of an archer's range facing it behind a shield, goes by distance when it can't
see what it leaves, and settles what it knows of a lit creeper it can no longer see. No fixes to inherited
code. Built on the same Mindcraft-CE commit as 1.7.1-bedrock.1.8.1.

### Added

- `turn_speed`, a fair-play switch for how fast the bot turns its head, in degrees a second. Every turn, the
  fight's and the reflexes' included, is then made a step each game tick, as a player turns, instead of at once.
  `180` is a player on a controller; the default stays `"instant"` for now.
- `!lookAround`, under a narrowed field of view: the bot turns round and looks every way, so the model can
  have it see what is behind it. `!entities` says that only what is in front is listed.
- A skill that searches (collecting blocks, going to the nearest block or mob, attacking the nearest) looks
  round first through a player's screen when it found nothing, or only something far off, unless it has just
  looked every way from there.

### Fixed

- A lit creeper that blew up out of the bot's view stayed in what the creeper reflex knew, still lit, and the
  bot could go on getting away from it, missing a real creeper meanwhile. A blast heard where a lit creeper
  was now settles it, and so does looking at where a creeper stood lit and seeing nothing there, or a hit
  from its side once its fuse has run out: a silent creeper's blast makes no sound.

- A walk whose route ended short of its goal, on ground the bot had not seen and that turned out not to be
  there, left the bot standing at the end of it until its action timed out. The route is now planned again
  from there.

### Changed

- Under strict fair play the bot sees through a player's screen instead of all around: 70° tall on a 16:9
  screen, about 102° across, Java's default field of view, on both editions. What is behind it, it doesn't
  see until it turns. Hearing and touch still reach all around. `fair_play_custom` `fov_degrees: 360` brings
  back the view all around, and `fair_play: "off"` keeps it.
- `fov_degrees` is now the game's own field-of-view number: the height of the screen in degrees, `30` to
  `110` as on the game's slider, on a 16:9 screen, and what the bot sees is shaped like that screen, not a
  cone. `360` means all around; any other number is refused at startup. It used to be the width of a cone.
- A player's name tag shows through walls only when it is on screen, as in the game. A player standing
  behind the bot is no longer known from their name tag.
- World memory records only what is on screen, the way the bot faces at the moment it looks, and looks again
  when the bot turns, even in the middle of a look, so a turn of a second to look at something records it.
- The bot turns to face a block within reach before digging, opening, using or placing against it, then
  checks that it can see it, as a player turns to click something behind them.
- Through a player's screen, what the bot heard says which side of it the sound came from as well as which way:
  `heard: zombie (behind you, south, close)`.
- Through a player's screen, with the threat reflexes on, the bot glances toward a hit from something it can't
  see, a hostile mob heard close by, a shot heard, and back the way it came when it has backed off from a
  threat, holding the look about a second. A glance at a sound that showed nothing is remembered, so a zombie
  groaning behind a wall turns the bot once, not every few seconds.
- Under fair play the idle bot looks about the whole circle in turn, a look every second or two through a
  player's screen, and looks at a mob or player the way a person does: it holds the look, looks away, looks
  back, and after a few looks leaves them alone a while. With several in view it looks between them, so none
  is turned off the screen. It looks only at mobs and players, never an item lying on the ground. While a
  hostile mob is in view it holds still, so it doesn't turn another off the screen that the reflexes need to
  see. Mindcraft's idle look stared at the nearest entity, items included, or looked a random way.
- While it walks through a player's screen, the bot looks a little down at the ground ahead, as a player does,
  instead of level over it, so it sees where it is about to step.
- Getting away from a creeper or a mob, the bot turns to the way out and runs looking at the ground ahead, as a
  player does. Running with its head level, through a player's screen it couldn't see the next steps and left
  the sprint for the slower pathfinder. Cornered by a lit creeper with a shield, it turns to the blast behind the shield
  first, wherever it knows the creeper to be, seen or heard.
- Through a player's screen, the reflexes' moves (a dash, cover, a step back in a fight) count open ground
  the bot has seen and remembers as open. They took everything out of view for unknown, so a bot facing a
  skeleton found no cover behind it, beside a wall it had just looked at. Cover the bot can't find a way to
  ends the move at once, so it backs out of range instead of waiting there while the skeleton shoots.
- Through a player's screen, a lit creeper the bot has just run past, now behind it, still counts for the
  shield: it stands where it was, and the bot turns the shield to it. The shield went up only at one in view,
  and a creeper touched but out of sight was taken to have gone off.
- A creeper the bot sees die is gone from what it knows at once, and a hiss the game still plays where it fell
  is taken for that creeper. The kill went on being a lit creeper out of view, or a new one heard, and the
  bot backed off from it a moment after the hit that killed it.
- A dash away from a threat checks every cell the body sweeps, along both its sides, not only the middle of
  its line each whole block. At 45 degrees from the middle of a block it could aim between two walls that
  meet at a corner, and stall there with a lit creeper behind it instead of raising its shield.
- Through a player's screen, leaving a creeper that follows, the bot takes it to be coming on at a walk while
  it runs facing away. Measured from where it last saw the creeper, it stopped inside the creeper's reach,
  looked back, and left again, for as long as the creeper kept up.
- With a shield and no cover near, the bot backs out of an archer's range walking backwards, facing it, as a
  player does. Running, it faced away from the archer, and a shield covers only the side the bot faces: through
  a player's screen it couldn't see the archer draw or tell its next shot was due, and never raised the shield;
  seeing all around, it turned to raise it too late as often as not. In a walled pen on Bedrock it took every
  arrow.
- Through a player's screen, backing away from mobs, or out of an archer's range with no cover near, goes on
  to its distance. It stopped once the mobs had been out of view for 2 s, as if they had lost the bot, but the
  bot runs facing away from them, so it stopped short.
- Digging down as a staircase, the bot looks at each block before it digs it and at the floor before it steps
  down, as a player does. Through a player's screen it stopped at the first step, which was below its view.
- Going up to the surface, the bot looks up the column above it before deciding where to climb to.
- The enderman gaze guard also counts an enderman behind the bot in a clear line from its eye, so turning
  round can't stare at one.

## [1.10.0-bedrock.1.11.0] - 2026-11-20

A release for both editions. The bot uses a shield the way a player does: it keeps one in its off-hand, holds
it up while an archer it sees draws its bow and until the arrow lands, and faces a creeper's blast behind it
when it can't get clear in time. It stands while the shield is up, and lowers it to move or to swing. In the
fight arena on Java a sword and a shield took half or less of a sword's damage from skeletons, and a bot with
both now takes on two skeletons by its own judgment, on both editions. A Bedrock skeleton shows no bow drawn,
so there the bot goes by the beat of its shots, heard, as it backs out of range; a creeper's blast is stopped
there as on Java. A meal and a raised shield no longer cut each other short, and the fight no longer gives up
on a skeleton it is hitting or that backs away from it. No fixes to inherited code. Built on the same
Mindcraft-CE commit as 1.7.1-bedrock.1.8.1.

### Added

- The fight uses a shield. A shield the bot carries goes in its off-hand when a fight starts, and while an
  archer it sees is drawing its bow, with the mob it fights out of reach, the bot stops, faces the archer and
  holds the shield up until the arrow lands, then lowers it and goes on. It does so only when every archer
  aiming at it is on the side it faces: a shield covers one side. The shield is down to move and to swing, as a
  player's must be. In the fight arena on Java, a stone sword and a shield beat a lone skeleton with no damage
  taken (4 without the shield), two skeletons with 4 (8), and two zombies, a skeleton and a spider with 6 (16);
  fights with archers take longer, since the bot stands while it blocks. On Java Edition only: a Bedrock
  skeleton shows no bow drawn.
- Backing out of an archer's range with no cover near, the bot stops behind its shield the same way while the
  bow is drawn. In a walled pen it couldn't get out of, an unarmed bot took no damage from a skeleton with a
  shield, and 8 without. On Bedrock, where no bow is seen drawn, it goes by the beat of the skeleton's shots
  instead: a shot every 3 s, each heard, so the shield is up as the next is due. There the same pen cost 4
  damage with a shield (the first arrow comes unwarned), and 11 without.
- A bot backing off from a lit creeper it can't get clear of in time (it is cornered, or the fuse is nearly out)
  stops and holds its shield up toward it, which stops the blast. Cornered in a dead end, it took no damage, on
  both editions; on Bedrock it holds the shield up by sneaking, as a Bedrock player does.

### Changed

- Fair play's hearing tells a skeleton's shot from its other noises: "skeleton (shooting)", as it already told a
  creeper's hiss. On Bedrock a shot is heard by Java's name for it.
- With a sword or an axe and a shield, the bot takes on two skeletons by its own judgment, as it did only in a
  full iron set. In the fight arena it won every such round, with 8 damage taken on Java and 5 to 8 on
  Bedrock; backing away from them, as before, lost two rounds of three on Java and every round on Bedrock.
- In a fight the bot neither swings nor puts its weapon back in hand in the middle of a meal, which used to cut
  the meal short.
- Eating when hungry waits while the bot holds its shield up, and the shield waits for a meal to end: a meal
  no longer drops the shield in the middle of a block, nor a raised shield cut a meal short.

### Fixed

- The fight gave up on a mob it kept hitting, as "not getting closer": a mob hit is knocked back, and catching up
  to hit it again brought the bot no nearer than the first time. Having the mob in reach now counts as getting
  somewhere.
- The fight stopped following a skeleton 12 blocks from where the fight began, and stood there being shot until
  it gave up: a skeleton backs away as it shoots. It now follows an archer up to 24 blocks.

## [1.9.0-bedrock.1.10.1] - 2026-11-19

A release for Bedrock Edition's records only: the fix that keeps a stopped action from letting go of the keys of
the one after it, made on the bot in 1.9.0-bedrock.1.10.0, is offered to the Bedrock adapter, and
`docs/upstream.md` lists it. Nothing changes for a player. Built on the same Mindcraft-CE commit as
1.7.1-bedrock.1.8.1.

## [1.9.0-bedrock.1.10.0] - 2026-11-19

A release for both editions. The fight fights the way a player does: it swings when the weapon has recharged
(a copper sword used to swing at a third of its damage), measures reach from the eye, steps back between swings
when mobs crowd it, and goes straight on to the next mob. In a new fight arena, measured on both editions, every
armed kit now wins nearly every round, with half the swings and a fraction of the damage. A well-armed bot also
takes on more by its own judgment: three melee mobs and a skeleton with a sword, two skeletons in full iron. No
fixes to inherited code. Built on the same Mindcraft-CE commit as 1.7.1-bedrock.1.8.1.

### Fixed

- A mob the bot was told to fight, and gave up fighting (it couldn't reach it, or after 30 s), was neither
  fought nor avoided for the minute after: an archer could shoot the bot where it stood. The bot's own judgment
  now takes over for that minute, so it takes cover from the archer or backs away from the crowd.
- On Bedrock Edition, an action that was stopped could let go of the keys of the action that took over from
  it as it ended: a retreat that began as a fight ended stood still among the mobs it was backing away from.

### Changed

- The bot takes on more by its own judgment when well armed, as measured in the fight arena: with a sword or
  an axe, up to three melee mobs at once instead of backing away from two, and a skeleton rushed instead of
  hidden from; with a full iron set or better as well, two skeletons. Bare-handed, or under half health, or hungry,
  it is still one mob. See [docs/threat-reflexes.md](docs/threat-reflexes.md#the-fight).
- The fight (`self_defense` with the threat reflexes on) fights the way a player does instead of through
  Mindcraft's combat plugin: it swings when the weapon has recharged (the plugin's table didn't know copper,
  so a copper sword swung at a third of its damage), measures reach from the eye, turns to whichever mob is
  in reach, steps back between swings when two crowd it, sprints straight at a mob on open ground, and goes
  straight on to the next mob that comes for it. It lets go of a mob it can't get closer to, or whose hits
  don't land. In the new arena (`tests/live/fight_arena.js`) a stone sword landed every swing and beat two
  zombies without a scratch.
- The threat reflexes pick the weapon that kills a mob soonest, not the one that hits hardest: on Java Edition a
  sword over an axe of the same material (it swings almost twice as often), except in gold and wood; on Bedrock
  Edition always a sword, which hits harder there. What each weapon does is an answer of the edition seam.

## [1.8.0-bedrock.1.9.0] - 2026-11-19

A release for both editions. A player can give the bot standing orders about kinds of mobs (fight, flee or
ignore), which its reflexes follow at once from then on, and a bot armed with a sword or an axe stands and
fights zombies and spiders instead of backing away from two at once. No fixes to inherited code. Built on the
same Mindcraft-CE commit as 1.7.1-bedrock.1.8.1.

### Added

- Standing orders: a player can tell the bot how to deal with a kind of mob, and its reflexes do so at once
  from then on, without asking the model each time. `!setThreatRule("zombies", "fight", 0, 0)` fights
  zombies however many come; `flee` backs away from them as soon as they come; `ignore` neither fights nor
  moves away. A mob, a group (`zombies`, `skeletons`, `spiders`, `creepers` and more) or `all` can be named.
  Each order lapses under its own minimum health (half health unless told), and under 6 health the bot
  runs from every mob whatever the orders say. Creepers take `fight` (hit it and step back at the first
  meeting, on Java Edition, armed well enough) and `flee` (leave it for good at once), never `ignore`.
  `!threatRules` lists them. Orders given by command are kept in the bot's folder, so they outlast a
  restart; a profile can give its own under `threat_rules`. See
  [docs/threat-reflexes.md](docs/threat-reflexes.md#standing-orders).
- A bot armed with a sword or an axe stands and fights zombies and spiders (not cave spiders) as they come, two at once
  included, instead of backing away from two of them: the built-in orders when the profile has no
  `threat_rules`. Unarmed, it keeps to one mob at a time.

### Fixed

- Hits dealt by a mob in view no longer count as hits from something the bot can't see once that mob has
  died or slipped out of view. In a fight against two zombies, the first one's last hits sent the bot away
  from the second.

## [1.7.1-bedrock.1.8.2] - 2026-11-19

A release of the tests alone: `npm test` passes on the `bedrock` branch again. The bot's code is the same as
in 1.7.1-bedrock.1.8.1. Built on the same Mindcraft-CE commit as 1.7.1-bedrock.1.8.1.

### Fixed

- `npm test` passes on the `bedrock` branch again. The test for a stop during the route search, which came
  with Mindcraft-CE's change in 1.7.1-bedrock.1.8.1, took the edition from `settings.js`, which is Bedrock
  there, and then asked for a Java Edition version.

## [1.7.1-bedrock.1.8.1] - 2026-11-19

A release for both editions that brings this fork level with Mindcraft-CE, which has now merged most of the
fixes this fork offered it. Mindcraft-CE's maintainer improved several of them while merging: the bot picks up
an item from another side when the first try doesn't reach it, uses its bare hand with `useToolOn` again, and
stops a walk when told to while still searching for the route; cheat mode's `tillAndSow` and `placeBlock` are
tightened. Built on Mindcraft-CE's `agent-system` branch at commit `ae4b06c`.

### Changed

- `pickupNearbyItems` tries an item from another side when the first spot it walked to didn't reach it,
  instead of walking back to the same spot. Mindcraft-CE's maintainer added this to the fix for picking up
  items from beside them, and this fork takes it from Mindcraft-CE's `agent-system` branch.

### Fixed

- `useToolOn` with `hand` uses the bare hand again outside creative mode. The check for a missing tool
  from 0.1.0 looked for an item called "hand" in the inventory and refused. From Mindcraft-CE's
  maintainer, who added it to that fix when merging it.
- A stop that comes while `goToGoal` is searching for a route ends the search and the walk. The search
  stopped looking, but the walk then started anyway along whatever it had found. From Mindcraft-CE's
  maintainer, who added it to this fork's fix for the path search's time limit when merging it.
- With fair play off and cheat mode on, `tillAndSow` says it failed when the farmland or the crop couldn't
  be placed, and plants nothing on farmland that wasn't placed. It said it was done either way. From
  Mindcraft-CE's maintainer, who added it to this fork's fix for tilling without a seed when merging it.
- With fair play off and cheat mode on, `placeBlock` no longer sends a second `/setblock` for a trapdoor or
  bedrock. Telling a door or a bed by a name that contains "door" or "bed" also caught them. From
  Mindcraft-CE's maintainer, who added it to this fork's fix for those second blocks when merging it.

## [1.7.0-bedrock.1.8.0] - 2026-11-19

A release for both editions. The bot remembers for a while where it met danger (illagers, a mob aiming at
it, an explosion, hits from something it couldn't see), and its walks go round those places, never
stopping it from walking out of one. On Java Edition 1.21.2 and later the bot hears explosions again, and on
Bedrock Edition it knows an evoker by Bedrock's name for it. No fixes to inherited code. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- Danger zones, on with `threat_reflexes`: the bot remembers for a while where it met danger, and its walks
  go round those places. Illagers seen (a pillager, vindicator, evoker or ravager) mark a wide place for 20
  minutes; a mob seen aiming at the bot, an explosion heard, and hits from something it couldn't see mark a
  smaller one for 5. Every route the bot plans pays to go deeper into one, more toward its middle, so a
  walk bends round it when that is cheap enough; going back out is free, so a bot inside one always walks
  straight out, and a goal inside one is still reached. A way the bot walked before that leads into one is
  left for a route that goes round. Only what the bot saw or heard makes a zone. The
  behavior log says once when illagers were seen; the model gets no message.

### Fixed

- On Java Edition 1.21.2 and later, fair play's hearing never heard an explosion: those servers send an
  explosion's sound inside the explosion itself, not as a sound of its own. So the creeper reflex never
  backed off from an explosion heard very close, and `!entities` never listed one. It hears them now.
- On Bedrock Edition an evoker was neither a mob that always attacks nor one that fights from afar: Bedrock
  calls it `evocation_illager`, and the lists had only Java's name. So the bot waited for one to show a
  target it never shows, and could pick a fight with it. Both lists know it by either name now.

## [1.6.0-bedrock.1.7.0] - 2026-11-19

A release for both editions. The threat reflexes grow past creepers: a second reflex keeps the bot alive
among every other hostile mob, whatever it is doing, and the fight takes on only a lone mob, when the bot is
fit for it. The bot never looks an enderman in the eye, keeps its errands away from a creeper, and its
reflexes stop repeating the same path search every round. No fixes to inherited code. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- A second threat reflex, `mob_safety`, for every hostile mob other than creepers, on with
  `threat_reflexes`. Whatever the bot is doing, even told to `!stay`, it runs from the mobs around when its
  health is under 6; gets behind a wall it has seen when a skeleton, a pillager or another ranged mob aims
  at it (a bow raised or drawn, a crossbow held up), and backs out of range where there is none; backs away
  from two or more mobs coming at it at once, away from all of them together; backs away from a single mob
  when it is too hurt (under half health) or too hungry to fight, or the mob is too strong for a fight
  nobody asked for (a cave spider, a warden, an enderman that was provoked); and gets away when hit twice in
  a few seconds by something it can't see, from the side the hits came from. Other reflexes and the model's
  commands wait for it, and the model hears about the same threat once a minute at most. It has its own
  switch in `!setMode`; `cowardice` keeps its own meaning and stays off by default. On Bedrock, whose server
  shows no mob's target or aim, a mob that always attacks players counts as coming for the bot once in view,
  an archer counts as aiming when it faces the bot, and a hit's side is read from the push it gives.
- With `threat_reflexes` on, the bot never looks an enderman in the eye. Any look that would come close
  to an enderman's head (the idle look-around, a dash away from a creeper, a walk) is lowered to its feet.

### Changed

- While a creeper that isn't lit is within 8 blocks, the reflexes that run errands for an idle bot (picking
  up items, hunting, placing torches, making room for a player) start nothing, and one already walking
  stops. One walked the bot up to a creeper to pick up an item beside it.
- With `threat_reflexes` on, the `self_defense` reflex fights only a lone mob coming at the bot (one that
  has picked a target), and only with the bot at half health or more and fed enough to sprint. It used to
  fight anything hostile within 8 blocks whatever the bot's state: two zombies at once, a passing enderman,
  a skeleton it then chased. A crowd, or a mob too strong to fight, is `mob_safety`'s to back away from.
  A mob the bot fought for 30 s without finishing is left alone for a minute. Its switch and the actions
  that pause it are as before.
- With `threat_reflexes` on, whether the bot can walk to a mob or an item is worked out once and kept for 3 s
  (less if either moves 4 blocks), instead of a new path search each reflex round. The reflexes that hunt,
  pick up items, fight and run away each asked every round, which with mobs about took most of the round.

## [1.5.0-bedrock.1.6.0] - 2026-11-18

A release for both editions. A creeper reflex: the bot backs off from a creeper about to explode, whatever it
is doing, and under fair play it does so the moment it hears the hiss; a creeper that keeps following is hit
and stepped back from, or left behind. Three fixes to inherited code, all offered to Mindcraft-CE. Built on
the same Mindcraft-CE commit as 0.1.0.

### Added

- A creeper reflex, `creeper_safety`, behind a new setting, `threat_reflexes` (on by default). When a creeper
  is about to explode within 7 blocks, or comes within 3, the bot sprints straight away from it, past the
  range its fuse burns within, whatever it was doing: walking to a player, fighting, or told to `!stay`. A
  creeper that keeps following is finished: hit once and stepped back from, when the bot has a weapon that
  kills it in 4 hits or fewer and half its health or more, or else left behind for good. The first step never
  goes into lava or fire or off a drop of more than 2 blocks. While it backs off, other reflexes and the
  model's commands wait for it instead of stopping it, and the model is told once per creeper, in one line.
  It has its own switch in `!setMode`; `cowardice` has no say over it. On Bedrock it works the same, except
  that a creeper that keeps following is always left behind: a Bedrock creeper's own rules aren't measured
  yet.
- Under fair play the creeper reflex also hears: a creeper's hiss close by, or an explosion very close,
  starts a back-off the moment the sound arrives, even with the creeper out of sight around a corner. The
  hiss is remembered as a creeper that may still be lit until the bot has been away long enough for its fuse
  to run down, or sees it with its fuse out.

### Changed

- The descriptions of `!digDown` and `!goToSurface` the model reads say what they do now: under fair play
  `!digDown` digs a staircase, so the bot moves the way it faces as it digs, and `!goToSurface` climbs by
  what the bot has seen above it.

### Fixed

- On Bedrock, the idle look-around looks a baby animal in the eye. It read a baby from Java's metadata, so
  it took every calf for a cow and looked over its head.

- The bot no longer fights a creeper hand to hand. `defendSelf` (and so the `self_defense` reflex) handed a
  creeper to the combat plugin, which followed it to melee range and stood there while it exploded. Both
  now leave creepers out.
- Running from mobs (`cowardice`, `avoidEnemies`) no longer stops to hit a creeper that comes within 3
  blocks; it keeps walking away from it.
- Running from mobs no longer switches off `self_preservation` until it is done, so a bot that flees into
  lava, fire or deep water still gets itself out.

## [1.4.0-bedrock.1.5.0] - 2026-11-18

A release for both editions. Under fair play, skills handed a spot by its coordinates look at the block
before deciding anything from it, instead of naming blocks buried in the ground; `placeBlock` places against
a side the bot can see; `!digDown` digs a staircase that sees each step before it stands on it; and
`!goToSurface` climbs by what the bot knows of the column above it. Three fixes to inherited code, all
offered to Mindcraft-CE. Built on the same Mindcraft-CE commit as 0.1.0.

### Changed

- Under fair play, `!digDown` digs a staircase, one block forward for each block down, the way the bot
  faces, and sees each block it will stand on before it steps onto it. It stops at lava or water it
  uncovers, a drop of more than two blocks, or a block it can't dig, and says which and where. It used to
  dig straight down, checking the blocks under the floor for lava, water or a drop, which a player
  standing there can't see.
- `!goToSurface` climbs to the highest ground the bot knows of above it, looks again from there, and stops
  under open sky with a way to step out sideways. Under fair play it used to read the surface's height from
  the world data and name it before the bot could have seen it. With fair play off the first trip still
  goes all the way up; on either, it no longer stops at the bottom of a pit open to the sky.

### Fixed

- Under fair play, skills given a spot by its coordinates (`!placeHere`, the `placeBlockAt` tool, and
  `breakBlockAt`, `placeBlock`, `tillAndSow` and `useDoor` in generated code) look at the block there
  before deciding anything from it. When the bot doesn't know it, it walks within three blocks and looks;
  a block still hidden is reported as one it can't see. They used to read it from the world data and say
  what it was ("Skipping ... because it is lava", "diamond_ore in the way"), even buried in the ground, so
  they could be used to look inside it.
- Under fair play, `placeBlock` places against a side the bot can see. It took the first solid neighbor,
  often by its side facing away from the bot, and the placement was then refused.
- `breakBlockAt` at a spot whose chunk isn't loaded walks there and looks, instead of failing with an error.
- `placeBlock` says why a placement failed ("Failed to place torch at (1, 64, 2): ..."). It said only that it
  failed, so the model couldn't tell a block in the way from a side out of reach, and tried the same again.
- With fair play off and cheat mode on, `placeBlock` sends a second `/setblock` only for a door's top half or
  a bed's head. It sent both of them for every block it placed, each failing with an error on the server.
- With fair play off and cheat mode on, `tillAndSow` with no seed tills the block instead of crashing, and
  waits for its blocks to be placed before it says it is done.

## [1.3.0-bedrock.1.4.0] - 2026-11-18

A release for both editions. Fair play closes gaps in what the bot knows and does: the combat plugin no
longer hits through walls, a mob that slips out of view is known only where it was last seen, sight sees a
mob by the side of its body and gets shulker boxes, pistons and block edges right, and fair play checks its
own wiring at each spawn. The bot hears doors, chests, footsteps and explosions. Fixes to inherited code,
three of them offered to Mindcraft-CE. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- The bot hears doors, trapdoors and fence gates, chests, barrels and shulker boxes opening and closing, a
  mob's footsteps, and explosions, on both editions, as it already heard mobs: `heard: door (opened) (east,
  near)`. One whose spot is in view is left out, as a mob in view is; an explosion is always listed.
- Fair play checks its own wiring each time the bot spawns: a block buried under the bot must be unknown to
  the searches every command and skill makes. If it isn't, the bot refuses every action and says why. A
  mistake in how fair play is hooked in used to leave the bot seeing through walls without a word.

### Changed

- A block search that runs out of its 200 ms and answers from part of the world now says so in the log, at
  most once a minute, and `tests/live/fairplay_scenarios.js` reports how many searches were cut short.

### Fixed

- Under fair play the combat plugin no longer hits a mob through a wall. It swings from its own timer for as
  long as its target is within its range, and those swings weren't checked: on a test server it hit a
  zombie sealed in stone five times in four seconds. Its swings now land only on a mob within reach that
  the bot saw within the last second.
- Under fair play, `attackEntity` told to land one hit walks within a survival player's reach of the mob
  first. It swung from up to five blocks away, and fair play refused a swing from beyond three.
- `useDoor` with no position goes to the nearest door of any kind, found with one search. It searched once
  for each of the twenty-odd kinds of door and took the first kind it found, not the nearest door.
- `!stop`, or the bot dying, while a new action is taking over from the one running now stops the new one
  too, and any action still waiting to start. The new one used to start anyway, a moment after the stop.
- The bot's surroundings say "unknown" for a spot it has no block for, instead of "air". Under fair play
  that is any spot it hasn't seen; without it, a spot in a chunk that isn't loaded. Either way "air" told
  the model there was open space there.
- A mob half out from behind a corner is seen. Sight looked only along the middle of its body, so a mob
  whose side was in plain view stayed hidden until its middle came out too.
- A mob that slips out of view is known for its 3 seconds where it was last seen, not where it has gone. A
  skill handed it during that time could follow it behind the wall. Reach and sight for hitting it are
  still judged on the mob itself.
- A line of sight that passes exactly along one block's edge is no longer hidden by that block when the
  other side of the edge is open. Which way the line ran used to decide it.
- Fair play's sight takes a shulker box for the solid box it looks like, so the bot no longer sees through
  one, and sees past a piston that has pushed its head out, as past a stair or a slab. The game data rates
  shulker boxes as letting light through, and a piston as a full block whatever its state.
- `fair_play_custom` refuses a number out of range at startup: a field of view of 0 or over 360 degrees, or a
  negative or infinite `entity_distance` or `hearing_radius`. Such a number used to be taken as it was.
- Model-written code no longer stalls the agent when a skill hands back data that refers to itself. The copy
  that keeps live objects away from that code followed every route through such data, up to six levels deep.

## [1.2.2-bedrock.1.3.1] - 2026-11-18

A release for the people making releases: nothing a player sees changes. The perception timing bench now
measures every release on the same land and fails one that made fair play's perception clearly slower. Built
on the same Mindcraft-CE commit as 0.1.0.

### Added

- A timing record for each release: the perception bench, `tests/live/fairplay_perception_bench.js`, now
  starts its own server on a world of normal terrain from a fixed seed, and compares its timings with the
  last release's, kept with the seed and game version in `tests/live/perception_bench_results.json`. It
  fails when fair play's perception got more than half again slower, and `--record` saves a release's
  result. Making a release now runs it.

## [1.2.1-bedrock.1.3.1] - 2026-11-18

A fix release for both editions: the pathfinder patch Mindcraft-CE pins takes the pathfinder's own fix for
slantwise steps past solid corners. Fixes found in mineflayer are offered there. Built on the same
Mindcraft-CE commit as 0.1.0.

### Fixed

- The pathfinder no longer plans a slantwise step past a solid corner, or a slantwise jump onto a raised
  block, for any skill. Its walker can't take such a step, so a bot walking with its own movement settings
  (fighting, collecting blocks) stood still at each turn of a tunnel one block wide. `goToGoal` and
  world-memory travel already went round those corners.

## [1.2.0-bedrock.1.3.0] - 2026-11-18

A release for both editions. World memory no longer takes a change that happened in plain view for news, and
the seen-world map that stood in when world memory is off is gone. Fixes to inherited skills, NPC goals, the
Novita provider and the MindServer, most of them also offered to Mindcraft-CE. Built on the same Mindcraft-CE
commit as 0.1.0.

### Removed

- The seen-world map, the smaller memory that stood in when `world_memory` is off. With world memory off,
  the bot now remembers nothing out of view and has no `!recall`, and an empty-handed search no longer
  points it at memory it doesn't have. The `bots/<name>/seen/` folders it saved are no longer read and can
  be deleted. World memory, on in the shipped settings, is unchanged.

### Fixed

- Item goals for things that can't be crafted, such as raw meat, wool or an ore's drop, no longer crash, and
  hunting for one runs. The goal treated "no recipe" as a list of recipes, and the hunting loop stored each
  attack's result in a variable it never declared.
- `craftRecipe` says so when it has no free spot for its crafting table, or the table can't be placed, and
  crafts nothing. It crashed on the missing spot, and after a failed placement tried the recipe with no table.
- `craftRecipe` asked for something with no crafting recipe, such as raw meat or a misspelled name, says so
  instead of crashing.
- Worn armor is no longer counted as carried. `!inventory` listed a worn helmet twice, once among the items
  and once under WEARING, and recipes counted it as material in the bag. An NPC goal for a piece of armor is
  still met by one the bot wears.
- With a Novita model, a conversation too long for the model is retried without its oldest turn, as meant.
  The retry crashed instead.
- A Bedrock agent set to a version that can't work no longer stays listed on the MindServer with no process
  behind it, its name refused when tried again from the page.
- `!attack` with no mob type says so, instead of pausing the bot's cowardice and looking for a mob with no
  name.
- After `!attackPlayer`, the bot says which player it killed, instead of "Successfully killed player."
- World memory no longer reports a change that happened in plain view as news, on either edition. A bot that
  stood a quiet minute looking at a wall took the wall coming down for something that happened while it was
  away, and a block it had not seen for minutes could count as watched because others near it were in view.

## [1.1.1-bedrock.1.2.1] - 2026-11-17

A documentation release for both editions; the code is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- `docs/upstream.md`: every fix this fork has offered back to Mindcraft-CE and to the libraries it uses, each
  linked to its pull request, and how to work on a fix in one of the library forks.
- The README lists what each Java live test script checks. `docs/bedrock.md` notes quirks of the Bedrock server
  that need no fix, and a few things that can make a Bedrock test run fail for reasons outside the bot.

## [1.1.0-bedrock.1.2.0] - 2026-11-17

A release for both editions. On Bedrock Edition, fair play holds the bot to a Bedrock player's reach, `digDown`
after a walk takes the bot down its hole, Mindcraft's lists of Java block names hold for Bedrock's names, a loom
keeps the dyes it doesn't use, the bot eats as the game's client does, and a hungry bot that isn't eating says
why. The loom and eating fixes are in the Bedrock adapter, which the `bedrock` branch now pins. On Java Edition,
the reach switches now start at `"survival"`, the game's own reach, which is the same 4.5 and 3 as before. The
Bedrock live tests gain a ready-made server to run against. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- A throwaway Bedrock server for the Bedrock live tests, ready to start: `tests/live/bedrock-server/` holds its
  Docker Compose file and a console script that also works on an Apple silicon Mac, where the server image's
  own console command can't find the server. `tests/live/bedrock_all.js` runs all seven Bedrock live scripts in
  turn, each into its own log, with a line for each. `tests/live/bedrock_spawn_check.js` shows what stands at
  the test world's spawn and, with `--clear`, takes it away: leftovers there lift the spawn, and the scenes with
  it, until several scripts fail at once while building them. `docs/bedrock.md` says how to use all three.

### Fixed

- On Bedrock, a loom keeps the dyes a pattern doesn't use. Given a stack of dye, the Bedrock adapter put the
  whole stack into the loom and used one, and the server kept the rest. The fix is in the Bedrock adapter,
  which the `bedrock` branch now pins. The enchanting table, the grindstone and the smithing table were
  checked on a server too, and work.
- On Bedrock, `digDown` straight after a walk takes the bot down the hole it digs. A walk can leave a Bedrock
  bot up to a third of a block off the middle of its block, standing partly on the next one, so it dug the
  hole and stayed on top. Before it digs the block under its feet, the bot now steps to the middle of its
  block, as a player would.
- On Bedrock, Mindcraft's lists of blocks, written in Java's names, now hold: `placeBlock` builds over a thin
  layer of snow and treats a block of snow as in the way (Bedrock calls them `snow_layer` and `snow`; before,
  it dug out the layer and built over the block), and the checks for water and lava in `digDown`,
  `breakBlockAt` and the reflex that keeps the bot alive take Bedrock's `flowing_water` and `flowing_lava` for
  water and lava too. Each check asks for the Java name of the block in front of the bot.

### Changed

- On Bedrock, fair play's reach guard holds the bot to a Bedrock player's reach: 5 blocks to a block and 3 to a
  mob. It used Java's numbers, 4.5 and 3, so a block a Bedrock player could dig was out of the bot's reach.
  The `reach_blocks` and `reach_entities` switches now start at `"survival"`, the reach of the game being
  played; a number set by hand still wins.
- On Bedrock, the bot eats the way the game's own client does: it marks the moment it starts eating, and lets
  go of the food when a meal doesn't finish, so the server doesn't still have it eating when the next meal
  starts. The change is in the Bedrock adapter, which the `bedrock` branch now pins.
- On Bedrock, a hungry bot that isn't eating now says why in its log: a window is open, it is asleep, a meal
  is still under way, it holds nothing it may eat, its hunger can't be read, or the game's ticks have stopped
  so it never looks. Each reason is repeated at most every 30 seconds.

## [1.0.0-bedrock.1.1.0] - 2026-11-17

A Bedrock Edition release: the bot can trade with villagers and knows which biome it is in, takes and puts
amounts spread over several stacks, and says why a meal failed. The fixes are in the libraries: the Bedrock
adapter and the pathfinder, which the `bedrock` branch now pins, and the game data, which both branches pin.
Java Edition is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- On Bedrock, the bot can make a trade with a villager (`tradeWithVillager`). The Bedrock adapter marked one
  part of its request to the server with the number that part had before 1.26.60, so the server dropped
  every trade; the `bedrock` branch now pins an adapter that reads the number from the game version, and this
  fork no longer refuses trades.

### Changed

- On Bedrock, taking from and putting into a chest, a barrel or a shulker box moves the amount asked for from
  as many stacks as it takes, and tops up a stack of the same item before it uses an empty slot, as on Java.
  Before, taking an amount spread over two stacks stopped part way and said the inventory had no room. The
  fix is in the Bedrock adapter, which the `bedrock` branch now pins.
- On Bedrock, the pathfinder no longer moves the bot to the middle of its block when it stops: the server
  refuses that move and corrects the bot. The bot now stays where it stopped. The fix is in the pathfinder,
  which the `bedrock` branch now pins.
- On Bedrock, a meal that fails or gets stuck is now said in the bot's log: which step (taking the food in
  hand, or eating it) and why. Before, a bot that stayed hungry with food in its pockets gave no reason. The
  same message is repeated at most every 30 seconds.

### Fixed

- On Bedrock, the bot knows which biome it is in. It was always "unknown": the Bedrock adapter never read
  biomes from the chunks a current server sends, and the game data numbered Bedrock's biomes alphabetically
  where a chunk carries Bedrock's own numbers. Both are fixed in the libraries, which `main` (the game data)
  and the `bedrock` branch (the adapter) now pin.

## [1.0.0-bedrock.1.0.2] - 2026-11-17

A Bedrock Edition patch: four mistakes in the Bedrock adapter that this fork had worked around are now fixed
in the adapter itself, which the `bedrock` branch now pins, and the workarounds are gone. Java Edition is
unchanged. Built on the same Mindcraft-CE
commit as 0.1.0.

### Changed

- On Bedrock, taking from and putting into a barrel or a shulker box is done by the Bedrock adapter's own
  calls, as for a chest. The adapter now names those containers' slots as Bedrock does; this fork had made
  the moves itself until it did.
- On Bedrock, a barrel opened again straight after it was closed (as chest sorting does) opens as soon as
  the server has shut it, instead of on a second click a second later. The Bedrock adapter now waits for
  that itself.
- On Bedrock, the bot's `move` event, from which world memory lays its trail, comes from the Bedrock adapter
  on every tick the bot moves or turns, as on Java. This fork had fired it itself until the adapter did.
- On Bedrock, closing a villager's trade screen, and not handing back another villager's trades when one
  opens nothing, are done by the Bedrock adapter. This fork had put both right itself until it did.

## [1.0.0-bedrock.1.0.1] - 2026-11-17

A Bedrock Edition patch: a steadier live test, and how to run the Bedrock test server on an Apple silicon
Mac. Java Edition is unchanged. Built on the same Mindcraft-CE commit as 0.1.0.

### Fixed

- The Bedrock skills live test no longer fails now and then on shearing a sheep. A plain summon on Bedrock
  makes a lamb one time in twenty, which can't be sheared, and wool of another color went uncounted once the
  bot had picked it up. The scene now summons an adult sheep and counts wool of any color.

### Changed

- [docs/bedrock.md](docs/bedrock.md#a-throwaway-server) says how to run the throwaway Bedrock server on an
  Apple silicon Mac: under Docker Desktop's emulation the image's console command can't find the server, and
  the page gives one that can.

## [1.0.0-bedrock.1.0.0] - 2026-11-16

Version 1, of both editions. Bedrock Edition joins the project: its code is on `main` with Java Edition's,
behind the `minecraft_edition` setting, and runs on the libraries the `bedrock` branch pins, which are not
released with Bedrock support yet. A version now has a part for each edition: Java Edition's 1.0.0, Bedrock
Edition's 1.0.0. For Java Edition this release brings fixes only. Built on the same Mindcraft-CE commit as
0.1.0.

### Added

- A setting, `minecraft_edition`: `"java"` (the default on `main`) or `"bedrock"` (the default on the
  `bedrock` branch, with `minecraft_version` `"auto"` and `port` 19132). Set to `"bedrock"`, the bot is
  started for a Bedrock Edition server: `minecraft_version` is then a Bedrock version such as `"1.26.60"`
  (or `"auto"`), a port of `-1` means Bedrock's usual 19132, and `auth: "microsoft"` signs in with an Xbox
  account. A Java version left in `minecraft_version` is refused with a message that says what to set. This
  is the connection; the lines below say what else works on Bedrock.
- On `main`, which doesn't install the Bedrock libraries, a bot set to Bedrock stops at once with a message
  that says to use the `bedrock` branch, or to set `minecraft_edition` to `"java"`. Before the libraries
  were checked, it failed deep inside mineflayer.
- The bot can join a current Bedrock Dedicated Server. Servers from 1.26.60 take a direct connection through
  a short HTTP exchange on their game port, which no released `bedrock-protocol` speaks; the open upstream
  work for it is now part of the pinned set. Checked against a dedicated server on 1.26.60: the bot joins,
  spawns in survival, reads the blocks around it and chats. The server shows a key during that exchange. The
  bot accepts it and prints it; a stock server makes a new key at every start, so there is nothing to
  compare it with.
- [docs/bedrock.md](docs/bedrock.md): what works on Bedrock Edition, what doesn't, how to try it, and how to
  test it. A live test, `tests/live/bedrock_smoke.js`, runs against a throwaway Bedrock server: joining,
  seeing blocks, chat, walking, digging, placing, a chest and crafting. It passes on 1.26.60 and on 1.26.63,
  which speaks the same protocol. The whole agent was also started there and answered a player through a
  model.
- A second live test, `tests/live/bedrock_skills.js`, runs Mindcraft's stock skills on a throwaway Bedrock
  server, each in a scene of its own, and checks the world afterwards. All 39 scenes pass on 1.26.63 with
  fair play off: gathering and mining, building, crafting, smelting, chests, farming, fighting, sleeping,
  doors, buckets, villagers, and walking to, following and handing things to another player.
  [docs/bedrock.md](docs/bedrock.md#skills) lists the skills, and the one that doesn't work yet.
- A Bedrock bot eats when it is hungry, as the Java bot does. The plugin that does it on Java can't be
  loaded on Bedrock, so the Bedrock module has its own, with the same switches and the same numbers: it eats
  the most filling food it holds that isn't on the banned list, then holds again what it held before.
- A chest opened on Bedrock is the same kind of object as on Java, with `deposit`, `withdraw` and `close` on
  it, so code written for Java chests has something to work with.
- On Bedrock the bot can use an item it just crafted, and an item it just took out of a chest. Both were
  refused by the server: the Bedrock adapter lost the number the server gives each stack. Fixed in the
  mineflayer branch the `bedrock` branch pins.
- On Bedrock a click on a block is no longer ignored when the block changed after the bot looked it up. A
  Bedrock click names the block it lands on, and the adapter named the one it was handed, not the one that
  is there. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock a block put back where the bot dug stays there. The server was never told that the bot had let
  go of a block it broke, and kept breaking whatever turned up in that spot next, leaving an item on the
  ground each time. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the bot no longer hangs in the air beside a hole. When the bot stops walking, the pathfinder
  shifts it to the middle of its block; a Bedrock server refuses that, and the adapter took only the height
  from the server's answer. The two then disagreed about where the bot stood, and at the rim of a hole it
  fell and was put back up without end. A bot that is standing still now goes where the server says it is,
  so after a walk it may stand a little off the middle of its block. Fixed in the mineflayer branch the
  `bedrock` branch pins.
- On Bedrock the bot can fill a bucket and empty one. Bedrock wants a bucket used on the water or the block
  in view, and the adapter used it in the air. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the bot no longer stops short of where it walks after a pause. When the bot had been busy for a
  moment (looking around for a door, say), the adapter made up every tick it had missed in one step, and the
  bot jumped ahead of where the server had it. The walk counted itself done there, and a second later the
  server pulled the bot back to where it started. So `useDoor` stopped short of the door, and shearing a
  sheep sometimes did nothing. Fixed in the mineflayer branch the `bedrock` branch pins.
- On Bedrock the stock crafting skill works, in the bot's own grid and at a crafting table. A Bedrock server
  sends its recipes when the bot joins, and the adapter keeps them in a layout of its own; the skills now
  get them in the layout they have on Java, a recipe that takes "any planks" included.
- On Bedrock the bot can till soil and plant on it. A click on a block now waits, for a moment at most,
  until the bot has seen what the click did. Code written for Java sends the next click straight away, and a
  Bedrock server ignores a click that still names the block from before.
- On Bedrock the bot finds a bed to sleep in. Bedrock has one bed block for every color, named `bed`; the
  skill looked only for Java's names, which end in `_bed`.
- The bot's status says "Biome: unknown" on Bedrock. Biomes are not read there yet, and the bot stopped with
  an error when it built its status for the model.
- Fair play's sight works on Bedrock. With fair play on, the bot knew blocks it could not have seen, such as
  the ground under its feet and ore inside rock: Bedrock numbers block states by hash, and fair play's list
  of what hides what came out empty. It now knows only what is in view, as on Java. A new live test,
  `tests/live/bedrock_perception.js`, checks it on a server.
- With fair play on, a Bedrock bot hears a mob cry out when it is hurt or dies, as a direction and a rough
  distance, and notices when the server makes it an operator. Both listened for Java's packets only. A mob's
  everyday noises are still not heard: a Bedrock client makes those up itself, and the server never sends
  them.
- World memory keeps a Bedrock world's files apart from other worlds', by a hash of the seed the server
  sends. Before, every Bedrock world was told apart only by the server's address.
- World memory works on Bedrock in part. It remembered a door's state as nonsense, and didn't know a Bedrock
  bed, spawner or beetroot for what they are: it read block states the way Java numbers them, and knew only
  Java's names. It now reads Bedrock's states, and judges Bedrock's names by the Java blocks they stand for,
  while keeping Bedrock's names. A double chest is one thing, paired by what its two blocks say of each
  other, which on Bedrock is not in their states. A new live test, `tests/live/bedrock_memory.js`, checks it
  on a server.
- A live test, `tests/live/bedrock_fair_play.js`, runs fair play as a whole on a Bedrock server, installed
  the way the agent installs it: skills that find and walk to only what the bot has seen, the reach guard,
  the reflex to flee a monster once it is in view, model-written code, refusing to act as an operator or in
  creative mode, and never sending a command. It passes on 1.26.60.
- Chest sorting works on Bedrock. A move in a chest is one item stack request there, not clicks on a cursor,
  and a barrel's slots go by another name than a chest's, which the server holds a request to. A new live
  test, `tests/live/bedrock_storage.js`, sorts a chest of part stacks, a full chest, and a chest, a double
  chest, a barrel and a trapped chest together on a server, and takes from and puts into a chest by name. It
  passes on 1.26.60.
- World memory works on Bedrock as the agent runs it. A new live test,
  `tests/live/bedrock_memory_scenarios.js`, installs it with fair play on a Bedrock server and checks what
  the bot is told: a double chest opened and walked away from, recalled with what was in it and the way
  back; the trail; a saved place; what a sign says; and the hut that went up and the chest that went away
  while the bot could not see, told once. It passes on 1.26.60.

### Changed

- On the `bedrock` branch, the libraries that speak Minecraft Bedrock Edition 1.26.60 are installed:
  mineflayer with the Bedrock edition adapter, the libraries under it with their Bedrock changes, and the
  `bedrock-protocol` transport. None of it is released, so each is pinned by commit to a branch that holds
  the Bedrock work on top of the 26.3 work (listed under [For Bedrock
  Edition](docs/core-hooks.md#for-bedrock-edition)). The bot uses them only when `minecraft_edition` is
  `"bedrock"`; set to `"java"`, it plays Java Edition exactly as before.
- Installing the `bedrock` branch has two wrinkles. npm warns that three packages want Node 24; they run on
  Node 22. And one of the new packages builds a binary with CMake on most machines (Apple silicon and
  current Linux among them), which fails `npm install` where CMake is missing. Run `SKIP_BUILD=1 npm
  install` to skip that build; the bot does not need the binary.

### Fixed

- `useDoor` walks straight through a door that is already open. It turned to the corner of the door's
  block instead of the doorway, and walked into the edge of the open door. A shut door hid this: opening
  it turns the bot to face it.
- Baby villagers are no longer taken for adults. `!entities` listed them among the adults, with a
  profession, and the trading skills walked up to one and tried to trade. The check compared the game's
  "is a baby" flag with 1, which it never equals. Now a baby is listed as one, and trading with it is
  refused with the reason.
- Villagers' jobs are known again on Minecraft 26.x. Their job and level moved to another metadata entry
  in 26.1, so `!entities` listed every grown villager as "Adult", with no job or level.
- World memory keeps what a sign says. A sign was remembered without its text: memory asked for the
  block in a way the real bot can't answer, and the error was quietly passed over.
- The bot no longer stops answering when it stands in a biome the installed game data has no entry
  for, such as on a server newer than the data. Its status then says "Biome: unknown". Before, building
  the status failed, and every message got the "having trouble" reply.
- On Bedrock `useDoor` finds an oak door by itself, and walks through a door that is already open. It looked
  for the oak door by Java's name, `oak_door` (Bedrock's is `wooden_door`), and read whether a door was open
  from Java's `open`, so it took every Bedrock door for shut and closed an open one in its own way.
- On Bedrock `!entities` names each villager's job and level and lists children apart, and
  `!showVillagerTrades` shows a villager's trades. Bedrock names villagers `villager_v2` and keeps the job
  and level in fields of its own, which Mindcraft read the Java way, and showing a jobless villager's trades
  showed those of the villager opened before it. Making a trade is refused for now, so the bot keeps what it
  would have paid with: on a current server the trade took the goods and never happened.
- On Bedrock the hunting reflex leaves young animals alone, as on Java. It read a mob's age where Java keeps
  it, which a Bedrock mob never fills in, so every calf passed for a cow. Bedrock keeps it among the mob's
  named flags, and the Bedrock module now answers from there.
- On Bedrock world memory lays its trail all along a walk. The Bedrock adapter fired the bot's `move` event
  only when the server corrected the bot or moved it, not on every tick the bot moved as mineflayer does on
  Java, so a walk left a few crumbs far apart, and a quick one read as a teleport. The Bedrock module now
  fires it after every tick in which the bot moved or turned.
- On Bedrock world memory keeps what a sign says. A current Bedrock sign keeps each side's text in a field
  of its own, and the library's reading of a Bedrock sign looks for the single field older signs had, so
  every sign was remembered blank. The Bedrock module now reads both sides.
- On Bedrock the bot can take from a barrel and put into one by name (`!takeFromChestAt`, `!putInChestAt`).
  The server refused both: the adapter's calls name a chest's slots whatever is open. A barrel (and a
  shulker box) now gets the same moves chest sorting makes, under its own name. A chest keeps the adapter's
  calls.
- On Bedrock a barrel opened again just after it was closed opens. The click named the barrel as still open,
  which it no longer was, and the server ignored it; now a click that brings no window is made once more, a
  second later. And an open that was given up on no longer takes the window of the open after it and closes
  it.
- Code the model writes runs on a Bedrock bot. Once the bot had joined a current Bedrock server, the sandbox
  that code runs in could not be set up, so `!newAction` failed every time, with fair play on or off: a
  library the connection loads leaves a property on JavaScript's `Reflect` that the sandbox can't remove.
  The bot now loads that library itself before it connects, with that property left removable.

## [0.7.0] - 2026-11-15

The bot plays Minecraft 26.3, on mineflayer and the libraries under it pinned to their open 26.3 work.
Built on the same Mindcraft-CE commit as 0.1.0.

### Added

- Minecraft Java Edition 26.3, the current release. `minecraft_version` in `settings.js` is now `26.3`;
  set it to match your server, or to `"auto"`. The live tests run a 26.3 server and need Java 25. No
  mineflayer release supports 26.3 yet, so mineflayer and four of the libraries under it come from
  GitHub, pinned by commit to the open 26.3 work (listed in
  [Dependencies Pinned to a Branch](docs/core-hooks.md#dependencies-pinned-to-a-branch)). They go back to
  npm releases once those support 26.3.

### Fixed

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- On 26.3 the bot is no longer kicked with "Invalid move player packet received" soon after it starts
  walking. Mindcraft-CE holds back a position packet sent too soon after the last and sends it later; with a
  client that ends each game tick itself, as the 26.3 libraries do, that moved the packet into the next tick
  beside that tick's own, which 26.3 servers refuse. Such a client is no longer throttled.

## [0.6.0] - 2026-11-15

The bot plays Minecraft 26.1, and builders and `useDoor` know the newer woods and doors. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- Minecraft Java Edition 26.1 (26.1, 26.1.1 and 26.1.2). `minecraft_version` in `settings.js` is now
  `26.1.2`; set it to match your server, or to `"auto"`. The live tests run a 26.1.2 server and need Java 25.
  `minecraft-data` moves to 3.119.0, which fixes 26.1's list of entity attributes (the bot misread its own
  movement speed with 3.117.0).

### Fixed

- With `world_memory` off, a game update no longer brings remembered blocks back in the wrong state. The
  seen-world map saved each block's state as the game's number for it, and an update renumbers them, so a
  door could come back open, or a crop grown, though the bot had seen otherwise. The map now saves the game
  version, and under another version it keeps the blocks but not their states.

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- Builders use the wood they carry when a blueprint names none. Dark oak counted as oak, and a dark oak tree
  as a wood called "dark", so the bot went looking for oak. Pale oak and poplar are known woods too.
- `useDoor` finds copper, pale oak and poplar doors. Its list of doors predated them.

## [0.5.0] - 2026-11-15

Under fair play the bot plans its routes over what it has seen, not over every loaded block. Built on the
same Mindcraft-CE commit as 0.1.0.

### Added

- Fair legs: under fair play the bot plans its routes over what it has seen, not over every loaded block.
  The pathfinder used to know of caves the bot had never entered, how thick a hill was before digging into
  it, and where lava lay behind rock. Now a cell the bot has never seen counts as open ground, to walk
  through or stand on. The bot sets out straight for the goal, and plans again when the way ahead comes
  into view and is not as it believed. A wall it has seen before is walked round from the first step. Every
  command, skill and plugin that walks is covered. `"route_planning": "all"` in `fair_play_custom` gives
  the old planning back. See [How the Bot Plans a Route](docs/fair-play.md#how-the-bot-plans-a-route).

### Changed

- A trip to beyond the chunks the server has sent is planned at once. It used to end in "Path not found,
  but attempting to navigate anyway using destructive movements", because the pathfinder could not plan
  into chunks it had not been sent.
- Only mobs the bot knows of make a route cost more. A mob behind a wall used to count.

## [0.4.0] - 2026-11-15

A world keeps its memory and chest owners across LAN sessions, and travel and item pickup stop digging and
stalling where they had no need to. Built on the same Mindcraft-CE commit as 0.1.0.

### Changed

- World memory and the chest book follow the world, not the server's address. A world opened to LAN gets a new
  port every session, and the bot used to start over each time, forgetting even whose chests were whose. A world
  is now known by its seed, or by the `world_id` setting. Memory saved under the old address is carried over the
  first time the bot is back in that world, and the old folder is left as it was.

### Fixed

- After the bot's first death, world memory stopped marking the blocks it dug as its own, so a hole it dug
  itself could later be reported as a place that had changed. It now keeps track however often the bot dies.

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- Travel no longer gives up looking for a walkable route after 40 ms. `goToGoal` meant to search for a
  second, but read only the pathfinder's first slice, so a route that took longer to find counted as none and
  the bot dug and towered its way in a straight line instead.
- Travel no longer stalls at the turns of a tunnel one block wide. The pathfinder planned a diagonal step past
  the corner that the bot is too wide to take, stood still and planned it again; `goToGoal` now goes round
  such corners in two straight steps.
- Fetching dropped items no longer digs or places blocks to stand in the item's own cell. The bot walks to
  where it can reach the item, as a player would, and digs or places only when walking can't get close and
  the caller allows it (as mining does).

## [0.3.0] - 2026-11-14

The bot sorts chests, keeps whose each chest is, and can be told which chest to use. Built on the same
Mindcraft-CE commit as 0.1.0.

### Added

- **Chest sorting.** One instruction and the bot tidies a player's chests, trapped chests and barrels:
  part stacks are merged, each kind of item is put together from the first slot, and related kinds (tools,
  food, minerals, wood and so on) share a chest. It is on by default, works with fair play on or off, and
  `chest_sorting: false` leaves the commands out. See `docs/chest-sorting.md`.
  - **Nothing is sorted by default.** The bot keeps whose each chest is (a player, `shared`, its own, or
    unknown) and how it may be sorted: `asked` (only when a player asks), `always`, or `never`. Players
    tell it, and the latest word wins.
  - `!sortChests(whose, distance)` sorts one owner's chests together, or with `approved` every chest
    marked `always`. `!sortChest(x, y, z)` sorts one chest by itself. `!chests(distance)` lists the chests
    the bot knows of. `!markChest` and `!markChests` record what a player says about one chest or about
    all the ones in view.
  - A sort never moves items between the chests of different owners, and covers only chests the bot can
    see from where it stands: "sort my chests" means the ones in this room.
  - Every sort ends by saying which chests it left alone and why, so the bot can ask whose an unclaimed
    chest is.
  - On its own idea the bot sorts only its own chests and those marked `always`. A player is never
    refused.
  - A chest the bot places is its own when that was its own idea, and the player's when it was doing what
    a player asked. One it digs up is forgotten.
  - A double chest is one chest. A full chest is sorted by swapping, so no free slot is needed.
  - A group of items stays in the chest that already holds most of it. Otherwise it goes to the chest
    that is least full for its size.
  - The bot's own inventory is left as it was: it carries chest items only in slots that were empty.
  - A chest within reach is opened from where the bot stands. It walks only to one it cannot reach, and
    that walk never digs or places a block.
  - If a chest changes while the bot works, it notices, puts down what it is carrying and plans again.
    A chest that will not open is left out and named. Nothing is lost either way.
- **Chest commands that say which chest.** `!viewChestAt(x, y, z)`, `!takeFromChestAt(x, y, z, item_name,
  num)` and `!putInChestAt(x, y, z, item_name, num)` look in, take from and put into the chest, trapped
  chest or barrel at a position, where `!viewChest`, `!takeFromChest` and `!putInChest` use whichever
  chest is nearest. They say whose the chest is, walk to it without digging or placing, and report
  what really moved when not all of it fitted. They come with chest sorting (`chest_sorting`).
- Live scenarios for chest sorting (`tests/live/storage_scenarios.js`), on a real server with no model
  calls: the server console fills the chests and reads them back itself. In a room several players
  share, every chest a sort was not approved for is checked to be slot for slot as it was.
- A scenario that tells the whole agent about chests in plain words (`tests/live/storage_agent_scenarios.js`):
  "that chest is mine", "sort my chests", "keep them tidy". It runs on recorded replies with no model.
  With `--live-model` it uses the model in `andy.json`, which costs money, and reports how often each
  step came out right over several runs.

## [0.2.0] - 2026-11-14

The bot remembers the world it has seen, and walks back the way it came. Built on the same Mindcraft-CE
commit as 0.1.0.

### Added

- **World memory.** The bot remembers the world the way a player who has been there does. It is on by
  default, needs fair play on, and `world_memory: false` turns it off. See `docs/world-memory.md`.
  - **Every block it has seen,** not only notable ones, per server, world and dimension.
  - **Things:** containers, workstations, doors, beds, signs, portals and ores, with their state and when
    they were last seen. A double chest, a bed and a door are each one thing.
  - **Container contents,** taken when the bot opens a container and again when it closes it.
  - **Fields and herds:** crops per area with how many were ripe, and the animals it saw.
  - **A trail** of where it has walked, which `!recall` uses to say how long a known way takes.
  - **Travel follows the trail.** A trip to somewhere the bot has been walks the way it came, in hops
    that neither dig nor place, instead of digging in a straight line. Every command and skill that
    walks does this by itself. A way found blocked is said once, and the bot looks for a way past.
  - **Places:** chests, workstations, beds, doors and signs close together become a site with no one
    having to save it, and it can be named later.
  - **Change notes:** when a place is not as the bot remembers it, one sentence is added to the result of
    the action it was doing, such as "Noticed at the base: Gone: chest 2. New: oak_planks 42."
- `!places` lists the places the bot knows and what is at each. `!namePlace` names the place it stands in.
- Live scenarios for world memory (`tests/live/memory_scenarios.js`, `tests/live/navigator_scenarios.js`),
  on a real server with no model calls.

### Changed

World memory is on by default, so each of these applies unless `world_memory` is set to `false`:

- `!recall` takes any text: a block type, a kind of thing ("chest", "door"), an item in the containers
  the bot opened ("iron"), an animal, a crop, a place name, or "changes". With world memory off it is
  unchanged.
- `!rememberHere` and `!goToRememberedPlace` keep their names as places in world memory. Places saved
  earlier are carried over, and nothing is lost if world memory is turned off again.
- Searches such as `!searchForBlock` remember every kind of block the bot has seen, not only notable
  ones.
- Every command and skill that walks follows the trail when the bot knows a way, as described above.
- The notable blocks remembered by earlier versions (under `bots/<name>/seen/`) are not carried into
  world memory, which starts from what the bot sees from now on. That file is left as it is, and is
  used again if world memory is turned off.

## [0.1.1] - 2026-11-13

Documentation only. Built on the same Mindcraft-CE commit as 0.1.0.

### Changed

- The README and `docs/core-hooks.md` say what to expect when merging an upstream update, including
  upstream changes to code this fork has replaced, which merge cleanly and then do nothing.

## [0.1.0] - 2026-11-13

The first version of this fork. Built on Mindcraft-CE's `agent-system` branch at commit `6a1ce8b`.

### Added

- **Fair play:** the bot may only know and do what a human survival player could. It is on by default
  (`fair_play: "strict"`), and `fair_play: "off"` gives stock behavior. See `docs/fair-play.md`.
  - **Perception.** Searches for blocks and mobs answer only with what the bot touches, sees in a straight
    line, remembers seeing, or hears. Players' name tags follow the vanilla rule: 64 blocks, unless
    sneaking.
  - **Memory of the world.** Notable blocks the bot has seen (ores, logs, sand, containers, workstations,
    beds, doors, crops) are remembered per server, world and dimension, exactly as last seen.
  - **`!recall` command.** The model can ask where it last saw a kind of block: where, how far, which way
    and how long ago.
  - **Hearing.** Sounds from sources the bot can't see are added to the `!entities` report with a direction
    and a rough distance, never coordinates.
  - **Reach guard.** Digging, placing, opening and hitting need the target within a survival player's reach
    (4.5 blocks, 3 for mobs) and in view.
  - **Locks.** Cheat mode stays off, slash commands are dropped before they reach the server, and the bot
    stops acting if it is made an operator or put outside survival mode.
  - **Switches.** `fair_play: "custom"` with `fair_play_custom` turns single rules off, to measure what
    each one is worth.
- A runner for model-written code that hands the code a stand-in for the bot. `!newAction`, the
  `executeCode` tool and generated augments all go through it when fair play is on.
- A lint test that fails when new code searches the bot directly instead of going through `world.js`.
- Live scenarios (`tests/live/fairplay_*.js`) that check fair play on a real server with no model calls.
- `docs/fair-play.md`, `docs/core-hooks.md`, `docs/setup.md` and this changelog.
- `ATTRIBUTION.md`, crediting the projects this fork builds on, and a CC0 1.0 dedication
  (`LICENSE-CC0`) for everything this fork adds. Inherited code stays under the MIT License.

### Changed

- Every block and entity search in `world.js` goes through one swappable provider. With fair play off the
  provider is the bot itself and nothing changes.
- Skills, reflexes and commands that searched the bot directly now go through `world.js`: finding a player
  by name, picking up items, finding a bed or a villager, and what the idle bot looks at.
- A search that finds nothing tells the model that this means "not seen", not "none nearby", when fair play
  is on.
- `!setMode` reports a refusal when a mode can't be changed, instead of claiming success.
- Agents created through the MindServer page or its API keep the fair-play settings, which are now listed
  in `settings_spec.json`.
- The README is rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to
  `docs/setup.md`.

### Fixed

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- `giveToPlayer`, `goToPlayer` and `followPlayer` no longer crash when the named player is not online.
- `goToBed` no longer mistakes bedrock for a bed.
- No `/skin` command is sent at login unless the profile sets a skin.
- `world.getNearestFreeSpace` rejects a spot with a block in it.
- `world.getNearestBlocksWhere` no longer returns an empty entry for a position it couldn't read.
- `useDoor` says so when there is no door nearby, instead of crashing.
- `useToolOn` tells the bot when it doesn't have the tool.
- `!stats` puts the current action on its own line.
- `giveToPlayer` no longer writes a stray number into its result.
- A blacklisted command is removed from the command list as well as from lookup.

### Security

- With fair play on, model-written code no longer receives the real bot, the agent, or host globals. This
  narrows what such code can do; it is not a full sandbox, and `allow_insecure_coding` stays off by default.

[Unreleased]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.27.0-bedrock.1.29.0...HEAD
[1.27.0-bedrock.1.29.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.26.0-bedrock.1.28.0...v1.27.0-bedrock.1.29.0
[1.26.0-bedrock.1.28.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.25.0-bedrock.1.27.0...v1.26.0-bedrock.1.28.0
[1.25.0-bedrock.1.27.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.24.0-bedrock.1.26.0...v1.25.0-bedrock.1.27.0
[1.24.0-bedrock.1.26.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.23.0-bedrock.1.25.0...v1.24.0-bedrock.1.26.0
[1.23.0-bedrock.1.25.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.22.0-bedrock.1.24.0...v1.23.0-bedrock.1.25.0
[1.22.0-bedrock.1.24.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.21.1-bedrock.1.23.0...v1.22.0-bedrock.1.24.0
[1.21.1-bedrock.1.23.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.21.0-bedrock.1.22.0...v1.21.1-bedrock.1.23.0
[1.21.0-bedrock.1.22.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.20.1-bedrock.1.21.1...v1.21.0-bedrock.1.22.0
[1.20.1-bedrock.1.21.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.20.0-bedrock.1.21.0...v1.20.1-bedrock.1.21.1
[1.20.0-bedrock.1.21.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.19.0-bedrock.1.20.0...v1.20.0-bedrock.1.21.0
[1.19.0-bedrock.1.20.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.18.0-bedrock.1.19.0...v1.19.0-bedrock.1.20.0
[1.18.0-bedrock.1.19.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.17.0-bedrock.1.18.0...v1.18.0-bedrock.1.19.0
[1.17.0-bedrock.1.18.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.16.0-bedrock.1.17.0...v1.17.0-bedrock.1.18.0
[1.16.0-bedrock.1.17.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.15.0-bedrock.1.16.0...v1.16.0-bedrock.1.17.0
[1.15.0-bedrock.1.16.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.14.0-bedrock.1.15.0...v1.15.0-bedrock.1.16.0
[1.14.0-bedrock.1.15.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.13.0-bedrock.1.14.0...v1.14.0-bedrock.1.15.0
[1.13.0-bedrock.1.14.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.12.0-bedrock.1.13.0...v1.13.0-bedrock.1.14.0
[1.12.0-bedrock.1.13.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.11.0-bedrock.1.12.0...v1.12.0-bedrock.1.13.0
[1.11.0-bedrock.1.12.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.10.0-bedrock.1.11.0...v1.11.0-bedrock.1.12.0
[1.10.0-bedrock.1.11.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.9.0-bedrock.1.10.1...v1.10.0-bedrock.1.11.0
[1.9.0-bedrock.1.10.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.9.0-bedrock.1.10.0...v1.9.0-bedrock.1.10.1
[1.9.0-bedrock.1.10.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.8.0-bedrock.1.9.0...v1.9.0-bedrock.1.10.0
[1.8.0-bedrock.1.9.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.7.1-bedrock.1.8.2...v1.8.0-bedrock.1.9.0
[1.7.1-bedrock.1.8.2]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.7.1-bedrock.1.8.1...v1.7.1-bedrock.1.8.2
[1.7.1-bedrock.1.8.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.7.0-bedrock.1.8.0...v1.7.1-bedrock.1.8.1
[1.7.0-bedrock.1.8.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.6.0-bedrock.1.7.0...v1.7.0-bedrock.1.8.0
[1.6.0-bedrock.1.7.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.5.0-bedrock.1.6.0...v1.6.0-bedrock.1.7.0
[1.5.0-bedrock.1.6.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.4.0-bedrock.1.5.0...v1.5.0-bedrock.1.6.0
[1.4.0-bedrock.1.5.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.3.0-bedrock.1.4.0...v1.4.0-bedrock.1.5.0
[1.3.0-bedrock.1.4.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.2.2-bedrock.1.3.1...v1.3.0-bedrock.1.4.0
[1.2.2-bedrock.1.3.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.2.1-bedrock.1.3.1...v1.2.2-bedrock.1.3.1
[1.2.1-bedrock.1.3.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.2.0-bedrock.1.3.0...v1.2.1-bedrock.1.3.1
[1.2.0-bedrock.1.3.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.1.1-bedrock.1.2.1...v1.2.0-bedrock.1.3.0
[1.1.1-bedrock.1.2.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.1.0-bedrock.1.2.0...v1.1.1-bedrock.1.2.1
[1.1.0-bedrock.1.2.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.1.0...v1.1.0-bedrock.1.2.0
[1.0.0-bedrock.1.1.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.2...v1.0.0-bedrock.1.1.0
[1.0.0-bedrock.1.0.2]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.1...v1.0.0-bedrock.1.0.2
[1.0.0-bedrock.1.0.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.0.0-bedrock.1.0.0...v1.0.0-bedrock.1.0.1
[1.0.0-bedrock.1.0.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.7.0...v1.0.0-bedrock.1.0.0
[0.7.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/lantern-eight/mindcraft-ce/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lantern-eight/mindcraft-ce/releases/tag/v0.1.0
