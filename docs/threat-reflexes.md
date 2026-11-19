# Threat Reflexes

The threat reflexes keep the bot alive when something dangerous turns up in the middle of whatever it is
doing, without waiting for the model. Today there is one: **the creeper reflex**, `creeper_safety`. It backs
the bot off from a creeper about to explode, and deals with one that keeps following it.

- [Turning It On](#turning-it-on)
- [Why a Reflex of Its Own](#why-a-reflex-of-its-own)
- [What the Creeper Reflex Does](#what-the-creeper-reflex-does)
- [What It Knows, and How](#what-it-knows-and-how)
- [Holding Other Work](#holding-other-work)
- [Telling the Model](#telling-the-model)
- [Known Limits](#known-limits)
- [Code Layout](#code-layout)
- [Testing](#testing)

## Turning It On

In `settings.js`:

```js
"threat_reflexes": true,   // this fork's default; false leaves the reflex out
```

The reflex is a mode like Mindcraft's own, so it can also be switched for one bot: `!setMode("creeper_safety",
false)`, or `"creeper_safety": false` in a profile's `modes`. It works with fair play on or off.

## Why a Reflex of Its Own

In stock Mindcraft a creeper is just another hostile mob, and the two reflexes that deal with hostiles
handle it badly:

- **Nothing knows when a creeper is lit.** A creeper 5 blocks away about to explode looks the same as one
  wandering past.
- **Actions pause the reflexes until the bot is idle.** Walking to a player pauses `cowardice` and
  `self_defense`, and so does a fight; `!stay` pauses almost everything. A lit creeper was ignored all that
  time.
- **`cowardice` is off in every default profile,** and `self_defense` walked the bot up to the creeper and
  fought it in melee range, which is where the blast is.

So the creeper reflex sits right after `self_preservation` in the list of modes, and nothing pauses it by
name. It answers only to its own switch, not to `cowardice`: stepping out of a blast is self-preservation,
like stepping out of lava. `self_defense` and `defendSelf` leave creepers to it.

## What the Creeper Reflex Does

It follows how the game behaves (Java Edition): a creeper lights its fuse when its target is within 3
blocks; the fuse burns while the target stays within 7 blocks and in its sight, and runs back down a tick at
a time otherwise; it explodes after 1.5 s; and once its fuse is out it chases again, while the target is
within 16 blocks and in its sight.

| What | What the bot does |
|---|---|
| A creeper seen lit within 7 blocks, or its hiss heard close | **Backs off:** sprints straight away until it is 8 blocks off (farther for one only heard, whose distance is rough) |
| A creeper within 3 blocks, not lit yet | Backs off before it lights |
| An explosion heard very close | Backs off from it: another may follow |
| The same creeper coming again after a back-off (it is following) | **Finishes it.** With a weapon that kills it in 4 hits or fewer and half its health or more, the bot sprint-hits it, which knocks it back, and steps back past its range; it goes back in only once the creeper's fuse has run down. Otherwise it **leaves**: 22 blocks off, well past the 16 a creeper follows, or until the creeper has been out of view for 2 s |
| A creeper well above a bot that is underground | Only watched: it can't reach the bot |
| A creeper dying | Nothing: it can't explode any more |
| In creative or spectator mode | Nothing: the bot takes no damage |

**The first step doesn't wait for a path search.** If the ground straight away from the creeper is open and
safe, the bot sprints that way at once, and keeps going while it stays safe; where it isn't, the pathfinder
takes over. Choosing the way is a decision, so it reads blocks through world.js, which under fair play means
what the bot has seen. It never steps into lava or fire or off a drop of more than 2 blocks, and the
pathfinder's part of the escape is held to the same drop. Nothing it does pauses `self_preservation`.

**It reacts to a hiss the moment it is heard.** The reflexes run every 300 ms or so, and a fuse is 1.5 s, so
the reflex doesn't wait for its next round when a hiss arrives.

## What It Knows, and How

The reflex keeps a **threat picture**: an entry per creeper, from what the bot sees and hears.

- **Sight:** the creepers world.js hands out. Under fair play those are only the ones in view. Whether one is
  lit is asked of the [edition seam](edition-seam.md) (`isFusing`): a player sees a creeper swell and flash.
  A creeper that just slipped out of view is handed out as a stand-in where it was last seen; the reflex
  doesn't read its fuse from that, it estimates it.
- **Hearing** (fair play only): a hiss or an explosion, as hearing reports it, a direction and a distance
  band, never coordinates. Where a position is needed, it is rebuilt from the direction and the middle of
  the band, and a back-off from it goes farther by how much nearer the sound may have been.
- **The fuse estimate:** for each creeper, how far its fuse has burned, from 0 to 30 ticks. It rises a tick
  per tick while the creeper is seen lit, and falls while it is seen out. Out of view and within 7 blocks of
  the bot, a creeper that was lit is taken to keep burning; past 7, to run down.
- **A hiss is remembered,** not just for 1.5 s: a creeper that half went out and lit again makes no new
  hiss. It is settled when the creeper is seen with its fuse out, when the bot has been away long enough for
  any fuse to run down, or after 10 s with nothing new. When the creeper that hissed comes into view, its
  entry carries over, and a back-off that started on the sound follows the creeper seen.

## Holding Other Work

Starting an action stops the one running, whoever asks. A lower reflex starting a fight, or a command from
the model to walk back to a player, would stop a back-off half way. So before the reflex starts a move, it
sets a **hold** (`src/agent/action_hold.js`, core hook 23):

- every reflex after it in the list is skipped, and one already part way through its round is turned down
  when it tries to start;
- a command from the model, the self-prompter, or the action the reflex interrupted coming back, **waits**
  for the move to end (or is turned down with the reason, if it was already in line when the hold began);
- the hold stays 1.5 s after the move, so whatever comes next doesn't walk straight back;
- it always ends, after 15 s at most, so a reflex that fails can't freeze the bot.

## Telling the Model

When a move interrupts what the bot was doing, the model gets one line saying why, for example:

> Your previous action 'action:goToPlayer' was interrupted by creeper_safety: A creeper hissed (east,
> close); backing off.

A creeper that keeps following brings the bot back to it several times. That is still **one message per
creeper**, so the model isn't flooded.

## Known Limits

- **Bedrock Edition creepers** run on rules of their own, not measured yet (whether the fuse needs line of
  sight, at what distances). On Bedrock the reflex backs off the same way, but finishes a following creeper
  only by leaving it, never by going back in to hit it.
- **Only creepers.** Other hostile mobs are still `cowardice` and `self_defense`'s, as in Mindcraft.
- **Leaving needs room.** On a narrow ledge or in a tunnel the bot backs off as far as the way allows.
- **The fight scope is fixed:** 4 hits and half health. It can't yet be widened or narrowed by a player.

## Code Layout

All in `src/agent/reflexes/`, behind `threat_reflexes`:

| File | What it does |
|---|---|
| `install.js` | Registers the reflex right after `self_preservation` (core hook 22, `registerMode`), and connects fair play's hearing to it |
| `creeper_reflex.js` | The mode: each round it updates the picture, asks for a decision, and acts: hold, move, tell the model |
| `picture.js` | The threat picture: creepers seen and heard, their fuse estimates, hisses remembered and settled. Pure |
| `decide.js` | `decideThreat`: what to do about the creepers in the picture. Pure, tested with plain objects |
| `moves.js` | `backOffFrom` and `hitAndStepBack`, and the safe first step |

Outside the folder: `src/agent/action_hold.js` (the hold), the `isFusing` question in the edition seam, and
perception's `onHeard` listener (`src/agent/fairplay/perception.js`), which passes a sound on with what
`heard()` gives and never its position.

## Testing

`tests/reflexes_*.test.js` are the unit tests. `tests/live/threat_scenarios.js` runs the reflex against a
real server with no model behind it, and measures the time to the first step away, the distance at the
blast, damage, the rounds a following creeper takes, the messages to the model, and false alarms among other
mobs at night (see the [README](../README.md#tests)).
