// SPDX-License-Identifier: CC0-1.0
// Through a player's screen the bot looks a little down while it walks, so the ground it steps on next is in
// view; with the view all around, and for every other look, nothing changes. The enderman guard judges the
// look as it is really made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { installWalkingGaze, WALKING_PITCH } from '../src/agent/fairplay/walking_gaze.js';
import { guardGaze } from '../src/agent/reflexes/gaze.js';

function walker({ screen = {}, moving = true } = {}) {
    const looks = [];
    const bot = {
        entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
        entities: {},
        pathfinder: { isMoving: () => moving },
        look: async (yaw, pitch, force) => { looks.push(pitch); },
    };
    installWalkingGaze(bot, { getScreen: () => screen });
    return { bot, looks, setMoving: value => { moving = value; } };
}

test('the pathfinder\'s level look while walking is tilted down under a narrow view; nothing else is', async () => {
    const { bot, looks, setMoving } = walker();
    await bot.look(1, 0);
    assert.equal(looks.at(-1), WALKING_PITCH, 'walking: looking at the ground ahead');
    await bot.look(1, 0, true);
    assert.equal(looks.at(-1), 0, 'a forced level look is someone else\'s');
    await bot.look(1, 0.3);
    assert.equal(looks.at(-1), 0.3, 'a look with its own pitch');
    setMoving(false);
    await bot.look(1, 0);
    assert.equal(looks.at(-1), 0, 'standing still');

    const allAround = walker({ screen: null });
    await allAround.bot.look(1, 0);
    assert.equal(allAround.looks.at(-1), 0, 'all around, the walk looks as it always has');
});

test('the gaze guard judges the tilted look, in whichever order the two were put on', async () => {
    // An enderman 6 blocks north, standing below the bot: its eyes are where a walking look
    // tilted 25 degrees down would meet them.
    const enderman = { id: 3, name: 'enderman', type: 'hostile', position: new Vec3(0, 60.27, -6), height: 2.9 };
    for (const guardFirst of [true, false]) {
        const looks = [];
        const bot = {
            entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
            entities: { 3: enderman },
            nearestEntity: () => null,
            pathfinder: { isMoving: () => true },
            look: async (yaw, pitch) => { looks.push(pitch); },
        };
        if (guardFirst) guardGaze(bot);
        installWalkingGaze(bot, { getScreen: () => ({}) });
        if (!guardFirst) guardGaze(bot);
        await bot.look(0, 0);
        assert.ok(looks[0] < WALKING_PITCH - 0.01, `lowered past the enderman's eyes (${guardFirst ? 'guard first' : 'guard last'}): ${looks[0]}`);
    }
});
