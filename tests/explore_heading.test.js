// SPDX-License-Identifier: CC0-1.0
// The explorer's choice of heading: directions as players say them, keeping a heading from one call to the
// next, heading for land not seen yet, and the ways round a blocked one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compassName, legOrder, newGroundAlong, ON, parseDirection, sectorOf, startHeading, turnBetween, wrap } from '../src/agent/explore/heading.js';

const E = 0, S = Math.PI / 2, W = Math.PI, N = -Math.PI / 2, EIGHTH = Math.PI / 4;
const close = (actual, expected, message) => assert.ok(turnBetween(actual, expected) < 1e-9, `${message ?? ''} ${actual} is not ${expected}`);
const names = angles => angles.map(compassName);

test('directions are read the ways a player says them', () => {
    close(parseDirection('east'), E);
    close(parseDirection('South'), S);
    close(parseDirection('north-east'), N + EIGHTH);
    close(parseDirection('north east'), N + EIGHTH);
    close(parseDirection('northeast'), N + EIGHTH);
    close(parseDirection('SW'), S + EIGHTH);
    close(parseDirection('south_west'), S + EIGHTH);
    for (const word of ['on', 'any', 'Ahead', '', undefined]) assert.equal(parseDirection(word), ON, String(word));
    assert.equal(parseDirection('up'), null);
    assert.equal(parseDirection('towards the sea'), null);
});

test('the compass names an angle by its nearest eighth, with north as minus z', () => {
    assert.equal(compassName(0.1), 'east');
    assert.equal(compassName(-Math.PI / 2), 'north');
    assert.equal(compassName(3 * Math.PI / 4 + 0.2), 'south-west');
    assert.equal(compassName(-Math.PI + 0.01), 'west');
    assert.equal(sectorOf(2 * Math.PI), 0);
    close(wrap(3 * Math.PI), Math.PI);
});

test('new ground is ground in cubes the bot has never looked over, at its level', () => {
    // Everything west of x = 0 has been looked over, at the bot's level only.
    const looked = new Set();
    for (let cx = -10; cx < 0; cx++) for (let cz = -10; cz <= 10; cz++) looked.add(`${cx},4,${cz}`);
    const lookedAt = (cx, cy, cz) => looked.has(`${cx},${cy},${cz}`) ? 1000 : 0;
    const here = { x: 0.5, y: 70, z: 0.5 };   // cube y 4
    assert.equal(newGroundAlong(lookedAt, here, W, 32), 0);
    assert.equal(newGroundAlong(lookedAt, here, E, 32), 1);
    // A cube looked over just above or below the bot's level counts as seen too: the bot looks a little up and down.
    assert.equal(newGroundAlong(lookedAt, { x: 0.5, y: 86, z: 0.5 }, W, 32), 0);
    assert.equal(newGroundAlong(lookedAt, { x: 0.5, y: 120, z: 0.5 }, W, 32), 1);
});

test('told a direction, the bot keeps it as a bearing, and carries on a walk it was already making', () => {
    const here = { x: 0, y: 64, z: 0 };
    const first = startHeading({ direction: E, here, leg: 32 });
    assert.deepEqual({ ...first, heading: undefined }, { heading: undefined, bearing: true, origin: { x: 0, z: 0 }, resumed: false });
    close(first.heading, E);

    const last = { origin: { x: -100, z: 0 }, end: { x: -10, z: 5 }, heading: E, bearing: true };
    const again = startHeading({ direction: E, here, last, leg: 32 });
    assert.deepEqual(again.origin, { x: -100, z: 0 }, 'the same bearing from about where it stopped is the same walk');
    assert.equal(again.resumed, true);
    const turned = startHeading({ direction: N, here, last, leg: 32 });
    assert.deepEqual(turned.origin, { x: 0, z: 0 }, 'a new bearing starts a new walk');
});

test('exploring on carries the last heading from where it stopped', () => {
    const last = { origin: { x: 0, z: 0 }, end: { x: 60, z: 60 }, heading: S + EIGHTH / 2, bearing: false };
    const on = startHeading({ direction: ON, here: { x: 70, y: 64, z: 50 }, last, leg: 32, newGround: () => 1 });
    close(on.heading, last.heading);
    assert.equal(on.resumed, true);
    assert.equal(on.bearing, false);
    assert.deepEqual(on.origin, { x: 0, z: 0 });
});

test('starting afresh, the bot heads for the land it has not seen, preferring small turns', () => {
    const here = { x: 0, y: 64, z: 0 };
    // Only the north-west is new.
    const nw = N - EIGHTH;
    const only = startHeading({ direction: ON, here, leg: 32, newGround: a => turnBetween(a, nw) < 0.1 ? 1 : 0 });
    close(only.heading, nw);
    // North, north-east and east all new; it had last gone north-east (from far away, so not carried on):
    // going straight on beats turning to another way just as new.
    const last = { origin: { x: 900, z: 900 }, end: { x: 1000, z: 1000 }, heading: N + EIGHTH, bearing: false };
    const keep = startHeading({ direction: ON, here, last, leg: 32, newGround: a => turnBetween(a, N + EIGHTH) <= Math.PI / 2 + 1e-9 ? 1 : 0 });
    close(keep.heading, N + EIGHTH);
    assert.equal(keep.resumed, false);
    assert.deepEqual(keep.origin, { x: 0, z: 0 });
});

test('with no record of what it saw, the bot keeps its old heading, or picks any', () => {
    const here = { x: 0, y: 64, z: 0 };
    const last = { origin: { x: 900, z: 900 }, end: { x: 1000, z: 1000 }, heading: W, bearing: false };
    close(startHeading({ direction: ON, here, last, leg: 32 }).heading, W);
    close(startHeading({ direction: ON, here, leg: 32, random: () => 0.25 }).heading, S);
});

test('the ways to try: straight on, then turning more and more, never back past a quarter on a bearing', () => {
    const here = { x: 0, z: 0 };
    assert.deepEqual(names(legOrder({ heading: E, bearing: true, here })), ['east', 'south-east', 'north-east', 'south', 'north']);
    assert.deepEqual(names(legOrder({ heading: E, bearing: false, here })),
        ['east', 'south-east', 'north-east', 'south', 'north', 'south-west', 'north-west']);
});

test('of two turns the same size, the side with more new ground goes first', () => {
    const order = legOrder({ heading: E, bearing: true, here: { x: 0, z: 0 }, newGround: a => (a < -0.1 ? 1 : 0) });
    assert.deepEqual(names(order), ['east', 'north-east', 'south-east', 'north', 'south']);
});

test('a way found blocked is left out while the bot is still near where it was blocked', () => {
    const blocked = [{ sector: sectorOf(E), at: { x: 0, z: 0 } }, { sector: sectorOf(E + EIGHTH), at: { x: 0, z: 0 } }];
    assert.deepEqual(names(legOrder({ heading: E, bearing: true, here: { x: 10, z: -10 }, blocked })), ['north-east', 'south', 'north']);
    // Thirty blocks along the shore, east is worth trying again.
    assert.deepEqual(names(legOrder({ heading: E, bearing: true, here: { x: 0, z: -30 }, blocked })),
        ['east', 'south-east', 'north-east', 'south', 'north']);
    // Every way shut: nothing left to try.
    const all = [0, 1, 2, 3, 4, 5, 6, 7].map(sector => ({ sector, at: { x: 0, z: 0 } }));
    assert.deepEqual(legOrder({ heading: E, bearing: false, here: { x: 0, z: 0 }, blocked: all }), []);
});
