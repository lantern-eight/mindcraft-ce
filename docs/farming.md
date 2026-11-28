# Farming

One instruction, and the bot tends a field the way a careful player does: it cuts the crops it sees are
ripe, replants them, sows the empty farmland, and picks up what dropped. It leaves young plants to grow,
never jumps onto the farmland, and on its own idea it tends only fields it may tend. With a chest by the
field for its crops, the harvest goes there, and the bot keeps seed and food. Another instruction, and it
makes a field: it tills wet ground with a hoe and sows it.

- [Turning It On or Off](#turning-it-on-or-off)
- [What a Round Does](#what-a-round-does)
- [Storing the Harvest](#storing-the-harvest)
- [Whose Fields It Tends](#whose-fields-it-tends)
- [Making a Field](#making-a-field)
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
| [Putting away](chest-sorting.md#putting-away-and-fetching) on | A round ends by taking the harvest to the field's chest ([below](#storing-the-harvest)) |

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
5. **Pick the melons and pumpkins** standing beside the field's stems, and leave the stems: a stem goes on
   bearing fruit, and breaking it would end that. Only a fruit beside a stem of its own kind counts, so a
   melon or pumpkin block set down elsewhere is left alone.
6. **Sow empty farmland** with the seed asked for. When none is named, it sows what grows beside each cell
   (a row of carrots gets carrots), else the seed it holds most of. It holds back a seed for each ripe plant
   still to be replanted, so a field doesn't end up half bare. Melon and pumpkin seed is sown only where
   stems of its kind grow beside the cell, or when asked for: never because the bag holds the most of it, as a
   stem in the middle of a field has no room for its fruit.
7. **Look again.** Walking the rows brings more of the field into view; the round takes in what it found,
   up to three passes. A cell where a seed was planted but nothing grew (the click went astray, or the server
   was slow to show it) is tried again on the next pass, with the same seed if the bot cut a crop there. So is
   a cut cell whose seed hadn't dropped yet when the bot went to plant it: it picks up what lies about it first.
8. **Report what happened,** counted from what reached the bag, never from what was broken:

> The field at 2, -61, -2 to 6, -61, 2 has 24 farmland (it is yours). Harvested 10 wheat, and gained 10 wheat,
> 23 wheat_seeds. Replanted 10. Sowed 2 empty farmland. 12 not ripe yet, left to grow.

**Walking on a field.** Walking on farmland never harms it; a jump or a fall onto it can trample it back
to dirt. So among the crops the bot never jumps, never steps down onto farmland, and never steps into the
field's water (climbing out of it lands on farmland). It doesn't dig or place blocks there either. A crop it
can only reach by jumping is left, and said so.

**When to stop.** Every break destroys a plant, so when two breaks in a row bring nothing into the bag
(drops lost in water, through a gap), the round stops and says why instead of cutting the rest. A round also
stops after a few minutes on a very large field; tending it again carries on.

## Storing the Harvest

A farm often has a chest beside it, where the harvest goes and the seed is kept handy. When a chest within
16 blocks of the bot, at the end of a round, is **for** what the field gives, the round ends by putting the
harvest in it, as a player leaves the farm chest full and walks home with their pockets light:

| A chest for | Takes |
|---|---|
| `plants` (or a sign saying "crops", "farm") | wheat, pumpkins, and wheat, beetroot, melon and pumpkin seeds |
| `food` | carrots, potatoes, beetroot and melon slices, which can be eaten |
| an item, by name (`wheat`, `carrot`) | that item |

A player says what a chest is for with `!chestFor(x, y, z, what)`, or with a sign on it ([what a chest is
for](chest-sorting.md#what-a-chest-is-for)). A chest for anything, or one nobody said anything about, gets
none of it: nobody said the harvest goes there. With no chest for it near, the harvest stays in the bag, and
the model can still put it away with `!putAway`.

**What the bot keeps:**

- **Seed to sow the field again:** of each seed, as many as the field has cells of that crop (at most a
  stack). Carrots and potatoes are their own seed.
- **Food to eat:** enough carrots, melon slices, potatoes and beetroot that it carries 16 pieces of food in
  all, counting the other food it has, the most filling first.
- Everything else of the harvest goes: wheat, pumpkins, more seed than that, poisonous potatoes. Only what a field
  gives is stored; the bot's other things stay where they are.

**Whose chests**, by the [rules of putting away](chest-sorting.md#putting-away-and-fetching): the bot's own
field, a shared one, or one nobody has spoken for fills the bot's own and shared chests. A player's field
fills that player's chests, and only when a player asked for the round. Never a chest nobody has said whose
it is.

> The field at 3, 69, -2 to 9, 69, 2 has 34 farmland (it is yours). Harvested 6 carrots, 7 wheat, 3 beetroots, ...
> The harvest, to the field's chest: Put away carrot 11, beetroot 3, wheat 7 in 2 chests:
> - chest at 6, 70, 4 (your own): carrot 11, beetroot 3
> - chest at 4, 70, 4 (your own): wheat 7
> Kept on you, to sow the field again and to eat: beetroot_seeds 4, carrot 16, wheat_seeds 13.

This needs chest sorting and its putting away on (`chest_sorting`, `store_and_fetch`), which know whose each
chest is and what it is for. Farming asks them through `library/store_way.js`, so either can be off without
the other breaking.

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

### With Good-Neighbor Rules

[Good-neighbor rules](good-neighbor.md) protect what players made, and crops are made: someone sowed them.
The field book is the owner record those rules lack, so it answers them about crops:

- **While a round of `!tendField` lasts,** the crops of the field it tends may be cut. The round only starts
  when the field may be tended (above), and it leaves the field replanted, as a player tending a friend's
  field would.
- **Otherwise** (`!collectBlocks wheat`, say), a crop may be cut when its field is one the bot may always
  tend, or when the player who asked owns it. Another player asking is not enough: they would be harvesting
  someone else's field without replanting it.
- **Anything else stays refused,** and the refusal sends the model to `!tendField` and `!markField`.
- Only the crop is freed, never the farmland under it, and a protected area from the settings still wins.

## Making a Field

`!sowField` tills ground near the bot with the best hoe it carries and sows it, the way a player starting
or growing a field does:

- **Wet ground only.** Farmland dries back to dirt unless water lies within 4 blocks of it sideways, at its
  own level or one above, so the bot tills only soil some water it has seen keeps wet. With no water in view,
  it looks round once, then says to go near water.
- **Free soil only:** grass, dirt, coarse dirt (two strokes) or rooted dirt, with room above it. Wild grass
  and ferns on top are cut first. Never a path, never a block it saw someone put there, and, with
  [good-neighbor rules](good-neighbor.md) on, nothing they protect.
- **Bigger, not beside.** When a field the bot may tend (above) is near, it grows that field from its own
  edge. A field it may not tend is kept clear of: new farmland next to it would join it, and then nobody
  could say whose each part is. Otherwise it starts a new, flat field from the free ground nearest it.
- **No more than it can sow.** Bare farmland dries out, so it tills one cell for each seed it holds, at
  most the size asked (up to 64), and sows each as it goes.
- **Nothing trampled:** it walks on what it has tilled the way it walks on a field it tends.
- **Whose it is:** new farmland joins the book as the field's owner's when it made a field bigger, else as
  the player's who asked for it, else as its own.

Without a hoe it says how to get one (`!getTool`), and without seeds it says so before tilling anything.

## What the Model Can Ask

| Command | What it does |
|---|---|
| `!tendField(seed)` | Tends the field nearest the bot. `seed` is what to sow on empty farmland: `"wheat_seeds"`, `"carrot"`, `"potato"`, `"beetroot_seeds"`, `"melon_seeds"`, `"pumpkin_seeds"`, or `"any"` for what grows beside each cell |
| `!sowField(seed, size)` | Makes a field: tills and sows up to `size` blocks of wet, free soil near the bot (the field it may tend made bigger, or a new one). `seed` as above, but not melon or pumpkin seed, as each stem needs a free block beside it for its fruit; or `"any"` for the seed held most of |
| `!markField(owner, tending)` | Says whose the field nearest the bot is (a player's name, `"shared"`, the bot's own name, `"unknown"`, or `"same"`), and whether it may be tended unasked (`"always"`, `"asked"` or `"same"`) |

`!recall("wheat")` from [world memory](world-memory.md) lists the fields the bot remembers, how many plants
were ripe when it last looked, and, from the field book, whose each is ("Alice's field").

## Is It Fair?

Everything farming knows comes through the same senses as the rest of [fair play](fair-play.md):

- **The field is what the bot has seen.** Farmland behind a wall, or behind the bot under a narrowed view,
  is not part of it until the bot looks.
- **Ripeness is read only from a plant in view.** What memory keeps of a field (how many plants, how many
  were ripe when last seen) chooses which field to walk to, never which plant to cut.
- **Every cut and every seed planted** goes through the reach rule: within a survival player's reach and in
  view now.
- **Every walk is planned by the pathfinder,** so route planning over what the bot has seen covers it.
- **The field's chest is one the bot has seen,** and what it believes is inside is what it saw, as for
  [putting away](chest-sorting.md#putting-away-and-fetching).

## Known Limits

- **`!tendField` doesn't till.** A bare cell in a field (a path, a strip of grass) is left as the field's
  owner made it; `!sowField` grows a field only at its edge. `tillAndSow` in generated code still tills one
  block.
- **Light isn't checked.** Crops need light to grow; a field made in a dark cave is made, and grows slowly or
  not at all.
- **The walk to a field from afar** uses ordinary travel, which doesn't know about trampling; the field's own
  rules start at its edge.
- **Wheat, carrots, potatoes, beetroot, melons and pumpkins.** Sugar cane, cocoa, nether wart and sweet
  berries are not tended yet; `!collectBlocks("sugar_cane")` (`"reeds"` on Bedrock) cuts cane and leaves
  the bottom block of each plant to grow back. Neither bone meal nor a composter is used.
- **A melon or pumpkin is picked only from beside a stem of the field.** Fruit beside a stem on its own,
  away from farmland the bot tends, is left.
- **On Bedrock a cut beetroot can't always be replanted.** A Bedrock beetroot drops 0 to 3 seeds (a Java one
  at least 1), so a few beetroots can give fewer seeds than cells. The round leaves those cells empty and says
  so ("no seed for it"), as a player without a seed would.
- **Only a chest that is for the harvest takes it.** The bot doesn't decide on its own that a chest by the
  field is the farm's; a player says so (`!chestFor`, or a sign). The walk to the chest is ordinary travel.
- **A village's field** counts as nobody's: the bot leaves it alone on its own idea, keeps a new field clear
  of it, and tends it when a player asks. Telling a village's field by the farmer working it is not built.
- **With good-neighbor rules on, `!collectBlocks` of a stranger's crop says it found none,** not that the
  crop is someone's: the search leaves out what the bot may not break before it looks. `!tendField` says whose
  the field is.

## For Developers

All of it lives in `src/agent/farming/`:

| File | What it is |
|---|---|
| `crops.js` | The crops, and the decisions of a round: the jobs of one cell, which seed to sow, the seeds to hold back, when to stop. Pure |
| `visit_order.js` | The plough's order of the cells. Ported from the `akarkin1/mindcraft-fk` fork, under the MIT License (see [ATTRIBUTION.md](../ATTRIBUTION.md)) |
| `field.js` | The field around a cell, from a block reader that answers only what the bot knows; the step cost that keeps the pathfinder off the farmland. Pure |
| `field_book.js` | Whose each field is, and the rule for tending it unasked. A plain store, one file per world |
| `tend.js` | The round itself: the walking, looking, cutting and planting |
| `ground.js` | Where to make a field: wet, free soil, grown from a field's edge and kept clear of others. Pure |
| `sow.js` | Making a field: tilling (two strokes for coarse dirt), cutting wild grass, sowing, noting the owner |
| `harvest_plan.js` | What of the harvest goes into the field's chest, and the seed and food kept. Pure |
| `commands.js` | What the model can ask, and how the answers read |
| `neighborly.js` | Answers good-neighbor rules about crops, from the field book and the round being tended |
| `install.js` | Starts it for one agent, behind the setting, hands good-neighbor rules its answer, tells `!recall` whose a field is (`library/field_owners.js`), and hands a round chest storage's way of putting things away (`library/store_way.js`) |

**What depends on the edition of the game.** Block names are turned into Java's through the
[edition seam](edition-seam.md) (`javaNameOf`) before they are looked up, and a crop's ripeness is asked of
world memory's `kinds.js`, which reads Bedrock's `growth` as Java's `age`. Seed and crop item names are the
same in both editions.

**Tests.** `tests/farming_*.test.js` cover the decisions, the field search over a hand-built world with fair
play on, the field book and the commands. `tests/live/farming_scenarios.js` runs whole rounds on a real
server with no model calls, and `tests/live/bedrock_farming.js` does the same on Bedrock.
