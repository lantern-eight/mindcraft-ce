// SPDX-License-Identifier: CC0-1.0
// The threat picture: what the bot knows of each creeper from sight and sound, and how far its fuse has
// burned. A clock stands in for time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreatPicture, pointFromSound, FUSE_TICKS } from '../src/agent/reflexes/picture.js';

function setup() {
    let t = 1_000_000;
    const picture = createThreatPicture({ now: () => t });
    return { picture, wait: ms => { t += ms; } };
}
const at = (x, z = 0) => ({ position: { x, y: 64, z } });
const hiss = (direction, distance) => ({ subject: 'creeper (hissing)', direction, distance, text: `${direction}, ${distance}` });

test('a hiss heard close with no creeper in view counts as lit, at a point rebuilt from its direction and band', () => {
    const { picture } = setup();
    picture.hear(hiss('east', 'close'), at(0));
    const [heard] = picture.creepers(at(0));
    assert.equal(heard.source, 'heard');
    assert.equal(heard.lit, true);
    assert.equal(heard.seenNow, false);
    assert.deepEqual(heard.position, { x: 7, y: 64, z: 0 }, 'east, in the middle of the close band');
});

test('a sighting of the same creeper with its fuse out settles the hiss', () => {
    const { picture, wait } = setup();
    picture.hear(hiss('east', 'close'), at(0));
    wait(100);
    picture.see([{ id: 5, position: { x: 6, y: 64, z: 1 }, lit: false }], at(0));
    assert.equal(picture.creepers(at(0))[0].lit, true, 'too soon after the hiss: the fuse may not show yet');
    wait(600);
    picture.see([{ id: 5, position: { x: 6, y: 64, z: 1 }, lit: false }], at(0));
    const list = picture.creepers(at(0));
    assert.equal(list.length, 1, 'one creeper, not a heard one and a seen one');
    assert.equal(list[0].source, 'seen');
    assert.equal(list[0].lit, false);
    assert.ok(list[0].fuse > 0, 'what burned while it was only heard is still counted');
});

test('the hiss stays remembered past 1.5 s while the bot stays close', () => {
    const { picture, wait } = setup();
    picture.hear(hiss('east', 'very close'), at(0));
    wait(2500);
    const [heard] = picture.creepers(at(0));
    assert.equal(heard.lit, true);
    assert.equal(heard.fuse, FUSE_TICKS);
});

test('it is forgotten after about 10 s with nothing new', () => {
    const { picture, wait } = setup();
    picture.hear(hiss('east', 'close'), at(0));
    wait(9000);
    assert.equal(picture.creepers(at(0)).length, 1);
    wait(1500);
    assert.equal(picture.creepers(at(0)).length, 0);
});

test('a hiss settles once the bot has been away long enough for any fuse to run down', () => {
    const { picture, wait } = setup();
    picture.hear(hiss('east', 'close'), at(0));
    wait(500); // 10 ticks burned while close
    picture.creepers(at(0));
    picture.creepers(at(-8)); // backed off: 15 blocks from where it was placed
    wait(400);
    assert.equal(picture.creepers(at(-8)).length, 1, '8 ticks down, 2 to go');
    wait(200);
    assert.equal(picture.creepers(at(-8)).length, 0);
});

test('no exact coordinates come from a sound', () => {
    const { picture } = setup();
    // Two hisses from different true spots in the same direction and band end up at the same point.
    picture.hear({ ...hiss('north', 'close'), position: { x: 1, y: 64, z: -5 } }, at(0));
    const first = picture.creepers(at(0))[0].position;
    picture.clear();
    picture.hear({ ...hiss('north', 'close'), position: { x: -2, y: 66, z: -9 } }, at(0));
    assert.deepEqual(picture.creepers(at(0))[0].position, first);
    assert.deepEqual(pointFromSound({ direction: 'north', distance: 'close' }, { x: 0, y: 64, z: 0 }).z, -7);
});

test('the fuse estimate rises a tick per tick while seen lit, and falls a tick per tick while seen not lit', () => {
    const { picture, wait } = setup();
    const creeper = lit => [{ id: 1, position: { x: 3, y: 64, z: 0 }, lit }];
    picture.see(creeper(true), at(0));
    wait(500);
    picture.see(creeper(true), at(0));
    assert.equal(picture.creepers(at(0))[0].fuse, 10);
    wait(250);
    picture.see(creeper(false), at(0));
    assert.equal(picture.creepers(at(0))[0].fuse, 15, 'it burned until the moment it was seen out');
    wait(300);
    picture.see(creeper(false), at(0));
    assert.equal(picture.creepers(at(0))[0].fuse, 9);
});

test('while out of sight within 7 blocks a lit creeper is assumed to keep burning; past 7, to run down', () => {
    const { picture, wait } = setup();
    picture.see([{ id: 1, position: { x: 3, y: 64, z: 0 }, lit: true }], at(0));
    wait(100);
    picture.see([], at(0)); // stepped behind a wall
    wait(400);
    assert.equal(picture.creepers(at(0))[0].fuse, 10);
    assert.equal(picture.creepers(at(0))[0].seenNow, false);
    wait(200);
    assert.equal(picture.creepers(at(-6))[0].fuse, 6, '9 blocks off now: down from 10, 4 ticks after the last look');
});

test('back-offs from a creeper are counted, and carried over when a hiss turns into a sighting', () => {
    const { picture, wait } = setup();
    picture.hear(hiss('east', 'close'), at(0));
    picture.noteBackOff('heard:east');
    picture.noteTold('heard:east');
    wait(100);
    picture.see([{ id: 9, position: { x: 7, y: 64, z: 0 }, lit: true }], at(0));
    const [seen] = picture.creepers(at(0));
    assert.equal(seen.key, 'id:9');
    assert.equal(seen.encounters, 1);
    assert.equal(seen.told, true);
});

test('an explosion heard is remembered for a moment', () => {
    const { picture, wait } = setup();
    picture.hear({ subject: 'explosion', direction: 'west', distance: 'very close' }, at(0));
    assert.equal(picture.explosion(at(0)).distance, 2);
    wait(2000);
    assert.equal(picture.explosion(at(0)), null);
});
