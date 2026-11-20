// SPDX-License-Identifier: CC0-1.0
// The beat of an archer's shots, for Bedrock, whose skeletons show no bow drawn: a shot heard, matched to the
// archer seen on that side, and the next one due a beat later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShotBeat, EARLY_MS, LATE_MS } from '../src/agent/reflexes/shot_beat.js';

const here = { x: 0, y: 64, z: 0 };
const skeleton = (id, x, z, extra = {}) => ({ id, name: 'skeleton', position: { x, y: 64, z }, seenNow: true, ...extra });
const shot = (direction, distance = 'close') => ({ subject: 'skeleton (shooting)', direction, distance });

test('a shot heard is matched to the archer of its kind seen on that side', () => {
    const beat = createShotBeat({ now: () => 0 });
    const mobs = [skeleton(1, 8, 0), skeleton(2, -8, 0), { ...skeleton(3, 8, 1), name: 'zombie' }];
    assert.equal(beat.hear(shot('east'), mobs, here), 1);
    assert.equal(beat.hear(shot('west'), mobs, here), 2);
    assert.equal(beat.hear(shot('north'), mobs, here), null, 'no archer seen that way');
    assert.equal(beat.hear({ subject: 'skeleton', direction: 'east', distance: 'close' }, mobs, here), null, 'a rattle, not a shot');
    assert.equal(beat.hear(shot('east'), [skeleton(1, 8, 0, { seenNow: false })], here), null, 'only one in view');
});

test('of two on the same side, the one at the distance heard', () => {
    const beat = createShotBeat({ now: () => 0 });
    const mobs = [skeleton(1, 3, 0), skeleton(2, 18, 0)];
    assert.equal(beat.hear(shot('east', 'near'), mobs, here), 2);
    assert.equal(beat.hear(shot('east', 'very close'), mobs, here), 1);
});

test('the next shot is due a beat on from the last one heard, a moment either side, and on beat after beat', () => {
    let clock = 0;
    const beat = createShotBeat({ now: () => clock });
    beat.hear(shot('east'), [skeleton(1, 8, 0)], here);
    const at = ms => { clock = ms; return beat.due(1, 3000); };
    assert.equal(at(100), false, 'just shot');
    assert.equal(at(3000 - EARLY_MS - 10), false);
    assert.equal(at(3000 - EARLY_MS + 10), true, 'about to shoot again');
    assert.equal(at(3000 + LATE_MS - 10), true, 'a little late');
    assert.equal(at(3000 + LATE_MS + 10), false);
    assert.equal(at(6000), true, 'a shot not heard keeps the beat going');
    assert.equal(at(12000), false, 'silent for four beats: it has stopped');
    assert.equal(beat.due(1, 3000), false, 'and is forgotten');
    assert.equal(beat.due(2, 3000), false, 'never heard');
    clock = 0;
    beat.hear(shot('east'), [skeleton(1, 8, 0)], here);
    clock = 3000;
    assert.equal(beat.due(1, null), false, 'no beat for this kind (Java: the draw is there to see)');
});
