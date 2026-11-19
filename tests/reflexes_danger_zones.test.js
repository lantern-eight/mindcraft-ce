// SPDX-License-Identifier: CC0-1.0
// Danger zones: the store (danger_zones.js) with a clock and plain positions, and the danger watch
// (danger_watch.js) on a stand-in bot: what it notes from sight, hearing and the mob reflex's decisions,
// and what it never notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { createDangerZones, ZONE_KINDS } from '../src/agent/reflexes/danger_zones.js';
import { createDangerWatch } from '../src/agent/reflexes/danger_watch.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { GAME_VERSION } from './helpers/game_version.js';

const registry = minecraftData(GAME_VERSION);
const MOB_FLAGS = registry.entitiesByName.skeleton.metadataKeys.indexOf('mob_flags');

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

// ---- The store ----

test('a zone costs most at its middle, nothing at its edge or past its height', () => {
    const zones = createDangerZones({ now: clock() });
    const { zone, isNew } = zones.note('archer', { x: 0.5, y: 64, z: 0.5 });
    assert.equal(isNew, true);
    const { radius, height, price } = ZONE_KINDS.archer;
    assert.equal(zone.radius, radius);
    assert.equal(zones.priceAt(0, 64, 0), price);
    assert.ok(Math.abs(zones.priceAt(radius / 2, 64, 0) - price / 2) < 1e-9, 'half way out, half the price');
    assert.equal(zones.priceAt(radius, 64, 0), 0, 'nothing at the edge');
    assert.equal(zones.priceAt(0, 64 + height + 1, 0), 0, 'nothing above it');
    assert.equal(zones.priceAt(0, 64 - height, 0), price, 'down to its height below');
});

test('the same danger again keeps a zone longer instead of adding one', () => {
    const now = clock();
    const zones = createDangerZones({ now });
    zones.note('illagers', { x: 0, y: 64, z: 0 });
    now.advance(10 * 60_000);
    const again = zones.note('illagers', { x: 10, y: 64, z: 5 });
    assert.equal(again.isNew, false);
    assert.equal(zones.list().length, 1);
    now.advance(ZONE_KINDS.illagers.lifeMs - 1);
    assert.equal(zones.list().length, 1, 'renewed: still remembered');
    now.advance(1);
    assert.equal(zones.list().length, 0, 'forgotten at last');
    assert.equal(zones.priceAt(0, 64, 0), 0);
});

test('other kinds and far places are zones of their own, and their prices add up', () => {
    const zones = createDangerZones({ now: clock() });
    zones.note('archer', { x: 0.5, y: 64, z: 0.5 });
    zones.note('explosion', { x: 0.5, y: 64, z: 0.5 });
    zones.note('archer', { x: 100.5, y: 64, z: 0.5 });
    assert.equal(zones.list().length, 3);
    assert.equal(zones.priceAt(0, 64, 0), ZONE_KINDS.archer.price + ZONE_KINDS.explosion.price);
});

test('a place known only roughly makes a wider zone', () => {
    const zones = createDangerZones({ now: clock() });
    const { zone } = zones.note('explosion', { x: 0, y: 64, z: 0 }, { slack: 5 });
    assert.equal(zone.radius, ZONE_KINDS.explosion.radius + 5);
    assert.ok(zones.priceAt(ZONE_KINDS.explosion.radius + 2, 64, 0) > 0);
});

test('past the most it keeps, the zone nearest its end goes; nonsense is not noted', () => {
    const now = clock();
    const zones = createDangerZones({ now, max: 2 });
    zones.note('explosion', { x: 0, y: 64, z: 0 });
    now.advance(1000);
    zones.note('illagers', { x: 500, y: 64, z: 0 });
    zones.note('archer', { x: 900, y: 64, z: 0 });
    assert.deepEqual(zones.list().map(z => z.kind), ['illagers', 'archer']);
    assert.equal(zones.note('dragon', { x: 0, y: 0, z: 0 }), null);
    assert.equal(zones.note('archer', { x: NaN, y: 0, z: 0 }), null);
    zones.clear();
    assert.equal(zones.list().length, 0);
});

// ---- The watch ----

// A bot with mobs around it; world.js hands them out through the raw provider.
function makeAgent(entities = [], { gameMode = 'survival', dimension = 'overworld' } = {}) {
    const listeners = {};
    const bot = {
        registry, game: { gameMode, dimension },
        entity: { position: new Vec3(0.5, 64, 0.5), id: 0, eyeHeight: 1.62 },
        entities: Object.fromEntries(entities.map(e => [e.id, e])),
        modes: { behavior_log: '' },
        on(name, fn) { (listeners[name] ??= []).push(fn); },
        emit(name, ...args) { for (const fn of listeners[name] ?? []) fn(...args); },
    };
    return { bot, shut_up: true };
}

function mob(id, name, x, z, { aiming = false } = {}) {
    const metadata = [];
    if (aiming) metadata[MOB_FLAGS] = 0x04; // the "aggressive" flag: a bow drawn
    return { id, name, type: 'hostile', position: new Vec3(x, 64, z), metadata, height: 1.99,
        yaw: 0, pitch: 0, heldItem: { name: 'bow' }, equipment: [{ name: 'bow' }] };
}

test('illagers in view make one zone, and the behavior log says so once', () => {
    setWorldQueries(null);
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    const agent = makeAgent([mob(1, 'pillager', 30, 0), mob(2, 'vindicator', 34, 3), mob(3, 'zombie', 5, 0)]);
    watch.look(agent);
    watch.look(agent);
    const kept = zones.list();
    assert.deepEqual(kept.map(z => z.kind), ['illagers']);
    assert.equal(kept[0].x, 30);
    assert.equal(agent.bot.modes.behavior_log.match(/keeping away/g)?.length, 1);
    assert.match(agent.bot.modes.behavior_log, /Saw a pillager \(east/);
});

test('a stand-in where a mob was last seen is not a sighting', () => {
    setWorldQueries(null);
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    const ghost = { ...mob(1, 'pillager', 30, 0), lastSeenAt: 5 };
    watch.look(makeAgent([ghost]));
    assert.equal(zones.list().length, 0);
});

test('a skeleton aiming at the bot makes a zone where it stands; one not aiming does not', () => {
    setWorldQueries(null);
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    watch.look(makeAgent([mob(1, 'skeleton', 10, 0)]));
    assert.equal(zones.list().length, 0);
    watch.look(makeAgent([mob(1, 'skeleton', 10, 0, { aiming: true })]));
    assert.deepEqual(zones.list().map(z => [z.kind, z.x]), [['archer', 10]]);
});

test('an explosion heard is placed from its direction and band only, and widened by how rough that is', () => {
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    watch.hear(makeAgent(), { subject: 'explosion', direction: 'east', distance: 'near', text: 'east, near' });
    watch.hear(makeAgent(), { subject: 'zombie', direction: 'east', distance: 'near', text: 'east, near' });
    const [zone, ...rest] = zones.list();
    assert.equal(rest.length, 0, 'only explosions');
    assert.equal(zone.kind, 'explosion');
    assert.equal(zone.x, 15.5, "the middle of the 'near' band, east of the bot");
    assert.ok(zone.radius > ZONE_KINDS.explosion.radius);
});

test('the mob reflex getting away from unseen hits makes a zone where the bot stands', () => {
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    const agent = makeAgent();
    watch.watch(agent);
    agent.bot.emit('threat_reflex', { event: 'decided', reason: 'outnumbered', mode: 'mob_safety' });
    agent.bot.emit('threat_reflex', { event: 'done', reason: 'unseen hits', mode: 'mob_safety' });
    assert.equal(zones.list().length, 0);
    agent.bot.emit('threat_reflex', { event: 'decided', reason: 'unseen hits', mode: 'mob_safety' });
    assert.deepEqual(zones.list().map(z => [z.kind, z.x, z.z]), [['unseen_hits', 0.5, 0.5]]);
});

test('nothing is noted in creative mode, and another dimension forgets every zone', () => {
    setWorldQueries(null);
    const zones = createDangerZones({ now: clock() });
    const watch = createDangerWatch({ zones, everyMs: 0 });
    watch.look(makeAgent([mob(1, 'pillager', 30, 0)], { gameMode: 'creative' }));
    assert.equal(zones.list().length, 0);
    watch.look(makeAgent([mob(1, 'pillager', 30, 0)]));
    assert.equal(zones.list().length, 1);
    watch.look(makeAgent([], { dimension: 'the_nether' }));
    assert.equal(zones.list().length, 0);
});
