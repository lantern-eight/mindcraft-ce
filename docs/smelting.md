# Smelting

The bot smelts the way a player does: it finds a furnace that isn't in use (or places its own), puts in
the items and the fuel they need, shuts it, and comes back for what is done. For a long smelt it can load
a furnace and go and do something else, and it remembers what it left smelting where.

Mindcraft-CE's `smeltItem` stands at an open furnace for the whole smelt (ten minutes for sixty glass),
waits for ever on a furnace that never opens, adds fuel only to an empty fuel slot and only of one kind,
takes whatever is in the output as its own, and afterwards digs up "the nearest furnace", which may be
someone else's. This feature replaces it.

## Turning It On

In `settings.js` (a profile can override it):

```js
"smelting": true,   // false keeps Mindcraft's own smeltItem and clearNearestFurnace
```

It is on by default. It needs nothing else from this fork: with fair play off it finds furnaces the way
stock Mindcraft does, and with fair play on only the ones the bot has seen or remembers.

## What a Smelt Does

`!smeltItem("sand", 60)`, `skills.smeltItem` in model-written code, and the NPC's item goals all go this way.

1. **What it makes.** A list of the furnace's recipes, by exact name: sand and red sand make glass, raw
   metal and ores make ingots, cobblestone makes stone, logs make charcoal, raw meat is cooked, and so on.
   Asked to smelt a product (`glass`), it says what to smelt instead.
2. **The fuel.** Coal and charcoal first (8 items each), then planks (1.5), then logs, which it first makes
   into planks in its own crafting grid: a log burned smelts 1.5 items, its four planks smelt 6. Sixty glass
   take 8 coal, or 40 planks, or 10 logs. The fuel slot holds one kind at a time, so it can use two: 5 coal,
   and planks for the rest. It never burns what it is smelting or what it is making (no charcoal burned to
   make charcoal), nor Nether wood, which doesn't burn. Coal blocks, blaze rods, dried kelp blocks and lava
   buckets only when nothing else covers it. Short of fuel, it smelts what the fuel covers and says so.
   **Lava from a lava farm comes first** (see below).
3. **The furnace.** One it knows of within 16 blocks; else its own, if it carries one, placed beside it on
   ground it can see; else one it knows of within 64 blocks.
4. **Only a free one.** A furnace with anything in its input or output is someone else's work: the bot shuts
   it and tries another, and says which it left alone. Fuel alone in a furnace is used, as a player at a
   shared base would; at the end the bot takes back only as much fuel as it put in. A furnace that holds
   only what the bot itself left smelting in it is its own (see "What Is Smelting Where").
5. **Load, shut, wait.** It puts in up to a stack and the fuel for it, and shuts the furnace. It waits beside
   it, window shut, for as long as the load takes (10 s an item), or until the fuel in it is nearly spent,
   or until it sees the furnace go out. Then it opens it again, takes what is done, tops it up, and shuts it
   again. While it waits, its reflexes work as in any other action.
6. **Done.** It takes back its leftover fuel, and picks up a furnace it placed for this smelt, if it has a
   pickaxe to do it with (a furnace mined by hand drops nothing). Without one it leaves the furnace and says
   where.

The result says how many came out, in which furnace, what fuel burned, and why it stopped short if it did.
The count is what reached the inventory, never what was asked for.

It stops when:

| What happened | What it does |
|---|---|
| Someone put their own things in the furnace | Stops, and leaves their things in it |
| Nothing came out at two looks in a row | Takes its things back out and says the furnace stopped |
| Much longer than it should take (12 s an item and 30 s more) | Takes its things back out |
| It ran out of fuel | Takes the rest of its items back out |
| It was interrupted (`!stop`, a reflex, a new task) | Leaves the furnace working, window shut, and remembers what of its own is in it. A stopped action's result is only "Action cancelled", so nothing more is said; the next `!smeltItem` of that item goes on with it |
| The furnace never opened (4 s), or is gone | Says so; no window is left open |

`!clearFurnace` empties the nearest furnace the bot knows of within 32 blocks: input, fuel, then output.

## Lava From a Lava Farm

A cauldron full of lava under pointed dripstone fills itself again: a player who built one has fuel without
end, and one bucket smelts a hundred items. So when the bot knows of a full lava cauldron within 32 blocks,
lava is its first fuel, before coal.

- **The bucket.** One it carries; else an empty bucket it remembers lying in a furnace's fuel slot (lava
  leaves its bucket there when it catches), which it takes out; else one from the chests, barrels and
  shelves it remembers holding one. That last is chest storage's fetch, the same as `!fetchItem`: its own
  and shared chests, and a player's only when a player asked for the smelt ([chest-sorting.md](chest-sorting.md#putting-away-and-fetching)).
  With `store_and_fetch` off, chests aren't looked in. When a chest held a bucket the bot may not take, the
  result names it, so the model can ask whose it is.
- **Filling it.** It walks up to the cauldron and uses the empty bucket on it, as a player does, and checks
  that a lava bucket came back. It never places lava.
- **Burning it.** A bucket goes in only on an empty fuel slot, one at a time. Lava burns on for 1,000
  seconds once it catches, smelting or not, and the slot then shows only the empty bucket, so the bot counts
  the time left on its lava as fuel and adds no coal it doesn't need. It takes the empty bucket back out on
  its next visit.
- **Without a lava farm** a lava bucket the bot carries is a last resort, as before.

The cauldron is found like any block (under fair play, one the bot has seen or remembers) and read through
the edition seam: Java has a block for each liquid (`lava_cauldron`), Bedrock one `cauldron` block with the
liquid and how full it is as states.

## Load and Leave

Sixty glass take ten minutes. A player loads the furnace and goes off to do something else; so can the bot.

| Command | What it does |
|---|---|
| `!loadFurnace("sand", 100)` | Finds a furnace as `!smeltItem` does, puts in up to a stack and the fuel for it, shuts it and leaves. Says when it will be done, or how far its fuel goes when it had too little. The rest of the 100 go in later |
| `!collectFurnace` | Goes back to each furnace it left smelting, nearest first: takes out what is done, puts in more of the job (and fuel) when it carries them, and when a job is over takes back the fuel of its own left over, and picks up a furnace it placed for the job if it has a pickaxe |
| `!furnaces` | Says what it left smelting where, and when each should be done. Answers at once, from what it remembers |

When a furnace it left should be done (or has smelted what its fuel covered), the next result the model
reads says so once: "The glass in the furnace at 3, 64, 0 should be done (!collectFurnace)." `!smeltItem`
stays as it was, for when the result is needed now.

## What Is Smelting Where

The bot remembers what it leaves in a furnace: which furnace, what it is smelting there, how many it put in
and took out, the fuel it put in, and when the furnace should be done. It writes this down as soon as
something goes in, so a smelt that is stopped, or a bot that restarts, still knows. It is kept per world and
dimension, in `bots/<name>/smelting/`, and needs no world memory.

- **Going on.** `!smeltItem` for an item it left smelting goes to that furnace first, takes what is done,
  counts what is still in there towards what was asked, and carries on.
- **Its own furnace.** A furnace holding only the bot's own job, and no more of it than the bot put in, is
  its own, not "in use". Its own furnace smelting something else is left to that.
- **A belief, not a fact.** What a furnace holds is known only by opening it. If someone took the bot's sand
  out, the bot smelts what it carries and forgets the job.

## Fair Play

Nothing here reads the world past the doors every skill uses. Furnaces are found through `world.js`, so
under fair play only the ones the bot has seen or remembers count, and an empty-handed search gets fair
play's note that none known isn't none there. Through a player's screen the bot looks round first, as other
searching skills do, when it knows of no furnace near. It walks with the pathfinder, opens a furnace through the
reach rule (in reach and in view), and places its own furnace on a spot it can see. Seeing a furnace go out
is seeing its glow stop: only while the furnace is in view.

Which furnaces and chests are whose is the good-neighbor work still to come. Today "in use" is read from the
furnace itself: anything in its input or output.

## Known Limits

- **The time is worked out, not watched.** A furnace left working is known to be done from the time the
  bot worked out when it loaded it, as a player knows. Someone may have emptied it since; the bot finds out
  when it opens it.
- **One furnace at a time.** Sixty glass take ten minutes in one furnace; several at once are planned, and so
  are smokers and blast furnaces (twice as fast for food and ores).
- **A furnace's leftover burn is not counted.** Coal half burned when the last item is done is lost, as it is
  for a player, and the bot may put in one piece of fuel more than a furnace still burning needs; it takes
  that back at the end.

## For Developers

All of it lives in `src/agent/smelting/`:

| File | What it is |
|---|---|
| `recipes.js` | What a furnace makes of what, by exact name. Pure |
| `fuel.js` | What burns and how far, the fuel plan in stages, and what to add to the slot now. Pure |
| `furnace_hands.js` | Opening a furnace with a deadline, reading its slots, putting and taking with a deadline each, closing it. The only file that touches a window |
| `lava.js` | Lava from a lava farm: the nearest full lava cauldron, an empty bucket for it (from the bag, a furnace's fuel slot, or the chests through `library/fetch_way.js`), filling it |
| `jobs.js` | What the bot has left smelting where, per world: one job per furnace, and whether a furnace holds only the bot's own. Pure, with its file |
| `smelt.js` | `smeltItem`, `clearFurnace`, `loadFurnace`, `collectFurnace` and what is smelting where, on those |
| `commands.js` | `!loadFurnace`, `!collectFurnace` and `!furnaces`, and the "should be done" line on a result |
| `install.js` | Turns it on for one agent |

**How it hooks into Mindcraft.** `src/agent/library/smelt_way.js` holds a way of smelting per bot, and the
first lines of Mindcraft's `smeltItem` and `clearNearestFurnace` hand the work to it when one is installed.
With none installed the stock skills run. See [`core-hooks.md`](core-hooks.md).

**What depends on the edition.** On Bedrock a burning furnace is another block (`lit_furnace`), so whether a
block is a furnace, and whether it burns, is asked of the edition seam (`furnaceOf`). Putting into and taking
out of a furnace needs nothing from it: the Bedrock library gives the furnace window the same calls as Java's.

**Tests.**

```bash
node --test tests/smelting_plan.test.js tests/smelting_furnace.test.js   # the plan, and whole smelts against a pretend furnace
node tests/live/smelting_scenarios.js                                    # on a real server
```

The live script starts its own throwaway server and makes no model calls. Its Bedrock twin,
`tests/live/bedrock_smelting.js`, runs against a throwaway Bedrock server ([bedrock.md](bedrock.md)), and
`bedrock_skills.js` smelts and clears a furnace there through the same skills.
