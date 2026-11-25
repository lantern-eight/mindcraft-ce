// SPDX-License-Identifier: CC0-1.0
// Shears cut wool stairs and slabs as fast as a wool block. Minecraft 26.3 put those blocks under three new
// shears tags, and the generated game data gave shears a speed of 1 on all three, so the bot took as long with
// shears as by hand and chose its tool on wrong numbers. The pinned minecraft-data carries vanilla's speeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import { GAME_VERSION } from './helpers/game_version.js';

test('shears dig wool stairs and slabs as fast as a wool block, and faster than a hand', () => {
    const mc = minecraftData(GAME_VERSION);
    const Block = blockFactory(GAME_VERSION);
    const make = name => Block.fromStateId(mc.blocksByName[name].minStateId, 0);
    const shears = mc.itemsByName.shears.id;
    const wool = make('white_wool').digTime(shears, false, false, false);
    for (const name of ['white_wool_slab', 'white_wool_stairs']) {
        const block = make(name);
        assert.equal(block.digTime(shears, false, false, false), wool, `${name} with shears`);
        assert.ok(block.digTime(shears, false, false, false) < block.digTime(null, false, false, false), `${name} by hand`);
    }
});

test('the three shears tags carry vanilla\'s speeds', () => {
    const mc = minecraftData(GAME_VERSION);
    const shears = mc.itemsByName.shears.id;
    // Older versions have no such tags; there is nothing to check.
    if (!mc.materials.shears_major_breaking_speed) return;
    assert.equal(mc.materials.shears_extreme_breaking_speed[shears], 15);
    assert.equal(mc.materials.shears_major_breaking_speed[shears], 5);
    assert.equal(mc.materials.shears_minor_breaking_speed[shears], 2);
});
