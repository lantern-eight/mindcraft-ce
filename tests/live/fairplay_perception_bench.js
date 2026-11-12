// Times fair-play perception on real terrain (no model calls, free to run).
//   node tests/live/fairplay_perception_bench.js [--port=55916]
// Needs a server that is already running in offline mode on 127.0.0.1, with natural terrain around
// spawn. Prints one JSON object of timings in milliseconds.
import { once } from 'node:events';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55916);
setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline' });
const { initBot } = await import('../../src/utils/mcdata.js');
const { createPerception } = await import('../../src/agent/fairplay/perception.js');
const { createSeenMap } = await import('../../src/agent/fairplay/seen_map.js');
const { resolvePolicy } = await import('../../src/agent/fairplay/policy.js');

const time = fn => { const t = performance.now(); const value = fn(); return [Math.round((performance.now() - t) * 10) / 10, value]; };
const bot = initBot('FairBench');
bot.on('error', error => console.error('Bot error:', error.message));
await once(bot, 'spawn');
await bot.waitForChunksToLoad();
await new Promise(resolve => setTimeout(resolve, 4000));

const out = { position: bot.entity.position.floored().toString(), entities: Object.keys(bot.entities).length };
const policy = resolvePolicy({ fair_play: 'strict' });
const seenMap = createSeenMap({ scope: 'bench' });
const id = name => bot.registry.blocksByName[name].id;
const everything = bot.registry.blocksArray.filter(b => b.name !== 'air').map(b => b.id);
const logs = bot.registry.blocksArray.filter(b => b.name.endsWith('_log')).map(b => b.id);

// The background pass: once in a single go (how much work a whole pass is), then in budgeted slices
// (how many ticks a pass takes, and the longest any one tick held up the bot).
const whole = createPerception({ bot, policy, seenMap, tickBudgetMs: Infinity, searchBudgetMs: Infinity });
let n;
[out.passWhole] = time(() => whole.tick());
out.rememberedAfterPass = seenMap.size;
const sliced = createPerception({ bot, policy, seenMap: createSeenMap({ scope: 'bench2' }) });
let ticks = 0, longest = 0, total = 0;
for (; ticks < 500; ticks++) {
    const [ms] = time(() => sliced.tick());
    longest = Math.max(longest, ms); total += ms;
    if (ms < 0.05 && ticks > 0) break; // an idle tick: the pass is finished
}
out.passSliced = { ticks, longestTickMs: longest, totalMs: Math.round(total * 10) / 10 };

// Searches the way commands and skills make them, fair and raw side by side.
const perception = whole;
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
whole.stop(); sliced.stop();

console.log(JSON.stringify(out, null, 1));
bot.quit();
setTimeout(() => process.exit(0), 500);
