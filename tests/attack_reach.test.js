// SPDX-License-Identifier: CC0-1.0
// attackEntity, told to land one hit, walks to the mob first only when it can't hit it from where it stands.
// Stock that means more than five blocks away. Fair play holds the bot to a survival player's reach, three
// blocks to a mob, so it installs its own answer: otherwise the skill swings from four blocks and the swing
// is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { attackEntity } from '../src/agent/library/skills.js';
import { setAttackReach, withinAttackReach } from '../src/agent/library/attack_reach.js';

// Cheat mode stands in for the walk: goToPosition then teleports, which the test can see in chat.
function botNear(target) {
    const said = [], hits = [];
    const bot = {
        output: '', interrupt_code: false,
        entity: { position: new Vec3(0, 64, 0) },
        inventory: { items: () => [] },
        modes: { isOn: mode => mode === 'cheat' },
        chat: message => said.push(message),
        attack: async entity => { hits.push(entity.id); },
    };
    return { bot, said, hits, target };
}

test('stock: a mob four blocks away is hit from where the bot stands', async () => {
    const { bot, said, hits } = botNear();
    const cow = { id: 3, name: 'cow', position: new Vec3(4, 64, 0) };
    await attackEntity(bot, cow, false);
    assert.deepEqual(said, [], 'no walk');
    assert.deepEqual(hits, [3]);
    assert.equal(withinAttackReach(bot, { position: new Vec3(5.5, 64, 0) }), false);
});

test('with a reach installed, a mob beyond it is walked to first, and one within it is not', async () => {
    const { bot, said, hits } = botNear();
    setAttackReach(bot, entity => bot.entity.position.distanceTo(entity.position) <= 3);
    await attackEntity(bot, { id: 3, name: 'cow', position: new Vec3(4, 64, 0) }, false);
    assert.equal(said.length, 1, 'walked to the cow');
    assert.match(said[0], /^\/tp @s 4 64 0/);
    await attackEntity(bot, { id: 4, name: 'pig', position: new Vec3(2, 64, 0) }, false);
    assert.equal(said.length, 1, 'the pig is near enough');
    assert.deepEqual(hits, [3, 4]);
    setAttackReach(bot, null);
    assert.equal(withinAttackReach(bot, { position: new Vec3(4, 64, 0) }), true, 'removed: stock again');
});
