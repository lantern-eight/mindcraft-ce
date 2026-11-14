# Chest Sorting

One instruction, and the bot tidies the chests around it: part stacks merged, each kind of item together,
related kinds in the same chest.

- [Turning It On or Off](#turning-it-on-or-off)
- [What a Sort Does](#what-a-sort-does)
- [What the Model Can Ask](#what-the-model-can-ask)
- [How It Works](#how-it-works)
- [When Things Go Wrong](#when-things-go-wrong)
- [Is It Fair?](#is-it-fair)
- [Known Limits](#known-limits)
- [For Developers](#for-developers)

## Turning It On or Off

Chest sorting is **on by default**. To turn it off, in `settings.js`:

```javascript
"chest_sorting": false,
```

It needs neither fair play nor world memory:

| With | What changes |
|---|---|
| Fair play off | Chests are found and opened the way stock Mindcraft-CE does it |
| Fair play on | The bot sorts only chests it has seen, and opens one only from where it can see and reach it |
| World memory on | What the bot saw in each chest is remembered as it goes, so `!recall` knows the new layout |

## What a Sort Does

| | |
|---|---|
| **Which containers** | Chests, trapped chests and barrels. A double chest is one chest |
| **Merging** | Stacks of one kind are poured together: full stacks, and at most one part stack |
| **Order in a chest** | From the first slot with no gaps, by group and then by name |
| **Groups** | Tools, combat, food, minerals, wood, stone, earth, plants, mob drops, redstone, building, other |
| **Which chest** | A group stays in the chest that already holds most of it, so a base somebody has organized keeps its chests. Otherwise it goes to the chest that is least full for its size |
| **Too much for one chest** | A group is then placed kind by kind, and a kind stack by stack |
| **Items that only share a name** | A worn tool and a new one, or two different potions, are kept apart and never merged |
| **Already sorted** | Nothing is moved |

**Left alone on purpose:**

- **Ender chests** are one player's own.
- **Shulker boxes** cannot hold another shulker box, which a sort might try to put in one.
- **Hoppers** empty themselves.
- **Furnaces, dispensers and brewing stands** hold what they are working with.

**The bot's own things stay where they were.** It carries chest items only in main inventory slots that
were empty when the sort began, and never in its hotbar.

## What the Model Can Ask

| Command | What it does |
|---|---|
| `!sortChests(distance)` | Sorts every chest and barrel the bot can see or remember within `distance` blocks of where it stands (1 to 32) |

The result says what was done, then what kinds of thing each chest holds now:

```
Sorted 4 chests in 52 moves: 28 stacks are now 24.
- double chest at 3, 70, 11: food, minerals, mob_drops (10 of 54 slots used)
- barrel at 3, 70, 14: wood, earth (6 of 27 slots used)
- chest at 3, 70, 9: stone (4 of 27 slots used)
- trapped_chest at 3, 70, 16: tools, combat (4 of 27 slots used)
```

The model only decides to ask. Which stack goes where is worked out in code, so the same mess is always
sorted the same way, and a sort can be tested without a model.

## How It Works

Sorting has a thinking half and a doing half, kept apart.

1. **Look.** The bot opens every chest once and reads each slot. Memory of a chest is not enough: it
   keeps how many of each item there were, not which slot each stack was in.
2. **Plan.** A function with no game behind it takes what is in the chests and gives back the list of
   moves that tidies them.
3. **Do.** The bot goes from chest to chest making the moves.

**One move** is the one a player makes with the mouse: pick a stack up, click another slot, and put back
whatever is on the cursor after that. Depending on what was in the second slot, that puts the stack
down, pours it into a stack of the same kind, or swaps the two. A swap needs no free slot, so a
completely full chest can still be sorted.

**Between chests** the bot carries stacks in its own free inventory slots. With no free slot it sorts
each chest where it stands.

**Walking.** A chest within about four blocks is opened from where the bot stands, as a player in a
storage room would. The bot walks only to a chest it cannot reach, or one that would not open from where
it is.

**Pace.** About ten moves a second, which is no faster than a quick player.

## When Things Go Wrong

A plan is made from what the chests held when the bot looked, and a chest in a shared base does not stay
that way. So the bot never trusts a plan further than the next move: it checks a chest is as it remembers
before working in it, checks each move did what the plan said, and asks the server what is really there
before closing.

| What happens | What the bot does |
|---|---|
| A chest will not open: a block on top, out of sight, no way to get there | Leaves it out, names it in the result with the reason, and sorts the rest |
| Someone changed a chest after the bot looked | Notices on opening it again, puts down what it is carrying, and plans again from what is there |
| A click comes out differently on the server | The same. After three new plans it stops and says so |
| No chest has room for what it is carrying | Stops, and says what it is still holding. Those items are in its inventory |
| The sort is interrupted | Closes the chest and stops. Anything it had picked up stays in its inventory |

Nothing is lost in any of these.

## Is It Fair?

- **Finding.** Chests are found through the same senses as everything else. A chest in a sealed room,
  inside the distance the bot was told to sort, is never found and never touched.
- **Opening.** With fair play on, a chest opens only within a survival player's reach and in view.
- **Clicking.** A move is the same three clicks a player makes, at a player's pace. Nothing is
  shift-clicked, dragged or sent as a command.

## Known Limits

- **It sorts every chest it knows of within the distance, whoever's it is.** Good-neighbor rules are not
  built yet. Give it a distance that covers only your own storage.
- **The groups are fixed.** There is no way yet to say "this chest is for building blocks", beyond the
  rule that a group stays in the chest that already holds most of it.
- **An interrupted sort leaves what the bot had picked up in its inventory.** It does not put it back.
- **A walk can be given up on.** The pathfinder this fork inherits can stand still for good at a corner
  it planned to cut. A walk to a chest gets a deadline, after which that chest is left out.
- **Stack sizes come from the game's item data.** On a server that changes them, moves come out
  differently from the plan. The bot notices and stops after a few tries, with nothing lost.
- **A trapped chest gives off its redstone signal** when the bot opens it, as it does for a player.
- **Every sort opens each chest at least once,** even when nothing needs moving.

## For Developers

The code is in `src/agent/storage/`.

| File | Job |
|---|---|
| `sort_plan.js` | The plan: chest contents in, moves out. A pure function. Also `applyMoves`, which carries moves out on paper |
| `item_groups.js` | Which items belong together, by name. The only file that knows item names |
| `sorter.js` | Carries a plan out, checks every step, and plans again after a surprise. Touches no game: it is handed "hands" |
| `bot_hands.js` | The real hands: getting to a chest, opening it, reading slots, clicking. The only file that touches the bot's windows |
| `chests.js` | Which blocks are chests to sort, and which two blocks are one chest |
| `commands.js` | `!sortChests` and the text of its result |
| `install.js` | Turns it on for an agent, from the `chest_sorting` setting |

Two things to know before changing `bot_hands.js`:

- **A move is three clicks made directly,** not mineflayer's `moveSlotItem`. That helper looks for the
  cursor on the bot's own inventory, which is not where the cursor is while a chest is open, so a swap
  would leave a stack on the cursor.
- **The bot's copy of a window is a guess.** It works out what each click did without waiting for the
  server, and for some items it guesses wrong: two tipped arrows of different potions look like one kind
  to it. `settle` asks the server to send the window again and puts back a stack a wrong guess left on
  the cursor.

**Tests**, in three layers:

| Layer | Where | Needs |
|---|---|---|
| The plan | `tests/storage_sort_plan.test.js`, `tests/storage_item_groups.test.js` | Nothing |
| The doing, in a fake room | `tests/storage_sorter.test.js`, `tests/storage_commands.test.js`. The room (`tests/helpers/fake_chest_bot.js`) keeps the server's copy of a window apart from the bot's guess | Nothing |
| The doing, for real | `tests/live/storage_scenarios.js`: the server console fills the chests and reads them back itself | A throwaway server, no model |

Edits to inherited files are listed in [core-hooks.md](core-hooks.md): the setting, one line in
`agent.js`, and `registerCommand`.
