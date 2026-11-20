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

- The pinned Bedrock adapter (`lantern-eight/mineflayer` `bedrock-combined`, now at `8c8a368`) lets go of every key
  through `setControlState`, as mineflayer does on Java, with the fix offered to its author
  ([Pix3lPirat3/mineflayer#17](https://github.com/Pix3lPirat3/mineflayer/pull/17)). The bot already let go of its
  keys that way since 1.9.0-bedrock.1.10.0, so nothing changes for a player.
