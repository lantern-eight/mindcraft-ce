// SPDX-License-Identifier: CC0-1.0
// The fight's own moves (src/agent/reflexes/melee.js): how far a hit reaches, which mob to hit next, when to
// step back while the weapon recharges, and when the way to a mob is open enough to sprint straight at it.
// Plain objects stand in for mobs, and a map for the blocks the bot knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { reachTo, pickTarget, shouldStepBack, openWayTo, charged, fightLetGo, withinLeash, fightMelee } from '../src/agent/reflexes/melee.js';
import { createShield } from '../src/agent/reflexes/shield.js';
import { createItemUse, EATING } from '../src/agent/reflexes/item_use.js';

const eye = { x: 0.5, y: 65.62, z: 0.5 };
const mob = (id, x, z, extra = {}) => ({ id, name: 'zombie', position: { x, y: 64, z }, width: 0.6, height: 1.95, ...extra });

test('reach is measured from the eye to the nearest point of the mob\'s body, as the game does', () => {
    // A zombie 3.2 blocks east, feet to feet: its near side is 2.9 from the eye's line, level with the eye.
    assert.ok(Math.abs(reachTo(eye, mob(1, 3.7, 0.5)) - 2.9) < 1e-9);
    // Right next to it: nothing between.
    assert.equal(reachTo(eye, mob(1, 0.7, 0.5)), 0);
    // A mob on a ledge above: the height counts too.
    const above = reachTo(eye, mob(1, 2.5, 0.5, { position: { x: 2.5, y: 68, z: 0.5 } }));
    assert.ok(Math.abs(above - Math.hypot(1.7, 68 - 65.62)) < 1e-9);
    // A spider is wide: 1.4 across, so its side is closer than a zombie's at the same place.
    assert.ok(reachTo(eye, mob(1, 4, 0.5, { width: 1.4 })) < reachTo(eye, mob(1, 4, 0.5)));
});

test('re-picking: the target in reach is kept; out of reach, the nearest mob in reach is taken instead', () => {
    const near = mob(2, 2.5, 0.5), far = mob(1, 6.5, 0.5), behind = mob(3, -1.0, 0.5);
    assert.equal(pickTarget(near, [far, behind], eye, 3).id, 2, 'a target in reach is finished first');
    // Fighting the far one while another bites from behind: turn to the one in reach.
    assert.equal(pickTarget(far, [far, near, behind], eye, 3).id, 3, 'the nearest in reach');
    // Nothing in reach: keep going after the one it was fighting.
    assert.equal(pickTarget(far, [far, mob(4, 9.5, 0.5)], eye, 3).id, 1);
    // Its target gone: the nearest of the rest, or nothing.
    assert.equal(pickTarget(null, [far, mob(4, 9.5, 0.5)], eye, 3).id, 1);
    assert.equal(pickTarget(null, [], eye, 3), null);
});

test('a swing waits until the weapon is recharged, with a tick to spare', () => {
    assert.equal(charged({ now: 1000, lastSwingAt: 0, rechargeMs: 625 }), true);
    assert.equal(charged({ now: 650, lastSwingAt: 0, rechargeMs: 625 }), false, 'a tick short');
    assert.equal(charged({ now: 675, lastSwingAt: 0, rechargeMs: 625 }), true);
});

test('stepping back while recharging: only with a second mob close or the target right on the bot', () => {
    const base = { charged: false, targetReach: 1.2, othersWithin: 0, behindSafe: true };
    assert.equal(shouldStepBack({ ...base, othersWithin: 1 }), true, 'a second mob close: spread them out');
    assert.equal(shouldStepBack({ ...base, targetReach: 0.3 }), true, 'the target right on it');
    assert.equal(shouldStepBack({ ...base }), false, 'one mob at arm\'s length: stand and wait');
    assert.equal(shouldStepBack({ ...base, charged: true, othersWithin: 1 }), false, 'ready to swing: swing');
    assert.equal(shouldStepBack({ ...base, othersWithin: 1, behindSafe: false }), false, 'never back into lava or off a drop');
});

// A flat stone floor with its top at y 63, air above, and whatever `cells` changes ("x,y,z" -> name; null
// for a cell the bot doesn't know).
function world(cells = {}) {
    return pos => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (key in cells) return cells[key] === null ? null : { name: cells[key], boundingBox: /air|lava|fire|water/.test(cells[key]) ? 'empty' : 'block' };
        return pos.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
    };
}
const feet = { x: 0.5, y: 64, z: 0.5 };

test('the way to a mob is open when the ground between is safe and level enough to sprint', () => {
    const zombie = { x: 6.5, y: 64, z: 0.5 };
    assert.equal(openWayTo(world(), feet, zombie), true);
    assert.equal(openWayTo(world({ '2,64,0': 'stone' }), feet, zombie), false, 'a wall between');
    assert.equal(openWayTo(world({ '2,63,0': 'lava' }), feet, zombie), false, 'lava between');
    assert.equal(openWayTo(world({ '3,63,0': null }), feet, zombie), false, 'ground it has not seen');
    assert.equal(openWayTo(world(), feet, { x: 6.5, y: 66, z: 0.5 }), false, 'up on a ledge: the pathfinder finds the way');
    assert.equal(openWayTo(world(), feet, { x: 30.5, y: 64, z: 0.5 }), false, 'too far to rush');
});

test('letting go of a fight that is not working', () => {
    const base = { now: 10000, closestAt: 9000, inReach: false, swingsSinceLanded: 0, lastLandedAt: 9000, startedAt: 0 };
    assert.equal(fightLetGo(base), null);
    assert.equal(fightLetGo({ ...base, closestAt: 3000 }), 'not getting closer', 'out of reach and no closer for 6 s or more');
    assert.equal(fightLetGo({ ...base, closestAt: 3000, inReach: true }), null, 'in reach, distance doesn\'t matter');
    // Swinging in reach and never seeing it flinch: something is in the way, or the hits do nothing.
    assert.equal(fightLetGo({ ...base, inReach: true, swingsSinceLanded: 5, lastLandedAt: 4000 }), 'not landing');
    assert.equal(fightLetGo({ ...base, inReach: true, swingsSinceLanded: 2, lastLandedAt: 4000 }), null, 'a couple of misses happen');
});

test('the leash is on where the bot goes, not where the mob is: a mob against a wall 13 out is still in reach of it', () => {
    const home = { x: 0.5, y: 64, z: 0.5 };
    assert.equal(withinLeash({ x: 13.5, y: 64, z: 0.5 }, home, 3), true, 'the bot stands 10 out to hit it');
    assert.equal(withinLeash({ x: 15.6, y: 64, z: 0.5 }, home, 3), false, 'it would have to go past 12');
});

// A bot on a flat stone floor (its top at y 63), holding a stone sword with a shield in the off-hand, that
// writes down what it does: the use of the off-hand, its keys, its swings.
function fighter() {
    const bot = new EventEmitter();
    const did = [];
    const slots = [];
    slots[45] = { name: 'shield' };
    const sword = { name: 'stone_sword' };
    bot.entity = { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62 };
    bot.inventory = { slots, items: () => [sword] };
    bot.heldItem = sword;
    bot.blockAt = pos => ({ name: pos.y < 64 ? 'stone' : 'air', boundingBox: pos.y < 64 ? 'block' : 'empty' });
    bot.lookAt = async () => {};
    bot.attack = target => did.push(`swing ${target.id}`);
    bot.equip = async () => {};
    bot.activateItem = offHand => did.push(offHand ? 'shield up' : 'use main hand');
    bot.deactivateItem = () => did.push('shield down');
    const keys = {};
    bot.setControlState = (key, on) => { keys[key] = on; };
    bot.clearControlStates = () => { for (const key in keys) keys[key] = false; };
    bot.pathfinder = { setGoal: () => {}, setMovements: () => {} };
    return { bot, did, keys };
}
const skeleton = (x, drawing) => ({ id: 7, name: 'skeleton', position: new Vec3(x, 64, 0.5), width: 0.6, height: 1.99, drawing });

test('the fight stands behind its shield while an archer draws, and rushes it once the arrow is loosed', async () => {
    const { bot, did, keys } = fighter();
    const use = createItemUse();
    const shield = createShield(bot, { use });
    let drawing = true, beats = 0, rushedWhileUp = false;
    const mob = () => skeleton(10.5, drawing);
    const outcome = await fightMelee(bot, {
        first: 7, see: () => mob(), shield, use,
        shotComing: () => (mob().drawing ? mob() : null),
        stop: () => {
            beats++;
            if (beats === 4) drawing = false;          // the arrow is loosed
            if (shield.up && keys.forward) rushedWhileUp = true;
            return beats > 8;
        },
    });
    assert.equal(outcome.ended, 'stopped');
    assert.equal(outcome.blocks, 1);
    assert.deepEqual(did.filter(d => d.startsWith('shield')), ['shield up', 'shield down'], 'up for the draw, down after');
    assert.equal(rushedWhileUp, false, 'never moving with the shield up');
    assert.equal(keys.forward, false, 'the keys let go at the end');
    assert.equal(use.owner(), null, 'the channel is given back');
});

test('the fight swings with the shield down, and neither swings nor raises it in the middle of a meal', async () => {
    const { bot, did } = fighter();
    const use = createItemUse();
    const shield = createShield(bot, { use });
    use.take(EATING);
    let beats = 0;
    const zombie = { id: 3, name: 'zombie', position: new Vec3(2.0, 64, 0.5), width: 0.6, height: 1.95 };
    await fightMelee(bot, { first: 3, see: () => zombie, shield, use, shotComing: () => skeleton(10.5, true), stop: () => ++beats > 4 });
    assert.deepEqual(did, [], 'no swing, no shield, while eating');
    use.release(EATING);
    beats = 0;
    await fightMelee(bot, { first: 3, see: () => zombie, shield, use, shotComing: () => skeleton(10.5, true), stop: () => ++beats > 2 });
    assert.deepEqual(did, ['swing 3'], 'the zombie in reach comes first; the shield stays down to swing');
});
