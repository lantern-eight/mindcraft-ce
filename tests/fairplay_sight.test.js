// SPDX-License-Identifier: CC0-1.0
// Fair-play sight core: "could a survival player standing here see that block or mob?"
//
// Each test builds a small world by hand. The bot's eye sits at x 0.5, y 2.62, z 0.5 (standing on a
// floor at y 1, eye height 1.62) and looks east (+x) toward the thing being tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureWorld } from './helpers/fixture_world.js';
import { buildStopsSightTable, createSight, viewDirection } from '../src/agent/fairplay/sight.js';

const EYE = { x: 0.5, y: 2.62, z: 0.5 };

function setup(build) {
    const world = fixtureWorld();
    world.fill('stone', [-16, 0, -16], [16, 0, 16]); // floor under everything
    build(world);
    const sight = createSight({ getStateId: world.getStateId, stopsSight: buildStopsSightTable(world.registry) });
    return { world, sight };
}

test('stops-sight table marks only full opaque cubes, using filterLight rather than "transparent"', () => {
    const world = fixtureWorld();
    const table = buildStopsSightTable(world.registry);
    const stops = name => table[world.stateIdOf(name)] === 1;
    // minecraft-data calls chests, slabs, stairs and fences non-transparent, but you can see past them.
    for (const name of ['stone', 'diamond_ore', 'deepslate_iron_ore', 'furnace', 'oak_log', 'packed_ice', 'sand'])
        assert.equal(stops(name), true, name);
    for (const name of ['air', 'cave_air', 'water', 'glass', 'tinted_glass', 'oak_leaves', 'chest', 'oak_slab',
        'oak_stairs', 'oak_fence', 'torch', 'spawner', 'ice', 'barrier'])
        assert.equal(stops(name), false, name);
});

test('a double slab is a wall, a single slab is not', () => {
    const world = fixtureWorld();
    const table = buildStopsSightTable(world.registry);
    assert.equal(table[world.stateIdOf('oak_slab', { type: 'double' })], 1);
    assert.equal(table[world.stateIdOf('oak_slab', { type: 'bottom' })], 0);
    assert.equal(table[world.stateIdOf('oak_slab', { type: 'top' })], 0);
    assert.equal(world.registry.blocksByStateId[world.stateIdOf('oak_slab', { type: 'double' })].name, 'oak_slab');

    const hidden = setup(w => {
        for (let z = -3; z <= 3; z++) for (let y = 1; y <= 6; y++) w.set('stone_slab', 4, y, z, { type: 'double' });
        w.set('diamond_ore', 8, 2, 0);
    });
    assert.equal(hidden.sight.canSeeBlock(EYE, 8, 2, 0), null, 'a wall of double slabs hides the ore');
    const low = setup(w => {
        for (let z = -3; z <= 3; z++) w.set('stone_slab', 4, 1, z, { type: 'bottom' });
        w.set('diamond_ore', 8, 2, 0);
    });
    assert.ok(low.sight.canSeeBlock(EYE, 8, 2, 0), 'a row of single slabs does not');
});

test('S1: an ore buried inside stone is not seen, while the stone face in front of it is', () => {
    const { sight } = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0);
    });
    assert.equal(sight.hasOpenFace(6, 3, 0), false);
    assert.equal(sight.canSeeBlock(EYE, 6, 3, 0), null);
    assert.ok(sight.canSeeBlock(EYE, 4, 2, 0), 'the near face of the stone is in plain view');
});

test('S2: an ore on the wall of a tunnel the bot is looking down is seen', () => {
    const { sight } = setup(w => {
        w.fill('stone', [4, 1, -3], [12, 6, 3]);
        w.fill('air', [4, 2, 0], [10, 3, 0]); // tunnel opening toward the bot
        w.set('diamond_ore', 8, 2, 1); // in the tunnel's side wall
    });
    const seen = sight.canSeeBlock(EYE, 8, 2, 1);
    assert.ok(seen, 'ore on the tunnel wall should be visible');
    assert.deepEqual(seen.face, [0, 0, -1], 'it is seen through its face toward the tunnel');
});

test('S3: an ore exposed to a sealed cave has an open face but is not seen (rays beat the open-face rule)', () => {
    const { sight } = setup(w => {
        w.fill('stone', [4, 1, -3], [14, 6, 3]);
        w.fill('air', [8, 2, 0], [10, 3, 0]); // a cave pocket with no way to see into it
        w.set('diamond_ore', 11, 2, 0);
    });
    assert.equal(sight.hasOpenFace(11, 2, 0), true, 'the open-face rule alone would report this ore');
    assert.equal(sight.canSeeBlock(EYE, 11, 2, 0), null, 'but no line from the eye reaches it');
});

test('S4: an ore is seen through glass, tinted glass, leaves, and water', () => {
    for (const window of ['glass', 'tinted_glass', 'oak_leaves', 'water']) {
        const { sight } = setup(w => {
            w.fill('stone', [4, 1, -3], [4, 6, 3]); // a wall
            w.set(window, 4, 2, 0); // with one see-through block in it
            w.set('diamond_ore', 8, 2, 0); // standing alone in the open beyond the wall
        });
        assert.ok(sight.canSeeBlock(EYE, 8, 2, 0), `seen through ${window}`);
    }
});

test('S5: the ore one block behind a freshly dug face (Paper sends it after a dig) is not seen', () => {
    const { sight } = setup(w => {
        w.fill('stone', [4, 1, -3], [12, 6, 3]);
        w.fill('air', [4, 2, 0], [6, 3, 0]); // the bot has tunnelled to x 6
        w.set('iron_ore', 8, 2, 0); // stone at x 7 still covers it
    });
    assert.equal(sight.hasOpenFace(8, 2, 0), false);
    assert.equal(sight.canSeeBlock(EYE, 8, 2, 0), null);
});

test('S6: cells the client has not received block sight', () => {
    const { sight } = setup(w => {
        w.set('diamond_ore', 10, 2, 0);
        w.unload([6, -16, -16], [7, 32, 16]);
    });
    assert.equal(sight.canSeeBlock(EYE, 10, 2, 0), null);
});

test('a block right next to the bot in a one-wide tunnel is seen', () => {
    const { sight } = setup(w => {
        w.fill('stone', [-1, 1, -1], [3, 4, 1]);
        w.fill('air', [0, 2, 0], [2, 3, 0]); // the bot stands in a dead-end tunnel
        w.set('coal_ore', 3, 2, 0); // the tunnel's end face
        w.set('coal_ore', 1, 2, 1); // a side wall beside the bot's feet
    });
    assert.ok(sight.canSeeBlock(EYE, 3, 2, 0));
    assert.ok(sight.canSeeBlock(EYE, 1, 2, 1));
});

test('a face that points away from the eye does not count, even with air behind the block', () => {
    const { sight } = setup(w => {
        w.fill('stone', [4, 1, -3], [4, 6, 3]); // a solid wall
        w.set('gold_ore', 5, 2, 0); // ore on the far side of the wall, open to the east
    });
    assert.equal(sight.hasOpenFace(5, 2, 0), true);
    assert.equal(sight.canSeeBlock(EYE, 5, 2, 0), null);
});

test('maximum distance limits sight', () => {
    const { sight } = setup(w => w.set('diamond_ore', 20, 2, 0));
    assert.ok(sight.canSeeBlock(EYE, 20, 2, 0));
    assert.equal(sight.canSeeBlock(EYE, 20, 2, 0, { maxDistance: 16 }), null);
});

test('field of view limits sight when narrowed, and 360 degrees sees all around', () => {
    const { sight } = setup(w => w.set('diamond_ore', 8, 2, 0)); // east of the bot
    const facingNorth = viewDirection(0, 0); // yaw 0 faces -z in mineflayer
    assert.ok(Math.abs(facingNorth.z + 1) < 1e-9 && Math.abs(facingNorth.x) < 1e-9);
    assert.ok(sight.canSeeBlock(EYE, 8, 2, 0, { fovDegrees: 360, viewDir: facingNorth }));
    assert.equal(sight.canSeeBlock(EYE, 8, 2, 0, { fovDegrees: 90, viewDir: facingNorth }), null);
    const facingEast = viewDirection(-Math.PI / 2, 0);
    assert.ok(sight.canSeeBlock(EYE, 8, 2, 0, { fovDegrees: 90, viewDir: facingEast }));
});

test('E1: a mob behind a wall is not seen; a window at head height is enough to see it', () => {
    const zombie = { position: { x: 8.5, y: 1, z: 0.5 }, height: 1.95 };
    const walled = setup(w => w.fill('stone', [4, 1, -3], [4, 6, 3]));
    assert.equal(walled.sight.canSeeEntity(EYE, zombie), false);

    const windowed = setup(w => {
        w.fill('stone', [4, 1, -3], [4, 6, 3]);
        w.set('glass', 4, 2, 0); // head-height window
    });
    assert.equal(windowed.sight.canSeeEntity(EYE, zombie), true);

    const open = setup(() => {});
    assert.equal(open.sight.canSeeEntity(EYE, zombie), true);
    assert.equal(open.sight.canSeeEntity(EYE, zombie, { maxDistance: 4 }), false);
});

test('lines through a diagonal gap between two solid blocks are blocked, not leaked through the corner', () => {
    const { sight } = setup(w => {
        // Two stones touching only at an edge, with the target straight beyond that edge.
        w.set('stone', 2, 2, 0);
        w.set('stone', 3, 2, 1);
        w.fill('stone', [2, 3, -1], [3, 3, 1]); // a lid, so the only way through is the edge
    });
    // The point sits exactly on the shared edge's line of travel; either neighbour cell blocks it.
    assert.equal(sight.canSeePoint({ x: 2.5, y: 2.5, z: 1.5 }, { x: 3.5, y: 2.5, z: 0.5 }), false);
});

test('canSeePoint never treats the eye cell itself as an obstacle', () => {
    const { sight } = setup(w => w.set('water', 0, 2, 0)); // bot standing with its head in water
    assert.equal(sight.canSeePoint({ x: 0.5, y: 2.62, z: 0.5 }, { x: 5.5, y: 2.5, z: 0.5 }), true);
});
