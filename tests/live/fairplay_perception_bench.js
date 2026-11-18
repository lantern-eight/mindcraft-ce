// SPDX-License-Identifier: CC0-1.0
// Times fair-play perception on real terrain (no model calls, free to run).
//   node tests/live/fairplay_perception_bench.js            start a server, time, compare with the last release
//   node tests/live/fairplay_perception_bench.js --record   the same, then save the result for this release
//   node tests/live/fairplay_perception_bench.js --port=N   time against a server already running; no compare
//
// It is run once per release, for the "Release X" commit, not on every commit of a working branch.
//
// Why it starts its own server: timings mean something only next to timings taken on the same land. A world's
// terrain comes from its seed, and the same seed makes different land in different game versions, so the bench
// always makes a world from BENCH_SEED and keeps every result under its seed and game version. A new game
// version starts a new line of results; a new release on the same game version is compared with the last one.
//
// Results live in tests/live/perception_bench_results.json. Timings also depend on the computer they ran on,
// so compare releases measured on the same one; the mineflayer searches (the raw_ timings) are measured
// alongside as a yardstick for that. If they moved as much as the fair ones, the computer is the likely cause.
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { vanillaFixture, delay } from './vanilla_fixture.js';

// The world every recorded run is measured in. Changing it starts a new line of results, like a new game
// version does, so change it only when its land stops being a fair test (no trees or stone near spawn).
const BENCH_SEED = '8091';
// How far the server sends land. A server's default is 10; 8 gives a search of 64 blocks real ground to
// cover without making the world slow to make.
const VIEW_DISTANCE = 8;
// Each timing is taken this many times and the middle value kept, so one slow round (the first, while
// JavaScript is still compiling the code) doesn't decide the result.
const ROUNDS = Number(process.argv.find(a => a.startsWith('--rounds='))?.split('=')[1] || 5);
// A fair timing fails the bench when it is more than this many times its last recorded value, plus a few
// milliseconds: timings of a millisecond or two jump around by more than half from run to run on their own.
const TOLERANCE = 1.5;
const SLACK_MS = 3;
const RESULTS = path.resolve('tests/live/perception_bench_results.json');

const givenPort = process.argv.find(a => a.startsWith('--port='))?.split('=')[1];
const record = process.argv.includes('--record');
if (givenPort && record) throw new Error('--record needs the bench\'s own server (its seed is known); drop --port');

// Our own server, unless one was named: normal terrain from the bench seed, everyone spawning on the same
// spot (spawn radius 0) so every run looks at the same land.
const server = givenPort ? null : await vanillaFixture(55916, { properties: {
    'level-type': 'minecraft:normal', 'level-seed': BENCH_SEED,
    'view-distance': VIEW_DISTANCE, 'simulation-distance': 4,
} });
if (server) {
    // The rule was renamed in 1.21.11; one of these two is refused, which is fine.
    await server.command('gamerule respawn_radius 0');
    await server.command('gamerule spawnRadius 0');
}
const port = server ? server.port : Number(givenPort);

setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline' });
const { initBot } = await import('../../src/utils/mcdata.js');
const { createPerception } = await import('../../src/agent/fairplay/perception.js');
const { resolvePolicy } = await import('../../src/agent/fairplay/policy.js');
const { openMemory } = await import('../../src/agent/memory/store.js');
const { createRecorder } = await import('../../src/agent/memory/recorder.js');

const time = fn => { const t = performance.now(); const value = fn(); return [Math.round((performance.now() - t) * 10) / 10, value]; };
const bot = initBot('FairBench');
bot.on('error', error => console.error('Bot error:', error.message));
await once(bot, 'spawn');
await bot.waitForChunksToLoad();
await delay(4000);

const policy = resolvePolicy({ fair_play: 'strict' });
const id = name => bot.registry.blocksByName[name].id;
const everything = bot.registry.blocksArray.filter(b => b.name !== 'air').map(b => b.id);
const logs = bot.registry.blocksArray.filter(b => b.name.endsWith('_log')).map(b => b.id);

// Perception with world memory, as the shipped settings run it. Memory goes to a throwaway folder.
const withMemory = (scope, recorderOptions = {}) => {
    let recorder = null;
    const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'fair-bench-')), scope,
        canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory, ...recorderOptions });
    const eyes = createPerception({ bot, policy, memory: recorder.view, searchBudgetMs: Infinity });
    recorder.attach(eyes);
    return { recorder, eyes, memory };
};

// One round of every measurement, each with fresh perception and memory so nothing is answered from the
// round before. Returns the timings (ms) and how much each search found.
function measureOnce() {
    const timings = {}, found = {};
    let n;
    // World memory's look-around: once in a single go (how much work a whole look is), then in budgeted
    // slices (how many ticks a look takes, and the longest any one tick held up the bot).
    const whole = withMemory('bench', { tickBudgetMs: Infinity });
    [timings.passWhole] = time(() => whole.recorder.tick());
    const sliced = withMemory('bench2');
    let ticks = 0, longest = 0, total = 0;
    for (; ticks < 500; ticks++) {
        const [ms] = time(() => sliced.recorder.tick());
        longest = Math.max(longest, ms); total += ms;
        if (!sliced.recorder.busy) break; // the look is finished
    }
    timings.passSlicedLongestTick = longest;
    timings.passSlicedTotal = Math.round(total * 10) / 10;
    found.passSlicedTicks = ticks + 1;

    // Searches the way commands and skills make them, fair and raw side by side.
    const perception = whole.eyes;
    const both = (label, options) => {
        [timings[`raw_${label}`], n] = time(() => bot.findBlocks(options).length); found[`raw_${label}`] = n;
        [timings[`fair_${label}`], n] = time(() => perception.findBlocks(options).length); found[`fair_${label}`] = n;
        [timings[`fair_${label}_again`]] = time(() => perception.findBlocks(options).length); // sight answers cached
    };
    both('nearby8', { matching: everything, maxDistance: 8, count: 10000 });
    both('stone16_count1', { matching: id('stone'), maxDistance: 16, count: 1 });
    both('stone64_count128', { matching: id('stone'), maxDistance: 64, count: 128 });
    both('logs64_count128', { matching: logs, maxDistance: 64, count: 128 });
    both('diamond64', { matching: id('diamond_ore'), maxDistance: 64, count: 128 });
    both('sand512', { matching: id('sand'), maxDistance: 512, count: 1 });
    [timings.fairEntities, n] = time(() => perception.entities().length); found.fairEntities = n;
    for (const each of [whole, sliced]) { each.recorder.stop(); each.eyes.stop(); }
    return { timings, found };
}

const middle = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const rounds = Array.from({ length: ROUNDS }, measureOnce);
const pick = key => Object.fromEntries(Object.keys(rounds[0][key]).map(k => [k, middle(rounds.map(r => r[key][k]))]));
const result = {
    release: JSON.parse(readFileSync('package.json', 'utf8')).version,
    date: new Date().toISOString().slice(0, 10),
    game_version: GAME_VERSION,
    seed: server ? BENCH_SEED : null,
    view_distance: server ? VIEW_DISTANCE : null,
    rounds: ROUNDS,
    spawn: bot.entity.position.floored().toString(),
    timings: pick('timings'),
    found: pick('found'),
};
bot.quit();
if (server) await server.stop();
console.log(JSON.stringify(result, null, 1));

// Compare with the last result recorded on the same land (same seed, same game version) by another release.
let failed = false;
const saved = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : { runs: [] };
if (server) {
    const sameLand = saved.runs.filter(r => r.seed === result.seed && r.game_version === result.game_version && r.release !== result.release);
    const before = sameLand.at(-1);
    if (!before) {
        console.log(`\nNo result recorded yet for seed ${result.seed} on ${result.game_version}; nothing to compare with.`);
    } else {
        console.log(`\nAgainst ${before.release} (${before.date}), seed ${before.seed} on ${before.game_version}:`);
        if (before.spawn !== result.spawn) console.log(`  note: spawned at ${result.spawn}, it spawned at ${before.spawn}`);
        for (const [key, now] of Object.entries(result.timings)) {
            const then = before.timings[key];
            if (then === undefined) { console.log(`  ${key}: ${now} ms (new)`); continue; }
            // Only this fork's own work can fail the bench; mineflayer's raw searches are the yardstick.
            const limit = Math.round((then * TOLERANCE + SLACK_MS) * 10) / 10;
            const over = !key.startsWith('raw_') && now > limit;
            failed ||= over;
            console.log(`  ${over ? 'SLOWER' : 'ok    '} ${key}: ${now} ms, was ${then}${key.startsWith('raw_') ? ' (yardstick)' : `, limit ${limit}`}`);
        }
        for (const [key, now] of Object.entries(result.found)) {
            if (key === 'fairEntities') continue; // mobs wander in and out of sight between runs
            if (before.found[key] !== undefined && before.found[key] !== now) console.log(`  note: ${key} found ${now}, was ${before.found[key]}`);
        }
    }
}

if (record) {
    // One result per release on each land: running it again for the same release replaces the old one.
    saved.runs = saved.runs.filter(r => !(r.release === result.release && r.seed === result.seed && r.game_version === result.game_version));
    saved.runs.push(result);
    writeFileSync(RESULTS, JSON.stringify(saved, null, 2) + '\n');
    console.log(`\nRecorded for ${result.release} in ${path.relative(process.cwd(), RESULTS)}.`);
}
if (failed) console.log(`\nA fair timing is more than ${TOLERANCE}× its last result plus ${SLACK_MS} ms.`);
setTimeout(() => process.exit(failed ? 1 : 0), 500);
