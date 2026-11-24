// SPDX-License-Identifier: CC0-1.0
// The mob reflex's decision and the fight's scope, on plain objects: rules 3 to 7 in order, the fight
// taken only one mob at a time and only when fit for it, and one owner per threat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMobThreat, chooseFight, joinsFight, ordersAfterGivingUp, fightScope, LOW_HEALTH, isRanged, isMelee, explainsHit } from '../src/agent/reflexes/mob_decide.js';
import { createClaims } from '../src/agent/reflexes/claims.js';

const self = (fields = {}) => ({ position: { x: 0, y: 64, z: 0 }, health: 20, food: 20, gameMode: 'survival', ...fields });
let nextId = 1;
const mob = (name, distance, fields = {}) => ({
    id: nextId++, name, position: { x: distance, y: 64, z: 0 }, distance, seenNow: true, aiming: false, aggressive: true, ...fields,
});

test('nothing around: ignore', () => {
    assert.equal(decideMobThreat([], self()).stance, 'ignore');
});

test('rule 3: under 6 health with a hostile in view, flee far from everything', () => {
    const zombie = mob('zombie', 10, { aggressive: false });
    const decision = decideMobThreat([zombie], self({ health: LOW_HEALTH - 1 }));
    assert.equal(decision.stance, 'flee');
    assert.deepEqual(decision.from, [zombie.position]);
    assert.ok(decision.distance >= 20);
    assert.equal(decideMobThreat([zombie], self({ health: LOW_HEALTH })).stance, 'ignore', '6 is not under 6');
});

test('rule 3 also runs from a hit felt just now, with nothing in view', () => {
    const decision = decideMobThreat([], self({ health: 3 }), { hits: [{ at: 1000, direction: { x: 1, z: 0 } }], now: 1500 });
    assert.equal(decision.stance, 'flee');
    assert.ok(decision.from[0].x > 0, 'from the side the hit came from');
    assert.equal(decideMobThreat([], self({ health: 3 }), { hits: [{ at: 1000, direction: { x: 1, z: 0 } }], now: 9000 }).stance, 'ignore', 'an old hit');
});

test('rule 4: take cover from a skeleton aiming within 16, not from one in view that isn\'t', () => {
    const skeleton = mob('skeleton', 12, { aiming: true });
    const decision = decideMobThreat([skeleton], self());
    assert.equal(decision.stance, 'take_cover');
    assert.equal(decision.key, `id:${skeleton.id}`);
    assert.equal(decideMobThreat([mob('skeleton', 12, { aiming: false, aggressive: false })], self()).stance, 'ignore');
    assert.equal(decideMobThreat([mob('skeleton', 20, { aiming: true })], self()).stance, 'ignore', 'out of its range');
    assert.equal(decideMobThreat([mob('skeleton', 12, { aiming: true, seenNow: false })], self()).stance, 'ignore', 'a stand-in is never read');
});

test('rule 5: two zombies coming within 8: retreat from both; one is a fair fight', () => {
    const a = mob('zombie', 5), b = mob('husk', 7);
    const decision = decideMobThreat([a, b], self());
    assert.equal(decision.stance, 'retreat');
    assert.equal(decision.key, 'crowd');
    assert.deepEqual(decision.from, [a.position, b.position]);
    assert.equal(decideMobThreat([mob('zombie', 5)], self()).stance, 'ignore');
    assert.equal(decideMobThreat([mob('zombie', 5), mob('zombie', 7, { aggressive: false })], self()).stance, 'ignore', 'one has no target, and is 7 off');
    const close = decideMobThreat([mob('zombie', 3, { aggressive: false }), mob('zombie', 4, { aggressive: false })], self());
    assert.equal(close.stance, 'retreat', 'two this close are about to');
    assert.equal(close.from.length, 2, 'and both are run from');
    assert.equal(decideMobThreat([mob('zombie', 5), mob('phantom', 3)], self()).stance, 'ignore', 'a phantom flies: no reason to run');
});

test('rule 5b: one mob the bot is in no shape to fight, or too strong, is retreated from', () => {
    assert.equal(decideMobThreat([mob('zombie', 5)], self({ health: 8 })).reason, 'hurt');
    assert.equal(decideMobThreat([mob('zombie', 5)], self({ food: 6 })).reason, 'hungry');
    assert.equal(decideMobThreat([mob('cave_spider', 5)], self()).reason, 'too strong');
    assert.equal(decideMobThreat([mob('enderman', 5, { aggressive: false })], self()).stance, 'ignore', 'an enderman left alone');
});

test('rule 7: hit twice from one side with nothing in view: retreat the other way', () => {
    const hits = [{ at: 1000, direction: { x: 0, z: 1 } }, { at: 2500, direction: { x: 0, z: 1 } }];
    const decision = decideMobThreat([], self(), { hits, now: 3000 });
    assert.equal(decision.stance, 'retreat');
    assert.ok(decision.from.every(p => p.z > 0), 'from the south, where the hits came from');
    assert.equal(decideMobThreat([], self(), { hits: hits.slice(1), now: 3000 }).stance, 'ignore', 'one hit');
    assert.equal(decideMobThreat([mob('zombie', 2)], self(), { hits, now: 3000 }).stance, 'ignore', 'the zombie in view did it: a fair fight');
    assert.equal(decideMobThreat([], self(), { hits: hits.map(h => ({ ...h, direction: null })), now: 3000 }).stance, 'ignore', 'no side to run from');
    assert.equal(decideMobThreat([], self(), { hits: hits.map(h => ({ ...h, explained: true })), now: 3000 }).stance, 'ignore',
        'a zombie in view dealt them as they landed, and has fallen since');
});

test('first match wins: low health over cover, cover over a crowd', () => {
    const skeleton = mob('skeleton', 10, { aiming: true });
    const zombies = [mob('zombie', 4), mob('zombie', 5)];
    assert.equal(decideMobThreat([skeleton, ...zombies], self({ health: 4 })).stance, 'flee');
    assert.equal(decideMobThreat([skeleton, ...zombies], self()).stance, 'take_cover');
});

test('creative mode: nothing hurts', () => {
    assert.equal(decideMobThreat([mob('zombie', 4), mob('zombie', 5)], self({ gameMode: 'creative' })).stance, 'ignore');
});

test('the fight: one melee mob, when fit; never a creeper, a crowd, a ranged mob or one given up on', () => {
    const zombie = mob('zombie', 5);
    assert.equal(chooseFight([zombie], self()), zombie);
    assert.equal(chooseFight([zombie], self({ health: 9 })), null, 'under half health');
    assert.equal(chooseFight([zombie], self({ food: 6 })), null, 'too hungry to sprint');
    assert.equal(chooseFight([zombie, mob('zombie', 6)], self()), null, 'two: the mob reflex retreats');
    assert.equal(chooseFight([zombie, mob('zombie', 7, { aggressive: false })], self()), null, 'a second one about to come');
    assert.equal(chooseFight([zombie, mob('zombie', 12, { aggressive: false })], self()), zombie, 'one far off is no matter');
    assert.equal(chooseFight([mob('creeper', 3)], self()), null);
    assert.equal(chooseFight([mob('skeleton', 3)], self()), null);
    assert.equal(chooseFight([mob('zombie', 5, { aggressive: false })], self()), null, 'it has not come for the bot');
    assert.equal(chooseFight([zombie], self(), { givenUp: id => id === zombie.id }), null);
    assert.equal(chooseFight([zombie], self(), { reachable: () => false }), null, 'no way to it');
});

test('one owner per threat: the fight doesn\'t hold back a crowd, and waits for the mob reflex\'s claim', () => {
    let t = 0;
    const claims = createClaims({ now: () => t });
    const a = mob('zombie', 4), b = mob('zombie', 6);
    claims.claim(`id:${a.id}`, 'self_defense');
    const extra = () => ({ ownerOf: claims.ownerOf, now: t });
    assert.equal(decideMobThreat([a, b], self(), extra()).stance, 'retreat', 'a second zombie ends the fight');
    assert.equal(decideMobThreat([a], self({ health: 8 }), extra()).stance, 'ignore', 'one being fought is not backed away from');
    assert.equal(decideMobThreat([a], self({ health: 4 }), extra()).stance, 'flee', 'urgent: no asking');
    claims.claim(`id:${a.id}`, 'mob_safety');
    assert.equal(chooseFight([a], self(), { ownerOf: claims.ownerOf }), null, 'the fight waits for the mob reflex\'s claim');
    t = 5000;
    assert.equal(chooseFight([a], self(), { ownerOf: claims.ownerOf }), a, 'then takes it');
});

test("an evoker counts as a mob that fights from afar by Bedrock's name for it too", () => {
    assert.equal(isRanged({ name: 'evoker' }), true);
    assert.equal(isRanged({ name: 'evocation_illager' }), true);
    assert.equal(isMelee({ name: 'evocation_illager' }), false);
});

test('joining a fight under way: the mobs it would take on, coming for it, and none it was told to leave or ran from', () => {
    const coming = (name, fields = {}) => mob(name, 3, { aggressive: true, ...fields });
    assert.equal(joinsFight(coming('zombie')), true, 'a second zombie biting');
    assert.equal(joinsFight(coming('spider')), true);
    assert.equal(joinsFight(mob('zombie', 3, { aggressive: false })), true, 'close enough that it is about to');
    assert.equal(joinsFight(mob('zombie', 7, { aggressive: false })), false, 'not coming yet');
    assert.equal(joinsFight(coming('zombie', { seenNow: false })), false, 'out of view');
    assert.equal(joinsFight(coming('creeper')), false, 'creepers are the creeper reflex\'s');
    assert.equal(joinsFight(coming('skeleton', { aiming: true })), false, 'an archer is the mob reflex\'s, unless told');
    assert.equal(joinsFight(coming('cave_spider')), false, 'too strong to take on unasked');
    const told = stance => () => ({ stance });
    assert.equal(joinsFight(coming('skeleton', { aiming: true }), { orderOf: told('fight') }), true, 'told to fight skeletons');
    assert.equal(joinsFight(coming('zombie'), { orderOf: told('ignore') }), false);
    assert.equal(joinsFight(coming('zombie'), { orderOf: told('flee') }), false);
    assert.equal(joinsFight(coming('zombie'), { givenUp: () => true }), false);
    assert.equal(joinsFight(coming('zombie'), { ownerOf: () => 'mob_safety' }), false, 'taken by the mob reflex');
    assert.equal(joinsFight(coming('zombie'), { ownerOf: () => 'self_defense' }), true);
});

test('an order to fight a mob the fight gave up on no longer holds: an archer it let go of is taken cover from', () => {
    const skeleton = mob('skeleton', 6, { aiming: true });
    const told = () => ({ stance: 'fight' });
    // Under the order the mob reflex leaves it to the fight...
    assert.equal(decideMobThreat([skeleton], self(), { orderOf: told }).stance, 'ignore');
    // ...but once the fight has given up on it, nothing would deal with it: the bot's own judgment is back.
    const orderOf = ordersAfterGivingUp(told, id => id === skeleton.id);
    assert.equal(orderOf(skeleton), null);
    assert.equal(decideMobThreat([skeleton], self(), { orderOf }).stance, 'take_cover');
    // Other orders, and other mobs, are as they were.
    assert.deepEqual(ordersAfterGivingUp(() => ({ stance: 'flee' }), () => true)(skeleton), { stance: 'flee' });
    assert.deepEqual(ordersAfterGivingUp(told, () => false)(skeleton), { stance: 'fight' });
});

// ---- How much the bot takes on by its own judgment, by its gear ----

const armed = (fields = {}) => self({ armed: true, armor: 0, ...fields });
const armored = (fields = {}) => self({ armed: true, armor: 15, ...fields }); // a full iron set

test('the fight\'s scope by gear: bare hands one mob; a sword three melee mobs and an archer; a sword and full iron two archers', () => {
    assert.deepEqual(fightScope(self()), { melee: 1, archers: 0 });
    assert.deepEqual(fightScope(self({ armor: 20 })), { melee: 1, archers: 0 }, 'armor without a weapon widens nothing');
    assert.deepEqual(fightScope(armed()), { melee: 3, archers: 1 });
    assert.deepEqual(fightScope(armed({ armor: 14 })), { melee: 3, archers: 1 }, 'less than a full iron set');
    assert.deepEqual(fightScope(armored()), { melee: 3, archers: 2 });
    assert.deepEqual(fightScope(armed({ shielded: true })), { melee: 3, archers: 2 }, 'a sword and a shield: as a full iron set');
    assert.deepEqual(fightScope(self({ shielded: true })), { melee: 1, archers: 0 }, 'a shield without a weapon widens nothing');
    assert.deepEqual(fightScope(armed({ shielded: true, health: 9 })), { melee: 1, archers: 0 }, 'nor under half health');
    assert.deepEqual(fightScope(armored({ health: 9 })), { melee: 1, archers: 0 }, 'under half health, gear doesn\'t count');
    assert.deepEqual(fightScope(armored({ food: 6 })), { melee: 1, archers: 0 }, 'too hungry to sprint or heal');
});

test('armed, the bot stands against up to three melee mobs on its own judgment; a fourth is a crowd', () => {
    const three = [mob('zombie', 4), mob('spider', 5), mob('husk', 6)];
    assert.equal(decideMobThreat(three, armed()).stance, 'ignore', 'no retreat from three');
    assert.equal(chooseFight(three, armed()), three[0], 'the nearest first');
    const four = [...three, mob('zombie', 7)];
    assert.equal(decideMobThreat(four, armed()).stance, 'retreat');
    assert.equal(chooseFight(four, armed()), null);
    // Unarmed, two are already a crowd, as before.
    assert.equal(decideMobThreat(three.slice(0, 2), self()).stance, 'retreat');
    // Hurt, the gear stops counting: two are a crowd again.
    assert.equal(decideMobThreat(three.slice(0, 2), armed({ health: 9 })).stance, 'retreat');
    // Too strong to take on unasked, whatever the gear.
    assert.equal(chooseFight([mob('vindicator', 4)], armored()), null);
    assert.equal(decideMobThreat([mob('zombie', 4), mob('vindicator', 5)], armored()).stance, 'retreat', 'a crowd with one it shouldn\'t fight');
});

test('armed, an archer aiming is rushed instead of hidden from: one with a sword, two in full iron; not one the fight gave up on', () => {
    const skeleton = mob('skeleton', 12, { aiming: true });
    assert.equal(decideMobThreat([skeleton], self()).stance, 'take_cover', 'bare-handed: cover, as before');
    assert.equal(decideMobThreat([skeleton], armed()).stance, 'ignore', 'a sword: one is rushed');
    assert.equal(chooseFight([skeleton], armed()), skeleton);
    const pair = [skeleton, mob('stray', 10, { aiming: true })];
    assert.equal(decideMobThreat(pair, armed()).stance, 'take_cover', 'a sword alone: two archers are too many');
    assert.equal(chooseFight(pair, armed()), null);
    assert.equal(decideMobThreat([skeleton], armored()).stance, 'ignore', 'left to the fight');
    assert.equal(chooseFight([skeleton], armored()), skeleton);
    const two = [skeleton, mob('stray', 10, { aiming: true })];
    assert.equal(chooseFight(two, armored()), two[1], 'two archers, the nearer first');
    const three = [...two, mob('skeleton', 14, { aiming: true })];
    assert.equal(decideMobThreat(three, armored()).stance, 'take_cover', 'three archers: too many');
    assert.equal(chooseFight(three, armored()), null);
    // The fight couldn't reach it, or gave up: cover again.
    assert.equal(decideMobThreat([skeleton], armored(), { gaveUp: id => id === skeleton.id }).stance, 'take_cover');
    assert.equal(chooseFight([skeleton], armored(), { givenUp: id => id === skeleton.id }), null);
    // A mixed group within scope: two zombies and a skeleton.
    const mixed = [mob('zombie', 4), mob('zombie', 6), skeleton];
    assert.equal(decideMobThreat(mixed, armored()).stance, 'ignore');
    assert.equal(chooseFight(mixed, armored()), mixed[0]);
});

test('joining a fight under way follows the same scope: an archer joins only when armed', () => {
    const skeleton = mob('skeleton', 6, { aiming: true });
    assert.equal(joinsFight(skeleton, { scope: { melee: 1, archers: 0 } }), false);
    assert.equal(joinsFight(skeleton, { scope: { melee: 3, archers: 1 } }), true);
    assert.equal(joinsFight(mob('zombie', 3), { scope: { melee: 3, archers: 2 } }), true);
});

test('a hit is put down to a mob in view only on the side it came from: hit from behind while facing a zombie, something else is there', () => {
    const here = { x: 0, z: 0 };
    const zombie = { name: 'zombie', position: { x: 0, y: 64, z: -2 }, distance: 2, aggressive: true }; // to the north
    assert.equal(explainsHit(zombie, { x: 0, z: -1 }, here), true, 'from the north: the zombie');
    assert.equal(explainsHit(zombie, { x: 0.6, z: -0.8 }, here), true, 'a little off: still the zombie');
    assert.equal(explainsHit(zombie, { x: 0, z: 1 }, here), false, 'from behind: not the zombie');
    assert.equal(explainsHit(zombie, { x: -1, z: 0 }, here), false, 'from the side: not the zombie');
    assert.equal(explainsHit(zombie, null, here), true, 'no side felt: the zombie in view will do');
    const far = { name: 'zombie', position: { x: 0, y: 64, z: -12 }, distance: 12, aggressive: false };
    assert.equal(explainsHit(far, { x: 0, z: -1 }, here), false, 'one that couldn\'t have dealt it, whichever side');
});
