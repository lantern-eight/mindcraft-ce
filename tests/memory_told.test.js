// SPDX-License-Identifier: CC0-1.0
// Told places: where a player said something is, kept apart from what the bot saw until it sees the spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { initModes } from '../src/agent/modes.js';
import { getCommand } from '../src/agent/commands/index.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { installFairPlay } from '../src/agent/fairplay/install.js';
import { MemoryBank } from '../src/agent/memory_bank.js';
import { createPlaces, loadPlaces } from '../src/agent/memory/places.js';
import { openMemory } from '../src/agent/memory/store.js';
import { placeBank } from '../src/agent/memory/install.js';
import { checkTold, parseWhere, seenSpot } from '../src/agent/memory/told.js';
import { goToPlace, placesText, recallText, tellPlace, withNotes } from '../src/agent/memory/commands.js';

const SCOPE = 'local:55916/w1/overworld';
const HERE = { x: 0.5, y: 64, z: 0.5 };

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

const fresh = () => {
    const now = clock();
    return { memory: openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'told-')), scope: SCOPE, now }), now };
};

test('parseWhere reads a position the ways a player says it, with the height left out or not', () => {
    assert.deepEqual(parseWhere('300 64 -120'), { x: 300, y: 64, z: -120 });
    assert.deepEqual(parseWhere('300, -120'), { x: 300, y: null, z: -120 });
    assert.deepEqual(parseWhere('(300, ~, -120)'), { x: 300, y: null, z: -120 });
    assert.deepEqual(parseWhere('x=300 z=-120'), { x: 300, y: null, z: -120 });
    assert.deepEqual(parseWhere('z: -120, x: 300, y: 70'), { x: 300, y: 70, z: -120 });
    assert.deepEqual(parseWhere('12.5 -3 40'), { x: 12.5, y: -3, z: 40 });
    for (const bad of ['', 'by the lake', '300', '1 2 3 4', '~ 64 -120', '300 9000 -120', '40000000 64 0']) {
        assert.equal(parseWhere(bad), null, bad);
    }
});

test('a told place is kept apart: nothing seen joins it, is filed under it, or loses its name to it', () => {
    const now = clock();
    const places = createPlaces({ scope: SCOPE, now });
    const { place, taken } = places.tell('village', { x: 300, y: null, z: -120 }, { by: 'Steve' });
    assert.equal(taken, null);
    assert.equal(place.kind, 'told');
    assert.deepEqual(place.spot, { x: 300, y: null, z: -120 });
    assert.deepEqual(place.told, { by: 'Steve', at: now() });

    // A chest seen right at the told spot starts a site of its own; the told place stays as it was.
    const site = places.noteThing({ x: 300, y: 70, z: -120 });
    assert.notEqual(site.id, place.id);
    assert.equal(places.byName('village').kind, 'told');
    assert.equal(places.at({ x: 300, y: 70, z: -120 }).id, site.id, 'what is seen there is filed under the site, not the hearsay');
    assert.deepEqual(places.toldNear({ x: 290, y: 0, z: -120 }).map(p => [p.name, p.distance]), [['village', 10]], 'measured across the ground');

    // Told again, it moves.
    now.advance(1000);
    assert.equal(places.tell('Village', { x: 310, y: 65, z: -100 }, { by: 'Alex' }).place.id, place.id);
    assert.deepEqual(places.byName('village').spot, { x: 310, y: 65, z: -100 });
    assert.equal(places.byName('village').told.by, 'Alex');

    // A name the bot gave something it saw is not taken over by what it was told.
    places.name(site.id, 'farm');
    const refused = places.tell('farm', { x: 0, y: null, z: 0 });
    assert.equal(refused.place, null);
    assert.equal(refused.taken.id, site.id);
    assert.equal(places.byName('farm').kind, 'found');

    // Naming a spot the bot stands on takes the name from a told place, which was only ever the name.
    places.remember('village', { x: 5, y: 64, z: 5 });
    assert.equal(places.byName('village').kind, 'named');
    assert.equal(places.toldNear({ x: 0, y: 0, z: 0 }).length, 0);
});

test('seen, a told place becomes a place like any other: on its own, joined to a site found there, or beside a named one', () => {
    const places = createPlaces({ scope: SCOPE, now: clock() });
    const alone = places.tell('tower', { x: 100, y: null, z: 0 }).place;
    const result = places.confirmTold(alone.id, { x: 100, y: 71, z: 0 });
    assert.equal(result.place.kind, 'named');
    assert.deepEqual(result.place.spot, { x: 100, y: 71, z: 0 });
    assert.deepEqual([result.joined, result.beside], [null, null]);
    assert.ok(result.place.told.seenAt);
    assert.equal(places.confirmTold(alone.id, { x: 100, y: 71, z: 0 }), null, 'only a told place can be confirmed');

    const site = places.noteThing({ x: 200, y: 64, z: 0 });
    const village = places.tell('village', { x: 210, y: 64, z: 5 }, { by: 'Steve' }).place;
    const joined = places.confirmTold(village.id, { x: 210, y: 64, z: 5 });
    assert.equal(joined.joined, site.id);
    assert.equal(places.get(site.id).name, 'village');
    assert.equal(places.get(site.id).told.by, 'Steve');
    assert.equal(places.get(village.id).id, site.id, 'the told id still leads to the place');

    places.noteThing({ x: 400, y: 64, z: 0 });
    places.name(places.at({ x: 400, y: 64, z: 0 }).id, 'home');
    const shed = places.tell('shed', { x: 405, y: 64, z: 0 }).place;
    const beside = places.confirmTold(shed.id, { x: 405, y: 64, z: 0 });
    assert.equal(beside.beside, 'home');
    assert.equal(places.byName('home').name, 'home', 'a site with a name keeps it');
    assert.equal(places.byName('shed').kind, 'named');
});

test('told places are saved and loaded with what was said', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'told-save-'));
    const places = createPlaces({ scope: SCOPE, now: clock() });
    places.tell('village', { x: 300, y: null, z: -120 }, { by: 'Steve' });
    places.save(dir);
    const back = loadPlaces(dir, { scope: SCOPE });
    assert.equal(back.byName('village').kind, 'told');
    assert.deepEqual(back.byName('village').spot, { x: 300, y: null, z: -120 });
    assert.equal(back.byName('village').told.by, 'Steve');
});

test('seenSpot asks memory whether the bot has seen the spot, and finds the ground when no height was said', () => {
    const { memory } = fresh();
    assert.equal(seenSpot(memory.cells, { x: 10, y: 64, z: 10 }), null);
    memory.cells.write(11, 63, 9, 'grass_block');
    assert.deepEqual(seenSpot(memory.cells, { x: 10, y: 64, z: 10 }), { x: 10, y: 64, z: 10 }, 'a cell within two blocks was seen');
    assert.equal(seenSpot(memory.cells, { x: 10, y: 60, z: 10 }), null, 'not one four below');
    assert.deepEqual(seenSpot(memory.cells, { x: 11, y: null, z: 9 }), { x: 11, y: 64, z: 9 }, 'stood on top of the ground');
    memory.cells.write(11, 70, 9, 'oak_leaves');
    assert.deepEqual(seenSpot(memory.cells, { x: 11, y: null, z: 9 }), { x: 11, y: 71, z: 9 }, 'the highest thing seen there, as from above');
});

test('checkTold confirms only what the bot has seen, near enough, and says so once', () => {
    const { memory } = fresh();
    memory.places.tell('village', { x: 20, y: null, z: 0 }, { by: 'Steve' });
    memory.places.tell('mine', { x: 0, y: 12, z: 0 });
    memory.cells.write(20, 63, 0, 'grass_block');                 // seen, but 20 blocks off across the ground
    assert.deepEqual(checkTold(memory, HERE), []);
    assert.equal(memory.places.byName('village').kind, 'told');

    const seen = checkTold(memory, { x: 8, y: 64, z: 0 });
    assert.deepEqual(seen.map(s => s.place.name), ['village']);
    assert.deepEqual(memory.places.byName('village').spot, { x: 20, y: 64, z: 0 });
    assert.equal(memory.places.byName('mine').kind, 'told', 'the mine 52 blocks down was not seen');
    assert.deepEqual(memory.changes.fresh().map(n => n.text), ['Seen "village", which Steve told you of, at 20, 64, 0.']);
    assert.deepEqual(memory.changes.fresh(), [], 'once');
    assert.deepEqual(checkTold(memory, { x: 8, y: 64, z: 0 }), [], 'and not again');
});

test('!rememberToldPlace: only a player can tell, the position must be readable, and a spot seen before is confirmed at once', () => {
    const { memory, now } = fresh();
    assert.match(tellPlace(memory, HERE, 'village', '300 -120', { asked: false, by: null }), /^Only a player can tell you where a place is/);
    assert.equal(memory.places.byName('village'), null);
    assert.match(tellPlace(memory, HERE, 'village', 'by the big lake', { asked: true, by: 'Steve' }), /^Could not read "by the big lake" as a position/);
    assert.equal(tellPlace(memory, HERE, '  ', '1 2'), 'Give the place a name.');

    assert.equal(tellPlace(memory, HERE, 'village', '300 -120', { asked: true, by: 'Steve' }),
        'Saved "village", as Steve told you: 300, ?, -120, 323 blocks east. '
        + 'You haven\'t seen it; it will count as seen once you have. !goToPlace("village") goes there.');

    // The bot has looked at a hut before; now someone says what it is.
    for (const [x, z] of [[40, 0], [41, 0]]) memory.cells.write(x, 64, z, 'oak_planks');
    const { thing } = memory.things.see({ x: 40, y: 65, z: 1 }, 'chest');
    memory.places.noteThing(thing);
    memory.cells.write(40, 65, 1, 'chest');
    assert.equal(tellPlace(memory, HERE, 'hut', '40 66 1', {}),
        'Seen "hut", which you were told of, at 40, 66, 1. It is the site where you saw chest 1. You had seen that spot already.');
    assert.equal(memory.places.byName('hut').kind, 'found');

    assert.match(tellPlace(memory, HERE, 'hut', '0 0'), /^You already have a place called "hut" that you have seen yourself/);

    now.advance(2 * 3600_000);
    assert.match(placesText(memory, HERE, { now }), /- "hut" \(told, since seen\) near 40, 65, 1: chest 1 \(40 blocks east\)/);
    assert.match(placesText(memory, HERE, { now }), /- "village" \(told by Steve 2 hours ago, not seen yet\) at 300, \?, -120: 323 blocks east/);
    assert.equal(recallText(memory, HERE, 'village', { now }),
        'PLACE\n- "village" (told by Steve 2 hours ago, not seen yet) at 300, ?, -120: 323 blocks east');
});

test('!goToPlace walks to a told place, with no height when none was said, and says whether it has seen it', async () => {
    const { memory } = fresh();
    memory.places.tell('village', { x: 20, y: null, z: 0 }, { by: 'Steve' });
    memory.places.tell('cave', { x: -20, y: 30, z: 0 });
    const bot = { entity: { position: { ...HERE } } };
    const agent = { bot, fairPlay: { memory } };
    const trips = [];
    const goTo = (_, spot) => { trips.push(spot); bot.entity.position = { x: spot.x, y: spot.y ?? 64, z: spot.z }; return true; };

    assert.match(await goToPlace(agent, 'nowhere', { goTo }), /^You don't know a place called "nowhere"/);
    // Arriving, the look-around takes in the ground there.
    const settle = () => { memory.cells.write(20, 63, 0, 'grass_block'); checkTold(memory, bot.entity.position); };
    assert.equal(await goToPlace(agent, 'village', { goTo, settle }), 'You are at "village".');
    assert.deepEqual(trips[0], { x: 20, y: null, z: 0 });
    assert.match(withNotes({ text: 'You are at "village".' }, memory).text, /\nSeen "village", which Steve told you of, at 20, 64, 0\.$/);

    assert.match(await goToPlace(agent, 'cave', { goTo }), /^You are where you were told "cave" is, but you haven't seen the spot itself yet/);
    assert.equal(await goToPlace(agent, 'cave', { goTo: () => false }), 'Could not reach "cave".');
});

test('the saved-places stand-in gives a told spot only when it has a height', () => {
    const { memory } = fresh();
    const bank = placeBank(() => memory, new MemoryBank());
    memory.places.tell('village', { x: 300, y: null, z: -120 });
    memory.places.tell('mine', { x: 5, y: 12, z: 5 });
    assert.equal(bank.recallPlace('village'), undefined);
    assert.deepEqual(bank.recallPlace('mine'), [5, 12, 5]);
    assert.match(bank.getKeys(), /village/);
});

test('installed, the commands know who told, refuse the bot\'s own idea, and a look-around confirms a told spot', async () => {
    const w = fixtureWorld({ min: [-16, -4, -16], max: [16, 16, 16] });
    w.fill('stone', [-16, 0, -16], [16, 0, 16]);
    w.set('chest', 3, 1, 3);
    const bot = stubBot(w);
    bot._client = new EventEmitter();
    bot.game = { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 };
    bot.worldIdentity = 'w-told';
    bot.chat = () => {};
    bot.entity.onGround = true;
    const tell = (name, where) => getCommand('!rememberToldPlace').perform(agent, name, where);
    const answers = [];
    const agent = {
        name: 'Fairy', bot, task: null, openChat: () => {}, memory_bank: new MemoryBank(),
        prompter: { profile: {}, getInitModes: () => ({}) },
        actions: { runAction: () => Promise.resolve({ success: true, text: 'done', message: 'done' }) },
        // What the agent does with a message: here, the model turns it straight into the command.
        handleMessage: (source, message) => { answers.push(tell(...JSON.parse(message))); },
    };
    initModes(agent);
    const config = { fair_play: 'custom', fair_play_custom: { fov_degrees: 360 }, world_memory: true, host: 'localhost', port: 1 };
    const handle = installFairPlay(agent, { config, memoryDir: mkdtempSync(path.join(tmpdir(), 'told-install-')), perceptionOptions: { ...NO_BUDGETS } });
    try {
        assert.ok(getCommand('!goToPlace'), 'the walk is registered too');
        await agent.handleMessage('system', JSON.stringify(['camp', '50 50']));
        assert.match(answers[0], /^Only a player can tell you/);
        await agent.handleMessage('Steve', JSON.stringify(['camp', '3 3']));
        assert.match(answers[1], /^Saved "camp", as Steve told you: 3, \?, 3/);

        handle.recorder.tick({ budgetMs: Infinity });
        const camp = handle.memory.places.byName('camp');
        assert.equal(camp.kind, 'found', 'seen, it named the site the chest started');
        assert.equal(camp.told.by, 'Steve');
        assert.deepEqual(handle.memory.changes.fresh().map(n => n.text), ['Seen "camp", which Steve told you of, at 3, 2, 3. It is the site where you saw chest 1.']);
    } finally {
        bot.emit('end');
        setWorldQueries(null);
    }
});
