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

## Fixes Taken From Other Forks

Fixes to inherited code that someone else made first, in their own fork of Mindcraft-CE. Each is redone or
adapted here with its own test, and stays under the inherited code's MIT License.

| Fork | What was taken | License |
|---|---|---|
| [phwoger/mindcraft-ce](https://github.com/phwoger/mindcraft-ce) | The declared result in the hunting loop of `src/agent/npc/item_goal.js` (its commit `f18b8f6`). In `src/agent/library/skills.js`, `craftRecipe`'s checks that its crafting table found a spot and was placed (`4724168`). Leaving worn armor out of `getInventoryCounts` in `src/agent/library/world.js` (`32a8e91`). The retry in `src/models/novita.js` calling its own method (`f18b8f6`). Listing an agent on the MindServer only after the server check, in `src/mindcraft/mindcraft.js` (`f18b8f6`). `attackNearest` refusing an empty mob type, in `src/agent/library/skills.js` (`6533ada`), and `attackEntity` naming a player it killed (`e16fc01`). The removal of a dead method and unused imports from `src/models/vllm.js` (`f18b8f6`) | MIT |

## Libraries

Libraries are installed by `npm install` and are not copied into this repository. Each keeps its own
license. The ones this fork's additions lean on most:

| Library | Used for | License |
|---|---|---|
| [Mineflayer](https://github.com/PrismarineJS/mineflayer) and the PrismarineJS libraries | The bot itself, its game data and physics | MIT |
| [minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) (PrismarineJS) | Speaking the Minecraft protocol | BSD-3-Clause |
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | Walking | MIT |
| [bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) (PrismarineJS) | Speaking the Bedrock Edition protocol. Installed on the `bedrock` branch, through mineflayer, from a branch that adds the HTTP hand-off of current dedicated servers | MIT |
| [nethernet](https://github.com/PrismarineJS/node-nethernet) (PrismarineJS) | The transport under bedrock-protocol that current Bedrock servers speak | MIT |
| [SES](https://github.com/endojs/endo) (Hardened JavaScript) | The compartment that model-written code runs in | Apache-2.0 |

Until npm releases support the newest game version, mineflayer and some PrismarineJS libraries are installed
from forks under [`lantern-eight`](https://github.com/lantern-eight), listed in
[Dependencies Pinned to a Branch](docs/core-hooks.md#dependencies-pinned-to-a-branch). The forks keep the
libraries' own licenses.

The Bedrock Edition work is unmerged, so on the `bedrock` branch those forks also carry it: the Bedrock edition
adapter for mineflayer and the Bedrock changes to prismarine-chunk, prismarine-block, prismarine-physics and
mineflayer-pathfinder by [Pix3lPirat3](https://github.com/Pix3lPirat3), and the Bedrock block-state support
in prismarine-registry by [mc-zuri](https://github.com/mc-zuri). Each is offered to its library as a pull
request or a design proposal, under that library's MIT license. The `bedrock` branch's copy of
[Dependencies Pinned to a Branch](docs/core-hooks.md#dependencies-pinned-to-a-branch) names every one.

The files in `patches/` are inherited from Mindcraft-CE. They are small changes to some of these libraries,
applied at install time, and fall under the license of the library each one patches.

Two packages deep in the dependency tree are under GPL-3.0: `@nxg-org/mineflayer-util-plugin` and
`node-aabb`. They come in through `mineflayer-auto-eat`, a dependency inherited from Mindcraft-CE that lets
the bot eat. npm installs them; none of their code is in this repository, so its files stay MIT and CC0. A
bundle that ships them, such as a packaged app with its `node_modules`, falls under their terms.

On the `bedrock` branch, `bedrock-protocol` brings in about two hundred more packages. All are under permissive licenses except two.
`mediabunny` is under MPL-2.0, a file-level copyleft: it comes in through `werift`, the WebRTC library the
Bedrock transport uses. `buffers`, an old package that states no license, comes in through the build tool
of `raknet-native`. As above, npm installs them and none of their code is in this repository.

## Ideas and Methods

No code was copied for these. They are credited because the work builds on them.

- **Ray walking through a grid of cells** follows J. Amanatides and A. Woo, *A Fast Voxel Traversal
  Algorithm for Ray Tracing* (Eurographics 1987). Used by the sight test in `src/agent/fairplay/sight.js`.
- **Taking ground that has not been seen for passable, and planning again as it comes into view** is the
  freespace assumption of robot navigation in unknown terrain (A. Stentz, *Optimal and Efficient Path
  Planning for Partially-Known Environments*, 1994; S. Koenig and M. Likhachev, *D\* Lite*, 2002). Used by
  the route planning in `src/agent/fairplay/fair_legs.js`, which searches afresh each time where those
  repair the last search.
- **Keeping what a player told the bot apart from what the bot has seen** comes from the place registry in
  the [`hashtagakiaki/mindcraft`](https://github.com/hashtagakiaki/mindcraft) fork. Used by world memory's
  things in `src/agent/memory/things.js`, which keep a thing the bot was told about apart from one it saw.

- **Backing off from a creeper by sprinting, how far, and hitting a following creeper once and stepping
  back** come from the creeper procedure in the [`akarkin1/mindcraft-fk`](https://github.com/akarkin1/mindcraft-fk)
  fork (`packs/home/creeper_logic.js`). Used by the creeper reflex in `src/agent/reflexes/`.
- **Taking a creeper's hiss as the sign that its fuse is lit** comes from the defense mode of
  [`finettt/OpenPlayer`](https://github.com/finettt/OpenPlayer). Used by `src/agent/reflexes/picture.js`, which
  remembers a hiss until something settles it, by direction and distance band rather than by the mob.
- **A creeper about to explode outranks every other threat** comes from the threat ranking in the
  [`winnerspiros/mindcraft`](https://github.com/winnerspiros/mindcraft) fork. Used by `src/agent/reflexes/decide.js`.
- **A window that holds other work while a reflex acts** comes from the emergency window in the
  [`LarsHamb/mindcraft-ce`](https://github.com/LarsHamb/mindcraft-ce) fork, which also stopped its flee from
  pausing the protection from lava, fire and drowning. Used by `src/agent/action_hold.js`; the flee is fixed
  the same way in `src/agent/library/skills.js` (`avoidEnemies`).
- **Keeping whether a mob can be walked to for a few seconds, and leaving alone a mob the bot gave up on**
  come from the combat work in the [`nengoxx/mindcraft`](https://github.com/nengoxx/mindcraft) fork
  (`work/combat.js`). Used by `src/agent/library/path_verdicts.js` and `src/agent/reflexes/fight_reflex.js`.
- **A stance and a reason for each threat, one owner per threat, and watching a creeper above an
  underground bot** come from the threat classifier and combat state in the
  [`casmint/mindcraft-plus`](https://github.com/casmint/mindcraft-plus) fork. Used by
  `src/agent/reflexes/mob_decide.js` and `src/agent/reflexes/claims.js`.
- **A reaction for each kind of mob, and retreating when outnumbered** come from the threat table in the
  [`JQDAW/mindcraft-RotN`](https://github.com/JQDAW/mindcraft-RotN) fork (`library/threats.js`). Used by
  `src/agent/reflexes/mob_decide.js`.
- **When to stand and fight, from measured trials, and moving away from all enemies at once** come from the
  melee trials in the [`hashtagakiaki/mindcraft`](https://github.com/hashtagakiaki/mindcraft) fork
  (`docs/melee-combat-20261022.md`). Used by `src/agent/reflexes/mob_decide.js` and `retreatFrom` in
  `src/agent/reflexes/moves.js`.

## What This Fork Added

These files are this fork's own work, under CC0 1.0. Source files among them say so in their first line
(`SPDX-License-Identifier: CC0-1.0`).

- `src/agent/fairplay/` (all files)
- `src/agent/memory/` (all files)
- `src/agent/storage/` (all files)
- `src/agent/edition/` (all files)
- `src/agent/bedrock/` (all files)
- `src/agent/reflexes/` (all files)
- `src/agent/library/world_queries.js`, `src/agent/library/travel_guide.js`, `src/agent/library/attack_reach.js`,
  `src/agent/library/look_first.js`, `src/agent/library/dig_down_way.js`, `src/agent/library/stairs_down.js`,
  `src/agent/library/path_verdicts.js`, `src/agent/action_hold.js`
- `tests/fairplay_*.test.js`, `tests/memory_*.test.js`, `tests/storage_*.test.js`, `tests/reflexes_*.test.js`, `tests/edition.test.js`,
  `tests/world_queries.test.js`, `tests/world_free_space.test.js`, `tests/world_unknown_block.test.js`,
  `tests/skills_missing_player.test.js`, `tests/skin_command.test.js`, `tests/command_blacklist.test.js`,
  `tests/command_register.test.js`, `tests/live_jar_cache.test.js`, `tests/goto_path_search.test.js`,
  `tests/goto_square_corners.test.js`, `tests/pathfinder_diagonal_corners.test.js`,
  `tests/pickup_items_from_beside.test.js`, `tests/action_error_privacy.test.js`,
  `tests/action_error_message.test.js`, `tests/action_stop_race.test.js`, `tests/position_throttle.test.js`, `tests/wood_types.test.js`,
  `tests/door_types.test.js`, `tests/door_walk.test.js`, `tests/door_search.test.js`, `tests/hunting_babies.test.js`, `tests/idle_staring_babies.test.js`, `tests/baby_villagers.test.js`,
  `tests/villager_profession.test.js`, `tests/villagers_edition.test.js`, `tests/item_goal_hunt.test.js`,
  `tests/craft_table_placement.test.js`, `tests/craft_no_recipe.test.js`, `tests/place_block_failure.test.js`,
  `tests/place_block_cheat.test.js`, `tests/till_and_sow_cheat.test.js`,
  `tests/inventory_counts_armor.test.js`, `tests/novita_retry.test.js`,
  `tests/create_agent_failure.test.js`, `tests/attack_input.test.js`,
  `tests/attack_player_name.test.js`, `tests/attack_reach.test.js`, `tests/bedrock_*.test.js`,
  `tests/defend_self_creeper.test.js`, `tests/avoid_enemies_creeper.test.js`, `tests/avoid_enemies_self_preservation.test.js`
- `tests/helpers/fixture_world.js`, `tests/helpers/fake_chest_bot.js`, `tests/helpers/server_jar_cache.js`,
  `tests/helpers/walker_bot.js`, `tests/helpers/game_version.js`, `tests/helpers/bedrock_libraries.js`,
  `tests/helpers/named_cells.js`
- `tests/live/fairplay_*.js`, `tests/live/memory_scenarios.js`, `tests/live/navigator_scenarios.js`,
  `tests/live/storage_scenarios.js`, `tests/live/storage_agent_scenarios.js`, `tests/live/travel_scenarios.js`,
  `tests/live/legs_scenarios.js`, `tests/live/villager_scenarios.js`, `tests/live/look_first_scenarios.js`, `tests/live/threat_scenarios.js`, `tests/live/bedrock_*.js`,
  `tests/live/bedrock-server/` (all files), `tests/live/perception_bench_results.json`
- `docs/fair-play.md`, `docs/world-memory.md`, `docs/chest-sorting.md`, `docs/threat-reflexes.md`, `docs/edition-seam.md`, `docs/core-hooks.md`, `docs/bedrock.md`,
  `docs/upstream.md`
- `README.md`, `CHANGELOG.md`, `CLAUDE.md`, and this file, and on the `bedrock` branch `CHANGELOG-bedrock.md`

`docs/setup.md` is Mindcraft-CE's setup guide with its links adjusted, and stays under MIT.

## Keeping This File True

- A new file written for this fork starts with `SPDX-License-Identifier: CC0-1.0` and is added to the list
  above.
- Code brought in from another project keeps that project's license. Check that the license allows it
  before copying, keep its notice with the code, and add a row here naming the project, the files and the
  license.
- An idea taken from someone else's work, with no code copied, gets a line under "Ideas and Methods".
- No strong copyleft. Code under GPL-2.0, GPL-3.0 or AGPL-3.0 is never copied or closely ported here, so that
  this repository stays MIT and CC0. Code is copied only from permissive licenses (MIT, BSD, ISC,
  Apache-2.0, CC0, Unlicense). A new direct dependency is checked the same way and gets a row under
  "Libraries".
