// SPDX-License-Identifier: CC0-1.0
// Live world-memory scenarios against a real server (no model calls, free to run).
//   node tests/live/memory_scenarios.js [--port=55924]
// Needs Node 22, Java 21 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check each layer on hand-built worlds with a stand-in bot. These check what only a real
// server can: real chunk data, a real double chest, a real container window, the bot's real movement.
// The server console is the "director" that builds each scene and moves the bot about, so the bot never
// needs a command or operator rights itself. One scenario waits a minute on purpose: a change counts as
// news only when the bot had not seen the spot for that long.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55924);
const NAME = 'Rememberer';
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline', fair_play: 'strict', world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [], memory_bank: new MemoryBank(),
        prompter: { profile: {}, getInitModes: () => ({}) },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        openChat: () => {}, handleMessage: () => {},
        clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt: () => {
            bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
        },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const memoryDir = mkdtempSync(path.join(tmpdir(), 'memory-live-'));
    const handle = installFairPlay(agent, { memoryDir });
    assert.ok(handle?.memory, 'world memory is on');
    const memory = () => handle.memory;
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 1 });
    const recall = what => getCommand('!recall').perform(agent, what);
    /** Lets the recorder finish the look-around it is in, and any it starts right after. */
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };

    // A stone platform in the air with the bot in the middle, and a double chest a few blocks east. The
    // chest faces west, so seen from the front its left half is the southern one.
    await cmd('fill -20 69 -20 20 69 20 stone');
    await cmd('fill -20 70 -20 20 80 20 air');
    await cmd(`tp ${NAME} 0.5 70 0.5 -90 0`);
    await cmd('setblock 4 70 0 chest[facing=west,type=right]');
    await cmd('setblock 4 70 1 chest[facing=west,type=left]');
    await cmd('item replace block 4 70 0 container.0 with iron_ingot 30');
    await cmd('item replace block 4 70 0 container.5 with bread 6');
    await delay(2500);
    await settled();

    await step('what is in view is remembered from real chunk data, and what is buried is not', () => {
        const cells = memory().cells;
        assert.equal(cells.read(3, 69, 3), 'stone', 'the platform it stands on');
        assert.equal(cells.read(3, 70, 3), 'air', 'the air just above it was seen empty');
        assert.equal(cells.read(0, 60, 0), null, 'nothing under the platform was seen');
        assert.equal(memory().scope.endsWith('/overworld'), true);
    });

    await step('a real double chest is one thing, and it makes a place', () => {
        const things = memory().things;
        assert.equal(things.count('chest'), 1, 'the game marks the halves left and right; memory joins them');
        const chest = things.get(4, 70, 1);
        assert.deepEqual([chest.x, chest.also?.x, chest.kind], [4, 4, 'container']);
        assert.match(getCommand('!places').perform(agent), /an unnamed site near 4, 70, [01]: chest 1/);
        return { state: chest.state };
    });

    await step('a full look-around fits in a few short slices', async () => {
        // Force a fresh look and time it with no budget, then again in the 4 ms slices the bot really uses.
        bot.emit('blockUpdate', null, { position: bot.entity.position });
        const started = performance.now();
        handle.recorder.tick({ budgetMs: Infinity });
        const whole = performance.now() - started;
        assert.equal(handle.recorder.busy, false);
        bot.emit('blockUpdate', null, { position: bot.entity.position });
        let slices = 0, longest = 0;
        do {
            const t = performance.now();
            handle.recorder.tick({ budgetMs: 4 });
            longest = Math.max(longest, performance.now() - t);
            slices++;
        } while (handle.recorder.busy && slices < 500);
        assert.equal(handle.recorder.busy, false, 'the look-around finished');
        assert.ok(longest < 40, `one slice took ${longest.toFixed(1)} ms`);
        return { wholeLookMs: Number(whole.toFixed(1)), slices, longestSliceMs: Number(longest.toFixed(1)) };
    });

    await step('L4: it opens the chest, walks away, and still knows what was inside', async () => {
        await act('test:walk', () => skills.goToPosition(bot, 2, 70, 0, 0));
        const block = bot.blockAt(new Vec3(4, 70, 0));
        const container = await bot.openContainer(block);
        await delay(400);
        container.close();
        await delay(400);
        assert.deepEqual(memory().things.get(4, 70, 0).contents.items, { iron_ingot: 30, bread: 6 });
        await act('test:walk', () => skills.goToPosition(bot, -14, 70, 0, 0));
        const iron = recall('iron');
        assert.match(iron, /^IN CONTAINERS YOU OPENED\n- chest at 4, 70, [01]: iron_ingot 30 \(looked .*\), 1\d blocks east, about \d+ seconds on foot by a way you know/);
        return { recall: iron.split('\n')[1] };
    });

    await step('walking laid a trail it can route back along', () => {
        const trail = memory().trail;
        assert.ok(trail.size >= 4, `only ${trail.size} crumbs`);
        const from = trail.nearest(bot.entity.position, { maxDistance: 6 });
        const to = trail.nearest({ x: 2, y: 70, z: 0 }, { maxDistance: 6 });
        const route = trail.route(from.id, to.id);
        assert.ok(route, 'no route back to the chest');
        return { crumbs: trail.size, routeSeconds: Number(route.seconds.toFixed(1)), stops: route.ids.length };
    });

    await step('saved places are kept in world memory', async () => {
        assert.match(await getCommand('!rememberHere').perform(agent, 'west end'), /saved/);
        assert.equal(memory().places.byName('west end').kind, 'named');
        assert.match(recall('west end'), /^PLACE\n- "west end"/);
    });

    await step('L3 and A6: back after a minute away, it notices a new hut and a missing chest, and says so once', async () => {
        await act('test:walk', () => skills.goToPosition(bot, 0, 70, 0, 0));
        await settled();
        // The director takes the bot far away, changes the place, waits out the minute, and brings it back.
        await cmd(`tp ${NAME} 300.5 70 300.5`);
        await cmd('fill 295 69 295 305 69 305 stone');
        await delay(1500);
        await cmd('fill 8 70 -8 12 72 -4 oak_planks');
        await cmd('fill 9 70 -7 11 71 -5 air');
        await cmd('setblock 4 70 0 air');
        await cmd('setblock 4 70 1 air');
        await cmd('kill @e[type=item]');
        await delay(61_000);
        await cmd(`tp ${NAME} 0.5 70 0.5 -90 0`);
        await delay(1500);
        await settled();
        await delay(2500); // the two quiet seconds before a group of differences becomes a note
        await settled();
        const result = await act('test:noop', async () => true);
        const text = result.text ?? result.message ?? '';
        assert.match(text, /Noticed .*Gone: chest 1\./, text);
        assert.match(text, /Noticed .*New: oak_planks \d+\./, text);
        assert.ok(Number(text.match(/oak_planks (\d+)/)[1]) >= 20, 'the walls it can see are counted, not only the ground row');
        assert.equal(memory().things.count('chest'), 0);
        const again = await act('test:noop', async () => true);
        assert.doesNotMatch(again.text ?? again.message ?? '', /Noticed/, 'a note is passed on once');
        assert.match(recall('changes'), /^CHANGES YOU NOTICED/);
        return { notes: text.split('\n').filter(line => line.startsWith('Noticed')) };
    });

    await step('memory is saved, in small files', async () => {
        assert.equal(memory().save(), 0);
        const { readdirSync, statSync } = await import('node:fs');
        const dir = memory().dir;
        const files = readdirSync(dir);
        for (const name of ['trail.json', 'things.json', 'places.json', 'cells']) assert.ok(files.includes(name), `${name} is missing`);
        const regions = readdirSync(path.join(dir, 'cells')).filter(name => name.endsWith('.bin'));
        const bytes = regions.reduce((sum, name) => sum + statSync(path.join(dir, 'cells', name)).size, 0);
        return { regionFiles: regions.length, cellBytes: bytes, trailBytes: statSync(path.join(dir, 'trail.json')).size };
    });

    await step('after all of that, the server log shows no command issued by the bot', () => {
        assert.doesNotMatch(server.log, new RegExp(`${NAME} issued server command`));
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
