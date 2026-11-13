# Mindcraft-CE: Fair-Play Integration Fork

An LLM-driven Minecraft player that plays by the rules a person does. It knows only what it could see,
hear or remember, reaches only as far as an arm does, and never runs a command.

This is an **integration fork** of [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce), built on
its `agent-system` branch. Mindcraft-CE stays the core. This fork adds its own modules around it and keeps
its edits to the core small, so upstream updates stay easy to merge and pieces of this work stay easy to
offer back.

> [!CAUTION]
> Do not connect this bot to public servers with coding enabled. With `allow_insecure_coding` on, a model
> writes code that runs on your computer. Code writing is off by default.

## At a Glance

| | |
|---|---|
| **What it is** | Mindcraft-CE's agent (native tool calling, optional Brain, Task and RP agents) with fair play added |
| **Fair play** | On by default. One setting, `fair_play: "off"`, gives stock Mindcraft-CE behavior back |
| **Minecraft** | Java Edition, up to 1.21.11 |
| **Runs on** | Node 22 |
| **Status** | Experimental. Version 0.1.0 ([changelog](CHANGELOG.md)) |
| **License** | Inherited code is MIT. What this fork adds is CC0 (public domain). See [ATTRIBUTION.md](ATTRIBUTION.md) |

## Why Fair Play

A Minecraft bot is not a player. The server sends it every block in every loaded chunk, so it knows where
the diamonds are before it has dug anything. It can open a chest through a wall, and it can type commands.
A bot that uses all of that is not playing the same game as the people next to it.

With fair play on, the bot is held to what a survival player in its place could know and do:

- **It knows** what it touches, what a straight line from its eyes reaches, what it remembers seeing, and
  what it hears. Buried ore, a chest in a sealed room and a zombie behind a wall are unknown to it.
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
| Memory of the world | Named places the model chooses to save | Also remembers notable blocks it has seen, per world. The model asks with `!recall` |
| Reach | The server's distance check | A survival player's reach, and the target must be in view |
| Commands and cheat mode | Available to the model and to players in chat | Cheat mode stays off, slash commands are dropped, and the bot refuses to act as an operator or outside survival |
| Model-written code | Handed the real bot | Handed a stand-in that can only do what a player could |
| Hearing | Not used | Sounds from sources the bot can't see are reported with a direction, never coordinates |
| "Not found" | Means there is none nearby | Means the bot hasn't seen any, and the model is told so |
| Tests | 100 offline tests | 214 offline tests, plus live scenarios on a real server that make no model calls |
| Fixes | | Nine fixes to inherited code, listed in the [changelog](CHANGELOG.md) |

**Not built yet:** good-neighbor rules (don't break other players' builds, loot their chests or hurt their
animals), and limiting the pathfinder's choice of route to blocks the bot has seen. The guide lists every
[known limit](docs/fair-play.md#known-limits).

## Quick Start

1. Install [Node.js 22](https://nodejs.org/) (`nvm use` picks the right version) and have
   [Minecraft Java Edition](https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc)
   1.21.11 or older.
2. Clone this repository and run `npm install` in it.
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
and check the bot against it. They make no model calls. They need Java 21 and a server jar:

```bash
export MC_TEST_JAVA=/path/to/java
export MC_TEST_SERVER_JAR=/path/to/server.jar
node tests/live/fairplay_scenarios.js
```

## Documentation

| Page | What it covers |
|---|---|
| [docs/fair-play.md](docs/fair-play.md) | What fair play does, every switch, known limits, and the code layout |
| [docs/setup.md](docs/setup.md) | Setup and configuration: providers, profiles, servers, Docker (inherited from Mindcraft-CE) |
| [docs/agent-system.md](docs/agent-system.md) | Native tools and the Brain, Task and RP agents (inherited) |
| [docs/core-hooks.md](docs/core-hooks.md) | Every edit this fork makes to an inherited file, and why |
| [docs/FAQ.md](docs/FAQ.md) | Common problems (inherited) |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |
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

What this fork adds on top is fair play (`src/agent/fairplay/`), its tests, and the fixes in the changelog.

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

`main` is Mindcraft-CE's `agent-system` branch plus this fork's work. To take an upstream update:

```bash
git fetch upstream
git merge upstream/agent-system
npm install && npm test
```

Then re-check each entry in [docs/core-hooks.md](docs/core-hooks.md). That list is short on purpose: new
code lives in its own folders, and inherited files only get small hooks.

## Contributing

This is a personal project, and it isn't set up to take contributions. There are two better homes for
your work:

- **Fork it.** Everything this fork adds is in the public domain, so take it and make it yours.
- **Contribute to [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce)**, the community edition
  this is built on. A fix or a feature there reaches everyone, this fork included.

Fixes this fork makes to inherited code are kept in their own commits, so they can be offered to
Mindcraft-CE one at a time. [CLAUDE.md](CLAUDE.md) holds the working rules used here, if you want the same
approach in your fork.

## License

Two licenses apply, to different parts:

- **Code inherited from Mindcraft and Mindcraft-CE** is under the [MIT License](LICENSE).
- **What this fork adds** is dedicated to the public domain under [CC0 1.0](LICENSE-CC0). Take it, change
  it, ship it, with no conditions.

[ATTRIBUTION.md](ATTRIBUTION.md) says which files are which, and credits the projects and ideas this fork
builds on.
