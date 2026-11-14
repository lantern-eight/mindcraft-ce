# Working Rules for Agents

These rules apply to every agent working in this repository. This file is public and holds no private
details.

## What This Is

An integration fork of [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce), built on its
`agent-system` branch. `main` is that branch plus this fork's own work. The first addition is **fair
play**: the bot may only know and do what a human survival player could.

- New code lives in its own folders: `src/agent/fairplay/` and `src/agent/memory/` (world memory, behind
  the `world_memory` setting).
- Edits to files that came from Mindcraft-CE are small hooks, each listed in `docs/core-hooks.md`.
- `docs/fair-play.md` explains what fair play does, its switches, its limits and the code layout. Read it
  before changing anything under `src/agent/fairplay/`. `docs/world-memory.md` does the same for
  `src/agent/memory/`.
- `README.md` says what the fork is and how it differs from its sources. `CHANGELOG.md` records what
  changed in each version.

## Private Notes Stay Out of Git

Working notes (plans, research, task lists, logs) live in `plans/`, which is gitignored.

- **Never commit anything from `plans/`**, and never copy its text into a committed file. Write clean docs
  here instead.
- **Commit messages, code comments and docs never point at those notes.** No task numbers, phases, plan
  names or "as planned". A commit explains its own change and the intent of the branch or pull request it
  belongs to, and nothing else.
- `plans/upstream-candidates.md` is the running list of changes worth offering back to Mindcraft-CE. Add a
  line whenever a commit fixes something in Mindcraft-CE's own code.

## Public and Clean

Everything committed here is public. None of it may contain:

- names, usernames, emails or account IDs of people, beyond the public Git identity on a commit
- local paths (use paths relative to the repo)
- network details: IP addresses, hostnames, machine names, server addresses
- API keys, tokens, passwords, or the contents of `keys.json` / `.env`
- anything else about who runs this project or how their machines are set up

That covers code, comments, docs, test fixtures, commit messages, branch names and committed logs. Credit to
upstream authors and fork owners is fine and needed where their licenses ask for it.

## Git

- **Commit locally, in small chunks, as you go.**
- **Push only when the maintainer has asked for that push.** Never push, open a pull request, or add a
  remote on your own initiative. The `upstream` remote is Mindcraft-CE and its push URL is disabled on
  purpose.
- **One feature or one fix per commit**, so Mindcraft-CE's maintainers can take pieces one at a time. A fix
  to Mindcraft-CE's own code gets its own commit, with nothing from this fork mixed in.
- **New features are modules behind a setting**, working without the rest of this fork's code.
- **Never patch the protocol layer** (mineflayer, minecraft-data, prismarine-*) beyond the patches
  Mindcraft-CE already pins. Keeping clear of it is what keeps a Minecraft update cheap.
- **Core edits are hooks only**, each listed in `docs/core-hooks.md`.
- **Replace by module, not in place.** When this fork's version of something takes over from inherited
  code, put it in its own module and leave a small hook in the inherited file. Never rewrite the
  inherited logic where it stands: an upstream change to it would then merge cleanly and do nothing. Add
  the piece to "Replaced Pieces" in `docs/core-hooks.md`.
- **Branches:** `main` is the integration branch. Work happens on a branch named for what it adds, and is
  merged when it is tested.

## Licenses and Credit

- Inherited code is MIT. What this fork adds is CC0 1.0. `ATTRIBUTION.md` says which files are which.
- **A new source file written for this fork starts with `// SPDX-License-Identifier: CC0-1.0`** and is added
  to the list in `ATTRIBUTION.md`.
- **Before copying code from another project, check its license allows it.** Keep that project's notice with
  the code and add a row to `ATTRIBUTION.md`. An idea taken without code gets a line there too.

## Changelog and Versions

- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Every change a person
  running the bot would notice adds a line under **Unreleased**, in the same commit or branch.
- Versions follow [Semantic Versioning](https://semver.org/). A release moves the Unreleased lines under a
  new version heading with its date, and sets the same version in `package.json`.

## Code Style

- Comment generously and explain **why**: what the code is for, why it's done this way, what would go wrong
  otherwise. Keep comments simple and high-level.
- Commit messages explain the overall intent in plain language. The diff shows the details.
- Match the surrounding style: 4-space indentation in JavaScript, ES modules.

## Testing

- **Tests first.** Use Node 22 (see `.nvmrc`), then `npm test`.
- Fair-play tests are `tests/fairplay_*.test.js`, world-memory tests are `tests/memory_*.test.js` and
  chest-sorting tests are `tests/storage_*.test.js` (the runner globs `tests/*.test.js`); helpers go in
  `tests/helpers/`.
- Live scenarios in `tests/live/` start their own throwaway server and make no model calls, so they are free
  to run. They need Java 21 and a server jar: set `MC_TEST_JAVA` and `MC_TEST_SERVER_JAR`.
- **Ask first** before anything that calls a paid model API. Model behavior is random, so tests that involve
  a model report a success rate over several runs, not a single pass or fail.

## Fair Play

- Everything that *decides* (the model's prompt, command results, skill target choice, reflexes, generated
  code) gets world information only through `src/agent/fairplay/` perception. The pathfinder and physics
  ("the legs") may read raw world data for now, but text about routes must not name unseen things.
- New or ported skills must not call `bot.findBlocks`, `bot.findBlock`, `bot.nearestEntity`, `bot.entities`
  or `bot.players[…].entity` directly; use `world.*`. A lint test enforces this.
- World memory records only what was in view. The memory store (`cells.js`, `things.js`, `trail.js`,
  `places.js`, `changes.js`) never touches the game and keeps names, never the game's numbers for blocks
  or states; only `recorder.js` reads the world, only `navigator.js` drives the pathfinder, and only
  `kinds.js` knows what a chest or a door is.
- Good-neighbor rules are enforced in code: don't break player builds, loot protected chests, or attack
  players and their animals.
- Keep code writing (`allow_insecure_coding`) off unless it runs inside the fair-play code runner.
