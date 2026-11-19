// SPDX-License-Identifier: CC0-1.0
// decideThreat: what to do about the creepers the bot knows of. Pure, so plain objects stand in for the
// threat picture and the bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideThreat, hitsNeeded, BACK_OFF_TO, LEAVE_TO } from '../src/agent/reflexes/decide.js';

const origin = { x: 0, y: 64, z: 0 };
const self = (extra = {}) => ({ position: origin, health: 20, gameMode: 'survival', edition: 'java', underground: false, hitsNeeded: 4, ...extra });
const creeper = (distance, extra = {}) => ({
    key: `id:${distance}`, position: { x: distance, y: 64, z: 0 }, distance, lit: false, fuse: 0, seenNow: true,
    source: 'seen', encounters: 0, ...extra,
});

test('a creeper seen lit at 2, 5 and 7 blocks: back off, sprinting, to 8', () => {
    for (const d of [2, 5, 7]) {
        const decision = decideThreat([creeper(d, { lit: true })], self());
        assert.equal(decision.stance, 'back_off', `at ${d}`);
        assert.equal(decision.distance, BACK_OFF_TO);
        assert.equal(decision.sprint, true);
        assert.deepEqual(decision.from, { x: d, y: 64, z: 0 });
    }
});

test('a creeper seen lit at 8 blocks: nothing', () => {
    assert.equal(decideThreat([creeper(8, { lit: true })], self()).stance, 'ignore');
});

test('a lit creeper outranks a closer zombie, and a farther unlit creeper', () => {
    // The picture holds creepers only; a zombie never enters it. The nearest creeper isn't lit and is
    // past 3 blocks, so the lit one behind it decides.
    const decision = decideThreat([creeper(4), creeper(6, { lit: true })], self());
    assert.equal(decision.stance, 'back_off');
    assert.equal(decision.key, 'id:6');
});

test('a creeper within 3 blocks that is not lit yet: back off before it lights', () => {
    const decision = decideThreat([creeper(2.5)], self());
    assert.equal(decision.stance, 'back_off');
    assert.equal(decision.reason, 'close');
    assert.equal(decideThreat([creeper(4)], self()).stance, 'ignore', 'past 3, an unlit creeper is left alone');
});

test('a hiss remembered close: back off from where it was placed', () => {
    const heard = creeper(7, { key: 'heard:east', source: 'heard', seenNow: false, lit: true, slack: 3 });
    const decision = decideThreat([heard], self());
    assert.equal(decision.stance, 'back_off');
    assert.equal(decision.reason, 'hissed');
    assert.equal(decision.distance, BACK_OFF_TO + 3, 'farther, since the creeper may be nearer than the middle of the band');
});

test('an explosion heard very close: back off from it', () => {
    const explosion = { position: { x: 3, y: 64, z: 0 }, distance: 3 };
    assert.equal(decideThreat([], self(), { explosion }).stance, 'back_off');
    assert.equal(decideThreat([], self(), { explosion: { ...explosion, distance: 12 } }).stance, 'ignore');
});

test('a creeper above an underground bot it can\'t reach: watch', () => {
    const above = creeper(5, { lit: true, position: { x: 3, y: 68, z: 0 } });
    assert.equal(decideThreat([above], self({ underground: true })).stance, 'watch');
    assert.equal(decideThreat([above], self()).stance, 'back_off', 'in the open, it can come down');
});

test('the second encounter: hit and step back when armed with health 10 or more, leave otherwise', () => {
    const again = creeper(4, { encounters: 1 });
    assert.equal(decideThreat([again], self({ hitsNeeded: 4, health: 10 })).stance, 'hit_and_step_back');
    assert.equal(decideThreat([again], self({ hitsNeeded: 5 })).stance, 'leave', 'a wooden sword needs 5 hits');
    assert.equal(decideThreat([again], self({ health: 9 })).stance, 'leave');
    const leave = decideThreat([again], self({ hitsNeeded: 20 }));
    assert.equal(leave.distance, LEAVE_TO);
});

test('finishing it waits to go back in until its fuse estimate is near zero', () => {
    assert.equal(decideThreat([creeper(4, { encounters: 1, fuse: 12 })], self()).stance, 'back_off');
    assert.equal(decideThreat([creeper(4, { encounters: 1, fuse: 2 })], self()).stance, 'hit_and_step_back');
    assert.equal(decideThreat([creeper(4, { encounters: 1, lit: true })], self()).stance, 'back_off', 'lit again');
});

test('on Bedrock, finishing is always leaving', () => {
    assert.equal(decideThreat([creeper(4, { encounters: 1 })], self({ edition: 'bedrock' })).stance, 'leave');
    assert.equal(decideThreat([creeper(2, { lit: true })], self({ edition: 'bedrock' })).stance, 'back_off', 'the first time it backs off as on Java');
});

test('nothing in the decision answers to cowardice', () => {
    // The decision isn't even told about the switch: a lit creeper is backed off from whatever it says.
    assert.equal(decideThreat([creeper(3, { lit: true })], self(), { cowardice: false }).stance, 'back_off');
});

test('in creative or spectator mode, nothing', () => {
    assert.equal(decideThreat([creeper(2, { lit: true })], self({ gameMode: 'creative' })).stance, 'ignore');
    assert.equal(decideThreat([creeper(2, { lit: true })], self({ gameMode: 'spectator' })).stance, 'ignore');
});

test('hits needed: 20 health over the best weapon carried, rounded up', () => {
    assert.equal(hitsNeeded(['stone_sword', 'dirt']), 4);
    assert.equal(hitsNeeded(['wooden_sword']), 5);
    assert.equal(hitsNeeded(['iron_axe', 'wooden_sword']), 3);
    assert.equal(hitsNeeded([]), 20, 'a fist');
});
