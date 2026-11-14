// SPDX-License-Identifier: CC0-1.0
// The trail: crumbs the bot drops as it walks, linked into a graph it can route over.
//
// These tests walk a pretend bot along straight lines, a quarter of a block per step, the way the
// recorder will feed real positions in. Nothing here needs a server or a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTrail, loadTrail } from '../src/agent/memory/trail.js';
import { scopeDir } from '../src/agent/memory/files.js';

const SCOPE = 'local:55916/w1/overworld';
const DAY_MS = 24 * 60 * 60 * 1000;

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** A pretend bot: walks straight lines in small steps, one game tick (50 ms) per step. */
function walker(trail, now, start) {
    let p = { ...start };
    trail.visit(p);
    const moveTo = (target, how, step = 0.25) => {
        const total = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
        const steps = Math.max(1, Math.round(total / step));
        const from = p;
        for (let i = 1; i <= steps; i++) {
            const f = i / steps;
            p = { x: from.x + (target.x - from.x) * f, y: from.y + (target.y - from.y) * f, z: from.z + (target.z - from.z) * f };
            now.advance(50);
            trail.visit(p, how);
        }
    };
    return {
        get at() { return trail.current; },
        get position() { return { ...p }; },
        to(x, y, z, how = {}) { moveTo({ x, y, z }, how); return trail.current; },
        /** Steps off an edge and falls: in the air on the way down, on the ground at the bottom. */
        fallTo(x, y, z) {
            moveTo({ x, y: y + 0.5, z }, { supported: false }, 0.5);
            now.advance(50);
            p = { x, y, z };
            trail.visit(p);
            return trail.current;
        },
        /** Appears somewhere else without walking there. */
        teleport(x, y, z) { p = { x, y, z }; now.advance(50); trail.visit(p); return trail.current; },
        wait(ms) { now.advance(ms); trail.visit(p); },
    };
}

const linksOf = (trail, id) => trail.get(id).links.map(link => link.to).sort((a, b) => a - b);

test('T1: walking a line drops a crumb every 4 blocks and links each to the next, both ways', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0.5, y: 64, z: 0.5 });
    bot.to(20.5, 64, 0.5);

    assert.equal(trail.size, 6);
    const xs = [1, 2, 3, 4, 5, 6].map(id => trail.get(id).x);
    assert.deepEqual(xs, [0.5, 4.5, 8.5, 12.5, 16.5, 20.5]);
    assert.deepEqual(linksOf(trail, 1), [2]);
    assert.deepEqual(linksOf(trail, 3), [2, 4]);
    assert.deepEqual(linksOf(trail, 6), [5]);
    // 4 blocks at a quarter block per tick is 16 ticks, so 0.8 seconds.
    assert.equal(trail.get(1).links[0].seconds, 0.8);
    assert.equal(trail.current, 6);
    assert.equal(trail.get(3).kind, 'walk');
});

test('walking the same ground again adds no crumbs', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0.5, y: 64, z: 0.5 });
    bot.to(20.5, 64, 0.5);
    bot.to(0.5, 64, 1.5);  // back, one block to the side
    bot.to(20.5, 64, 0);   // and out again
    assert.equal(trail.size, 6);
    assert.equal(trail.get(3).visits >= 3, true);
});

test('standing still does not make a link look slow', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0.5, y: 64, z: 0.5 });
    bot.to(2.5, 64, 0.5);
    bot.wait(10 * 60 * 1000); // ten minutes at a furnace
    bot.to(4.5, 64, 0.5);
    assert.equal(trail.get(1).links[0].seconds < 2, true);
});

test('T2: crossing an earlier path joins it, and the crossing crumb has four links', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(16, 64, 0);                // crumbs at x = 0, 4, 8, 12, 16
    bot.teleport(8, 64, -10);         // a new stretch, to walk across the first
    bot.to(8, 64, 10);

    const crossing = trail.nearest({ x: 8, y: 64, z: 0 });
    assert.equal(crossing.distance, 0);
    assert.equal(trail.get(crossing.id).links.length, 4);
    // The two stretches are one map now: from the far end of one to the far end of the other.
    const south = trail.nearest({ x: 8, y: 64, z: 10 }).id;
    const route = trail.route(1, south);
    assert.ok(route, 'the first walk and the second are joined');
    assert.equal(route.ids.includes(crossing.id), true);
});

test('T2b: a path crossing midway between two old crumbs still joins', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(16, 64, 0);
    bot.teleport(6, 64, -10);         // x = 6 is midway between the crumbs at 4 and 8
    const start = bot.at;
    bot.to(6, 64, 10);
    assert.ok(trail.route(start, 5), 'a route from the new walk onto the old one');
    assert.ok(trail.route(1, bot.at), 'and from the old walk onto the new one');
});

test('T3: two corridors two blocks apart with a wall between them do not merge', () => {
    const walkBoth = canWalkStraight => {
        const now = clock();
        const trail = createTrail({ scope: SCOPE, now, canWalkStraight });
        const bot = walker(trail, now, { x: 0, y: 64, z: 0.5 });
        bot.to(16, 64, 0.5);
        const endOfFirst = bot.at;
        bot.teleport(0, 64, 2.5);
        const startOfSecond = bot.at;
        bot.to(16, 64, 2.5);
        return { trail, endOfFirst, startOfSecond };
    };
    // A wall along z = 1.5: a straight walk is possible only between spots on the same side of it.
    const wall = (a, b) => (a.z < 1.5) === (b.z < 1.5);
    const walled = walkBoth(wall);
    assert.equal(walled.trail.size, 10);
    assert.equal(walled.trail.route(walled.endOfFirst, walled.startOfSecond), null);
    for (let id = 1; id <= 5; id++) assert.equal(linksOf(walled.trail, id).every(to => to <= 5), true);

    // The same two walks with no wall are one path walked twice.
    const open = walkBoth(() => true);
    assert.equal(open.trail.size, 5);
});

test('T4: a three-block drop is a one-way link, and the way back up goes around', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 70, z: 0 });
    bot.to(8.5, 70, 0);
    const top = bot.at;                       // the crumb at the edge
    const bottom = bot.fallTo(9.5, 67, 0);
    assert.notEqual(bottom, top);
    assert.deepEqual(trail.get(top).links.map(l => l.to).includes(bottom), true, 'down is known');
    assert.equal(trail.get(bottom).links.some(l => l.to === top), false, 'up is not');

    bot.to(17.5, 67, 0);
    assert.equal(trail.route(bottom, top), null, 'no way up yet');

    // Then it finds a slope and walks back up to the top of the drop.
    bot.to(17.5, 67, 4);
    bot.to(9.5, 70, 4);
    bot.to(8, 70, 0);
    const up = trail.route(bottom, top);
    assert.ok(up, 'the slope is a way up');
    assert.equal(up.ids.length > 4, true, 'and it is the long way');
    const down = trail.route(top, bottom);
    assert.deepEqual(down.ids, [top, bottom], 'down is still the jump');
});

test('a one-block step down is two-way: a player can jump back up it', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 65, z: 0 });
    bot.to(3.5, 65, 0);
    bot.fallTo(4.5, 64, 0);
    bot.to(8, 64, 0);
    assert.ok(trail.route(bot.at, 1));
});

test('T5: a teleport starts a new stretch with no link across', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(8, 64, 0);
    const before = bot.at;
    const after = bot.teleport(500, 70, 500);
    bot.to(508, 70, 500);
    assert.notEqual(after, before);
    assert.equal(trail.route(before, after), null);
    assert.equal(trail.route(1, bot.at), null);
    assert.equal(trail.get(after).links.every(l => trail.get(l.to).x > 400), true);
});

test('T6: the way to something seen from a side tunnel goes down that tunnel', () => {
    const now = clock();
    // Rock everywhere except the tunnels, so nothing merges through it.
    const inMain = p => Math.abs(p.z) < 1;
    const inSide = p => (Math.abs(p.x - 20) < 1 && p.z >= 0) || Math.abs(p.z - 12) < 1;
    const sameTunnel = (a, b) => (inMain(a) && inMain(b)) || (inSide(a) && inSide(b));
    const trail = createTrail({ scope: SCOPE, now, canWalkStraight: sameTunnel });
    const bot = walker(trail, now, { x: 0, y: 40, z: 0 });
    bot.to(40, 40, 0);                 // the main tunnel
    bot.to(20, 40, 0);                 // back to the junction
    bot.to(20, 40, 12);                // down the side tunnel
    bot.to(32, 40, 12);                // round its corner
    const seenFrom = bot.at;           // here it sees a chest through a gap, at 32, 40, 5
    const chest = { x: 32, y: 40, z: 5 };

    // By distance alone the nearest crumb is in the main tunnel, on the wrong side of the rock.
    const nearest = trail.nearest(chest);
    assert.equal(nearest.z, 0);
    assert.notEqual(nearest.id, seenFrom);

    const route = trail.route(1, seenFrom);
    const zs = route.points.map(p => p.z);
    assert.equal(zs.at(-1), 12);
    assert.equal(route.points.some(p => p.x === 20 && p.z === 12), true, 'it turns the corner of the side tunnel');
    assert.equal(route.seconds > trail.route(1, nearest.id).seconds, true);
});

test('T7: a blocked link is avoided, tried again after a day, and cleared by walking it', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(16, 64, 0);
    bot.to(16, 64, 8);
    bot.to(0, 64, 8);
    bot.to(0, 64, 0);                  // a loop: back where it started
    assert.equal(bot.at, 1);

    assert.deepEqual(trail.route(1, 3).ids, [1, 2, 3]);
    assert.equal(trail.markBlocked(2, 3), true);
    const around = trail.route(1, 3);
    assert.equal(around.ids.length > 3, true, 'it goes round the loop the other way');
    assert.equal(around.ids.includes(2), false);
    assert.equal(trail.get(2).links.find(l => l.to === 3).blocked, true);
    assert.deepEqual(trail.route(1, 3, { useBlocked: true }).ids, [1, 2, 3]);

    now.advance(DAY_MS + 1);
    assert.deepEqual(trail.route(1, 3).ids, [1, 2, 3], 'a day later it is worth another try');

    trail.markBlocked(2, 3);
    bot.to(8, 64, 0);                  // it walks through after all
    assert.deepEqual(trail.route(1, 3).ids, [1, 2, 3]);
});

test('T8: the trail is saved and loaded, and another world starts empty', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'trail-'));
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(12, 64, 0, { kind: 'water' });
    trail.markBlocked(2, 3);
    assert.equal(trail.dirty, true);
    trail.save(scopeDir(base, SCOPE));
    assert.equal(trail.dirty, false);

    const loaded = loadTrail(scopeDir(base, SCOPE), { scope: SCOPE, now });
    assert.equal(loaded.size, 4);
    assert.deepEqual(loaded.get(2), trail.get(2));
    assert.equal(loaded.get(2).links.find(l => l.to === 3).blocked, true);
    assert.equal(loaded.current, null, 'the walk in progress is not saved');
    // A new session standing on known ground joins the old trail instead of starting a second one.
    loaded.visit({ x: 12.5, y: 64, z: 0.5 });
    assert.equal(loaded.current, 4);
    loaded.visit({ x: 16.5, y: 64, z: 0.5 });
    assert.equal(loaded.size, 5, 'a new crumb gets a new id');
    assert.equal(loaded.current, 5);

    const other = 'local:55916/w2/overworld';
    assert.equal(loadTrail(scopeDir(base, other), { scope: other, now }).size, 0);

    // A damaged file is kept aside and the trail starts empty, rather than stopping the bot.
    const dir = scopeDir(base, SCOPE);
    writeFileSync(path.join(dir, 'trail.json'), '{"version":1,"scope":');
    const warnings = [];
    const original = console.warn;
    console.warn = message => warnings.push(message);
    try {
        assert.equal(loadTrail(dir, { scope: SCOPE, now }).size, 0);
    } finally { console.warn = original; }
    assert.equal(warnings.length, 1);
    assert.equal(readdirSync(dir).some(name => name.startsWith('trail.json.damaged-')), true);
});

test('doors, ladders and water get their own crumbs', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(2, 64, 0);
    bot.to(3, 64, 0, { kind: 'door' });       // through a doorway
    const door = bot.at;
    assert.equal(trail.get(door).kind, 'door');
    assert.equal(trail.get(door).x, 2.3, 'at the doorway, not four blocks on');
    bot.to(5, 64, 0);
    bot.to(5, 70, 0, { kind: 'ladder' });      // up a ladder: a crumb every two blocks of height
    const rungs = [...Array(trail.size)].map((_, i) => trail.get(i + 1)).filter(c => c.kind === 'ladder');
    assert.equal(rungs.length >= 3, true);
    assert.ok(trail.route(bot.at, 1), 'a ladder is climbed both ways');
});

test('nearest can prefer crumbs on the same level', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    bot.to(4, 64, 0);
    const lower = bot.at;
    bot.teleport(1, 67, 20);
    bot.teleport(1, 67, 0);          // a floor above, nearly overhead
    const upper = bot.at;
    const point = { x: 1.5, y: 64, z: 0 };
    assert.equal(trail.nearest(point, { levelWeight: 3 }).id, 1);
    assert.equal(trail.nearest({ x: 1, y: 66, z: 0 }).id, upper);
    assert.equal(trail.nearest({ x: 1, y: 66, z: 0 }, { filter: c => c.y < 65 }).id, 1);
    assert.equal(trail.nearest({ x: 900, y: 64, z: 0 }), null);
    assert.equal(typeof lower, 'number');
});

test('a route over a long trail is quick', () => {
    const now = clock();
    const trail = createTrail({ scope: SCOPE, now });
    const bot = walker(trail, now, { x: 0, y: 64, z: 0 });
    // A 2 km zigzag: about 500 crumbs.
    for (let i = 0; i < 20; i++) { bot.to(i % 2 ? 0 : 96, 64, i * 8); bot.to(i % 2 ? 0 : 96, 64, i * 8 + 8); }
    const started = performance.now();
    const route = trail.route(1, bot.at);
    const took = performance.now() - started;
    assert.ok(route);
    assert.equal(took < 50, true, `routing took ${took.toFixed(1)} ms`);
});
