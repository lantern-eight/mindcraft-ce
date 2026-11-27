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

test('what the guide found comes back, and a way blocked by someone\'s build makes the rest of the trip dig nothing', async () => {
    const { keepToWay } = await import('../src/agent/library/travel_guide.js');
    setTravelGuide(async () => ({ followed: true, noDigging: true }));
    try {
        const way = await followKnownWay({}, {}, () => {});
        assert.equal(way.noDigging, true);
        const careful = { canDig: true }, any = { canDig: true };
        keepToWay(way, careful, any);
        assert.deepEqual([careful.canDig, any.canDig], [false, false]);
        const open = { canDig: true };
        keepToWay({ followed: true, noDigging: false }, open);
        keepToWay(null, open);
        assert.equal(open.canDig, true, 'otherwise left as they are');
    } finally { setTravelGuide(null); }
    assert.equal(await followKnownWay({}, {}, () => {}), null, 'no guide: nothing found');
});
