# Attribution and Licenses

This repository holds work under two licenses. Most of it is inherited and stays under the license it came
with. What this fork adds is given to the public domain.

| Part | License | Notice |
|---|---|---|
| **Inherited code:** everything that came from Mindcraft and Mindcraft-CE, which is every file not listed in the next row | [MIT](LICENSE) | Copyright (c) 2024 Kolby Nottingham, and the Mindcraft and Mindcraft-CE contributors |
| **This fork's additions:** the files listed under "What This Fork Added" below | [CC0 1.0 Universal](LICENSE-CC0) | No rights reserved |

## What That Means for You

- **You may use all of it**, for any purpose.
- **If you copy inherited code**, keep the MIT copyright and permission notice in [LICENSE](LICENSE) with
  it. That is the MIT License's one condition.
- **If you copy this fork's additions**, there are no conditions. To the extent possible under law, the
  contributors to this fork have waived all copyright and related or neighboring rights to them. Credit is
  welcome and not required.
- **Where this fork edits an inherited file**, the edits are given under CC0 as well, but the file as a
  whole stays under MIT. `docs/core-hooks.md` lists every such edit.

CC0 was chosen so that Mindcraft-CE, or anyone else, can take any piece of this work without asking and
without a new license to track. Much of this fork's own code was written with AI assistance, as the commit
trailers say, and CC0 leaves no question about what rights attach to it.

## Where the Inherited Code Came From

| Project | What it is here | License |
|---|---|---|
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | The original LLM agent for Minecraft, by Kolby Nottingham, Max Robinson, Isadora White and its contributors. Described in [Collaborating Action by Action: A Multi-agent LLM Framework for Embodied Reasoning](https://arxiv.org/abs/2504.17950) | MIT |
| [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce) | The community edition, by [@Sweaterdog](https://github.com/Sweaterdog), [@riqvip](https://github.com/riqvip), [@uukelele](https://github.com/uukelele), [@mrelmida](https://github.com/mrelmida) and its contributors. This fork is built on its `agent-system` branch at commit `6a1ce8b`, and takes its later updates by merge | MIT |

## Libraries

Libraries are installed by `npm install` and are not copied into this repository. Each keeps its own
license. The ones this fork's additions lean on most:

| Library | Used for | License |
|---|---|---|
| [Mineflayer](https://github.com/PrismarineJS/mineflayer) and the PrismarineJS libraries | Speaking the Minecraft protocol; the bot itself | MIT |
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | Walking | MIT |
| [SES](https://github.com/endojs/endo) (Hardened JavaScript) | The compartment that model-written code runs in | Apache-2.0 |

The files in `patches/` are inherited from Mindcraft-CE. They are small changes to some of these libraries,
applied at install time, and fall under the license of the library each one patches.

## Ideas and Methods

No code was copied for these. They are credited because the work builds on them.

- **Ray walking through a grid of cells** follows J. Amanatides and A. Woo, *A Fast Voxel Traversal
  Algorithm for Ray Tracing* (Eurographics 1987). Used by the sight test in `src/agent/fairplay/sight.js`.
- **Keeping what a player told the bot apart from what the bot has seen** comes from the place registry in
  the [`hashtagakiaki/mindcraft`](https://github.com/hashtagakiaki/mindcraft) fork. Used by the seen-world
  map in `src/agent/fairplay/seen_map.js`.

## What This Fork Added

These files are this fork's own work, under CC0 1.0. Source files among them say so in their first line
(`SPDX-License-Identifier: CC0-1.0`).

- `src/agent/fairplay/` (all files)
- `src/agent/library/world_queries.js`
- `tests/fairplay_*.test.js`, `tests/world_queries.test.js`, `tests/world_free_space.test.js`,
  `tests/skills_missing_player.test.js`, `tests/skin_command.test.js`, `tests/command_blacklist.test.js`
- `tests/helpers/fixture_world.js`
- `tests/live/fairplay_*.js`
- `docs/fair-play.md`, `docs/core-hooks.md`
- `README.md`, `CHANGELOG.md`, `CLAUDE.md`, and this file

`docs/setup.md` is Mindcraft-CE's setup guide with its links adjusted, and stays under MIT.

## Keeping This File True

- A new file written for this fork starts with `SPDX-License-Identifier: CC0-1.0` and is added to the list
  above.
- Code brought in from another project keeps that project's license. Check that the license allows it
  before copying, keep its notice with the code, and add a row here naming the project, the files and the
  license.
- An idea taken from someone else's work, with no code copied, gets a line under "Ideas and Methods".
