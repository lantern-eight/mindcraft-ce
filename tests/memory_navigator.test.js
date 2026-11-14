// SPDX-License-Identifier: CC0-1.0
// The navigator: long trips follow the trail the bot has walked.
//
// These tests lay a real trail by walking a pretend bot, then hand the navigator pretend legs: a tiny
// stand-in for the pathfinder that can say "yes, I can walk there without digging" and move. Each test
// decides what the pretend world lets the legs do (a wall here, nothing there), so no server is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrail } from '../src/agent/memory/trail.js';
import { createThings } from '../src/agent/memory/things.js';
import { createCells } from '../src/agent/memory/cells.js';
import { createNavigator, targetOf } from '../src/agent/memory/navigator.js';

const SCOPE = 'local:55916/w1/overworld';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const at = (x, z, y = 64) => ({ x, y, z });

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** Walks a pretend bot through the corners in straight lines, a quarter block per game tick. */
function walk(trail, now, corners) {
    let p = corners[0];
    trail.visit(p);
    for (const corner of corners.slice(1)) {
        const steps = Math.max(1, Math.round(dist(p, corner) / 0.25));
        const from = p;
        for (let i = 1; i <= steps; i++) {
            const f = i / steps;
            p = { x: from.x + (corner.x - from.x) * f, y: from.y + (corner.y - from.y) * f, z: from.z + (corner.z - from.z) * f };
            now.advance(50);
            trail.visit(p);
        }
    }
}

/** A memory with a trail laid along the given walks. Each walk is its own stretch unless it meets an older one. */
function laid(...walks) {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    for (const corners of walks) { trail.breakStretch(); walk(trail, now, corners); }
    return { trail, things: createThings({ scope: SCOPE, now }), now };
}

/** Puts the pretend bot at a spot, the way a fresh session finds itself standing somewhere. */
function stand(memory, pos) {
    memory.trail.breakStretch();
    memory.trail.visit(pos);
    return pos;
}

/**
 * Pretend legs. `open(a, b)` says whether the straight way between two spots can be walked without
 * digging; `through(a, b)` says whether an ordinary path (one that may dig) gets there.
 */
function legs(start, { open = () => true, through = () => false, planReach = 30 } = {}) {
    let pos = { ...start };
    let interrupted = false;
    const walked = [], plans = [];
    const can = p => dist(pos, p) <= planReach && open(pos, p);
    const moveTo = (p, extra = {}) => { walked.push({ from: pos, to: { x: p.x, y: p.y, z: p.z }, ...extra }); pos = { x: p.x, y: p.y, z: p.z }; };
    return {
        walked, plans,
        get pos() { return pos; },
        interrupt() { interrupted = true; },
        position: () => ({ ...pos }),
        interrupted: () => interrupted,
        canWalkTo: async p => { plans.push({ to: p, ok: can(p) }); return can(p); },
        walkTo: async p => { if (!can(p)) throw new Error('No path'); moveTo(p); },
        pushThrough: async p => { if (!through(pos, p)) return false; moveTo(p, { dug: true }); return true; },
    };
}

/** Does the straight line from a to b cross the wall at `x`, between z `from` and z `to`? */
const crossesX = (x, from, to) => (a, b) => {
    if ((a.x - x) * (b.x - x) >= 0) return false;
    const z = a.z + (b.z - a.z) * ((x - a.x) / (b.x - a.x));
    return z >= from && z <= to;
};
/** The same for a wall along `z`, between x `from` and x `to`. */
const crossesZ = (z, from, to) => (a, b) => {
    if ((a.z - z) * (b.z - z) >= 0) return false;
    const x = a.x + (b.x - a.x) * ((z - a.z) / (b.z - a.z));
    return x >= from && x <= to;
};

test('N1: a long way the bot knows is walked in hops of about 20 blocks, to the crumb nearest the target', async () => {
    const memory = laid([at(0, 0), at(100, 0)]);
    const body = legs(stand(memory, at(0.5, 2)));
    const said = [];
    const result = await createNavigator({ memory, legs: body }).follow({ x: 100, y: 64, z: 0, range: 2 }, { say: text => said.push(text) });

    assert.equal(result.followed, true);
    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(100, 0)) <= 2, `ended at ${JSON.stringify(body.pos)}`);
    assert.ok(body.walked.length >= 5 && body.walked.length <= 7, `${body.walked.length} hops`);
    for (const hop of body.walked) assert.ok(dist(hop.from, hop.to) <= 20.5, 'no hop is longer than the pathfinder plans well');
    assert.ok(body.walked.every(hop => !hop.dug), 'nothing was dug');
    assert.match(said.join('\n'), /way you have walked before/);
});

test('N2: with no trail near the bot, or no trail at all, nothing happens and travel is left as it was', async () => {
    const empty = { trail: createTrail({ scope: SCOPE }), things: createThings({ scope: SCOPE }) };
    const idle = legs(at(0, 0));
    assert.equal((await createNavigator({ memory: empty, legs: idle }).follow({ x: 50, y: 64, z: 0, range: 2 })).followed, false);

    const memory = laid([at(0, 0), at(100, 0)]);
    const far = legs(stand(memory, at(0, 60))); // sixty blocks from every crumb it could route from
    const result = await createNavigator({ memory, legs: far }).follow({ x: 100, y: 64, z: 0, range: 2 });
    assert.equal(result.followed, false);
    assert.equal(far.walked.length + idle.walked.length, 0);
    assert.equal(far.plans.length + idle.plans.length, 0, 'it never even asked the pathfinder');
});

test('N3: a way that doubles back is cut short where the far end is close and walkable', async () => {
    // East 40, across 8, back west 40: the end is 8 blocks from the start over open ground.
    const memory = laid([at(0, 0), at(40, 0), at(40, 8), at(0, 8)]);
    const body = legs(stand(memory, at(0, 0)));
    const result = await createNavigator({ memory, legs: body }).follow({ x: 0, y: 64, z: 8, range: 1 });

    assert.equal(result.reached, 'end');
    assert.equal(body.walked.length, 1, 'one hop, straight across');
    assert.ok(dist(body.pos, at(0, 8)) <= 1.5);
});

test('N4: with rock between the two arms, the same way is followed round, and never through', async () => {
    const memory = laid([at(0, 0), at(40, 0), at(40, 8), at(0, 8)]);
    const wall = crossesZ(4, -10, 38); // rock between the arms, open only at the far end
    const body = legs(stand(memory, at(0, 0)), { open: (a, b) => !wall(a, b) });
    const result = await createNavigator({ memory, legs: body }).follow({ x: 0, y: 64, z: 8, range: 1 });

    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(0, 8)) <= 1.5, `ended at ${JSON.stringify(body.pos)}`);
    for (const hop of body.walked) assert.ok(!wall(hop.from, hop.to), 'no hop crosses the rock');
    assert.ok(body.walked.every(hop => !hop.dug));
    // Trying the short cut and finding rock costs a plan each time, so it must not be tried at every hop.
    assert.ok(body.plans.filter(plan => !plan.ok).length <= 4, `${body.plans.filter(plan => !plan.ok).length} failed plans`);
});

test('N5: a remembered thing is approached from where it was seen, not from the crumb nearest to it', async () => {
    // Two tunnels side by side, joined at the west end. The chest was seen from tunnel A; tunnel B
    // passes right behind its wall.
    const memory = laid([at(30, 0), at(0, 0), at(0, 10), at(30, 10)]);
    const seenFrom = memory.trail.nearest(at(28, 0)).id;
    memory.things.see({ x: 30, y: 64, z: 7 }, 'chest', { from: seenFrom, fromDistance: 7 });
    assert.equal(Math.round(memory.trail.nearest({ x: 30, y: 64, z: 7 }).z), 10, 'the nearest crumb really is in tunnel B');

    const body = legs(stand(memory, at(0, 10)));
    const result = await createNavigator({ memory, legs: body }).follow({ x: 30, y: 64, z: 7, range: 4 });
    assert.equal(result.reached, 'end');
    assert.equal(Math.round(body.pos.z), 0, `ended at ${JSON.stringify(body.pos)}: tunnel A`);
    assert.ok(body.pos.x >= 24, 'at its far end, where the chest was seen from');
});

test('N6: a blocked way is marked and said, and the bot goes round by another way it knows', async () => {
    // A direct way east, and a longer way round to the same spot.
    const memory = laid([at(0, 0), at(40, 0), at(40, 12), at(0, 12), at(0, 0)]);
    const wall = crossesX(22, -3, 3); // someone walled up the direct way
    const body = legs(stand(memory, at(0, 0)), { open: (a, b) => !wall(a, b) });
    const said = [];
    const result = await createNavigator({ memory, legs: body }).follow({ x: 40, y: 64, z: 0, range: 1 }, { say: text => said.push(text) });

    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(40, 0)) <= 1.5);
    for (const hop of body.walked) assert.ok(!wall(hop.from, hop.to), 'it never went through the wall');
    assert.match(said.join('\n'), /blocked near \d+, 64, 0/);
    assert.match(said.join('\n'), /Going around/);
    const before = memory.trail.nearest(at(20, 0)), after = memory.trail.nearest(at(24, 0));
    assert.equal(memory.trail.get(before.id).links.find(link => link.to === after.id).blocked, true, 'the link is remembered as blocked');
    assert.equal(memory.trail.route(before.id, after.id).ids.length > 2, true, 'and routes now avoid it');
});

test('N7: with no other way known, the bot pushes on to the next crumb by an ordinary path, then carries on', async () => {
    const memory = laid([at(0, 0), at(60, 0)]);
    const wall = crossesX(22, -3, 3);
    const body = legs(stand(memory, at(0, 0)), { open: (a, b) => !wall(a, b), through: () => true });
    const said = [];
    const result = await createNavigator({ memory, legs: body }).follow({ x: 60, y: 64, z: 0, range: 1 }, { say: text => said.push(text) });

    assert.equal(result.reached, 'end');
    assert.equal(body.walked.filter(hop => hop.dug).length, 1, 'one stretch by an ordinary path');
    assert.match(said.join('\n'), /blocked near/);
    assert.doesNotMatch(said.join('\n'), /Going around/);
});

test('N7b: past a blockage it aims for the farthest spot ahead that is close, not back onto the old route', async () => {
    // A corridor out and back, the two arms side by side. The bot is half-way down the second arm,
    // going back to the start, and finds it walled up. The start is close by through the side wall;
    // the next spot on its old route is the long way round.
    const memory = laid([at(0, 0), at(40, 0), at(40, 6), at(0, 6)]);
    const sideWall = crossesZ(3, -5, 39.5), newWall = crossesX(21, 5, 7);
    const body = legs(stand(memory, at(0, 6)), { open: (a, b) => !sideWall(a, b) && !newWall(a, b), through: (a, b) => !newWall(a, b) });
    const result = await createNavigator({ memory, legs: body }).follow({ x: 0, y: 64, z: 0, range: 1 });

    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(0, 0)) <= 1.5);
    const push = body.walked.find(hop => hop.dug);
    assert.ok(Math.round(push.to.z) === 0 && push.to.x < 10, `it pushed through to ${JSON.stringify(push.to)}: the first arm, near where it was going`);
    assert.ok(Math.max(...body.walked.map(hop => hop.to.x)) < 21, 'and never went round to the far side of the wall');
});

test('N8: blocked with no way round and no way through, it stops where it is and says how far it got', async () => {
    const memory = laid([at(0, 0), at(60, 0)]);
    const wall = crossesX(22, -3, 3);
    const body = legs(stand(memory, at(0, 0)), { open: (a, b) => !wall(a, b) });
    const result = await createNavigator({ memory, legs: body }).follow({ x: 60, y: 64, z: 0, range: 1 });

    assert.equal(result.followed, true);
    assert.equal(result.reached, 'part');
    assert.equal(result.reason, 'blocked');
    assert.ok(dist(body.pos, at(20, 0)) <= 1, 'it is standing at the last crumb before the wall');
});

test('N9: an interrupt ends the trip at once, as an error the caller sees', async () => {
    const memory = laid([at(0, 0), at(100, 0)]);
    const body = legs(stand(memory, at(0, 0)));
    const walkTo = body.walkTo;
    body.walkTo = async p => { await walkTo(p); body.interrupt(); };
    await assert.rejects(createNavigator({ memory, legs: body }).follow({ x: 100, y: 64, z: 0, range: 1 }), /interrupted/);
    assert.equal(body.walked.length, 1, 'it stopped after the hop it was on');
});

test('N10: a trip the trail cannot shorten is left to ordinary travel', async () => {
    const memory = laid([at(0, 0), at(40, 0)]);
    // The target is far off to the side: no crumb is meaningfully nearer to it than the bot is.
    const body = legs(stand(memory, at(0, 0)));
    assert.equal((await createNavigator({ memory, legs: body }).follow({ x: 20, y: 64, z: -300, range: 2 })).followed, false);
    // Already there: nothing to do.
    assert.equal((await createNavigator({ memory, legs: body }).follow({ x: 1, y: 64, z: 0, range: 4 })).followed, false);
    assert.equal(body.walked.length, 0);
});

test('N11: where the trail ends short of the target, it is followed as far as it helps', async () => {
    const memory = laid([at(0, 0), at(60, 0)]);
    const body = legs(stand(memory, at(0, 0)));
    const result = await createNavigator({ memory, legs: body }).follow({ x: 200, y: 64, z: 0, range: 2 });
    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(60, 0)) <= 1.5, 'it is at the end of the trail, 140 blocks from the target; the rest is ordinary travel');
});

test('N12: a bot set down beside the trail, on a spot it has never walked, still joins it', async () => {
    const memory = laid([at(0, 0), at(60, 0)]);
    const body = legs(stand(memory, at(10, 6))); // six blocks off: a crumb of its own, linked to nothing
    const result = await createNavigator({ memory, legs: body }).follow({ x: 60, y: 64, z: 0, range: 1 });
    assert.equal(result.reached, 'end');
    assert.ok(dist(body.pos, at(60, 0)) <= 1.5);
});

test('N13: one trip at a time: a hop never starts another trip', async () => {
    const memory = laid([at(0, 0), at(60, 0)]);
    const body = legs(stand(memory, at(0, 0)));
    const navigator = createNavigator({ memory, legs: body });
    const first = navigator.follow({ x: 60, y: 64, z: 0, range: 1 });
    assert.deepEqual(await navigator.follow({ x: 60, y: 64, z: 0, range: 1 }), { followed: false, reason: 'busy' });
    assert.equal((await first).reached, 'end');
});

test('N14: a crumb close to the target but behind a wall the bot remembers is not a way there', async () => {
    // The bot walked one arm of a corridor and round the corner. The target is at the far end of the
    // other arm, which it has not walked: straight ahead, and two blocks from where it started, through
    // the wall between the arms. It saw that wall. Going back to the start would be going the wrong way.
    const memory = laid([at(0, 0), at(40, 0), at(40, 2)]);
    memory.cells = createCells();
    for (let x = 0; x < 40; x++) for (const y of [64, 65]) memory.cells.write(x, y, 1, 'dirt');
    const body = legs(at(40, 2));
    const navigator = createNavigator({ memory, legs: body, blocksWay: name => name === 'dirt' });
    // Not the start, two blocks from the target. And not a spot half-way back along the arm it walked
    // either, though that one is 20 blocks closer to the target: the same wall is still in between.
    assert.equal((await navigator.follow({ x: 0, y: 64, z: 2, range: 0 })).followed, false);
    assert.equal(body.walked.length, 0);

    // With no wall remembered there, the same spot counts as being there, and the known way is taken.
    const open = laid([at(0, 0), at(40, 0), at(40, 2)]);
    open.cells = createCells();
    const free = legs(at(40, 2));
    const result = await createNavigator({ memory: open, legs: free, blocksWay: name => name === 'dirt' }).follow({ x: 0, y: 64, z: 2, range: 0 });
    assert.equal(result.reached, 'end');
    assert.ok(dist(free.pos, at(0, 0)) <= 1.5);
});

test('N15: a known way that ends short is only taken when it is a fairly direct way to get much closer', async () => {
    // The trail runs 100 blocks east, 40 across, and 100 back: its end is 40 blocks from its start.
    const memory = laid([at(0, 0), at(100, 0), at(100, 40), at(0, 40)]);
    const body = legs(stand(memory, at(0, 0)));
    // The target is 80 blocks away, straight past that end. The trail would bring the bot 40 blocks
    // closer, by walking 240. Ordinary travel should just set off.
    assert.equal((await createNavigator({ memory, legs: body }).follow({ x: 0, y: 64, z: 80, range: 2 })).followed, false);
    assert.equal(body.walked.length, 0);
    // The far end of the trail itself is a place the bot has been, however long the way round is.
    // (Here the way is open, so it is cut short. With rock in between it would be walked in full.)
    const result = await createNavigator({ memory, legs: body }).follow({ x: 0, y: 64, z: 40, range: 1 });
    assert.equal(result.reached, 'end');
});

test('targetOf reads a fixed spot out of a pathfinder goal, and nothing out of a moving or inverted one', () => {
    assert.deepEqual(targetOf({ x: 5, y: 64, z: -3, rangeSq: 16 }), { x: 5, y: 64, z: -3, range: 4 });
    assert.deepEqual(targetOf({ x: 5, y: 64, z: -3 }), { x: 5, y: 64, z: -3, range: 0 });
    assert.equal(targetOf({ x: 5, y: 64, z: -3, rangeSq: 4, entity: {} }), null, 'following something that moves');
    assert.equal(targetOf({ goal: { x: 5, y: 64, z: -3 } }), null, 'moving away from somewhere');
    assert.equal(targetOf({ x: 5, z: -3 }), null, 'no height given');
    assert.equal(targetOf(null), null);
});
