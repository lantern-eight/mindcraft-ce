// SPDX-License-Identifier: CC0-1.0
// Costs on places (src/agent/library/place_costs.js), with danger zones as the places: the real
// pathfinder's route search for a stand-in bot in a hand-built world. Nothing walks, so no server is
// needed. Routes bend round a zone, a bot inside one walks out at the price of plain ground, a goal inside
// one is still reached, other bots plan as before, and fair legs' own steps are priced too, once.
import test from 'node:test';
import assert from 'node:assert/strict';
import pf from 'mineflayer-pathfinder';
import { fixtureWorld, NO_BUDGETS } from './helpers/fixture_world.js';
import { planRoute, walkerBot } from './helpers/walker_bot.js';
import { addPlaceCosts, placeCostAt } from '../src/agent/library/place_costs.js';
import { createDangerZones } from '../src/agent/reflexes/danger_zones.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { installFairLegs } from '../src/agent/fairplay/fair_legs.js';

const near = (x, y, z, range = 1) => new pf.goals.GoalNear(x, y, z, range);

/** A stone floor at y 0 and a bot standing on it, with zones of its own priced into its routes. */
function setup({ position = [0.5, 1, 0.5], priced = true } = {}) {
    const world = fixtureWorld({ min: [-64, -4, -64], max: [96, 12, 64] });
    world.fill('stone', [-64, 0, -64], [96, 0, 64]);
    const bot = walkerBot(world, { position });
    const zones = createDangerZones();
    if (priced) addPlaceCosts(bot, zones);
    return { world, bot, zones, movements: new pf.Movements(bot) };
}

/** How close a route comes to a point, seen from above. */
function closestTo(cells, x, z) {
    return Math.min(...cells.map(hash => { const [cx, , cz] = hash.split(',').map(Number); return Math.hypot(cx + 0.5 - x, cz + 0.5 - z); }));
}

/** The moves from a cell, as { "x,y,z": cost }, cheapest kept. */
function movesFrom(movements, x, y, z) {
    const moves = {};
    for (const move of movements.getNeighbors({ x, y, z, remainingBlocks: 0 })) {
        if (!(move.hash in moves) || move.cost < moves[move.hash]) moves[move.hash] = move.cost;
    }
    return moves;
}

test('a route bends round a zone between the bot and its goal', () => {
    const plain = setup();
    const straight = planRoute(plain.bot, plain.movements, near(40, 1, 0));
    assert.equal(straight.status, 'success');
    assert.ok(closestTo(straight.cells, 20.5, 0.5) < 1.5, 'with no zone the route goes straight through');

    const { bot, zones, movements } = setup();
    zones.note('archer', { x: 20.5, y: 1, z: 0.5 }); // 12 blocks across, 24 at its middle
    const round = planRoute(bot, movements, near(40, 1, 0));
    assert.equal(round.status, 'success');
    assert.ok(closestTo(round.cells, 20.5, 0.5) >= 9, `kept away from the middle (came within ${closestTo(round.cells, 20.5, 0.5).toFixed(1)})`);
    assert.ok(round.cost - straight.cost < 24, 'and going round cost less than going through would have');
});

test('a bot inside a zone walks out at the price of plain ground', () => {
    const plain = setup();
    const out = planRoute(plain.bot, plain.movements, near(30, 1, 0));
    const { bot, zones, movements } = setup();
    zones.note('illagers', { x: 0.5, y: 1, z: 0.5 }); // the bot stands at the middle, priced 64
    assert.equal(placeCostAt(bot, 0, 1, 0), 64);
    const leaving = planRoute(bot, movements, near(30, 1, 0));
    assert.equal(leaving.status, 'success');
    assert.ok(Math.abs(leaving.cost - out.cost) < 1e-9, `the same cost as with no zone (${leaving.cost} against ${out.cost})`);

    // Part way out: steps further out cost what they always did, steps back in cost more.
    const plainMoves = movesFrom(plain.movements, 10, 1, 0);
    const pricedMoves = movesFrom(movements, 10, 1, 0);
    assert.equal(pricedMoves['11,1,0'], plainMoves['11,1,0']);
    assert.ok(pricedMoves['9,1,0'] > plainMoves['9,1,0'] + 1.9, 'a step back in pays about 2 a block');
});

test('a goal in the middle of a zone is still reached', () => {
    const { bot, zones, movements } = setup();
    zones.note('illagers', { x: 40.5, y: 1, z: 0.5 });
    const route = planRoute(bot, movements, near(40, 1, 0, 0));
    assert.equal(route.status, 'success');
    assert.ok(route.cost >= 64, 'it pays for going in');
});

test("one bot's zones never price another bot's routes", () => {
    const { bot: other, movements: otherMoves } = setup({ priced: false });
    const { zones } = setup();
    zones.note('illagers', { x: 20.5, y: 1, z: 0.5 });
    const route = planRoute(other, otherMoves, near(40, 1, 0));
    assert.ok(closestTo(route.cells, 20.5, 0.5) < 1.5);
    assert.equal(placeCostAt(other, 20, 1, 0), 0);
});

test("fair legs' own steps are priced too, and each step only once, whichever is put on first", () => {
    // The zones go on first and fair legs after, the order an agent starts in: the threat reflexes are
    // installed when it starts, fair legs on its first spawn.
    const world = fixtureWorld({ min: [-64, -4, -64], max: [96, 12, 64] });
    world.fill('stone', [-8, 0, -8], [8, 0, 8]); // the bot sees only this; the rest is never seen
    const bot = walkerBot(world, { position: [0.5, 1, 0.5] });
    let on = false;
    const zones = createDangerZones();
    zones.note('illagers', { x: 60.5, y: 1, z: 0.5 });
    addPlaceCosts(bot, { priceAt: (x, y, z) => (on ? zones.priceAt(x, y, z) : 0) });
    const perception = createPerception({ bot, policy: resolvePolicy({ fair_play: 'strict' }), ...NO_BUDGETS });
    const legs = installFairLegs(bot, { getPerception: () => perception, checkEveryMs: 0 });
    try {
        const movements = new pf.Movements(bot);
        // Far out in country the bot never saw, where fair legs adds the level slantwise steps itself.
        const plainMoves = movesFrom(movements, 40, 1, 0);
        on = true;
        const pricedMoves = movesFrom(movements, 40, 1, 0);
        assert.ok('41,1,1' in plainMoves && '41,1,-1' in plainMoves, "fair legs' slantwise steps are there");
        const here = zones.priceAt(40, 1, 0);
        for (const [hash, cost] of Object.entries(plainMoves)) {
            const [x, y, z] = hash.split(',').map(Number);
            const rise = Math.max(0, zones.priceAt(x, y, z) - here);
            assert.ok(Math.abs(pricedMoves[hash] - (cost + rise)) < 1e-9, `${hash}: ${pricedMoves[hash]} is ${cost} + ${rise}`);
        }
    } finally {
        legs.stop();
    }
});
