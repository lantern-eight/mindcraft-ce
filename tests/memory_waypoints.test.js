// SPDX-License-Identifier: CC0-1.0
// Waypoints a player shares in chat become told places without a model call, in the dimension they are for;
// and a told place a player takes back is forgotten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openMemory } from '../src/agent/memory/store.js';
import { loadPlaces } from '../src/agent/memory/places.js';
import { scopeDir } from '../src/agent/memory/files.js';
import { dimensionOf, parseWaypoint, waypointListener } from '../src/agent/memory/waypoints.js';
import { forgetPlace, tellPlace, tellWaypoint } from '../src/agent/memory/commands.js';

const SCOPE = 'world:seed1/overworld';
const HERE = { x: 0.5, y: 64, z: 0.5 };
const fresh = () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'waypoints-'));
    return { baseDir, memory: openMemory({ baseDir, scope: SCOPE }) };
};

test('Xaero\'s and JourneyMap\'s shared lines are read, with their dimension', () => {
    assert.deepEqual(parseWaypoint('xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints'),
        { name: 'Base', spot: { x: 268, y: 64, z: -160 }, dimension: 'overworld', format: 'Xaero' });
    assert.deepEqual(parseWaypoint(' xaero-waypoint:Fort:F:40:~:-90:4:false:0:Internal-the-nether-waypoints '),
        { name: 'Fort', spot: { x: 40, y: null, z: -90 }, dimension: 'the_nether', format: 'Xaero' });
    assert.equal(parseWaypoint('xaero-waypoint:Gate:G:1:2:3:0:false:0').dimension, null, 'no set: the dimension is not said');
    assert.deepEqual(parseWaypoint('[name:"Mine", x:40, y:12, z:-800, dim:minecraft:overworld]'),
        { name: 'Mine', spot: { x: 40, y: 12, z: -800 }, dimension: 'overworld', format: 'JourneyMap' });
    assert.deepEqual(parseWaypoint('[x:5, z:6, name:"Farm"]').spot, { x: 5, y: null, z: 6 });
});

test('anything more than a waypoint, or a broken one, is left to the model', () => {
    for (const text of ['meet me here xaero-waypoint:Base:B:268:64:-160:6:false:0', 'xaero-waypoint:Base:B:268:sixty:-160',
        '[name:"Mine", x:40]', 'the base is at 268 64 -160', '', null])
        assert.equal(parseWaypoint(text), null, String(text));
});

test('the dimension is told from what each mod calls it', () => {
    assert.equal(dimensionOf('minecraft:the_end'), 'the_end');
    assert.equal(dimensionOf('Internal-dim%-1-waypoints'), 'the_nether');
    assert.equal(dimensionOf('Internal-dim%1-waypoints'), 'the_end');
    assert.equal(dimensionOf('Internal-dim%0-waypoints'), 'overworld');
    assert.equal(dimensionOf('somewhere'), null);
});

test('a waypoint here becomes a told place, answered in chat and noted for the model', () => {
    const { memory, baseDir } = fresh();
    const waypoint = parseWaypoint('xaero-waypoint:Base:B:268:64:-160:6:false:0:Internal-overworld-waypoints');
    const reply = tellWaypoint({ memory, here: HERE, scope: SCOPE, baseDir, player: 'Steve', waypoint });
    assert.equal(reply, 'Got it, Steve: "Base" at 268, 64, -160. I haven\'t seen it yet.');
    const place = memory.places.byName('Base');
    assert.equal(place.kind, 'told');
    assert.equal(place.told.by, 'Steve');
    const notes = memory.changes.fresh().map(note => note.text);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^Steve shared a Xaero waypoint\. Saved "Base", as Steve told you/);
});

test('a name the bot gave something it saw keeps it', () => {
    const { memory, baseDir } = fresh();
    memory.places.remember('Base', { x: 10, y: 64, z: 10 });
    const waypoint = parseWaypoint('[name:"Base", x:268, y:64, z:-160]');
    assert.match(tellWaypoint({ memory, here: HERE, scope: SCOPE, baseDir, player: 'Steve', waypoint }), /already have a place called "Base"/);
    assert.notEqual(memory.places.byName('Base').kind, 'told');
});

test('a waypoint in another dimension is saved with that dimension\'s places', () => {
    const { memory, baseDir } = fresh();
    const waypoint = parseWaypoint('xaero-waypoint:Fort:F:40:70:-90:4:false:0:Internal-the-nether-waypoints');
    const reply = tellWaypoint({ memory, here: HERE, scope: SCOPE, baseDir, player: 'Steve', waypoint });
    assert.equal(reply, 'Got it, Steve: "Fort" at 40, 70, -90 in the Nether.');
    assert.equal(memory.places.byName('Fort'), null, 'not among the Overworld\'s places');
    const nether = 'world:seed1/the_nether';
    const there = loadPlaces(scopeDir(baseDir, nether), { scope: nether }).byName('Fort');
    assert.equal(there.kind, 'told');
    assert.deepEqual(there.spot, { x: 40, y: 70, z: -90 });
});

test('with world memory off the message goes to the model', () => {
    const waypoint = parseWaypoint('[name:"Base", x:1, y:2, z:3]');
    assert.equal(tellWaypoint({ memory: null, here: HERE, scope: SCOPE, baseDir: '/nowhere', player: 'Steve', waypoint }), null);
});

test('only a player\'s waypoint is taken out of what the agent answers', async () => {
    const seen = [];
    const agent = { name: 'Bot', handleMessage: async (source, message) => { seen.push([source, message]); return 'model'; } };
    const told = [];
    waypointListener(agent, (player, waypoint) => { told.push([player, waypoint.name]); return true; });
    await agent.handleMessage('Steve', '[name:"Base", x:1, y:2, z:3]');
    await agent.handleMessage('Steve', 'hello');
    await agent.handleMessage('system', '[name:"Base", x:1, y:2, z:3]');
    assert.deepEqual(told, [['Steve', 'Base']]);
    assert.deepEqual(seen.map(([source]) => source), ['Steve', 'system']);
});

test('a told place can be taken back; a seen one stays', () => {
    const { memory } = fresh();
    tellPlace(memory, HERE, 'Village', '300 -120', { asked: true, by: 'Steve' });
    memory.places.remember('Home', { x: 1, y: 64, z: 1 });
    assert.equal(forgetPlace(memory, 'village'), 'Forgot "Village", which Steve told you of.');
    assert.equal(memory.places.byName('Village'), null);
    assert.match(forgetPlace(memory, 'Home'), /seen yourself, so it stays/);
    assert.ok(memory.places.byName('Home'));
    assert.match(forgetPlace(memory, 'Nowhere'), /don't know a place called "Nowhere"/);
});
