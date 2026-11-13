// Live fair-play scenarios against a real server (no model calls, free to run).
//   node tests/live/fairplay_scenarios.js [--port=55922]
// Needs Node 22, Java 21 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check each rule on hand-built worlds. These check the whole thing put together the way
// a real agent runs it: fair play installed by its normal hook, CE's real skills and reflexes, real
// chunk data and packets. The server console is the "director" that builds each scene, so the bot
// never needs a command or operator rights itself.
//
// The throwaway server has anti-xray off, so the bot is sent every buried ore. Passing here means the
// bot-side rules hold with no help from the server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55922);
const NAME = 'FairPlayer';
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline', fair_play: 'strict' });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { SEARCH_HINT } = await import('../../src/agent/fairplay/commands.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
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
    bot.on('mining_progress', ({ message }) => agent.actions.reportProgress(message));
    initModes(agent);
    const handle = installFairPlay(agent, { seenDir: mkdtempSync(path.join(tmpdir(), 'fair-live-')) });
    assert.ok(handle, 'fair play installed');
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 1 });
    const rawName = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name; // the test may peek at the truth; the bot may not
    const count = item => bot.inventory.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);

    // A stone platform in the air, the bot in the middle facing east, with a pickaxe and some dirt.
    await cmd('fill -14 69 -14 14 69 14 stone');
    await cmd('fill -14 70 -14 14 80 14 air');
    await cmd(`tp ${NAME} 0.5 70 0.5 -90 0`);
    await cmd(`give ${NAME} iron_pickaxe`);
    await cmd(`give ${NAME} dirt 8`);
    // East: a lump of stone with three diamonds buried inside.
    await cmd('fill 5 70 -2 9 74 2 stone');
    const buried = [[7, 72, 0], [8, 71, -1], [7, 71, 1]];
    for (const [x, y, z] of buried) await cmd(`setblock ${x} ${y} ${z} diamond_ore`);
    // South: a sealed stone room with a chest in it.
    await cmd('fill -2 70 6 2 73 10 stone');
    await cmd('fill -1 70 7 1 72 9 air');
    await cmd('setblock 0 70 8 chest');
    await delay(2500);

    await step('V1: the bot is a plain survival player, and a slash command it tries never leaves the client', async () => {
        assert.equal(bot.game.gameMode, 'survival');
        assert.equal(handle.violation, null);
        bot.chat('/give @s diamond 64');
        await delay(1200);
        assert.equal(count('diamond'), 0);
        assert.doesNotMatch(server.log, new RegExp(`${NAME} issued server command`));
    });

    await step('what the model reads about its surroundings leaves out the buried diamonds', () => {
        const diamond = bot.registry.blocksByName.diamond_ore.id;
        assert.equal(bot.findBlocks({ matching: diamond, maxDistance: 16, count: 10 }).length, 3, 'the raw bot was sent all three');
        const nearby = getCommand('!nearbyBlocks').perform(agent);
        assert.match(nearby, /- stone/);
        assert.doesNotMatch(nearby, /diamond/);
    });

    await step('P4: asked for diamonds it has not seen, the bot says so and does not walk toward the buried ones', async () => {
        const start = bot.entity.position.clone();
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'diamond_ore', 3));
        assert.notEqual(result.status, 'ok', result.text);
        assert.ok(result.text.includes(SEARCH_HINT), result.text);
        assert.ok(bot.entity.position.distanceTo(start) < 1.5, 'it stayed where it was');
        for (const [x, y, z] of buried) assert.equal(rawName(x, y, z), 'diamond_ore');
        return { text: result.text.replace(SEARCH_HINT, '').trim() };
    });

    await step('V3: with one diamond in view it mines that one, and the buried ones stay untouched', async () => {
        await cmd('setblock 5 71 0 diamond_ore'); // on the face of the lump, in plain view
        await delay(800);
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'diamond_ore', 3));
        assert.equal(result.broken, 1, result.text);
        assert.equal(count('diamond'), 1, result.text);
        for (const [x, y, z] of buried) assert.equal(rawName(x, y, z), 'diamond_ore', `the buried diamond at ${x}, ${y}, ${z} is still there`);
        const recall = getCommand('!recall').perform(agent, 'diamond_ore');
        for (const [x, y, z] of buried) assert.ok(!recall.includes(`${x}, ${y}, ${z}`), recall);
        return { text: result.text.replace(SEARCH_HINT, '').trim() };
    });

    await step('R1: a chest two blocks behind a wall cannot be opened, though it is within reach', async () => {
        await cmd(`tp ${NAME} 0.5 70 5.5 0 0`); // right up against the room's north wall
        await delay(800);
        const chest = bot.blockAt(new Vec3(0, 70, 8)); // the test hands it the real block; a skill never could
        const result = await act('test:open', () => bot.openContainer(chest));
        assert.equal(result.status, 'failed', result.text);
        assert.match(result.text, /can't see the block at 0, 70, 8/);
        await cmd(`tp ${NAME} 0.5 70 0.5 0 0`);
        await delay(800);
    });

    await step('V6: the chest in the sealed room is not found; once a doorway is opened it is, and the skill works', async () => {
        const before = await act('test:chest', () => skills.putInChest(bot, 'dirt', 1));
        assert.match(before.text, /Could not find a chest nearby/);
        assert.equal(count('dirt'), 8);
        await cmd('fill 0 70 6 0 71 6 air'); // a doorway facing the bot
        await delay(800);
        const after = await act('test:chest', () => skills.putInChest(bot, 'dirt', 1));
        assert.equal(after.status, 'ok', after.text);
        assert.equal(count('dirt'), 7, after.text);
        assert.match(getCommand('!recall').perform(agent, 'chest'), /REMEMBERED chest/);
        return { text: after.text.trim() };
    });

    await step('V5: a zombie behind a wall triggers no reflex; once there is a gap to see it through, the bot reacts', async () => {
        await cmd('difficulty easy');
        await cmd('time set midnight');
        await cmd(`tp ${NAME} 0.5 70 -2.5 180 0`);
        await cmd('fill -3 70 -6 3 73 -6 stone'); // a wall to the north
        await cmd('summon zombie 0.5 70 -8.5 {NoAI:1b}');
        await delay(1500);
        assert.equal(Object.values(bot.entities).filter(e => e.name === 'zombie').length, 1, 'the raw bot knows about the zombie');
        const start = bot.entity.position.clone();
        await bot.modes.update();
        await delay(300);
        assert.equal(agent.actions.executing, false, 'no reflex fired');
        // It may well hear the zombie groan through the wall, and say so, but it must not list it as seen.
        const report = getCommand('!entities').perform(agent);
        assert.doesNotMatch(report, /entities: \d+ zombie/, report);
        await cmd('fill -1 70 -6 1 71 -6 air'); // a gap in the wall
        await delay(800);
        assert.match(getCommand('!entities').perform(agent), /entities: 1 zombie/, 'now it is seen');
        // CE's first reflex to a hostile mob in view is "cowardice": back away from it.
        await bot.modes.update();
        await waitFor(() => agent.actions.executing, 3000, () => 'no reflex fired once the zombie was in view');
        const reflex = agent.actions.currentActionLabel;
        await waitFor(() => !agent.actions.executing, 30000, () => 'the reflex never finished');
        assert.ok(bot.entity.position.distanceTo(start) > 5, 'the bot moved away');
        await cmd('kill @e[type=zombie]');
        await cmd('difficulty peaceful');
        return { reflex, heardBeforeSeen: /heard: zombie/.test(report) };
    });

    await step('L4: made an operator, or put in creative, the bot refuses to act until that is undone', async () => {
        await cmd(`op ${NAME}`);
        await waitFor(() => handle.violation, 5000, () => 'the bot never noticed it was made an operator');
        assert.match(handle.violation, /operator/);
        const refused = await act('test:anything', async () => { throw new Error('this must not run'); });
        assert.equal(refused.status, 'blocked');
        assert.match(refused.text, /operator/);
        await cmd(`deop ${NAME}`);
        await waitFor(() => !handle.violation, 5000, () => 'the violation never cleared');
        await cmd(`gamemode creative ${NAME}`);
        await waitFor(() => handle.violation, 5000, () => 'the bot never noticed creative mode');
        assert.match(handle.violation, /creative/);
        await cmd(`gamemode survival ${NAME}`);
        await waitFor(() => !handle.violation, 5000, () => 'the violation never cleared');
    });

    await step('V2: after all of that, the server log shows no command issued by the bot', () => {
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
