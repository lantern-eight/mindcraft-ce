// SPDX-License-Identifier: CC0-1.0
// Jobs: what the bot left smelting where, kept per world, and how it tells its own furnace from one in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJobs, holdsOnly, leftToLoad, loadJobs, stillInFurnace } from '../src/agent/smelting/jobs.js';
import { installSmelting } from '../src/agent/smelting/install.js';
import { scopeDir } from '../src/agent/memory/files.js';
import { existsSync } from 'node:fs';

const SCOPE = 'world/overworld';

test('a job counts what went in and what came out, and its fuel', () => {
    let t = 1000;
    const jobs = createJobs({ scope: SCOPE, now: () => t });
    jobs.start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 100 });
    jobs.note({ x: 3.6, y: 64.2, z: 0.9 }, { loaded: 64, fuelPut: { coal: 8 }, readyAt: 641000 });
    t = 2000;
    const job = jobs.note({ x: 3, y: 64, z: 0 }, { collected: 20, fuelPut: { coal: -3 } });
    assert.equal(job.loaded, 64);
    assert.equal(job.collected, 20);
    assert.deepEqual(job.fuelPut, { coal: 5 });
    assert.equal(job.seenAt, 2000);
    assert.equal(stillInFurnace(job), 44);
    assert.equal(leftToLoad(job), 36);
    assert.equal(jobs.note({ x: 9, y: 9, z: 9 }, { loaded: 1 }), null, 'no job there');
    jobs.note({ x: 3, y: 64, z: 0 }, { fuelPut: { coal: -5 } });
    assert.deepEqual(jobs.at({ x: 3, y: 64, z: 0 }).fuelPut, {}, 'fuel all taken back is gone from the job');
});

test('asked again for the same item, the job at that furnace is taken up, not started over', () => {
    const jobs = createJobs({ scope: SCOPE });
    const at = { x: 0, y: 64, z: 0 };
    jobs.start(at, { input: 'sand', product: 'glass', total: 16 });
    jobs.note(at, { loaded: 16 });
    jobs.note(at, { collected: 10 });
    // 6 of its own still in there; it now wants 20 more from this furnace, counting those 6.
    const job = jobs.start(at, { input: 'sand', product: 'glass', total: 20 });
    assert.equal(job.total, 30);
    assert.equal(leftToLoad(job), 14);
    // Asked for fewer than are in there already, it still means to collect those.
    assert.equal(jobs.start(at, { input: 'sand', product: 'glass', total: 2 }).total, 16);
    // Another item in the same furnace starts a new job in its place.
    assert.equal(jobs.start(at, { input: 'raw_iron', product: 'iron_ingot', total: 3 }).loaded, 0);
});

test('a furnace holding only what the bot put in is its own; anything more or else is not', () => {
    const job = { input: 'sand', product: 'glass', loaded: 16, collected: 4 };
    assert.equal(holdsOnly(job, { input: { name: 'sand', count: 5 }, output: { name: 'glass', count: 7 } }), true);
    assert.equal(holdsOnly(job, { input: null, output: null }), true, 'emptied by someone: still nothing of anyone else');
    assert.equal(holdsOnly(job, { input: { name: 'sand', count: 13 }, output: null }), false, 'more sand than it put in');
    assert.equal(holdsOnly(job, { input: { name: 'red_sand', count: 1 }, output: null }), false);
    assert.equal(holdsOnly(job, { input: null, output: { name: 'iron_ingot', count: 1 } }), false);
    assert.equal(holdsOnly(null, { input: null, output: null }), false, 'no job, not its own');
});

test('jobs are listed nearest first, or soonest ready', () => {
    const jobs = createJobs({ scope: SCOPE });
    jobs.start({ x: 30, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 8 });
    jobs.note({ x: 30, y: 64, z: 0 }, { readyAt: 500 });
    jobs.start({ x: 5, y: 64, z: 0 }, { input: 'raw_iron', product: 'iron_ingot', total: 8 });
    jobs.note({ x: 5, y: 64, z: 0 }, { readyAt: 900 });
    assert.deepEqual(jobs.list({ from: { x: 0, y: 64, z: 0 } }).map(j => j.x), [5, 30]);
    assert.deepEqual(jobs.list().map(j => j.x), [30, 5]);
    assert.deepEqual(jobs.list({ from: { x: 0, y: 64, z: 0 }, maxDistance: 10 }).map(j => j.x), [5]);
    assert.deepEqual(jobs.list({ input: 'sand' }).map(j => j.x), [30]);
    jobs.end({ x: 30, y: 64, z: 0 });
    assert.equal(jobs.list().length, 1);
});

test('the ready reminder is said once, and again only after the job changes', () => {
    const jobs = createJobs({ scope: SCOPE });
    const at = { x: 0, y: 64, z: 0 };
    jobs.start(at, { input: 'sand', product: 'glass', total: 8 });
    jobs.note(at, { loaded: 8, readyAt: 100 });
    jobs.toldReady(at);
    assert.equal(jobs.at(at).toldReady, true);
    jobs.note(at, { readyAt: 200 });
    assert.equal(jobs.at(at).toldReady, false);
});

test('jobs are saved per world and loaded back; a file for another world is set aside', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'smelting-jobs-'));
    const jobs = createJobs({ scope: SCOPE });
    jobs.start({ x: 1, y: 2, z: 3 }, { input: 'sand', product: 'glass', total: 8, placed: true });
    jobs.note({ x: 1, y: 2, z: 3 }, { loaded: 8, fuelPut: { coal: 1 }, readyAt: 80000 });
    assert.equal(jobs.dirty, true);
    jobs.save(dir);
    assert.equal(jobs.dirty, false);
    const back = loadJobs(dir, { scope: SCOPE });
    assert.deepEqual(back.at({ x: 1, y: 2, z: 3 }), jobs.at({ x: 1, y: 2, z: 3 }));
    const warned = [];
    assert.equal(loadJobs(dir, { scope: 'other/overworld', warn: text => warned.push(text) }).list().length, 0);
    assert.equal(warned.length, 1);
    writeFileSync(path.join(dir, 'smelting_jobs.json'), '{ not json');
    assert.equal(loadJobs(dir, { scope: SCOPE, warn: () => {} }).list().length, 0, 'a damaged file costs the jobs, not the bot');
});

test('installed, it adds its commands, and a furnace that should be done is said once on the next result', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'smelting-install-'));
    const bot = { game: { dimension: 'overworld' }, worldIdentity: 'seed2', entity: { position: { x: 0, y: 64, z: 0 } } };
    const agent = { name: 'Smelter', bot, actions: { runAction: async () => ({ status: 'ok', text: 'Done.', message: 'Done.' }) } };
    const way = installSmelting(agent, { config: { smelting: true }, jobsDir: dir });
    assert.deepEqual(way.commands, ['!loadFurnace', '!collectFurnace', '!furnaces']);
    const { commandExists } = await import('../src/agent/commands/index.js');
    assert.ok(commandExists('!loadFurnace') && commandExists('!collectFurnace') && commandExists('!furnaces'));

    way.jobs().start({ x: 3, y: 64, z: 0 }, { input: 'sand', product: 'glass', total: 4 });
    way.jobs().note({ x: 3, y: 64, z: 0 }, { loaded: 4, readyAt: Date.now() - 1000 });
    const first = await agent.actions.runAction('action:test', async () => {});
    assert.equal(first.message, 'Done.\nThe glass in the furnace at 3, 64, 0 should be done (!collectFurnace).');
    const second = await agent.actions.runAction('action:test', async () => {});
    assert.equal(second.message, 'Done.', 'said once');
    assert.ok(existsSync(scopeDir(dir, 'world:seed2/overworld')), 'and that it was said is kept');
});

test('installed for a bot, the jobs are kept per world and dimension, under the folder given', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'smelting-install-'));
    const bot = { game: { dimension: 'overworld' }, worldIdentity: 'seed1' };
    const way = installSmelting({ name: 'Smelter', bot }, { config: { smelting: true }, jobsDir: dir });
    const book = way.jobs();
    assert.equal(book.scope, 'world:seed1/overworld');
    assert.equal(way.jobs(), book, 'the same store while the bot stays in that world');
    bot.game.dimension = 'the_nether';
    assert.notEqual(way.jobs(), book, 'the Nether has its own');
    assert.equal(installSmelting({ name: 'Smelter', bot }, { config: { smelting: false }, jobsDir: dir }), null);
    assert.equal(existsSync(scopeDir(dir, 'world:seed1/overworld')), false, 'nothing written until a job is');
});
