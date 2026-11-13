// SPDX-License-Identifier: CC0-1.0
// Places: clusters of things a player uses, found by the bot or named by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlaces, loadPlaces } from '../src/agent/memory/places.js';

const SCOPE = 'local:55916/w1/overworld';

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

test('P1: four chests and a bed in one room are one place; a chest 200 blocks away is another', () => {
    const places = createPlaces({ scope: SCOPE, now: clock() });
    const first = places.noteThing({ x: 0, y: 64, z: 0, from: 3 });
    assert.deepEqual(first, { id: 1, isNew: true, joined: [] });
    for (const [x, z] of [[1, 0], [2, 0], [3, 0]]) assert.equal(places.noteThing({ x, y: 64, z }).id, 1);
    assert.equal(places.noteThing({ x: 2, y: 64, z: 5 }).isNew, false, 'the bed across the room');
    const far = places.noteThing({ x: 200, y: 70, z: 0, from: 40 });
    assert.deepEqual([far.id, far.isNew], [2, true]);
    assert.equal(places.size, 2);

    const home = places.get(1);
    assert.deepEqual([home.min, home.max], [{ x: 0, y: 64, z: 0 }, { x: 3, y: 64, z: 5 }]);
    assert.equal(home.kind, 'found');
    assert.equal(home.name, null, 'no one has named it yet');
    assert.equal(home.crumb, 3, 'the spot the bot stood on when it first saw it');

    assert.equal(places.at({ x: 1.5, y: 64, z: 2.5 }).id, 1);
    assert.equal(places.at({ x: 6, y: 65, z: 2 }).id, 1, 'just outside the door still counts');
    assert.equal(places.at({ x: 60, y: 64, z: 0 }), null);
    assert.deepEqual(places.near({ x: 150, y: 64, z: 0 }).map(p => p.id), [2, 1]);
    assert.deepEqual(places.near({ x: 150, y: 64, z: 0 }, { maxDistance: 60 }).map(p => p.id), [2]);
});

test('P2: a thing built between two places joins them, and the older id and name survive', () => {
    const places = createPlaces({ scope: SCOPE, now: clock() });
    places.noteThing({ x: 0, y: 64, z: 0 });          // place 1
    places.noteThing({ x: 60, y: 64, z: 0 });         // place 2, too far to belong to 1
    places.name(2, 'the farm');
    assert.equal(places.size, 2);

    const bridge = places.noteThing({ x: 30, y: 64, z: 0 });   // 30 from each... not close enough yet
    assert.equal(bridge.isNew, true);
    const link = places.noteThing({ x: 15, y: 64, z: 0 });     // within reach of place 1 and the new one
    assert.deepEqual(link, { id: 1, isNew: false, joined: [3] });
    const last = places.noteThing({ x: 45, y: 64, z: 0 });     // and this ties in the farm
    assert.deepEqual(last, { id: 1, isNew: false, joined: [2] });

    assert.equal(places.size, 1);
    const joined = places.get(1);
    assert.deepEqual([joined.min.x, joined.max.x], [0, 60]);
    assert.equal(joined.name, 'the farm', 'the older place had no name, so the name it absorbed is kept');
    assert.equal(places.get(2).id, 1, 'the old id still leads somewhere');
    assert.equal(places.get(3).id, 1);
    assert.equal(places.byName('The Farm').id, 1);

    // When both have names, the older place's name wins.
    const two = createPlaces({ scope: SCOPE, now: clock() });
    two.noteThing({ x: 0, y: 64, z: 0 });
    two.noteThing({ x: 40, y: 64, z: 0 });
    two.name(1, 'home');
    two.name(2, 'shed');
    two.noteThing({ x: 20, y: 64, z: 0 });
    assert.equal(two.get(2).name, 'home');
});

test('P3: a named place keeps its name through save, load and growth', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'places-'));
    const now = clock();
    const places = createPlaces({ scope: SCOPE, now });
    places.noteThing({ x: 0, y: 64, z: 0 });
    places.name(1, 'base', { by: 'Alex' });
    places.remember('lava cave', { x: -120.5, y: 12, z: 300.5 }, { crumb: 77 });
    assert.equal(places.dirty, true);
    places.save(dir);
    assert.equal(places.dirty, false);

    const loaded = loadPlaces(dir, { scope: SCOPE, now });
    assert.equal(loaded.size, 2);
    assert.deepEqual(loaded.get(1), places.get(1));
    assert.equal(loaded.byName('base').namedBy, 'Alex');
    loaded.noteThing({ x: 12, y: 66, z: -9 });                    // the base grows
    assert.equal(loaded.byName('base').max.x, 12);
    assert.equal(loaded.noteThing({ x: 500, y: 64, z: 500 }).id, 3, 'a new place gets a new id after a load');

    const cave = loaded.byName('lava cave');
    assert.equal(cave.kind, 'named');
    assert.deepEqual(cave.spot, { x: -120.5, y: 12, z: 300.5 });
    assert.equal(cave.crumb, 77);
    assert.equal(loadPlaces(mkdtempSync(path.join(tmpdir(), 'places-')), { scope: SCOPE, now }).size, 0);
});

test('naming the spot the bot stands on: inside a place it names the place, elsewhere it makes one', () => {
    const places = createPlaces({ scope: SCOPE, now: clock() });
    places.noteThing({ x: 0, y: 64, z: 0 });
    places.noteThing({ x: 4, y: 64, z: 4 });
    const home = places.remember('home', { x: 2.5, y: 64, z: 2.5 });
    assert.equal(home.id, 1, 'the bot is standing in the place it found');
    assert.equal(home.kind, 'found');
    assert.deepEqual(home.spot, { x: 2.5, y: 64, z: 2.5 });

    const beach = places.remember('beach', { x: 300, y: 63, z: 0 });
    assert.equal(beach.kind, 'named');
    assert.equal(places.size, 2);

    // The same name used again moves: a name is one place.
    places.remember('beach', { x: 600, y: 63, z: 0 });
    assert.equal(places.size, 2, 'the old beach was only a name, so it is gone');
    assert.equal(places.byName('beach').spot.x, 600);
    places.remember('home', { x: 900, y: 70, z: 0 });
    assert.equal(places.get(1).name, null, 'the found place stays, without the name');
    assert.equal(places.byName('home').spot.x, 900);

    // A chest turns up at a named spot: it is a found place now, with the same name and id.
    const named = places.byName('beach').id;
    assert.equal(places.noteThing({ x: 601, y: 63, z: 1 }).id, named);
    assert.equal(places.get(named).kind, 'found');
    assert.equal(places.get(named).name, 'beach');

    // An empty, unnamed found place can be forgotten; a named one can't.
    assert.equal(places.forget(1), true);
    assert.equal(places.forget(named), false);
    assert.equal(places.get(1), null);
});
