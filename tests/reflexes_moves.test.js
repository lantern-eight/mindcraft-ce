// SPDX-License-Identifier: CC0-1.0
// backOffFrom's first step: straight away from the threat when that is safe, never into lava or fire or
// off a drop of more than 2 blocks, and only over cells the bot knows. Blocks come from a map, as they
// would from world.js's provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { firstStep, safeCell, guardStep, retreatFrom, backAwayFacing } from '../src/agent/reflexes/moves.js';
import { createShield } from '../src/agent/reflexes/shield.js';
import { createItemUse } from '../src/agent/reflexes/item_use.js';
import '../src/agent/bedrock/edition.js';

// A flat stone floor with its top at y 63, air above, and whatever `cells` changes. "x,y,z" -> name;
// null in `cells` means the bot doesn't know that cell.
function world(cells = {}) {
    return pos => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (key in cells) return cells[key] === null ? null : { name: cells[key], boundingBox: /air|lava|fire|water/.test(cells[key]) ? 'empty' : 'block' };
        return pos.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
    };
}
const feet = { x: 0.5, y: 64, z: 0.5 };
const creeperWest = { x: -2.5, y: 64, z: 0.5 };

test('on open ground the first step is straight away from the threat', () => {
    const step = firstStep(world(), feet, creeperWest);
    assert.ok(step.x > 0.99 && Math.abs(step.z) < 0.01, JSON.stringify(step));
});

test('lava straight ahead turns the step aside', () => {
    const step = firstStep(world({ '2,63,0': 'lava' }), feet, creeperWest);
    assert.ok(step, 'a way aside is open');
    assert.ok(Math.abs(step.z) > 0.5, 'it goes aside');
    assert.equal(safeCell(world({ '2,63,0': 'lava' }), { x: 2, y: 64, z: 0 }), false, 'lava under the cell');
    assert.equal(safeCell(world({ '1,64,0': 'fire' }), { x: 1, y: 64, z: 0 }), false, 'fire in the cell');
});

test('a drop of 2 is fine, a drop of 3 is not', () => {
    const pit = depth => {
        const cells = {};
        for (let y = 63; y > 63 - depth; y--) cells[`1,${y},0`] = 'air';
        return world(cells);
    };
    assert.equal(safeCell(pit(2), { x: 1, y: 64, z: 0 }), true);
    assert.equal(safeCell(pit(3), { x: 1, y: 64, z: 0 }), false);
});

test('a wall or an unknown cell is no step', () => {
    assert.equal(safeCell(world({ '1,64,0': 'stone' }), { x: 1, y: 64, z: 0 }), false);
    assert.equal(safeCell(world({ '1,65,0': 'stone' }), { x: 1, y: 64, z: 0 }), false, 'no head room');
    assert.equal(safeCell(world({ '1,63,0': null }), { x: 1, y: 64, z: 0 }), false, 'the floor is unknown');
    assert.equal(safeCell(world({ '1,64,0': null }), { x: 1, y: 64, z: 0 }), false);
});

test('in a dead end whose corners the bot believes open, no diagonal step slips between the walls', () => {
    // From inside a one-wide dead end the corner blocks show no face, so memory may still hold the open
    // ground from before they were built. A step at 45 degrees passes through a side wall first.
    const cells = {};
    for (const [x, z] of [[1, 0], [0, 1], [0, -1]]) cells[`${x},64,${z}`] = 'stone';
    for (const [x, z] of [[1, 1], [1, -1]]) cells[`${x},64,${z}`] = 'air';
    for (const at of [{ x: 0.7, y: 64, z: 0.5 }, { x: 0.5, y: 64, z: 0.5 }]) // from the middle the line runs through the corner
        assert.equal(firstStep(world(cells), at, creeperWest), null, JSON.stringify(at));
});

test('a straight run along a wall the bot stands against is still a step', () => {
    const cells = {};
    for (let x = -3; x <= 4; x++) cells[`${x},64,1`] = 'stone'; // a wall along z = 1, the bot's side touching it
    const step = firstStep(world(cells), { x: 0.5, y: 64, z: 0.7 }, { x: -2.5, y: 64, z: 0.7 });
    assert.ok(step && step.x > 0.99, JSON.stringify(step));
});

test('walled in on every side away from the threat: no first step, the pathfinder decides', () => {
    const cells = {};
    for (const [x, z] of [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1]]) cells[`${x},64,${z}`] = 'stone';
    assert.equal(firstStep(world(cells), feet, creeperWest), null);
});

// A bot standing on open ground with a shield in the off-hand, writing down what it does.
function guardedBot() {
    const did = [];
    const slots = [];
    slots[45] = { name: 'shield' };
    const bot = {
        entity: { position: new Vec3(0.5, 64, 0.5) },
        inventory: { slots, items: () => [] },
        blockAt: world(),
        lookAt: async point => did.push(`look ${Math.round(point.x)},${Math.round(point.z)}`),
        activateItem: () => did.push('shield up'),
        deactivateItem: () => did.push('shield down'),
        setControlState: () => {},
        clearControlStates: () => did.push('stand'),
        pathfinder: { setGoal: () => {}, setMovements: () => {} },
    };
    const shield = createShield(bot, { use: createItemUse() });
    return { bot, did, shield };
}

test('a guard step stops the bot, faces what it names and raises the shield; with nothing to block it lowers it', async () => {
    const { bot, did, shield } = guardedBot();
    let against = { x: 8.5, y: 65.5, z: 0.5 };
    let stopped = 0;
    assert.equal(await guardStep(bot, { against: () => against, shield }, () => stopped++), true);
    assert.equal(stopped, 1);
    assert.deepEqual(did, ['look 9,1', 'shield up']);
    against = null;
    assert.equal(await guardStep(bot, { against: () => against, shield }, () => stopped++), false);
    assert.deepEqual(did.slice(2), ['shield down']);
    assert.equal(stopped, 1, 'nothing to block: the move goes on as it was');
    assert.equal(await guardStep(bot, null, () => stopped++), false, 'no guard');
});

test('a retreat stands behind the shield while its guard names something, and lowers it when done', async () => {
    const { bot, did, shield } = guardedBot();
    let steps = 0;
    const outcome = await retreatFrom(bot, {
        from: () => [{ x: 8.5, y: 64, z: 0.5 }], to: 16,
        guard: { against: () => ({ x: 8.5, y: 65.5, z: 0.5 }), shield },
        done: () => ++steps > 3,
    });
    assert.equal(outcome.ended, 'done');
    assert.equal(outcome.blocks, 1, 'raised once, kept up');
    assert.equal(did.filter(d => d === 'shield up').length, 1);
    assert.equal(did.at(-2), 'shield down', 'lowered at the end');
    assert.equal(shield.up, false);
});

test('on Bedrock a retreat behind the shield keeps the sneak key held: letting go of every key would lower it', async () => {
    const { bot, shield } = guardedBot();
    bot.registry = { version: { type: 'bedrock' } };
    const keys = {};
    let sneakLetGo = false;
    bot.setControlState = (key, on) => { if (key === 'sneak' && keys.sneak && !on && shield.up) sneakLetGo = true; keys[key] = on; };
    bot.clearControlStates = () => { if (keys.sneak && shield.up) sneakLetGo = true; for (const key in keys) keys[key] = false; };
    bot.pathfinder.setGoal = () => bot.clearControlStates(); // as the pathfinder does when its goal is dropped
    let steps = 0;
    await retreatFrom(bot, {
        from: () => [{ x: 8.5, y: 64, z: 0.5 }], to: 16,
        guard: { against: () => ({ x: 8.5, y: 65.5, z: 0.5 }), shield },
        done: () => ++steps > 5,
    });
    assert.equal(sneakLetGo, false, 'the sneak was let go while the shield was up');
    assert.equal(keys.sneak, false, 'and let go at the end');
});

// A guarded bot whose 'back' key walks it 0.3 blocks a step away from where it last looked.
function backingBot(cells = {}) {
    const { bot, did, shield } = guardedBot();
    bot.blockAt = world(cells);
    const keys = {};
    let facing = { x: 1, z: 0 };
    bot.lookAt = async point => {
        const dx = point.x - bot.entity.position.x, dz = point.z - bot.entity.position.z, d = Math.hypot(dx, dz) || 1;
        facing = { x: dx / d, z: dz / d };
        did.push(`look ${Math.round(point.x)},${Math.round(point.z)}`);
    };
    bot.setControlState = (key, on) => { keys[key] = on; };
    bot.clearControlStates = () => { for (const key in keys) keys[key] = false; did.push('stand'); };
    const timer = setInterval(() => {
        if (keys.back) bot.entity.position = bot.entity.position.offset(-facing.x * 0.3, 0, -facing.z * 0.3);
    }, 50);
    return { bot, did, shield, keys, stop: () => clearInterval(timer) };
}

test('backing away facing an archer: it walks backwards looking at it, to the distance', async () => {
    const { bot, did, shield, stop } = backingBot();
    try {
        const archer = { x: 8.5, y: 64, z: 0.5 };
        const outcome = await backAwayFacing(bot, {
            from: () => [archer], face: () => ({ ...archer, y: 65.5 }), to: 12, maxMs: 5000,
            guard: { against: () => null, shield },
        });
        assert.equal(outcome.ended, 'far enough');
        assert.ok(bot.entity.position.x < -3, `it went back, west: ${bot.entity.position}`);
        assert.ok(did.filter(d => d.startsWith('look')).every(d => d === 'look 9,1'), 'looking at the archer all the way');
    } finally { stop(); }
});

test('backing away facing an archer into a wall: it stands there facing it, and the shield goes up for a shot', async () => {
    const wall = {};
    for (let z = -3; z <= 3; z++) for (const y of [64, 65]) wall[`-1,${y},${z}`] = 'stone';
    const { bot, did, shield, stop } = backingBot(wall);
    try {
        const archer = { x: 8.5, y: 64, z: 0.5 };
        let shot = false, steps = 0;
        const outcome = await backAwayFacing(bot, {
            from: () => [archer], face: () => ({ ...archer, y: 65.5 }), to: 12, maxMs: 5000,
            guard: { against: () => (shot ? { ...archer, y: 65.5 } : null), shield },
            done: () => { if (++steps === 20) shot = true; return steps > 30; },
        });
        assert.equal(outcome.ended, 'done');
        assert.ok(bot.entity.position.x >= -0.2, `stopped at the wall: ${bot.entity.position}`);
        assert.equal(outcome.blocks, 1, 'the shield went up for the shot');
        assert.ok(did.includes('shield up'));
    } finally { stop(); }
});
