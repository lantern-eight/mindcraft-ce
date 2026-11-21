// SPDX-License-Identifier: CC0-1.0
// Looking around through a player's screen: which ways the bot has looked lately, from where; turning to the
// rest; looking round before a search gives up or walks off to a far find; and the model's !lookAround.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { watchLooks, lookAround, lookBeforeSearching, lookAroundCommand, stalestHeading } from '../src/agent/fairplay/look_around.js';
import { screenOf } from '../src/agent/fairplay/sight.js';
import { setSearchLook, lookBeforeSearch } from '../src/agent/library/search_look.js';

function looker({ narrow = true } = {}) {
    let t = 1_000_000;
    const now = () => t;
    const bot = new EventEmitter();
    const turns = [];
    Object.assign(bot, {
        entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0 },
        look: async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; turns.push(yaw); t += 300; },
    });
    const looks = watchLooks(bot, { getScreen: () => (narrow ? screenOf(bot.entity.yaw, bot.entity.pitch, 70) : null), now });
    return { bot, looks, turns, advance: ms => { t += ms; } };
}
const quick = { holdMs: 0 };

test('turning round takes a few looks, and then every way is fresh from here', async () => {
    const { bot, looks, turns } = looker();
    looks.note();
    assert.equal(looks.unseen().length, 5, 'facing north, three of eight headings are on screen');
    const n = await lookAround(bot, quick);
    assert.ok(n >= 2 && n <= 4, `${n} looks`);
    assert.equal(looks.unseen().length, 0);
    assert.equal(await lookAround(bot, quick), 0, 'nothing left to look at');
    assert.equal(turns.length, n);
});

test('a look counts from about where it was made, and for a while', async () => {
    const { bot, looks, advance } = looker();
    await lookAround(bot, quick);
    bot.entity.position = new Vec3(10.5, 64, 0.5);
    assert.ok(looks.unseen().length >= 5, 'ten blocks on, the ways behind are unseen again');
    bot.entity.position = new Vec3(0.5, 64, 0.5);
    assert.equal(looks.unseen().length, 0);
    advance(60_000);
    assert.ok(looks.unseen().length >= 5, 'a minute later, they are stale');
    const stalest = stalestHeading(bot);
    assert.ok(stalest && Number.isFinite(stalest.yaw));
});

test('seeing all around, there is nothing to turn for', async () => {
    const { bot, looks, turns } = looker({ narrow: false });
    assert.deepEqual(looks.unseen(), []);
    assert.equal(await lookAround(bot, quick), 0);
    assert.equal(await lookAroundCommand(bot), 'You see all around you already.');
    assert.deepEqual(turns, []);
});

test('a search looks round first when it found nothing, or only something far; not for a find at its feet', async () => {
    const { bot, turns } = looker();
    assert.equal(await lookBeforeSearching(bot, { x: 1, y: 64, z: 1 }), false, 'a find within a step or two');
    assert.equal(turns.length, 0);
    assert.equal(await lookBeforeSearching(bot, { x: 20, y: 64, z: 0 }), true, 'a far find: something nearer may be behind');
    const after = turns.length;
    assert.equal(await lookBeforeSearching(bot, null), false, 'already looked every way from here');
    assert.equal(turns.length, after);

    // Through the hook the skills call: nothing installed, nothing happens; installed, fair play's answer.
    const other = looker();
    assert.equal(await lookBeforeSearch(other.bot, null), false);
    setSearchLook(other.bot, lookBeforeSearching);
    assert.equal(await lookBeforeSearch(other.bot, null), true);
    setSearchLook(other.bot, null);
});

test('!lookAround looks every way afresh, even right after a look round', async () => {
    const { bot, turns } = looker();
    await lookAround(bot, quick);
    const before = turns.length;
    const said = await lookAroundCommand(bot);
    assert.match(said, /^Looked around \(\d looks\)/);
    assert.ok(turns.length > before);
});
