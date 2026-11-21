// SPDX-License-Identifier: CC0-1.0
// The glance: through a player's screen, the bot turns toward a hit, a hostile heard close and not seen, a
// shot, and back the way it ran from; it looks once at a sound and remembers; it waits for a break in the
// work, but not for a hit; and seeing all around it never turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { createGlance } from '../src/agent/reflexes/glance.js';

function scene({ narrow = true } = {}) {
    let t = 1_000_000;
    const now = () => t;
    const bot = new EventEmitter();
    const looks = [];
    Object.assign(bot, {
        registry: { entitiesByName: { zombie: { type: 'hostile' }, cow: { type: 'passive' }, skeleton: { type: 'hostile' } } },
        entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0 },
        pathfinder: { isMoving: () => false },
        targetDigBlock: null,
        look: async (yaw, pitch) => { looks.push(Math.round(yaw * 100) / 100); },
    });
    const agent = { bot, actions: { currentActionLabel: '' }, fairPlay: { looks: { getScreen: () => (narrow ? {} : null), holdUntil: 0 } } };
    const glance = createGlance({ now });
    return { bot, agent, glance, looks, advance: ms => { t += ms; } };
}
const heard = (subject, direction, distance, seen = false) => ({ subject, direction, distance, seen });
const SOUTH = Math.round(Math.PI * 100) / 100, WEST = Math.round(Math.PI / 2 * 100) / 100;

test('a hostile heard close and not seen turns the bot toward it, and holds the head a moment', () => {
    const { agent, glance, looks } = scene();
    glance.hear(agent, heard('zombie', 'south', 'close'));
    assert.deepEqual(looks, [SOUTH]);
    assert.ok(agent.fairPlay.looks.holdUntil > 1_000_000, 'the idle look-around gives way');
    glance.hear(agent, heard('cow', 'west', 'very close'));
    glance.hear(agent, heard('zombie', 'west', 'far'));
    glance.hear(agent, heard('zombie', 'west', 'close', true));
    assert.deepEqual(looks, [SOUTH], 'not for a cow, a far zombie, or one in view');
    glance.hear(agent, heard('skeleton (shooting)', 'west', 'far'));
    assert.deepEqual(looks, [SOUTH, WEST], 'a shot, from any distance');
});

test('looked once, remembered: the same sound from the same way is let be, until it comes closer, the bot moves, time passes or a hit lands', () => {
    const { bot, agent, glance, looks, advance } = scene();
    glance.hear(agent, heard('zombie', 'south', 'close'));
    glance.hear(agent, heard('zombie', 'south', 'close'));
    assert.equal(looks.length, 1, 'once');
    glance.hear(agent, heard('zombie', 'south', 'very close'));
    assert.equal(looks.length, 2, 'closer: again');
    glance.hear(agent, heard('zombie', 'south', 'very close'));
    assert.equal(looks.length, 2);
    bot.entity.position = new Vec3(8.5, 64, 0.5);
    glance.hear(agent, heard('zombie', 'south', 'very close'));
    assert.equal(looks.length, 3, 'moved on: again');
    advance(120_000);
    glance.hear(agent, heard('zombie', 'south', 'very close'));
    assert.equal(looks.length, 4, 'a while later: again');
    glance.felt(agent, { x: 0, z: 1 });
    assert.equal(looks.length, 5, 'a hit: turns to it');
    glance.hear(agent, heard('zombie', 'south', 'very close'));
    assert.equal(looks.length, 6, 'and every note is dropped');
});

test('a sound waits for a dig to finish and for a walk to stop; a hit doesn\'t wait for the dig', () => {
    const { bot, agent, glance, looks, advance } = scene();
    bot.targetDigBlock = { name: 'stone' };
    glance.hear(agent, heard('zombie', 'south', 'close'));
    assert.equal(looks.length, 0, 'mid-dig');
    bot.targetDigBlock = null;
    glance.tick(agent);
    assert.equal(looks.length, 1, 'between blocks');
    let moving = true;
    bot.pathfinder.isMoving = () => moving;
    glance.hear(agent, heard('zombie', 'west', 'close'));
    advance(4000);
    moving = false;
    glance.tick(agent);
    assert.equal(looks.length, 1, 'a sound that waited too long is let go');
    bot.targetDigBlock = { name: 'stone' };
    glance.felt(agent, { x: -1, z: 0 });
    assert.equal(looks.length, 2, 'a hit turns the bot mid-dig');
});

test('a back-off ended: a look back the way the bot came; seeing all around, nothing ever turns it', () => {
    const { bot, agent, glance, looks } = scene();
    bot.entity.position = new Vec3(10.5, 64, 0.5);
    glance.ranFrom(agent, new Vec3(0.5, 64, 0.5));
    assert.deepEqual(looks, [WEST]);
    const wide = scene({ narrow: false });
    wide.glance.hear(wide.agent, heard('zombie', 'south', 'close'));
    wide.glance.felt(wide.agent, { x: 0, z: 1 });
    wide.glance.ranFrom(wide.agent, new Vec3(20, 64, 0));
    assert.deepEqual(wide.looks, []);
});
