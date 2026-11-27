// SPDX-License-Identifier: CC0-1.0
// The exploring loop on a pretend world: legs walk in a straight line and stop at whatever is in the way, so
// each test can set up a wall, a lake or a thing to find and see what the explorer makes of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explore } from '../src/agent/explore/explorer.js';
import { ON, parseDirection } from '../src/agent/explore/heading.js';

/**
 * A flat pretend world. `wall(x, z)` and `water(x, z)` say what is at a column. A leg walks one block at a
 * time towards its point and stops in front of the first wall or water. `sees` is how far the bot sees things.
 */
function world({ wall = () => false, water = () => false, things = [], sees = 20, remembered = [], stopAfter = Infinity,
    hazard = null, kinds = null } = {}) {
    const pos = { x: 0.5, y: 64, z: 0.5 };
    const log = { walks: [], looks: 0 };
    let walks = 0;
    const legs = {
        position: () => ({ ...pos }),
        interrupted: () => walks > stopAfter,
        async walk(point) {
            walks++;
            log.walks.push({ from: { ...pos }, to: point });
            const length = Math.hypot(point.x - pos.x, point.z - pos.z);
            const dx = (point.x - pos.x) / length, dz = (point.z - pos.z) / length;
            for (let i = 0; i < Math.floor(length); i++) {
                const nx = pos.x + dx, nz = pos.z + dz;
                if (water(Math.floor(nx), Math.floor(nz))) return 'water';
                if (wall(Math.floor(nx), Math.floor(nz))) return i === 0 ? 'no_path' : 'stalled';
                pos.x = nx; pos.z = nz;
            }
            return 'arrived';
        },
        async lookAround() { log.looks++; return true; },
        newGround: () => null,
        find: () => things.find(t => Math.hypot(t.x - pos.x, t.z - pos.z) <= sees) ?? null,
        recall: max => remembered.find(t => Math.hypot(t.x - pos.x, t.z - pos.z) <= max) ?? null,
    };
    if (hazard) legs.knownHazard = point => { log.asked = (log.asked ?? 0) + 1; return hazard(Math.floor(point.x), Math.floor(point.z)); };
    if (kinds) legs.kinds = () => kinds(pos);
    return { legs, pos, log };
}

test('told a direction, the bot walks that far that way, in legs, looking round after each', async () => {
    const { legs, pos, log } = world();
    const result = await explore({ legs, direction: parseDirection('east'), distance: 100 });
    assert.equal(result.status, 'explored');
    assert.ok(pos.x >= 98 && pos.x <= 106 && Math.abs(pos.z) < 1, JSON.stringify(pos));
    assert.equal(log.walks.length, 4, 'legs of 32, the last one shorter');
    assert.equal(log.looks, 4);
    assert.match(result.text, /^Explored \d+ blocks east, heading east; now at \d+, 64, 0\./);
    assert.deepEqual(result.trail.origin, { x: 0.5, z: 0.5 });
    assert.equal(result.trail.bearing, true);
});

test('a wall across the way is walked round, and the bearing taken up again past it', async () => {
    const { legs, pos, log } = world({ wall: (x, z) => x === 20 && z >= -12 && z <= 12 });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 100 });
    assert.equal(result.status, 'explored');
    assert.ok(pos.x > 40, `got past the wall: ${JSON.stringify(pos)}`);
    assert.match(result.text, /no way through to the east/);
    const last = log.walks.at(-1);
    assert.ok(Math.abs(last.to.z - last.from.z) < 1e-6 && last.to.x > last.from.x, 'the last leg went east again');
});

test('water ahead is not swum out into: the bot turns along the shore and says so', async () => {
    const { legs, pos } = world({ water: x => x > 40 });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 100 });
    assert.ok(pos.x <= 41, 'never out over the water');
    assert.match(result.text, /water to the east/);
});

test('walled in every way, it stops and says it could not go on', async () => {
    const { legs } = world({ wall: (x, z) => Math.abs(x) >= 3 || Math.abs(z) >= 3 });
    const result = await explore({ legs, direction: ON, distance: 60, random: () => 0 });
    assert.equal(result.status, 'blocked');
    assert.match(result.text, /^Could not go on from -?\d+, 64, -?\d+: every way is blocked\. Turned aside for no way through 7 ways\./);
});

test('exploring for something stops as soon as it is seen', async () => {
    const { legs, pos } = world({ things: [{ name: 'sand', x: 70, y: 62, z: 6 }] });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 200, targets: ['sand'] });
    assert.equal(result.status, 'found');
    assert.equal(result.found.name, 'sand');
    assert.ok(pos.x < 100, 'stopped instead of walking on');
    assert.match(result.text, /^Found sand \d+ blocks [a-z-]+, at 70, 62, 6, after exploring 64 blocks\./);
});

test('something already in view or remembered sends the bot nowhere', async () => {
    const near = world({ things: [{ name: 'cow', x: 5, y: 64, z: 5 }] });
    const seen = await explore({ legs: near.legs, direction: ON, distance: 100, targets: ['cow'] });
    assert.equal(seen.status, 'found');
    assert.equal(near.log.walks.length, 0);
    assert.match(seen.text, /^cow is 6 blocks south-east, at 5, 64, 5\./);

    const far = world({ remembered: [{ name: 'sand', x: -150, y: 62, z: 0 }] });
    const known = await explore({ legs: far.legs, direction: parseDirection('east'), distance: 200, targets: ['sand'] });
    assert.equal(known.status, 'known');
    assert.equal(far.log.walks.length, 0);
    assert.match(known.text, /^You remember sand 151 blocks west, at -150, 62, 0\./);
});

test('a second call to explore on carries on the same way from where the first stopped', async () => {
    const { legs, pos, log } = world();
    const first = await explore({ legs, direction: parseDirection('north-west'), distance: 40 });
    const second = await explore({ legs, direction: ON, distance: 40, last: first.trail });
    assert.equal(second.status, 'explored');
    assert.ok(pos.x < -50 && pos.z < -50, JSON.stringify(pos));
    assert.deepEqual(second.trail.origin, first.trail.origin);
    for (const walk of log.walks) assert.ok(walk.to.x < walk.from.x && walk.to.z < walk.from.z, 'every leg went north-west');
});

test('exploring freely, a turn that got round something becomes the new heading', async () => {
    const { legs } = world({ wall: (x, z) => x === 10 && z >= -40 && z <= 40 });
    const result = await explore({ legs, direction: ON, distance: 60, random: () => 0 }); // starts east
    assert.equal(result.status, 'explored');
    assert.notEqual(result.trail.heading, 0, 'no longer heading east into the wall');
});

test('told to stop, it stops at once', async () => {
    const { legs, log } = world({ stopAfter: 1 });
    const result = await explore({ legs, direction: parseDirection('south'), distance: 200 });
    assert.equal(result.status, 'interrupted');
    assert.equal(log.walks.length, 2);
});

test('one block is a block', async () => {
    const { whereFrom } = await import('../src/agent/explore/explorer.js');
    assert.equal(whereFrom({ x: 0, y: 64, z: 0 }, { x: 0, y: 63, z: 0 }), '1 block below');
    assert.equal(whereFrom({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: -2 }), '2 blocks north');
});

test('a leg whose end the bot remembers as water is not walked: it turns aside before setting out, and says so', async () => {
    // A lake to the east from x 30 on, remembered, and no wall: walked into, the pretend legs would not stop.
    const { legs, log } = world({ hazard: (x, z) => (x >= 30 && Math.abs(z) < 30 ? 'water' : null) });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 64 });
    assert.ok(log.walks.every(w => w.to.x < 30 || Math.abs(w.to.z) >= 30), `never set out into it: ${JSON.stringify(log.walks.map(w => w.to))}`);
    assert.match(result.text, /Turned aside for water to the east/);
});

test('a bad end may still do at half the length', async () => {
    const { legs, log } = world({ hazard: x => (x >= 20 ? 'drop' : null) });
    await explore({ legs, direction: parseDirection('east'), distance: 16 + 4 });
    assert.ok(log.walks[0].to.x < 20 && log.walks[0].to.x > 10, JSON.stringify(log.walks[0].to));
    assert.ok(Math.abs(log.walks[0].to.z - 0.5) < 1e-6, 'still east');
});

test('a drop and lava are named for what they are', async () => {
    const { legs } = world({ hazard: (x, z) => (x >= 10 ? 'drop' : z >= 10 ? 'lava' : null) });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 64 });
    assert.match(result.text, /a drop to the east/);
    assert.match(result.text, /lava to the south\b/);
});

test('when memory says every way is bad, the first is walked anyway: memory can be out of date', async () => {
    const { legs, log } = world({ hazard: () => 'water' });
    await explore({ legs, direction: parseDirection('north'), distance: 32 });
    assert.ok(log.walks.length >= 1);
    assert.ok(log.walks[0].to.z < -20, 'went north');
});

test('kinds of ground first seen on the way are named, and the ones seen at the start are not', async () => {
    const kinds = pos => [...(pos.x < 10 ? ['oak_log'] : []), 'grass_block', ...(pos.x > 50 ? ['sand', 'water'] : [])];
    const { legs } = world({ kinds });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 100 });
    assert.match(result.text, / Came across: sand, water\.$/);
    assert.deepEqual(result.newKinds, ['sand', 'water']);
});

test('with nothing new on the way, nothing is said of it', async () => {
    const { legs } = world({ kinds: () => ['grass_block'] });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 64 });
    assert.doesNotMatch(result.text, /Came across/);
});

test('water remembered only partway along a leg, as at a lake\'s near shore, is turned from too', async () => {
    // Memory reaches about as far as a look round: the lake's near half is remembered, its far half and the
    // leg's end are not.
    const { legs, log } = world({ hazard: (x, z) => (x >= 14 && x <= 24 && Math.abs(z) < 12 ? 'water' : null) });
    const result = await explore({ legs, direction: parseDirection('east'), distance: 32 });
    assert.ok(!(log.walks[0].to.x > 20 && Math.abs(log.walks[0].to.z) < 12), `didn't set out across it: ${JSON.stringify(log.walks[0].to)}`);
    assert.match(result.text, /water to the east/);
});

test('in a cave, a way not seen from one spot is tried again a few steps on, and a short leg that arrives counts', async () => {
    // A passage east to x 20, north to z -30, then east again. The legs see on only along the passage: from
    // the bend's foot the way east is unseen, and from the top of the north passage it opens up.
    const pos = { x: 0.5, y: 64, z: 0.5 };
    const open = (x, z) => (x >= 0 && x <= 21 && Math.abs(z) <= 1) || (x >= 19 && x <= 21 && z <= 1 && z >= -31) || (x >= 19 && x <= 80 && z >= -31 && z <= -29);
    const legs = {
        position: () => ({ ...pos }),
        interrupted: () => false,
        async walk(point) {
            // Walk the open cells straight towards the point, as far as they go; nothing open that way is unseen.
            const length = Math.hypot(point.x - pos.x, point.z - pos.z);
            const dx = (point.x - pos.x) / length, dz = (point.z - pos.z) / length;
            let steps = 0;
            while (steps < length && open(Math.floor(pos.x + dx * (steps + 1)), Math.floor(pos.z + dz * (steps + 1)))) steps++;
            if (steps < 3) return 'unseen';
            pos.x += dx * steps; pos.z += dz * steps;
            return 'arrived';
        },
        async lookAround() {},
        newGround: () => null,
        find: () => null,
    };
    const result = await explore({ legs, direction: parseDirection('east'), distance: 80 });
    assert.ok(pos.x > 40 && pos.z < -25, `round both bends: ${JSON.stringify(pos)} ${result.text}`);
});
