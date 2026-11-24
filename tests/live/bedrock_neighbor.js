// SPDX-License-Identifier: CC0-1.0
// Good-neighbor rules on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_neighbor.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scenes are built and torn down from the console.
//
// The Bedrock twin of neighbor_scenarios.js: a player's plank wall that is the only way on stays whole, a
// plank the bot is told to break is refused with the reason, and collecting logs fells a tree and leaves a
// log cabin beside it standing. Bedrock names blocks and keeps leaves' state its own way, which the edition
// seam answers; this checks the answers hold on a real server. The tree is built from the console, since a
// Bedrock console can't be trusted to pass a feature's name: leaves set there are grown leaves, as a tree's are.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const NAME = 'BedrockNeighbor';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);
// The middle of a cell, with the way to face: 0 is south, 90 west, 180 north, -90 east.
const tpTo = (cell, yaw = 0, settle = 1500) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);

try {
    const config = { ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true,
        good_neighbor: { protect_builds: true, protect_chests: true, protect_animals: true, protected_areas: [] } };
    setSettings(config);
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
    const skills = await import('../../src/agent/library/skills.js');

    let agent, act;
    const rawName = cell => bot.blockAt(at(...cell))?.name; // the test may peek at the truth; the bot may not
    const countIn = (name, [x0, y0, z0], [x1, y1, z1]) => {
        let n = 0;
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (rawName([x, y, z]) === name) n++;
        return n;
    };

    // A stone platform high above the ground, the bot in the middle, with empty air above.
    async function reset(yaw = 0) {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        await fill([-14, 1, -14], [14, 12, 14], 'air');
        await fill([-14, 0, -14], [14, 0, 14], 'stone');
        await cmd(`clear ${NAME}`);
        await tpTo([0, 1, 0], yaw);
        await cmd(`give ${NAME} iron_pickaxe 1`, 500);
        await cmd(`give ${NAME} iron_axe 1`, 700);
    }

    await step('the bot joins, and fair play and good-neighbor rules are installed', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]);
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await cmd('difficulty peaceful');
        await cmd('time set noon');
        await reset();
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
        const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-neighbor-memory-')) });
        assert.ok(handle?.memory, 'fair play with world memory');
        assert.ok(installGoodNeighbor(agent, { config }), 'good-neighbor rules installed');
        act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 1 });
        await delay(1500);
    });

    await step('a plank wall that is the only way on stays whole', async () => {
        await reset();
        // A closed room of bedrock, which nobody can dig, cut in two by a player's plank wall.
        await fill([-4, 0, -1], [4, 4, 11], 'bedrock');
        await fill([-3, 1, 0], [3, 3, 10], 'air');
        await fill([-3, 1, 5], [3, 3, 5], 'oak_planks');
        await tpTo([0, 1, 1]);
        const result = await act('test:go', () => skills.goToPosition(bot, at(0, 1, 9).x, at(0, 1, 9).y, at(0, 1, 9).z, 1));
        assert.equal(countIn('oak_planks', [-3, 1, 5], [3, 3, 5]), 21, `the wall is whole: ${result.text}`);
        assert.ok(bot.entity.position.z < at(0, 1, 5).z, 'and the bot is still on its own side of it');
        return { text: result.text.trim().slice(-200) };
    });

    await step('told to break a plank, the bot refuses and says why', async () => {
        await reset();
        await set([0, 1, 2], 'oak_planks');
        await delay(1500);
        const p = at(0, 1, 2);
        const result = await act('test:break', () => skills.breakBlockAt(bot, p.x, p.y, p.z));
        assert.equal(rawName([0, 1, 2]), 'oak_planks');
        assert.match(result.text, /Breaking oak_planks at .* refused: (I saw someone put it there|oak_planks isn't natural ground)/);
        return { text: result.text.trim() };
    });

    await step('collecting logs fells the tree, and leaves the log cabin beside it standing', async () => {
        await reset(-90); // east
        // A tree to the east: a trunk on grass under a blob of grown leaves.
        await fill([5, 0, -2], [9, 0, 2], 'grass_block');
        await fill([5, 4, -2], [9, 6, 2], 'oak_leaves');
        await fill([6, 7, -1], [8, 7, 1], 'oak_leaves');
        await fill([7, 1, 0], [7, 6, 0], 'oak_log');
        // A log cabin to the west: log walls with a plank frame.
        await fill([-9, 1, -3], [-5, 4, 3], 'oak_log');
        await fill([-8, 1, -2], [-6, 3, 2], 'air');
        await fill([-5, 1, -1], [-5, 3, 1], 'oak_planks');
        await delay(2000);
        const tree = [[5, 1, -2], [9, 8, 2]], cabin = [[-9, 1, -3], [-5, 4, 3]];
        const treeLogs = countIn('oak_log', ...tree), cabinLogs = countIn('oak_log', ...cabin);
        const result = await act('test:collect', () => skills.collectBlock(bot, 'oak_log', 3));
        assert.equal(countIn('oak_log', ...cabin), cabinLogs, `the cabin is whole: ${result.text}`);
        const felled = treeLogs - countIn('oak_log', ...tree);
        assert.ok(felled >= 1, `some of the tree was felled: ${result.text}`);
        return { felled, text: result.text.trim().slice(-200) };
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        if (origin) await cmd(`fill ${xyz(at(-14, -2, -14))} ${xyz(at(14, 12, 14))} air`);
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
