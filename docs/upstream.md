# Offered Upstream

Fixes this fork has made to code it inherited, and offered back to the project the code came from. Each one is
already on `main` (or, for a library, in the copy `package.json` pins), so this fork doesn't wait on them. When
one is merged upstream, the next update brings a change this fork already has, and goes in cleanly. Each pull
request says why the fix is needed and how it was tested.

How a fix is made and offered is in [CLAUDE.md](../CLAUDE.md), "Fixes to Inherited Code". Libraries pinned to
unreleased work, and the release each waits for, are in
[core-hooks.md](core-hooks.md#dependencies-pinned-to-a-branch).

*As of `1.2.1-bedrock.1.3.1`: all of these are open.* A line is removed once its fix is merged upstream and
this fork is on a release that has it. A fix that is declined stays on `main`, and its line says so.

## Mindcraft-CE

Pull requests to [mindcraft-ce/mindcraft-ce](https://github.com/mindcraft-ce/mindcraft-ce), on `develop`
unless noted. Each comes from a `fix/...` branch of this repository, cut from the last commit `develop` and
`agent-system` share, so it holds the fix and nothing else.

| Pull request | Fix |
|---|---|
| [#104](https://github.com/mindcraft-ce/mindcraft-ce/pull/104) | `giveToPlayer`, `goToPlayer` and `followPlayer` don't crash on a player who isn't online |
| [#105](https://github.com/mindcraft-ce/mindcraft-ce/pull/105) | `goToBed` no longer mistakes bedrock for a bed |
| [#106](https://github.com/mindcraft-ce/mindcraft-ce/pull/106) | No `/skin clear` at login when the profile sets no skin |
| [#107](https://github.com/mindcraft-ce/mindcraft-ce/pull/107) | `getNearestFreeSpace` rejects a spot with a block in it |
| [#108](https://github.com/mindcraft-ce/mindcraft-ce/pull/108) | `useDoor` with no door nearby says so instead of crashing |
| [#109](https://github.com/mindcraft-ce/mindcraft-ce/pull/109) | `useToolOn` notices a missing tool |
| [#110](https://github.com/mindcraft-ce/mindcraft-ce/pull/110) | `!stats` puts the current action on its own line |
| [#111](https://github.com/mindcraft-ce/mindcraft-ce/pull/111) | A leftover debug line no longer writes a number into `giveToPlayer`'s result |
| [#112](https://github.com/mindcraft-ce/mindcraft-ce/pull/112) | `goToGoal`'s path search uses its whole second, not one 40 ms slice |
| [#113](https://github.com/mindcraft-ce/mindcraft-ce/pull/113) | `goToGoal` doesn't plan diagonals it can't walk in 1-wide tunnels |
| [#114](https://github.com/mindcraft-ce/mindcraft-ce/pull/114) | Failed actions no longer send "Stack trace: undefined" to the model |
| [#115](https://github.com/mindcraft-ce/mindcraft-ce/pull/115) | `pickupNearbyItems` picks up from beside an item (on `agent-system`, the only branch with the bug) |
| [#116](https://github.com/mindcraft-ce/mindcraft-ce/pull/116) | Position packets stay in their own tick once the client sends `tick_end` |
| [#117](https://github.com/mindcraft-ce/mindcraft-ce/pull/117) | Builders use the wood they carry, dark and pale oak included |
| [#118](https://github.com/mindcraft-ce/mindcraft-ce/pull/118) | `useDoor` finds copper, pale oak and poplar doors |
| [#119](https://github.com/mindcraft-ce/mindcraft-ce/pull/119) | `getBiomeName` says "unknown" for a biome the game data lacks |
| [#120](https://github.com/mindcraft-ce/mindcraft-ce/pull/120) | Baby villagers aren't taken for adults |
| [#121](https://github.com/mindcraft-ce/mindcraft-ce/pull/121) | A villager's job is read right on 26.x |
| [#122](https://github.com/mindcraft-ce/mindcraft-ce/pull/122) | `useDoor` faces the doorway, not the door's corner |
| [#124](https://github.com/mindcraft-ce/mindcraft-ce/pull/124) | `craftRecipe` crafts nothing when its crafting table has no spot or can't be placed |
| [#125](https://github.com/mindcraft-ce/mindcraft-ce/pull/125) | `craftRecipe` says an item has no recipe instead of crashing |
| [#126](https://github.com/mindcraft-ce/mindcraft-ce/pull/126) | Worn armor isn't counted as carried, and NPC goals still count it as owned |
| [#127](https://github.com/mindcraft-ce/mindcraft-ce/pull/127) | `attackNearest` refuses an empty mob type before pausing any reflex |
| [#128](https://github.com/mindcraft-ce/mindcraft-ce/pull/128) | `attackEntity` names the player it killed |
| [#129](https://github.com/mindcraft-ce/mindcraft-ce/pull/129) | NPC item goals for uncraftable items run, hunting included |
| [#130](https://github.com/mindcraft-ce/mindcraft-ce/pull/130) | Novita retries a too-long conversation without its oldest turn, as meant |
| [#131](https://github.com/mindcraft-ce/mindcraft-ce/pull/131) | The pathfinder patch plans no slantwise steps past solid corners, for every skill (backports PrismarineJS/mineflayer-pathfinder#393; makes #113 unneeded) |


## Libraries

| Library | Pull request or issue | Fix |
|---|---|---|
| mineflayer | [PrismarineJS/mineflayer#4231](https://github.com/PrismarineJS/mineflayer/pull/4231) | `_syncWindow` waits for the answer to its own click, not an older copy of the window still on its way. This fork's chest sorting waits for the last copy itself |
| mineflayer | [PrismarineJS/mineflayer#4232](https://github.com/PrismarineJS/mineflayer/pull/4232) | `moveSlotItem` checks the open window's cursor, not the inventory's. This fork's chest sorting makes its own clicks |
| minecraft-data | [PrismarineJS/minecraft-data#1348](https://github.com/PrismarineJS/minecraft-data/pull/1348) | 26.3's entity attributes listed in the game's own order (stacked on #1345, the 26.3 data) |
| minecraft-data | [PrismarineJS/minecraft-data#1349](https://github.com/PrismarineJS/minecraft-data/pull/1349) | Bedrock 1.21.60 biomes numbered by Bedrock's own ids |
| mineflayer-pathfinder | [PrismarineJS/mineflayer-pathfinder#406](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/406) | `fullStop()` doesn't shift a Bedrock bot to the middle of its block |
| prismarine-block | [PrismarineJS/prismarine-block#136](https://github.com/PrismarineJS/prismarine-block/pull/136) | Bedrock `getSignText` reads `FrontText` and `BackText`, and no longer throws |
| mineflayer-util-plugin | [nxg-org/mineflayer-util-plugin#109](https://github.com/nxg-org/mineflayer-util-plugin/pull/109) | Version checks don't throw on a Bedrock registry. A report only: the library is GPL-3.0, so nothing from it is used here |
| bedrock-protocol | [PrismarineJS/bedrock-protocol#846](https://github.com/PrismarineJS/bedrock-protocol/issues/846) (issue) | `ping()` ignores `raknetBackend` |

### The Bedrock Adapter

Bedrock Edition runs on [Pix3lPirat3/mineflayer](https://github.com/Pix3lPirat3/mineflayer)'s
`feat/bedrock-edition-adapter` branch, not yet merged into mineflayer
([PrismarineJS/mineflayer#4145](https://github.com/PrismarineJS/mineflayer/issues/4145)). Each fix below is a
pull request to that branch from its own `bedrock-fix/...` branch on
[lantern-eight/mineflayer](https://github.com/lantern-eight/mineflayer). All of them are combined on that
fork's `bedrock-combined` branch, which the `bedrock` branch pins.

| Pull request | Fix |
|---|---|
| [#1](https://github.com/Pix3lPirat3/mineflayer/pull/1) | `bot.craft` keeps the server's stack id on the crafted item |
| [#2](https://github.com/Pix3lPirat3/mineflayer/pull/2) | `bot.withdraw` keeps the server's stack id on an item taken into an empty slot |
| [#3](https://github.com/Pix3lPirat3/mineflayer/pull/3) | Clicks use the block the world holds now, not the caller's stale copy |
| [#4](https://github.com/Pix3lPirat3/mineflayer/pull/4) | `bot.dig` lets go of a block once it's broken |
| [#5](https://github.com/Pix3lPirat3/mineflayer/pull/5) | A bot that isn't steering takes the server's corrections to its position |
| [#6](https://github.com/Pix3lPirat3/mineflayer/pull/6) | A bucket clicks the liquid or block in view, not the air |
| [#7](https://github.com/Pix3lPirat3/mineflayer/pull/7) | At most two ticks of movement made up after the bot stalls |
| [#8](https://github.com/Pix3lPirat3/mineflayer/pull/8) | A barrel's and a shulker box's slots are named by their own container id |
| [#9](https://github.com/Pix3lPirat3/mineflayer/pull/9) | A barrel reopened just after closing waits until it shows shut |
| [#10](https://github.com/Pix3lPirat3/mineflayer/pull/10) | `move` fires every tick the bot moved or turned |
| [#11](https://github.com/Pix3lPirat3/mineflayer/pull/11) | `openVillager` never hands back an earlier villager's trade window, and its `close()` works |
| [#12](https://github.com/Pix3lPirat3/mineflayer/pull/12) | Trading and the work stations send the result type their game version expects |
| [#13](https://github.com/Pix3lPirat3/mineflayer/pull/13) | `withdraw` and `deposit` move an amount across stacks, as on Java |
| [#14](https://github.com/Pix3lPirat3/mineflayer/pull/14) | A chunk's biomes are read when its blocks come by subchunk request |
| [#15](https://github.com/Pix3lPirat3/mineflayer/pull/15) | A loom puts in only the one dye a pattern uses |
| [#16](https://github.com/Pix3lPirat3/mineflayer/pull/16) | `consume()` eats the way the game's client does |

### Found, Not Offered

Shapes in the adapter that differ from mineflayer on Java, each put right in
`src/agent/bedrock/java_shapes.js`:

- `bot.openContainer` returns nothing where Java returns the window.
- `recipesFor` and `recipesAll` return the adapter's own recipe shape, not prismarine-recipe's.
- A click that changes a block needs the world's update before the next click on it; Java code doesn't wait.

## Working on a Library Fix

The libraries this fork pins are forked under [lantern-eight](https://github.com/lantern-eight). To fix one,
clone the fork outside this repository and add the original as a second remote. Each fix is a commit on the
fork's combined branch (the one the pin points at), and the same fix on a branch of its own from the
library's head, which is what is offered upstream once this fork's release has it.

| Fork | Its combined branch | Testing it |
|---|---|---|
| `mineflayer` (the Bedrock adapter) | `bedrock-combined`, on the adapter's `feat/bedrock-edition-adapter` | Link this repository's `node_modules` into the clone, then `npx -y mocha@11.0.1 --exit test/bedrock/*.test.js` and `npx -y standard@17`. Ten of the adapter's own tests and four lint errors in its files fail before any change of ours |
| `mineflayer-pathfinder` | `bedrock-combined` (2.4.5 with PrismarineJS/mineflayer-pathfinder#388) | Its own `npm install`, then `npx mocha` |
| `minecraft-data` | `pc26_3-combined` | `npx -y ajv-cli@5 validate --strict=false` against its schemas |
| `node-minecraft-data` | `pc26_3-combined` (the data as files, not a submodule) | Its own `npm install` and tests |
| `prismarine-block`, `mineflayer-util-plugin` | None: one `fix/...` branch each | Their own `npm install` and tests |

Testing against this repository's `node_modules` tests the copy installed here, not the clone, except for
files the clone's own tests load by path.
