// SPDX-License-Identifier: CC0-1.0
// Fair legs: the pathfinder plans a route over what the bot has seen, not over every loaded block.
//
// These run the real pathfinder's route search for a stand-in bot in small hand-built worlds, with the
// real perception and (where a test is about remembering) the real world memory. Nothing walks, so no
// server is needed. The test that matters most is the first one: two worlds that look the same from
// where the bot stands, and differ in what it cannot see, must give the same route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import { fixtureWorld, NO_BUDGETS } from './helpers/fixture_world.js';
import { planRoute, walkerBot } from './helpers/walker_bot.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { fairLegsOf, installFairLegs } from '../src/agent/fairplay/fair_legs.js';
import { openMemory } from '../src/agent/memory/store.js';
import { createRecorder } from '../src/agent/memory/recorder.js';
import { squareCorners } from '../src/agent/library/skills.js';
import { installFairPlay } from '../src/agent/fairplay/install.js';
import { initModes } from '../src/agent/modes.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';

const SCOPE = 'world:legs/overworld';
const near = (x, y, z, range = 1) => new pf.goals.GoalNear(x, y, z, range);

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/**
 * A stone floor at y 0 with the bot standing on it, and whatever `build` adds.
 * @param {(world: object) => void} build
 * @param {object} [options]
 * @param {boolean} [options.memory] - give the bot world memory (true) or only its eyes (false)
 * @param {boolean} [options.legs] - put the bot under fair legs. Without them it plans as stock Mindcraft does
 * @param {number[]} [options.position] - where the bot stands
 */
function setup(build = () => {}, { memory = true, legs = true, position = [0.5, 1, 0.5], rules = {} } = {}) {
    const world = fixtureWorld({ min: [-64, -12, -64], max: [64, 24, 64] });
    world.fill('stone', [-64, 0, -64], [64, 0, 64]);
    build(world);
    const bot = walkerBot(world, { position });
    // Seeing all around: these scenes are about planning over what was seen, from every side.
    const policy = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 360, ...rules } });
    const now = clock();
    let perception, recorder = null, store = null;
    if (memory) {
        store = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'legs-')), scope: SCOPE, now, canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
        recorder = createRecorder({ bot, memory: store, now, tickBudgetMs: Infinity });
        perception = createPerception({ bot, policy, memory: recorder.view, now, ...NO_BUDGETS });
        recorder.attach(perception);
        recorder.listen();
    } else {
        perception = createPerception({ bot, policy, now, ...NO_BUDGETS });
    }
    // The tests call check() themselves, and time stands still unless a test moves it.
    const handle = legs ? installFairLegs(bot, { getPerception: () => perception, clock: now, checkEveryMs: 0 }) : null;
    /** The bot looks over everything around it, as the recorder does a few times a second in the game. */
    const lookAround = () => { bot.emit('blockUpdate', null, { position: bot.entity.position }); recorder?.tick(); };
    /** Puts the bot somewhere else and lets a moment pass, so nothing it believed a moment ago is reused. */
    const standAt = (x, y, z) => { bot.moveTo(x, y, z); now.advance(1000); };
    return { world, bot, perception, recorder, store, legs: handle, now, lookAround, standAt };
}

/** The moves the pathfinder would consider from a cell, as { "x,y,z": { cost, dig, place } }, cheapest kept. */
function movesFrom(movements, x, y, z, remainingBlocks = 0) {
    const moves = {};
    for (const move of movements.getNeighbors({ x, y, z, remainingBlocks })) {
        if (moves[move.hash] && moves[move.hash].cost <= move.cost) continue;
        moves[move.hash] = { cost: Number(move.cost.toFixed(3)), dig: move.toBreak.length, place: move.toPlace.length };
    }
    return moves;
}

// A long bank of dirt across the bot's way, nine blocks thick, with the goal on the far side. In one world
// the bank is solid. In the other it is a shell one block thick round a hollow, which nothing outside can
// see into. From where the bot stands the two look exactly alike.
const bank = hollow => world => {
    world.fill('dirt', [6, 1, -14], [14, 4, 14]);
    if (hollow) world.fill('air', [7, 1, -13], [13, 3, 13]);
};
const BEYOND_BANK = near(20, 1, 0);

test('the route is the same whatever the cells the bot has not seen hold', () => {
    // First, why this matters: the stock pathfinder reads every loaded block, so it knows which bank is
    // hollow. It cuts through the hollow one and walks round the solid one.
    const stock = [true, false].map(hollow => {
        const { bot } = setup(bank(hollow), { legs: false });
        return planRoute(bot, new pf.Movements(bot), BEYOND_BANK);
    });
    assert.equal(stock[0].status, 'success');
    assert.equal(stock[1].status, 'success');
    assert.notDeepEqual(stock[0].cells, stock[1].cells, 'stock planning tells the two banks apart');
    assert.ok(stock[0].cells.includes('10,1,0') && !stock[1].cells.includes('10,1,0'), 'it goes through the hollow one only');

    // Under fair legs the bot cannot tell them apart, so it must plan the same way through both.
    for (const memory of [true, false]) {
        const fair = [true, false].map(hollow => {
            const { bot, lookAround } = setup(bank(hollow), { memory });
            lookAround();
            return planRoute(bot, new pf.Movements(bot), BEYOND_BANK);
        });
        assert.equal(fair[0].status, 'success');
        assert.deepEqual(fair[0].cells, fair[1].cells, `the same route through both banks (world memory ${memory ? 'on' : 'off'})`);
        assert.equal(fair[0].cost, fair[1].cost);
        // And it digs only what it has seen: the face of the bank. What is behind that face it does not know.
        const dug = fair[1].path.flatMap(step => step.toBreak.map(p => `${p.x},${p.y},${p.z}`));
        assert.deepEqual(dug.sort(), ['6,1,0', '6,2,0'], 'it plans to dig the two blocks it can see are in the way');
    }
});

test('a cell never seen counts as open ground: fit to walk through and fit to stand on', () => {
    // Deep inside a block of stone the bot has only seen the outside of. Every move from there, in every
    // direction and up and down, is an ordinary step that digs and places nothing.
    const { bot, lookAround } = setup(w => w.fill('stone', [20, 1, 20], [40, 12, 40]));
    lookAround();
    const moves = movesFrom(new pf.Movements(bot), 30, 6, 30);
    const flat = Number(Math.SQRT2.toFixed(3));
    for (const [cell, cost] of [['31,6,30', 1], ['29,6,30', 1], ['30,6,31', 1], ['30,6,29', 1],          // straight on
        ['31,6,31', flat], ['29,6,29', flat], ['31,6,29', flat], ['29,6,31', flat],                     // slantwise
        ['31,7,30', 2], ['30,7,29', 2],                                                                 // a step up
        ['31,5,30', 1], ['30,5,30', 1]]) {                                                              // a step down
        assert.deepEqual(moves[cell], { cost, dig: 0, place: 0 }, `to ${cell}`);
    }
    // goToGoal squares its corners. That must not take the slantwise steps over unseen ground away, or a
    // long trip through the unknown would be searched as a staircase of right angles.
    const squared = movesFrom(squareCorners(new pf.Movements(bot)), 30, 6, 30);
    assert.deepEqual(squared['31,6,31'], { cost: flat, dig: 0, place: 0 });

    // The same spot for a bot without fair legs is solid stone: every way out is dug.
    const stock = setup(w => w.fill('stone', [20, 1, 20], [40, 12, 40]), { legs: false });
    const stockMoves = movesFrom(new pf.Movements(stock.bot), 30, 6, 30);
    assert.ok(Object.values(stockMoves).every(move => move.dig > 0), 'stock planning knows it is stone');
});

test('a long trip through the unknown is searched straight at the goal, not all around', () => {
    const { bot, lookAround } = setup();
    lookAround();
    const route = planRoute(bot, squareCorners(new pf.Movements(bot)), near(55, 1, 40));
    assert.equal(route.status, 'success');
    // 40 slantwise steps and 15 straight ones. Without level slantwise steps over unseen ground it would be 95.
    assert.ok(route.cost < 75, `the route costs ${route.cost.toFixed(1)}`);
    assert.ok(route.visited < 400, `the search looked at ${route.visited} cells for a ${route.cells.length}-step route`);
});

test('what is in view is planned as it really is: seen air is not ground, and a seen wall is dug or walked round', () => {
    // A hole in the floor two blocks ahead, deeper than the bot can see the bottom of.
    const { bot, lookAround } = setup(w => { w.fill('air', [2, -6, 0], [2, 0, 0]); w.fill('stone', [5, 1, -3], [5, 3, 3]); });
    lookAround();
    const movements = new pf.Movements(bot);
    assert.equal(movesFrom(movements, 1, 1, 0)['2,1,0'], undefined, 'no walking onto the hole it can see');
    assert.deepEqual(movesFrom(movements, 1, 1, 1)['2,1,1'], { cost: 1, dig: 0, place: 0 }, 'the floor beside the hole is fine');
    assert.equal(movesFrom(movements, 4, 1, 0)['5,1,0'].dig, 2, 'the wall it sees has to be dug through');

    // The same hole forty blocks away, never looked at, is believed to be ground like everything else.
    const far = setup(w => w.fill('air', [42, -6, 0], [42, 0, 0]));
    far.lookAround();
    assert.deepEqual(movesFrom(new pf.Movements(far.bot), 41, 1, 0)['42,1,0'], { cost: 1, dig: 0, place: 0 });
});

test('a wall the bot saw and can no longer see still stands, and stands as it was last seen', () => {
    const scene = w => {
        w.fill('stone', [10, 1, 0], [10, 2, 0]);           // a pillar in the open
        w.fill('stone', [-5, 1, -6], [-5, 4, 6]);          // a screen to stand behind
    };
    const { world, bot, lookAround, standAt } = setup(scene);
    lookAround();                                          // the bot sees the pillar
    standAt(-8.5, 1, 0.5);                                 // then goes behind the screen, where it can't
    lookAround();
    world.fill('air', [10, 1, 0], [10, 2, 0]);             // and someone takes the pillar away meanwhile
    assert.equal(movesFrom(new pf.Movements(bot), 9, 1, 0)['10,1,0'].dig, 2, 'it still plans for the pillar it remembers');

    // Without world memory the bot keeps nothing it is not looking at: the pillar is unknown again.
    const forgetful = setup(scene, { memory: false });
    forgetful.lookAround();
    assert.equal(movesFrom(new pf.Movements(forgetful.bot), 9, 1, 0)['10,1,0'].dig, 2, 'in view, it is known');
    forgetful.standAt(-8.5, 1, 0.5);
    assert.deepEqual(movesFrom(new pf.Movements(forgetful.bot), 9, 1, 0)['10,1,0'], { cost: 1, dig: 0, place: 0 });
});

test('air the bot looked down through is remembered as open, from wherever it plans later', () => {
    // A drop to lower ground. Standing at the edge the bot sees the ground below; it does not see, as
    // cells, the air between. But it knows the space over ground it looked down on is empty.
    const { bot, perception, lookAround, standAt } = setup(w => { w.fill('air', [5, -5, -8], [20, 0, 8]); w.fill('stone', [5, -6, -8], [20, -6, 8]); },
        { position: [4.9, 1, 0.5] });
    lookAround();
    standAt(-40.5, 1, 0.5);                                // far out of sight of the drop
    lookAround();
    const movements = new pf.Movements(bot);
    // Asked as the legs ask it: only what is within 24 blocks is checked for being in view right now.
    assert.equal(perception.believedAt(8, 0, 0, 24)?.name, 'air', 'the air over the lower ground is believed open');
    assert.equal(movesFrom(movements, 4, 1, 0)['5,1,0'], undefined, 'so there is no walking straight off the edge');
    assert.equal(perception.believedAt(8, -9, 0, 24), null, 'and what is under that ground is still unknown');
});

test('air seen while planning is not forgotten when the bot steps back from it', () => {
    // Without this the bot would dither at a pit: see it, turn away, lose sight of it, and head back.
    // World memory does not record the air the bot looks through, so the legs keep what they saw of it
    // themselves, and that has to hold with world memory off as well.
    for (const memory of [true, false]) {
        const { bot, lookAround, standAt } = setup(w => w.fill('air', [2, -9, 0], [2, 0, 0]), { memory });
        lookAround();
        const movements = new pf.Movements(bot);
        assert.equal(movesFrom(movements, 1, 1, 0)['2,1,0'], undefined, 'seen from beside it');
        standAt(-30.5, 1, 0.5);
        lookAround();
        assert.equal(movesFrom(movements, 1, 1, 0)['2,1,0'], undefined, `still known from far away (world memory ${memory ? 'on' : 'off'})`);
    }
});

test('the route is planned again when the way ahead turns out not to be as believed', () => {
    const { bot, legs, now, standAt, lookAround } = setup(w => w.fill('air', [34, -9, -1], [36, 0, 1]));
    lookAround();
    let replans = 0;
    const setMovements = bot.pathfinder.setMovements;
    bot.pathfinder.setMovements = movements => { replans++; return setMovements(movements); };

    // The bot sets off across ground it has not seen. The route runs straight over a pit it knows nothing of.
    const route = planRoute(bot, bot.pathfinder.movements, near(50, 1, 0));
    assert.ok(route.cells.includes('35,1,0'));
    bot.emit('path_update', route);
    legs.check();
    assert.equal(replans, 0, 'with no goal set, the pathfinder is not walking any route: nothing to look at');
    bot.pathfinder.setGoal(near(50, 1, 0));
    bot.emit('path_update', route);                        // as the pathfinder does when it takes a route up
    legs.check();
    assert.equal(replans, 0, 'nothing ahead has changed: the route stands');

    // It walks on. Eight blocks along, the pit is still too far off to see: nothing to do.
    route.path.splice(0, 8);
    standAt(8.5, 1, 0.5);
    lookAround();
    legs.check();
    assert.equal(replans, 0);

    // At the edge it sees the pit. The step onto it is no longer one the pathfinder would take. But a new
    // plan halts the bot for a moment, so it waits while the bot is in the air or digging.
    route.path.splice(0, 24);
    standAt(32.5, 1, 0.5);
    lookAround();
    bot.entity.onGround = false;
    legs.check();
    assert.equal(replans, 0, 'not in mid-air');
    bot.entity.onGround = true;
    legs.check();
    assert.equal(replans, 1, 'the route is planned again');
    assert.equal(legs.replans, 1);

    // A second look straight after does not ask again: the pathfinder has not had time to answer the first.
    bot.emit('path_update', route);
    legs.check();
    assert.equal(replans, 1);
    now.advance(1000);
    legs.check();
    assert.equal(replans, 2, 'but a route that is still wrong a second later is asked for again');

    // A fresh route from here knows about the pit, and stands.
    const again = planRoute(bot, bot.pathfinder.movements, near(50, 1, 0));
    assert.equal(again.status, 'success');
    assert.ok(!again.cells.includes('35,1,0'));
    bot.emit('path_update', again);
    now.advance(1000);
    legs.check();
    assert.equal(replans, 2);

    // A route the pathfinder has dropped is not looked at any more.
    bot.emit('path_update', route);
    bot.emit('path_reset', 'stuck');
    now.advance(1000);
    legs.check();
    assert.equal(replans, 2);
});

test('a mob the bot cannot see adds nothing to the cost of a route; one in view does', () => {
    const mob = (id, x, z) => ({ id, type: 'hostile', name: 'zombie', position: new Vec3(x + 0.5, 1, z + 0.5), height: 1.95, width: 0.6 });
    const scene = w => w.fill('stone', [5, 1, -3], [5, 4, 3]);
    const entities = [mob(7, 8, 0), mob(8, -4, 0)];        // one behind the wall, one in the open
    const counted = bot => {
        const movements = new pf.Movements(bot);
        movements.updateCollisionIndex();
        return [movements.getNumEntitiesAt({ x: 8, y: 1, z: 0 }, 0, 0, 0), movements.getNumEntitiesAt({ x: -4, y: 1, z: 0 }, 0, 0, 0)];
    };
    const fair = setup(scene);
    for (const entity of entities) fair.bot.entities[entity.id] = entity;
    assert.deepEqual(counted(fair.bot), [0, 1]);
    const stock = setup(scene, { legs: false });
    for (const entity of entities) stock.bot.entities[entity.id] = entity;
    assert.deepEqual(counted(stock.bot), [1, 1], 'stock planning is told about both');
});

test('a bot without fair legs plans as before, even after another bot got them', () => {
    const scene = w => w.fill('stone', [20, 1, 20], [40, 12, 40]);
    const fair = setup(scene);
    assert.ok(fairLegsOf(fair.bot));
    const plain = setup(scene, { legs: false });
    assert.equal(fairLegsOf(plain.bot), null);
    assert.ok(Object.values(movesFrom(new pf.Movements(plain.bot), 30, 6, 30)).every(move => move.dig > 0));

    // And taking them off again gives the bot its stock planning back.
    fair.legs.stop();
    assert.equal(fairLegsOf(fair.bot), null);
    assert.ok(Object.values(movesFrom(new pf.Movements(fair.bot), 30, 6, 30)).every(move => move.dig > 0));
});

test('with sight set to "all", fair legs plan over every loaded block, as the rest of fair play then sees it', () => {
    const { bot } = setup(bank(true), { rules: { sight: 'all' } });
    const route = planRoute(bot, new pf.Movements(bot), BEYOND_BANK);
    assert.ok(route.cells.includes('10,1,0'), 'it knows the bank is hollow');
});

test('route_planning is a switch: "seen" under strict, "all" when fair play is off or a custom policy says so', () => {
    assert.equal(resolvePolicy({ fair_play: 'strict' }).route_planning, 'seen');
    assert.equal(resolvePolicy({ fair_play: 'off' }).route_planning, 'all');
    assert.equal(resolvePolicy({ fair_play: 'custom', fair_play_custom: { route_planning: 'all' } }).route_planning, 'all');
    assert.throws(() => resolvePolicy({ fair_play: 'custom', fair_play_custom: { route_planning: 'some' } }), /route_planning must be one of/);
});

test('a block the bot is told to break is judged by what it has seen around it', () => {
    // Skills ask a Movements object whether a block is safe to break. Lava the bot has not seen behind
    // the block is no reason to refuse; lava it can see is.
    const { bot, lookAround } = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 4, 2]);
        w.set('lava', 5, 2, 0);                            // buried behind the face
        w.set('lava', 4, 2, 3);                            // in the open, beside the block at 4, 2, 2
    });
    lookAround();
    const movements = new pf.Movements(bot);
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    assert.ok(movements.safeToBreak(blockAt(4, 2, 0)), 'unseen lava behind it does not count');
    assert.ok(!movements.safeToBreak(blockAt(4, 2, 2)), 'lava in view beside it does');
});

test('installing fair play gives the bot fair legs, unless the policy says route_planning "all"', () => {
    const install = config => {
        const world = fixtureWorld({ min: [-64, -12, -64], max: [64, 24, 64] });
        world.fill('stone', [-64, 0, -64], [64, 0, 64]);
        world.fill('stone', [20, 1, 20], [40, 12, 40]);
        const bot = walkerBot(world);
        bot._client = new EventEmitter();
        bot.worldIdentity = 'legs';
        bot.chat = () => {};
        const agent = { name: 'Fairy', bot, task: null, openChat: () => {}, prompter: { profile: {}, getInitModes: () => ({}) } };
        initModes(agent);
        const dir = mkdtempSync(path.join(tmpdir(), 'legs-install-'));
        const handle = installFairPlay(agent, { config: { host: 'localhost', port: 1, ...config }, memoryDir: dir, perceptionOptions: NO_BUDGETS });
        return { bot, handle };
    };
    try {
        for (const world_memory of [true, false]) {
            const strict = install({ fair_play: 'strict', world_memory });
            assert.ok(strict.handle.legs, `strict fair play, world memory ${world_memory ? 'on' : 'off'}`);
            assert.equal(fairLegsOf(strict.bot), strict.handle.legs);
            // Inside stone it has only seen the outside of, the bot plans as over open ground.
            assert.deepEqual(movesFrom(new pf.Movements(strict.bot), 30, 6, 30)['31,6,30'], { cost: 1, dig: 0, place: 0 });
            strict.bot.emit('end');
            assert.equal(fairLegsOf(strict.bot), null, 'they come off when the bot leaves');
        }
        const loose = install({ fair_play: 'custom', fair_play_custom: { route_planning: 'all' } });
        assert.equal(loose.handle.legs, null);
        assert.equal(fairLegsOf(loose.bot), null);
        assert.equal(movesFrom(new pf.Movements(loose.bot), 30, 6, 30)['31,6,30'].dig, 2, 'stock planning: it knows the stone is there');
        loose.bot.emit('end');
    } finally { setWorldQueries(null); }
});
