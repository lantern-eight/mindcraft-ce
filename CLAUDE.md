# Working Rules for Agents

These rules apply to every agent working in this repository. This file is public and holds no private
details.

## What This Is

An integration fork of [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce), built on its
`agent-system` branch. `main` is that branch plus this fork's own work. The first addition is **fair
play**: the bot may only know and do what a human survival player could.

- New code lives in its own folders: `src/agent/fairplay/`, `src/agent/memory/` (world memory, behind
  the `world_memory` setting), `src/agent/storage/` (chest sorting, behind the `chest_sorting` setting),
  `src/agent/smelting/` (smelting, behind the `smelting` setting), `src/agent/reflexes/` (the threat reflexes,
  behind the `threat_reflexes` setting) and `src/agent/explore/` (exploring, behind the `explore` setting).
  `src/agent/edition/`, the edition seam, answers what depends on the edition of the game (how
  block states are numbered, how a chunk section lists its blocks, sounds, operator rights, what a block
  entity holds, how a stack is moved); those modules ask it instead of reading game data shapes or packets
  themselves. `docs/edition-seam.md` lists its questions, and says when new code must ask it and how to
  add a question. Read it before writing code that reads state numbers, chunk sections, packets, entity
  metadata or block entities.
- The Bedrock Edition code lives in `src/agent/bedrock/`, behind the `minecraft_edition` setting. It runs
  only on the libraries the `bedrock` branch pins (see "Two Editions, Two Branches").
- Edits to files that came from Mindcraft-CE are small hooks, each listed in `docs/core-hooks.md`.
- `docs/fair-play.md` explains what fair play does, its switches, its limits and the code layout. Read it
  before changing anything under `src/agent/fairplay/`. `docs/world-memory.md` does the same for
  `src/agent/memory/`, `docs/chest-sorting.md` for `src/agent/storage/`, `docs/smelting.md` for `src/agent/smelting/`,
  `docs/threat-reflexes.md` for `src/agent/reflexes/`, and `docs/explore.md` for `src/agent/explore/`.
- `README.md` says what the fork is and how it differs from its sources. `CHANGELOG.md` records what
  changed in each version, for both editions. On `bedrock`, `CHANGELOG-bedrock.md` records what its
  library pins changed.

## Private Notes Stay Out of Git

Working notes (plans, research, task lists, logs) live in `plans/`, which is gitignored.

- **Never commit anything from `plans/`**, and never copy its text into a committed file. Write clean docs
  here instead.
- **Commit messages, code comments and docs never point at those notes.** No task numbers, phases, plan
  names or "as planned". A commit explains its own change and the intent of the branch or pull request it
  belongs to, and nothing else.

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
- **Branches:** `main` holds all of the code, for both editions. `bedrock` is `main` plus the library pins
  that make Bedrock Edition run, and its defaults (see "Two Editions, Two Branches").
- **`main` and `bedrock` change only by a pull request** that says what it brings and bumps the version (see
  "Changelog and Versions"). Nothing is committed or merged straight onto either of them.
- **Work happens on a working branch,** named for what it adds and cut from the branch it will go into:
  `main` for code, `bedrock` for its pins. A task stays on its branch until all of it is done and tested,
  then goes in as one pull request.
- **Fixes found along the way are made on the working branch,** and reach `main` or `bedrock` with its pull
  request. A fix that could go upstream is also broken off onto a small branch of its own, to offer it
  there (see "Fixes to Inherited Code").
- **Pull requests are merged with a merge commit,** never squashed or rebased, so each commit stays as it
  was made. With `gh`, name this repository (--repo ...), the checkout also has Mindcraft-CE as a remote, and `gh` may
  pick it.

## Two Editions, Two Branches

Minecraft's two editions speak different protocols. The released libraries play Java Edition; Bedrock
Edition needs their unreleased work, pinned to branches. So there is one copy of the code, for both
editions, and the pins live on a branch of their own.

- **`main` holds all of the code, for both editions:** the Java and the Bedrock modules, the edition seam's
  answers for both, the hooks, the tests and the docs. It installs the libraries Java Edition needs. A bot
  set to Bedrock on `main` stops with a message that says to use the `bedrock` branch, and the tests that
  need the Bedrock libraries skip themselves there. Each branch's `README.md` says which game versions it
  works with. Keep that line true when a version moves.
- **`bedrock` is `main` plus what makes Bedrock run, and nothing else:** its library pins and its
  defaults, file by file under "What Differs Between the Branches" below. When the libraries release their
  Bedrock work, the branch is no longer needed.
- **Code goes into `main`, whichever edition it is for,** on a working branch cut from `main`. Java and
  Bedrock changes alike reach `bedrock` when `main` is merged into it: with a merge commit, into a working
  branch cut from `bedrock`, which goes into `bedrock` by its pull request. Do that after every release of
  `main`.
- **Never merge `bedrock`, or a branch cut from it, into `main`.** It would bring the pins. A change to the
  pins alone (a newer library commit, a library fix) is made on a working branch cut from `bedrock`.
- **To run Bedrock on a branch cut from `main`,** install `bedrock`'s libraries: `git checkout origin/bedrock
  -- package.json package-lock.json patches`, `SKIP_BUILD=1 npm ci`, then `git checkout HEAD --
  package.json package-lock.json patches`. `node_modules` isn't tracked, so it stays as installed while the
  branch changes, and the Java tests pass on those libraries too.
- **To run long Java and Bedrock live scripts at the same time,** do those three steps in a worktree of the
  working branch instead (`git worktree add --detach <a folder outside the repo> HEAD`), and run the Bedrock
  scripts from there while the Java ones run in the main checkout. Each has its own `node_modules`, so neither
  run disturbs the other's libraries. They share the CPU, so compare timings only with runs made the same
  way. Remove the worktree when done (`git worktree remove`).
- **A feature is built on `main`, for both editions where both can have it.** Its Bedrock side is answered
  at the edition seam where it needs one, and it is tested live on Java and on Bedrock. A feature that comes
  to Java first gets its Bedrock side in a task of its own, also on `main`; a question it adds to the seam
  is answered for Bedrock at once (`docs/edition-seam.md`). Everything Bedrock stays behind
  the setting, so it can't break the Java bot.
- **Keep the difference between the two branches to the pins and the defaults.**
- Every rule in this file holds on both branches.

### What Differs Between the Branches

These files, and only these, differ between `main` and `bedrock`. Every other file is the same on both.

| File | What `bedrock` has |
|---|---|
| `package.json`, `package-lock.json` | The Bedrock library pins, and `overrides` that make the whole tree use them |
| The patches in `patches/` whose line numbers the pins move (today mineflayer-pathfinder's and prismarine-block's) | The same changes, at the pinned branches' line numbers |
| `settings.js`, `src/mindcraft/public/settings_spec.json` | The Bedrock defaults: `minecraft_edition` `"bedrock"`, `minecraft_version` `"auto"`, `port` 19132. Only those values differ; the keys and comments are the same |
| `docs/core-hooks.md` | The pins, under "For Bedrock Edition", and the two rows of "Housekeeping Edits" about the files above |
| `CHANGELOG-bedrock.md` | Only on `bedrock`: the releases of its pins alone |

- **Check it** with `git diff --stat origin/main origin/bedrock`. It lists these files and no others. Any
  other file in it is a change that belongs on `main`, or a merge that kept the wrong side.
- **When `main` is merged into `bedrock`,** a conflict in any other file is settled by taking `main`'s
  version (`git checkout origin/main -- <file>`). In these files, keep `bedrock`'s pins and defaults and take
  the rest from `main`.
- **A new difference is a decision, not a side effect.** Add it to this table in the same pull request, and
  keep it to dependencies and defaults. Code only Bedrock needs still goes on `main`, behind the setting.

## Fixes to Inherited Code

A fix to code this fork inherited is made on the working branch, so this fork has it with the work it was
found in, and is kept in a shape that can be offered back exactly as it stands. No second fork is needed:
this repository is a GitHub fork of Mindcraft-CE and holds the fix branches too.

**Mindcraft-CE's own code:**

1. **Make the fix on the working branch, with its test, as a commit of its own,** its changelog and
   `ATTRIBUTION.md` lines in the same commit like any other change. Nothing else from this fork goes in
   it: no fork modules or helpers, no fork docs. Then the fix itself can be taken as it is.
2. **If it can go upstream, break it off:** a branch named `fix/<what-it-fixes>`, cut from `git merge-base
   upstream/develop upstream/agent-system` (the last commit the two share), with the fix's commit
   cherry-picked onto it, less this fork's changelog and `ATTRIBUTION.md` lines (`git cherry-pick -n`,
   undo those files, commit with the same message). Mindcraft-CE takes pull requests on `develop`, its default branch, while this
   fork is built on `agent-system`; starting from the commit they share means the branch holds the fix and
   nothing else and applies to `develop`. If the code being fixed exists only on `agent-system`, branch
   from `upstream/agent-system` instead and ask the maintainer where to offer it. The test must pass on
   Mindcraft-CE's code: a test that leans on this fork's code is rewritten there to use only
   Mindcraft-CE's. `develop` has no `npm test` script, so run its tests with `node --test tests/*.test.js`.
   The fix branch is never merged anywhere in this repository; the working branch already has the fix.
3. **Offer it before the working branch's pull request merges:** ask the maintainer once the fix branch
   is ready, and when they say so, push the fix branch to `origin` and open a pull request from it to
   Mindcraft-CE's `develop`. Offering first means its line in `docs/upstream.md` (below) goes into the
   working branch's own pull request, instead of waiting for another release. **One fix per pull
   request**. More fixes go together only when they are the same mistake in the same place. Search
   Mindcraft-CE's pull requests first: one it already closed for the same change means it was declined.
4. When Mindcraft-CE merges it, the next merge of its code brings a change this fork already has, and goes
   in cleanly.

**Every fix offered upstream, to Mindcraft-CE or a library, gets a line in `docs/upstream.md`** when it is
offered, on the working branch the fix came from, so the line ships in that branch's pull request. Its line
comes out once it is merged and this fork is on a release that has it; a declined one stays, marked
declined.

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
- Versions follow [Semantic Versioning](https://semver.org/). **Every pull request into `main` or `bedrock`
  is a release:** it moves the Unreleased lines under a new version heading with its date, and sets the
  same version in `package.json`.
- **A version has a part for each edition:** `1.0.0-bedrock.1.0.0` is Java Edition's `1.0.0` and Bedrock
  Edition's `1.0.0`, and each part follows Semantic Versioning by itself. A change only a Java player would
  notice bumps the first part. One only a Bedrock player would notice (a Bedrock answer at the edition seam,
  the Bedrock module, a pin) bumps the last. A change to code both editions run bumps both.
- **`main` and `bedrock` carry the same version,** except after a release of `bedrock`'s pins alone: that
  bumps the Bedrock part on `bedrock`, and the next release of `main` takes a Bedrock part above it, so no
  number is used twice. The lines for such a release go in `CHANGELOG-bedrock.md`, which only `bedrock`
  has; every other line goes in `CHANGELOG.md`, on `main`.

**Making a release:**

1. On the working branch, every commit passes `npm test` and every live script passes on its tip (Java,
   and Bedrock on `bedrock`'s libraries when the change reaches Bedrock), with the narrow view and seeing
   all around: `node tests/live/java_all.js` runs the Java ones both ways, and `node
   tests/live/bedrock_all.js` runs the Bedrock ones once with `MC_TEST_VIEW` unset and once with
   `MC_TEST_VIEW=all`. Fair play's view can be either, and people use both. The `fix/` branches it broke off
   are offered upstream, when the maintainer says so, and their lines are in `docs/upstream.md`.
2. A last commit, "Release X": the Unreleased lines move under a heading with the version and the date,
   with its compare link at the bottom of `CHANGELOG.md`; the version goes in `package.json` and in both
   places at the top of `package-lock.json`. With the version set, run `node
   tests/live/fairplay_perception_bench.js --record`: it must pass against the last release's timings, and
   its result in `tests/live/perception_bench_results.json` goes in this commit. Only for a release, not
   for each commit on a working branch.
3. When approved, push the branch and open its pull request into `main`. Once it is merged,
   put a signed, annotated tag `vX` on the merge commit and push the tag.
4. Then bring it to `bedrock`: merge `main` into a working branch cut from `bedrock` (with any pin changes),
   check `git diff --stat origin/main origin/bedrock` lists only the files in "What Differs Between the
   Branches", and open its pull request into `bedrock`.
5. After both merge: `git fetch --prune`, fast-forward the local `main` and `bedrock`, and delete the local
   working branches. The `fix/` branches were already offered, in step 1.

## Code Style

- Comment generously and explain **why**: what the code is for, why it's done this way, what would go wrong
  otherwise. Keep comments simple and high-level.
- Commit messages explain the overall intent in plain language. The diff shows the details.
- Match the surrounding style: 4-space indentation in JavaScript, ES modules.

## Testing

- **Tests first.** Use Node (see `.nvmrc`), then `npm test`.
- Fair-play tests are `tests/fairplay_*.test.js`, world-memory tests are `tests/memory_*.test.js`,
  chest-sorting tests are `tests/storage_*.test.js`, smelting tests are `tests/smelting_*.test.js` and threat-reflex tests are `tests/reflexes_*.test.js`
  (the runner globs `tests/*.test.js`); helpers go in `tests/helpers/`.
- Live scenarios in `tests/live/` start their own throwaway server and make no model calls, so they are free
  to run. They need Java 25 and a 26.3 server jar: set `MC_TEST_JAVA` and `MC_TEST_SERVER_JAR`.
- `tests/live/fairplay_perception_bench.js` times perception and is run only when making a release (see
  "Changelog and Versions"). Its results are kept per seed and game version; a new game version starts a
  new line of them, with nothing to compare against until the next release.
- The Bedrock live scripts, `tests/live/bedrock_*.js`, run on `bedrock`'s libraries, and can't start their
  own server: they are pointed at a throwaway Bedrock server that is already running (`docs/bedrock.md`,
  "Testing"; `tests/live/bedrock-server/` has one ready to start, and `tests/live/bedrock_all.js` runs them
  all). They make no model calls either. Never point them at a world worth keeping.
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
