# Farming

One instruction, and the bot tends a field the way a careful player does: it cuts the crops it sees are
ripe, replants them, sows the empty farmland, and picks up what dropped. It leaves young plants to grow,
never jumps onto the farmland, and on its own idea it tends only fields it may tend.

- [Turning It On or Off](#turning-it-on-or-off)
- [What a Round Does](#what-a-round-does)
- [Whose Fields It Tends](#whose-fields-it-tends)
- [What the Model Can Ask](#what-the-model-can-ask)
- [Is It Fair?](#is-it-fair)
- [Known Limits](#known-limits)
- [For Developers](#for-developers)

## Turning It On or Off

Farming is **on by default**. To turn it off, in `settings.js`:

```javascript
"farming": false,
```

It needs neither fair play nor world memory:

| With | What changes |
|---|---|
| Fair play off | The bot sees the whole field at once, the way stock Mindcraft does |
| Fair play on | It knows only the farmland it has seen, and a crop's ripeness only once it looks at it |
| World memory on | With no farmland in sight, it walks to the nearest field it remembers, the one with ripe plants first |

## What a Round Does

`!tendField` works the field nearest the bot:

1. **Find the field.** The farmland nearest the bot that it can see or remembers, within 32 blocks, and all
   farmland joined to it: sideways and diagonally, a block up or down a slope, and across a row of water or a
   path between rows. Farmland the bot has never seen ends the field there, as far as the bot knows; it says
   so in its report, rather than taking it for the field's edge.
2. **Walk the rows,** a row at a time like a plough, starting at the corner nearest the bot.
3. **Look at each plant.** Ripeness is read only from a plant in view. A player remembers where the wheat
   is, not how grown each stalk was, and neither does the bot.
4. **Cut what is ripe** (wheat, carrots, potatoes at full growth; beetroot at its fourth stage), wait for
   the drops, step onto them to pick them up, and **replant** that cell with that crop's seed. Carrots and
   potatoes replant from the crop itself.
5. **Sow empty farmland** with the seed asked for. When none is named, it sows what grows beside each cell
   (a row of carrots gets carrots), else the seed it holds most of. It holds back a seed for each ripe plant
   still to be replanted, so a field doesn't end up half bare.
6. **Look again.** Walking the rows brings more of the field into view; the round takes in what it found,
   up to three passes.
7. **Report what happened,** counted from what reached the bag, never from what was broken:

> The field at 2, -61, -2 to 6, -61, 2 has 24 farmland (it is yours). Harvested 10 wheat, and gained 10 wheat,
> 23 wheat_seeds. Replanted 10. Sowed 2 empty farmland. 12 not ripe yet, left to grow.

**Walking on a field.** Walking on farmland never harms it; a jump or a fall onto it can trample it back
to dirt. So among the crops the bot never jumps, never steps down onto farmland, and never steps into the
field's water (climbing out of it lands on farmland). It doesn't dig or place blocks there either. A crop it
can only reach by jumping is left, and said so.

**When to stop.** Every break destroys a plant, so when two breaks in a row bring nothing into the bag
(drops lost in water, through a gap), the round stops and says why instead of cutting the rest. A round also
stops after a few minutes on a very large field; tending it again carries on.

## Whose Fields It Tends

A player on a shared server doesn't harvest a field because it is there. The bot keeps a small "field book"
of what it was told, for each cell of farmland: whose it is, and whether it may be tended unasked.

| Owner | Meaning |
|---|---|
| A player's name | That player's field |
| `shared` | Everyone's, the bot's too |
| The bot | Its own |
| Unknown | Nobody has said. The default |

| Tending | The field is tended |
|---|---|
| `asked` | Only when a player asks. The default for a player's field |
| `always` | Also when the bot decides to. The default for its own and shared fields |

- **A player is never refused.** When a player asks, the bot tends the field they mean, and when it can't
  tell who asked, it tends it too. A field nobody had said anything about, tended because a player asked, is
  noted as that player's.
- **On its own idea, the bot tends only fields marked `always`:** its own, shared ones, and a player's that
  the player said it may always tend. Anything else is refused with a sentence that says what to do: ask
  whose the field is, or have a player ask.
- **The bot never guesses an owner** from who stands near a field or what grows in it.
- **A field changes shape,** so the book keeps each cell. A field's owner is the owner of most of the cells
  the book knows in it.

Who asked is worked out the same way as for [chest sorting](chest-sorting.md#whose-chests-it-sorts).

## What the Model Can Ask

| Command | What it does |
|---|---|
| `!tendField(seed)` | Tends the field nearest the bot. `seed` is what to sow on empty farmland: `"wheat_seeds"`, `"carrot"`, `"potato"`, `"beetroot_seeds"`, or `"any"` for what grows beside each cell |
| `!markField(owner, tending)` | Says whose the field nearest the bot is (a player's name, `"shared"`, the bot's own name, `"unknown"`, or `"same"`), and whether it may be tended unasked (`"always"`, `"asked"` or `"same"`) |

`!recall("wheat")` from [world memory](world-memory.md) lists the fields the bot remembers and how many
plants were ripe when it last looked.

## Is It Fair?

Everything farming knows comes through the same senses as the rest of [fair play](fair-play.md):

- **The field is what the bot has seen.** Farmland behind a wall, or behind the bot under a narrowed view,
  is not part of it until the bot looks.
- **Ripeness is read only from a plant in view.** What memory keeps of a field (how many plants, how many
  were ripe when last seen) chooses which field to walk to, never which plant to cut.
- **Every cut and every seed planted** goes through the reach rule: within a survival player's reach and in
  view now.
- **Every walk is planned by the pathfinder,** so route planning over what the bot has seen covers it.

## Known Limits

- **It tends; it doesn't make fields yet.** Tilling new ground with a hoe, choosing ground by water, and
  extending a field are not built. `tillAndSow` in generated code still tills one block.
- **The walk to a field from afar** uses ordinary travel, which doesn't know about trampling; the field's own
  rules start at its edge.
- **Only wheat, carrots, potatoes and beetroot.** Melons, pumpkins, sugar cane, cocoa, nether wart and sweet
  berries are not tended yet. Neither is bone meal or a composter.
- **The harvest stays in the bot's inventory.** Taking it to a chest is not built yet.
- **A village's field** counts as nobody's: the bot leaves it alone on its own idea and tends it when a
  player asks.

## For Developers

All of it lives in `src/agent/farming/`:

| File | What it is |
|---|---|
| `crops.js` | The crops, and the decisions of a round: the jobs of one cell, which seed to sow, the seeds to hold back, when to stop. Pure |
| `visit_order.js` | The plough's order of the cells. Ported from the `akarkin1/mindcraft-fk` fork, under the MIT License (see [ATTRIBUTION.md](../ATTRIBUTION.md)) |
| `field.js` | The field around a cell, from a block reader that answers only what the bot knows; the step cost that keeps the pathfinder off the farmland. Pure |
| `field_book.js` | Whose each field is, and the rule for tending it unasked. A plain store, one file per world |
| `tend.js` | The round itself: the only part that walks, looks, cuts and plants |
| `commands.js` | What the model can ask, and how the answers read |
| `install.js` | Starts it for one agent, behind the setting |

**What depends on the edition of the game.** Block names are turned into Java's through the
[edition seam](edition-seam.md) (`javaNameOf`) before they are looked up, and a crop's ripeness is asked of
world memory's `kinds.js`, which reads Bedrock's `growth` as Java's `age`. Seed and crop item names are the
same in both editions.

**Tests.** `tests/farming_*.test.js` cover the decisions, the field search over a hand-built world with fair
play on, the field book and the commands. `tests/live/farming_scenarios.js` runs whole rounds on a real
server with no model calls, and `tests/live/bedrock_farming.js` does the same on Bedrock.
