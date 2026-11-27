# Offered Upstream

Fixes this fork has made to code it inherited, and offered back to the project the code came from. Each one is
already on `main` (or, for a library, in the copy `package.json` pins), so this fork doesn't wait on them. When
one is merged upstream, the next update brings a change this fork already has, and goes in cleanly. Each pull
request says why the fix is needed and how it was tested.

How a fix is made and offered is in [CLAUDE.md](../CLAUDE.md), "Fixes to Inherited Code". Libraries pinned to
unreleased work, and the release each waits for, are in
[core-hooks.md](core-hooks.md#dependencies-pinned-to-a-branch).

*As of `1.29.0-bedrock.1.31.0`.* A line is removed once its fix is merged upstream and this fork is on a release
that has it. A fix that is declined stays on `main`, and its line says so.

## Mindcraft-CE

Pull requests to [mindcraft-ce/mindcraft-ce](https://github.com/mindcraft-ce/mindcraft-ce), on `develop`, the
branch this fork is built on. Each comes from a `fix/...` branch of this repository, cut from `develop`, so it
holds the fix and nothing else.

### Open

| Pull request | Fix |
|---|---|
| [#116](https://github.com/mindcraft-ce/mindcraft-ce/pull/116) | Position packets stay in their own tick once the client sends `tick_end` |
| [#147](https://github.com/mindcraft-ce/mindcraft-ce/pull/147) | `putInChest`, `takeFromChest` and `viewChest` use the nearest chest, trapped chest or barrel, not chests alone |
| [#150](https://github.com/mindcraft-ce/mindcraft-ce/pull/150) | With native tools on, the system prompt no longer holds a second copy of the tool list, which already goes in the request's tools field: about 7,000 tokens less a call |
| [#151](https://github.com/mindcraft-ce/mindcraft-ce/pull/151) | With native tools on, Claude and Gemini get the conversation's system notes where they happened, not glued onto the end of the system prompt |
| [#152](https://github.com/mindcraft-ce/mindcraft-ce/pull/152) | Claude 4.6 and later on the text path: no request ending on the bot's own turn, 16,000 tokens by default (kept out of the tool path's parameters), a refusal said as one, one retry after an empty reply. Ported from r77tchan's fork |
| [#153](https://github.com/mindcraft-ce/mindcraft-ce/pull/153) | The same on the native tool path: no request ending on the bot's own turn, 16,000 tokens by default, a refusal raised as declined |
| [#154](https://github.com/mindcraft-ce/mindcraft-ce/pull/154) | Usage counts prompt cache writes per role and prices them by `cache_write_per_million` when the rates give one |
| [#155](https://github.com/mindcraft-ce/mindcraft-ce/pull/155) | With native tools off, the conversing prompt puts its fixed instructions and the command list before the parts that change each turn, so providers that cache a repeated start can reuse them |

### Merged, With a Difference Kept

Every other fix this fork has offered Mindcraft-CE is in `develop`, and this fork is on a release that has it.
Two of them, #138 and #140 (creepers and running from mobs), were closed and merged as one in the maintainer's
own form, [#145](https://github.com/mindcraft-ce/mindcraft-ce/pull/145), which this fork takes. In one,
[#132](https://github.com/mindcraft-ce/mindcraft-ce/pull/132), the maintainer chose other wording, and this
fork keeps its own:
`getFirstBlockAboveHead` stops at the first spot it has no block for and says "unknown (incomplete scan)" on
`develop`, where this fork says how far up that spot is ("unknown (2 blocks up)"). Under fair play that spot
is one the bot hasn't seen, not a scan that failed, and its height is what tells the model how much open space
there is.

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
| [#17](https://github.com/Pix3lPirat3/mineflayer/pull/17) | `clearControlStates()` lets go of each key through `setControlState()`, as on Java. Also put right on the bot in `java_shapes.js` |
| [#18](https://github.com/Pix3lPirat3/mineflayer/pull/18) | A drop from the main inventory opens the inventory screen for it, so an item just taken out of a chest can be thrown |
| [#19](https://github.com/Pix3lPirat3/mineflayer/pull/19) | `recipesFor` counts every ingredient against what the bot holds. Also put right on the bot in `java_shapes.js` |
| [#20](https://github.com/Pix3lPirat3/mineflayer/pull/20) | `craft` closes the screen it opened. Also put right on the bot in `java_shapes.js` |
| [#21](https://github.com/Pix3lPirat3/mineflayer/pull/21) | A whole stack clicked into or out of a barrel or a shulker box names their slots as #8 does |
| [#22](https://github.com/Pix3lPirat3/mineflayer/pull/22) | A blast furnace and a smoker get the furnace window calls, with their own name for the input slot |

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
