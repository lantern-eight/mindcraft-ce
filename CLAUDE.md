# Working Rules for Agents

These rules apply to every agent working in this repository. This file is public and holds no private
details.

## What This Is

An integration fork of [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce), built on its
`agent-system` branch. `main` is that branch plus this fork's own work. The first addition is **fair
play**: the bot may only know and do what a human survival player could.

- New code lives in its own folders: `src/agent/fairplay/`, `src/agent/memory/` (world memory, behind
  the `world_memory` setting) and `src/agent/storage/` (chest sorting, behind the `chest_sorting`
  setting). `src/agent/edition/`, the edition seam, answers what depends on the edition of the game (how
  block states are numbered, how a chunk section lists its blocks, sounds, operator rights, what a block
  entity holds, how a stack is moved); those modules ask it instead of reading game data shapes or packets
  themselves. `docs/edition-seam.md` lists its questions, and says when new code must ask it and how to
  add a question. Read it before writing code that reads state numbers, chunk sections, packets, entity
  metadata or block entities.
- On the `bedrock` branch, the Bedrock Edition code lives in `src/agent/bedrock/`, behind the
  `minecraft_edition` setting.
- Edits to files that came from Mindcraft-CE are small hooks, each listed in `docs/core-hooks.md`.
- `docs/fair-play.md` explains what fair play does, its switches, its limits and the code layout. Read it
  before changing anything under `src/agent/fairplay/`. `docs/world-memory.md` does the same for
  `src/agent/memory/`, and `docs/chest-sorting.md` for `src/agent/storage/`.
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
- **Never edit the protocol layer here** (mineflayer, minecraft-protocol, minecraft-data, prismarine-*,
  the pathfinder): no changed files and no patch files beyond the ones Mindcraft-CE already pins. Fixes
  and newer game versions come from those projects, from a branch if they aren't released yet (see
  "Fixes to Inherited Code"). Keeping clear of it is what keeps a Minecraft update cheap.
- **Core edits are hooks only**, each listed in `docs/core-hooks.md`.
- **Replace by module, not in place.** When this fork's version of something takes over from inherited
  code, put it in its own module and leave a small hook in the inherited file. Never rewrite the
  inherited logic where it stands: an upstream change to it would then merge cleanly and do nothing. Add
  the piece to "Replaced Pieces" in `docs/core-hooks.md`.
- **Branches:** `main` is the integration branch, and targets Java Edition. `bedrock` is its twin for
  Bedrock Edition (see "Two Editions, Two Branches"). Work happens on a branch named for what it adds, and
  is merged when it is tested.

## Two Editions, Two Branches

Minecraft's two editions speak different protocols, and the libraries for Bedrock Edition are younger than
the ones for Java. So each edition has its own long-lived branch, and a Bedrock problem can't break the Java
bot.

- **`main` targets Java Edition. `bedrock` targets Bedrock Edition.** Each branch's `README.md` says which
  game version it works with. Keep that line true when the version moves.
- **`bedrock` is `main` plus the Bedrock work:** its own library pins, the Bedrock modules, and their tests.
  Merge `main` into `bedrock` often, with a merge commit. Never merge `bedrock` into `main`.
- **A change that isn't about Bedrock is made for `main`,** on a branch cut from it, and reaches `bedrock`
  with the next merge. Only Bedrock work is committed on `bedrock` or on a branch cut from it.
- **New features are built for `main` first, for Java.** A feature is built, tested and merged on `main`.
  Only when it is done, working and merged there is it ported to Bedrock, as a task of its own: merge
  `main` into `bedrock`, answer for Bedrock any new question the feature asks of the edition seam, and
  give it Bedrock live tests. A feature is never built on `bedrock` first, nor on both branches at once.
- **Keep the difference between the two short and listed.** Bedrock code lives in its own module behind a
  setting, with hooks in `docs/core-hooks.md` like any other.
- Every rule in this file holds on both branches.

## Fixes to Inherited Code

A fix to code this fork inherited is made so it can be offered back exactly as it stands, while this fork
gets it straight away. No second fork is needed: this repository is a GitHub fork of Mindcraft-CE and holds
the fix branches too.

**Mindcraft-CE's own code:**

1. **Branch from Mindcraft-CE's code, not from `main`:** from `git merge-base upstream/develop
   upstream/agent-system`, the last commit the two share. Name it `fix/<what-it-fixes>`. Mindcraft-CE
   takes pull requests on `develop`, its default branch, while this fork is built on `agent-system`;
   starting from the commit they share means the branch holds the fix and nothing else, applies to
   `develop`, and brings nothing extra into `main`. If the code being fixed exists only on
   `agent-system`, branch from `upstream/agent-system` instead and ask the maintainer where to offer it.
2. **Commit the fix and its test there.** Nothing from this fork goes in: no fork modules or helpers, no
   fork docs, no `CHANGELOG.md` line. The test must pass on Mindcraft-CE's code and any new tests written
   for the bug.
3. **Merge the branch into `main`** with a merge commit, so this fork has the fix now. Add the
   `CHANGELOG.md` line on `main`.
4. **Offer it when the maintainer says so:** push the branch to `origin` and open a pull request from it to
   Mindcraft-CE's `develop`. **One fix per pull request**. More fixes go together only when they are
   the same mistake in the same place. Search Mindcraft-CE's pull requests first: one it already closed
   for the same change means it was declined.
5. When Mindcraft-CE merges it, the next merge of its code into `main` brings a change `main` already
   has, and goes in cleanly.

A fix that is already on `main` but not on its own branch is offered by cherry-picking it onto a new
branch from that same shared commit. A test that leans on this fork's code is rewritten to use only
Mindcraft-CE's. `develop` has no `npm test` script, so run its tests with `node --test tests/*.test.js`.

**Libraries** (mineflayer, minecraft-protocol, minecraft-data, prismarine-*, the pathfinder):

- **When a fix or a newer game version exists upstream but isn't released,** point `package.json` at it: a
  `github:` dependency pinned to a commit, plus `overrides` so every package in the tree uses the same
  copy. This is how this fork gets work other people have done without patching anything itself.
- **Point at the library's own branch** when one branch has everything. When the pieces are in several
  places (open pull requests, or a fix of this fork's own), fork that library, combine them on a branch
  there, and point at that. Offer this fork's own fix to the library as its own pull request, the same way
  as above.
- **If Mindcraft-CE pins a patch for that library,** redo the patch for the new commit, or carry it on the
  fork branch.
- **List every pin** under "Dependencies Pinned to a Branch" in `docs/core-hooks.md`: what, which commit,
  why, and which release will replace it. **Go back to the npm release** as soon as one has the change.

## Licenses and Credit

- Inherited code is MIT. What this fork adds is CC0 1.0. `ATTRIBUTION.md` says which files are which.
- **A new source file written for this fork starts with `// SPDX-License-Identifier: CC0-1.0`** and is added
  to the list in `ATTRIBUTION.md`.
- **Before copying code from another project, check its license allows it.** Keep that project's notice with
  the code and add a row to `ATTRIBUTION.md`. An idea taken without code gets a line there too.
- **No strong copyleft.** The repository stays MIT and CC0, and a strong copyleft license would pull the work
  that uses it under its own terms. Never copy or closely port code under GPL-2.0, GPL-3.0 or AGPL-3.0 (or
  "or later" versions of them). Copy only from permissive licenses: MIT, BSD, ISC, Apache-2.0, CC0,
  Unlicense. For weak copyleft (LGPL, MPL), or a project with no license at all, ask the maintainer first.
- **Check a new dependency's license before adding it.** A new direct dependency must not be under a strong
  copyleft license, and gets a row under "Libraries" in `ATTRIBUTION.md`. A library pinned to a fork keeps
  the library's license; check that the fork does too.

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
  to run. They need Java 25 and a 26.3 server jar: set `MC_TEST_JAVA` and `MC_TEST_SERVER_JAR`.
- The Bedrock live scripts, `tests/live/bedrock_*.js`, can't start their own server: they are pointed at a
  throwaway Bedrock server that is already running (`docs/bedrock.md`, "Testing"). They make no model
  calls either. Never point them at a world worth keeping.
- **Ask first** before anything that calls a paid model API. Model behavior is random, so tests that involve
  a model report a success rate over several runs, not a single pass or fail.

## Fair Play

- Everything that *decides* (the model's prompt, command results, skill target choice, reflexes, generated
  code, and the route a walk takes) gets world information only through `src/agent/fairplay/` perception.
- Route planning is covered by `fair_legs.js`, which answers the pathfinder's questions about blocks and
  mobs from perception and takes a cell never seen for open ground. Only the walking itself (the
  step-by-step physics, and where exactly to stand) reads raw world data. Text about routes must not name
  unseen things.
- New or ported skills must not call `bot.findBlocks`, `bot.findBlock`, `bot.nearestEntity`, `bot.entities`
  or `bot.players[…].entity` directly; use `world.*`. A lint test enforces this. They plan walks with the
  pathfinder, never with a search of their own over `bot.blockAt`, so that fair legs cover them.
- World memory records only what was in view. The memory store (`cells.js`, `things.js`, `trail.js`,
  `places.js`, `changes.js`) never touches the game and keeps names, never the game's numbers for blocks
  or states; only `recorder.js` reads the world, only `navigator.js` drives the pathfinder, and only
  `kinds.js` knows what a chest or a door is.
- Good-neighbor rules are enforced in code: don't break player builds, loot protected chests, or attack
  players and their animals.
- Keep code writing (`allow_insecure_coding`) off unless it runs inside the fair-play code runner.
