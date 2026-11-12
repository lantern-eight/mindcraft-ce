# Core Hooks

Every edit this fork makes to a file that came from Mindcraft-CE is listed here. New code lives in
`src/agent/fairplay/` and needs no entry.

**Why this list exists:** when CE updates, merge it, then re-check each hook below and run the tests. A short
list keeps that a small job instead of a hunt.

**Finding a hook's commit:** each hook's commit message says `core hook N`, so
`git log --grep "core hook 3"` finds it, and `git log --oneline -- <file>` lists everything that touched a
file.

| # | File | What the hook does | Why it can't live in a new module |
|---|---|---|---|
