// SPDX-License-Identifier: CC0-1.0
// Chest sorting on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_storage.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The Bedrock twin of storage_scenarios.js, for what depends on the edition of the game: a move in a chest
// is an item stack request on Bedrock, not clicks; a double chest is paired in its block entity, not its
// state; and the chest's window is the adapter's. The rules about whose chest is sorted are the same code
// on both editions and are left to the Java scenarios.
//
// The console fills the chests. It can't read them back on Bedrock, so they are read by opening them with
// the bot's own hands from before fair play was installed: what a chest holds when it opens is what the
// server says, so nothing the sort believes is taken on trust.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay } from './bedrock_fixture.js';

const NAME = 'BedrockSorter';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const where = cell => xyz(at(...cell)).replaceAll(' ', ', ');
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

// Each scene's containers, by where they stand from the middle of the platform. A double chest is its two
// blocks side by side; Bedrock pairs two chests placed so, facing the same way.
const ONE = { 'the chest': [[-12, 1, -14]] };
const TWENTY = { 'the chest': [[12, 1, -14]] };
const FOUR = { chest: [[2, 1, 9]], double: [[4, 1, 9], [5, 1, 9]], barrel: [[7, 1, 9]], trapped: [[9, 1, 9]] };
const NAMED = [[-10, 1, 12], [-12, 1, 12]];

async function buildScene() {
    await fill([-20, 1, -20], [20, 8, 20], 'air');
    await fill([-20, 0, -20], [20, 0, 20], 'stone');
    for (const cell of [...ONE['the chest'], ...TWENTY['the chest'], FOUR.chest[0], ...FOUR.double, ...NAMED]) await set(cell, 'chest');
    await set(FOUR.barrel[0], 'barrel');
    await set(FOUR.trapped[0], 'trapped_chest');
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), fair_play: 'strict', world_memory: true, chest_sorting: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { planSort } = await import('../../src/agent/storage/sort_plan.js');
    const { GROUPS, grouper } = await import('../../src/agent/storage/item_groups.js');
    const { stackOf } = await import('../../src/agent/storage/bot_hands.js');

    let agent, handle, rawOpen;
    const sent = [];
    const pockets = () => bot.inventory.items().map(item => `${item.name} x${item.count}`).sort();

    await step('the bot joins, the scene is built, and chest sorting is installed with fair play and world memory', async () => {
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
        await cmd(`clear ${NAME}`);
        await tpTo([0, 1, 0]);
        await cmd(`give ${NAME} cobblestone 10`, 600);
        await cmd(`give ${NAME} iron_sword 1`, 600);
        // The test's own hands, kept before fair play wraps them: for reading chests back.
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
        handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-storage-')) });
        assert.ok(handle?.memory, 'fair play and world memory are on');
        const storage = installStorage(agent, { bookDir: mkdtempSync(path.join(tmpdir(), 'bedrock-storage-book-')) });
        assert.ok(storage?.commands?.includes('!sortChests'), 'chest sorting is on');
    });

    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    const sorting = async (command, args, seconds = 150) => {
        let timer;
        const stuck = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${command} did not finish in ${seconds} s: ${bot.output}`)), seconds * 1000);
        });
        try { return await Promise.race([getCommand(command).perform.structured(agent, ...args), stuck]); }
        finally { clearTimeout(timer); }
    };
    const sortChests = (whose, distance) => sorting('!sortChests', [whose, distance]);
    const say = (command, ...args) => getCommand(command).perform(agent, ...args);

    // ---- The director's side ----

    /** Puts stacks in a container block: slot -> 'item xN', with ' dD' for a data value (a tool's wear). */
    const stock = async (cell, stacks) => {
        for (const [slot, text] of Object.entries(stacks)) {
            const [, item, count = '1', data = '0'] = text.match(/^(\S+)(?: x(\d+))?(?: d(\d+))?$/);
            await cmd(`replaceitem block ${xyz(at(...cell))} slot.container ${slot} ${item} ${count} ${data}`, 120);
        }
        await delay(300);
    };
    /** What is really in a container, slot by slot: opened by the test's own hands, which the server answers. */
    const read = async cell => {
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
        const window = await rawOpen(bot.blockAt(at(...cell)));
        try {
            return Array.from({ length: window.inventoryStart }, (_, i) => stackOf(window.slots[i]));
        } finally {
            window.close();
            await delay(400);
        }
    };
    /** Reads a set of containers. A double chest is read once, through its first half: both open the same window. */
    const readAll = async chests => {
        const out = [];
        for (const [id, blocks] of Object.entries(chests)) out.push({ id, slots: await read(blocks[0]) });
        return out;
    };
    const totals = chests => {
        const sum = {};
        for (const chest of chests) for (const s of chest.slots) if (s) sum[s.key] = (sum[s.key] ?? 0) + s.count;
        return sum;
    };
    const show = slots => slots.filter(Boolean).map(s => `${s.name} x${s.count}`);
    const packed = slots => slots.slice(0, slots.filter(Boolean).length).every(Boolean);
    const options = () => ({
        stackSize: name => bot.registry.itemsByName[name]?.stackSize ?? 64,
        groupOf: grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) }), groupOrder: GROUPS,
    });
    const inOrder = chests => planSort(chests, options()).moves.length === 0;
    const layout = chests => JSON.stringify({ chests: chests.map(c => ({ id: c.id, slots: show(c.slots) })), stillToDo: planSort(chests, options()).moves.slice(0, 6) });

    await step('S1: one chest, two kinds scattered in part stacks: left alone until a player says it is hers, then merged, each kind together, nothing gained or lost', async () => {
        const [chest] = ONE['the chest'];
        await stock(chest, { 0: 'cobblestone x40', 3: 'oak_log x10', 7: 'cobblestone x30', 12: 'oak_log x60', 20: 'cobblestone x5' });
        await tpTo([chest[0] - 2, 1, chest[2] + 1], -90);
        await settled();
        const own = pockets();
        const before = await readAll(ONE);
        const refused = await sortChests('Alice', 6);
        assert.equal(refused.status, 'failed', refused.text);
        assert.match(refused.text, /Nothing was sorted\./, refused.text);
        assert.deepEqual(await readAll(ONE), before, 'the chest is slot for slot as it was');
        const c = at(...chest);
        assert.match(say('!markChest', c.x, c.y, c.z, 'Alice', 'same'), /is now Alice's, sorted only when asked/);
        const result = await sortChests('Alice', 6);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(ONE);
        assert.deepEqual(show(after[0].slots), ['oak_log x64', 'oak_log x6', 'cobblestone x64', 'cobblestone x11'], result.text);
        assert.ok(packed(after[0].slots), 'from the first slot, with no gaps');
        assert.match(result.text, new RegExp(`^Sorted 1 chest \\(Alice's\\) in \\d+ moves: 5 stacks are now 4\\.\\n- chest at ${where(chest)}: wood, stone \\(4 of 27 slots used\\)$`), result.text);
        assert.deepEqual(pockets(), own, 'the bot has exactly what it had before');
        return { text: result.text.split('\n')[0] };
    });

    await step('sorting it again moves nothing, and world memory knows what the chest holds now', async () => {
        const result = await sortChests('Alice', 6);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /^The chest here \(Alice's\) is already in order\. Nothing was moved\./, result.text);
        const recall = getCommand('!recall').perform(agent, 'cobblestone');
        assert.match(recall, new RegExp(`IN CONTAINERS YOU OPENED\\n- chest at ${where(ONE['the chest'][0])}: cobblestone 75 `), recall);
    });

    await step('S2: one chest with no free slot and twenty kinds: merged, grouped by category, then by name', async () => {
        const [chest] = TWENTY['the chest'];
        const kinds = ['iron_pickaxe', 'diamond_sword', 'bread', 'apple', 'iron_ingot', 'coal', 'diamond', 'oak_log', 'oak_planks', 'stick',
            'cobblestone', 'stone', 'dirt', 'sand', 'wheat_seeds', 'bone', 'string', 'redstone', 'glass', 'torch'];
        const stacks = {};
        const order = [...Array(27).keys()].sort((a, b) => (a * 7) % 27 - (b * 7) % 27);
        kinds.forEach((kind, i) => { stacks[order[i]] = kind.includes('_pickaxe') || kind.includes('_sword') ? kind : `${kind} x${10 + i}`; });
        kinds.slice(2, 9).forEach((kind, i) => { stacks[order[20 + i]] = `${kind} x${3 + i}`; });
        await stock(chest, stacks);
        await tpTo([chest[0] - 2, 1, chest[2] + 1], -90);
        await settled();
        const before = await readAll(TWENTY);
        assert.equal(before[0].slots.filter(Boolean).length, 27, `the chest starts full: ${show(before[0].slots)}`);
        const own = pockets();
        assert.match(say('!markChests', 'unknown', 6, NAME, 'same'), /^Marked 1 chest as your own, may always be sorted: /);
        const result = await sortChests('approved', 6);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(TWENTY);
        assert.deepEqual(totals(after), totals(before), 'nothing gained or lost');
        assert.equal(after[0].slots.filter(Boolean).length, 20, `one stack of each kind: ${show(after[0].slots)}`);
        assert.ok(packed(after[0].slots));
        assert.ok(inOrder(after), `a second sort would move nothing: ${layout(after)}`);
        assert.deepEqual(pockets(), own);
        return { order: show(after[0].slots).map(s => s.split(' ')[0]).join(' '), text: result.text.split('\n')[0] };
    });

    await step('S3: a chest, a double chest, a barrel and a trapped chest, mixed up: each kind in one of them, related kinds together', async () => {
        await stock(FOUR.chest[0], { 0: 'iron_ingot x20', 2: 'oak_log x30', 5: 'bread x5', 9: 'cobblestone x64', 13: 'iron_pickaxe', 20: 'dirt x12', 26: 'ender_pearl x7' });
        await stock(FOUR.double[0], { 1: 'oak_planks x40', 4: 'iron_ingot x50', 8: 'stone x33', 17: 'diamond_sword', 22: 'bread x10' });
        await stock(FOUR.double[1], { 0: 'ender_pearl x12', 6: 'egg x9', 19: 'coal x30', 25: 'oak_log x7' });
        await stock(FOUR.barrel[0], { 3: 'cobblestone x20', 7: 'oak_log x50', 11: 'gold_ingot x9', 15: 'dirt x60', 21: 'bow', 24: 'egg x10' });
        await stock(FOUR.trapped[0], { 0: 'stone x40', 5: 'oak_planks x30', 10: 'coal x44', 14: 'iron_pickaxe x1 d25', 18: 'bread x3', 23: 'gold_ingot x8' });
        await tpTo([5, 1, 7], 0);
        await settled();
        const before = await readAll(FOUR);
        assert.equal(before.find(c => c.id === 'double').slots.length, 54, 'the double chest opens as one');
        const own = pockets();
        const started = Date.now();
        assert.match(say('!markChests', 'unknown', 8, 'shared', 'same'), /^Marked 4 chests as shared, sorted only when asked: /);
        const result = await sortChests('shared', 8);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(FOUR);
        assert.deepEqual(totals(after), totals(before), 'nothing gained or lost');
        assert.ok(inOrder(after), `a second sort would move nothing: ${layout(after)}`);
        for (const chest of after) assert.ok(packed(chest.slots), `${chest.id} is packed from the first slot`);
        const { groupOf } = options();
        const homes = pick => { const found = {}; for (const c of after) for (const s of c.slots) if (s) (found[pick(s)] ??= new Set()).add(c.id); return found; };
        for (const [kind, held] of Object.entries(homes(s => s.key))) assert.equal(held.size, 1, `${kind} is in one place`);
        for (const [group, held] of Object.entries(homes(s => groupOf(s.name)))) assert.equal(held.size, 1, `${group} is in one place`);
        const pickaxes = after.flatMap(c => c.slots).filter(s => s?.name === 'iron_pickaxe');
        assert.equal(new Set(pickaxes.map(s => s.key)).size, 2, 'the worn pickaxe and the new one are two things');
        assert.match(result.text, /^Sorted 4 chests \(shared\) in \d+ moves: \d+ stacks are now \d+\./, result.text);
        assert.match(result.text, new RegExp(`- double chest at ${where(FOUR.double[0])}: `), result.text);
        assert.deepEqual(pockets(), own);
        return { seconds: Number(((Date.now() - started) / 1000).toFixed(1)), report: result.text.split('\n') };
    });

    await step('world memory keeps the double chest as one thing', () => {
        const [a, b] = FOUR.double.map(cell => at(...cell));
        const thing = handle.memory.things.get(a.x, a.y, a.z);
        assert.equal(thing?.kind, 'container', JSON.stringify(thing));
        assert.deepEqual(handle.memory.things.get(b.x, b.y, b.z), thing, 'the same thing from either half');
    });

    await step('one chest named by where it is: the bot looks in it, takes from it, and puts what it took into another', async () => {
        const [from, to] = NAMED;
        await stock(from, { 0: 'stone x3', 1: 'sand x30' });
        await stock(to, { 0: 'dirt x10', 2: 'dirt x12' });
        await tpTo([-11, 1, 10], 0);
        await settled();
        const f = at(...from), t = at(...to);
        say('!markChest', f.x, f.y, f.z, 'Bob', 'same');
        say('!markChest', t.x, t.y, t.z, 'Bob', 'same');
        const view = await sorting('!viewChestAt', [f.x, f.y, f.z]);
        assert.equal(view.status, 'ok', view.text);
        assert.match(view.text, new RegExp(`^The chest at ${where(from)}, which is Bob's, holds \\(2 of 27 slots used\\):\\n- stone 3\\n- sand 30`), view.text);
        const took = await sorting('!takeFromChestAt', [f.x, f.y, f.z, 'sand', 10]);
        assert.equal(took.status, 'ok', took.text);
        assert.deepEqual(show(await read(from)), ['stone x3', 'sand x20']);
        assert.ok(pockets().includes('sand x10'), `the bot has the sand: ${pockets()}`);
        const put = await sorting('!putInChestAt', [t.x, t.y, t.z, 'sand', 99]);
        assert.equal(put.status, 'ok', put.text);
        assert.deepEqual(show(await read(to)).sort(), ['dirt x10', 'dirt x12', 'sand x10']);
        assert.ok(!pockets().some(item => item.startsWith('sand')), `the bot has no sand left: ${pockets()}`);
        return { took: took.text.split('\n')[0], put: put.text.split('\n')[0] };
    });

    await step('after all of that, the bot sent no command', () => {
        assert.ok(!sent.includes('command_request'), 'no command was sent');
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        if (origin) await fill([-20, 0, -20], [20, 8, 20], 'air');
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
