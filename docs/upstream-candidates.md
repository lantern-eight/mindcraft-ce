# Upstream Candidates

Fixes to Mindcraft-CE's own code, each in its own commit with a test, so they can be offered to CE one at a
time. Nothing here depends on the fair-play modules.

Find a fix's commit with `git log --grep "<its subject>"`.

| What | Why | Commit subject |
|---|---|---|
| `giveToPlayer`, `goToPlayer` and `followPlayer` no longer crash when the named player is not on the server | They read `bot.players[username].entity`, which throws a `TypeError` for an unknown name (a typo, or someone who just left). The "Could not find" check right below it never ran | Fix a crash when a skill is given a player who is not online |
| `goToBed` only looks for beds | Its search matched any block whose name contains "bed", which includes bedrock. Deep underground with no bed nearby, the bot would set off for a block of bedrock and try to sleep on it. No test: the search is inline in a skill that needs a pathfinder to run | Stop goToBed from mistaking bedrock for a bed |
| No `/skin` command at login unless the profile sets a skin | With no skin configured the bot sent `/skin clear` at every login. That command only exists with the Fabric Tailor mod, so on any other server it is an unknown command, logged each time, and it makes "did the bot run any commands?" checks fail | Send no skin command when the profile has no skin |
| `world.getNearestFreeSpace` checks that every cell of the square is empty | The check read `!top.name == 'air'`, which is always false, so for a size above 1 it accepted a spot with a block standing in it. CE's NPC builder uses this to pick where to build | Make getNearestFreeSpace reject a spot with a block in it |
| `useDoor` with no door nearby says so instead of crashing | It read `.position` of a search that had found nothing, which throws before the "Could not find a door" check below it can run. No test: the search needs game data that only exists once a bot has logged in | Fix a crash in useDoor when there is no door nearby |
| `useToolOn` tells the bot when it doesn't have the tool | The check ended in `!bot.game.gameMode === 'creative'`, which is always false, so the "You do not have any X to use" message never appeared and the skill carried on without the tool. No test, for the same reason as `useDoor` | Let useToolOn notice a missing tool |
