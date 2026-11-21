// SPDX-License-Identifier: CC0-1.0
// Turning at a player's speed: a look moves the facing a step each game tick, the newest look wins, the
// enderman guard judges every step, and "instant" is mineflayer's own way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { installTurnSpeed, stepToward, angleBetween, CONTROLLER_DEGREES_PER_SECOND } from '../src/agent/fairplay/turn_speed.js';
import { installWalkingGaze, WALKING_PITCH } from '../src/agent/fairplay/walking_gaze.js';
import { guardGaze, stares } from '../src/agent/reflexes/gaze.js';

const DEG = Math.PI / 180;

// A bot whose look sets its facing, as mineflayer's does, and a clock of game ticks run by the test.
function turner({ speed = CONTROLLER_DEGREES_PER_SECOND, entities = {} } = {}) {
    const steps = [];
    const bot = {
        entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
        entities, nearestEntity: () => null,
        look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; steps.push([yaw, pitch]); },
    };
    const waiting = [];
    const tick = () => { const next = waiting.splice(0); for (const resolve of next) resolve(); return new Promise(r => setImmediate(r)); };
    let current = speed;
    installTurnSpeed(bot, { getSpeed: () => current, wait: () => new Promise(resolve => waiting.push(resolve)) });
    return { bot, steps, tick, setSpeed: value => { current = value; } };
}

test('the shorter way round, and a step that goes straight toward the facing asked for', () => {
    assert.ok(Math.abs(angleBetween(170 * DEG, -170 * DEG) - 20 * DEG) < 1e-9, 'across the back, not the long way');
    const s = stepToward(0, 0, 90 * DEG, 0, 9 * DEG);
    assert.ok(Math.abs(s.yaw - 9 * DEG) < 1e-9 && !s.there);
    assert.ok(stepToward(0, 0, 5 * DEG, 0, 9 * DEG).there, 'within a step: there');
});

test('a half turn at controller speed takes about a second, a step each game tick', async () => {
    const { bot, steps, tick } = turner();
    let done = false;
    const turned = bot.look(Math.PI, 0).then(() => { done = true; });
    await new Promise(r => setImmediate(r));
    assert.equal(steps.length, 1, 'the first step at once');
    assert.ok(Math.abs(Math.abs(bot.entity.yaw) - 9 * DEG) < 1e-9, '9 degrees in a tick, 180 a second');
    let ticks = 0;
    while (!done && ticks < 40) { await tick(); ticks++; }
    await turned;
    assert.ok(ticks >= 19 && ticks <= 20, `${ticks} ticks after the first step: 20 steps of 9 degrees, a second`);
    assert.ok(Math.abs(angleBetween(bot.entity.yaw, Math.PI)) < 1e-9);
});

test('the newest look wins: an older turn stops where it is, the new one carries on from there', async () => {
    const { bot, tick } = turner();
    const first = bot.look(Math.PI / 2, 0);
    await new Promise(r => setImmediate(r));
    await tick();
    const turnedBy = Math.abs(angleBetween(0, bot.entity.yaw));
    const second = bot.look(-Math.PI / 2, 0);
    await new Promise(r => setImmediate(r));
    await tick();
    await first; // ended by the newer look, at its next tick
    assert.ok(turnedBy > 0 && turnedBy < Math.PI / 2, 'the first turn was part way');
    for (let i = 0; i < 40; i++) await tick();
    await second;
    assert.ok(Math.abs(angleBetween(bot.entity.yaw, -Math.PI / 2)) < 1e-9);
});

test('"instant" turns as mineflayer does: one look, at once', async () => {
    const { bot, steps } = turner({ speed: 'instant' });
    await bot.look(Math.PI, 0.2);
    assert.deepEqual(steps, [[Math.PI, 0.2]]);
});

test('every step goes through the gaze guard, put on before or after: a sweep never passes over an enderman\'s eyes', async () => {
    // An enderman to the west, level with the bot's eye line: a turn from north round to south passes it.
    const enderman = { id: 3, name: 'enderman', type: 'hostile', position: new Vec3(-10, 63.07, 0), height: 2.9 };
    for (const guardFirst of [true, false]) {
        const steps = [];
        const bot = {
            entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
            entities: { 3: enderman }, nearestEntity: () => null,
            look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; steps.push([yaw, pitch]); },
        };
        if (guardFirst) guardGaze(bot);
        installTurnSpeed(bot, { getSpeed: () => CONTROLLER_DEGREES_PER_SECOND, wait: () => Promise.resolve() });
        if (!guardFirst) guardGaze(bot);
        await bot.look(Math.PI, 0); // round through west to south, level
        const eye = { x: 0, y: 65.62, z: 0 }, eyes = [{ x: -10, y: 65.62, z: 0 }];
        assert.ok(steps.length > 10, `${steps.length} steps`);
        assert.ok(steps.every(([yaw, pitch]) => !stares(eye, yaw, pitch, eyes)), `a step stared (${guardFirst ? 'guard first' : 'guard last'})`);
    }
});

test('a walk\'s level look heads for the walking gaze\'s pitch, though its steps are sent forced', async () => {
    const steps = [];
    const bot = {
        entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
        pathfinder: { isMoving: () => true },
        look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; steps.push([yaw, pitch]); },
    };
    installWalkingGaze(bot, { getScreen: () => ({}) });
    installTurnSpeed(bot, { getSpeed: () => CONTROLLER_DEGREES_PER_SECOND, wait: () => Promise.resolve() });
    await bot.look(0.5, 0);
    assert.ok(Math.abs(bot.entity.pitch - WALKING_PITCH) < 1e-9, `${bot.entity.pitch}`);
});
