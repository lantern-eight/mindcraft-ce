// SPDX-License-Identifier: CC0-1.0
// The bot never looks an enderman in the eye: a look that would is lowered to its feet, any other look is
// left as it was, and the guard covers bot.lookAt too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { stares, safePitch, guardGaze } from '../src/agent/reflexes/gaze.js';

const eye = { x: 0, y: 65.62, z: 0 };
// An enderman 20 blocks north (-z), its eyes 2.55 above its feet at y 64.
const enderman = { x: 0, y: 66.55, z: -20 };
const atHead = Math.atan2(enderman.y - eye.y, 20); // pitch straight at its eyes, facing north (yaw 0)

test('a look at its eyes, or close by, is a stare; a look well away is not', () => {
    assert.equal(stares(eye, 0, atHead, [enderman]), true);
    assert.equal(stares(eye, 0, 0, [enderman]), true, 'level, 20 blocks off: within the angle');
    assert.equal(stares(eye, Math.PI, 0, [enderman]), false, 'facing away');
    assert.equal(stares(eye, 0, -0.5, [enderman]), false, 'at the ground');
});

test('the safe pitch is lowered just enough, and left alone when nothing is stared at', () => {
    const pitch = safePitch(eye, 0, atHead, [enderman]);
    assert.ok(pitch < atHead && !stares(eye, 0, pitch, [enderman]), `${pitch}`);
    assert.ok(pitch > -0.3, 'not straight down');
    assert.equal(safePitch(eye, 0, 0.3, []), 0.3);
    assert.equal(safePitch(eye, Math.PI, 0, [enderman]), 0);
});

test('the guard sits on bot.look, which lookAt goes through', async () => {
    const looks = [];
    const bot = {
        entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62 },
        entities: { 3: { id: 3, name: 'enderman', type: 'hostile', position: new Vec3(0, 64, -20) } },
        nearestEntity: () => null,
        look: async (yaw, pitch) => { looks.push(pitch); },
    };
    bot.lookAt = async point => { await bot.look(0, Math.atan2(point.y - 65.62, 20)); };
    guardGaze(bot);
    guardGaze(bot); // once is enough
    await bot.lookAt(new Vec3(0, 66.55, -20));
    assert.ok(looks[0] < atHead - 0.01, 'lowered');
    await bot.look(Math.PI, 0.1);
    assert.equal(looks[1], 0.1, 'away from it: untouched');
});
