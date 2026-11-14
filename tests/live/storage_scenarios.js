// SPDX-License-Identifier: CC0-1.0
// Live chest-sorting scenarios against a real server (no model calls, free to run).
//   node tests/live/storage_scenarios.js [--port=55928]
// Needs Node 22, Java 21 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check the sort plan exactly, and the carrying out of it against a fake room. These
// check what only a real server can: that real clicks in a real chest window do what the plan says,
// that a double chest, a barrel and a full chest all work, and that the bot gets to each chest on foot
// and opens it under the fair-play rules.
//
// The server console is the "director". It builds the room, fills the chests, and afterwards reads
// each chest back itself, so nothing the bot believes is taken on trust. The bot is given one
// instruction, the same command a model would call.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55928);
const NAME = 'Sorter';
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: '1.21.11', auth: 'offline', fair_play: 'strict', world_memory: true, chest_sorting: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { planSort } = await import('../../src/agent/storage/sort_plan.js');
    const { GROUPS, grouper } = await import('../../src/agent/storage/item_groups.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'storage-live-')) });
    assert.ok(handle?.memory, 'fair play and world memory are on');
    assert.deepEqual(installStorage(agent)?.commands, ['!sortChests'], 'chest sorting is on');
    // The last few things the bot did with a chest, kept so that a run that goes wrong can say where.
    const lately = [];
    const note = text => { lately.push(text); if (lately.length > 12) lately.shift(); };
    for (const name of ['openContainer', 'clickWindow']) {
        const original = bot[name];
        bot[name] = function (target, ...rest) {
            note(name === 'clickWindow' ? `click ${target}` : `open ${target?.position}`);
            return original.call(this, target, ...rest);
        };
    }
    bot.on('windowClose', () => note('close'));
    /** Gives the bot the command. A sort that never finishes fails here, saying where the bot is stuck, instead of hanging the run. */
    const sortChests = async (distance, seconds = 120) => {
        let timer;
        const stuck = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`the sort did not finish in ${seconds} s: ${JSON.stringify({
                at: bot.entity.position.floored(), window: bot.currentWindow?.type ?? null, walking: bot.pathfinder.isMoving(), lately, said: bot.output,
            })}`)), seconds * 1000);
        });
        try { return await Promise.race([getCommand('!sortChests').perform.structured(agent, distance), stuck]); }
        finally { clearTimeout(timer); }
    };
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };

    // ---- The director's side: filling chests and reading them back through the console ----

    /** Puts stacks in a container block. `stacks` maps a slot to 'item x12', or to an item with data such as 'iron_pickaxe[damage=25]'. */
    const fill = async ([x, y, z], stacks) => {
        for (const [slot, text] of Object.entries(stacks)) {
            const [item, count = '1'] = text.split(' x');
            await cmd(`item replace block ${x} ${y} ${z} container.${slot} with ${item} ${count}`);
        }
    };
    /** Splits the server's printed list of items into one piece of text per item. */
    const entries = text => {
        const out = [];
        let depth = 0, start = -1;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '{' && depth++ === 0) start = i;
            else if (text[i] === '}' && --depth === 0) out.push(text.slice(start, i + 1));
        }
        return out;
    };
    /** What is really in a container block, slot by slot, as the server tells its console. */
    const read = async ([x, y, z], size = 27) => {
        const mark = server.log.length;
        await cmd(`data get block ${x} ${y} ${z} Items`);
        const answer = /has the following block data: (.*)/;
        await waitFor(() => answer.test(server.log.slice(mark)), 5000, () => `no answer about the block at ${x}, ${y}, ${z}: ${server.log.slice(mark)}`);
        const slots = new Array(size).fill(null);
        for (const entry of entries(server.log.slice(mark).match(answer)[1])) {
            const name = entry.match(/id: "minecraft:([a-z0-9_]+)"/)[1];
            const extra = entry.match(/components: (\{.*\})/)?.[1];
            // An item with data of its own (a worn tool) is its own kind, as it is for the bot.
            slots[Number(entry.match(/Slot: (\d+)b/)[1])] = { name, count: Number(entry.match(/count: (\d+)/)?.[1] ?? 1), key: extra ? `${name}#${extra}` : name };
        }
        return slots;
    };
    /** Reads a set of containers. A double chest is given as its two blocks: the half marked "right" holds the first 27 slots. */
    const readAll = async chests => {
        const out = [];
        for (const [id, blocks] of Object.entries(chests)) {
            const slots = [];
            for (const block of blocks) slots.push(...await read(block));
            out.push({ id, slots });
        }
        return out;
    };
    const totals = chests => {
        const sum = {};
        for (const chest of chests) for (const s of chest.slots) if (s) sum[s.key] = (sum[s.key] ?? 0) + s.count;
        return sum;
    };
    const show = slots => slots.filter(Boolean).map(s => `${s.name} x${s.count}`);
    const packed = slots => slots.slice(0, slots.filter(Boolean).length).every(Boolean);
    const pockets = () => bot.inventory.items().map(item => `${item.name} x${item.count}`).sort();
    // The same idea of order the bot uses: the game's own stack sizes and its own list of what is food.
    const options = () => ({
        stackSize: name => bot.registry.itemsByName[name]?.stackSize ?? 64,
        groupOf: grouper({ isFood: name => Boolean(bot.registry.foodsByName?.[name]) }), groupOrder: GROUPS,
    });
    /** Sorted means a second sort would move nothing. */
    const inOrder = chests => planSort(chests, options()).moves.length === 0;
    /** For a failed check: what is in each chest, and what a second sort would still want to do. */
    const layout = chests => JSON.stringify({ chests: chests.map(c => ({ id: c.id, slots: show(c.slots) })), stillToDo: planSort(chests, options()).moves.slice(0, 6) });

    // A stone platform in the air. Three rooms' worth of chests stand far enough apart that sorting
    // one never reaches the next. The bot carries a few things of its own, which must stay its own.
    await cmd('fill -20 69 -20 20 69 20 stone');
    await cmd('fill -20 70 -20 20 80 20 air');
    await cmd(`give ${NAME} cobblestone 10`);
    await cmd(`give ${NAME} iron_sword`);
    const ONE = { 'the chest': [[-12, 70, -14]] };
    const TWENTY = { 'the chest': [[12, 70, -14]] };
    const FOUR = { chest: [[3, 70, 9]], double: [[3, 70, 11], [3, 70, 12]], barrel: [[3, 70, 14]], trapped: [[3, 70, 16]] };
    await cmd('setblock -12 70 -14 chest[facing=west]');
    await cmd('setblock 12 70 -14 chest[facing=west]');
    await cmd('setblock 3 70 9 chest[facing=west,type=single]');
    await cmd('setblock 3 70 11 chest[facing=west,type=right]');
    await cmd('setblock 3 70 12 chest[facing=west,type=left]');
    await cmd('setblock 3 70 14 barrel[facing=west]');
    await cmd('setblock 3 70 16 trapped_chest[facing=west,type=single]');
    // And one chest the bot cannot know about: sealed in stone, well inside the distance it is told to sort.
    await cmd('fill -16 70 -11 -14 72 -9 stone');
    await cmd('setblock -15 71 -10 chest');
    await fill([-15, 71, -10], { 0: 'dirt x5', 9: 'dirt x6' });

    await step('S1: one chest, two kinds scattered in part stacks: merged, each kind together, nothing gained or lost', async () => {
        await fill(ONE['the chest'][0], { 0: 'cobblestone x40', 3: 'oak_log x10', 7: 'cobblestone x30', 12: 'oak_log x60', 20: 'cobblestone x5' });
        await cmd(`tp ${NAME} -14.5 70 -13.5 -90 0`);
        await delay(1500);
        await settled();
        const own = pockets();
        const result = await sortChests(6);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(ONE);
        assert.deepEqual(show(after[0].slots), ['oak_log x64', 'oak_log x6', 'cobblestone x64', 'cobblestone x11']);
        assert.ok(packed(after[0].slots), 'from the first slot, with no gaps');
        assert.match(result.text, /^Sorted 1 chest in \d+ moves: 5 stacks are now 4\.\n- chest at -12, 70, -14: wood, stone \(4 of 27 slots used\)$/, result.text);
        assert.deepEqual(pockets(), own, 'the bot has exactly what it had before');
        return { text: result.text.split('\n')[0] };
    });

    await step('the sealed chest inside the same distance was never found, so never touched', async () => {
        assert.deepEqual(show(await read([-15, 71, -10])), ['dirt x5', 'dirt x6']);
    });

    await step('sorting it again moves nothing, and world memory knows what the chest holds now', async () => {
        const result = await sortChests(6);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /^The chest here is already in order\. Nothing was moved\./);
        const recall = getCommand('!recall').perform(agent, 'cobblestone');
        assert.match(recall, /IN CONTAINERS YOU OPENED\n- chest at -12, 70, -14: cobblestone 75 /, recall);
    });

    await step('S2: one chest with no free slot and twenty kinds: merged, grouped by category, then by name', async () => {
        // Twenty kinds in 27 stacks, so the chest is full: there is no empty slot to shuffle through.
        const kinds = ['iron_pickaxe', 'diamond_sword', 'bread', 'apple', 'iron_ingot', 'coal', 'diamond', 'oak_log', 'oak_planks', 'stick',
            'cobblestone', 'stone', 'dirt', 'sand', 'wheat_seeds', 'bone', 'string', 'redstone', 'glass', 'torch'];
        const stacks = {};
        // Scattered: every third slot first, then the rest, with seven of the stackable kinds split in two.
        const order = [...Array(27).keys()].sort((a, b) => (a * 7) % 27 - (b * 7) % 27);
        kinds.forEach((kind, i) => { stacks[order[i]] = kind.includes('_pickaxe') || kind.includes('_sword') ? kind : `${kind} x${10 + i}`; });
        kinds.slice(2, 9).forEach((kind, i) => { stacks[order[20 + i]] = `${kind} x${3 + i}`; });
        await fill(TWENTY['the chest'][0], stacks);
        await cmd(`tp ${NAME} 10.5 70 -13.5 -90 0`);
        await delay(1500);
        await settled();
        const before = await readAll(TWENTY);
        assert.equal(before[0].slots.filter(Boolean).length, 27, 'the chest starts full');
        const own = pockets();
        const result = await sortChests(6);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(TWENTY);
        assert.deepEqual(totals(after), totals(before), 'nothing gained or lost');
        assert.equal(after[0].slots.filter(Boolean).length, 20, 'one stack of each kind');
        assert.ok(packed(after[0].slots));
        assert.ok(inOrder(after), 'a second sort would move nothing');
        const { groupOf } = options();
        const groups = [...new Set(after[0].slots.filter(Boolean).map(s => groupOf(s.name)))];
        assert.deepEqual(groups, GROUPS.filter(group => groups.includes(group)), 'the groups come in their set order, each in one run');
        assert.deepEqual(pockets(), own);
        return { order: show(after[0].slots).map(s => s.split(' ')[0]).join(' '), text: result.text.split('\n')[0] };
    });

    await step('S3: a chest, a double chest, a barrel and a trapped chest, mixed up: each kind in one of them, related kinds together', async () => {
        await fill(FOUR.chest[0], { 0: 'iron_ingot x20', 2: 'oak_log x30', 5: 'bread x5', 9: 'cobblestone x64', 13: 'iron_pickaxe', 20: 'dirt x12', 26: 'ender_pearl x7' });
        await fill(FOUR.double[0], { 1: 'oak_planks x40', 4: 'iron_ingot x50', 8: 'stone x33', 17: 'diamond_sword', 22: 'bread x10' });
        await fill(FOUR.double[1], { 0: 'ender_pearl x12', 6: 'egg x9', 19: 'coal x30', 25: 'oak_log x7' });
        await fill(FOUR.barrel[0], { 3: 'cobblestone x20', 7: 'oak_log x50', 11: 'gold_ingot x9', 15: 'dirt x60', 21: 'bow', 24: 'egg x10' });
        await fill(FOUR.trapped[0], { 0: 'stone x40', 5: 'oak_planks x30', 10: 'coal x44', 14: 'iron_pickaxe[damage=25]', 18: 'bread x3', 23: 'gold_ingot x8' });
        await cmd(`tp ${NAME} 0.5 70 12.5 -90 0`);
        await delay(1500);
        await settled();
        const before = await readAll(FOUR);
        const own = pockets();
        const started = Date.now();
        const result = await sortChests(8);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(FOUR);
        assert.deepEqual(totals(after), totals(before), 'nothing gained or lost');
        assert.ok(inOrder(after), `a second sort would move nothing: ${layout(after)}`);
        for (const chest of after) assert.ok(packed(chest.slots), `${chest.id} is packed from the first slot`);
        // Each kind is in one container, and so is each group of related kinds.
        const { groupOf } = options();
        const homes = pick => { const where = {}; for (const c of after) for (const s of c.slots) if (s) (where[pick(s)] ??= new Set()).add(c.id); return where; };
        for (const [kind, where] of Object.entries(homes(s => s.key))) assert.equal(where.size, 1, `${kind} is in one place`);
        for (const [group, where] of Object.entries(homes(s => groupOf(s.name)))) assert.equal(where.size, 1, `${group} is in one place`);
        // The worn pickaxe and the new one are both still there, as two things.
        const pickaxes = after.flatMap(c => c.slots).filter(s => s?.name === 'iron_pickaxe');
        assert.equal(new Set(pickaxes.map(s => s.key)).size, 2);
        assert.equal(Object.values(totals(after)).length, Object.values(totals(before)).length);
        assert.match(result.text, /^Sorted 4 chests in \d+ moves: \d+ stacks are now \d+\./, result.text);
        assert.match(result.text, /- double chest at 3, 70, 11: /, result.text);
        assert.match(result.text, /- barrel at 3, 70, 14: /, result.text);
        assert.deepEqual(pockets(), own);
        return { seconds: Number(((Date.now() - started) / 1000).toFixed(1)), report: result.text.split('\n'), stacks: [before, after].map(set => set.reduce((n, c) => n + c.slots.filter(Boolean).length, 0)) };
    });

    await step('where there is no chest it knows of, it says so', async () => {
        await cmd(`tp ${NAME} -14.5 70 13.5`);
        await delay(1500);
        await settled();
        const result = await sortChests(4);
        assert.equal(result.status, 'failed');
        assert.match(result.text, /don't see or remember a chest or barrel within 4 blocks/);
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
    // A sort that was given up on may still have a timer of its own running; do not wait on it.
    process.exit(process.exitCode ?? 0);
}
