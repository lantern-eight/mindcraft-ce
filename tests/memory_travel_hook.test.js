// SPDX-License-Identifier: CC0-1.0
// The hook travel calls before it plans a walk. With no guide installed it must do nothing at all,
// so that travel without world memory is exactly what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { followKnownWay, setTravelGuide } from '../src/agent/library/travel_guide.js';

test('the travel hook does nothing until a guide is installed, and hands it the trip when one is', async () => {
    const calls = [];
    setTravelGuide(null);
    await followKnownWay({ name: 'bot' }, { x: 1 }, () => {});
    setTravelGuide(async (bot, goal) => { calls.push([bot.name, goal.x]); });
    try {
        await followKnownWay({ name: 'bot' }, { x: 1 }, () => {});
        assert.deepEqual(calls, [['bot', 1]]);
    } finally { setTravelGuide(null); }
});

test('an error from the guide reaches the caller, so an interrupted walk really stops', async () => {
    setTravelGuide(async () => { throw new Error('Travel interrupted'); });
    try {
        await assert.rejects(followKnownWay({}, {}, () => {}), /interrupted/);
    } finally { setTravelGuide(null); }
});
