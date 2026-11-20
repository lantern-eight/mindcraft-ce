// SPDX-License-Identifier: CC0-1.0
// The shield: in the off-hand when carried, up when a shot is coming, and through the one use-item channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShield, shotComing, shotWindow, offHandOf, SHIELD, AFTER_SHOT_MS } from '../src/agent/reflexes/shield.js';
import { createItemUse, EATING } from '../src/agent/reflexes/item_use.js';

// Mobs east of the bot, which stands at the origin, unless placed elsewhere.
const mob = (name, distance, fields = {}) => ({ id: distance, name, distance, seenNow: true, drawing: true, aiming: true, position: { x: distance, y: 64, z: 0 }, ...fields });
const here = { x: 0, z: 0 };

test('a shot is coming from the nearest mob in view drawing within an archer\'s range', () => {
    assert.equal(shotComing([mob('skeleton', 12), mob('stray', 6)], here).name, 'stray');
    assert.equal(shotComing([mob('skeleton', 6, { drawing: false })], here), null, 'a bow held up, not drawn');
    assert.equal(shotComing([mob('skeleton', 17)], here), null, 'out of range');
    assert.equal(shotComing([mob('skeleton', 6, { seenNow: false })], here), null, 'a stand-in where one was last seen');
    assert.equal(shotComing([mob('witch', 5)], here), null, 'a witch\'s potions go round a shield');
    assert.equal(shotComing([], here), null);
});

test('a shield covers one side: archers aiming from two sides are not blocked', () => {
    const behind = mob('skeleton', 9, { drawing: false, position: { x: -9, y: 64, z: 0 } });
    assert.equal(shotComing([mob('skeleton', 6), behind], here), null, 'one on either side');
    const beside = mob('skeleton', 9, { drawing: false, position: { x: 7, y: 64, z: 5.6 } }); // about 39 degrees off
    assert.equal(shotComing([mob('skeleton', 6), beside], here).id, 6, 'both in front');
    const idle = { ...behind, aiming: false };
    assert.equal(shotComing([mob('skeleton', 6), idle], here).id, 6, 'one behind that isn\'t aiming');
    const zombie = mob('zombie', 3, { drawing: false, aiming: false, position: { x: -3, y: 64, z: 0 } });
    assert.equal(shotComing([mob('skeleton', 6), zombie], here).id, 6, 'a zombie is the fight\'s, not the shield\'s');
});

// A bot with a hand-built inventory: 45 is the off-hand, as mineflayer numbers it.
function botWith({ carried = [], offHand = null } = {}) {
    const calls = [];
    const slots = [];
    slots[45] = offHand ? { name: offHand } : null;
    const items = carried.map(name => ({ name }));
    const bot = {
        inventory: { slots, items: () => items },
        equip: async (item, where) => {
            calls.push(['equip', item.name, where]);
            if (where === 'off-hand') { slots[45] = item; items.splice(items.indexOf(item), 1); }
        },
        activateItem: offHand => calls.push(['use', offHand]),
        deactivateItem: () => calls.push(['let go']),
    };
    return { bot, calls };
}

test('a carried shield goes in an empty off-hand, and nothing put there on purpose is moved', async () => {
    const { bot, calls } = botWith({ carried: ['stone_sword', 'shield'] });
    const shield = createShield(bot, { use: createItemUse() });
    assert.equal(shield.has(), false);
    assert.equal(await shield.ready(), true);
    assert.deepEqual(calls, [['equip', 'shield', 'off-hand']]);
    assert.equal(offHandOf(bot).name, 'shield');
    assert.equal(await shield.ready(), true, 'already there');
    assert.equal(calls.length, 1);

    const other = botWith({ carried: ['shield'], offHand: 'totem_of_undying' });
    assert.equal(await createShield(other.bot, { use: createItemUse() }).ready(), false);
    assert.deepEqual(other.calls, [], 'the totem stays');
    assert.equal(await createShield(botWith().bot, { use: createItemUse() }).ready(), false, 'no shield carried');
});

test('it goes up through the use-item channel, and waits out a meal', () => {
    const { bot, calls } = botWith({ offHand: 'shield' });
    const use = createItemUse();
    let clock = 1000;
    const shield = createShield(bot, { use, now: () => clock });

    use.take(EATING);
    assert.equal(shield.raise(), false, 'not in the middle of a meal');
    assert.deepEqual(calls, []);
    use.release(EATING);

    assert.equal(shield.raise(), true);
    assert.equal(shield.up, true);
    assert.equal(shield.raisedAt, 1000);
    assert.equal(use.owner(), SHIELD);
    clock = 1200;
    assert.equal(shield.raise(), true, 'up already: nothing more sent');
    shield.lower();
    shield.lower();
    assert.deepEqual(calls, [['use', true], ['let go']], 'Java: the off-hand used, then let go');
    assert.equal(use.owner(), null);
    assert.equal(shield.raisedAt, null);
});

test('no shield in the off-hand: nothing goes up', () => {
    const { bot, calls } = botWith({ offHand: 'torch' });
    const use = createItemUse();
    assert.equal(createShield(bot, { use }).raise(), false);
    assert.deepEqual(calls, []);
    assert.equal(use.owner(), null, 'the channel is left free');
});

test('the shield stays up a moment after the draw ends: the arrow is on its way', () => {
    let clock = 0;
    const window = shotWindow(() => clock);
    assert.equal(window(null), null, 'nothing drawn yet');
    assert.equal(window({ id: 4 }), 4, 'drawing');
    clock = 900;
    assert.equal(window({ id: 4 }), 4, 'still drawing');
    clock += AFTER_SHOT_MS - 1;
    assert.equal(window(null), 4, 'loosed: the arrow is on its way');
    clock += 2;
    assert.equal(window(null), null, 'landed');
});
