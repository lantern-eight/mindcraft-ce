// SPDX-License-Identifier: CC0-1.0
// Changes: which differences between memory and sight are worth telling the model about, and how they
// are gathered into one short note. The recorder's own tests cover the same cases end to end in a world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChanges } from '../src/agent/memory/changes.js';


function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** Reports a wall of differences, one per cell, and lets the group settle. */
function wall(changes, now, cells, diff) {
    const seen = cells.map(([x, y, z]) => changes.see({ x, y, z, lookedBefore: true, ...diff }));
    now.advance(2000);
    return { seen, notes: changes.settle() };
}

const row = (n, y = 64, z = 0) => [...Array(n)].map((_, x) => [x, y, z]);

test('A1: a remembered wall of planks replaced by glass is one note, from whichever side it is seen', () => {
    const now = clock();
    const changes = createChanges({ now });
    // sameViewpoint is false: the bot is looking from a different side than before. It still counts,
    // because the cells themselves are remembered.
    const { seen, notes } = wall(changes, now, row(12), { before: 'oak_planks', after: 'glass', sameViewpoint: false });
    assert.equal(seen.every(what => what === 'replaced'), true);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, 'Noticed near 0, 64, 0: Gone: oak_planks 12. New: glass 12.');
    assert.deepEqual(notes[0].gone, { oak_planks: 12 });
    assert.deepEqual(notes[0].added, { glass: 12 });
});

test('A2: looking again with nothing changed makes no note', () => {
    const now = clock();
    const changes = createChanges({ now });
    const { seen, notes } = wall(changes, now, row(12), { before: 'oak_planks', after: 'oak_planks' });
    assert.equal(seen.every(what => what === null), true);
    assert.equal(notes.length, 0);
    assert.equal(changes.pending, 0);
});

test('A3: a hut built where the bot had already looked from this very spot is a note naming planks', () => {
    const now = clock();
    const changes = createChanges({ now });
    const hut = [...row(10, 64, 5), ...row(10, 65, 5), ...row(4, 66, 5)];
    const { notes } = wall(changes, now, hut, { before: null, after: 'oak_planks', sameViewpoint: true });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, 'Noticed near 0, 64, 5: New: oak_planks 24.');
});

test('A4: the same hut seen first from somewhere new is recorded but not reported', () => {
    const now = clock();
    const changes = createChanges({ now });
    const { seen, notes } = wall(changes, now, row(24), { before: null, after: 'oak_planks', sameViewpoint: false });
    assert.equal(seen.every(what => what === null), true, 'nothing was remembered there: it is newly seen, not changed');
    assert.equal(notes.length, 0);
});

test('A5: crops, leaves, flowing water and the bot\'s own digging make no note', () => {
    const now = clock();
    const changes = createChanges({ now });
    const quiet = [
        { before: 'oak_leaves', after: 'air' },                       // leaves decayed
        { before: 'dirt', after: 'grass_block' },                     // grass spread
        { before: 'air', after: 'water' },                            // water flowed in
        { before: 'sand', after: 'air' },                             // sand fell
        { before: null, after: 'wheat', sameViewpoint: true },        // a crop grew where there was none
        { before: 'stone', after: 'air', mine: true },                // the bot dug it
        { before: null, after: 'cobblestone', sameViewpoint: true, mine: true }, // the bot placed it
        { before: 'stone', after: 'air', watched: true },             // it changed while the bot watched
    ];
    for (const diff of quiet) {
        const { seen, notes } = wall(changes, now, row(10), diff);
        assert.equal(seen.every(what => what === null), true, JSON.stringify(diff));
        assert.equal(notes.length, 0);
    }
    // Something built on grass does count: the planks are what changed.
    const built = wall(changes, now, row(10), { before: 'grass_block', after: 'oak_planks' });
    assert.equal(built.notes[0].text, 'Noticed near 0, 64, 0: New: oak_planks 10.');
    // And stone turning into water does too: the stone is gone.
    const flooded = wall(changes, now, row(10), { before: 'stone', after: 'water' });
    assert.equal(flooded.notes[0].text, 'Noticed near 0, 64, 0: Gone: stone 10.');
});

test('A6: a chest gone from a known place is a note, whatever the viewpoint and however small', () => {
    const now = clock();
    const changes = createChanges({ now, placeName: id => (id === 1 ? 'the base' : null) });
    changes.see({ x: 5, y: 64, z: 5, before: 'chest', after: 'air', place: 1, lookedBefore: true });
    changes.see({ x: 6, y: 64, z: 5, before: 'chest', after: 'air', place: 1, lookedBefore: true });
    for (const [x, y, z] of row(42, 66, 9)) changes.see({ x, y, z, before: 'air', after: 'oak_planks', place: 1, lookedBefore: true });
    for (const [x, y, z] of row(6, 67, 9)) changes.see({ x, y, z, before: 'air', after: 'glass', place: 1, lookedBefore: true });
    assert.equal(changes.settle().length, 0, 'not yet: the differences are still coming in');
    now.advance(2000);
    const [note] = changes.settle();
    assert.equal(note.text, 'Noticed at the base: Gone: chest 2. New: oak_planks 42, glass 6.');
    assert.equal(note.place, 1);

    // One chest alone is still worth a note: it is a thing.
    changes.see({ x: 300, y: 64, z: 0, before: 'chest', after: 'air', place: 2, lookedBefore: true });
    now.advance(2000);
    assert.equal(changes.settle()[0].text, 'Noticed at a site near 300, 64, 0: Gone: chest 1.');
    // Three stray blocks are not.
    wall(changes, now, row(3), { before: 'stone', after: 'air' });
    assert.equal(changes.recent().length, 2);
});

test('a thing never recorded, in a place the bot had looked over before, is noted as first seen', () => {
    const now = clock();
    const changes = createChanges({ now, placeName: () => 'the base' });
    const first = { x: 1, y: 64, z: 1, before: null, after: 'barrel', place: 1 };
    assert.equal(changes.see({ ...first, lookedBefore: true }), 'first seen');
    now.advance(2000);
    assert.equal(changes.settle()[0].text, 'Noticed at the base: First seen: barrel 1.');
    // On the first look round a base nothing had been looked over before, so nothing is "first seen".
    assert.equal(changes.see({ ...first, lookedBefore: false }), null);
    // Outside any place it follows the ordinary rule.
    assert.equal(changes.see({ ...first, place: null, lookedBefore: true }), null);
    assert.equal(changes.see({ ...first, place: null, lookedBefore: true, sameViewpoint: true }), 'appeared');
});

test('differences far apart are separate notes; neighbouring cubes share one', () => {
    const now = clock();
    const changes = createChanges({ now });
    for (const [x, y, z] of row(10, 64, 0)) changes.see({ x: x + 10, y, z, before: 'stone', after: 'air', lookedBefore: true }); // crosses x = 16
    for (const [x, y, z] of row(10, 64, 0)) changes.see({ x: x + 500, y, z, before: 'stone', after: 'air', lookedBefore: true });
    assert.equal(changes.pending, 2);
    now.advance(2000);
    const notes = changes.settle();
    assert.deepEqual(notes.map(note => note.text), ['Noticed near 10, 64, 0: Gone: stone 10.', 'Noticed near 500, 64, 0: Gone: stone 10.']);
});

test('a note is handed out once, and kept in a short log', () => {
    const now = clock();
    const changes = createChanges({ now, keep: 3 });
    for (let i = 0; i < 5; i++) {
        changes.see({ x: i * 200, y: 64, z: 0, before: 'chest', after: 'air', lookedBefore: true });
        now.advance(2000);
        changes.settle();
    }
    const fresh = changes.fresh();
    assert.equal(fresh.length, 3, 'only the last three are kept');
    assert.equal(fresh[0].where.x, 400, 'oldest first');
    assert.equal(changes.fresh().length, 0, 'each is shown once');
    assert.equal(changes.recent(2)[0].where.x, 800, 'the log gives the newest first');
    assert.equal(changes.dirty, true);

    const restored = createChanges({ now });
    restored._restore(JSON.parse(JSON.stringify(changes.toJSON())));
    assert.equal(restored.recent().length, 3);
    assert.equal(restored.fresh().length, 0, 'what was shown stays shown');
});
