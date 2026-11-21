// SPDX-License-Identifier: CC0-1.0
// Live scenarios for a narrowed field of view (no model calls, free to run).
//   node tests/live/narrow_view_scenarios.js [--port=55924] [--only=<regex>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The bot sees through a player's screen: `fov_degrees` 70, the game's own default, about 102 degrees
// across. What is behind it is unknown, to perception and to world memory alike, until it turns. Asked to
// dig, open or build against a block behind it, it turns to the block first, as a player does, and is
// still refused one behind a wall. Turning round toward an enderman never stares at its eyes. The test
// peeks at the real world to check; the bot never may.
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

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55924);
const ONLY = arg('only');
const NAME = 'Narrow';
const results = [];
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};
const NORTH = 0, SOUTH = Math.PI; // mineflayer's yaw: 0 faces north (-z)

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        fair_play: 'custom', fair_play_custom: { fov_degrees: 70 }, world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { guardGaze, stares } = await import('../../src/agent/reflexes/gaze.js');
    const { editionOf } = await import('../../src/agent/edition/index.js');
    const world = await import('../../src/agent/library/world.js');
    const skills = await import('../../src/agent/library/skills.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;
    const edition = editionOf(bot.registry);

    // The parts of a CE agent that fair play uses, without a model behind them. The modes are set up but
    // never run, so nothing turns the bot's head but the scenes themselves.
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'narrow-view-memory-')) });
    assert.ok(handle, 'fair play installed');
    guardGaze(bot);
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 3 });
    const at = (x, y, z) => new Vec3(x, y, z);
    const rawName = (x, y, z) => bot.blockAt(at(x, y, z))?.name; // the test may peek; the bot may not
    const raw = name => Object.values(bot.entities).filter(e => e.name === name);
    const sees = pos => handle.perception.blockAt(pos)?.name ?? null;
    const remembers = (x, y, z) => handle.memory.cells.read(x, y, z);
    const knowsMob = name => world.getNearbyEntities(bot, 24).some(e => e.name === name);

    // A stone floor with its top at y 69 and open air above, the bot in the middle facing north. Each scene
    // starts from this.
    async function reset() {
        await cmd('kill @e[type=!player]');
        await cmd('fill -14 60 -14 14 69 14 stone');
        await cmd('fill -14 70 -14 14 90 14 air');
        await cmd(`clear ${NAME}`);
        await cmd(`tp ${NAME} 0.5 70 0.5 180 0`); // the game's yaw 180 faces north
        await delay(1500);
        await bot.look(NORTH, 0, true);
    }
    await cmd('gamerule doDaylightCycle false');
    await cmd('gamerule doMobSpawning false');
    await cmd('time set noon');
    await waitFor(() => handle.wiring && handle.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${handle.wiring?.reason}`);
    assert.equal(handle.wiring.status, 'ok', handle.wiring.reason);

    await step('a control: an ore, a chest and a pig behind the bot are unknown, to perception and memory, until it turns', async () => {
        await reset();
        await cmd('setblock 0 70 6 diamond_ore');
        await cmd('setblock 3 70 5 chest');
        await cmd('setblock 0 70 -6 gold_ore'); // in front, as a check that it does see
        await cmd('summon pig -2.5 70 7.5 {NoAI:1b,PersistenceRequired:1b}');
        await waitFor(() => raw('pig').length === 1 && rawName(0, 70, 6) === 'diamond_ore', 5000);
        await delay(1500); // a few of the recorder's looks
        assert.equal(sees(at(0, 70, -6)), 'gold_ore', 'the ore in front');
        assert.equal(remembers(0, 70, -6), 'gold_ore');
        assert.equal(sees(at(0, 70, 6)), null, 'the ore behind');
        assert.equal(remembers(0, 70, 6), null, 'memory did not record it either');
        assert.equal(handle.memory.things.get(3, 70, 5), null, 'nor the chest');
        assert.equal(knowsMob('pig'), false, 'nor the pig');

        await bot.look(SOUTH, -0.2, true);
        await delay(1000);
        assert.equal(sees(at(0, 70, 6)), 'diamond_ore');
        assert.equal(remembers(0, 70, 6), 'diamond_ore', 'remembered once seen');
        assert.equal(handle.memory.things.get(3, 70, 5)?.name, 'chest');
        assert.equal(knowsMob('pig'), true);

        await bot.look(NORTH, 0, true);
        await delay(4000); // longer than a mob that slips out of view is kept
        assert.equal(sees(at(0, 70, 6)), 'diamond_ore', 'out of view again: answered from memory');
        assert.equal(knowsMob('pig'), false, 'the pig is forgotten once out of view');
    });

    await step('acting behind: the bot turns to dig, open and build against a block behind it, and succeeds', async () => {
        await reset();
        await cmd('setblock 0 70 2 dirt');
        await cmd('setblock 2 70 1 chest');
        await cmd('setblock -2 70 2 stone');
        await cmd(`give ${NAME} iron_shovel`);
        await cmd(`give ${NAME} oak_planks 4`);
        await waitFor(() => rawName(0, 70, 2) === 'dirt' && rawName(-2, 70, 2) === 'stone', 5000);
        await delay(500);
        assert.equal(handle.perception.seesCell(at(0, 70, 2)), false, 'the dirt is behind');

        const dug = await act('test:dig', () => bot.dig(bot.blockAt(at(0, 70, 2))));
        assert.equal(dug.status, 'ok', dug.text);
        await waitFor(() => rawName(0, 70, 2) === 'air', 5000, () => 'the dirt was not dug');
        const yawAfterDig = bot.entity.yaw;

        await bot.look(NORTH, 0, true);
        const opened = await act('test:open', async () => { const window = await bot.openContainer(bot.blockAt(at(2, 70, 1))); bot.closeWindow(window); });
        assert.equal(opened.status, 'ok', opened.text);

        await bot.look(NORTH, 0, true);
        const placed = await act('test:place', async () => {
            await bot.equip(bot.inventory.items().find(item => item.name === 'oak_planks'), 'hand');
            await bot.placeBlock(bot.blockAt(at(-2, 70, 2)), new Vec3(0, 1, 0));
        });
        assert.equal(placed.status, 'ok', placed.text);
        await waitFor(() => rawName(-2, 71, 2) === 'oak_planks', 5000, () => 'nothing was placed');
        return { yawAfterDigDeg: Number((yawAfterDig * 180 / Math.PI).toFixed(1)) };
    });

    await step('acting behind a wall: the bot turns, sees the wall, and is refused as before', async () => {
        await reset();
        await cmd('fill -2 70 2 2 72 2 stone');
        await cmd('setblock 0 70 3 chest');
        await waitFor(() => rawName(0, 70, 3) === 'chest', 5000);
        await delay(500);
        const result = await act('test:open', () => bot.openContainer(bot.blockAt(at(0, 70, 3))));
        assert.notEqual(result.status, 'ok', result.text);
        assert.match(result.text, /can't see the block at 0, 70, 3/);
        assert.ok(Math.cos(bot.entity.yaw - SOUTH) > 0.9, 'it turned to look');
        return { text: result.text.trim() };
    });

    await step('a search with nothing in view looks round first, and finds the log behind the bot', async () => {
        await reset();
        // Somewhere the bot has not looked round from lately: the scenes before turned it every way at the middle.
        await cmd(`tp ${NAME} 8.5 70 -6.5 180 0`);
        await cmd('setblock 8 70 1 oak_log');
        await cmd(`give ${NAME} iron_axe`);
        await waitFor(() => rawName(8, 70, 1) === 'oak_log', 5000);
        await delay(1500);
        await bot.look(NORTH, 0, true);
        assert.equal(sees(at(8, 70, 1)), null, 'behind the bot');
        const result = await act('test:collect', () => skills.collectBlock(bot, 'oak_log', 1));
        assert.equal(result.status, 'ok', result.text);
        await waitFor(() => rawName(8, 70, 1) === 'air', 5000, () => `the log is still there: ${result.text}`);
        return { text: result.text.trim().split('\n').slice(-1)[0] };
    });

    await step('!lookAround turns the bot round, and what was behind it is known after', async () => {
        await reset();
        await cmd('setblock 2 70 6 gold_block');
        await waitFor(() => rawName(2, 70, 6) === 'gold_block', 5000);
        await delay(1000);
        assert.equal(sees(at(2, 70, 6)), null);
        const said = await getCommand('!lookAround').perform(agent);
        assert.match(String(said), /Looked around \(\d looks\)/);
        assert.equal(remembers(2, 70, 6), 'gold_block', 'world memory saw it as the bot turned');
        return { said: String(said).trim() };
    });

    await step('an enderman behind the bot: turning round toward its eyes never stares, and it never turns on the bot', async () => {
        await reset();
        await cmd('difficulty normal'); // peaceful takes every enderman away
        await cmd(`effect give ${NAME} resistance 60 4 true`);
        await cmd('time set midnight');
        await cmd('summon enderman 0.5 70 12.5 {PersistenceRequired:1b,attributes:[{id:"minecraft:movement_speed",base:0.0}]}');
        await waitFor(() => raw('enderman').length === 1, 5000);
        const enderman = raw('enderman')[0];
        const keys = bot.registry.entitiesByName.enderman.metadataKeys;
        const angry = () => enderman.metadata[keys.indexOf('creepy')] === true || edition.isAggressive(bot.registry, enderman);
        await delay(4000); // anything seen while setting up is forgotten
        assert.equal(knowsMob('enderman'), false, 'behind the bot, so out of view');
        const eyes = () => enderman.position.offset(0, 2.55, 0);
        let turns = 0, lowered = 0;
        const started = Date.now();
        while (Date.now() - started < 8000) {
            await bot.look(NORTH, 0, true); // face away
            await delay(300);               // past the guard's 250 ms between asks
            await bot.lookAt(eyes(), true); // and turn round straight at its eyes
            turns++;
            const eye = bot.entity.position.offset(0, 1.62, 0);
            assert.equal(stares(eye, bot.entity.yaw, bot.entity.pitch, [eyes()]), false, 'the turn stared');
            if (bot.entity.pitch < Math.atan2(eyes().y - eye.y, Math.hypot(eyes().x - eye.x, eyes().z - eye.z)) - 0.01) lowered++;
            await delay(300);
            assert.equal(angry(), false, 'it turned on the bot');
        }
        await cmd('kill @e[type=enderman]');
        await cmd('difficulty peaceful');
        await cmd('time set noon');
        return { turns, lowered };
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
