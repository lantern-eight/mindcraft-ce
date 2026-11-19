// SPDX-License-Identifier: CC0-1.0
// Standing orders: what an order may say, which one applies to a mob, when it lapses, where orders come
// from and how they are kept; and what each decision does under them, on plain objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { checkOrder, createStandingOrders, BUILT_IN, CREEPER_FLEE_DISTANCE, FLEE_DISTANCE } from '../src/agent/reflexes/orders.js';
import { loadSavedOrders, orderCommands, saveOrders } from '../src/agent/reflexes/order_commands.js';
import { decideMobThreat, chooseFight, LOW_HEALTH } from '../src/agent/reflexes/mob_decide.js';
import { decideThreat } from '../src/agent/reflexes/decide.js';

const fit = { health: 20, armed: false };
const armed = { health: 20, armed: true };

// ---- What an order may say ----

test('an order names a mob, a group or all, and one of four stances', () => {
    assert.equal(checkOrder('zombies', 'fight').ok, true);
    assert.equal(checkOrder('Cave Spider', 'flee').target, 'cave_spider', 'spoken names are taken');
    assert.equal(checkOrder('all', 'ignore').ok, true);
    assert.match(checkOrder('zombie', 'run').error, /not an order/);
    assert.match(checkOrder('zombi', 'fight', name => name === 'zombie').error, /not a mob/);
    assert.match(checkOrder('witche', 'fight', () => false).error, /"witches"/, 'a near miss of a group is pointed out');
});

test('creepers take fight and flee, never ignore', () => {
    assert.equal(checkOrder('creepers', 'fight').ok, true);
    assert.equal(checkOrder('creeper', 'flee').order.distance, CREEPER_FLEE_DISTANCE, 'leaving goes past the 16 a creeper follows');
    assert.match(checkOrder('creeper', 'ignore').error, /creeper_safety/);
});

test('minimum health is 6 to 20, half health when not given; distance is for flee only', () => {
    assert.equal(checkOrder('zombie', 'fight').order.min_health, 10);
    assert.equal(checkOrder('zombie', { stance: 'fight', min_health: 7 }).order.min_health, 7);
    assert.equal(checkOrder('zombie', { stance: 'fight', min_health: 3 }).ok, false, 'under 6 the bot always runs');
    assert.equal(checkOrder('zombie', 'flee').order.distance, FLEE_DISTANCE);
    assert.equal(checkOrder('zombie', { stance: 'flee', distance: 4 }).ok, false);
    assert.equal(checkOrder('zombie', 'fight').order.distance, undefined);
});

// ---- Which order applies ----

test('with no threat_rules in the profile the built-in ones apply: fight zombies and spiders, when armed', () => {
    const orders = createStandingOrders();
    assert.deepEqual(Object.keys(BUILT_IN).sort(), ['spider', 'zombies']);
    assert.equal(orders.orderFor('husk', fit), null, 'unarmed: the bot\'s own judgment');
    assert.equal(orders.orderFor('husk', armed).stance, 'fight');
    assert.equal(orders.orderFor('spider', armed).stance, 'fight');
    assert.equal(orders.orderFor('cave_spider', armed), null, 'only the plain spider');
    assert.equal(createStandingOrders({ profile: {} }).list().length, 0, 'an empty threat_rules has none');
});

test('the most exact order wins: a mob\'s name, then its group, then all; all leaves creepers out', () => {
    const orders = createStandingOrders({ profile: { all: 'ignore', zombies: 'flee', husk: 'fight' } });
    assert.equal(orders.orderFor('husk', fit).stance, 'fight');
    assert.equal(orders.orderFor('drowned', fit).stance, 'flee');
    assert.equal(orders.orderFor('skeleton', fit).stance, 'ignore');
    assert.equal(orders.orderFor('creeper', fit), null);
});

test('an order lapses under its minimum health, and never reaches under 6', () => {
    const orders = createStandingOrders({ profile: { zombies: { stance: 'fight', min_health: 8 } } });
    assert.equal(orders.orderFor('zombie', { health: 8, armed: false }).stance, 'fight');
    assert.equal(orders.orderFor('zombie', { health: 7, armed: false }), null);
});

test('a profile order that doesn\'t check out is left out with a warning', () => {
    const warnings = [];
    const orders = createStandingOrders({ profile: { creepers: 'ignore', zombies: 'fight' }, warn: text => warnings.push(text) });
    assert.deepEqual(orders.list().map(order => order.target), ['zombies']);
    assert.equal(warnings.length, 1);
});

test('orders given by command go on top of the profile\'s, are kept, and default clears even a profile order', () => {
    let kept = null;
    const orders = createStandingOrders({ profile: { zombies: 'fight', spiders: 'flee' }, save: saved => { kept = saved; } });
    assert.match(orders.give('zombies', 'ignore').text, /ignore zombies/);
    assert.equal(orders.orderFor('zombie', fit).stance, 'ignore');
    assert.match(orders.give('spiders', 'default').text, /Cleared/);
    assert.equal(orders.orderFor('spider', fit), null);
    assert.deepEqual(kept, { zombies: { stance: 'ignore', min_health: 10 }, spiders: null });
    assert.equal(orders.give('creepers', 'ignore').ok, false);
    assert.deepEqual(orders.list(), [{ target: 'zombies', stance: 'ignore', min_health: 10, from: 'command' }]);

    const again = createStandingOrders({ profile: { zombies: 'fight', spiders: 'flee' }, saved: kept });
    assert.equal(again.orderFor('zombie', fit).stance, 'ignore', 'after a restart');
    assert.equal(again.orderFor('spider', fit), null);
});

test('orders are kept in a file in the bot\'s folder, and the commands read and give them', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'threat-rules-'));
    assert.deepEqual(loadSavedOrders(dir), {}, 'no file yet');
    const orders = createStandingOrders({ profile: {}, save: saved => saveOrders(dir, saved) });
    const agent = { threatReflexes: { orders } };
    const [list, give] = orderCommands().map(({ command }) => command);
    assert.match(await list.perform(agent), /none/);
    assert.match(await give.perform(agent, 'skeletons', 'flee', 0, 24), /back away from skeletons to 24 blocks/);
    assert.match(await give.perform(agent, 'creepers', 'ignore', 0, 0), /creeper_safety/);
    assert.match(await list.perform(agent), /back away from skeletons to 24 blocks \(down to 10 health\)/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'threat_rules.json'), 'utf8')), { skeletons: { stance: 'flee', min_health: 10, distance: 24 } });
    assert.deepEqual(loadSavedOrders(dir), { skeletons: { stance: 'flee', min_health: 10, distance: 24 } });
    assert.match(await list.perform({}), /off/, 'with the reflexes off there are none');
});

// ---- The mob reflex and the fight under orders ----

const self = (fields = {}) => ({ position: { x: 0, y: 64, z: 0 }, health: 20, food: 20, gameMode: 'survival', armed: false, ...fields });
let nextId = 1;
const mob = (name, distance, fields = {}) => ({
    id: nextId++, name, position: { x: distance, y: 64, z: 0 }, distance, seenNow: true, aiming: false, aggressive: true, ...fields,
});
const under = (profile, me = self()) => {
    const orders = createStandingOrders({ profile });
    return mob => orders.orderFor(mob.name, me);
};

test('fight zombies: two coming are fought, nearest first, instead of backed away from', () => {
    const a = mob('zombie', 5), b = mob('husk', 3);
    const orderOf = under({ zombies: 'fight' });
    assert.equal(decideMobThreat([a, b], self(), { orderOf }).stance, 'ignore', 'no crowd');
    assert.equal(chooseFight([b, a], self(), { orderOf }), b);
    assert.equal(decideMobThreat([a, b], self()).stance, 'retreat', 'without the order: a crowd');
});

test('a fight order goes past the bot\'s own scope: hungry, strong mobs, archers', () => {
    const vindicator = mob('vindicator', 4);
    assert.equal(chooseFight([vindicator], self(), { orderOf: under({ vindicator: 'fight' }) }), vindicator);
    assert.equal(decideMobThreat([vindicator], self(), { orderOf: under({ vindicator: 'fight' }) }).stance, 'ignore', 'no retreat from it');
    const zombie = mob('zombie', 4);
    assert.equal(chooseFight([zombie], self({ food: 4 }), { orderOf: under({ zombie: 'fight' }) }), zombie, 'hungry');
    const skeleton = mob('skeleton', 12, { aiming: true });
    const orderOf = under({ skeletons: 'fight' });
    assert.equal(decideMobThreat([skeleton], self(), { orderOf }).stance, 'ignore', 'no cover: it goes for it');
    assert.equal(chooseFight([skeleton], self(), { orderOf }), skeleton);
    assert.equal(chooseFight([mob('skeleton', 20, { aiming: true })], self(), { orderOf }), null, 'out of its range');
});

test('fight when armed: armed, the order; unarmed, the bot\'s own scope', () => {
    const a = mob('zombie', 4), b = mob('zombie', 6);
    assert.equal(chooseFight([a, b], self({ armed: true }), { orderOf: under(undefined, self({ armed: true })) }), a);
    assert.equal(chooseFight([a, b], self(), { orderOf: under(undefined, self()) }), null);
    assert.equal(decideMobThreat([a, b], self(), { orderOf: under(undefined, self()) }).stance, 'retreat');
});

test('a lapsed order is the bot\'s own judgment again, and under 6 the bot runs whatever the orders', () => {
    const a = mob('zombie', 4), b = mob('zombie', 6);
    const hurt = self({ health: 9 });
    assert.equal(decideMobThreat([a, b], hurt, { orderOf: under({ zombies: 'fight' }, hurt) }).stance, 'retreat', 'under 10: a crowd again');
    const low = self({ health: LOW_HEALTH - 1 });
    const orderOf = under({ zombies: { stance: 'fight', min_health: 6 }, skeletons: 'ignore' }, low);
    assert.equal(decideMobThreat([a, mob('skeleton', 10)], low, { orderOf }).stance, 'flee');
    assert.equal(chooseFight([a], low, { orderOf }), null);
});

test('flee: backed away from as soon as it comes, to the order\'s distance', () => {
    const spider = mob('spider', 6);
    const decision = decideMobThreat([spider], self(), { orderOf: under({ spiders: { stance: 'flee', distance: 24 } }) });
    assert.equal(decision.stance, 'retreat');
    assert.equal(decision.reason, 'ordered');
    assert.equal(decision.distance, 24);
    assert.deepEqual(decision.ids, [spider.id]);
    assert.equal(chooseFight([spider], self(), { orderOf: under({ spiders: 'flee' }) }), null, 'never fought');
    assert.equal(decideMobThreat([mob('spider', 12, { aggressive: false })], self(), { orderOf: under({ spiders: 'flee' }) }).stance, 'ignore', 'one that hasn\'t come is let be');
    assert.equal(decideMobThreat([spider], self()).stance, 'ignore', 'without the order: a fair fight');
});

test('ignore: as if it weren\'t there, but for the low-health run and as the cause of a hit', () => {
    const orderOf = under({ skeletons: 'ignore', zombies: 'ignore' });
    assert.equal(decideMobThreat([mob('skeleton', 10, { aiming: true })], self(), { orderOf }).stance, 'ignore', 'no cover');
    assert.equal(decideMobThreat([mob('zombie', 3), mob('zombie', 4)], self(), { orderOf }).stance, 'ignore', 'no crowd');
    assert.equal(chooseFight([mob('zombie', 3)], self(), { orderOf }), null, 'no fight');
    const spider = mob('spider', 4);
    assert.equal(chooseFight([spider, mob('zombie', 5, { aggressive: false })], self(), { orderOf }), spider, 'an ignored zombie doesn\'t hold back a fight');
    const hits = [{ at: 1000, direction: { x: 1, z: 0 } }, { at: 2000, direction: { x: 1, z: 0 } }];
    assert.equal(decideMobThreat([mob('zombie', 2)], self(), { orderOf, hits, now: 2500 }).stance, 'ignore', 'the ignored zombie dealt the hits');
});

// ---- The creeper reflex under orders ----

const origin = { x: 0, y: 64, z: 0 };
const me = (extra = {}) => ({ position: origin, health: 20, gameMode: 'survival', edition: 'java', underground: false, hitsNeeded: 4, ...extra });
const creeper = (distance, extra = {}) => ({
    key: `id:${distance}`, position: { x: distance, y: 64, z: 0 }, distance, lit: false, fuse: 0, seenNow: true,
    source: 'seen', encounters: 0, ...extra,
});

test('fight creepers: met at the first meeting when armed well enough, on Java; otherwise as before', () => {
    const order = { stance: 'fight' };
    const decision = decideThreat([creeper(5)], me(), { order });
    assert.equal(decision.stance, 'hit_and_step_back');
    assert.equal(decision.reason, 'ordered');
    assert.equal(decideThreat([creeper(5)], me()).stance, 'ignore', 'without the order: let be at 5');
    assert.equal(decideThreat([creeper(5, { lit: true })], me(), { order }).stance, 'back_off', 'a lit one is backed off from');
    assert.equal(decideThreat([creeper(5)], me({ hitsNeeded: 5 }), { order }).stance, 'ignore', 'a wooden sword is not enough');
    assert.equal(decideThreat([creeper(5)], me({ edition: 'bedrock' }), { order }).stance, 'ignore', 'not on Bedrock');
    assert.equal(decideThreat([creeper(5, { encounters: 1 })], me({ health: 8 }), { order }).stance, 'hit_and_step_back', 'the order\'s own minimum, checked before');
});

test('flee creepers: left for good at once, from a sighting within 8 or a hiss', () => {
    const order = { stance: 'flee', distance: 30 };
    const decision = decideThreat([creeper(7)], me(), { order });
    assert.equal(decision.stance, 'leave');
    assert.equal(decision.distance, 30);
    assert.equal(decision.reason, 'ordered');
    assert.equal(decideThreat([creeper(10)], me(), { order }).stance, 'ignore', 'farther: let be');
    const heard = creeper(6, { key: 'heard:east', source: 'heard', seenNow: false, lit: true, slack: 3 });
    assert.equal(decideThreat([heard], me(), { order }).stance, 'leave');
    assert.equal(decideThreat([heard], me(), { order }).distance, 33);
});
