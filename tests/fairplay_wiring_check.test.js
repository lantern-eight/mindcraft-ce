// SPDX-License-Identifier: CC0-1.0
// The spawn-time check that fair play is really in the way: a block buried under the bot must be unknown
// to world.js. Fair queries answer raw for a bot they don't know, so a wiring mistake would otherwise
// fail open, with nothing to show for it but a bot that sees through walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as world from '../src/agent/library/world.js';
import { setWorldQueries, worldQueries } from '../src/agent/library/world_queries.js';
import { initModes } from '../src/agent/modes.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { fairQueries, registerFairPlay, unregisterFairPlay } from '../src/agent/fairplay/fair_queries.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { checkFairWiring } from '../src/agent/fairplay/wiring_check.js';
import { installFairPlay } from '../src/agent/fairplay/install.js';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';

const STRICT = resolvePolicy({ fair_play: 'strict' });

// Solid ground twelve blocks deep under the bot, which stands on it at y 1.
function ground(build = () => {}) {
    const w = fixtureWorld({ min: [-8, -14, -8], max: [8, 8, 8] });
    w.fill('stone', [-8, -12, -8], [8, 0, 8]);
    build(w);
    const bot = stubBot(w);
    const perception = createPerception({ bot, policy: STRICT, getStateId: w.getStateId, ...NO_BUDGETS });
    return { w, bot, perception };
}

test('wired in, a buried block is unknown to world.js and the check passes', () => {
    const { bot, perception } = ground();
    registerFairPlay(bot, { perception, policy: STRICT });
    setWorldQueries(fairQueries);
    const result = checkFairWiring({ bot, perception, world, queries: worldQueries() });
    assert.equal(result.status, 'ok', result.reason);
    setWorldQueries(null);
    unregisterFairPlay(bot);
});

test('with the provider left out of world.js, or the bot never registered, the check fails', () => {
    const { bot, perception } = ground();
    registerFairPlay(bot, { perception, policy: STRICT });
    setWorldQueries(null); // world.js asks the raw bot
    const raw = checkFairWiring({ bot, perception, world, queries: worldQueries() });
    assert.equal(raw.status, 'broken');
    assert.match(raw.reason, /world\.js named the buried stone/);

    unregisterFairPlay(bot);
    setWorldQueries(fairQueries); // installed, but this bot was never registered
    const unregistered = checkFairWiring({ bot, perception, world, queries: worldQueries() });
    assert.equal(unregistered.status, 'broken');
    setWorldQueries(null);
});

test('a search that finds the buried block fails the check, even when blockAt is fair', () => {
    const { bot, perception } = ground();
    registerFairPlay(bot, { perception, policy: STRICT });
    setWorldQueries({ ...fairQueries, findBlocks: (b, options) => b.findBlocks(options) }); // a half-wired provider
    const result = checkFairWiring({ bot, perception, world, queries: worldQueries() });
    assert.equal(result.status, 'broken');
    assert.match(result.reason, /block search found/);
    setWorldQueries(null);
    unregisterFairPlay(bot);
});

test('with no buried block under the bot to test with, the check is skipped, not passed', () => {
    const w = fixtureWorld({ min: [-8, -4, -8], max: [8, 8, 8] });
    w.fill('stone', [-8, 0, -8], [8, 0, 8]); // one layer of floor over nothing loaded
    const bot = stubBot(w);
    const perception = createPerception({ bot, policy: STRICT, getStateId: w.getStateId, ...NO_BUDGETS });
    assert.equal(checkFairWiring({ bot, perception, world, queries: worldQueries() }).status, 'skipped');
});

function installedOn(wiringWorld) {
    const w = fixtureWorld({ min: [-8, -14, -8], max: [8, 8, 8] });
    w.fill('stone', [-8, -12, -8], [8, 0, 8]);
    const bot = stubBot(w);
    Object.assign(bot, { _client: new EventEmitter(), game: { gameMode: 'survival', dimension: 'overworld' }, worldIdentity: 'w1', chat: () => {} });
    const ran = [];
    const agent = { name: 'Fairy', bot, task: null, openChat: () => {}, prompter: { profile: {}, getInitModes: () => ({}) },
        actions: { runAction: async label => { ran.push(label); return { success: true, message: 'done' }; } } };
    initModes(agent);
    const handle = installFairPlay(agent, { config: { fair_play: 'strict', host: 'h', port: 1 },
        perceptionOptions: { getStateId: w.getStateId, ...NO_BUDGETS }, wiringWorld });
    return { agent, bot, handle, ran };
}

test('installed on an agent, the check passes and actions run', async () => {
    const { agent, bot, handle, ran } = installedOn(world);
    assert.equal(handle.wiring.status, 'ok', handle.wiring.reason);
    await agent.actions.runAction('action:test', async () => {});
    assert.deepEqual(ran, ['action:test']);
    bot.emit('end');
    setWorldQueries(null);
});

test('installed on an agent whose world.js reads the raw bot, every action is refused and says why', async () => {
    // A world.js that lost its hook to the provider, as an upstream merge could leave it.
    const rawWorld = { getBlockAtPosition: (b, x, y, z) => b.blockAt(b.entity.position.offset(x, y, z)) ?? { name: 'unknown' } };
    const errors = [];
    const error = console.error;
    console.error = line => errors.push(line);
    try {
        const { agent, bot, handle, ran } = installedOn(rawWorld);
        assert.equal(handle.wiring.status, 'broken');
        const result = await agent.actions.runAction('action:test', async () => {});
        assert.equal(result.status, 'blocked');
        assert.match(result.message, /wiring is broken/);
        assert.deepEqual(ran, []);
        assert.match(errors.join('\n'), /wiring check failed/);
        bot.emit('end');
    } finally {
        console.error = error;
        setWorldQueries(null);
    }
});
