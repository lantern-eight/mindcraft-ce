# Mindcraft-CE: Fair-Play Integration Fork

An LLM-driven Minecraft player that plays by the rules a person does. It knows only what it could see,
hear or remember, reaches only as far as an arm does, and never runs a command.

This is an **integration fork** of [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce), built on
its `agent-system` branch. Mindcraft-CE stays the core. This fork adds its own modules around it and keeps
its edits to the core small, so upstream updates stay easy to merge and pieces of this work stay easy to
offer back.

**It plays Minecraft Java Edition, currently 26.3, and Bedrock Edition, currently 1.26.60.** The code for
both is on `main`. Bedrock Edition needs work in the libraries under the bot that isn't released yet, so
the `bedrock` branch is `main` with those libraries pinned, and set up for Bedrock out of the box: use
`main` for Java and `bedrock` for Bedrock. Bedrock support is experimental; [docs/bedrock.md](docs/bedrock.md)
says what works, what doesn't and how to try it.

> [!CAUTION]
> Do not connect this bot to public servers with coding enabled. With `allow_insecure_coding` on, a model
> writes code that runs on your computer. Code writing is off by default.

## At a Glance

| | |
|---|---|
| **What it is** | Mindcraft-CE's agent (native tool calling, optional Brain, Task and RP agents) with fair play added |
| **Fair play** | On by default. One setting, `fair_play: "off"`, gives stock Mindcraft-CE behavior back |
| **World memory** | On by default, with fair play. `world_memory: false` turns it off |
| **Chest sorting** | On by default. The bot tidies only chests it was approved to sort. `chest_sorting: false` turns it off |
| **Farming** | On by default. The bot tends a field: cuts what it sees is ripe, replants, sows, never tramples the farmland, and leaves other people's fields alone unless asked. `farming: false` turns it off |
| **Threat reflexes** | On by default. The bot backs off from a creeper about to explode, gets away from other mobs when it should, and remembers where it met danger to walk round it. A player can give it standing orders (fight zombies, run from spiders), which it follows at once from then on. `threat_reflexes: false` turns it off |
| **Minecraft** | **Java Edition 26.3**, through libraries pinned to unreleased branches until their releases support it ([list](docs/core-hooks.md#dependencies-pinned-to-a-branch)). Older versions may work with `minecraft_version: "auto"`, untested |
| **Bedrock Edition** | **Bedrock Edition 1.26.60** on the `bedrock` branch, and 1.26.61 to 1.26.63 work the same. Experimental: the bot joins, chats, runs the stock skills, and plays fairly with world memory and chest sorting; [what doesn't work yet](docs/bedrock.md#known-gaps). The code is on `main` too, behind `minecraft_edition`; the `bedrock` branch adds the libraries it needs |
| **Runs on** | Node 22 |
| **Status** | Experimental. The [changelog](CHANGELOG.md) has the current version, which has a part for each edition, and what changed |
| **License** | Inherited code is MIT. What this fork adds is CC0 (public domain). See [ATTRIBUTION.md](ATTRIBUTION.md) |

## Why Fair Play

A Minecraft bot is not a player. The server sends it every block in every loaded chunk, so it knows where
the diamonds are before it has dug anything. It can open a chest through a wall, and it can type commands.
A bot that uses all of that is not playing the same game as the people next to it.

With fair play on, the bot is held to what a survival player in its place could know and do:

- **It knows** what it touches, what a straight line from its eyes reaches, what it remembers seeing, and
  what it hears. Buried ore, a chest in a sealed room and a zombie behind a wall are unknown to it.
- **It finds its way** over ground it has seen. What it has not seen it takes for open ground, and looks
  when it gets there.
- **It does** what a player's hands can: reach is a survival player's reach, and the target has to be in
  view.
- **It never** runs a slash command, turns on cheat mode, or acts while it is an operator or outside
  survival mode.
- **Code the model writes** is handed a stand-in for the bot that follows the same rules.

Every rule has its own switch, so one "cheat" at a time can be turned on to measure what it is worth. The
full guide is [docs/fair-play.md](docs/fair-play.md).

## What This Fork Changes

Compared with Mindcraft-CE's `agent-system` branch, which it is built on:

| Area | Mindcraft-CE `agent-system` | This fork |
|---|---|---|
| Finding blocks and mobs | Searches every loaded block, through walls | Only what the bot touches, sees, remembers seeing, or hears |
| Memory of the world | Named places the model chooses to save | World memory: every block the bot has seen, what was in the chests it opened, places it found, and a note when a place has changed, per world. The model asks with `!recall` and `!places`. See [docs/world-memory.md](docs/world-memory.md) |
| Travel | Every walk is planned afresh, and digs towards the target when no path is found | A trip to somewhere the bot has been follows the way it walked, in hops that neither dig nor place |
| Route planning | The pathfinder plans over every loaded block, seen or not | It plans over what the bot has seen, takes what it has not seen for open ground, and plans again as the way ahead comes into view |
| Chests | Looks in, takes from or puts into the nearest chest | Can be told which chest. Also sorts them: one instruction merges part stacks and puts each kind of item together. The bot keeps whose each chest is, sorts only what was approved, and never mixes two owners' things. See [docs/chest-sorting.md](docs/chest-sorting.md) |
| Farming | `tillAndSow` in generated code; `!collectBlocks` breaks any wheat it finds, ripe or not | `!tendField` cuts only crops it sees are ripe, replants and sows, never jumps onto the farmland, and keeps whose each field is. See [docs/farming.md](docs/farming.md) |
| Reach | The server's distance check | A survival player's reach, and the target must be in view |
| Commands and cheat mode | Available to the model and to players in chat | Cheat mode stays off, slash commands are dropped, and the bot refuses to act as an operator or outside survival |
| Model-written code | Handed the real bot | Handed a stand-in that can only do what a player could |
| Hearing | Not used | Sounds from sources the bot can't see are reported with a direction, never coordinates. A creeper's hiss sets off the creeper reflex at once |
| Creepers | A creeper is one more hostile: nothing knows when it is lit, other actions pause the reflexes that would flee or fight it, and fighting follows it into melee range | A creeper reflex that no action pauses backs off from one about to explode, and finishes one that keeps following, by a hit and a step back or by leaving it behind. Where the bot met illagers, an archer or an explosion, its walks go round for a while. See [docs/threat-reflexes.md](docs/threat-reflexes.md) |
| "Not found" | Means there is none nearby | Means the bot hasn't seen any, and the model is told so |
| Tests | 109 offline tests | 810 offline tests, plus live scenarios on a real server that make no model calls |
| Game editions | Java Edition only, its data and packets read where they are needed | One copy of fair play, world memory and chest sorting for Java and Bedrock: what differs by edition is asked of an edition seam. See [Built for Two Editions](#built-for-two-editions) |
| Fixes | | Fixes to inherited code, each listed in the [changelog](CHANGELOG.md) |

**Not built yet:** good-neighbor rules (don't break other players' builds, loot their chests or hurt their
animals). The guide lists every [known limit](docs/fair-play.md#known-limits).

## Built for Two Editions

Minecraft's Java and Bedrock editions speak different protocols, and Mindcraft-CE plays Java only. This
fork's features read the game below mineflayer's `bot`: how block states are numbered, what a chunk
section holds, which packets carry a sound, what a chest or a sign keeps in its block entity. Each edition
shapes those its own way.

So instead of a copy of each feature per edition, the features ask an **edition seam**
(`src/agent/edition/`): a short list of questions such as "what does this sign say?" or "where is the
other half of this double chest?", answered once for each edition. Both sets of answers are on
`main`, so the same fair play, world memory and chest sorting run on either edition, and a new feature
needs only the seam's answers for Bedrock to work there too. [docs/edition-seam.md](docs/edition-seam.md) lists every question with each edition's
answer, and says when new code must go through it.

## Quick Start

1. Install [Node.js 22](https://nodejs.org/) (`nvm use` picks the right version) and have
   [Minecraft Java Edition](https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc)
   26.3.
2. Clone this repository and run `npm install` in it. For Bedrock Edition, check out the `bedrock` branch
   first and run `SKIP_BUILD=1 npm install`: the variable skips a build that needs CMake and that the bot
   does not need. [docs/bedrock.md](docs/bedrock.md#trying-it) has the rest of the Bedrock setup.
3. Copy `keys.example.json` to `keys.json` and fill in what your model provider needs. Choose the model in
   `andy.json` or another profile. The default profile and local providers need no paid key.
4. Start a Minecraft Java server, or open a world to LAN. Set `host`, `port` and `auth` in `settings.js` to
   match it.
5. Run `node main.js`.

Model providers, profiles, online servers, Docker and the rest are covered in
[docs/setup.md](docs/setup.md).

## Fair-Play Settings

In `settings.js`:

```javascript
"fair_play": "strict",      // "strict" = every rule on, "custom" = strict loosened below, "off" = stock behavior
"fair_play_custom": {
    // "ores_through_walls": true,   // one rule turned off, to measure what x-ray is worth
},
"world_memory": true,       // what the bot has seen, chests, places and the ways it walked; false turns it off
"chest_sorting": true,      // one instruction tidies a player's chests; false leaves the commands out
```

For fair play to mean anything the bot must not be a server operator, and under `strict` it stops and says
so if it is made one. A server can add its own protection, such as Paper's anti-xray, but the bot's rules
hold without it. See [Turning It On](docs/fair-play.md#turning-it-on) and
[The Switches](docs/fair-play.md#the-switches).

## Tests

```bash
npm test
```

runs the offline tests. They need no server and no model.

The scripts in `tests/live/` start a throwaway Minecraft server, build each scene from the server console,
and check the bot against it. They make no model calls. They need Java 25 and a Minecraft 26.3 server jar:

```bash
export MC_TEST_JAVA=/path/to/java
export MC_TEST_SERVER_JAR=/path/to/server.jar
node tests/live/fairplay_scenarios.js
```

| Script | What it checks |
|---|---|
| `fairplay_perception_smoke.js` | Fair play's sight and hearing on real chunks, packets and sounds |
| `fairplay_scenarios.js` | Fair play as a whole, as the agent runs it (`--no-world-memory` for the path without memory) |
| `memory_scenarios.js` | World memory: what the bot is told it saw, and what changed while it was away (one step waits a minute) |
| `navigator_scenarios.js` | Travel back along the trail the bot walked |
| `legs_scenarios.js` | Route planning over only what the bot has seen |
| `narrow_view_scenarios.js` | A player's field of view (`fov_degrees` 70): what is behind the bot unknown to perception and memory until it turns, turning to dig, open and build against a block behind it, refused behind a wall, and turning round toward an enderman without staring |
| `look_first_scenarios.js` | Skills given a spot by its coordinates look before they decide; `digDown`'s staircase; `goToSurface` |
| `travel_scenarios.js` | Ordinary travel and picking items up, with fair play off |
| `turning_scenarios.js` | Work that turns a lot, timed at the bot's turning speed: gathering from a tree ahead, one behind and a boulder beside, a bridge one block wide, a ladder, and a gap to jump; a fall or a stall fails it |
| `mining_scenarios.js` | Mining and digging |
| `villager_scenarios.js` | A villager's job, level and age, as a real server sends them |
| `threat_scenarios.js` | The creeper reflex: how fast it steps away from a creeper seen lit or only heard, how far off it is at the blast, a following creeper finished or left behind, standing orders to fight or flee creepers, a bot cornered by a lit creeper with a shield and without, and no false alarms among other mobs (`--runs=` sets the timing runs, 5 by default) |
| `mob_scenarios.js` | The mob reflex, the fight and the enderman gaze guard: what the edition seam reads off a real server (a mob's target and aim, a hit's side), backing away from two zombies, cover from a skeleton, a skeleton in a pen with no cover with a shield and without, hits from something unseen, running at low health, a lone zombie fought, standing orders (an armed bot fighting two zombies, backing away from a zombie when told, ignoring or fighting a skeleton when told), an enderman never stared at, how often a night full of mobs interrupts the bot, and how many path searches the reflexes ask for standing by (`--stock` runs the last two with Mindcraft's own reflexes, to compare) |
| `danger_scenarios.js` | Danger zones: a walk across an arena going round where illagers were seen, against the same walk with no zone; a walk out of the middle of a zone; the zones a skeleton aiming and an explosion heard leave |
| `fight_arena.js` | How well the bot fights, measured rather than checked: rounds of zombies, skeletons and spiders against kits from bare hands to iron and shield, each run several times, recording wins, time, damage, swings, swings per kill and hits the shield stopped (`--runs`, `--only`, `--kit`, `--fair=off`, `--orders=none`, `--shield=between`, `--out`). A yardstick for changes to how the bot fights; `arena_meter.js` holds the measures it shares with its Bedrock twin, `bedrock_fight_arena.js` |
| `storage_scenarios.js` | Chest sorting, and whose chests may be sorted |
| `farming_scenarios.js` | Tending a field: only ripe crops cut, every cell replanted, nothing trampled, a field behind the bot found by looking, a stranger's field left alone |
| `storage_agent_scenarios.js` | The whole agent, told about chests in plain words |
| `agent_scenarios.js`, `narration_scenarios.js` | The whole agent and its automatic behaviours |

The scripts that run fair play use strict's view, a player's screen. `MC_TEST_VIEW=all` (or `--view=all`)
runs them seeing all around instead, which tells a failure that comes from the view apart from one in what
the scene is about; a release runs them both ways. `narrow_view_scenarios.js` is about the view itself and
always uses the screen. `java_all.js` runs every script here both ways, one after another, with a line for each
and a log in a folder of its own (`--views=narrow` or `--views=all` for one way, `--only=` for some scripts).
`MC_TEST_TURN=instant` (or `--turn=instant`) has the bot turn its head at once, as mineflayer does, instead of
at strict's speed, to measure what a player's turning costs a scene; the fight arena takes both switches too.

The last three replay recorded model replies, so they cost nothing; `--live-model` makes them call the
configured model instead. Each run leaves its server's folder under `server_data/`, which can be deleted.

`fairplay_perception_bench.js` times fair play's perception rather than checking it, once per release. It
makes a world of normal terrain from a fixed seed, takes each timing five times, and compares the middle
values with the last release's, kept in `tests/live/perception_bench_results.json` under the seed and game
version they were measured on (one seed makes different land in different game versions). It fails if a fair
timing is more than 1.5 times its last value plus 3 ms; `--record` saves the result for the version in
`package.json`. Its plain timings are taken seeing all around, as releases before the narrow view were; those
named `narrow_` use strict's own view, and `narrow_turning_logs64_8turns` times a search after each of eight
turns round the circle. Timings depend on the computer, so compare releases measured on the same one:
mineflayer's own searches are timed alongside as a yardstick.

What the server jar unpacks on its first start (and for Paper, downloads and patches) is kept in
`server_data/jar-cache` and shared by every run after. `MC_TEST_JAR_CACHE` picks another folder; `off` gives
each server its own copy again. Run the live scripts one at a time: they share a port and that folder.

Each run's world goes in a new folder under `server_data`, and the next run clears away those over an hour old
(`tests/helpers/test_worlds.js`), except ones holding a model run's results. `MC_TEST_KEEP_WORLDS=1` keeps them
all, to look into a world after a run.

## Documentation

| Page | What it covers |
|---|---|
| [docs/fair-play.md](docs/fair-play.md) | What fair play does, every switch, known limits, and the code layout |
| [docs/world-memory.md](docs/world-memory.md) | What the bot remembers with world memory on, what the model can ask, and how changes are noticed |
| [docs/chest-sorting.md](docs/chest-sorting.md) | Whose chests the bot sorts, what a sort does, what the model can ask, and what happens when things go wrong |
| [docs/farming.md](docs/farming.md) | What a round of tending a field does, whose fields the bot tends, and what the model can ask |
| [docs/threat-reflexes.md](docs/threat-reflexes.md) | The threat reflexes: when the bot backs off from a creeper or other mobs, when it fights, what it knows, how it holds other work, and the danger zones its walks go round |
| [docs/edition-seam.md](docs/edition-seam.md) | What differs between Java and Bedrock below mineflayer, the one place this fork asks about it, and how to add a question |
| [docs/setup.md](docs/setup.md) | Setup and configuration: providers, profiles, servers, Docker (inherited from Mindcraft-CE) |
| [docs/agent-system.md](docs/agent-system.md) | Native tools and the Brain, Task and RP agents (inherited) |
| [docs/bedrock.md](docs/bedrock.md) | Bedrock Edition: what works, what doesn't, how to try it and how to test it |
| [docs/core-hooks.md](docs/core-hooks.md) | Every edit this fork makes to an inherited file, and why |
| [docs/FAQ.md](docs/FAQ.md) | Common problems (inherited) |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version, for both editions. On the `bedrock` branch, `CHANGELOG-bedrock.md` adds what its library pins changed |
| [ATTRIBUTION.md](ATTRIBUTION.md) | Credits, and which license covers which files |

## Where It Came From

This fork stands on other people's work, and most of the code here is theirs.

- **[Mindcraft](https://github.com/mindcraft-bots/mindcraft)** is the original project: an LLM agent that
  plays Minecraft through [Mineflayer](https://github.com/PrismarineJS/mineflayer), by
  [@kolbytn](https://github.com/kolbytn), [@MaxRobinsonTheGreat](https://github.com/MaxRobinsonTheGreat),
  [@icwhite](https://github.com/icwhite), [@Ninot1Quyi](https://github.com/Ninot1Quyi) and its
  contributors. It is described in the paper
  [Collaborating Action by Action: A Multi-agent LLM Framework for Embodied Reasoning](https://arxiv.org/abs/2504.17950).
- **[Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce)** is the community edition, by
  [@Sweaterdog](https://github.com/Sweaterdog), [@riqvip](https://github.com/riqvip),
  [@uukelele](https://github.com/uukelele), [@mrelmida](https://github.com/mrelmida) and its contributors.
  Its **`agent-system`** branch, the base of this fork, adds native tool calling, the Brain, Task and RP
  agents, tool narration and model routing.
- **[Mineflayer](https://github.com/PrismarineJS/mineflayer)** and the PrismarineJS libraries speak the
  Minecraft protocol. This fork does not patch them.

What this fork adds on top is fair play (`src/agent/fairplay/`), world memory (`src/agent/memory/`), their
tests, and the fixes in the changelog.

If you use Mindcraft in research, please cite the original paper:

```
@article{mindcraft2025,
  title = {Collaborating Action by Action: A Multi-agent LLM Framework for Embodied Reasoning},
  author = {White*, Isadora and Nottingham*, Kolby and Maniar, Ayush and Robinson, Max and Lillemark, Hansen and Maheshwari, Mehul and Qin, Lianhui and Ammanabrolu, Prithviraj},
  journal = {arXiv preprint arXiv:2504.17950},
  year = {2025},
  url = {https://arxiv.org/abs/2504.17950},
}
```

## Staying in Step With Upstream

`main` is Mindcraft-CE's `agent-system` branch plus this fork's work, so an upstream update comes in by
merge:

```bash
git fetch upstream
git merge upstream/agent-system
npm install && npm test
```

The merge is the easy part. What to expect, and what to do after it:

| What upstream changed | What happens | What to do |
|---|---|---|
| `README.md` | A conflict every time, because this fork's is rewritten | Keep this one. Copy anything useful from theirs into [docs/setup.md](docs/setup.md) |
| A file this fork hooks | Usually merges by itself. Now and then, a conflict at the hook | Fix it by hand. [docs/core-hooks.md](docs/core-hooks.md) lists every hook and why it is there |
| New code that searches the bot directly | Merges cleanly | A lint test fails and names the line. Send the search through `world.js` |
| Code this fork has replaced | Merges cleanly, the tests pass, and **their change does nothing here** | Read their change and carry it over by hand. The same page lists the replaced pieces |

The first three announce themselves. The last one is silent, so the list of replaced pieces is worth
reading against upstream's changes after every merge. This fork keeps that list short by putting its own
version of something in its own module and leaving a small hook in the inherited file.

Code from other forks can't come in by merge, because their history doesn't line up with this one. It is
ported by hand, after checking its license, and credited in [ATTRIBUTION.md](ATTRIBUTION.md).

## Contributing

This is a personal project, and it isn't set up to take contributions. There are two better homes for
your work:

- **Fork it.** Everything this fork adds is in the public domain, so take it and make it yours.
- **Contribute to [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce)**, the community edition
  this is built on. A fix or a feature there reaches everyone, this fork included.

Fixes this fork makes to inherited code are kept in their own commits, so they can be offered to
Mindcraft-CE one at a time. [docs/upstream.md](docs/upstream.md) lists those offered so far, to Mindcraft-CE and to
the libraries. [CLAUDE.md](CLAUDE.md) holds the working rules used here, if you want the same
approach in your fork.

## License

Two licenses apply, to different parts:

- **Code inherited from Mindcraft and Mindcraft-CE** is under the [MIT License](LICENSE).
- **What this fork adds** is dedicated to the public domain under [CC0 1.0](LICENSE-CC0). Take it, change
  it, ship it, with no conditions.

[ATTRIBUTION.md](ATTRIBUTION.md) says which files are which, and credits the projects and ideas this fork
builds on.
