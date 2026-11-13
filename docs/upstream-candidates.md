# Upstream Candidates

Fixes to Mindcraft-CE's own code, each in its own commit with a test, so they can be offered to CE one at a
time. Nothing here depends on the fair-play modules.

Find a fix's commit with `git log --grep "<its subject>"`.

| What | Why | Commit subject |
|---|---|---|
| `giveToPlayer`, `goToPlayer` and `followPlayer` no longer crash when the named player is not on the server | They read `bot.players[username].entity`, which throws a `TypeError` for an unknown name (a typo, or someone who just left). The "Could not find" check right below it never ran | Fix a crash when a skill is given a player who is not online |
