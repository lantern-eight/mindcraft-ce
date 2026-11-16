# Chest Sorting

One instruction, and the bot tidies a player's chests: part stacks merged, each kind of item together,
related kinds in the same chest. It touches only chests it was approved to sort, and never moves items
between the chests of different people.

- [Turning It On or Off](#turning-it-on-or-off)
- [Whose Chests It Sorts](#whose-chests-it-sorts)
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

## Whose Chests It Sorts

**Nothing is sorted by default.** A chest is sorted only when that was approved for that chest. The bot
keeps a small "chest book" of what it was told: for each chest, whose it is and how it may be sorted.

**Owners:**

| Owner | Meaning | How it gets set |
|---|---|---|
| A player's name | That player's chest | Someone says so |
| `shared` | Everyone's, the bot included | Someone says so |
| The bot | The bot's own | The bot placed it on its own idea, or someone says so |
| Unknown | Nobody has said | The default |

- **The bot never guesses an owner** from who stands near a chest or what is in it. It asks.
- **The latest word wins,** whoever says it. No player is refused.
- **A new owner starts with that owner's default permission.** "Always sort it" was the old owner's word.
- **Names** are matched without regard to capitals. An owner may be offline. A name the bot has not met
  is accepted, and pointed out so a slip is noticed.

**Permission:**

| Permission | The chest is sorted |
|---|---|
| `asked` | Only when a player asks. The default for everyone's chests but the bot's own |
| `always` | Also when the bot decides to. The default for the bot's own chests |
| `never` | Not at all, even when its owner's chests are sorted. For a chest its owner laid out by hand |

**What each request sorts:**

| Request | Sorts | Leaves alone |
|---|---|---|
| One chest, named by where it is | That chest, by itself, whoever's it is | It, if marked `never` |
| A player's chests | That player's chests, together | Theirs marked `never`, and everyone else's |
| The shared chests | The shared chests, together | Those marked `never`, and everyone else's |
| The bot's own chests | Its own, together | Its own marked `never`, and everyone else's |
| Every approved chest | Every chest marked `always`, each owner's by themselves | Everything else |

- **A sort never moves items between the chests of different owners.** One owner's chests are sorted
  together, the next owner's after them.
- **Only chests the bot can see from where it stands** are sorted together: a straight line from its
  eyes to some side of the chest. "Sort my chests" means the ones in this room, not every chest the
  player owns across the world. One chest named by where it is need not be in view.
- **Chests with no known owner are never sorted together.** They may be different people's. The bot
  can sort one by itself when asked, or ask whose they are.
- **On its own idea the bot sorts only what may always be sorted.** A chest that is someone else's and
  not marked `always` is refused when no player is behind the request. A player is never refused: when
  the bot cannot tell who asked, it sorts.
- **Every sort says what it left alone, and why.** That is how the bot comes to ask "whose are these?"

**Chests the bot places itself:**

| The bot places a chest | It is noted as |
|---|---|
| On its own idea | The bot's own, `always` |
| While doing what a player asked | That player's, `asked` |
| When it cannot tell who is behind it | No owner yet. The bot is told to ask or say |
| Against a chest already standing, making a double chest | Whose that chest already was |

The second row is a guess that leans the safe way: if it is wrong, the bot leaves alone a chest it could
have tidied. The result of the action says what was noted and how to change it. A chest the bot digs
up is forgotten.

## What a Sort Does

| | |
|---|---|
| **Which containers** | Chests, trapped chests and barrels. A double chest is one chest |
| **Whose** | Only the chests the request was approved for, one owner's at a time. See [above](#whose-chests-it-sorts) |
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
| `!chests(distance)` | Lists the chests the bot knows of within `distance` blocks (1 to 64): where, whose, the permission, when last sorted, and which are out of sight |
| `!markChest(x, y, z, owner, sorting)` | Says whose one chest is, how it may be sorted, or both |
| `!markChests(which, distance, owner, sorting)` | The same for several chests in view at once. `which` is `unknown` for the ones with no owner yet, or a current owner. It never changes another owner's chests |
| `!sortChest(x, y, z)` | Sorts one chest by itself |
| `!sortChests(whose, distance)` | Sorts one owner's chests in view within `distance` blocks (1 to 32), together. `whose` is a player's name, `shared`, the bot's own name, or `approved` for every chest marked `always` |
| `!viewChestAt(x, y, z)` | Says what one chest holds, added up by kind, and whose it is |
| `!takeFromChestAt(x, y, z, item_name, num)` | Takes up to `num` of an item out of one chest |
| `!putInChestAt(x, y, z, item_name, num)` | Puts up to `num` of an item the bot carries into one chest |

- **`owner`** is a player's name, `shared`, the bot's own name, `unknown`, or `same` to leave it as it is.
- **`sorting`** is `always`, `asked`, `never`, or `same`.
- **The bot's own chests go by the bot's name.** "Mine" and "me" are refused: the model speaks for
  several people, and the word could mean the player or the bot.

A list:

```
CHESTS YOU KNOW WITHIN 8 BLOCKS (nearest first)
- chest at 41, 70, 0: Alice's. Never sorted
- chest at 38, 70, 3: your own (you placed it). May always be sorted
- chest at 41, 70, 4: Bob's. May always be sorted. Last sorted 2 minutes ago
- chest at 35, 70, 0: Alice's. Sorted only when asked. Out of sight from here
- chest at 41, 70, -6: owner unknown. Sorted only when asked. A sign beside it says "Bob"
```

A sign beside a chest is shown when world memory has its text. It is a hint only: the bot does not take
an owner from it.

A sort says what was done, what kinds of thing each chest holds now, and what was left alone:

```
Sorted 2 chests (Alice's) in 8 moves: 6 stacks are now 4.
- chest at 41, 70, -2: food, wood, stone (3 of 27 slots used)
- chest at 41, 70, -4: minerals (1 of 27 slots used)
Left alone within 8 blocks:
- 1 chest of Alice's marked never sort: 41, 70, 0
- 2 chests of Bob's
- 1 shared chest
- 1 chest with no known owner: 41, 70, -6. Ask whose it is before sorting it.
- 1 more Alice's is nearby but out of sight from here. Only chests you can see from where you stand are sorted.
```

**One chest, named by where it is.** The chest commands Mindcraft-CE comes with (`!viewChest`,
`!takeFromChest`, `!putInChest`) use whichever chest is nearest, and only chests, not barrels. They are
still there. In a room of chests the model has to say which one, and `!chests` gives it the positions:

```
The chest at 41, 70, 4, which is Bob's, holds (2 of 27 slots used):
- stone 3
- sand 30
```

```
Took 10 sand from the chest at 41, 70, 4, which is Bob's.
```

- **The chest is opened as a sort opens it:** from where the bot stands when it is within reach, and
  otherwise after a walk that neither digs nor places.
- **What moved is counted from the chest afterwards.** With no room in the bot's inventory, or in the
  chest, what fits is moved and the result says how much that was.
- **A number larger than what is there moves all of it.**
- **They say whose the chest is and refuse nothing.** Whose chests the bot may take from is not decided
  yet (see [Known Limits](#known-limits)).

How a conversation goes:

| A player says | The model | Then |
|---|---|---|
| "Sort my chests" (Alice) | `!sortChests("Alice", 16)` | Hers are sorted. The result names three chests with no owner, and the bot asks whose they are |
| "They're mine too" | `!markChests("unknown", 16, "Alice", "same")`, then the sort again | All of hers are sorted |
| "Keep them tidy from now on" | `!markChests("Alice", 16, "same", "always")` | Later, on its own, `!sortChests("approved", 16)` includes them |

The model only decides to ask. Which chests a request may touch, and which stack goes where, are worked
out in code, so the same mess is always sorted the same way, and a sort can be tested without a model.

## How It Works

Sorting has a thinking half and a doing half, kept apart.

1. **Look.** The bot opens every chest it is going to sort once and reads each slot. Memory of a chest is not enough: it
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
it is. That walk never digs and never places a block: tidying a chest is no reason to make a hole in
somebody's wall. A chest with no way to it on foot is left out and named.

**Pace.** About ten moves a second, which is no faster than a quick player.

## When Things Go Wrong

A plan is made from what the chests held when the bot looked, and a chest in a shared base does not stay
that way. So the bot never trusts a plan further than the next move: it checks a chest is as it remembers
before working in it, checks each move did what the plan said, and asks the server what is really there
before closing.

| What happens | What the bot does |
|---|---|
| A chest will not open: a block on top, out of sight, no way to it on foot | Leaves it out, names it in the result with the reason, and sorts the rest |
| Someone changed a chest after the bot looked | Notices on opening it again, puts down what it is carrying, and plans again from what is there |
| A click comes out differently on the server | The same. After three new plans it stops and says so |
| No chest has room for what it is carrying | Stops, and says what it is still holding. Those items are in its inventory |
| It is still holding one owner's items when their chests are done | Does not start on the next owner's chests, and says so. Carrying them on would invite a mix-up |
| A chest it was told about is gone | Forgets what it was told, the next time it looks at the spot. A chest it merely cannot see is kept |
| The sort is interrupted | Closes the chest and stops. Anything it had picked up stays in its inventory |

Nothing is lost in any of these.

## Is It Fair?

- **Finding.** Chests are found through the same senses as everything else. A chest in a sealed room,
  inside the distance the bot was told to sort, is never found and never touched. The chest book adds
  what was said about a chest the bot found. It never says that a chest exists.
- **In view.** Which chests are sorted together is decided with the same line-of-sight check fair play
  uses, with fair play on or off. It only ever narrows the chests the bot already knows.
- **Opening.** With fair play on, a chest opens only within a survival player's reach and in view.
- **Clicking.** A move is the same three clicks a player makes, at a player's pace. Nothing is
  shift-clicked, dragged or sent as a command.

## Known Limits

- **The bot believes what it is told.** Any player can say whose a chest is, and can ask for any chest
  to be sorted. Refusing a player is not built.
- **Owners matter only for sorting.** Taking from a chest and putting into one are not limited by owner
  yet.
- **An owner is a name.** A player who renames their account keeps their chests under the old name until
  someone says otherwise.
- **A chest replaced while the bot was away keeps what was said about the old one,** until a player's
  next word.
- **A chest placed during a long goal the bot prompts itself through is noted as the bot's own,** even
  if a player set the goal. The action's result says so, so the model can put it right.
- **Bots do not share a chest book.** Each keeps its own.
- **Sorting can change a redstone signal** read from a chest by a comparator. Mark such a chest `never`.
- **The groups are fixed.** There is no way yet to say "this chest is for building blocks", beyond the
  rule that a group stays in the chest that already holds most of it.
- **An interrupted sort leaves what the bot had picked up in its inventory.** It does not put it back.
- **A walk can be given up on.** The pathfinder this fork inherits can plan a step that cuts the corner
  of a block and then stand still for good. The walk to a chest goes round corners squarely to avoid
  that, and still gets a deadline, after which that chest is left out.
- **Stack sizes come from the game's item data.** On a server that changes them, moves come out
  differently from the plan. The bot notices and stops after a few tries, with nothing lost.
- **A trapped chest gives off its redstone signal** when the bot opens it, as it does for a player.
- **Every sort opens each chest it may sort at least once,** even when nothing needs moving.

## For Developers

The code is in `src/agent/storage/`.

| File | Job |
|---|---|
| `sort_plan.js` | The plan: chest contents in, moves out. A pure function. Also `applyMoves`, which carries moves out on paper |
| `item_groups.js` | Which items belong together, by name. The only file that knows item names |
| `sorter.js` | Carries a plan out, checks every step, and plans again after a surprise. Touches no game: it is handed "hands" |
| `bot_hands.js` | The real hands: getting to a chest, opening it, reading slots, clicking. The only file that touches the bot's windows |
| `chests.js` | Which blocks are chests to sort, and which two blocks are one chest |
| `chest_book.js` | Whose each chest is and how it may be sorted. A plain store that never touches the game |
| `permit.js` | Which chests a request may sort, in sets that never cross owners, and why the rest are left. A pure function |
| `asker.js` | Who is behind what the bot is doing: a player who asked, or the bot's own idea |
| `made_chests.js` | Whose a chest is when the bot placed it itself, and forgetting one it dug up |
| `commands.js` | The eight commands and the text of their results |
| `install.js` | Turns it on for an agent, from the `chest_sorting` setting. Opens and saves the chest book |

The chest book is saved under `bots/<name>/storage/`, one `chests.json` per world and dimension, so a world
opened to LAN keeps whose chests are whose from one session to the next. A world is known the same way as
for world memory (see [world-memory.md](world-memory.md)), and a book saved by an older version is carried over.

`asker.js` wraps `handleMessage` on the agent it is given, and reads who a running task is for. It edits
no inherited file. It errs one way on purpose: a player anywhere in the picture counts as asked, and
when nothing can be told the answer is "unknown", which is allowed.

Two things to know before changing `bot_hands.js`:

- **A move of the sort is asked of the [edition seam](edition-seam.md)** (`moveStack` in `src/agent/edition/`). On Java it is
  three clicks made directly, not mineflayer's `moveSlotItem`. That helper looks for the cursor on the
  bot's own inventory, which is not where the cursor is while a chest is open, so a swap would leave a
  stack on the cursor. Which two chest blocks make one double chest is asked of the seam too
  (`otherHalfOf`), for a game that keeps it outside the blocks' states.
- **The bot's copy of a window is a guess.** It works out what each click did without waiting for the
  server, and for some items it guesses wrong: two tipped arrows of different potions look like one kind
  to it. `settle` asks the server to send the window again and puts back a stack a wrong guess left on
  the cursor.

Taking from and putting into one chest use mineflayer's own `withdraw` and `deposit`, as the inherited
chest skills do: there the item is meant to join the stacks the bot already carries. `settle` is still
asked for before counting what moved.

**Tests**, in three layers:

| Layer | Where | Needs |
|---|---|---|
| The plan, and who may be sorted | `tests/storage_sort_plan.test.js`, `tests/storage_item_groups.test.js`, `tests/storage_chest_book.test.js`, `tests/storage_permit.test.js`, `tests/storage_asker.test.js`, `tests/storage_made_chests.test.js` | Nothing |
| The doing, in a fake room | `tests/storage_sorter.test.js`, `tests/storage_commands.test.js`, `tests/storage_chest_access.test.js`, `tests/storage_install.test.js`. The room (`tests/helpers/fake_chest_bot.js`) keeps the server's copy of a window apart from the bot's guess | Nothing |
| The doing, for real | `tests/live/storage_scenarios.js`: the server console fills the chests and reads them back itself. Its last steps are a room several players share, where every chest a sort was not approved for must be slot for slot as it was | A throwaway server, no model |
| The asking | `tests/live/storage_agent_scenarios.js`: the whole agent is told things in plain words ("that chest is mine", "sort my chests", "keep them tidy"), and the console reads the chests and the bot's own file back. On recorded replies it checks that the commands reach the model as tools and that the bot knows who is speaking | A throwaway server, no model |
| The asking, by a model | The same script with `--live-model --runs=5`. A model's answers vary, so it reports how often each step came out right | A throwaway server and the model in `andy.json`, **which costs money** |

Edits to inherited files are listed in [core-hooks.md](core-hooks.md): the setting, one line in
`agent.js`, and `registerCommand`.
