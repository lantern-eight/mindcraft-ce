# Threat Reflexes

The threat reflexes keep the bot alive when something dangerous turns up in the middle of whatever it is
doing, without waiting for the model. There are two reflexes and a fight:

- **The creeper reflex**, `creeper_safety`, backs the bot off from a creeper about to explode, and deals with
  one that keeps following it.
- **The mob reflex**, `mob_safety`, deals with every other hostile mob: it runs at low health, takes cover
  from a mob aiming at the bot, backs away when the bot is outnumbered or in no shape to fight, and gets
  away from hits it can't see the cause of.
- **The fight**, Mindcraft's own `self_defense` under the same name, fights a lone mob that comes at the bot
  when the bot is fit for it.

A shield the bot carries goes in its off-hand, and goes up where a player would raise it: at an archer drawing
its bow, at a creeper about to blow that the bot can't get clear of. And the bot never looks an enderman in
the eye, and remembers for a while where it met danger: its walks go round those places. A player can give it standing orders about a kind of mob (fight zombies, run from
spiders, ignore skeletons), which the reflexes follow at once from then on.

- [Turning It On](#turning-it-on)
- [Why Reflexes of Their Own](#why-reflexes-of-their-own)
- [What the Creeper Reflex Does](#what-the-creeper-reflex-does)
- [What the Mob Reflex Does](#what-the-mob-reflex-does)
- [The Fight](#the-fight)
- [The Shield](#the-shield)
- [Standing Orders](#standing-orders)
- [Never Looking an Enderman in the Eye](#never-looking-an-enderman-in-the-eye)
- [The Glance](#the-glance)
- [Danger Zones](#danger-zones)
- [What They Know, and How](#what-they-know-and-how)
- [Holding Other Work](#holding-other-work)
- [Telling the Model](#telling-the-model)
- [Path Searches Kept](#path-searches-kept)
- [Known Limits](#known-limits)
- [Code Layout](#code-layout)
- [Testing](#testing)

## Turning It On

In `settings.js`:

```js
"threat_reflexes": true,   // this fork's default; false leaves them all out, and self_defense is stock
```

Each reflex is a mode like Mindcraft's own, so it can also be switched for one bot: `!setMode("creeper_safety",
false)`, `!setMode("mob_safety", false)`, `!setMode("self_defense", false)`, or the same names in a profile's
`modes`. They work with fair play on or off. Danger zones come with them and have no switch of their own.

## Why Reflexes of Their Own

Stock Mindcraft has two reflexes for hostile mobs, and they handle danger badly:

- **`cowardice` is off in every default profile.** It runs from anything within 16 blocks, so it can't be on
  for a bot that works at night.
- **`self_defense` fought anything hostile within 8 blocks**, whatever the bot's health: two zombies at once,
  a passing enderman, a skeleton it then chased into the open, a creeper (it walked the bot into the blast).
- **Actions pause both until the bot is idle.** Walking to a player pauses them, and so does a fight; `!stay`
  pauses almost everything. A lit creeper or a skeleton's arrows were ignored all that time.
- **Nothing knows the tells a player reads:** a creeper swelling, a bow raised, arms out at a target.

So the creeper reflex and the mob reflex sit right after `self_preservation` in the list of modes, and
nothing pauses them by name: not walking to a player, not a fight, not `!stay`. They answer only to their own
switches, not to `cowardice`: stepping out of a blast or out of a skeleton's sight is self-preservation, like
stepping out of lava. `cowardice` keeps its stock meaning and stays off by default; `self_defense` keeps its
switch, and the actions that pause it still do.

## What the Creeper Reflex Does

It follows how the game behaves (Java Edition): a creeper lights its fuse when its target is within 3
blocks; the fuse burns while the target stays within 7 blocks and in its sight, and runs back down a tick at
a time otherwise; it explodes after 1.5 s; and once its fuse is out it chases again, while the target is
within 16 blocks and in its sight.

| What | What the bot does |
|---|---|
| A creeper seen lit within 7 blocks, or its hiss heard close | **Backs off:** sprints straight away until it is 8 blocks off (farther for one only heard, whose distance is rough) |
| A creeper within 3 blocks, not lit yet | Backs off before it lights |
| A creeper seen lit within 6 blocks that the bot won't get clear of in time: at a sprint its fuse runs out before the bot is past the blast's reach, or the bot is stuck | With a shield in the off-hand, **stops and holds it up toward the creeper**, which stops the blast ([The Shield](#the-shield)) |
| An explosion heard very close | Backs off from it: another may follow |
| The same creeper coming again after a back-off (it is following) | **Finishes it.** With a weapon that kills it in 4 hits or fewer and half its health or more, the bot sprint-hits it, which knocks it back, and steps back past its range; it goes back in only once the creeper's fuse has run down. Otherwise it **leaves**: 22 blocks off, well past the 16 a creeper follows, or until the creeper has been out of view for 2 s |
| A creeper within 8 blocks, not lit | The **errands** an idle bot runs (picking up items, hunting, placing torches, making room for a player) start nothing, and one already walking stops: their walks don't look where they go, and one walked the bot up to a creeper for an item beside it. The model's commands, the fight and the other reflexes go on |
| A creeper well above a bot that is underground | Only watched: it can't reach the bot |
| A creeper dying | Nothing: it can't explode any more |
| In creative or spectator mode | Nothing: the bot takes no damage |

**The first step doesn't wait for a path search.** If the ground straight away from the creeper is open and
safe, the bot sprints that way at once, and keeps going while it stays safe; where it isn't, the pathfinder
takes over. Choosing the way is a decision, so it reads blocks through world.js, which under fair play means
what the bot has seen. It never steps into lava or fire or off a drop of more than 2 blocks, and the
pathfinder's part of the escape is held to the same drop. Nothing it does pauses `self_preservation`.

**Turning at a player's speed** (fair play's `turn_speed`), the turn to run takes up to a second, most of a
fuse. A player doesn't stand still for it, and nor does the bot: it backs away on the keys while its head
comes round (back, or a diagonal), onto the cells beside it it can feel are open, taking the ground under them
on trust as a player backing off would, and sprints once it faces the way out. Walled in on every side away from
the creeper (a dead end), it doesn't turn its back for a way out that isn't there: it stays facing the creeper
and has its shield up at once. To hit a creeper it turns to it from 4 blocks off, outside the 3 that light it,
and goes in once it faces it; and once it has backed off far enough from one it means to hit, it turns to face
it again, as a player squaring up does. Seeing through a player's screen, it then sees whether the creeper is
still lit. A bot that will leave the creeper (on Bedrock, or with no weapon) doesn't stand and turn.

**It reacts to a hiss the moment it is heard.** The reflexes run every 300 ms or so, and a fuse is 1.5 s, so
the reflex doesn't wait for its next round when a hiss arrives.

## What the Mob Reflex Does

It deals with every hostile mob but creepers. Each round it decides once, and the first rule that matches
wins:

| # | What | What the bot does |
|---|---|---|
| 1 | Health under 6, with a hostile in view or a hit felt just now | **Runs**, 20 blocks from every hostile about, newcomers included |
| 2 | A mob in view aiming at the bot within 16 blocks: a skeleton's bow raised or drawn, a pillager's crossbow held up or loading, a ghast or blaze winding up. Not a skeleton the fight will rush (one when the bot is armed, two in full iron or better, below) | **Takes cover:** walks to the nearest spot behind a wall it has seen that hides its whole body from the mob's eyes, picking again if the mob moves; with no cover near, backs out of range, stopping behind its shield while the bow is drawn. Through a player's screen, with a shield, it backs out walking backwards, facing the archer, so it sees each draw (or hears each shot due, on Bedrock) |
| 3 | More melee mobs in view within 8 blocks that have come for the bot (or within 5, about to) than its gear takes on: two or more bare-handed, four or more with a sword or an axe. Or two or more with one too strong among them | **Backs away from all of them at once**, 16 blocks from each, rather than from the nearest into the next. A fight already started on one of them doesn't hold this back |
| 4 | One melee mob coming at it that the bot shouldn't fight: the bot under half health, or too hungry to sprint (food 6 or less), or the mob too strong for a fight nobody asked for (a cave spider's poison, a warden, a ravager, a vindicator, a piglin brute, a hoglin or zoglin, a provoked enderman, a wither skeleton) | Backs away from it |
| 5 | Hit twice within 4 s with nothing in view that could have done it: no mob within reach, none that has picked a target, none that shoots | **Gets away from the side the hits came from** |
| | Anything else | Nothing. A lone mob in a fair fight is the fight's |

Not every mob in view is a reason to move. A skeleton is taken cover from when it aims, not whenever one is
in view; a zombie counts when it has come for the bot. At night that is the difference between a bot that
works and one that keeps running. Mobs that fly (a phantom, a vex) are no reason to run along the ground.

Moving away goes through the same moves as the creeper reflex: a straight sprint first where the way is
safe, then the pathfinder, toward wherever is farthest from all of them. Leaving ends when the bot is far
enough, or, seeing all around, when all of them have been out of its view for 2 s (they have lost it too).
Through a player's screen the bot backs away facing the way out, so their being out of view says nothing:
it goes by distance, and looks back when it stops (the glance). A mob that chases (a zombie, a spider) is
taken to keep coming while out of view, at 2.5 blocks a second from where it was last seen, for up to 4 s, as a
player running from zombies knows they follow (a zombie measured live on Bedrock went 2.3). Gone by where they
were last seen, the bot stopped "far enough" with the zombies still coming, under 8 blocks behind it.

## The Fight

With the threat reflexes on, `self_defense` is this fork's: it fights **what has come for the bot, within 8
blocks, as much as its gear takes on, with the bot at half health or more and fed enough to sprint**:

| Gear | It takes on | Why |
|---|---|---|
| Bare hands | One melee mob | Measured melee trials (unarmed, unarmored) won one mob of most kinds and lost two zombies at once |
| A sword or an axe | Up to three melee mobs and one skeleton (or stray, or bogged), which it rushes instead of hiding from | In the arenas a stone or a copper sword beat three zombies with at most 3 damage taken. By its own judgment it now beat a lone skeleton every time, with 3 to 5 damage on Java and none on Bedrock; backing away from it, as it did before, cost 8 to 16 on Java, and on Bedrock brought the bot near death every time. Two zombies, a skeleton and a spider at once it now won 6 times in 6 on Java (1 before) and 4 in 6 on Bedrock (none before) |
| A sword or an axe, and a shield | Up to three melee mobs and two skeletons | In the arenas, by its own judgment, a stone sword and a shield beat two skeletons every time, with 8 damage on Java and 5 to 8 on Bedrock. Backing away from them instead, as it did before, lost two rounds of three on Java (13 damage) and every round on Bedrock |
| A sword or an axe, and 15 armor points or more (a full iron set) | Up to three melee mobs and two skeletons | In the arenas an iron sword in iron armor won every round on both editions, two skeletons with 4 damage taken at most. Two skeletons are still backed away from with a sword alone, as a cautious player would; in the walled pen that cost 10 to 25 damage, but the pen is the worst place to back away in |

More than that, or one too strong, are the mob reflex's to back away from. Under half health, or too hungry,
the gear counts for nothing: it is the one mob again. A skeleton the fight can't find a way to (up on a
ledge) is hidden from, as by an unarmed bot, and asked about again a few seconds later.

- It doesn't start on a mob with another one close by that hasn't picked a target yet: it soon will.
- It fights with the weapon carried that kills soonest on that edition (on Java a sword over an axe, which hits
  harder but swings almost half as often), and stops when the mob is gone, when the bot's health falls under
  6 (the mob reflex runs then), or after 30 s; a mob fought that long without finishing is left alone for a
  minute.
- Whether the mob can be walked to is the kept path verdict (below), not a new search each round.
- A creeper is never fought: the creeper reflex owns creepers.

**How it fights** (`melee.js`), as a player would:

- It swings when the weapon has recharged and the mob is in reach. On Java a swing before the attack meter
  is full does as little as a fifth of the damage; on Bedrock there is no meter, but a mob just hurt can't be
  hurt again for half a second. Reach is the game's: 3 blocks from the eye to the nearest point of the mob.
- It turns to whichever mob is in reach when the one it was fighting isn't, and goes straight on to the next
  mob that has come for it (one it would fight, as above) instead of stopping in between.
- While the weapon recharges, with a second mob close or the target right on it, it steps back, so the mobs
  reach it one at a time. Never backwards into lava, fire or off a drop.
- It sprints straight at a mob on its own level when the ground between is open, safe and seen, and lets
  the pathfinder find the way otherwise. It doesn't follow a mob more than 12 blocks from where the fight
  began.
- It lets go of a mob it hasn't got closer to in 6 s, and of one its swings in reach don't make flinch (the
  red flash a player sees) for 4 s; either is left alone for a minute.
- With a shield, it stops behind it while an archer draws and the mob it fights is out of reach, and goes on
  once the arrow has landed ([The Shield](#the-shield)).
- It neither swings nor puts its weapon back in hand in the middle of a meal: a player can't, and it would cut
  the meal short.
- Everything it acts on is what the bot sees, through fair play's perception; with fair play off, what the
  server sends.

**Measured** in the fight arenas (`tests/live/fight_arena.js` and `bedrock_fight_arena.js`): seven rounds, from
one zombie to two zombies, a skeleton and a spider at once, three runs each, with the bot told to fight every
kind, against the fight it replaced (Mindcraft's, through its combat plugin). Each cell is the 21 rounds of a
kit: rounds won, then swings per kill, then the damage the bot took in a round on average.

| Kit | Java, before | Java, now | Bedrock, before | Bedrock, now |
|---|---|---|---|---|
| Bare hands | 9 won, 61 swings, 24 damage | 9 won, 44 swings, 16 damage | 7 won, 66 swings, 15 damage | 5 won, 47 swings, 14 damage |
| Stone sword | 19 won, 7.6 swings, 12 damage | 21 won, 4.5 swings, 4 damage | 16 won, 5.8 swings, 9 damage | 21 won, 3.9 swings, 2 damage |
| Copper sword | 17 won, 14 swings, 14 damage | 21 won, 4.4 swings, 4 damage | not run | 20 won, 3.8 swings, 2 damage |
| Iron sword and armor | 21 won, 6.0 swings, 4 damage | 21 won, 3.8 swings, 2 damage | not run | 21 won, 3.0 swings, 0.4 damage |

On Java almost every swing now lands (99 in 100, from about half). Bare hands lose most rounds either way,
which is why the bot's own judgment takes on one mob without a weapon.

Those numbers were taken seeing all around and turning at once. **Through a player's screen and turning at a
controller player's speed**, strict's defaults from 1.12.0-bedrock.1.13.0, the same arenas gave (rounds won of 21, swings per
kill, average damage a round; with instant turns through the same screen after the slash):

| Kit | Java | Bedrock |
|---|---|---|
| Bare hands | 13 won, 39 swings, 20 damage / 14, 37, 19 | 8 won, 43 swings, 13 damage / not finished (see below) |
| Stone sword | 20 won, 4.4 swings, 8 damage / 21, 4.5, 7 | 18 won, 4.0 swings, 5 damage / 20, 3.8, 5 |
| Copper sword | 21 won, 4.3 swings, 7 damage / 21, 4.5, 6 | 19 won, 3.9 swings, 5 damage / 20, 3.8, 6 |
| Iron sword and armor | 21 won, 3.9 swings, 3.5 damage / 21, 3.8, 2.4 | 21 won, 3.1 swings, 1.7 damage / 21, 3.1, 1.9 |

Turning at a player's speed costs little: a round lost here and there, a point of damage, the same time. What
costs more is the screen: a mob out of view isn't fought until the bot turns to it, so the bot takes a few
more hits than seeing all around, and the rounds lost are the mixed ones, four mobs coming from every side. The
Bedrock run of bare hands with instant turns stopped twice when a bot that died didn't come back. The Bedrock run of the old fight
stopped after two kits: a bot that died there didn't always come back (see [Known Gaps](bedrock.md#known-gaps)).

**With a shield** (the same arenas, three runs of each round, the bot told to fight every kind; median damage
the bot took in a round, without a shield, then with one):

| Kit | 1 skeleton | 2 skeletons | 2 zombies, a skeleton and a spider |
|---|---|---|---|
| Stone sword, Java | 4, then 0 | 8, then 4 | 16, then 6 |
| Iron sword and armor, Java | 1.9, then 0 | 3.8, then 3.3 | 7.7, then 1.9 |

Every round was won either way. The shield stopped 6 to 11 hits in a round wherever there were archers; rounds of
zombies and spiders didn't change. What it costs is time: the bot stands while it blocks, so a lone skeleton
took 6 s to beat instead of 3. Held up between swings as well, at a mob in reach, it saved nothing and cost a
little (a lone skeleton 4 damage, the mixed round 7 with a sword and 3.3 in iron), so it isn't. On Bedrock,
where no skeleton shows its bow drawn, a sword and a shield fought as a sword alone did. By its own judgment
a bot with a sword alone still backs away from two skeletons in the walled pen; with a shield as well it now
fights them (the gear table above).

It is registered under the same name and in the same place as Mindcraft's, so its switch, the profiles and the
actions that pause it by name (`goToPlayer`, `defendSelf`, `stay`) keep their meaning.

That is the bot's own judgment. A [standing order](#standing-orders) to fight a kind of mob widens it for
that kind: and with no orders in the profile, a bot armed with a sword or an axe fights zombies and spiders
however many come.

A mob the fight gives up on is left alone by the fight for a minute; for that minute an order to fight it no
longer holds, and the mob reflex deals with it as with any mob (cover from an archer, a retreat from a crowd).

**One owner per threat.** The mob reflex and the fight share claims: the one that takes a mob keeps it for
5 s, so they don't take turns over it, each stopping the other. A fight doesn't hold back a crowd retreat or
an urgent move (low health, a mob aiming); a retreat does hold back the fight from the mobs it ran from.

## The Shield

A shield the bot carries goes in its off-hand as a fight or a move away from danger starts, when the
off-hand is empty (whatever else is there was put there on purpose). Then it goes up:

| Where | When | Why |
|---|---|---|
| In the fight | An archer in view is drawing its bow at the bot, and the mob the bot fights is out of reach | A player closing on a skeleton blocks while the bow is drawn and runs in between |
| Backing out of an archer's range, with no cover near | The same. With a shield the bot backs out walking backwards, facing the archer, so the shield is on the right side and the bot sees the draw | Out in the open the bot outruns a skeleton's first shot and nothing needs blocking; where it can't get out of range, the shield stops the shots |
| Backing off from a lit creeper | The bot won't get past the blast's reach before the fuse runs out, or is stuck | A shield faced at a blast stops it |

Measured on real servers: cornered in a dead end by a lit creeper (on easy), the bot took no damage behind its
shield on either edition, against 3 without one; unarmed in a walled pen with a skeleton and no cover, it took
none from the skeleton with a shield, against 8 without. In the fight, see [Measured](#the-fight).

How it is held, as a player must:

- **Up only while the bot stands still.** The game slows a player with a shield up to a fifth of a walk, with
  no sprint and no swing. mineflayer's physics doesn't slow the bot, so it would walk behind its shield
  faster than any player can; it stands instead, and lowers the shield to move or to swing.
- **Up when the bow is drawn,** not while a skeleton holds its bow up, which it does all the while it has a
  target; and up until the arrow has landed, half a second after the draw ends.
- **Only when it covers every archer.** A shield covers the side it faces. With archers aiming from two
  sides, facing one turns the bot's back to the other, and it fights on unshielded instead.
- **Never against a witch:** its splash potions land round a shield.
- **One use at a time.** A shield, a meal and a bow hold the same button. The shield doesn't go up in the
  middle of a meal, and the eating reflex waits for it to come down.

What the bot goes by is what a player sees: a bow drawn, a creeper swelling and flashing, through fair
play's perception. On Bedrock the shield goes up by sneaking, as a Bedrock player raises it.

**On Bedrock, by the beat.** A Bedrock skeleton shows no bow drawn: nothing a Bedrock server sends about it
changes between its taking a target and each arrow. But it shoots on a fixed beat, every 3 s (2 s on hard),
and each shot twangs. So the bot does what a Bedrock player does: it hears each shot (fair play's hearing, a
direction and a rough distance), takes it as the skeleton it sees on that side, and holds the shield up from
just before the next shot is due until the arrow lands (`shot_beat.js`). The first arrow comes unwarned. It
does so backing out of a skeleton's range with no cover near: in a walled pen, an unarmed bot took 4 damage
from a skeleton with a shield, against 11 without. Measured live, the beat holds to within a tenth of a second.
A back-away that runs out of time ends just after a shot lands: ended with the shield up, or just before the
next shot, it would leave the shield down while the reflex decides again, and that arrow would get through.
The fight doesn't keep the beat: it mostly kills a skeleton
before its beat counts, and in the Bedrock arena keeping it blocked about an arrow a round and cost more than
that in time stood still (the mixed round, six runs each: 8.5 damage with it, 6.5 without, every round won).

## Standing Orders

A player who says "don't run from zombies, fight them" means it until they say otherwise. The model turns
that into one command, and from then on the reflexes do it the moment a zombie comes, without asking the
model again.

```
!setThreatRule("zombies", "fight", 0, 0)       fight zombies, down to half health
!setThreatRule("spiders", "flee", 0, 24)       back away from spiders, to 24 blocks
!setThreatRule("skeleton", "ignore", 12, 0)    ignore skeletons while health is 12 or more
!setThreatRule("zombies", "default", 0, 0)     clear the order: the bot's own judgment again
!threatRules                                   the orders in force
```

An order names a mob (`zombie`), a group, or `all`, every hostile mob but creepers. The most exact order
wins: a mob's own name, then its group, then `all`. The groups, with both editions' names for each mob:

| Group | Mobs |
|---|---|
| `zombies` | zombie, husk, drowned, zombie villager |
| `skeletons` | skeleton, stray, bogged |
| `spiders` | spider, cave spider |
| `creepers` | creeper |
| `endermen` | enderman |
| `illagers` | pillager, vindicator, evoker, illusioner, ravager |
| `witches` | witch |
| `slimes` | slime, magma cube |
| `piglins` | piglin, piglin brute, zombified piglin |
| `hoglins` | hoglin, zoglin |
| `guardians` | guardian, elder guardian |
| `nether` | blaze, ghast, wither skeleton |

| Order | What the bot does |
|---|---|
| `fight` | Fights it when it comes for the bot (a melee mob within 8 blocks that has picked a target or is within 5; one that shoots, aiming or with a target, within 16), the nearest first, however many there are and however strong. It counts toward no crowd and is never backed away from for being too strong. An archer is gone after instead of hidden from |
| `fight_when_armed` | The same while the bot carries a sword or an axe; unarmed, the bot's own judgment |
| `flee` | Backs away from it as soon as it comes, to the order's distance (16 blocks unless told), and never fights it |
| `ignore` | Neither fights it nor moves away from it: it is as if it weren't there. It still counts as what may have dealt a hit, so its hits don't send the bot away from "something it can't see" |

**Each order has a minimum health,** 6 to 20, half health unless told. Under it the order lapses, and the bot
goes by its own judgment again: a fight under orders stops, and two zombies are a crowd to back away from
once more. **Under 6 health the bot runs from every mob whatever the orders say**: no order reaches that.

**Creepers** take two orders, and the creeper reflex keeps backing off from a lit one either way:

- `fight`: a creeper seen within 6 blocks is met at once with a sprint-hit and a step back, as a following
  one is otherwise met only the second time. Only on Java Edition, with a weapon that kills it in 4 hits,
  and only once its fuse has run down. Unarmed, or on Bedrock, the order changes nothing.
- `flee`: a creeper seen within 8 blocks, or about to explode, or heard hissing, is left behind for good at
  once, to 22 blocks unless told, instead of backed off from and met again.

`ignore` is refused for creepers: a lit creeper is always backed off from. `!setMode("creeper_safety",
false)` is the way to stop that.

**Where orders come from.** A profile can give its own under `threat_rules`, as a stance or as the whole
order:

```json
"threat_rules": {
    "zombies": "fight",
    "spiders": { "stance": "flee", "distance": 24 },
    "skeletons": { "stance": "fight_when_armed", "min_health": 14 }
}
```

A profile with no `threat_rules` gets the built-in ones, `fight_when_armed` for the `zombies` group and for
the plain spider: unarmed trials showed a player beating one of them at a time, and a sword or an axe
is what lets the bot take on more. `"threat_rules": {}` has none. Orders given by command go on top of the
profile's and are kept in `bots/<name>/threat_rules.json`, so they outlast a restart; one cleared with
`default` stays cleared even when the profile gives it. Deleting that file goes back to the profile's.

When a move or a fight comes from an order, its line says so, so the model knows why the bot didn't run:

> Your previous action 'action:collectBlocks' was interrupted by self_defense: Fighting the zombie (west,
> very close), as I was told to.

## Never Looking an Enderman in the Eye

An enderman turns on a player who looks at its head, within an angle that narrows with distance (about 4
degrees at 10 blocks), and the bot looks around all the time: the idle look-around, a dash away from a
creeper, the pathfinder facing the way it walks. So every look the bot makes goes through a guard: a look
that would come within twice that angle of an enderman's eyes is lowered until it doesn't, and every other
look is left alone. Under fair play the endermen that count are those in a clear line from the bot's eye,
whichever way it faces: with a narrowed field of view, one behind the bot is off screen until it turns, but a
look that would stare at it puts its eyes in the middle of the screen, so the bot sees it the moment it
looks. One behind a wall can't see the bot stare, and doesn't count. On a real server an unguarded look at an enderman's head angered it in about a
third of a second; with the guard it never did.

## The Glance

Through a player's screen (fair play's narrowed field of view) what is behind the bot reaches it as a sound
or a hit, as it does a player, and a player turns to look. So the bot turns its head for about a second
toward a hit from something it can't see, a hostile mob heard close by and not seen (not a creeper's hiss, which the creeper reflex answers by running), a shot heard from any
distance, and back the way it came when a back-off from a creeper or a mob ends (the threat is behind it
then, and a player looks back to see whether it follows). The turn is an ordinary look: paced, kept off an
enderman's eyes, and seen by perception and world memory. The idle look-around gives way while it lasts.

- **Looked once, remembered.** A miner hears zombies groan on the far side of a wall, looks once, sees rock,
  and stops looking. A glance at a sound leaves a note of what it was, which way, how far it sounded and where
  the bot stood, and the same sound from the same way doesn't turn the bot again while the note holds: a
  minute and a half, until the bot moves four blocks, until the sound comes closer or from another way, and
  never past a hit.
- **Not away from a mob in front.** While a hostile mob is in view nearby, a sound waits: turning to it would
  turn that mob off the screen, and the reflexes judge by what is in view. A hit or a shot doesn't wait.
- **Busy too, at a break in the work.** Not while the bot walks (the walk steers the head, and turning it
  would turn the walk) or while a reflex moves it. A sound waits for a block being dug to break, and is let go
  after three seconds; a hit or a shot doesn't wait.
- **A hit from another side, in a fight.** A hit is put down to a mob in view only when it came from that
  mob's side (within 60 degrees). Fighting a zombie in front, hit from behind by another, the bot turns to
  look, and the fight stands still for that moment, neither turning back nor swinging. Then the mob reflex
  sees two and backs away. Before, every hit counted as the first zombie's while it was in reach: in the
  Bedrock arena the bot fought one for 15 s while the other hit it from behind, and backed away only when
  that one came into view. With the look it backed away about half a second after the first hit from behind.
- **Seeing all around,** there is nothing to turn for, and the glance does nothing.

## Danger Zones

A player who saw pillagers by a tower walks round it the next time, and doesn't walk back into the spot a
skeleton kept shooting from. The reflexes deal with a danger while it is in front of the bot; danger zones
are the memory of where it was. Each is a place, round seen from above, that the bot's routes pay to go
into, and that it forgets after a while:

| What the bot met | Where the zone is | How wide | Kept for |
|---|---|---|---|
| A pillager, vindicator, evoker, illusioner or ravager in view | Where it stood | 32 blocks | 20 minutes |
| A mob in view aiming at the bot, within 16 blocks | Where the mob stood | 12 blocks | 5 minutes |
| An explosion heard | Where hearing places it: its direction and the middle of its distance band | 8 blocks, and as much more as the sound may have been off | 5 minutes |
| Hits from something it couldn't see (the mob reflex's rule 5) | Where the bot stood | 6 blocks | 5 minutes |

The same danger again keeps its zone longer instead of adding a second one, so illagers that stay in view
keep theirs as long as they do. Only what the bot saw, heard or felt makes a zone: a stand-in where a mob was
last seen is not a sighting. They are looked for once a second, apart from the reflexes, so turning a reflex
off with `!setMode` stops the bot reacting, not remembering. Another dimension forgets them all; a respawn
doesn't.

**What a zone does to a walk.** Every route the bot plans, by any skill, command or piece of generated code,
pays for each step that goes deeper into a zone: a zone of illagers costs as much as 64 blocks of walking at
its middle, falling evenly to nothing at its edge. Steps that keep level or lead out pay nothing. So:

- a walk bends round a zone when going round costs less than going in, and cuts across its edge when that
  is cheaper;
- a bot inside a zone always walks straight out, at the price of plain ground;
- a goal inside a zone is still reached, from its cheapest side. Zones bend routes, they never forbid one;
- a way the bot walked before that leads into a zone is left for a route that goes round (world memory's
  trail would otherwise walk it straight back in).

On a real server, a walk of 72 blocks across a flat arena went straight through where two illagers had
stood when there was no zone; with their zone it went round, never nearer than 31.8 blocks, and took 1.6
times as long. From the middle of the zone the bot walked straight out.

**The model** isn't interrupted for a zone. The behavior log says once when illagers were seen ("Saw a
pillager (east, far); keeping away from there for a while."), so the model knows why the bot's walks go
round that way; the other zones come with a reflex's own line already.

## What They Know, and How

The reflexes see through world.js like every other reflex: what is in view under fair play, everything the
server tracks without it.

- **Sight:** the mobs world.js hands out. Whether a creeper is lit, whether a mob is aiming, whether it is
  about to shoot, and whether it has picked a target are asked of the [edition seam](edition-seam.md)
  (`isFusing`, `isAiming`, `isDrawing`, `isAggressive`): a player sees a creeper swell and flash, a bow
  raised, a bow drawn, arms out. A mob that just slipped
  out of view is handed out as a stand-in where it was last seen; nothing is read from it, it is only a place
  to keep away from.
- **Touch:** each hit on the bot, and the side it came from, from the edition seam (`onHurt`). A player's
  screen tilts toward a hit; it isn't told who hit it, and neither is the bot.
- **Hearing** (fair play only): a creeper's hiss or an explosion, as hearing reports it, a direction and a
  distance band, never coordinates. Where a position is needed, it is rebuilt from the direction and the
  middle of the band, and a back-off from it goes farther by how much nearer the sound may have been.
- **The fuse estimate:** for each creeper, how far its fuse has burned, from 0 to 30 ticks. It rises a tick
  per tick while the creeper is seen lit, and falls while it is seen out. Out of view and within 7 blocks of
  the bot, a creeper that was lit is taken to keep burning; past 7, to run down.
- **A hiss is remembered,** not just for 1.5 s: a creeper that half went out and lit again makes no new
  hiss. It is settled when the creeper is seen with its fuse out, when the bot has been away long enough for
  any fuse to run down, or after 10 s with nothing new. When the creeper that hissed comes into view, its
  entry carries over, and a back-off that started on the sound follows the creeper seen.
- **Leaving through a player's screen,** the bot runs facing away, so it can't see whether the creeper has
  lost it. It goes by distance, taking the creeper to come on at a walk while out of view, and looks back
  when it stops.
- **A creeper that went off is forgotten:** one lit near where a blast was heard; one last seen lit when the
  bot can see where it stood and it isn't there (a swelling creeper stands still, so it hasn't stepped
  aside); and one out of view whose fuse has run out by now, when a hit comes from its side: the blast. A
  silent creeper's blast makes no sound, so only the eyes and the body can tell.
- **Cover** is only cover where the bot has seen the wall: a cell it never saw counts as open.
- **Where to step** (a dash, a cover spot, a step back in a fight) is judged by what the bot knows: ground in
  view, and ground and open space it has seen and remembers (world memory). Through a player's screen most
  of the ground round the bot is out of view at any moment; a cell never seen is not stepped into.
- **Danger zones** are noted from the same sight, hearing and touch, never from a stand-in out of view.

## Holding Other Work

Starting an action stops the one running, whoever asks. A lower reflex starting a fight, or a command from
the model to walk back to a player, would stop a back-off half way. So before either reflex starts a move, it
sets a **hold** (`src/agent/action_hold.js`, core hook 23):

- every reflex after it in the list is skipped, and one already part way through its round is turned down
  when it tries to start;
- a command from the model, the self-prompter, or the action the reflex interrupted coming back, **waits**
  for the move to end (or is turned down with the reason, if it was already in line when the hold began);
- the hold stays 1.5 s after the move, so whatever comes next doesn't walk straight back;
- it always ends, after 15 s at most, so a reflex that fails can't freeze the bot.

The errands held near a creeper use a hold of their own kind, renewed each round while the creeper is close,
that lets everything through but the errands, and never replaces a reflex's hold.

## Telling the Model

When a move interrupts what the bot was doing, the model gets one line saying why, for example:

> Your previous action 'action:goToPlayer' was interrupted by creeper_safety: A creeper hissed (east,
> close); backing off.

> Your previous action 'action:goToPosition' was interrupted by mob_safety: Two zombies are coming at me
> (north-east, close); backing away from them.

A creeper that keeps following brings the bot back to it several times: that is still **one message per
creeper**. A crowd that keeps following, or a skeleton that keeps finding the bot, is **one message a
minute**. So a night full of mobs doesn't flood the model.

## Path Searches Kept

Stock reflexes ask the pathfinder whether they can walk to the nearest mob or item every round (about every
300 ms), each a search of up to 100 ms, and get the same answer as last round. With the threat reflexes on,
the answer is kept for 3 s per mob or item, unless it or the bot moves 4 blocks (`path_verdicts.js`, core
hook 26). Standing by for 30 s next to an item it can't reach, the bot's reflexes made 9 path searches
instead of 100, and spent half a second on their rounds instead of four and a half.

## Known Limits

- **Bedrock Edition creepers** run on rules of their own, not measured yet (whether the fuse needs line of
  sight, at what distances). On Bedrock the creeper reflex backs off the same way, but finishes a following
  creeper only by leaving it, never by going back in to hit it.
- **A Bedrock server shows no mob's target or aim.** So on Bedrock a mob that always attacks players (a
  zombie, a skeleton) counts as having come for the bot as soon as it is in view, and an archer counts as
  aiming when it faces the bot. The crowd rule and the fight start a little sooner there than on Java, where
  the bot waits for the mob to show it.
- **The bot's own fight scope comes from the arena,** which measured one kit of armor (full iron) and up to
  three zombies, two skeletons, or four mobs mixed, on flat ground in a walled pen at night. More than that,
  other kinds of archer (a pillager, a witch), and other ground (a cave, a ledge) were not measured, so the
  bot backs away from them as before.
- **An order is about a kind of mob, not a place or a mob.** "Fight the zombie by the door" or "leave the
  pillagers at the outpost alone" can't be said as an order.
- **A fight under orders is still paused by the actions that pause `self_defense`** (`goToPlayer`,
  `defendSelf`, `stay`), as the bot's own fight is.
- **The fight has no bow.** It doesn't jump for critical hits either: whether they pay off in a fight against
  mobs is still to be measured.
- **A shield blocks only what the bot sees or hears coming.** On Bedrock no skeleton shows a bow drawn, so
  its first arrow is never blocked, and the rest only by the beat of its shots heard, which needs fair play's
  hearing: with fair play off, Bedrock arrows are not blocked. Nothing is blocked from a mob out of view, or between swings at a mob in reach (in the
  arena that saved nothing and cost a little: see "Measured"). Arrows from archers on two sides at once are not
  blocked at all.
- **Cover is only behind walls.** The bot doesn't build cover, and a skeleton that walks around the wall finds
  it again; the bot then picks another spot or backs out of range. A skeleton that comes up close is taken
  cover from, not fought.
- **Leaving needs room.** On a narrow ledge or in a tunnel the bot backs off as far as the way allows.
- **Danger zones are kept only while the bot runs.** They aren't saved with world memory, so a restart
  forgets them; illagers that are still there make a new one the moment they are seen.
- **A zone is a circle with a fixed size per kind.** It doesn't know the shape of an outpost or of the
  ravine a skeleton stood in, and a zone with its middle in a cave also prices the ground above it, as far
  up as its height (16 blocks for illagers, 8 or less for the others).
- **Explosions are heard only within fair play's hearing, 16 blocks**, though a player hears one from much
  farther. Without fair play there is no hearing, and no zone for an explosion.

## Code Layout

All in `src/agent/reflexes/`, behind `threat_reflexes`:

| File | What it does |
|---|---|
| `install.js` | Registers the creeper reflex right after `self_preservation`, the mob reflex right after it, and the fight in `self_defense`'s place (core hook 22, `registerMode`); connects fair play's hearing; keeps path verdicts; puts the gaze guard on the bot; sets up the standing orders and their commands |
| `creeper_reflex.js` | The creeper mode: each round it updates the picture, asks for a decision, and acts: hold, move, tell the model; and holds errands near a creeper |
| `picture.js` | The threat picture: creepers seen and heard, their fuse estimates, hisses remembered and settled. Pure |
| `decide.js` | `decideThreat`: what to do about the creepers in the picture. Pure, tested with plain objects |
| `mob_reflex.js` | The mob mode: each round it reads the mobs and the hits, asks for a decision, and acts as the creeper mode does |
| `fight_reflex.js` | The fight, `self_defense`: whom to fight, and when to stop |
| `melee.js` | How the fight fights: swings timed to the weapon, reach from the eye, turning to the mob in reach, stepping back between swings, letting go of a fight that isn't working |
| `mob_decide.js` | `decideMobThreat` and `chooseFight`: what to do about the other mobs, and which one to fight. Pure |
| `orders.js` | The standing orders: the groups, which order applies to a mob, when it lapses, the profile's and the built-in ones. Pure |
| `order_commands.js` | `!threatRules` and `!setThreatRule`, and the file the orders given by command are kept in |
| `mobs.js` | The hostile mobs around, read the fair way, with the tells the seam reads |
| `claims.js` | One owner per threat. Pure |
| `moves.js` | `backOffFrom`, `retreatFrom`, `hitAndStepBack` and `takeCover`, the safe first step, the line of sight over cells the bot knows, and the guard that stops a move behind the shield |
| `shield.js` | The shield: put in the off-hand, raised and lowered, and which mob a shot is coming from |
| `shot_beat.js` | The beat of an archer's shots heard, for a game that shows no bow drawn: when the next is due |
| `item_use.js` | One owner of the use-item channel the shield, eating and a bow share, and the eating plugin made to ask it |
| `gaze.js` | The guard on every look, for endermen, and on each step of a paced turn |
| `glance.js` | The glance: turning toward a hit, a sound or a shot from what the bot can't see, and the notes of what it looked at |
| `danger_zones.js` | The zones: where, how wide, for how long, and what a cell costs to be in. Pure |
| `danger_watch.js` | Notes zones from what the bot sees, hears and feels, once a second and as each sound arrives |

Outside the folder: `src/agent/action_hold.js` (the hold), `src/agent/library/path_verdicts.js` (the kept
path verdicts), `src/agent/library/place_costs.js` (the prices on places that every route search pays, which
other features can put prices on too), the `isFusing`, `isAiming`, `isAggressive`, `onHurt`, `meleeOf` and `survivalReach` questions in the edition seam, `isDrawing`, `shotBeatMs` and `raiseShield` for the shield, and
perception's `onHeard` listener (`src/agent/fairplay/perception.js`), which passes a sound on with what
`heard()` gives and never its position.

## Testing

`tests/reflexes_*.test.js` are the unit tests; `reflexes_place_costs.test.js` runs the real pathfinder's
search with zones, and `reflexes_orders.test.js` checks the standing orders and each decision under them. `tests/live/threat_scenarios.js` runs the creeper reflex
against a real server with no model behind it, and measures the time to the first step away, the distance at
the blast, damage, the rounds a following creeper takes, the messages to the model, and false alarms among
other mobs at night. `tests/live/mob_scenarios.js` does the same for the mob reflex, the fight and the gaze
guard, checks what the edition seam reads off the server, and counts the interruptions in a night full of
mobs and the path searches while standing by, against Mindcraft's own reflexes with `--stock`. Both, and
`bedrock_threats.js`, give the bot standing orders and check what they change: an armed bot fighting two
zombies, a zombie backed away from and a skeleton ignored or fought when told, a creeper met at once or
left at once.
`tests/live/danger_scenarios.js` checks the zones: a walk across an arena with no zone and with one where
illagers were seen, a walk out of the middle of one, and the zones a skeleton aiming and an explosion heard
leave (see the [README](../README.md#tests)).
`tests/live/fight_arena.js` measures how a fight goes once the bot has chosen one: rounds of zombies,
skeletons and spiders against kits from bare hands to iron, each run several times, with wins, time, damage
and swings per kill. It is a yardstick, run before and after a change to the fight.
