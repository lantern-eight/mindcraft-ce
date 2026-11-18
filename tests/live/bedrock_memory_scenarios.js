// SPDX-License-Identifier: CC0-1.0
// World memory as the agent runs it, on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_memory_scenarios.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of memory_scenarios.js. bedrock_memory.js runs the recorder by itself; this installs
// world memory with fair play by its normal hook and checks what the model is told: a chest opened and
// walked away from, the trail back to it, a saved place, a sign, and the changes the bot notices when it
// comes back to a place after a minute. One step waits a minute on purpose: a change counts as news only
// when the bot had not seen the spot for that long.
//
// Java's scenario sends the bot far away for that minute, and keeps the place loaded meanwhile. Here the
// bot is boxed in where it stands instead, which hides the place from it just the same and keeps it
// loaded, with no long trip on a world the test doesn't know.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay } from './bedrock_fixture.js';

const NAME = 'BedrockRecall';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);

async function waitFor(check, ms, why) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(why());
}

// A stone platform high above the ground with the bot in the middle, a double chest a few blocks east
// (two chests side by side, which the server pairs) and, well away from it, a sign.
const CHEST = [[4, 1, 0], [5, 1, 0]];
const SIGN = [-6, 1, 6];

async function buildScene() {
    await fill([-20, 1, -20], [20, 8, 20], 'air');
    await fill([-20, 0, -20], [20, 0, 20], 'stone');
    for (const cell of CHEST) await set(cell, 'chest');
    await cmd(`replaceitem block ${xyz(at(...CHEST[0]))} slot.container 0 iron_ingot 30`, 150);
    await cmd(`replaceitem block ${xyz(at(...CHEST[0]))} slot.container 5 bread 6`, 150);
    await set(SIGN, 'standing_sign');
}

// A box of stone around the bot's body, diagonals and lid included, which hides everything else from it.
// The bot stands a quiet minute inside it looking at the stone, so the box opening is something it
// watched happen, and no news; what changed outside the box while it couldn't see is.
const BOX = [[[-1, 1, -1], [1, 3, -1]], [[-1, 1, 1], [1, 3, 1]], [[-1, 1, 0], [-1, 3, 0]], [[1, 1, 0], [1, 3, 0]], [[0, 3, 0], [0, 3, 0]]];
const box = async block => { for (const [a, b] of BOX) await fill(a, b, block); };

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), fair_play: 'strict', world_memory: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const skills = await import('../../src/agent/library/skills.js');

    let agent, handle;
    const sent = [];
    const memory = () => handle.memory;
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 1 });
    const recall = what => getCommand('!recall').perform(agent, what);
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const walkTo = cell => act('test:walk', () => skills.goToPosition(bot, at(...cell).x, at(...cell).y, at(...cell).z, 0));

    await step('the bot joins, the scene is built, and world memory is installed with fair play', async () => {
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
        await cmd('time set noon');
        await buildScene();
        // A sign's text is a player's to write, and the console can't: the test writes it with the bot's
        // own hands, in front of it, before memory is watching. A Bedrock server takes a sign's text only
        // from a player it opened the sign for, so the bot clicks the sign first, as a player does.
        await cmd(`tp ${NAME} ${at(-6, 1, 8).x + 0.5} ${at(-6, 1, 8).y} ${at(-6, 1, 8).z + 0.5}`, 1500);
        const sign = bot.blockAt(at(...SIGN));
        const opened = once(bot, 'signOpen');
        await bot.activateBlock(sign);
        await Promise.race([opened, delay(5000).then(() => { throw new Error('The server never opened the sign'); })]);
        bot.updateSign(sign, 'Iron\nin the east');
        await delay(800);
        await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y + 1} ${origin.z + 0.5} -90 0`, 1500);
        agent = {
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
        handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-memory-live-')) });
        assert.ok(handle?.memory, 'world memory is on');
        await delay(1500);
        await settled();
    });

    await step('what is in view is remembered from real chunk data, and what is under the platform is not', () => {
        const cells = memory().cells;
        const floor = at(3, 0, 3), above = at(3, 1, 3), below = at(0, -10, 0);
        assert.equal(cells.read(floor.x, floor.y, floor.z), 'stone', 'the platform it stands on');
        assert.equal(cells.read(above.x, above.y, above.z), 'air', 'the air just above it was seen empty');
        assert.equal(cells.read(below.x, below.y, below.z), null, 'nothing under the platform was seen');
        assert.ok(memory().scope.endsWith('/overworld'), memory().scope);
    });

    await step('the double chest is one thing, and it makes a place', () => {
        const things = memory().things;
        assert.equal(things.count('chest'), 1, 'the two halves are one chest');
        const c = at(...CHEST[1]);
        const chest = things.get(c.x, c.y, c.z);
        assert.equal(chest.kind, 'container');
        assert.ok(chest.also, 'with its other half');
        const places = getCommand('!places').perform(agent);
        assert.match(places, /an unnamed site near [^\n]*chest 1/, places);
    });

    await step('the sign is remembered with what it says, as a player wrote it', () => {
        const s = at(...SIGN);
        const sign = memory().things.get(s.x, s.y, s.z);
        assert.equal(sign?.kind, 'sign', JSON.stringify(sign));
        assert.equal(sign.text, 'Iron / in the east');
    });

    await step('a full look-around fits in a few short slices', () => {
        bot.emit('blockUpdate', null, { position: bot.entity.position });
        const started = performance.now();
        handle.recorder.tick({ budgetMs: Infinity });
        const whole = performance.now() - started;
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
        await walkTo([2, 1, 0]);
        const container = await bot.openContainer(bot.blockAt(at(...CHEST[0])));
        await delay(400);
        container.close();
        await delay(400);
        const c = at(...CHEST[0]);
        assert.deepEqual(memory().things.get(c.x, c.y, c.z).contents.items, { iron_ingot: 30, bread: 6 });
        await walkTo([-14, 1, 0]);
        const iron = recall('iron');
        assert.match(iron, /^IN CONTAINERS YOU OPENED\n- chest at .*: iron_ingot 30 \(looked .*\), 1\d blocks east, about \d+ seconds on foot by a way you know/, iron);
        return { recall: iron.split('\n')[1] };
    });

    await step('walking laid a trail it can route back along', () => {
        const trail = memory().trail;
        assert.ok(trail.size >= 4, `only ${trail.size} crumbs`);
        const from = trail.nearest(bot.entity.position, { maxDistance: 6 });
        const to = trail.nearest(at(2, 1, 0), { maxDistance: 6 });
        const route = trail.route(from.id, to.id);
        assert.ok(route, 'no route back to the chest');
        return { crumbs: trail.size, routeSeconds: Number(route.seconds.toFixed(1)), stops: route.ids.length };
    });

    await step('saved places are kept in world memory', async () => {
        assert.match(await getCommand('!rememberHere').perform(agent, 'west end'), /saved/);
        assert.equal(memory().places.byName('west end').kind, 'named');
        assert.match(recall('west end'), /^PLACE\n- "west end"/);
    });

    await step('L3 and A6: after a minute unable to see, it notices a new hut and a missing chest, and says so once', async () => {
        await walkTo([0, 1, 0]);
        // A walk on Bedrock can end a third of a block off the middle (docs/bedrock.md), and the box must
        // not close on the bot's body: it is put in the middle first.
        await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y + 1} ${origin.z + 0.5}`, 1000);
        await settled();
        await box('stone');
        await delay(800);
        await fill([8, 1, -8], [12, 3, -4], 'oak_planks');
        await fill([9, 1, -7], [11, 2, -5], 'air');
        // Emptied first, so taking the chest away leaves nothing lying on the platform.
        for (const slot of [0, 5]) await cmd(`replaceitem block ${xyz(at(...CHEST[0]))} slot.container ${slot} air`, 150);
        for (const cell of CHEST) await set(cell, 'air');
        await delay(61_000);
        await box('air');
        await delay(1500);
        await settled();
        await delay(2500); // the two quiet seconds before a group of differences becomes a note
        await settled();
        const result = await act('test:noop', async () => true);
        const text = result.text ?? result.message ?? '';
        assert.match(text, /Noticed .*Gone: chest 1\./, text);
        assert.match(text, /Noticed .*New: oak_planks \d+\./, text);
        assert.doesNotMatch(text, /Gone: [^.]*stone/, `it watched its box of stone open: ${text}`);
        assert.ok(Number(text.match(/oak_planks (\d+)/)[1]) >= 20, `the walls it can see are counted, not only the ground row: ${text}`);
        assert.equal(memory().things.count('chest'), 0);
        const again = await act('test:noop', async () => true);
        assert.doesNotMatch(again.text ?? again.message ?? '', /Noticed/, 'a note is passed on once');
        assert.match(recall('changes'), /^CHANGES YOU NOTICED/);
        return { notes: text.split('\n').filter(line => line.startsWith('Noticed')) };
    });

    await step('memory is saved, in small files', () => {
        assert.equal(memory().save(), 0);
        const dir = memory().dir;
        const files = readdirSync(dir);
        for (const name of ['trail.json', 'things.json', 'places.json', 'cells']) assert.ok(files.includes(name), `${name} is missing`);
        const regions = readdirSync(path.join(dir, 'cells')).filter(name => name.endsWith('.bin'));
        const bytes = regions.reduce((sum, name) => sum + statSync(path.join(dir, 'cells', name)).size, 0);
        return { regionFiles: regions.length, cellBytes: bytes, trailBytes: statSync(path.join(dir, 'trail.json')).size };
    });

    await step('after all of that, the bot sent no command', () => {
        assert.ok(!sent.includes('command_request'), 'no command was sent');
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try { if (origin) await fill([-20, 0, -20], [20, 8, 20], 'air'); } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
