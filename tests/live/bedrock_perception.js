// SPDX-License-Identifier: CC0-1.0
// Live check of fair-play perception on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_perception.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of fairplay_perception_smoke.js. The unit tests check sight on Bedrock game data and
// chunks built by hand; this checks it on the chunks a real server sends, which leaves out every section
// that is all air, and on the entities it sends. A Bedrock server sends every block it has loaded, buried
// or not, so the raw bot can see the buried ore and the sealed chest; the test passes only if perception
// hides them anyway.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay } from './bedrock_fixture.js';

const NAME = 'BedrockSight';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scene is built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);

// The scene stands on a stone platform high above the ground, so nothing already in the world is in it.
// Everything is placed relative to the middle of the platform.
const PLATFORM = [-14, 0, -14], PLATFORM_END = [14, 0, 14];

async function buildScene() {
    await fill([-14, 1, -14], [14, 13, 14], 'air');
    await fill([-14, -3, -14], [14, -1, 14], 'dirt');    // three layers of dirt under the platform...
    await fill(PLATFORM, PLATFORM_END, 'stone');         // ...covered by it, as a flat world's floor covers its dirt
    await fill([4, 1, -2], [8, 5, 2], 'stone');          // a solid lump east of the bot...
    await set([6, 3, 0], 'diamond_ore');                 // ...with a diamond buried inside
    await set([-6, 1, 0], 'diamond_ore');                // a diamond in the open, west
    await fill([-2, 1, 6], [2, 5, 10], 'stone');         // a sealed room, south...
    await fill([-1, 2, 7], [1, 4, 9], 'air');
    await set([0, 2, 8], 'chest');                       // ...with a chest inside
    await fill([-1, 1, -11], [1, 4, -9], 'stone');       // a sealed pen north, for a cow nobody can see...
    await fill([0, 2, -10], [0, 3, -10], 'air');
    await fill([-10, 1, -5], [-8, 4, -3], 'glass');      // ...and a glass one west, for a cow in plain view
    await fill([-9, 2, -4], [-9, 3, -4], 'air');
    await summonCow(at(0, 2, -10));
    await summonCow(at(-9, 2, -4));
}

// In the middle of the cell, so the cow fits its pen.
const summonCow = cell => cmd(`summon cow ${cell.x + 0.5} ${cell.y} ${cell.z + 0.5}`, 800);

// Nothing safe to send on the console names one animal (selectors need brackets), so the cows are walled in
// where they stand and left to suffocate, with mob loot off so they leave nothing behind.
async function tearDown() {
    await cmd('gamerule domobloot false');
    await fill([0, 2, -10], [0, 3, -10], 'stone');
    await fill([-9, 2, -4], [-9, 3, -4], 'stone');
    await delay(8000);
    await fill([-14, -3, -14], [14, 13, 14], 'air');
    await cmd('gamerule domobloot true');
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), fair_play: 'strict' });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { createPerception } = await import('../../src/agent/fairplay/perception.js');
    const { createSeenMap } = await import('../../src/agent/fairplay/seen_map.js');
    const { resolvePolicy } = await import('../../src/agent/fairplay/policy.js');
    const { fairQueries, registerFairPlay } = await import('../../src/agent/fairplay/fair_queries.js');
    const { setWorldQueries } = await import('../../src/agent/library/world_queries.js');
    const world = await import('../../src/agent/library/world.js');
    const { watchPermissions } = await import('../../src/agent/fairplay/install.js');

    await step('the bot joins, and the scene is built', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        const ground = bot.entity.position.floored();
        origin = ground.offset(0, 40, 0); // the platform's middle
        await cmd('gamerule domobspawning false');
        await buildScene(); // straight above the bot, in chunks it already has
        await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y + 1} ${origin.z + 0.5}`, 2500);
        assert.equal(bot.blockAt(at(0, 0, 0))?.name, 'stone', 'the bot stands on the platform');
        // World memory keeps its files per world, by this name.
        assert.match(String(bot.worldIdentity), /^[0-9a-f]{16}$/, `world name ${bot.worldIdentity}`);
    });

    const policy = resolvePolicy({ fair_play: 'strict' });
    const seenMap = createSeenMap({ scope: 'bedrock-sight' });
    const perception = createPerception({ bot, policy, seenMap, tickBudgetMs: Infinity, searchBudgetMs: Infinity });
    const id = name => bot.registry.blocksByName[name].id;
    const coords = list => list.map(p => [p.x - origin.x, p.y - origin.y, p.z - origin.z]);

    await step('the raw bot is sent everything: both diamonds, the chest and the dirt', () => {
        const raw = bot.findBlocks({ matching: [id('diamond_ore'), id('chest')], maxDistance: 32, count: 10 });
        assert.equal(raw.length, 3, `raw found ${raw.length}`);
        assert.equal(bot.blockAt(at(0, -1, 0))?.name, 'dirt');
    });

    await step('the buried diamond and the sealed chest are hidden; the diamond in the open is known', () => {
        assert.equal(perception.blockAt(at(6, 3, 0)), null);
        assert.equal(perception.blockAt(at(0, 2, 8)), null);
        assert.equal(perception.blockAt(at(-6, 1, 0))?.name, 'diamond_ore');
        const found = perception.findBlocks({ matching: [id('diamond_ore'), id('chest')], maxDistance: 32, count: 10 });
        assert.deepEqual(coords(found), [[-6, 1, 0]]);
    });

    await step('the floor is known and the dirt under it is not', () => {
        assert.equal(perception.blockAt(at(3, 0, 3))?.name, 'stone');
        assert.equal(perception.blockAt(at(3, -1, 3)), null);
        assert.equal(perception.findBlocks({ matching: id('dirt'), maxDistance: 16, count: 100 }).length, 0);
        assert.ok(perception.findBlocks({ matching: id('stone'), maxDistance: 8, count: 1000 }).length > 50);
    });

    await step('the cow in the sealed pen is not perceived; the one behind glass is', () => {
        const cows = perception.entities().filter(e => e.name === 'cow');
        const raw = Object.values(bot.entities).filter(e => e.name === 'cow' && e.position.distanceTo(bot.entity.position) < 20);
        assert.equal(raw.length, 2, `the server sent ${raw.length} cows nearby`);
        assert.equal(cows.length, 1, `perceived ${cows.length} cows`);
        assert.ok(cows[0].position.x < origin.x - 5, 'the one perceived is the one behind glass');
    });

    await step('world.js answers fairly once the provider is installed', () => {
        registerFairPlay(bot, { perception, policy });
        setWorldQueries(fairQueries);
        try {
            const diamonds = world.getNearestBlocksWhere(bot, b => b.name === 'diamond_ore', 32, 10);
            assert.deepEqual(diamonds.map(b => b.position.x - origin.x), [-6]);
            assert.equal(world.getNearbyEntities(bot, 32).filter(e => e.name === 'cow').length, 1);
            // What !nearbyBlocks tells the model.
            const types = world.getNearbyBlockTypes(bot, 16);
            for (const name of ['stone', 'diamond_ore', 'glass']) assert.ok(types.includes(name), `names ${name}: ${types}`);
            for (const name of ['dirt', 'chest']) assert.ok(!types.includes(name), `does not name ${name}: ${types}`);
            return { nearbyBlocks: types };
        } finally {
            setWorldQueries(null);
        }
    });

    await step('timing: background pass and a !nearbyBlocks-sized query', () => {
        let t = performance.now();
        perception.tick();
        const tickMs = performance.now() - t;
        const everything = bot.registry.blocksArray.filter(b => b.name !== 'air').map(b => b.id);
        t = performance.now();
        const near = perception.findBlocks({ matching: everything, maxDistance: 8, count: 10000 });
        const nearbyMs = performance.now() - t;
        assert.equal(seenMap.count('diamond_ore'), 1, 'the pass remembered the visible diamond only');
        return { tickMs: Math.round(tickMs), nearbyBlocksMs: Math.round(nearbyMs), nearbyKnown: near.length };
    });

    // A Bedrock server never sends a mob's everyday noises (the client makes those up itself), so the cow
    // is made to cry out: the walls of its pen close in on it. Mob loot is off first, so it leaves nothing.
    await step('the cow in the sealed pen is heard crying out, from the north, though it is not seen', async () => {
        perception.start(); // listens for what the server sends about sounds
        await cmd('gamerule domobloot false');
        await fill([0, 2, -10], [0, 3, -10], 'stone');
        await delay(4000);
        const heard = perception.heard({ withinMs: 10000 });
        perception.stop();
        assert.ok(heard.some(h => h.subject === 'cow' && h.direction === 'north'), `heard ${JSON.stringify(heard)}`);
        assert.equal(perception.entities().filter(e => e.name === 'cow').length, 1, 'still only the cow behind glass is seen');
        return { heard: heard.map(h => `${h.subject} (${h.text})`) };
    });

    await step('made an operator, the bot notices; made a member again, it is cleared', async () => {
        const events = [];
        const watch = watchPermissions(bot, { onViolation: reason => events.push(reason), onClear: () => events.push('cleared') });
        assert.equal(watch.violation, null, 'a member is not an operator');
        await cmd(`op ${NAME}`, 1500);
        const asOperator = watch.violation;
        await cmd(`deop ${NAME}`, 1500);
        assert.match(String(asOperator), /operator/, `while op: ${asOperator}`);
        assert.equal(watch.violation, null, `after deop: ${watch.violation}`);
        return { events };
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try { if (origin) await tearDown(); } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
