// SPDX-License-Identifier: CC0-1.0
// Live scenarios for skills that are given a block by its coordinates (no model calls, free to run).
//   node tests/live/look_first_scenarios.js [--port=55923]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// Under fair play these skills look at a block before they decide anything from it (look_first.js):
// told to break or build at a spot inside the ground, the bot goes to look, and says it can't see the
// block instead of naming it. Placing picks a side the bot can see. digDown digs a staircase that sees
// each block it will stand on before stepping onto it (stairs_down.js), and goToSurface climbs by what
// the bot knows of the column above it. The test peeks at the real blocks to check; the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55923);
const NAME = 'LookFirst';
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', ...fairPlaySettings(), world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills, reflexes and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'look-first-memory-')) });
    assert.ok(handle, 'fair play installed');
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 3 });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek; the bot may not
    const feet = () => bot.entity.position.floored();

    // A thick stone floor with its top at y 69 and open air above, the bot in the middle. Each scene
    // starts from this, so one scene's digging can't spoil the next.
    async function reset({ facing = -90 } = {}) {
        await cmd('fill -12 56 -12 12 69 12 stone');
        await cmd('fill -12 70 -12 12 90 12 air');
        await cmd(`clear ${NAME}`);
        await cmd(`tp ${NAME} 0.5 70 0.5 ${facing} 0`);
        await cmd(`give ${NAME} iron_pickaxe`);
        await cmd(`give ${NAME} iron_shovel`);
        await cmd(`give ${NAME} dirt 16`);
        await delay(1500);
    }
    await cmd('gamerule doDaylightCycle false');
    await cmd('time set noon');
    await waitFor(() => handle.wiring && handle.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${handle.wiring?.reason}`);

    await step('told to break a block under the floor, the bot goes to look, and says it cannot see it rather than what it is', async () => {
        await reset();
        await cmd('setblock 3 68 0 lava'); // one block under the floor, sealed in by stone
        await delay(800);
        const result = await act('test:break', () => skills.breakBlockAt(bot, 3, 68, 0));
        assert.notEqual(result.status, 'ok', result.text);
        assert.match(result.text, /can't see the block at 3, 68, 0/);
        assert.doesNotMatch(result.text, /lava/);
        assert.equal(rawName(3, 68, 0), 'lava', 'and nothing was dug');
        assert.ok(bot.entity.position.distanceTo(new Vec3(3.5, 68, 0.5)) < 3.5, 'it walked over to look');
        return { text: result.text.trim() };
    });

    await step('told to build where a block is buried, the bot does not say what is in the way, and digs nothing', async () => {
        await reset();
        await cmd('setblock -3 67 2 diamond_ore');
        await delay(800);
        const result = await act('test:place', () => skills.placeBlock(bot, 'dirt', -3, 67, 2));
        assert.notEqual(result.status, 'ok', result.text);
        assert.match(result.text, /Cannot place dirt at \(-3, 67, 2\): You can't see the block at -3, 67, 2/);
        assert.doesNotMatch(result.text, /diamond/);
        assert.equal(rawName(-3, 67, 2), 'diamond_ore');
        return { text: result.text.trim() };
    });

    await step('placing picks a side the bot can see: under a block it would click from below, it builds off the floor instead', async () => {
        await reset();
        // A block overhead at 3, 71, 0. Asked to place against its underside ("top"), which faces away from an
        // eye above it, the bot builds off the floor's top instead. Before, it chose the underside and the
        // placement was refused.
        await cmd('setblock 3 71 0 stone');
        await delay(800);
        const result = await act('test:place', () => skills.placeBlock(bot, 'dirt', 3, 70, 0, 'top'));
        assert.equal(result.status, 'ok', result.text);
        assert.equal(rawName(3, 70, 0), 'dirt');
        assert.doesNotMatch(result.text, /Failed to place|can't see/);
        return { text: result.text.trim() };
    });

    await step('tilling a block in view works as it always did', async () => {
        await reset();
        await cmd('fill 2 69 -1 2 69 1 grass_block');
        await cmd(`give ${NAME} iron_hoe`);
        await cmd(`give ${NAME} wheat_seeds 4`);
        await delay(800);
        const result = await act('test:till', () => skills.tillAndSow(bot, 2, 69, 0, 'wheat_seeds'));
        assert.equal(result.status, 'ok', result.text);
        await waitFor(() => rawName(2, 69, 0) === 'farmland' && rawName(2, 70, 0) === 'wheat', 3000, () => `${rawName(2, 69, 0)} under ${rawName(2, 70, 0)}`);
        return { text: result.text.trim() };
    });

    await step('digDown digs a staircase, and never learns of the lava under where a shaft would have gone', async () => {
        await reset({ facing: -90 }); // east
        await cmd('setblock 0 66 0 lava'); // three blocks under the bot's feet, sealed in
        await delay(800);
        const start = feet();
        const result = await act('test:dig', () => skills.digDown(bot, 4));
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /Dug down 4 blocks as a staircase heading east/);
        assert.doesNotMatch(result.text, /lava/);
        assert.equal(start.y - feet().y, 4, `it went down ${start.y - feet().y}`);
        assert.ok(feet().x >= start.x + 3, `it went east, to x ${feet().x}`);
        assert.equal(rawName(0, 66, 0), 'lava', 'the lava under its first spot is untouched');
        assert.equal(bot.health, 20);
        return { text: result.text.trim() };
    });

    await step('digDown stops at lava it uncovers under the next step, before stepping onto it', async () => {
        await reset({ facing: -90 }); // east
        await cmd('setblock 3 66 0 lava'); // under the third step
        await delay(800);
        const start = feet();
        const result = await act('test:dig', () => skills.digDown(bot, 6));
        assert.notEqual(result.status, 'ok', result.text);
        assert.match(result.text, /stopped: there is lava under the next step, at 3, 66, 0/);
        assert.equal(start.y - feet().y, 2, `it went down ${start.y - feet().y}`);
        await delay(1500);
        assert.equal(bot.health, 20, 'and it did not get burned');
        return { text: result.text.trim() };
    });

    await step('from a sealed cave goToSurface climbs by what it sees, without naming the surface first, and gets out', async () => {
        await reset();
        // A hill over the bot: stone up to 80, a cave 2 high around the bot from 70.
        await cmd('fill -6 70 -6 6 80 6 stone');
        await cmd('fill -2 70 -2 2 71 2 air');
        await cmd(`tp ${NAME} 0.5 70 0.5`);
        await delay(1500);
        const result = await act('test:surface', () => skills.goToSurface(bot));
        const lines = result.text.split('\n').filter(line => /Going up|surface|higher/.test(line));
        assert.equal(result.status, 'ok', result.text);
        assert.doesNotMatch(lines[0], /y=81/, 'the first words do not give away the surface');
        assert.ok(feet().y >= 81, `it got to y ${feet().y}: ${result.text}`);
        assert.match(result.text, /Reached the surface at y=8\d/);
        return { said: lines };
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
