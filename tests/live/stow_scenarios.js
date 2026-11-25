// SPDX-License-Identifier: CC0-1.0
// Live scenarios for putting away and fetching, against a real server (no model calls, free to run).
//   node tests/live/stow_scenarios.js [--port=55948]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// A storage room several people share: the bot's own chests, a shared one, Alice's, and one nobody has
// said is anyone's. The bot is told whose they are with the commands a model would use, then asked to put
// its things away and to fetch iron. The server console is the "director": it fills the chests and reads
// them back itself, so nothing the bot believes is taken on trust. The checks: things land where they
// belong, what the bot keeps stays in its bag, the chests it may not use are slot for slot as they were,
// and a fetch takes from the chests in the order the take/put rule gives.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55948);
const NAME = 'Stower';
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', ...fairPlaySettings(),
        world_memory: true, chest_sorting: true, store_and_fetch: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [], memory_bank: new MemoryBank(),
        prompter: { profile: {}, getInitModes: () => ({}) },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        // A message here is a piece of the test to run while that message is being handled: that is how
        // the bot is told who is behind what it does (a player's name, or "system" for its own idea).
        openChat: () => {}, handleMessage: async (source, run) => (typeof run === 'function' ? run() : undefined),
        clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt: () => {
            bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
        },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'stow-live-')) });
    assert.ok(handle?.memory, 'fair play and world memory are on');
    const storage = installStorage(agent, { bookDir: mkdtempSync(path.join(tmpdir(), 'stow-live-book-')) });
    assert.ok(storage?.commands.includes('!putAway') && storage.commands.includes('!fetchItem'), 'putting away and fetching are on');

    /** Runs a command as a model would, while a message from `source` is handled; fails instead of hanging. */
    const run = async (source, command, args, seconds = 120) => {
        let timer;
        const stuck = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${command} did not finish in ${seconds} s at ${bot.entity.position.floored()}: ${bot.output}`)), seconds * 1000);
        });
        try { return await Promise.race([agent.handleMessage(source, () => getCommand(command).perform.structured(agent, ...args)), stuck]); }
        finally { clearTimeout(timer); }
    };
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };

    // ---- The director's side ----
    const fill = async ([x, y, z], stacks) => {
        for (const [slot, text] of Object.entries(stacks)) {
            const [item, count = '1'] = text.split(' x');
            await cmd(`item replace block ${x} ${y} ${z} container.${slot} with ${item} ${count}`);
        }
    };
    const entries = text => {
        const out = [];
        let depth = 0, start = -1;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '{' && depth++ === 0) start = i;
            else if (text[i] === '}' && --depth === 0) out.push(text.slice(start, i + 1));
        }
        return out;
    };
    /** What is really in a chest, slot by slot, as "name xN", from the server's console. */
    const read = async ([x, y, z]) => {
        const mark = server.log.length;
        await cmd(`data get block ${x} ${y} ${z} Items`);
        const answer = /has the following block data: (.*)/;
        await waitFor(() => answer.test(server.log.slice(mark)), 5000, () => `no answer about the block at ${x}, ${y}, ${z}`);
        const slots = new Array(27).fill(null);
        for (const entry of entries(server.log.slice(mark).match(answer)[1])) {
            slots[Number(entry.match(/Slot: (\d+)b/)[1])] = `${entry.match(/id: "minecraft:([a-z0-9_]+)"/)[1]} x${Number(entry.match(/count: (\d+)/)?.[1] ?? 1)}`;
        }
        return slots;
    };
    const countIn = (slots, name) => slots.reduce((n, s) => n + (s?.startsWith(`${name} x`) ? Number(s.split(' x')[1]) : 0), 0);
    const carried = name => bot.inventory.items().filter(item => item.name === name).reduce((n, item) => n + item.count, 0);

    // A storage room on a stone floor: a row of chests along one wall, the bot standing in front of them.
    const OWN = [-4, 70, -10], SHARED = [-2, 70, -10], ALICE = [0, 70, -10], UNKNOWN = [2, 70, -10], SPARE = [4, 70, -10];
    await cmd('fill -12 69 -16 12 69 4 stone');
    await cmd('fill -12 70 -16 12 78 4 air');
    for (const [x, y, z] of [OWN, SHARED, ALICE, UNKNOWN, SPARE]) await cmd(`setblock ${x} ${y} ${z} chest[facing=south]`);
    await fill(OWN, { 0: 'cobblestone x10' });
    await fill(SHARED, { 0: 'oak_log x5', 1: 'iron_ingot x5' });
    await fill(ALICE, { 0: 'iron_ingot x20', 1: 'gold_ingot x3' });
    await fill(UNKNOWN, { 0: 'iron_ingot x30', 1: 'oak_log x7' });
    await cmd(`clear ${NAME}`);
    for (const give of ['cobblestone 64', 'cobblestone 40', 'oak_log 12', 'wheat 12', 'iron_pickaxe', 'stone_pickaxe', 'stone_pickaxe[damage=100]', 'bread 6', 'dirt 5']) {
        await cmd(`give ${NAME} ${give}`);
    }
    await cmd(`tp ${NAME} 0.5 70 -6.5 180 10`);
    await delay(1500);
    await bot.lookAt(new Vec3(0.5, 70.5, -9.5), true);
    await settled();
    const before = { alice: await read(ALICE), unknown: await read(UNKNOWN) };

    await step('a player says whose the chests are', async () => {
        for (const [pos, owner] of [[OWN, NAME], [SPARE, NAME], [SHARED, 'shared'], [ALICE, 'Alice']]) {
            assert.match(await agent.handleMessage('Alice', () => getCommand('!markChest').perform(agent, ...pos, owner, 'same')), /is now|was already/);
        }
    });

    await step('"put your things away": each kind with its kind, a new one in the empty chest, what the bot needs stays with it', async () => {
        const result = await run('Alice', '!putAway', ['all', 'any', 16], 180);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /1 chest with no known owner, not used: 2, 70, -10/, result.text);
        assert.equal(countIn(await read(OWN), 'cobblestone'), 10 + 72, `cobblestone joins the bot's own: ${result.text}`);
        assert.equal(countIn(await read(SHARED), 'oak_log'), 5 + 12, `logs join the logs: ${result.text}`);
        assert.equal(countIn(await read(SPARE), 'wheat'), 12, `a new group starts the empty chest: ${result.text}`);
        assert.deepEqual(await read(ALICE), before.alice, 'Alice\'s chest is slot for slot as it was');
        assert.deepEqual(await read(UNKNOWN), before.unknown, 'the unknown chest is slot for slot as it was');
        assert.equal(carried('cobblestone'), 32);
        assert.equal(carried('iron_pickaxe'), 1);
        assert.equal(carried('stone_pickaxe'), 1, 'one stone pickaxe is the spare');
        const kept = bot.inventory.items().find(item => item.name === 'stone_pickaxe');
        assert.ok(!(kept.durabilityUsed > 0), 'the spare kept is the unworn one');
        assert.equal(carried('bread'), 6);
        assert.equal(carried('wheat') + carried('oak_log') + carried('dirt'), 0, `nothing else is carried: ${bot.inventory.items().map(i => i.name)}`);
        return { text: result.text };
    });

    await step('"get me 12 iron" for Alice: the shared chest first, then hers; never the unknown one', async () => {
        const result = await run('Alice', '!fetchItem', ['iron_ingot', 12], 120);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /- 5 from the chest at -2, 70, -10 \(shared\)/, result.text);
        assert.match(result.text, /- 7 from the chest at 0, 70, -10 \(Alice's\)/, result.text);
        assert.equal(carried('iron_ingot'), 12);
        assert.equal(countIn(await read(ALICE), 'iron_ingot'), 13);
        assert.deepEqual(await read(UNKNOWN), before.unknown, 'the unknown chest is slot for slot as it was');
        return { text: result.text };
    });

    await step('on its own idea the bot does not take from Alice\'s chest, and says why', async () => {
        const result = await run('system', '!fetchItem', ['iron_ingot', 5], 60);
        assert.equal(result.status, 'failed', result.text);
        assert.match(result.text, /The chest at 0, 70, -10 held 13 iron_ingot when you last looked, but it is Alice's and no player asked/, result.text);
        assert.doesNotMatch(result.text, /Did you mean/, 'no other names are offered when the item itself is known to be somewhere');
        assert.equal(countIn(await read(ALICE), 'iron_ingot'), 13);
        return { text: result.text };
    });

    await step('putting one thing away puts all of it, and only in the chests it may use', async () => {
        const result = await run('Alice', '!putAway', ['iron_ingot', 'any', 16], 120);
        assert.equal(result.status, 'ok', result.text);
        assert.equal(carried('iron_ingot'), 0);
        assert.equal(countIn(await read(ALICE), 'iron_ingot'), 13);
        assert.deepEqual(await read(UNKNOWN), before.unknown);
        return { text: result.text };
    });

    // ---- What a chest is for ----
    const chestsList = () => agent.handleMessage('Alice', () => getCommand('!chests').perform(agent, 16));

    await step('a sign over a chest says what it is for, and the list reads it as a sign, not a word', async () => {
        const [x, y, z] = SHARED;
        await cmd(`setblock ${x} ${y + 1} ${z} oak_wall_sign[facing=south]{front_text:{messages:["Wood","","",""]}}`);
        await bot.lookAt(new Vec3(x + 0.5, y + 1.5, z + 0.5), true);
        await settled();
        const text = await chestsList();
        assert.match(text, /- chest at -2, 70, -10: shared\.[^\n]*For wood, going by its sign\. A sign beside it says "Wood"/, text);
        return { text };
    });

    await step('a player says a chest is for tools: put-away follows that and the sign, over what each chest holds', async () => {
        assert.match(await agent.handleMessage('Alice', () => getCommand('!chestFor').perform(agent, ...SPARE, 'tools')), /For tools/);
        const was = { own: await read(OWN), shared: await read(SHARED), spare: await read(SPARE) };
        for (const give of ['dirt 20', 'oak_log 8', 'stone_pickaxe']) await cmd(`give ${NAME} ${give}`);
        await delay(500);
        const result = await run('Alice', '!putAway', ['all', 'any', 16], 180);
        assert.equal(result.status, 'ok', result.text);
        const now = { own: await read(OWN), shared: await read(SHARED), spare: await read(SPARE) };
        // The spare chest holds dirt, and the bot's own chest a stone pickaxe: without what each is for, the
        // dirt would join the dirt and the pickaxe the pickaxe.
        assert.equal(countIn(now.spare, 'stone_pickaxe') - countIn(was.spare, 'stone_pickaxe'), 1, `the pickaxe into the chest for tools: ${result.text}`);
        assert.equal(countIn(now.spare, 'dirt'), countIn(was.spare, 'dirt'), `no dirt into the chest for tools: ${result.text}`);
        assert.equal(countIn(now.own, 'dirt') - countIn(was.own, 'dirt'), 20, `the dirt into the chest for anything: ${result.text}`);
        assert.equal(countIn(now.shared, 'oak_log') - countIn(was.shared, 'oak_log'), 8, `logs into the chest whose sign says wood: ${result.text}`);
        assert.equal(countIn(now.shared, 'dirt'), countIn(was.shared, 'dirt'), 'no dirt under the wood sign');
        const alice = await read(ALICE);
        assert.deepEqual([countIn(alice, 'iron_ingot'), countIn(alice, 'gold_ingot'), alice.filter(Boolean).length], [13, 3, 2], 'Alice\'s chest is as the fetch left it');
        return { text: result.text };
    });

    const INBOX = [6, 70, -10];
    await step('a chest named as the inbox becomes shared, and filing it puts each thing where it belongs', async () => {
        const [x, y, z] = INBOX;
        await cmd(`setblock ${x} ${y} ${z} chest[facing=south]`);
        await bot.lookAt(new Vec3(x + 0.5, y + 0.5, z + 0.5), true);
        await settled();
        const named = await agent.handleMessage('Alice', () => getCommand('!chestFor').perform(agent, ...INBOX, 'inbox'));
        assert.match(named, /The inbox.*it is now shared/, named);
        // Players drop things in it.
        await fill(INBOX, { 0: 'oak_log x6', 1: 'iron_ingot x4', 2: 'bone x5', 3: 'cobblestone x7' });
        const was = { shared: await read(SHARED), spare: await read(SPARE) };
        const bag = ['oak_log', 'iron_ingot', 'bone', 'cobblestone'].map(carried);
        const result = await run('Alice', '!fileInbox', ['any', 16], 180);
        assert.equal(result.status, 'ok', result.text);
        assert.deepEqual((await read(INBOX)).filter(Boolean), [], `the inbox is empty: ${result.text}`);
        assert.equal(countIn(await read(SHARED), 'oak_log') - countIn(was.shared, 'oak_log'), 6, `logs under the wood sign: ${result.text}`);
        assert.deepEqual(await read(SPARE), was.spare, 'nothing into the chest for tools');
        assert.deepEqual(['oak_log', 'iron_ingot', 'bone', 'cobblestone'].map(carried), bag, 'the bot keeps what it carried, its cobblestone too');
        assert.deepEqual(await read(UNKNOWN), before.unknown, 'the unknown chest is slot for slot as it was');
        return { text: result.text };
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
    process.exit(process.exitCode ?? 0);
}
