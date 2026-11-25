# Chest Sorting

One instruction, and the bot tidies a player's chests: part stacks merged, each kind of item together,
related kinds in the same chest. It touches only chests it was approved to sort, and never moves items
between the chests of different people.

- [Turning It On or Off](#turning-it-on-or-off)
- [Whose Chests It Sorts](#whose-chests-it-sorts)
- [What a Sort Does](#what-a-sort-does)
- [Putting Away and Fetching](#putting-away-and-fetching)
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
| **Which chest** | An item or a group goes to the chest that is [for it](#what-a-chest-is-for), when one is. Otherwise a group stays in the chest that already holds most of it, so a base somebody has organized keeps its chests, and else goes to the chest that is least full for its size. A chest for something else is used only when nothing else has room |
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

## Putting Away and Fetching

"Put your things away" and "get me 10 iron". The bot puts what it carries into the chests where those
things belong, and takes things back out of the chests it remembers holding them. On by default, with its
own setting; it needs chest sorting on, which keeps whose each chest is:

```javascript
"store_and_fetch": false,
```

| Command | What it does |
|---|---|
| `!putAway(what, whose, distance)` | `what` is `all` for everything the bot does not need to keep, or one item's name for all of it. `whose` is `any` (the bot's own chests, then the shared ones), `shared`, the bot's own name, or a player's name. Chests within `distance` blocks (1 to 32) |
| `!fetchItem(item_name, num)` | Takes up to `num` of an item out of the chests within 64 blocks, from several when one is not enough |
| `!bringItem(player_name, item_name, num)` | Gets an item to a player: hands over what the bot carries, fetches the rest from the chests by the rules of `!fetchItem`, then walks up to the player and throws it to them |
| `!getTool(kind, material)` | Gets the bot a tool: `kind` is `pickaxe`, `axe`, `shovel`, `hoe` or `sword`, `material` is `wooden`, `stone`, `golden`, `iron`, `diamond`, `netherite` or `any`. The one it carries, else one from the chests, else one crafted from what the bag and the chests hold |
| `!fileInbox(whose, distance)` | Files what players left in [the inbox](#the-inbox) into the chests where it belongs. `whose` and `distance` as for `!putAway` |

**Which chests:**

| Chest | Putting away | Fetching |
|---|---|---|
| The bot's own, or shared | Yes (own first) | Yes |
| A player's | Only when the request names that player, and a player asked | When a player asks: the asker's own first, then other players'. Never on the bot's own idea |
| Nobody has said whose | No | No |

A chest nobody has spoken for may be loot out in the world, or it may be in someone's base, and the bot
can't tell the two apart yet. So both commands leave it alone and name it, and the model can ask whose it
is. `!takeFromChestAt` and `!putInChestAt` still work on one chest a player names.

**What the bot keeps** when it puts away `all`, as a player clearing their bag into a chest would: the best
pickaxe, axe, shovel, hoe and sword (an enchanted or named one first, then the least worn), one spare
pickaxe, all armour, shields, bows, crossbows, tridents, maces and totems, 64 arrows, 16 pieces of the best
food, 64 torches and ladders, 32 cobblestone, and one crafting table, water bucket, bucket and bed. A stack
in the hotbar is kept before one in the main inventory.

**Where each thing goes:**

0. Into a chest that is [for it](#what-a-chest-is-for), one for the item itself before one for its group.
   Never into a chest that is for something else, or into the inbox.
1. Into a chest that already holds that kind of thing, the one holding most of it.
2. Else into the chest holding most of its group (the groups of [a sort](#what-a-sort-does)).
3. Else into an empty chest, which starts a new group's home.
4. Else into the chest with the most room.

Among equals the bot's own chests come before shared ones, then the nearest. A kind too much for one chest
goes on into the next by the same rules. Room is counted in slots with each item's real stack size.

**Fetching** takes from one chest that has all of it when there is one, else from the nearest first. When
no chest it may take from has the item, the result says which chests it was left out of and why, or names
items with a like name that the bot remembers ("iron" finds `iron_ingot` and `raw_iron`). `!fetchItem` only
puts it in the bot's bag; `!bringItem` also hands it over.

**Bringing** ("bring me 10 iron") hands over what the bot already carries first, as a player gives what is
in their bag, and fetches only what it is short of. Which chests it may take from follows who asked, never
who gets it. It walks to about two blocks from the player and throws the item at them chest high, so it
lands at their feet, and the result says whether they took it. A player it can't see or doesn't know is
near gets nothing, and the result says so.

**Getting a tool** ("get yourself an iron pickaxe") goes the way a player goes about it. A tool the bot
already carries is enough, of that material or better (gold counts only when gold was asked for: it wears
out at once). Else it takes one from the chests, by the rules of fetching. Else it crafts one: it works out
what the tool takes (the head, sticks, a crafting table if none is near or carried), counts what the bag
and the chests have, fetches what the bag is short of, then makes planks from logs, sticks from planks, the
table, and the tool. `any` tries the best material first. Netherite is never crafted: it is made at a
smithing table. When nothing is enough the result says what the tool needs, and a full bag is reported
before any crafting, since a crafted thing needs a slot to land in.

```
Took 3 iron_ingot:
- 3 from the chest at -2, 70, -10 (shared)
Crafted an iron_axe.
```

**What it believes and what it checks.** What is in each chest comes from world memory: what the bot saw
the last time it looked. A chest it knows but has never looked into is opened to see first, at most 12, as
a player in a storage room they don't know would. Then it opens one chest at a time, works from what is
really there, counts what moved from the server's answer, and plans the rest again. A chest that won't open
or has no room after all is left out and named. What fits nowhere stays in the bag, and the result says so:
nothing is dropped.

```
Put away oak_log 12, wheat 12, dirt 5, cobblestone 72, stone_pickaxe 1 in 3 chests:
- chest at -2, 70, -10 (shared): oak_log 12
- chest at 4, 70, -10 (your own): wheat 12, dirt 5
- chest at -4, 70, -10 (your own): cobblestone 72, stone_pickaxe 1
Kept on you: cobblestone 32, bread 6, iron_pickaxe 1, stone_pickaxe 1.
Left alone within 16 blocks:
- 1 chest with no known owner, not used: 2, 70, -10. Ask whose it is (then !markChest).
- 1 chest of Alice's, not used
```

```
Took 12 iron_ingot:
- 5 from the chest at -2, 70, -10 (shared)
- 7 from the chest at 0, 70, -10 (Alice's)
If Alice wanted it, hand it over with !givePlayer.
```

**A full bag while gathering.** Mindcraft's collecting used to go on breaking blocks with a full bag and
leave the drops on the ground. Now, before each block, it checks that the bag has room for the drop (an
empty slot, or a stack of it with room). When it hasn't:

- With the bot's own or shared chests within 32 blocks, it puts things away as `!putAway("all", "any", 32)`
  would, keeping what it needs, walks back to the block and goes on. The job's result says what it put away.
- With none near, or nothing it may put away, the job stops: "Inventory full", with what to do about it.
  Walking home from far away is the model's decision.

```
Broke 3/3 oak_log; acquired 3 oak_log.
Your bag was full. Put away dirt 1388 in 1 chest:
- chest at -4, 70, -10 (your own): dirt 1388
Kept on you: cobblestone 32, bread 6, iron_pickaxe 1, stone_pickaxe 1.
```

**Fair play.** Chests are found through the bot's senses and memory, as for a sort; it believes only what
it saw inside. It walks to a chest without digging or placing, opens one only within reach and in view, and
moves items as a player's clicks would. Unlike a sort, a chest out of sight may be used: putting away means
going to the storage room.

## What a Chest Is For

"This chest is for tools", "put the ores in that one", a sign over a chest that says *Wood*. A player who
sets up a storage room decides what goes where, and says so or puts up signs. The bot keeps what a player
says in the chest book, and reads the signs it has seen (world memory keeps what a sign says):

| Where it comes from | Counts |
|---|---|
| A player's word, `!chestFor(x, y, z, what)` | Always. The latest word wins |
| A sign on or beside the chest (within a block of it) | While no player has said anything about that chest. A player's "anything" overrides it |

A chest can be for:

- **a group**, by its name or a word players use for it: `tools`, `combat` (weapons, armour), `food`,
  `minerals` (ores, ingots, gems), `wood` (logs), `stone`, `earth` (dirt), `plants` (crops, seeds, farm),
  `mob_drops` (drops, loot), `redstone`, `building` (decoration), `other`;
- **an item**, as the game names it (`iron_ingot`) or as a sign writes it (*Iron ingots*, *Iron*);
- **several of those**, joined by commas, slashes, `&` or "and": *Ores / Gems*, `iron_ingot, gold_ingot`;
- **the inbox**: the chest players drop things into for the bot to file. A chest nobody had claimed becomes
  shared when it is marked as the inbox, so anyone may leave things in it.

`anything` says a chest has no purpose (and overrides its sign); `unknown` forgets what was said. A word
that is no group and no item is refused, with what may be said instead.

**What it changes:**

| | A chest for something | The inbox |
|---|---|---|
| **Putting away** | Takes what it is for first, the item before its group. Nothing else goes in, and the bot doesn't even open it when nothing it carries is for it | Nothing goes in |
| **Sorting** | What it is for is placed there first. Other things go there only when they fit nowhere else, since a sort has to place everything already in the chests | Not sorted: what is in it is waiting to be filed |
| **Fetching** | No change | No change: it may be fetched from like any chest |

A chest's purpose never says whose it is: that still only comes from a player (`!markChest`).

### The Inbox

A shared base often has one chest by the door where everyone empties their bag, and somebody files it
later. Marked as the inbox, that chest is filed by `!fileInbox`, when a player asks or the model decides to:

1. The bot opens the inbox and takes out what fits in its bag.
2. It puts those things where they belong, by the rules of [putting away](#putting-away-and-fetching).
3. What fits nowhere goes back into the inbox, for a player to deal with.
4. While the bag was what stopped it, it goes back for more, up to 8 trips.

Only what came out of the inbox is filed. The bot keeps all of its own things, even of a kind it is filing:
the list of what it keeps is not used, since none of it was the bot's to begin with. The inbox is never
filed on the bot's own, only by the command.

Which inbox, and where it goes, follow whose they are, as for putting away: the bot's own or a shared inbox
into its own and the shared chests, or a player's inbox into that player's chests when they ask. An inbox
known only from a sign, with nobody having said whose it is, is left alone and named.

```
Filed oak_log 10, gold_ingot 3 from the inbox (chest at 4, 70, -10) into 2 chests:
- chest at 0, 70, -10 (your own): oak_log 10
- chest at -2, 70, -10 (shared): gold_ingot 3
Put back in the chest at 4, 70, -10, with no room for it in the chests you may use: dirt 30. Place a chest, or ask a player where it should go.
```

```
- chest at 41, 70, 0: Alice's. Sorted only when asked. For tools
- chest at 38, 70, 3: shared. Sorted only when asked. For minerals, going by its sign. A sign beside it says "Ores"
- chest at 35, 70, 0: shared. Sorted only when asked. The inbox: players leave things in it for you to file (!fileInbox)
```

## Shelves

A shelf holds three stacks on its front, where anyone walking past can see them. Players use them to show
things off or to keep a few things at hand, and arrange them by hand. So the bot treats a shelf as
storage it knows of, but never as a chest to sort:

- **It is listed by `!chests`,** with what the bot saw on it: `On it: 9 iron_ingot, 1 diamond_pickaxe; one
  slot free`. World memory notes what is on a shelf only when the bot stands in front of it, as a player
  would have to; until then the list says so.
- **Whose it is and what it is for can be said** with `!markChest` and `!chestFor`, as of a chest. It has no
  sorting to mark: `!markChest` takes `same` for it, and notes only the owner if given more.
- **It is never sorted,** and never part of a sort of someone's chests.
- **Fetching takes from it** by the same rules as from a chest (`!fetchItem`, `!bringItem`, `!getTool`): the
  bot's own and shared shelves freely, a player's when a player asks, and never one nobody has spoken for,
  even though what is on it is there for anyone to see.
- **Nothing opens it.** `!sortChest`, `!viewChestAt`, `!takeFromChestAt` and `!putInChestAt` say that a
  shelf has no lid and point to `!chests` instead of saying there is nothing there.
- **A powered shelf is never touched.** Powered by redstone, a click on one swaps the player's hotbar with
  it, which is not taking or putting one stack.

**Taking from a shelf** is what a player does: the bot walks to the cell in front of it, picks an empty
hotbar slot (emptying one into its bag for the moment if the hotbar is full), and clicks the slot's third
of the front. The whole stack comes off. When only part of it was wanted, that part is split off in the
bag and the rest goes back with a second click; with no room in the bag to split it, all of it goes back
and the bag counts as full. The slot the bot was holding is held again after.

A list with a shelf in it:

```
- oak_shelf at 40, 71, 2: Alice's. A shelf: never sorted. On it: 1 diamond_sword, 1 trident; one slot free
```

## What the Model Can Ask

| Command | What it does |
|---|---|
| `!chests(distance)` | Lists the chests the bot knows of within `distance` blocks (1 to 64): where, whose, the permission, what it is for, when last sorted, and which are out of sight. [Shelves](#shelves) too, with what was seen on them |
| `!markChest(x, y, z, owner, sorting)` | Says whose one chest is, how it may be sorted, or both. On a shelf, whose it is |
| `!chestFor(x, y, z, what)` | Says what one chest is for: a group, items, `inbox`, `anything`, or `unknown` to forget it. See [What a Chest Is For](#what-a-chest-is-for) |
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
`!takeFromChest`, `!putInChest`) use whichever chest, trapped chest or barrel is nearest. They are still
there. In a room of chests the model has to say which one, and `!chests` gives it the positions:

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
- **Owners limit sorting, putting away and fetching,** not the single-chest commands: `!takeFromChestAt` and
  `!putInChestAt` refuse nothing.
- **A chest nobody has spoken for is never used to put away or fetch,** even loot out in the world. Telling
  that from a chest in someone's base is not built.
- **There is no list of what to keep** beyond the built-in one; a player can ask to put one item away.
- **Fetching does not craft** what no chest holds; only `!getTool` crafts, and only tools. It does not
  smelt, so iron that is still ore doesn't count, and it never mines what is missing.
- **An owner is a name.** A player who renames their account keeps their chests under the old name until
  someone says otherwise.
- **A chest replaced while the bot was away keeps what was said about the old one,** until a player's
  next word.
- **A chest placed during a long goal the bot prompts itself through is noted as the bot's own,** even
  if a player set the goal. The action's result says so, so the model can put it right.
- **Bots do not share a chest book.** Each keeps its own.
- **Sorting can change a redstone signal** read from a chest by a comparator. Mark such a chest `never`.
- **The groups are fixed.** A chest can be for a group or an item, but a player can't make a group of their
  own ("redstone and rails").
- **A sign is read for what a chest is for, never for whose it is.** A sign that says "Bob" is shown, not
  believed.
- **An interrupted sort leaves what the bot had picked up in its inventory.** It does not put it back.
- **A walk can be given up on.** The walk to each chest gets a deadline, in case the pathfinder stands
  still for good on the way. After it, that chest is left out.
- **Stack sizes come from the game's item data.** On a server that changes them, moves come out
  differently from the plan. The bot notices and stops after a few tries, with nothing lost.
- **A trapped chest gives off its redstone signal** when the bot opens it, as it does for a player.
- **Every sort opens each chest it may sort at least once,** even when nothing needs moving.
- **The bot does not put things on shelves yet.** It takes from them when fetching.

## For Developers

The code is in `src/agent/storage/`.

| File | Job |
|---|---|
| `sort_plan.js` | The plan: chest contents in, moves out. A pure function. Also `applyMoves`, which carries moves out on paper |
| `item_groups.js` | Which items belong together, by name. The only file that knows item names |
| `sorter.js` | Carries a plan out, checks every step, and plans again after a surprise. Touches no game: it is handed "hands" |
| `bot_hands.js` | The real hands: getting to a chest, opening it, reading slots, clicking. The only file that touches the bot's windows |
| `chests.js` | Which blocks are chests to sort, and which two blocks are one chest |
| `chest_book.js` | Whose each chest is, how it may be sorted, and what a player said it is for. A plain store that never touches the game |
| `permit.js` | Which chests a request may sort, in sets that never cross owners, and why the rest are left. A pure function |
| `asker.js` | Who is behind what the bot is doing: a player who asked, or the bot's own idea |
| `made_chests.js` | Whose a chest is when the bot placed it itself, and forgetting one it dug up |
| `purposes.js` | What a chest is for: reads a player's words or a sign's text, says which wins, and how well a chest suits an item. A pure function |
| `commands.js` | The nine commands and the text of their results |
| `keep_plan.js` | What the bot keeps on itself when it puts things away. A pure function, ported from the akarkin1/mindcraft-fk fork under the MIT License (see `ATTRIBUTION.md`) |
| `take_put.js` | Which chests putting away and fetching may use, and why the others are left. A pure function |
| `stow_plan.js` | Which chest each thing goes in, and which chests to fetch from, from what the bot believes is in them. A pure function |
| `stow.js` | Puts away and fetches: one chest at a time, checking it, planning the rest again. Touches no game: it is handed "hands" |
| `inbox.js` | Files the inbox: takes a bagful out, puts it away, returns what fits nowhere, goes back for more. Touches no game |
| `hand_over.js` | Hands an item to a player: walks up close, throws it chest high, sees it taken. Used by `!bringItem`; `!givePlayer` keeps Mindcraft's own |
| `tool_kit.js` | What a tool takes to craft, what the bag and the chests are short of, and which material "any" tries first. A pure function |
| `stow_commands.js` | `!putAway`, `!fetchItem`, `!bringItem`, `!getTool` and `!fileInbox`, and the text of their results |
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
chest skills do: there the item is meant to join the stacks the bot already carries. Putting away moves a
whole stack from its own slot, and part of a stack by count: on Bedrock a part moved slot to slot while a
chest is open goes whole. Taking falls back to topping up stacks when Java's `withdraw` refuses a bag with
no empty slot. `settle` is still
asked for before counting what moved.

**Tests**, in three layers:

| Layer | Where | Needs |
|---|---|---|
| The plan, and who may be sorted | `tests/storage_keep_plan.test.js`, `tests/storage_take_put.test.js`, `tests/storage_stow_plan.test.js`, `tests/storage_sort_plan.test.js`, `tests/storage_item_groups.test.js`, `tests/storage_chest_book.test.js`, `tests/storage_purposes.test.js`, `tests/storage_hand_over.test.js`, `tests/storage_permit.test.js`, `tests/storage_asker.test.js`, `tests/storage_made_chests.test.js` | Nothing |
| The doing, in a fake room | `tests/storage_stow.test.js`, `tests/storage_inbox.test.js`, `tests/storage_stow_commands.test.js`, `tests/storage_sorter.test.js`, `tests/storage_commands.test.js`, `tests/storage_chest_access.test.js`, `tests/storage_install.test.js`. The room (`tests/helpers/fake_chest_bot.js`) keeps the server's copy of a window apart from the bot's guess | Nothing |
| The doing, for real | `tests/live/stow_scenarios.js` puts away and fetches in a room several people share. `tests/live/storage_scenarios.js`: the server console fills the chests and reads them back itself. Its last steps are a room several players share, where every chest a sort was not approved for must be slot for slot as it was | A throwaway server, no model |
| The asking | `tests/live/storage_agent_scenarios.js`: the whole agent is told things in plain words ("that chest is mine", "sort my chests", "keep them tidy"), and the console reads the chests and the bot's own file back. On recorded replies it checks that the commands reach the model as tools and that the bot knows who is speaking | A throwaway server, no model |
| The asking, by a model | The same script with `--live-model --runs=5`. A model's answers vary, so it reports how often each step came out right | A throwaway server and the model in `andy.json`, **which costs money** |

Edits to inherited files are listed in [core-hooks.md](core-hooks.md): the setting, one line in
`agent.js`, and `registerCommand`.
