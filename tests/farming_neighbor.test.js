// SPDX-License-Identifier: CC0-1.0
// Farming and good-neighbor rules agreeing on crops: the field book frees the crops of fields the bot may tend,
// a round of tending frees its own field while it lasts, and everything else stays refused, with advice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileArea, createProtector } from '../src/agent/neighbor/protect.js';
import { guardBot } from '../src/agent/neighbor/enforce.js';
import { ME, SHARED, createFieldBook } from '../src/agent/farming/field_book.js';
import { CROP_HINT, cropPermits } from '../src/agent/farming/neighborly.js';
import { installFarming } from '../src/agent/farming/install.js';
import { fixtureWorld, stubBot } from './helpers/fixture_world.js';

// Three rows of farmland at y 0, wheat on each: x 0 is the bot's, x 2 is Alice's, x 4 nobody has said.
const crop = (x, z, name = 'wheat') => ({ name, position: { x, y: 1, z } });
const ground = (x, z) => ({ name: 'farmland', position: { x, y: 0, z } });
const row = x => [-1, 0, 1].map(z => ({ x, y: 0, z }));

function setup({ behind = {}, areas = [] } = {}) {
    const book = createFieldBook({ scope: 'test/overworld' });
    book.mark(row(0), { owner: ME });
    book.mark(row(2), { owner: 'Alice' });
    // Nothing is natural or seen built here: the names alone decide, and crops and farmland are made.
    const protector = createProtector({ read: () => null, areas });
    const permits = cropPermits({ book: () => book, behind: () => behind });
    protector.permit(permits.permit);
    return { book, protector, permits };
}

test('the crops of a field the bot may always tend are free; a stranger\'s stay refused, with advice', () => {
    const { book, protector } = setup();
    assert.equal(protector.refusal(crop(0, 0)), null, 'its own wheat');
    assert.equal(protector.refusal(crop(0, 1, 'carrots')), null, 'any crop of its own field');
    const alice = protector.refusal(crop(2, 0));
    assert.equal(alice?.hint, CROP_HINT, 'Alice\'s wheat is hers');
    assert.ok(protector.refusal(crop(4, 0))?.hint, 'nor wheat nobody has said anything about');
    book.mark(row(2), { owner: 'Alice', tending: 'always' });
    assert.equal(protector.refusal(crop(2, 0)), null, 'once Alice says it may always be tended');
    book.mark(row(4), { owner: SHARED });
    assert.equal(protector.refusal(crop(4, 0)), null, 'a shared field');
});

test('only the crop is freed, never the farmland, and a protected area still wins', () => {
    const area = compileArea({ name: 'the village', min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 4, z: 0 } });
    const { protector } = setup({ areas: [area] });
    assert.ok(protector.refusal(ground(0, 1)), 'the bot\'s own farmland is not freed by the field book');
    assert.equal(protector.refusal(ground(0, 1)).hint, undefined, 'and gets the usual words');
    assert.equal(protector.refusal(crop(0, 0)).why, 'area', 'its own wheat in a protected area');
    assert.equal(protector.refusal(crop(0, 1)), null, 'beside the area it is free');
});

test('the field\'s owner asking frees its crops; another player asking does not', () => {
    const asked = { asked: true, by: 'Bob' };
    const { protector } = setup({ behind: asked });
    assert.ok(protector.refusal(crop(2, 0)), 'Bob asking does not free Alice\'s wheat');
    assert.ok(protector.refusal(crop(4, 0)), 'nor wheat nobody has said anything about');
    asked.by = 'alice';
    assert.equal(protector.refusal(crop(2, 0)), null, 'Alice asking does, whatever her capitals');
});

test('a round of tending frees its own field until it ends, and rounds over the same cells count', () => {
    const { protector, permits } = setup();
    assert.ok(protector.refusal(crop(4, 0)));
    const first = permits.tending(row(4));
    const second = permits.tending(row(4).slice(0, 1));
    assert.equal(protector.refusal(crop(4, -1)), null);
    assert.equal(protector.refusal(crop(4, 0)), null);
    first();
    first();
    assert.ok(protector.refusal(crop(4, 0)), 'closed, and closing twice does nothing more');
    assert.equal(protector.refusal(crop(4, -1)), null, 'the other round still holds its cell');
    second();
    assert.ok(protector.refusal(crop(4, -1)));
});

test('a refused crop says how to tend a field instead; other refusals keep their words', async () => {
    const { protector } = setup();
    const bot = { dig: async () => 'dug' };
    const unguard = guardBot(bot, protector);
    try {
        await assert.rejects(bot.dig(crop(2, 0)), error => error.code === 'good_neighbor'
            && /Breaking wheat at 2, 1, 0 refused: .*!tendField harvests a field and replants it/.test(error.message));
        await assert.rejects(bot.dig(ground(2, 0)), /Leave other players' builds alone/);
        assert.equal(await bot.dig(crop(0, 0)), 'dug');
    } finally { unguard(); }
});

test('installed farming answers the good-neighbor protector of its bot, and stops answering when stopped', () => {
    const world = fixtureWorld({ min: [-4, -2, -4], max: [8, 4, 4] });
    const bot = stubBot(world);
    const protector = createProtector({ read: () => null });
    const unguard = guardBot(bot, protector);
    try {
        const agent = { name: 'Andy', bot, handleMessage: async () => {} };
        const bookDir = mkdtempSync(path.join(tmpdir(), 'farming-neighbor-'));
        const installed = installFarming(agent, { config: { farming: true, world_id: 'test' }, bookDir });
        assert.ok(protector.refusal(crop(0, 0)), 'a field nobody has said anything about');
        installed.book().mark(row(0), { owner: ME });
        assert.equal(protector.refusal(crop(0, 0)), null, 'its own, once the book says so');
        installed.stop();
        assert.ok(protector.refusal(crop(0, 0)), 'stopped, farming has no say');
    } finally { unguard(); }
});

test('a melon or pumpkin beside a stem is freed while the round that picks it holds its ground open', () => {
    const { protector, permits } = setup();
    const melon = { name: 'melon', position: { x: 9, y: 1, z: 9 } };
    assert.ok(protector.refusal(melon)?.hint, 'a melon on ground no round holds is refused, with advice');
    const close = permits.tending([{ x: 9, y: 0, z: 9 }]);
    assert.equal(protector.refusal(melon), null, 'the round picking it');
    assert.equal(protector.refusal({ name: 'pumpkin', position: { x: 9, y: 1, z: 9 } }), null);
    assert.ok(protector.refusal({ name: 'carved_pumpkin', position: { x: 9, y: 1, z: 9 } }), 'a carved pumpkin is never fruit');
    close();
    assert.ok(protector.refusal(melon), 'refused again once the round is over');
});
