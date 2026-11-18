// SPDX-License-Identifier: CC0-1.0
// Times fair-play perception on real terrain (no model calls, free to run).
//   node tests/live/fairplay_perception_bench.js [--port=55916]
// Needs a server that is already running in offline mode on 127.0.0.1, with natural terrain around
// spawn. Prints one JSON object of timings in milliseconds.
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { GAME_VERSION } from '../helpers/game_version.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55916);
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
await new Promise(resolve => setTimeout(resolve, 4000));

const out = { position: bot.entity.position.floored().toString(), entities: Object.keys(bot.entities).length };
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

// World memory's look-around: once in a single go (how much work a whole look is), then in budgeted
// slices (how many ticks a look takes, and the longest any one tick held up the bot).
const whole = withMemory('bench', { tickBudgetMs: Infinity });
let n;
[out.passWhole] = time(() => whole.recorder.tick());
const sliced = withMemory('bench2');
let ticks = 0, longest = 0, total = 0;
for (; ticks < 500; ticks++) {
    const [ms] = time(() => sliced.recorder.tick());
    longest = Math.max(longest, ms); total += ms;
    if (!sliced.recorder.busy) break; // the look is finished
}
out.passSliced = { ticks: ticks + 1, longestTickMs: longest, totalMs: Math.round(total * 10) / 10 };

// Searches the way commands and skills make them, fair and raw side by side.
const perception = whole.eyes;
const both = (label, options) => {
    [out[`raw_${label}`], n] = time(() => bot.findBlocks(options).length); out[`raw_${label}_found`] = n;
    [out[`fair_${label}`], n] = time(() => perception.findBlocks(options).length); out[`fair_${label}_found`] = n;
    [out[`fair_${label}_again`]] = time(() => perception.findBlocks(options).length); // sight answers cached
};
both('nearby8', { matching: everything, maxDistance: 8, count: 10000 });
both('stone16_count1', { matching: id('stone'), maxDistance: 16, count: 1 });
both('stone64_count128', { matching: id('stone'), maxDistance: 64, count: 128 });
both('logs64_count128', { matching: logs, maxDistance: 64, count: 128 });
both('diamond64', { matching: id('diamond_ore'), maxDistance: 64, count: 128 });
both('sand512', { matching: id('sand'), maxDistance: 512, count: 1 });
[out.fairEntities, n] = time(() => perception.entities().length); out.fairEntities_found = n;
for (const each of [whole, sliced]) { each.recorder.stop(); each.eyes.stop(); }

console.log(JSON.stringify(out, null, 1));
bot.quit();
setTimeout(() => process.exit(0), 500);
