# The Edition Seam

Minecraft comes in two editions, Java and Bedrock, and they speak different protocols. mineflayer hands
out the same `bot` for both. But fair play, world memory and chest sorting read things that sit below that
`bot`, and those are shaped by the game itself: how block states are numbered, how a chunk lists its
blocks, which packets carry a sound. The edition seam, in `src/agent/edition/`, is the one place those
things are read. This fork's modules ask it a question by name, and it answers the way the game in play
does. So there is one copy of fair play, world memory and chest sorting, and it runs on both editions.

- [Why Mindcraft-CE Doesn't Need It](#why-mindcraft-ce-doesnt-need-it)
- [How It Works](#how-it-works)
- [The Questions It Answers](#the-questions-it-answers)
- [What Is Not in It](#what-is-not-in-it)
- [Adding a Question](#adding-a-question)

## Why Mindcraft-CE Doesn't Need It

Mindcraft-CE plays Java Edition only. Its skills mostly go through mineflayer's own calls (`bot.blockAt`,
`bot.dig`, the pathfinder), which hide the protocol, and where it does read the game's own shapes, there is
only one game to read.

This fork's features read below mineflayer's calls, for speed and to stay honest:

- **Fair play's sight** asks about every cell a ray crosses. It keeps a yes or no for each block state in
  a table indexed by state number, and it skips whole chunk sections by their palettes.
- **Fair play's hearing** listens to the sound packets the server sends, and its operator check listens
  for the packet that grants operator rights.
- **World memory** keeps blocks by name and their states by named properties, worked out from the state
  numbers, and reads what a chest or a sign holds from its block entity.
- **Chest sorting** moves stacks the way a player does with the mouse.

Each of those is done differently on Bedrock. Java numbers a block's states in one run, and a current
Bedrock server numbers each state with a hash; a Bedrock chunk never sends a section that is all air, and
lists its blocks in layers; Bedrock moves items by request, not by clicks. Without the seam, playing
Bedrock would mean a second copy of each feature, or checks for the edition scattered through all of
them, each a chance to read one game's data the other game's way. The seam keeps the difference to one
file per edition.

The seam and both sets of answers are on `main`, with the features that ask it. Bedrock's answers run only
on the libraries the `bedrock` branch pins (see [bedrock.md](bedrock.md)).

## How It Works

```js
import { editionOf } from '../edition/index.js';

const edition = editionOf(bot.registry);
const text = edition.signSidesOf(bot.blockAt(position)); // ['Wheat farm\nthis way', '']
```

- **`editionOf(registry)`** gives the answers for the game that game data describes, by its
  `version.type`: `pc` (minecraft-data's name for Java Edition) or `bedrock`. Game data built by hand, as
  in unit tests, has no version and counts as Java. An edition nobody registered is an error, never a
  silent guess: Java's answers on another game's data come out wrong without a sound.
- **`registerEdition(type, answers)`** adds an edition. `java.js` holds Java's answers and is registered
  from the start. `src/agent/bedrock/edition.js` registers Bedrock's when it is imported, before any
  Bedrock bot starts.

## The Questions It Answers

| Question | Asked as | Asked by | Java | Bedrock |
|---|---|---|---|---|
| Which state numbers belong to a block | `stateIdsOf(block)` | Fair play's sight | One run, from the block's first number to its last | The block's own list of states; a hashed number has no order |
| A table with an entry per block state | `stateTable(registry)` | Sight, the block search, perception, world memory | A typed array indexed by state number | A small hash table over typed arrays: hashed numbers are too far apart for an array |
| Which state is at a cell of a chunk | `readStateId(column, pos)` | Perception, the block search, chest sorting | The chunk's own answer | The same, and air for a section the server never sent |
| What a chunk section holds, without reading every cell | `sectionSummary(column, sy, minY)` | The block search, world memory's look-around | Its palette, and whether it is all air | The palette of its first layer, whose entries hold the state number; a section never sent is all air |
| A state's properties by name, and back | `propsOfState(registry, stateId)`, `stateOfProps(registry, name, props)` | World memory | Worked out from the state number, one digit per property | Listed for every state in the game data, under Bedrock's names (`upper_block_bit` for a door's top half) |
| Every sound the server sends | `onSound(bot, hear)` | Fair play's hearing | The three sound packets, and the sound inside an explosion packet (1.21.2 and later, which send no sound packet for an explosion), by Java's sound names | A sound played for a mob, and a hurt or death event, given Java's names; doors, chests and the like, and explosions, given Java's names for them; a Bedrock server never sends a mob's everyday noises |
| The bot's operator level | `onOperatorLevel(bot, report)` | Fair play's refusal to act as an operator | An entity status the server sets on the bot | The permission level the server sends with the bot's abilities |
| Where the other half of a double chest is | `otherHalfOf(block)` | World memory, chest sorting | Nothing more to say: Java keeps it in the chest's state | Its block entity names the other half (`pairx`, `pairz`) |
| Whether leaves were placed by hand | `leavesPersist(registry, stateId)` | Good-neighbor rules (`src/agent/neighbor/`): only grown leaves are a tree's canopy, and placed ones are someone's | The `persistent` property of the leaves' state | The `persistent_bit` of the leaves' state |
| What a sign says | `signSidesOf(block)` | World memory | The block reads its own text | The text of each side, from the sign's block entity |
| What a shelf shows | `shelfOf(block)` | World memory, chest storage | Its `facing` and `powered` state, and its block entity's `Items` (slots 0 to 2, as `id` and `count`), which the server sends every player | Its `minecraft:cardinal_direction` and `powered_bit` state, and its block entity's `Items` in tagged values: all three slots in order (`Name`, `Count`, no `Slot`), an empty one with a blank name. Checked live on 1.26.60 |
| Whether a mob is a baby | `isBaby(entity)` | The hunting reflex (`isHuntable`), the idle look-around (`idle_staring`) | Entry 16 of the mob's metadata | The `baby` flag among the mob's named flags |
| Whether a creeper's fuse is lit | `isFusing(registry, entity)` | The creeper reflex (`src/agent/reflexes/`) | `swell_dir` above 0, or `is_ignited`, each found by name among the creeper's metadata entries (16 and 18 from 1.21 to 26.3) | The `ignited` flag among the mob's named flags, set as a creeper starts to explode (checked live by `bedrock_threats.js`) |
| Whether a mob is aiming a ranged attack | `isAiming(registry, entity, at)` | The mob reflex (`src/agent/reflexes/`) | Found by name among the mob's metadata entries: a bow or crossbow held up (the aggressive bit of `mob_flags`, which a skeleton shows under a second after it sees its target, checked live by `mob_scenarios.js`), a bow drawn (the hand-active bit of `living_entity_flags`), `is_charging_crossbow`, a ghast's `is_charging`, a blaze's first `flags` bit | The server shows no flag for it (a skeleton drawing at the bot showed none, 1.26.63); a crossbow `charged` or a blaze's `charge_attack` is read if sent. What a player sees is the archer turning to face them: a shooter within 20 degrees of facing the asker's eye, which this question takes as a third argument (checked live by `bedrock_threats.js`) |
| Whether a mob is about to loose a shot | `isDrawing(registry, entity, at)` | The threat reflexes' shield (`src/agent/reflexes/`) | A bow drawn: the hand-active bit of `living_entity_flags`, which a skeleton shows for about a second before each arrow (it holds the bow up, `isAiming`, all the while it has a target). A crossbow loading or held up loaded, a ghast or blaze winding up, as `isAiming` reads them | No bow drawn is shown. Watched packet by packet (1.26.63), nothing the server sends about a skeleton changes between its taking the bot as its target and each arrow: no flag (`action`, the one Geyser shows a Java skeleton's draw with, nor `charged`), no `charge_amount`, no event. What a Bedrock player has instead is the beat: a skeleton shoots every 3 s (2 s on hard, as Mojang's behavior files give it), each shot with its `bow` sound. A crossbow `charged` or a blaze's `charge_attack` is read if sent |
| Whether a mob has picked a target | `isAggressive(registry, entity)` | The mob reflex and the fight (`src/agent/reflexes/`) | The aggressive bit of `mob_flags`, found by name, set while the mob's attack goal runs: about a second after a zombie sees its target (checked live) | The server doesn't say (a zombie biting the bot showed no flag, and its target id came through the adapter garbled), so it goes by the kind of mob: one that always attacks players has come for whoever it sees; a neutral one only when `angry` |
| Which way a hit came from | `onHurt(bot, felt)` | The mob reflex | `hurt_animation`, sent to the player hurt alone: the hit's angle in degrees from the facing the server has for the player (the game's angle 0 is east, 90 south), which is the facing the bot last sent or a teleport last set, not always the one mineflayer shows (checked live) | An entity event on the bot, with a push away from the hit in the same moment (`set_entity_motion`): the side is the other way from the push (checked live) |
| Whether a mob is a villager, and its age, job and level | `villagerOf(entity)` | `!entities`, and the commands that show and make trades | Named `villager`; its job and level are one entry of its metadata (18 up to 1.21, 19 from 26.1) | Named `villager_v2`; its job is its `variant`, its level its `trade_tier` |
| A block's name as Java calls it | `javaNameOf(registry, name)` | Mindcraft's checks against its lists of blocks (`placeBlock`, `breakBlockAt`, `digDown`, `useToolOnBlock`, the self-preservation reflex) | Its own name | The game data's table from Bedrock's blocks to Java's: `flowing_water` is `water`, `snow_layer` is `snow`, Bedrock's `snow` is `snow_block`, `golden_rail` is `powered_rail`. A name the table doesn't have is kept |
| How far a survival player reaches | `survivalReach()` | Fair play's reach guard | 4.5 blocks to a block, 3 to a mob | 5 to a block (a keyboard, mouse or controller player's), 3 to a mob |
| What a melee hit with an item does | `meleeOf(itemName)` | The threat reflexes' choice of weapon and the fight | The item's attack damage, and a recharge of a second over its attack speed: every swing, and every change of the item in hand, empties an attack meter that a swing must wait out to hit at full strength (a sword every 0.625 s, an iron axe every 1.1 s). The game's values per kind of item, since game data doesn't carry them | No attack meter: every swing does full damage. Swords hit harder than on Java, axes softer. A mob hurt can't be hurt again for half a second, which is the recharge given for every item |
| How often an archer shoots, when that is the only way to know a shot is coming | `shotBeatMs(kind, difficulty)` | The threat reflexes' shield (`shot_beat.js`) | Never: the bow drawn is there to see (`isDrawing`) | On a fixed beat, as Mojang's behavior files give it: a skeleton or a stray every 3 s (2 s on hard), a bogged every 3.5 s (2.5 s). Each shot plays the `bow` sound, which `onSound` gives as Java's `entity.skeleton.shoot`. Checked live: a skeleton's first shot 3.1 s after it took its target, the rest 3.05 s apart |
| Raising the shield in the off-hand | `raiseShield(bot, up)` | The threat reflexes' shield | Using the off-hand (`activateItem(true)`), and letting go to lower it. While it is up the game slows a player to a fifth of a walk, with no sprint and no swing, and it blocks from a quarter of a second after it goes up; mineflayer's physics doesn't slow the bot, so the shield stays up only while the bot stands still | Sneaking, and standing up to lower it: how a Bedrock player raises a shield on every kind of controls. It is up only while the sneak key is held, so whatever stops the bot behind it must let go of the walking keys alone. Checked live by `bedrock_threats.js`: a shield in the off-hand (the adapter puts it there) held up this way stopped a creeper's blast |
| Moving a stack in an open chest | `moveStack(bot, window, from, to)` | Chest sorting | Clicks on a cursor, as a player makes them | One item stack request, which the server grants or refuses |
| Clicking one slot of a shelf | `clickShelfSlot(bot, block, slot)` | Fetching from shelves (`shelf_hands.js`) | `activateBlock` with the point on the front face: the game picks the slot from which third of the face the click lands in (`shelfClickAt`), checked live | The adapter's click with a point (`_genericPlace` with `delta`, and no item-use start and end), since its `activateBlock` always clicks the middle of a face |
| Moving part of a stack in the bot's own bag | `moveInBag(bot, from, to, count)` | Fetching from shelves: splitting off the part wanted | Picked up and put down with left clicks, or one at a time with right clicks for part of it | One item stack request with the count. Between the hotbar and the main inventory the inventory screen is opened for it |
| Whether a block is a furnace, and whether it is lit | `furnaceOf(block)` | Smelting (`src/agent/smelting/`): finding a furnace, and seeing it go out | `furnace`, `blast_furnace` or `smoker`, lit by the `lit` property | A burning furnace is a block of its own: `lit_furnace`, `lit_blast_furnace`, `lit_smoker` |
| Which furnace blocks the bot can smelt in | `usableFurnaceKinds()` | Smelting: which of a furnace, a blast furnace and a smoker to use | All three: they open the same furnace window | All three: a blast furnace and a smoker open windows of their own kind, with their own name for the input slot, and the pinned library gives them the same calls as a furnace's |
| What can be eaten, and how filling each is | `foodsOf(registry)` | Farming: the food the bot keeps from a harvest | The game data's food table (`foodsByName`) | The game data has none (`foodsByName` is empty), so Java's table, narrowed to the items the server has: a food is worth the same and named alike in both editions. Bedrock's own eating (`src/agent/bedrock/eating.js`) reads it the same way |
| What a cauldron holds, and whether it is full | `cauldronOf(block)` | Smelting: a full lava cauldron is a lava farm, fuel to scoop with a bucket | A block for each liquid (`water_cauldron`, `lava_cauldron`, `powder_snow_cauldron`, empty `cauldron`); `level` 1-3 for water and powder snow; lava is always full | One block, `cauldron`: `cauldron_liquid` (water, lava, powder_snow) and `fill_level` 0-6; full is 6 |
| How full a composter is | `composterOf(block)` | Farming: filling a composter and taking its bone meal (`!compost`) | `level`, 0 to 8; ready to give bone meal at 8 | `composter_fill_level`, counted the same |

Each answer is a few lines and decides nothing: it says how the game keeps something, and the feature that
asked decides what to do with it. `java.js` and `src/agent/bedrock/edition.js` explain each one where it
is written.

## What Is Not in It

- **What mineflayer already answers the same way on both editions:** a block's name at a spot, where the
  bot is, digging, walking with the pathfinder. Code that only uses these needs nothing from the seam.
- **The shape of the bot itself.** Mineflayer's Bedrock adapter hands back some
  things in another shape than mineflayer does on Java: an opened chest, a recipe, a click on a block, how
  often the bot reports moving. `src/agent/bedrock/java_shapes.js` puts Java's shape back on the bot once,
  so Mindcraft's skills run unchanged. The seam answers questions this fork's modules ask about the game;
  `java_shapes.js` evens out the `bot` that everything uses.
- **Block names, as the bot sees them.** `bot.blockAt` and world memory keep the names the game in play
  uses. Where world memory needs to know what a block is (a chest, a door, a crop), `kinds.js` judges by
  Java's names, and a Bedrock bot hands it a table from Bedrock's names to Java's
  (`src/agent/bedrock/names.js`). Mindcraft's own lists of blocks, also in Java's names, ask
  `javaNameOf` above, which reads the same table.

## Adding a Question

**When new code needs the seam:** whenever it reads something the game shapes rather than mineflayer, such
as:

- state numbers or their ranges (`minStateId`, `maxStateId`, arithmetic on a state number)
- the inside of a chunk section (`palette`, `solidBlockCount`, `sections`)
- packets (`bot._client`)
- entries of an entity's metadata
- fields of a block entity
- how a window's slots are clicked

If mineflayer's own calls answer it the same way on both editions, the seam isn't needed.

**How to add one:**

1. **On `main`, add the question to `src/agent/edition/java.js`,** with a comment that says what it answers
   and how Java does it. Name it for the question, not for Java's way of answering it: `otherHalfOf`, not
   `pairFromChestType`. Java's own shapes move between versions too (a villager's job went from metadata
   entry 18 to 19 in 26.1), so read by a name or a shape where one exists, not by a fixed place.
2. **Test it** in `tests/edition.test.js`, and against a real server where it reads what the server sends
   (`tests/live/villager_scenarios.js` does that for `villagerOf`).
3. **Ask it through `editionOf(...)`.** A feature never imports `java.js` itself, or Bedrock's answers would
   never be asked.
4. **A call from a file inherited from Mindcraft-CE is a core hook,** listed in
   [`core-hooks.md`](core-hooks.md) like any other (`isHuntable` asks `isBaby` that way).
5. **Add a row to the table above.**
6. **Answer it for Bedrock too,** in `src/agent/bedrock/edition.js`, with a test, before the pull request.
   A test fails while any question has no Bedrock answer (`tests/bedrock_edition.test.js`, "Bedrock answers
   every question the edition seam asks"), because an unanswered question would stop whatever asks it on
   a Bedrock bot.

A feature built for Java alone gets its Bedrock side the same way, on `main`. The seam is what keeps
that small: a feature that asks its questions here works on Bedrock with only the Bedrock answers to
write.
