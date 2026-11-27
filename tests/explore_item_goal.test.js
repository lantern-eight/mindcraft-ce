// SPDX-License-Identifier: CC0-1.0
// The NPC's item goal, when what it needs isn't in sight a second time, goes and looks for it. With a way of
// exploring installed for the bot (library/explore_way.js) it explores for that thing; with none, it takes
// Mindcraft's step of 8 blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import rootSettings from '../settings.js';
import { setSettings } from '../src/agent/settings.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { exploreWayOf, setExploreWay } from '../src/agent/library/explore_way.js';
import { GAME_VERSION } from './helpers/game_version.js';

// The item goal reads recipes and drops from mcdata.js, which loads its game data when a bot logs in.
async function loadGameData() {
    setSettings({ ...rootSettings, host: '127.0.0.1', port: 1, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline' });
    const { initBot } = await import('../src/utils/mcdata.js');
    const bot = initBot('GameData');
    bot.on('error', () => {});
    bot.emit('login');
    bot.end();
}

test('an item goal that can\'t see what it needs twice explores for that thing', async () => {
    await loadGameData();
    const { ItemGoal } = await import('../src/agent/npc/item_goal.js');
    setWorldQueries({ entities: () => [] });   // no pig anywhere in sight
    const bot = {
        entity: { position: new Vec3(0, 64, 0) },
        inventory: { slots: [], items: () => [] },
        modes: { pause: () => {} },
        output: '',
        interrupt_code: false,
        emit: () => {},
    };
    const labels = [];
    const agent = { bot, isIdle: () => true, actions: { runAction: async (label, fn) => { labels.push(label); await fn(); } } };
    const asked = [];
    setExploreWay(bot, async what => { asked.push(what); });
    try {
        const goal = new ItemGoal(agent);
        assert.equal(await goal.executeNext('raw_porkchop', 1), false);
        assert.deepEqual(asked, [], 'the first miss only waits');
        assert.equal(await goal.executeNext('raw_porkchop', 1), false);
        assert.deepEqual(asked, ['pig'], 'the second explores for a pig');
        assert.deepEqual(labels, ['itemGoal:explore'], 'as an action, as before');
    } finally {
        setWorldQueries(null);
        setExploreWay(bot, null);
    }
    assert.equal(exploreWayOf(bot), null);
});
