// SPDX-License-Identifier: CC0-1.0
// Live check of exploring on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_explore.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scenes are built and torn down from the console.
//
// tests/live/explore_scenarios.js runs !explore and !exploreFor on Java. These are the same commands on
// Bedrock, as the model calls them, under strict fair play with world memory, on three strips of stone built
// high above the bot's ground, one for each scene:
//
//   1. Told east the bot walks east; told "on" it carries on east.
//   2. A stone wall across the strip, out of sight at the start: the bot goes round it and digs none of it.
//   3. Sand set in the strip behind the bot as it sets out: exploring for sand finds it and stops.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings, LIVE_VIEW } from '../helpers/live_view.js';

const NAME = 'BedrockExplore';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);
const tpTo = (cell, yaw = 0, settle = 2500) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);

// Three strips side by side, each 25 blocks wide and running 100 east of where the bot starts on it: one
// floor of stone with dirt under it and clear air above. A fill on Bedrock takes at most 32,768 blocks, so
// each strip is cleared in its own command. Bedrock's yaw for east is -90, as Java's.
const STRIPS = { heading: 0, wall: 40, sand: 80 };
const LENGTH = 100, HALF = 12;
async function buildStrip(z) {
    await fill([-4, 1, z - HALF], [LENGTH, 6, z + HALF], 'air');
    await fill([-4, -1, z - HALF], [LENGTH, -1, z + HALF], 'dirt');
    await fill([-4, 0, z - HALF], [LENGTH, 0, z + HALF], 'stone');
}
// Ground this far from the bot isn't loaded on the server until a player comes near, and a fill there fails
// ("Cannot place blocks outside of the world"). A ticking area keeps the strips loaded while they are built and
// used; it is removed at tear-down.
const AREA = 'explorestrips';
const addArea = async () => { await cmd(`tickingarea add ${xyz(at(-4, -1, -HALF))} ${xyz(at(LENGTH, 6, STRIPS.sand + HALF))} ${AREA}`); await delay(6000); };
async function clearStrip(z) {
    await fill([-4, -1, z - HALF], [LENGTH, 6, z + HALF], 'air');
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, explore: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { exploreCommands } = await import('../../src/agent/explore/commands.js');

    let agent, handle, exploreCommand, exploreForCommand;
    const rawName = cell => bot.blockAt(at(...cell))?.name; // the test may peek at the truth; the bot may not

    /** Runs a command as the model would, with a deadline, and notes where the bot went. */
    const run = async (command, args, deadlineMs = 150000) => {
        const start = bot.entity.position.clone();
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ status: 'deadline', text: 'deadline' }); }, deadlineMs); });
        const result = await Promise.race([command.perform.structured(agent, ...args), deadline]);
        clearTimeout(timer);
        const end = bot.entity.position;
        return { outcome: result.status, text: result.text, dx: Math.round(end.x - start.x), dz: Math.round(end.z - start.z), fell: Math.round(start.y - end.y) };
    };

    await step('the bot joins, the strips are built, and fair play is installed with world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await addArea();
        for (const z of Object.values(STRIPS)) await buildStrip(z);
        await tpTo([0, 1, STRIPS.heading], 0);
        assert.equal(rawName([0, 0, STRIPS.heading]), 'stone', 'the bot stands on the first strip');

        // The parts of a Mindcraft agent that skills and fair play use, without a model behind them.
        agent = {
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
        handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-explore-')) });
        await delay(1500);
        assert.ok(handle?.memory, 'world memory is on');
        [exploreCommand, exploreForCommand] = exploreCommands({ memoryOf: () => handle.memory });
    });

    await step('1: told east the bot walks east, and told "on" it carries on east', async () => {
        const first = await run(exploreCommand, ['east', 40]);
        assert.equal(first.outcome, 'ok', first.text);
        assert.ok(first.dx >= 32 && Math.abs(first.dz) <= 8 && first.fell <= 1, JSON.stringify(first));
        const second = await run(exploreCommand, ['on', 40]);
        assert.equal(second.outcome, 'ok', second.text);
        assert.ok(second.dx >= 32 && Math.abs(second.dz) <= 8 && second.fell <= 1, `still east: ${JSON.stringify(second)}`);
        assert.match(second.text, /heading east/);
        return { first, second };
    });

    await step('2: a stone wall across the way is gone round, and none of it is dug', async () => {
        const Z = STRIPS.wall, X = 20;
        await tpTo([0, 1, Z], -90);
        await fill([X, 1, Z - 6], [X, 4, Z + 6], 'stone'); // built after the bot was moved: it faces east, but the wall is beyond its look
        const trip = await run(exploreCommand, ['east', 48]);
        let wall = 0;
        for (let z = -6; z <= 6; z++) for (let y = 1; y <= 4; y++) if (rawName([X, y, Z + z]) === 'stone') wall++;
        assert.equal(wall, 13 * 4, 'the wall is whole');
        assert.ok(trip.dx > X + 4 && trip.fell <= 1, `got past the wall: ${JSON.stringify(trip)}`);
        return trip;
    });

    await step('3: exploring for sand, it finds the sand behind it and stops there', async () => {
        const Z = STRIPS.sand, X = 50;
        await tpTo([0, 1, Z], 90); // facing west: the sand is behind it
        await set([X, 0, Z], 'sand');
        const trip = await run(exploreForCommand, ['sand', 'east', 96]);
        assert.equal(trip.outcome, 'ok', trip.text);
        // Through a player's screen the sand is behind the bot, and it has to explore to see it. Seeing all
        // around it may be in view from the start, and then the bot says so without setting out; one block
        // flush with flat ground that far off may also not be, and then it is found on the way.
        const found = new RegExp(`^Found sand .* at ${at(X, 0, Z).x}, ${at(X, 0, Z).y}, ${at(X, 0, Z).z}, after exploring`);
        if (LIVE_VIEW === 'narrow') assert.match(trip.text, found);
        else assert.ok(found.test(trip.text) || new RegExp(`^sand is .* at ${at(X, 0, Z).x}, ${at(X, 0, Z).y}, ${at(X, 0, Z).z}\\. No need to explore`).test(trip.text), trip.text);
        assert.ok(trip.dx < X + 16, `stopped instead of walking on: ${JSON.stringify(trip)}`);
        return trip;
    });

} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        if (origin) for (const z of Object.values(STRIPS)) await clearStrip(z);
        if (origin) await cmd(`tickingarea remove ${AREA}`);
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
