// SPDX-License-Identifier: CC0-1.0
// goToSurface climbs by what the bot knows of the column above it (climbToSurface in look_first.js):
// never further than it can see or remembers at a time, so it never names a surface it hasn't seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { climbToSurface } from '../src/agent/library/look_first.js';
import { log } from '../src/agent/library/skills.js';
import { namedCells } from './helpers/named_cells.js';

test.afterEach(() => setWorldQueries(null));

test('under a ceiling the bot goes up to the highest block it knows of, never naming the surface it can\'t see', async () => {
    // A cave: ceiling at 70 (in view), rock above to the surface at 80, open sky above that.
    const cells = {};
    for (let y = 70; y <= 80; y++) cells[`0,${y},0`] = 'stone';
    const known = new Set();
    for (let y = 66; y <= 70; y++) known.add(`0,${y},0`);
    const { bot } = namedCells({ cells, known });
    const trips = [];
    const goToPosition = async (_bot, x, y, z) => {
        trips.push(y);
        bot.entity.position = new Vec3(x + 0.5, y, z + 0.5);
        // From each new spot it sees four blocks further up the column, and open sky once out on top.
        for (let k = y; k <= y + 4; k++) known.add(`0,${k},0`);
        if (y > 80) for (let k = y; k <= 319; k++) known.add(`0,${k},0`);
    };
    assert.equal(await climbToSurface(bot, { goToPosition, log }), true);
    assert.equal(trips[0], 71, 'first only up to the ceiling it saw');
    assert.equal(trips.at(-1), 81);
    assert.match(bot.output, /Reached the surface at y=81/);
    assert.doesNotMatch(bot.output.split('\n')[0], /81/, 'the first words do not give the surface away');
});

test('with fair play off the whole column is known, and the first trip goes all the way', async () => {
    const cells = {};
    for (let y = 70; y <= 80; y++) cells[`0,${y},0`] = 'stone';
    const { bot } = namedCells({ cells });
    const trips = [];
    const goToPosition = async (_bot, x, y, z) => { trips.push(y); bot.entity.position = new Vec3(x + 0.5, y, z + 0.5); };
    assert.equal(await climbToSurface(bot, { goToPosition, log }), true);
    assert.deepEqual(trips, [81]);
});

test('at the surface already, the bot says so and stays', async () => {
    const { bot } = namedCells();
    let trips = 0;
    assert.equal(await climbToSurface(bot, { goToPosition: async () => { trips++; }, log }), true);
    assert.equal(trips, 0);
    assert.match(bot.output, /Already at the surface/);
});

test('a climb that gets no higher stops and says so', async () => {
    const { bot } = namedCells({ cells: { '0,70,0': 'stone' }, known: new Set(['0,70,0']) });
    assert.equal(await climbToSurface(bot, { goToPosition: async () => {}, log }), false);
    assert.match(bot.output, /Could not get any higher than y=64/);
});

test('under open sky at the bottom of a shaft, the bot climbs until it can step out', async () => {
    // Ground up to 80 all round, a one-block shaft at the bot's column, the bot in it at 79.
    const cells = {};
    for (let y = 60; y <= 80; y++) for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cells[`${x},${y},${z}`] = 'stone';
    cells['1,81,0'] = 'stone'; // one side a block higher: the lowest wall decides
    const { bot } = namedCells({ cells, at: new Vec3(0.5, 79, 0.5) });
    const trips = [];
    const goToPosition = async (_bot, x, y, z) => { trips.push(y); bot.entity.position = new Vec3(x + 0.5, y, z + 0.5); };
    assert.equal(await climbToSurface(bot, { goToPosition, log }), true);
    assert.deepEqual(trips, [81]);
    assert.match(bot.output, /walls all round: climbing to y=81[\s\S]*Reached the surface at y=81/);
});
