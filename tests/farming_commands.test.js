// SPDX-License-Identifier: CC0-1.0
// Farming against a small hand-built world: what the field search is told under fair play (a crop's
// ripeness only when it is in view), the field commands and what they say, and the `farming` setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import settings from '../settings.js';
import { getCommand, getCommands, parseCommandMessage } from '../src/agent/commands/index.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { fairQueries, registerFairPlay, unregisterFairPlay } from '../src/agent/fairplay/fair_queries.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { markField, nearestField, readOwner, readTending } from '../src/agent/farming/commands.js';
import { findField } from '../src/agent/farming/field.js';
import { ME, SHARED, createFieldBook } from '../src/agent/farming/field_book.js';
import { installFarming } from '../src/agent/farming/install.js';
import { blockReader, fieldMovements, ownerText } from '../src/agent/farming/tend.js';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';

const STRICT = resolvePolicy({ fair_play: 'strict' });

// Flat grass at y 0. A field of farmland from x 2 to 6, z -2 to 2, with water in the middle; ripe wheat
// on the near half, young wheat on the far half. A wall of stone stands at x 8 (three high), and farmland
// with ripe carrots lies behind it, which the bot at the origin cannot see.
function farm() {
    const w = fixtureWorld({ min: [-16, -4, -16], max: [16, 8, 16] });
    w.fill('dirt', [-16, -3, -16], [16, -1, 16]);
    w.fill('grass_block', [-16, 0, -16], [16, 0, 16]);
    w.fill('farmland', [2, 0, -2], [6, 0, 2]);
    w.set('water', 4, 0, 0);
    for (let x = 2; x <= 6; x++) {
        for (let z = -2; z <= 2; z++) {
            if (x === 4 && z === 0) continue;
            w.set('wheat', x, 1, z, { age: x <= 3 ? 7 : 2 });
        }
    }
    w.fill('stone', [8, 1, -4], [8, 3, 4]);
    w.fill('farmland', [9, 0, -2], [10, 0, 2]);
    for (let z = -2; z <= 2; z++) w.set('carrots', 9, 1, z, { age: 7 });
    return w;
}

function fair(w, options = {}) {
    const bot = stubBot(w, { position: [0.5, 1, 0.5], yaw: -Math.PI / 2, pitch: -0.4, ...options });
    const perception = createPerception({ bot, policy: STRICT, getStateId: w.getStateId, ...NO_BUDGETS });
    registerFairPlay(bot, { perception, policy: STRICT });
    setWorldQueries(fairQueries);
    return { bot, done: () => { setWorldQueries(null); unregisterFairPlay(bot); } };
}

test('under fair play the field is what the bot sees, and a crop is ripe or not only when seen', () => {
    const w = farm();
    const { bot, done } = fair(w);
    try {
        const read = blockReader(bot);
        assert.deepEqual({ name: read(2, 1, 0).name, ripe: read(2, 1, 0).ripe }, { name: 'wheat', ripe: true });
        assert.equal(read(5, 1, 0).ripe, false);
        assert.equal(read(9, 1, 0), null, 'the carrots behind the wall are unknown, not "not there"');
        const field = findField(read, { x: 2, y: 0, z: 0 });
        assert.equal(field.cells.length, 24);
        assert.ok(!field.cells.some(c => c.x >= 8), 'the farmland behind the wall is not part of what the bot knows');
        assert.equal(field.cells.filter(c => c.ripe === true).length, 10);
        assert.equal(nearestField(bot).cells.length, 24);
    } finally { done(); }
});

test('the field\'s walking rules forbid landing on its farmland and stepping into its water', () => {
    const w = farm();
    const { bot, done } = fair(w);
    try {
        bot.pathfinder = { bestHarvestTool: () => null };
        const field = findField(blockReader(bot), { x: 2, y: 0, z: 0 });
        const m = fieldMovements(bot, field);
        assert.equal(m.canDig, false);
        assert.equal(m.allowParkour, false);
        assert.deepEqual(m.scafoldingBlocks, []);
        assert.equal(m.exclusionStep({ position: { x: 3, y: 3, z: 0 } }), 100, 'a jump from the farmland');
        assert.equal(m.exclusionStep({ position: { x: 4, y: 0, z: 0 } }), 100, 'the water');
        assert.equal(m.exclusionStep({ position: { x: 3, y: 1, z: 0 } }), 0, 'walking among the wheat');
    } finally { done(); }
});

test('owners and permissions are read as the model gives them, without guessing who "me" is', () => {
    assert.deepEqual(readOwner('Andy', { name: 'Andy' }), { owner: ME });
    assert.deepEqual(readOwner('"shared"', { name: 'Andy' }), { owner: SHARED });
    assert.deepEqual(readOwner('alice', { players: ['Alice'] }), { owner: 'Alice' }, 'spelled as the player list has it');
    assert.deepEqual(readOwner('unknown'), { owner: null });
    assert.match(readOwner('mine', { name: 'Andy' }).error, /could be you or the player/);
    assert.deepEqual(readTending('always'), { tending: 'always' });
    assert.deepEqual(readTending('when asked'), { tending: 'asked' });
    assert.deepEqual(readTending('same'), { same: true });
    assert.match(readTending('never').error, /"always" or "asked"/);
    assert.equal(ownerText(null, 'Andy'), 'nobody has said whose it is');
    assert.equal(ownerText('andy', 'Andy'), 'it is yours');
    assert.equal(ownerText('Alice', 'Andy'), 'it is Alice\'s');
});

test('!markField says whose the field in view is, and the book keeps it for every cell of it', () => {
    const w = farm();
    const { bot, done } = fair(w);
    try {
        const book = createFieldBook({ scope: 's' });
        const said = markField(bot, 'Alice', 'always', { book, name: 'Andy', players: ['Alice'] });
        assert.equal(said.status, 'ok');
        assert.equal(said.text, 'The field of 24 farmland at 2, 0, -2: it is Alice\'s; you may tend it whenever you like.');
        const field = nearestField(bot);
        assert.deepEqual(book.whose(field.cells), { owner: 'Alice', tending: 'always', known: 24, mixed: false });
        assert.match(markField(bot, 'Zed', 'same', { book, name: 'Andy', players: ['Alice'] }).text, /Zed's; you tend it only when a player asks\. \(Zed is not a player you have met/);
        assert.equal(markField(bot, 'same', 'same', { book }).status, 'failed');
        assert.equal(markField(bot, 'unknown', 'always', { book }).status, 'failed', 'no owner, no permission');
    } finally { done(); }
    const empty = fixtureWorld({ min: [-4, -4, -4], max: [4, 4, 4] });
    empty.fill('stone', [-4, -2, -4], [4, 0, 4]);
    const lone = fair(empty);
    try {
        assert.match(markField(lone.bot, 'Alice', 'same', { book: createFieldBook({ scope: 's' }) }).text, /no farmland within 32 blocks/);
    } finally { lone.done(); }
});

test('the setting adds the field commands, and MindServer knows it with the same default', () => {
    const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));
    assert.equal(spec.farming.default, settings.farming);
    assert.equal(settings.farming, true);

    const bot = stubBot(farm());
    const agent = { name: 'Andy', bot, handleMessage: async () => {} };
    assert.equal(installFarming(agent, { config: { farming: false } }), null);
    assert.equal(installFarming(agent, { config: {} }), null, 'a config that leaves the key out gets nothing new');
    const bookDir = mkdtempSync(path.join(tmpdir(), 'farming-install-'));
    const installed = installFarming(agent, { config: { farming: true, world_id: 'test' }, bookDir });
    assert.deepEqual(installed.commands, ['!tendField', '!sowField', '!markField']);
    for (const name of installed.commands) assert.ok(getCommands().includes(getCommand(name)), name);
    assert.deepEqual(parseCommandMessage('!tendField("wheat_seeds")'), { commandName: '!tendField', args: ['wheat_seeds'] });
    assert.deepEqual(parseCommandMessage('!markField("Alice", "always")'), { commandName: '!markField', args: ['Alice', 'always'] });
    // What the bot is told is kept between runs, in its world's own book.
    const book = installed.book();
    book.mark([{ x: 2, y: 0, z: 0 }], { owner: 'Alice' });
    installed.save();
    const again = installFarming({ name: 'Andy', bot, handleMessage: async () => {} }, { config: { farming: true, world_id: 'test' }, bookDir });
    assert.equal(again.book().whose([{ x: 2, y: 0, z: 0 }]).owner, 'Alice');
});
