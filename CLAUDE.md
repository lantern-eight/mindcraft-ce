# Working Rules for Agents

These rules apply to every agent working in this repository. This file holds no personal details and is
meant to be public.

## What This Is

A fork of Mindcraft-CE (`agent-system` branch) that adds **fair play**: the bot may only know and do what a
human survival player could. New code lives in `src/agent/fairplay/`. Edits to CE's own files are small
hooks, each listed in `docs/core-hooks.md`.

`docs/fair-play.md` explains what fair play does, its switches, its known limits, and how the code is laid
out. Read it before changing anything under `src/agent/fairplay/`.

If the private planning folder is present next to this repo, its `docs/plan.md` is the work plan and
hand-off log and its `docs/fair-play.md` is the design. Never copy those notes into this repo: write clean
docs here instead.

## Public and Clean

Anything here may become public, so none of it may contain: names, usernames, emails or account IDs of
people; local paths (use repo-relative paths); network details (IPs, hostnames, machine
names); API keys, tokens, passwords, or the contents of `keys.json` / `.env`. That covers code,
comments, docs, test fixtures, commit messages, branch names, and committed logs. Credit to upstream authors
and fork owners that their licenses require is fine and needed.

## Git

- **Commit locally, in small chunks, as you go.** Never push, never add remotes on GitHub, never open PRs.
  The remote is named `upstream` and its push URL is disabled on purpose.
- **One feature or one fix per commit**, so CE's maintainers can take pieces one at a time. Fixes to CE's own
  bugs get their own commits and a line in `docs/upstream-candidates.md`.
- **New features are modules behind a setting**, working without the rest of our code.
- **Never patch the protocol layer** (mineflayer, minecraft-data, prismarine-*) beyond the patches CE pins.
- **Core edits are hooks only**, each listed in `docs/core-hooks.md`.

## Code Style

- Comment generously and explain **why**: what the code is for, why it's done this way, what would go wrong
  otherwise. Keep comments simple and high-level.
- Commit messages explain the overall intent in plain language.
- Match CE's style: 4-space indentation in JavaScript, ES modules.

## Testing

- **Tests first.** `source <planning>/scripts/env.sh` (Node 22, Java 21), then `npm test`.
- Fair-play tests are `tests/fairplay_*.test.js` (CE's runner globs `tests/*.test.js`); helpers go in
  `tests/helpers/`.
- Live scenarios that make no model calls are free to run. **Ask first** before anything that calls a paid
  model API.

## Fair Play

- Everything that *decides* (the model's prompt, command results, skill target choice, reflexes, generated
  code) gets world information only through `src/agent/fairplay/` perception. The pathfinder and physics
  ("the legs") may read raw world data for now, but text about routes must not name unseen things.
- New or ported skills must not call `bot.findBlocks`, `bot.findBlock`, `bot.nearestEntity`, `bot.entities`
  or `bot.players[…].entity` directly; use `world.*`. A lint test enforces this.
- Good-neighbor rules are enforced in code: don't break player builds, loot protected chests, or attack
  players and their animals.
- Keep code writing (`allow_insecure_coding`) off unless it runs inside the fair-play code runner.
