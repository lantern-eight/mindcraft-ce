// SPDX-License-Identifier: CC0-1.0
// Mindcraft's useDoor finds a door by the names in its list of doors a hand can open, and reads whether
// the door is open from the block's properties. Bedrock Edition calls the oak door `wooden_door` and keeps
// a door's open state as `open_bit`, so both are asked for too (core hook B5).
import test from 'node:test';
import assert from 'node:assert/strict';
import registryFactory from 'prismarine-registry';
import { Vec3 } from 'vec3';
import { HAND_OPENED_DOORS } from '../src/utils/mcdata.js';
import { useDoor } from '../src/agent/library/skills.js';

const BEDROCK_VERSION = '1.26.60'; // the version the Bedrock tests read game data for

test('every Bedrock door a hand opens is on the list useDoor looks for', () => {
    const registry = registryFactory(`bedrock_${BEDROCK_VERSION}`);
    const doors = Object.keys(registry.blocksByName).filter(name => name.endsWith('_door') && name !== 'iron_door');
    assert.ok(doors.includes('wooden_door'), 'the oak door, under its Bedrock name');
    assert.deepEqual(doors.filter(name => !HAND_OPENED_DOORS.includes(name)), []);
});

// A bot standing at a door: it records each click, and is already where the walk would take it.
function botAtDoor(properties) {
    const clicks = [];
    const door = { name: 'wooden_door', position: new Vec3(3, 0, 0), _properties: properties };
    const bot = {
        output: '',
        pathfinder: { setGoal() {}, isMoving: () => false },
        blockAt: () => door,
        lookAt: async () => {},
        activateBlock: async block => { clicks.push(block.name); },
        setControlState() {},
    };
    return { bot, clicks };
}

test('a Bedrock door that is already open is not shut before the bot walks through', async () => {
    const { bot, clicks } = botAtDoor({ open_bit: 1, upper_block_bit: 0, door_hinge_bit: 0 });
    assert.equal(await useDoor(bot, new Vec3(3, 0, 0)), true);
    assert.equal(clicks.length, 1, 'only the click that closes it behind the bot');
});

test('a closed door is opened, walked through and closed again, on either edition', async () => {
    const bedrock = botAtDoor({ open_bit: 0, upper_block_bit: 0, door_hinge_bit: 0 });
    await useDoor(bedrock.bot, new Vec3(3, 0, 0));
    assert.equal(bedrock.clicks.length, 2);
    const java = botAtDoor({ open: false, half: 'lower', hinge: 'left', facing: 'east', powered: false });
    await useDoor(java.bot, new Vec3(3, 0, 0));
    assert.equal(java.clicks.length, 2);
    const javaOpen = botAtDoor({ open: true, half: 'lower', hinge: 'left', facing: 'east', powered: false });
    await useDoor(javaOpen.bot, new Vec3(3, 0, 0));
    assert.equal(javaOpen.clicks.length, 1, 'Java\'s own open door, as before');
});
