// SPDX-License-Identifier: CC0-1.0
// Which world the bot is in decides which memory and which chest book it opens. A world opened to LAN gets a new
// port every session, so a key that includes the address loses everything each time, including chest owners
// players told the bot about, which it can't see again for itself. The key is the world itself (its seed, as the
// server shares it, or the world_id setting) and the dimension, and memory kept under the old key is carried over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scopeOf, isFormerScope } from '../src/agent/fairplay/install.js';
import { adoptFormerScope, scopeDir } from '../src/agent/memory/files.js';
import { openMemory } from '../src/agent/memory/store.js';
import { createChestBook, loadChestBook } from '../src/agent/storage/chest_book.js';

const lan = port => ({ host: 'lan-host', port });
const botIn = (worldIdentity, dimension = 'overworld') => ({ worldIdentity, game: { dimension } });
const chest = (x, y, z) => ({ id: `${x},${y},${z}`, x, y, z, also: null, name: 'chest' });

test('a world with a known seed is the same scope whatever address it is reached at', () => {
    const bot = botIn('2216047223550517800');
    assert.equal(scopeOf(bot, lan(51234)), 'world:2216047223550517800/overworld');
    assert.equal(scopeOf(bot, lan(60111)), scopeOf(bot, lan(51234)), 'a new LAN port is the same world');
    assert.notEqual(scopeOf(botIn('2216047223550517800', 'the_nether'), lan(51234)), scopeOf(bot, lan(51234)),
        'each dimension still has its own memory');
});

test('the world_id setting names the world instead of the seed', () => {
    assert.equal(scopeOf(botIn('2216047223550517800'), { ...lan(51234), world_id: 'home' }), 'world:home/overworld');
});

test('with no seed to go by, the address is all that tells worlds apart', () => {
    assert.equal(scopeOf(botIn(undefined), lan(51234)), 'lan-host:51234/unknown/overworld');
    // Some servers hide the seed by sending zero. Every such server would otherwise share one memory.
    assert.equal(scopeOf(botIn('0'), lan(51234)), 'lan-host:51234/unknown/overworld');
});

test('a scope from before is recognized by its world and dimension, at any address', () => {
    const scope = 'world:2216047223550517800/overworld';
    assert.equal(isFormerScope('lan-host:51234/2216047223550517800/overworld', scope), true);
    assert.equal(isFormerScope('localhost:25565/2216047223550517800/overworld', scope), true);
    assert.equal(isFormerScope('lan-host:51234/2216047223550517800/the_nether', scope), false, 'another dimension');
    assert.equal(isFormerScope('lan-host:51234/999/overworld', scope), false, 'another world');
    assert.equal(isFormerScope('lan-host:51234/unknown/overworld', scope), false);
    assert.equal(isFormerScope(scope, scope), false, 'a scope is not its own former self');
    assert.equal(isFormerScope('lan-host:51234/x/overworld', 'lan-host:51234/unknown/overworld'), false,
        'nothing is carried into an address-only scope');
});

/** Memory and a chest book saved the old way, under an address that included a LAN port. */
function savedUnder(baseDir, oldScope, { place, owner, at }) {
    const memory = openMemory({ baseDir: path.join(baseDir, 'memory'), scope: oldScope });
    memory.places.remember(place, { x: 10, y: 64, z: 10 });
    memory.save();
    const book = createChestBook({ scope: oldScope });
    book.mark(chest(1, 64, 1), { owner });
    const dir = scopeDir(path.join(baseDir, 'storage'), oldScope);
    book.save(dir);
    // Pretend the folders were last written at `at`, so "the newest" is known.
    for (const kind of ['memory', 'storage']) {
        const folder = scopeDir(path.join(baseDir, kind), oldScope);
        for (const name of readdirSync(folder)) utimesSync(path.join(folder, name), at, at);
    }
}

test('memory and the chest book kept under an old address are carried over to the world, and the old copy is kept', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scope-'));
    const scope = 'world:2216047223550517800/overworld';
    savedUnder(base, 'lan-host:51234/2216047223550517800/overworld', { place: 'the old base', owner: 'Alice', at: new Date(2026, 0, 1) });
    savedUnder(base, 'lan-host:60111/2216047223550517800/overworld', { place: 'the new base', owner: 'Bob', at: new Date(2026, 5, 1) });
    savedUnder(base, 'lan-host:60111/999/overworld', { place: 'another world', owner: 'Carol', at: new Date(2026, 9, 1) });

    const notes = [];
    for (const kind of ['memory', 'storage']) {
        const from = adoptFormerScope(path.join(base, kind), scope, { isFormer: old => isFormerScope(old, scope), say: n => notes.push(n) });
        assert.equal(from, 'lan-host:60111/2216047223550517800/overworld', 'the most recently saved copy of this world');
    }
    assert.equal(notes.length, 2, 'each carry-over is said once');

    const memory = openMemory({ baseDir: path.join(base, 'memory'), scope });
    assert.ok(memory.places.byName('the new base'), 'the places came along, and load under the new scope');
    assert.equal(memory.places.byName('another world'), null, 'another world is never mixed in');
    const book = loadChestBook(scopeDir(path.join(base, 'storage'), scope), { scope });
    assert.equal(book.ownerOf(chest(1, 64, 1)), 'Bob', 'whose chest it is came along');

    assert.ok(existsSync(scopeDir(path.join(base, 'memory'), 'lan-host:60111/2216047223550517800/overworld')),
        'the old folder is left as it was');
});

test('once the world has its own folder, nothing more is carried over', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scope-'));
    const base = path.join(root, 'memory');
    const scope = 'world:2216047223550517800/overworld';
    const fresh = openMemory({ baseDir: base, scope });
    fresh.places.remember('made here', { x: 0, y: 64, z: 0 });
    fresh.save();
    savedUnder(root, 'lan-host:51234/2216047223550517800/overworld', { place: 'older', owner: 'Alice', at: new Date() });
    assert.equal(adoptFormerScope(base, scope, { isFormer: old => isFormerScope(old, scope) }), null);
    const memory = openMemory({ baseDir: base, scope });
    assert.ok(memory.places.byName('made here'));
    assert.equal(memory.places.byName('older'), null);
});

test('with nothing to carry over, no folder is made', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scope-'));
    const scope = 'world:1/overworld';
    assert.equal(adoptFormerScope(base, scope, { isFormer: old => isFormerScope(old, scope) }), null);
    assert.equal(adoptFormerScope(path.join(base, 'missing'), scope, { isFormer: () => true }), null, 'no base folder yet');
    assert.deepEqual(readdirSync(base), []);
});
