// Live smoke test for fair-play perception against a real server (no model calls, free to run).
//   source <planning folder>/scripts/env.sh && node tests/live/fairplay_perception_smoke.js
//
// The unit tests prove the geometry on hand-built worlds. This checks the parts only a real server can:
// reading block states from real chunk columns, entity data and sounds from real packets, and how long a
// perception pass takes. The throwaway server has anti-xray off, so the raw bot *can* see the buried
// ore and the sealed chest; the test passes only if perception hides them anyway.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55918);
const results = [];
const step = async (name, fn) => {
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline' });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { createPerception } = await import('../../src/agent/fairplay/perception.js');
    const { createSeenMap } = await import('../../src/agent/fairplay/seen_map.js');
    const { resolvePolicy } = await import('../../src/agent/fairplay/policy.js');
    const { fairQueries, registerFairPlay } = await import('../../src/agent/fairplay/fair_queries.js');
    const { setWorldQueries } = await import('../../src/agent/library/world_queries.js');
    const world = await import('../../src/agent/library/world.js');

    bot = initBot('FairSmoke');
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The scene, built by the server console (the director), on a stone platform in the air.
    await cmd('fill -14 69 -14 14 69 14 stone');
    await cmd('fill -14 70 -14 14 82 14 air');
    await cmd('fill 4 70 -2 8 74 2 stone');          // a solid lump east of the bot...
    await cmd('setblock 6 72 0 diamond_ore');        // ...with a diamond buried inside
    await cmd('setblock -6 70 0 diamond_ore');       // a diamond in the open, west
    await cmd('fill -2 70 6 2 74 10 stone');         // a sealed room, south...
    await cmd('fill -1 71 7 1 73 9 air');
    await cmd('setblock 0 71 8 chest');              // ...with a chest inside
    await cmd('fill -3 70 -7 3 75 -7 stone');        // a wall, north...
    await cmd('summon cow 0 70 -10 {NoAI:1b}');      // ...with a cow behind it
    await cmd('summon cow -9 70 -4 {NoAI:1b}');      // a cow in the open
    await cmd('tp FairSmoke 0.5 70 0.5 0 0');
    await delay(2500);

    const policy = resolvePolicy({ fair_play: 'strict' });
    const seenMap = createSeenMap({ scope: 'smoke' });
    const perception = createPerception({ bot, policy, seenMap, tickBudgetMs: Infinity, searchBudgetMs: Infinity });
    const ore = bot.registry.blocksByName.diamond_ore.id;
    const chest = bot.registry.blocksByName.chest.id;

    await step('the raw bot can see everything (anti-xray is off here)', () => {
        const raw = bot.findBlocks({ matching: [ore, chest], maxDistance: 32, count: 10 });
        assert.equal(raw.length, 3, `raw found ${raw.length}`);
    });

    await step('buried diamond and sealed chest are hidden; the diamond in the open is known', () => {
        assert.equal(perception.blockAt(new Vec3(6, 72, 0)), null);
        assert.equal(perception.blockAt(new Vec3(0, 71, 8)), null);
        assert.equal(perception.blockAt(new Vec3(-6, 70, 0))?.name, 'diamond_ore');
        const found = perception.findBlocks({ matching: [ore, chest], maxDistance: 32, count: 10 });
        assert.deepEqual(found.map(p => [p.x, p.y, p.z]), [[-6, 70, 0]]);
    });

    await step('the cow behind the wall is not perceived; the one in the open is', () => {
        const cows = perception.entities().filter(e => e.name === 'cow');
        assert.equal(cows.length, 1, `perceived ${cows.length} cows`);
        assert.ok(cows[0].position.x < -5);
    });

    await step('world.js answers fairly once the provider is installed', () => {
        registerFairPlay(bot, { perception, policy });
        setWorldQueries(fairQueries);
        const diamonds = world.getNearestBlocksWhere(bot, b => b.name === 'diamond_ore', 32, 10);
        assert.deepEqual(diamonds.map(b => b.position.x), [-6]);
        assert.equal(world.getNearbyEntities(bot, 32).filter(e => e.name === 'cow').length, 1);
        setWorldQueries(null);
    });

    await step('timing: background pass and a !nearbyBlocks-sized query', () => {
        let t = performance.now();
        perception.tick();
        const tickMs = performance.now() - t;
        const everything = bot.registry.blocksArray.filter(b => b.name !== 'air').map(b => b.id);
        t = performance.now();
        const near = perception.findBlocks({ matching: everything, maxDistance: 8, count: 10000 });
        const nearbyMs = performance.now() - t;
        assert.ok(seenMap.count('diamond_ore') === 1, 'the pass remembered the visible diamond only');
        return { tickMs: Math.round(tickMs), nearbyBlocksMs: Math.round(nearbyMs), nearbyKnown: near.length };
    });

    await step('the cow behind the wall is heard, by name and direction, though it is not seen', async () => {
        perception.start(); // listens to the server's sound packets
        await cmd('damage @e[type=cow,x=0,y=70,z=-10,distance=..3,limit=1] 1'); // it cries out
        await delay(1500);
        const heard = perception.heard();
        perception.stop();
        assert.ok(heard.some(h => h.subject === 'cow' && h.direction === 'north'), `heard ${JSON.stringify(heard)}`);
        assert.equal(perception.entities().filter(e => e.name === 'cow').length, 1, 'still only the cow in the open is seen');
        return { heard: heard.map(h => `${h.subject} (${h.text})`) };
    });

    console.log(JSON.stringify({ status: 'passed', steps: results.length }));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, passedSteps: results.length }));
    process.exitCode = 1;
} finally {
    bot?.quit();
    await server.stop();
}
