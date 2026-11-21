// SPDX-License-Identifier: CC0-1.0
// The idle look-around that fair play puts in idle_staring's place: a look at a mob is held, then turned away
// from, then come back to, a few times; with nothing to look at, the bot turns to the way it has looked at
// least lately; a glance has the head while it lasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { createIdleLook } from '../src/agent/fairplay/idle_look.js';
import { watchLooks, looksOf } from '../src/agent/fairplay/look_around.js';
import { screenOf } from '../src/agent/fairplay/sight.js';

function idler({ mobs = [], narrow = true } = {}) {
    let t = 1_000_000;
    const now = () => t;
    const bot = new EventEmitter();
    const did = [];
    Object.assign(bot, {
        registry: {}, entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, height: 1.8 },
        entities: Object.fromEntries(mobs.map(m => [m.id, m])), nearestEntity: () => null,
        look: (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; did.push(['look', yaw]); },
        lookAt: point => did.push(['at', Math.round(point.x), Math.round(point.y * 10) / 10]),
    });
    bot.entities[0] = bot.entity;
    watchLooks(bot, { getScreen: () => (narrow ? screenOf(bot.entity.yaw, bot.entity.pitch, 70) : null), now });
    const { mode } = createIdleLook({ now, random: () => 0.5 });
    const agent = { bot };
    return { bot, did, step: ms => { t += ms; mode.update(agent); }, advance: ms => { t += ms; } };
}

test('a mob in view is looked at, held, looked away from, and after a few looks left alone', () => {
    const cow = { id: 5, name: 'cow', type: 'animal', height: 1.4, position: new Vec3(0.5, 64, -5.5) };
    const { did, step } = idler({ mobs: [cow] });
    step(0);
    assert.deepEqual(did.at(-1), ['at', 1, 65.4], 'looked at the cow\'s head');
    step(1000);
    assert.equal(did.at(-1)[0], 'at', 'still holding the look, following it');
    step(2000); // the hold (2.5 s with this random) is over
    assert.equal(did.at(-1)[0], 'look', 'looked away');
    // Each new look at the cow begins after a look elsewhere. Three, then none for a while.
    const starts = () => did.filter((d, i) => d[0] === 'at' && (i === 0 || did[i - 1][0] !== 'at')).length;
    for (let i = 0; i < 37; i++) step(1000);
    assert.equal(starts(), 3, 'three looks at the cow in its first forty seconds');
    for (let i = 0; i < 10; i++) step(1000);
    assert.equal(starts(), 4, 'and after a rest, it is looked at again');
});

test('with two mobs in view it looks between them, so neither is turned off the screen', () => {
    const west = { id: 5, name: 'zombie', type: 'hostile', height: 1.95, position: new Vec3(-5.5, 64, 0.5) };
    const north = { id: 6, name: 'zombie', type: 'hostile', height: 1.95, position: new Vec3(0.5, 64, -5.5) };
    const { did, step } = idler({ mobs: [west, north] });
    step(0);
    assert.deepEqual(did.at(-1), ['at', -2, 66], 'at the middle of the two (x -2.5)');
});

test('with nothing in view, it turns to the way it has looked at least lately, and covers the circle', () => {
    const { bot, did, step } = idler();
    const headings = new Set();
    for (let i = 0; i < 12; i++) { step(2000); headings.add(Math.round(((bot.entity.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 4)) % 8); }
    assert.ok(did.length >= 6, `${did.length} looks`);
    assert.ok(headings.size >= 3, `faced ${headings.size} ways`);
    assert.equal(looksOf(bot).unseen({ freshMs: 30_000 }).length, 0, 'every way looked at within half a minute');
});

test('a glance has the head while it holds, and turns never come closer than 600 ms', () => {
    const { bot, did, step } = idler();
    looksOf(bot).holdUntil = 1_000_000 + 5000;
    step(3000);
    assert.equal(did.length, 0, 'held by the glance');
    step(3000);
    assert.equal(did.length, 1);
    step(100);
    step(100);
    assert.equal(did.length, 1, 'not again within 600 ms');
});
