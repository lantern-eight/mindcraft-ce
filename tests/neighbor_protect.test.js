// SPDX-License-Identifier: CC0-1.0
// Good-neighbor rules: the protection rule, the tree test, and where they are enforced.
//
// The rule and the tree test run on small hand-built worlds read through a stand-in reader, the way
// fair play hands them what the bot knows. The enforcement tests run the real pathfinder's route search
// for a stand-in bot, as the fair-legs tests do. No server, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import { fixtureWorld } from './helpers/fixture_world.js';
import { planRoute, walkerBot } from './helpers/walker_bot.js';
import { compileArea, createProtector } from '../src/agent/neighbor/protect.js';
import { guardBot, protectorOf } from '../src/agent/neighbor/enforce.js';
import { isNaturalTerrain, isTrunk } from '../src/agent/neighbor/natural.js';
import { installGoodNeighbor } from '../src/agent/neighbor/install.js';
import { javaEdition } from '../src/agent/edition/java.js';
import { translateNamesWith, wasBuilt } from '../src/agent/memory/kinds.js';

/** A protector over a fixture world, reading every cell (as with fair play off), with memory's tags in `tags`. */
function protectorFor(world, { tags = new Map(), areas = [], hidden = () => false, now = () => 0 } = {}) {
    const read = (x, y, z) => {
        if (hidden(x, y, z)) return null;
        const id = world.getStateId(x, y, z);
        if (id == null) return null;
        const name = world.registry.blocksByStateId[id].name;
        return { name, placedLeaves: name.endsWith('_leaves') ? javaEdition.leavesPersist(world.registry, id) : null };
    };
    const protector = createProtector({
        read, areas, now,
        tagOf: (x, y, z) => tags.get(`${x},${y},${z}`) ?? null,
        leavesPersist: id => javaEdition.leavesPersist(world.registry, id),
    });
    const blockAt = (x, y, z) => {
        const id = world.getStateId(x, y, z);
        return { name: world.registry.blocksByStateId[id].name, stateId: id, position: { x, y, z } };
    };
    return { protector, refusal: (x, y, z) => protector.refusal(blockAt(x, y, z)) };
}

/** Fills a box with a block in a chosen state (the fixture's own fill takes the default state). */
function fillState(world, name, [x0, y0, z0], [x1, y1, z1], props) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) world.set(name, x, y, z, props);
}

/** An oak tree on grass: a trunk from `y0` up `height` logs, under a blob of grown leaves. */
function oak(world, x, z, { y0 = 1, height = 5, leaves = { persistent: 'false' } } = {}) {
    world.set('grass_block', x, y0 - 1, z);
    for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dy === 1 && (Math.abs(dx) === 2 || Math.abs(dz) === 2)) continue;
        world.set('oak_leaves', x + dx, y0 + height - 1 + dy, z + dz, leaves);
    }
    for (let y = y0; y < y0 + height; y++) world.set('oak_log', x, y, z);
}

test('natural ground is free and made things are not, by name', () => {
    for (const name of ['stone', 'dirt', 'grass_block', 'deepslate', 'sand', 'diamond_ore', 'deepslate_iron_ore', 'netherrack', 'end_stone', 'poppy'])
        assert.equal(isNaturalTerrain(name), true, name);
    for (const name of ['oak_planks', 'cobblestone', 'glass', 'white_wool', 'rail', 'torch', 'stone_bricks', 'wheat', 'obsidian', 'chest'])
        assert.equal(isNaturalTerrain(name), false, name);
    assert.equal(isTrunk('oak_log'), true);
    assert.equal(isTrunk('stripped_oak_log'), false, 'a stripped log is worked wood');
    assert.equal(isTrunk('oak_wood'), false, 'bark on all sides is a building block');
});

test('a block that turns up where the bot saw empty space was built, unless it got there by itself', () => {
    assert.equal(wasBuilt('air', 'oak_planks'), true, 'planks appeared');
    assert.equal(wasBuilt('air', 'dirt'), true, 'dirt does not grow into empty space: someone stacked it');
    assert.equal(wasBuilt('stone', 'cobblestone'), true, 'a remembered block replaced');
    assert.equal(wasBuilt(null, 'oak_planks'), false, 'never seen before proves nothing');
    assert.equal(wasBuilt('air', 'gravel'), false, 'gravel falls');
    assert.equal(wasBuilt('air', 'oak_log'), false, 'saplings grow into trees');
    assert.equal(wasBuilt('air', 'oak_leaves'), false);
    assert.equal(wasBuilt('air', 'wheat'), false, 'crops grow');
    assert.equal(wasBuilt('grass_block', 'dirt'), false, 'grass dies back');
    assert.equal(wasBuilt('lava', 'cobblestone'), false, 'lava meeting water');
    assert.equal(wasBuilt('copper_block', 'exposed_copper'), false, 'copper weathers');
    assert.equal(wasBuilt('oak_planks', 'air'), false, 'a block gone is not a block built');
});

test('on Bedrock, a block that only changed its state under another name was not built', () => {
    // Bedrock names a burning furnace or a lit lamp as a block of its own; Java keeps one block with a property.
    translateNamesWith(name => ({ lit_furnace: { name: 'furnace' }, lit_redstone_lamp: { name: 'redstone_lamp' } })[name] ?? null);
    try {
        assert.equal(wasBuilt('furnace', 'lit_furnace'), false, 'a furnace lit');
        assert.equal(wasBuilt('lit_furnace', 'furnace'), false, 'and gone out');
        assert.equal(wasBuilt('redstone_lamp', 'lit_redstone_lamp'), false);
        assert.equal(wasBuilt('furnace', 'chest'), true, 'another block in its place still was');
    } finally { translateNamesWith(null); }
});

test('the rule: own blocks free, built and made blocks protected, natural ground free', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, 0, -8], [8, 0, 8]);
    world.set('oak_planks', 2, 1, 0);
    world.set('cobblestone', 3, 1, 0);
    world.set('dirt', 4, 1, 0);
    world.set('dirt', 5, 1, 0);
    const tags = new Map([['3,1,0', 'placed'], ['4,1,0', 'built']]);
    const { refusal } = protectorFor(world, { tags });
    assert.equal(refusal(0, 0, 0), null, 'stone');
    assert.equal(refusal(2, 1, 0)?.why, 'made', 'planks');
    assert.equal(refusal(3, 1, 0), null, 'cobblestone the bot placed itself');
    assert.equal(refusal(4, 1, 0)?.why, 'built', 'dirt the bot saw someone put there');
    assert.equal(refusal(5, 1, 0), null, 'dirt it knows nothing about');
});

test('a protected area from the settings covers everything in it, natural or not', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, 0, -8], [8, 0, 8]);
    const box = compileArea({ name: 'Base', min: { x: 2, y: -5, z: 2 }, max: { x: 6, y: 5, z: 6 } });
    const ring = compileArea({ name: 'Farm', x: -5, z: -5, radius: 2 });
    assert.equal(compileArea({ name: 'broken' }), null, 'an area with no shape is refused');
    const { refusal } = protectorFor(world, { areas: [box, ring] });
    assert.equal(refusal(3, 0, 3)?.why, 'area');
    assert.match(refusal(3, 0, 3).text, /"Base"/);
    assert.equal(refusal(-5, 0, -5)?.why, 'area');
    assert.equal(refusal(0, 0, 0), null);
});

test('a tree is free to fell, and stays a tree while it is felled', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, -1, -8], [8, -1, 8]);
    oak(world, 0, 0);
    const now = { t: 0 };
    const { refusal } = protectorFor(world, { now: () => now.t });
    assert.equal(refusal(0, 1, 0), null, 'the lowest log of a tree');
    // The bottom two logs are cut and the leaves fall: what is left is still the tree it was.
    world.set('air', 0, 1, 0);
    world.set('air', 0, 2, 0);
    world.fill('air', [-2, 3, -2], [2, 6, 2]);
    world.set('oak_log', 0, 3, 0); world.set('oak_log', 0, 4, 0); world.set('oak_log', 0, 5, 0);
    assert.equal(refusal(0, 3, 0), null, 'a half-felled trunk');
});

test('a log cabin is not a tree, even under a tree\'s leaves', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, -1, -8], [8, -1, 8]);
    // A wall of logs with a plank door frame, under a canopy of grown leaves.
    world.fill('oak_log', [0, 0, 0], [4, 3, 0]);
    world.set('oak_planks', 2, 0, 0); world.set('oak_planks', 2, 1, 0);
    world.fill('oak_leaves', [-1, 4, -1], [5, 4, 1]); // grown leaves: the default state
    const { refusal } = protectorFor(world);
    assert.equal(refusal(0, 0, 0)?.why, 'not a tree');
    assert.equal(refusal(4, 3, 0)?.why, 'not a tree');
});

test('a pillar of logs with no canopy, or under placed leaves, is not a tree', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, -1, -8], [8, -1, 8]);
    world.fill('oak_log', [0, 0, 0], [0, 4, 0]);
    world.fill('birch_log', [4, 0, 0], [4, 4, 0]);
    fillState(world, 'birch_leaves', [3, 5, -1], [5, 5, 1], { persistent: 'true' });
    const { refusal } = protectorFor(world);
    assert.equal(refusal(0, 0, 0)?.why, 'not a tree', 'bare pillar');
    assert.equal(refusal(4, 0, 0)?.why, 'not a tree', 'leaves a player placed are no canopy');
    assert.equal(refusal(4, 5, 0)?.why, 'made', 'and the placed leaves themselves are protected');
});

test('a bare trunk running up out of sight is taken for a tree, until its top is seen bare', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, -1, -8], [8, -1, 8]);
    world.fill('oak_log', [0, 0, 0], [0, 4, 0]);       // a pillar with nothing on top
    let looked = false, t = 0;
    const { refusal } = protectorFor(world, { hidden: (x, y) => !looked && y >= 3, now: () => t });
    assert.equal(refusal(0, 0, 0), null, 'its top out of sight: a tree, as a player at its foot would take it');
    looked = true;
    t += 10_000;
    assert.equal(refusal(0, 0, 0)?.why, 'not a tree', 'seen whole, with no leaves on it');
});

test('a wall of logs whose top is out of sight is still not a tree: it is wider than a trunk', () => {
    const world = fixtureWorld();
    world.fill('stone', [-8, -1, -8], [8, -1, 8]);
    world.fill('oak_log', [0, 0, 0], [4, 4, 0]);
    const { refusal } = protectorFor(world, { hidden: (x, y) => y >= 3 });
    assert.equal(refusal(0, 0, 0)?.why, 'not a tree');
});

test('a 2x2 spruce is a tree', () => {
    const world = fixtureWorld();
    world.fill('podzol', [-8, 0, -8], [8, 0, 8]);
    world.fill('spruce_log', [0, 1, 0], [1, 20, 1]);
    for (let y = 8; y <= 22; y += 2) world.fill('spruce_leaves', [-2, y, -2], [3, y, 3]);
    world.fill('spruce_log', [0, 8, 0], [1, 20, 1]); // the trunk runs through its own leaves
    const { refusal } = protectorFor(world);
    assert.equal(refusal(0, 1, 0), null);
    assert.equal(refusal(1, 1, 1), null);
});

// ---- Enforcement ----

function plankWallWorld() {
    const world = fixtureWorld({ min: [-32, -4, -32], max: [32, 16, 32] });
    world.fill('stone', [-32, 0, -32], [32, 0, 32]);
    // A sealed room of planks around the target, and a stone hill beside the way.
    world.fill('oak_planks', [8, 1, -2], [12, 4, 2]);
    world.fill('air', [9, 1, -1], [11, 3, 1]);
    return world;
}

test('the pathfinder digs through stone but never plans through a player\'s planks', () => {
    const world = plankWallWorld();
    const bot = walkerBot(world);
    const { protector } = protectorFor(world);
    const unguard = guardBot(bot, protector);
    try {
        const movements = new pf.Movements(bot);
        const into = planRoute(bot, movements, new pf.goals.GoalBlock(10, 1, 0));
        assert.notEqual(into.status, 'success', 'no way into the sealed plank room');
        assert.equal(into.path.some(step => step.toBreak?.some(b => world.registry.blocksByStateId[world.getStateId(b.x, b.y, b.z)]?.name === 'oak_planks')), false);
        world.fill('stone', [3, 1, 4], [5, 3, 8]);
        const through = planRoute(bot, new pf.Movements(bot), new pf.goals.GoalBlock(4, 1, 6));
        assert.equal(through.status, 'success', 'stone is dug through as before');
        // And a block the pathfinder may break is still the library's call first.
        const noDig = new pf.Movements(bot);
        noDig.canDig = false;
        assert.equal(noDig.safeToBreak(bot.blockAt(new Vec3(4, 1, 6))), false);
    } finally { unguard(); }
    assert.equal(protectorOf(bot), null);
    const unguarded = planRoute(bot, new pf.Movements(bot), new pf.goals.GoalBlock(10, 1, 0));
    assert.equal(unguarded.status, 'success', 'without the rule the pathfinder digs in, as stock Mindcraft does');
});

test('digging a protected block is refused with words the model can act on', async () => {
    const world = plankWallWorld();
    const bot = walkerBot(world);
    let dug = null;
    bot.dig = async block => { dug = block.name; };
    const { protector } = protectorFor(world);
    const unguard = guardBot(bot, protector);
    try {
        await assert.rejects(bot.dig(bot.blockAt(new Vec3(8, 1, 0))), error => error.code === 'good_neighbor'
            && /Breaking oak_planks at 8, 1, 0 refused: oak_planks isn't natural ground/.test(error.message));
        assert.equal(dug, null);
        await bot.dig(bot.blockAt(new Vec3(0, 0, 0)));
        assert.equal(dug, 'stone');
    } finally { unguard(); }
});

test('the install reads the settings, and counts what the bot placed this session as its own while it stands', async () => {
    const world = plankWallWorld();
    const bot = walkerBot(world);
    bot.dig = async () => {};
    const off = installGoodNeighbor({ bot }, { config: { fair_play: 'off', good_neighbor: { protect_builds: false } } });
    assert.equal(off, null);
    const on = installGoodNeighbor({ bot }, { config: { fair_play: 'off', good_neighbor: { protect_builds: true, protected_areas: [{ name: 'x' }] } } });
    try {
        await assert.rejects(bot.dig(bot.blockAt(new Vec3(8, 1, 0))));
        bot.emit('blockPlaced', null, { position: new Vec3(8, 1, 0), name: 'oak_planks' });
        await bot.dig(bot.blockAt(new Vec3(8, 1, 0)));
        // Someone else puts their own block where the bot's was: that one is theirs.
        bot.emit('blockUpdate', null, { position: new Vec3(8, 1, 0), name: 'air' });
        bot.emit('blockUpdate', null, { position: new Vec3(8, 1, 0), name: 'oak_planks' });
        await assert.rejects(bot.dig(bot.blockAt(new Vec3(8, 1, 0))));
    } finally { on.stop(); }
});
