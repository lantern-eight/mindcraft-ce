// SPDX-License-Identifier: CC0-1.0
// Putting away and fetching on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_stow.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of stow_scenarios.js. What depends on the edition: a move into or out of a chest is an
// item stack request on Bedrock, and the chest's window is the adapter's. The same storage room: the bot's
// own chests, a shared one, Alice's and one nobody has said is anyone's.
//
// The console fills the chests. It can't read them back on Bedrock, so they are read by opening them with
// the bot's own hands from before fair play was installed: what a chest holds when it opens is what the
// server says, so nothing the bot believes is taken on trust.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const NAME = 'BedrockStower';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);
const tpTo = (cell, yaw = 0, settle = 1500) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);

async function waitFor(check, ms, why) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(why());
}

// A row of chests along one wall, two blocks apart so none pairs into a double chest.
const OWN = [-4, 1, -4], SHARED = [-2, 1, -4], ALICE = [0, 1, -4], UNKNOWN = [2, 1, -4], SPARE = [4, 1, -4];
// A sign on top of the shared chest, and a chest placed later to be the inbox.
const SIGN = [-2, 2, -4], INBOX = [6, 1, -4];

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, chest_sorting: true, store_and_fetch: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { stackOf } = await import('../../src/agent/storage/bot_hands.js');

    let agent, handle, rawOpen;
    const carried = name => bot.inventory.items().filter(item => item.name === name).reduce((n, item) => n + item.count, 0);

    await step('the bot joins, the room is built, and putting away is installed with fair play and world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]);
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await cmd('time set noon');
        await fill([-10, 1, -10], [10, 6, 10], 'air');
        await fill([-10, 0, -10], [10, 0, 10], 'stone');
        for (const cell of [OWN, SHARED, ALICE, UNKNOWN, SPARE]) await set(cell, 'chest');
        await cmd(`clear ${NAME}`);
        // A sign's text is a player's to write, and the console can't: the bot writes it with its own hands,
        // before fair play is installed. A Bedrock server takes a sign's text only from a player it opened the
        // sign for, so the bot clicks the sign first, as a player does.
        await set(SIGN, 'standing_sign');
        await tpTo([SIGN[0], 1, SIGN[2] + 2], 180);
        const sign = bot.blockAt(at(...SIGN));
        const opened = once(bot, 'signOpen');
        await bot.activateBlock(sign);
        await Promise.race([opened, delay(5000).then(() => { throw new Error('The server never opened the sign'); })]);
        bot.updateSign(sign, 'Wood');
        await delay(800);
        await tpTo([0, 1, 0], 180);
        for (const give of ['cobblestone 64', 'cobblestone 40', 'oak_log 12', 'wheat 12', 'iron_pickaxe 1', 'stone_pickaxe 1', 'stone_pickaxe 1 100', 'bread 6', 'dirt 5']) {
            await cmd(`give ${NAME} ${give}`, 400);
        }
        rawOpen = bot.openContainer;
        agent = {
            name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [], memory_bank: new MemoryBank(),
            prompter: { profile: {}, getInitModes: () => ({}) },
            self_prompter: { isActive: () => false, stopLoop: () => {} },
            openChat: () => {}, handleMessage: async (source, run) => (typeof run === 'function' ? run() : undefined),
            clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
            requestInterrupt: () => {
                bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
            },
            isIdle: () => !agent.actions.executing,
        };
        agent.actions = new ActionManager(agent);
        initModes(agent);
        handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-stow-')) });
        assert.ok(handle?.memory, 'fair play and world memory are on');
        const storage = installStorage(agent, { bookDir: mkdtempSync(path.join(tmpdir(), 'bedrock-stow-book-')) });
        assert.ok(storage?.commands?.includes('!putAway') && storage.commands.includes('!fetchItem'), 'putting away and fetching are on');
    });

    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const run = async (source, command, args, seconds = 150) => {
        let timer;
        const stuck = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${command} did not finish in ${seconds} s: ${bot.output}`)), seconds * 1000);
        });
        try { return await Promise.race([agent.handleMessage(source, () => getCommand(command).perform.structured(agent, ...args)), stuck]); }
        finally { clearTimeout(timer); }
    };
    const stock = async (cell, stacks) => {
        for (const [slot, text] of Object.entries(stacks)) {
            const [item, count = '1'] = text.split(' x');
            await cmd(`replaceitem block ${xyz(at(...cell))} slot.container ${slot} ${item} ${count} 0`, 120);
        }
        await delay(300);
    };
    /** What is really in a chest, slot by slot, as "name xN": opened by the test's own hands, which the server answers. */
    // From two blocks in front of it: a Bedrock chest opens only within reach, and after putting away the bot can
    // stand at one end of the row, eight blocks from the other.
    const read = async cell => {
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
        await tpTo([cell[0], 1, cell[2] + 2], 180, 600);
        const window = await rawOpen(bot.blockAt(at(...cell)));
        try {
            return Array.from({ length: window.inventoryStart }, (_, i) => stackOf(window.slots[i])).map(s => (s ? `${s.name} x${s.count}` : null));
        } finally {
            window.close();
            await delay(400);
        }
    };
    const countIn = (slots, name) => slots.reduce((n, s) => n + (s?.startsWith(`${name} x`) ? Number(s.split(' x')[1]) : 0), 0);

    let before;
    await step('the chests are filled, and a player says whose they are', async () => {
        await stock(OWN, { 0: 'cobblestone x10' });
        await stock(SHARED, { 0: 'oak_log x5', 1: 'iron_ingot x5' });
        await stock(ALICE, { 0: 'iron_ingot x20', 1: 'gold_ingot x3' });
        await stock(UNKNOWN, { 0: 'iron_ingot x30', 1: 'oak_log x7' });
        before = { alice: await read(ALICE), unknown: await read(UNKNOWN) };
        await bot.lookAt(at(0, 1, -4).offset(0.5, 0.5, 0.5), true);
        await settled();
        for (const [cell, owner] of [[OWN, NAME], [SPARE, NAME], [SHARED, 'shared'], [ALICE, 'Alice']]) {
            const c = at(...cell);
            assert.match(await agent.handleMessage('Alice', () => getCommand('!markChest').perform(agent, c.x, c.y, c.z, owner, 'same')), /is now|was already/);
        }
    });

    await step('"put your things away": each kind with its kind, a new one in the empty chest, what the bot needs stays with it', async () => {
        const result = await run('Alice', '!putAway', ['all', 'any', 16]);
        assert.equal(result.status, 'ok', result.text);
        assert.equal(countIn(await read(OWN), 'cobblestone'), 10 + 72, result.text);
        assert.equal(countIn(await read(SHARED), 'oak_log'), 5 + 12, result.text);
        assert.equal(countIn(await read(SPARE), 'wheat'), 12, result.text);
        assert.deepEqual(await read(ALICE), before.alice, 'Alice\'s chest is slot for slot as it was');
        assert.deepEqual(await read(UNKNOWN), before.unknown, 'the unknown chest is slot for slot as it was');
        assert.equal(carried('cobblestone'), 32);
        assert.equal(carried('iron_pickaxe'), 1);
        assert.equal(carried('stone_pickaxe'), 1);
        assert.equal(carried('bread'), 6);
        return { text: result.text.split('\n')[0] };
    });

    await step('"get me 12 iron" for Alice: the shared chest first, then hers; never the unknown one', async () => {
        const result = await run('Alice', '!fetchItem', ['iron_ingot', 12]);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /- 5 from the chest at .* \(shared\)\n- 7 from the chest at .* \(Alice's\)/, result.text);
        assert.equal(carried('iron_ingot'), 12);
        assert.equal(countIn(await read(ALICE), 'iron_ingot'), 13);
        assert.deepEqual(await read(UNKNOWN), before.unknown);
        return { text: result.text.split('\n')[0] };
    });

    await step('on its own idea the bot does not take from Alice\'s chest', async () => {
        const result = await run('system', '!fetchItem', ['iron_ingot', 5]);
        assert.equal(result.status, 'failed', result.text);
        assert.match(result.text, /it is Alice's and no player asked/, result.text);
        assert.equal(countIn(await read(ALICE), 'iron_ingot'), 13);
    });
    // ---- What a chest is for ----
    const chestsList = () => agent.handleMessage('Alice', () => getCommand('!chests').perform(agent, 16));
    const say = (command, cell, ...args) => {
        const c = at(...cell);
        return agent.handleMessage('Alice', () => getCommand(command).perform(agent, c.x, c.y, c.z, ...args));
    };

    await step('a sign over a chest says what it is for, and the list reads it as a sign, not a word', async () => {
        await tpTo([0, 1, 0], 180);
        await bot.lookAt(at(...SIGN).offset(0.5, 0.5, 0.5), true);
        await settled();
        const text = await chestsList();
        assert.match(text, /shared\.[^\n]*For wood, going by its sign\. A sign beside it says "Wood"/, text);
        return { text: text.split('\n').find(line => line.includes('Wood')) };
    });

    await step('a player says a chest is for tools: put-away follows that and the sign, over what each chest holds', async () => {
        assert.match(await say('!chestFor', SPARE, 'tools'), /For tools/);
        const was = { own: await read(OWN), shared: await read(SHARED), spare: await read(SPARE) };
        await tpTo([0, 1, 0], 180);
        for (const give of ['dirt 20', 'oak_log 8', 'stone_pickaxe 1']) await cmd(`give ${NAME} ${give}`, 400);
        const result = await run('Alice', '!putAway', ['all', 'any', 16]);
        assert.equal(result.status, 'ok', result.text);
        const now = { own: await read(OWN), shared: await read(SHARED), spare: await read(SPARE) };
        assert.equal(countIn(now.spare, 'stone_pickaxe') - countIn(was.spare, 'stone_pickaxe'), 1, `the pickaxe into the chest for tools: ${result.text}`);
        assert.equal(countIn(now.spare, 'dirt'), countIn(was.spare, 'dirt'), `no dirt into the chest for tools: ${result.text}`);
        assert.equal(countIn(now.own, 'dirt') - countIn(was.own, 'dirt'), 20, `the dirt into the chest for anything: ${result.text}`);
        assert.equal(countIn(now.shared, 'oak_log') - countIn(was.shared, 'oak_log'), 8, `logs into the chest whose sign says wood: ${result.text}`);
        assert.equal(countIn(now.shared, 'dirt'), countIn(was.shared, 'dirt'), 'no dirt under the wood sign');
        return { text: result.text.split('\n').slice(0, 4).join(' | ') };
    });

    await step('a chest named as the inbox becomes shared, and filing it puts each thing where it belongs', async () => {
        await set(INBOX, 'chest');
        await tpTo([0, 1, 0], 180);
        await bot.lookAt(at(...INBOX).offset(0.5, 0.5, 0.5), true);
        await settled();
        const named = await say('!chestFor', INBOX, 'inbox');
        assert.match(named, /The inbox.*it is now shared/, named);
        await stock(INBOX, { 0: 'oak_log x6', 1: 'iron_ingot x4', 2: 'bone x5', 3: 'cobblestone x7' });
        const was = { shared: await read(SHARED), spare: await read(SPARE) };
        const bag = ['oak_log', 'iron_ingot', 'bone', 'cobblestone'].map(carried);
        await tpTo([0, 1, 0], 180);
        const result = await run('Alice', '!fileInbox', ['any', 16]);
        assert.equal(result.status, 'ok', result.text);
        assert.deepEqual((await read(INBOX)).filter(Boolean), [], `the inbox is empty: ${result.text}`);
        assert.equal(countIn(await read(SHARED), 'oak_log') - countIn(was.shared, 'oak_log'), 6, `logs under the wood sign: ${result.text}`);
        assert.deepEqual(await read(SPARE), was.spare, 'nothing into the chest for tools');
        assert.deepEqual(['oak_log', 'iron_ingot', 'bone', 'cobblestone'].map(carried), bag, 'the bot keeps what it carried, its cobblestone too');
        assert.deepEqual(await read(UNKNOWN), before.unknown, 'the unknown chest is slot for slot as it was');
        return { text: result.text.split('\n').slice(0, 3).join(' | ') };
    });
} catch (error) {
    console.error(error);
} finally {
    try {
        if (origin) await fill([-10, 0, -10], [10, 6, 10], 'air');
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
