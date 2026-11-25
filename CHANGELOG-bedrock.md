# Changelog for the bedrock Branch

What changed in releases of the `bedrock` branch alone: releases of its library pins, which `main` doesn't
have. Everything else, the Bedrock Edition code included, is in [CHANGELOG.md](CHANGELOG.md), which this
branch shares with `main`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the project's own: a version has a
part for each edition, as in `1.0.0-bedrock.1.0.0`, Java Edition's 1.0.0 and Bedrock Edition's 1.0.0. A
release here moves only the Bedrock part (`1.0.0-bedrock.1.0.1`), and the next release of `main` takes a
Bedrock part above it.

## [Unreleased]

### Changed

- The pinned Bedrock adapter (`lantern-eight/mineflayer` `bedrock-combined`, now at `843e62f`) has four more
  fixes of this fork's, each offered to its author: putting away into a barrel and fetching from one work, where
  a whole stack moved into or out of a barrel was refused; a bot can throw an item from its main inventory, not
  only from the hotbar, so `!bringItem` can hand over what it just took out of a chest; `recipesFor` hands
  out only recipes the bot holds every ingredient of; and `craft` closes the screen it opened. The bot
  already worked round the last two at the edition seam, so crafting doesn't change. It also has
  PrismarineJS/mineflayer#4103, which `main` pins for Java: each window keeps its own state id.

## [1.9.0-bedrock.1.10.2] - 2026-11-20

The first release of `bedrock`'s pins alone: the Bedrock adapter it pins now has the fix for letting go of keys,
which `main`'s 1.9.0-bedrock.1.10.1 lists among the offers upstream. `main`'s next release takes a Bedrock part
above this one.

### Changed

- The pinned Bedrock adapter (`lantern-eight/mineflayer` `bedrock-combined`, now at `8c8a368`) lets go of every key
  through `setControlState`, as mineflayer does on Java, with the fix offered to its author
  ([Pix3lPirat3/mineflayer#17](https://github.com/Pix3lPirat3/mineflayer/pull/17)). The bot already let go of its
  keys that way since 1.9.0-bedrock.1.10.0, so nothing changes for a player.

[Unreleased]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.9.0-bedrock.1.10.2...bedrock
[1.9.0-bedrock.1.10.2]: https://github.com/lantern-eight/mindcraft-ce/compare/v1.9.0-bedrock.1.10.1...v1.9.0-bedrock.1.10.2
