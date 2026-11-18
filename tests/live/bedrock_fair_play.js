// SPDX-License-Identifier: CC0-1.0
// Fair play as a whole, on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_fair_play.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of fairplay_scenarios.js. bedrock_perception.js checks sight on its own; this checks
// the whole thing put together the way a real agent runs it: fair play installed by its normal hook, with
// world memory, the reach guard, fair legs and the code runner, and Mindcraft's real skills and reflexes.
// The server console builds each scene, so the bot never needs a command or operator rights itself.
//
// A Bedrock server sends every block it has loaded, buried or not, so passing here means the rules hold
// with no help from the server.
//
// Where the Java scenes lean on something a Bedrock console can't do, the scene is changed and says so:
// a mob can't be summoned without its wits (Java's NoAI), so the zombie is penned instead; and there is no
// server log to read, so what the bot sends is watched as it leaves the client.
//
// Mindcraft's reflex to flee a hostile mob fires only when the bot could walk to it, so the zombie stands
// at the bottom of a pit two blocks deep, which it can't climb out of and the bot could drop into.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay } from './bedrock_fixture.js';

const NAME = 'BedrockFair';
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
const tpTo = (cell, yaw = 0, settle = 1200) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);

async function waitFor(check, ms, why) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(why());
}

// Everything is placed relative to the middle of a stone platform high above the ground, where the bot
// starts, facing east.
const LUMP = [[5, 1, -2], [9, 5, 2]];                   // east: a lump of stone...
const BURIED = [[7, 3, 0], [8, 2, -1], [7, 2, 1]];      // ...with three diamonds buried inside
const IN_VIEW = [5, 2, 0];                              // and later one on its face, in plain view
const CHEST = [0, 1, 8];                                // south: a sealed stone room with a chest in it
const PIT = [[-1, -1, -8], [1, 0, -6]];                 // north: a pit two blocks deep, for a zombie

async function buildScene() {
    await fill([-14, 1, -14], [14, 12, 14], 'air');
    await fill([-14, 0, -14], [14, 0, 14], 'stone');
    await fill(...LUMP, 'stone');
    for (const cell of BURIED) await set(cell, 'diamond_ore');
    await fill([-2, 1, 6], [2, 4, 10], 'stone');
    await fill([-1, 1, 7], [1, 3, 9], 'air');
    await set(CHEST, 'chest');
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), fair_play: 'strict', world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { SEARCH_HINT } = await import('../../src/agent/fairplay/commands.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const skills = await import('../../src/agent/library/skills.js');

    let agent, handle, act;
    const sent = []; // the name of every packet the bot sends, to show no command ever left it
    const count = item => bot.inventory.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
    const rawName = cell => bot.blockAt(at(...cell))?.name; // the test may peek at the truth; the bot may not

    await step('the bot joins, the scene is built, and fair play is installed with world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        for (const method of ['write', 'queue']) {
            const send = bot._client[method].bind(bot._client);
            bot._client[method] = (name, ...rest) => { sent.push(name); return send(name, ...rest); };
        }
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await cmd('difficulty peaceful');
        await cmd('time set noon');
        await buildScene(); // straight above the bot, in chunks it already has
        await cmd(`clear ${NAME}`);
        await tpTo([0, 1, 0], -90, 2500);
        await cmd(`give ${NAME} iron_pickaxe 1`, 700);
        await cmd(`give ${NAME} dirt 8`, 700);
        assert.equal(rawName([0, 0, 0]), 'stone', 'the bot stands on the platform');

        // The parts of a Mindcraft agent that skills, reflexes and fair play use, without a model behind them.
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
        bot.on('mining_progress', ({ message }) => agent.actions.reportProgress(message));
        initModes(agent);
        // What the bot remembers goes to a throwaway folder, never into this repository.
        handle = installFairPlay(agent, {
            memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-fair-memory-')),
        });
        assert.ok(handle, 'fair play installed');
        assert.ok(handle.memory, 'world memory is on');
        assert.ok(handle.legs, 'routes are planned over what the bot has seen');
        assert.match(handle.scope, /^world:[0-9a-f]{16}\//, `memory is kept by the world's name: ${handle.scope}`);
        act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 1 });
        await delay(1500);
        return { scope: handle.scope };
    });

    await step('V1: the bot is a plain survival player, and a slash command it tries never leaves the client', async () => {
        assert.equal(bot.game.gameMode, 'survival');
        assert.equal(handle.violation, null);
        bot.chat('/give @s diamond 64');
        await delay(1200);
        assert.equal(count('diamond'), 0);
        assert.ok(!sent.includes('command_request'), 'no command was sent');
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
        for (const cell of BURIED) assert.equal(rawName(cell), 'diamond_ore');
        return { text: result.text.replace(SEARCH_HINT, '').trim() };
    });

    await step('V3: with one diamond in view it mines that one, and the buried ones stay untouched', async () => {
        await set(IN_VIEW, 'diamond_ore');
        await delay(800);
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'diamond_ore', 3));
        assert.equal(result.broken, 1, result.text);
        assert.equal(count('diamond'), 1, result.text);
        for (const cell of BURIED) assert.equal(rawName(cell), 'diamond_ore', `the buried diamond at ${cell} is still there`);
        // Fetching the drop took no digging: the diamond's notch is the only change to the lump.
        const dug = [];
        for (let x = 5; x <= 9; x++) for (let y = 1; y <= 5; y++) for (let z = -2; z <= 2; z++) {
            const here = `${x},${y},${z}`;
            const expected = here === String(IN_VIEW) ? 'air' : BURIED.some(cell => String(cell) === here) ? 'diamond_ore' : 'stone';
            if (rawName([x, y, z]) !== expected) dug.push(`${here}:${rawName([x, y, z])}`);
        }
        assert.deepEqual(dug, [], 'only the diamond was dug');
        const recall = getCommand('!recall').perform(agent, 'diamond_ore');
        for (const cell of BURIED) assert.ok(!recall.includes(String(at(...cell)).replace(/[()]/g, '')), recall);
        return { text: result.text.replace(SEARCH_HINT, '').trim(), dirtPlaced: 8 - count('dirt') };
    });

    await step('R1: a chest two blocks behind a wall cannot be opened, though it is within reach', async () => {
        await tpTo([0, 1, 5], 0); // right up against the room's north wall
        const chest = bot.blockAt(at(...CHEST)); // the test hands it the real block; a skill never could
        const result = await act('test:open', () => bot.openContainer(chest));
        assert.equal(result.status, 'failed', result.text);
        assert.match(result.text, /can't see the block at/);
        assert.equal(bot.currentWindow ?? null, null, 'no window opened');
        await tpTo([0, 1, 0], 0);
    });

    // A Bedrock player reaches a block half a block farther than a Java player (5 blocks against 4.5). The
    // guard has to allow that, the server has to take it, and the guard still stops the bot past it.
    await step('reach: a block 4.8 blocks away, past Java\'s reach, is dug; one 5.3 away is refused', async () => {
        const block = [-5, 2, 0]; // west, at eye height: its near face is 4 blocks west of the middle of [0, 1, 0]
        // Stand east of the middle by a fraction, so the near face is that far from the eye, straight west.
        const standAt = async distance => {
            const feet = at(0, 1, 0);
            await cmd(`tp ${NAME} ${(feet.x - 4 + distance + 0.0001).toFixed(4)} ${feet.y} ${feet.z + 0.5} 90 0`, 1200);
        };
        try {
            await set(block, 'dirt');
            await standAt(4.8);
            await delay(500);
            const dug = await act('test:dig', () => bot.dig(bot.blockAt(at(...block))));
            assert.notEqual(dug.status, 'failed', dug.text);
            await waitFor(() => rawName(block) === 'air', 4000, () => `the server kept the dirt: ${dug.text}`);

            await set(block, 'dirt');
            await standAt(5.3);
            await delay(500);
            const refused = await act('test:dig', () => bot.dig(bot.blockAt(at(...block))));
            assert.equal(refused.status, 'failed', refused.text);
            assert.match(refused.text, /it is 5\.3 blocks away and you can reach 5\./);
            assert.equal(rawName(block), 'dirt');
            return { refused: refused.text.trim() };
        } finally {
            await set(block, 'air');
            await tpTo([0, 1, 0], 0);
        }
    });

    await step('V6: the chest in the sealed room is not found; once a doorway is opened it is, and the skill works', async () => {
        const dirt = count('dirt');
        const before = await act('test:chest', () => skills.putInChest(bot, 'dirt', 1));
        assert.match(before.text, /Could not find a chest nearby/);
        assert.equal(count('dirt'), dirt);
        await fill([0, 1, 6], [0, 2, 6], 'air'); // a doorway facing the bot
        await delay(800);
        const after = await act('test:chest', () => skills.putInChest(bot, 'dirt', 1));
        assert.equal(after.status, 'ok', after.text);
        await waitFor(() => count('dirt') === dirt - 1, 3000, () => `the bot holds ${count('dirt')} dirt, not ${dirt - 1}: ${after.text}`);
        assert.match(getCommand('!recall').perform(agent, 'chest'), /REMEMBERED chest/);
        return { text: after.text.trim() };
    });

    // Java's scene summons the zombie without its wits and opens a gap in a wall. A Bedrock console can't
    // do the first, so the zombie stands in a pit it can't climb out of, under a lid that is then lifted.
    await step('V5: a zombie under a lid triggers no reflex; once the lid is lifted and it is seen, the bot backs away', async () => {
        const [low, high] = PIT;
        await fill([low[0] - 1, low[1] - 1, low[2] - 1], [high[0] + 1, high[1], high[2] + 1], 'stone');
        await fill(low, high, 'air');
        await fill([low[0], 1, low[2]], [high[0], 1, high[2]], 'stone'); // the lid, on the platform
        await cmd('difficulty easy');
        await cmd('time set midnight'); // so it doesn't burn
        await tpTo([0, 1, -3], 180);
        const bottom = at(0, low[1], (low[2] + high[2]) / 2);
        await cmd(`summon zombie ${bottom.x + 0.5} ${bottom.y} ${bottom.z + 0.5}`, 1500);
        const zombies = () => Object.values(bot.entities).filter(e => e.name === 'zombie' && e.position.distanceTo(bottom) < 3);
        assert.equal(zombies().length, 1, 'the raw bot knows about the zombie');
        const start = bot.entity.position.clone();
        await bot.modes.update();
        await delay(300);
        assert.equal(agent.actions.executing, false, 'no reflex fired');
        // It may hear the zombie groan under the lid, and say so, but it must not list it as seen.
        const report = getCommand('!entities').perform(agent);
        assert.doesNotMatch(report, /entities: \d+ zombie/, report);
        await fill([low[0], 1, low[2]], [high[0], 1, high[2]], 'air');
        await delay(800);
        assert.match(getCommand('!entities').perform(agent), /entities: 1 zombie/, 'now it is seen');
        // Mindcraft's first reflex to a hostile mob in view is "cowardice": back away from it.
        await bot.modes.update();
        await waitFor(() => agent.actions.executing, 3000, () => 'no reflex fired once the zombie was in view');
        const reflex = agent.actions.currentActionLabel;
        await waitFor(() => !agent.actions.executing, 30000, () => 'the reflex never finished');
        const moved = bot.entity.position.distanceTo(start);
        assert.ok(moved > 5, `the bot moved away (${moved.toFixed(1)} blocks)`);
        await cmd('difficulty peaceful'); // which takes the zombie away
        await cmd('time set noon');
        await fill([low[0] - 1, low[1] - 1, low[2] - 1], [high[0] + 1, high[1] - 1, high[2] + 1], 'air');
        await fill([low[0], 0, low[2]], [high[0], 0, high[2]], 'stone');
        await tpTo([0, 1, 0], -90);
        return { reflex, moved: Number(moved.toFixed(1)), heardBeforeSeen: /heard: zombie/.test(report) };
    });

    await step('generated code, run by the fair-play code runner, finds only the diamond the bot has seen', async () => {
        await set(IN_VIEW, 'diamond_ore'); // another one where the first was
        await delay(800);
        const runner = handle.codeRunner();
        const found = await runner.compileBody([], `
            const all = bot.findBlocks({ matching: block => block.name === 'diamond_ore', maxDistance: 16, count: 10 });
            const buried = bot.blockAt(new Vec3(${at(...BURIED[0]).x}, ${at(...BURIED[0]).y}, ${at(...BURIED[0]).z}));
            return { all: all.map(p => [p.x, p.y, p.z]), buried: buried ? buried.name : null };
        `)();
        assert.deepEqual(found.all, [[at(...IN_VIEW).x, at(...IN_VIEW).y, at(...IN_VIEW).z]], JSON.stringify(found));
        assert.equal(found.buried, null);
        return found;
    });

    // Skills handed a spot by its coordinates look at the block before deciding anything from it
    // (look_first.js). The cell under the platform is open air below, but the bot stands on top.
    await step('told to break a block under the platform, the bot goes to look, and says it cannot see it rather than what it is', async () => {
        const hidden = [3, -1, 0];
        try {
            await set(hidden, 'diamond_ore');
            await delay(800);
            const target = at(...hidden);
            const result = await act('test:break', () => skills.breakBlockAt(bot, target.x, target.y, target.z));
            assert.notEqual(result.status, 'ok', result.text);
            assert.match(result.text, /can't see the block at/);
            assert.doesNotMatch(result.text, /diamond/);
            assert.equal(rawName(hidden), 'diamond_ore', 'and nothing was dug');
            return { text: result.text.trim() };
        } finally {
            await set(hidden, 'air');
            await tpTo([0, 1, 0], -90);
        }
    });

    // digDown under fair play digs a staircase (stairs_down.js): each block the bot stands on next is in
    // view first, so it never learns of lava under where a shaft would have gone.
    await step('digDown digs a staircase east, and never learns of the lava under where a shaft would have gone', async () => {
        const lava = [0, -3, 0];
        try {
            await fill([-2, -6, -2], [8, -1, 2], 'stone');
            await set(lava, 'lava');
            await tpTo([0, 1, 0], -90, 2000);
            await cmd(`give ${NAME} iron_pickaxe 1`, 700);
            const start = bot.entity.position.floored();
            const result = await act('test:dig', () => skills.digDown(bot, 3));
            assert.equal(result.status, 'ok', result.text);
            assert.match(result.text, /Dug down 3 blocks as a staircase heading east/);
            assert.doesNotMatch(result.text, /lava/);
            const end = bot.entity.position.floored();
            assert.equal(start.y - end.y, 3, `it went down ${start.y - end.y}`);
            assert.ok(end.x >= start.x + 2, `it went east, to x ${end.x - origin.x} from the middle`);
            assert.ok(['lava', 'flowing_lava'].includes(rawName(lava)), 'the lava under its first spot is untouched');
            return { text: result.text.trim() };
        } finally {
            await fill([-2, -6, -2], [8, -1, 2], 'air');
            await fill([-14, 0, -14], [14, 0, 14], 'stone'); // the platform, where the staircase began
            await tpTo([0, 1, 0], -90);
        }
    });

    await step('L4: made an operator, or put in creative, the bot refuses to act until that is undone', async () => {
        await cmd(`op ${NAME}`);
        await waitFor(() => handle.violation, 5000, () => 'the bot never noticed it was made an operator');
        assert.match(handle.violation, /operator/);
        const refused = await act('test:anything', async () => { throw new Error('this must not run'); });
        assert.equal(refused.status, 'blocked');
        assert.match(refused.text, /operator/);
        await cmd(`deop ${NAME}`);
        await waitFor(() => !handle.violation, 5000, () => `the violation never cleared: ${handle.violation}`);
        await cmd(`gamemode creative ${NAME}`);
        await waitFor(() => handle.violation, 5000, () => 'the bot never noticed creative mode');
        assert.match(handle.violation, /creative/);
        await cmd(`gamemode survival ${NAME}`);
        await waitFor(() => !handle.violation, 5000, () => `the violation never cleared: ${handle.violation}`);
    });

    await step('V2: after all of that, the bot sent no command', () => {
        assert.ok(sent.length > 100, `the packets the bot sent were watched (${sent.length})`);
        assert.ok(!sent.includes('command_request'), 'no command was sent');
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        if (origin) {
            await cmd('difficulty peaceful');
            await cmd('time set noon');
            await fill([-14, -2, -14], [14, 12, 14], 'air');
        }
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
