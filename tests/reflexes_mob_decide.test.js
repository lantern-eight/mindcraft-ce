// SPDX-License-Identifier: CC0-1.0
// The mob reflex's decision and the fight's scope, on plain objects: rules 3 to 7 in order, the fight
// taken only one mob at a time and only when fit for it, and one owner per threat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMobThreat, chooseFight, joinsFight, LOW_HEALTH, isRanged, isMelee } from '../src/agent/reflexes/mob_decide.js';
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
