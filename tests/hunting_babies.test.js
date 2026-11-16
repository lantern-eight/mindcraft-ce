// SPDX-License-Identifier: CC0-1.0
// The hunting reflex goes after farm animals, never their young. Whether a mob is a baby is asked of the
// edition seam, which knows where the game keeps a mob's age; with no game loaded that is Java.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isHuntable } from '../src/utils/mcdata.js';

test('a grown farm animal is huntable, its young are not', () => {
    assert.equal(isHuntable({ name: 'cow', metadata: { 16: false } }), true);
    assert.equal(isHuntable({ name: 'cow', metadata: { 16: true } }), false, 'a calf');
    assert.equal(isHuntable({ name: 'Sheep', metadata: [] }), true, 'names in any case; nothing said is grown');
});

test('what is not a farm animal, or not there, is never huntable', () => {
    assert.equal(isHuntable({ name: 'wolf', metadata: {} }), false);
    assert.equal(isHuntable({ name: 'cow' }), true, 'a mob with no metadata is taken as grown, not an error');
    assert.equal(isHuntable(null), false);
});
