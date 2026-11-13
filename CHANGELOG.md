# Changelog

All notable changes to this fork are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are this fork's own. Each release names the Mindcraft-CE commit it is built on.

## [Unreleased]

## [0.1.0] - 2026-11-13

The first version of this fork. Built on Mindcraft-CE's `agent-system` branch at commit `6a1ce8b`.

### Added

- **Fair play:** the bot may only know and do what a human survival player could. It is on by default
  (`fair_play: "strict"`), and `fair_play: "off"` gives stock behavior. See `docs/fair-play.md`.
  - **Perception.** Searches for blocks and mobs answer only with what the bot touches, sees in a straight
    line, remembers seeing, or hears. Players' name tags follow the vanilla rule: 64 blocks, unless
    sneaking.
  - **Memory of the world.** Notable blocks the bot has seen (ores, logs, sand, containers, workstations,
    beds, doors, crops) are remembered per server, world and dimension, exactly as last seen.
  - **`!recall` command.** The model can ask where it last saw a kind of block: where, how far, which way
    and how long ago.
  - **Hearing.** Sounds from sources the bot can't see are added to the `!entities` report with a direction
    and a rough distance, never coordinates.
  - **Reach guard.** Digging, placing, opening and hitting need the target within a survival player's reach
    (4.5 blocks, 3 for mobs) and in view.
  - **Locks.** Cheat mode stays off, slash commands are dropped before they reach the server, and the bot
    stops acting if it is made an operator or put outside survival mode.
  - **Switches.** `fair_play: "custom"` with `fair_play_custom` turns single rules off, to measure what
    each one is worth.
- A runner for model-written code that hands the code a stand-in for the bot. `!newAction`, the
  `executeCode` tool and generated augments all go through it when fair play is on.
- A lint test that fails when new code searches the bot directly instead of going through `world.js`.
- Live scenarios (`tests/live/fairplay_*.js`) that check fair play on a real server with no model calls.
- `docs/fair-play.md`, `docs/core-hooks.md`, `docs/setup.md` and this changelog.

### Changed

- Every block and entity search in `world.js` goes through one swappable provider. With fair play off the
  provider is the bot itself and nothing changes.
- Skills, reflexes and commands that searched the bot directly now go through `world.js`: finding a player
  by name, picking up items, finding a bed or a villager, and what the idle bot looks at.
- A search that finds nothing tells the model that this means "not seen", not "none nearby", when fair play
  is on.
- `!setMode` reports a refusal when a mode can't be changed, instead of claiming success.
- Agents created through the MindServer page or its API keep the fair-play settings, which are now listed
  in `settings_spec.json`.
- The README is rewritten for this fork. Mindcraft-CE's setup and configuration guide moved to
  `docs/setup.md`.

### Fixed

These are fixes to code inherited from Mindcraft-CE. Each is its own commit, so it can be offered upstream.

- `giveToPlayer`, `goToPlayer` and `followPlayer` no longer crash when the named player is not online.
- `goToBed` no longer mistakes bedrock for a bed.
- No `/skin` command is sent at login unless the profile sets a skin.
- `world.getNearestFreeSpace` rejects a spot with a block in it.
- `world.getNearestBlocksWhere` no longer returns an empty entry for a position it couldn't read.
- `useDoor` says so when there is no door nearby, instead of crashing.
- `useToolOn` tells the bot when it doesn't have the tool.
- `!stats` puts the current action on its own line.
- `giveToPlayer` no longer writes a stray number into its result.
- A blacklisted command is removed from the command list as well as from lookup.

### Security

- With fair play on, model-written code no longer receives the real bot, the agent, or host globals. This
  narrows what such code can do; it is not a full sandbox, and `allow_insecure_coding` stays off by default.
