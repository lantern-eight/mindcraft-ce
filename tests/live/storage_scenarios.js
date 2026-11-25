// SPDX-License-Identifier: CC0-1.0
// Live chest-sorting scenarios against a real server (no model calls, free to run).
//   node tests/live/storage_scenarios.js [--port=55928]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check the sort plan exactly, and the carrying out of it against a fake room. These
// check what only a real server can: that real clicks in a real chest window do what the plan says,
// that a double chest, a barrel and a full chest all work, and that the bot gets to each chest on foot
// and opens it under the fair-play rules.
//
// The server console is the "director". It builds the room, fills the chests, and afterwards reads
// each chest back itself, so nothing the bot believes is taken on trust. The bot is given the same
// commands a model would call: it is told whose a chest is, and then asked to sort.
//
// The last steps are a room that several players share: two owners, a shared chest, one nobody has
// claimed, one behind a wall, and one the bot places itself. They check that a sort touches only the
// chests it was approved for, and leaves every other one slot for slot as it was. The last of them
// looks in, takes from and puts into one chest named by where it is.
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
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', ...fairPlaySettings(), world_memory: true, chest_sorting: true, store_and_fetch: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installStorage } = await import('../../src/agent/storage/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { MemoryBank } = await import('../../src/agent/memory_bank.js');
    const { planSort } = await import('../../src/agent/storage/sort_plan.js');
    const { GROUPS, grouper } = await import('../../src/agent/storage/item_groups.js');
    const { loadChestBook } = await import('../../src/agent/storage/chest_book.js');
    const { scopeDir } = await import('../../src/agent/memory/files.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [], memory_bank: new MemoryBank(),
        prompter: { profile: {}, getInitModes: () => ({}) },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        // A message here is a piece of the test to run while that message is being handled: that is
        // how the bot is told who is behind what it does (a player's name, or "system" for its own idea).
        openChat: () => {}, handleMessage: async (source, run) => (typeof run === 'function' ? run() : undefined),
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
    const bookDir = mkdtempSync(path.join(tmpdir(), 'storage-live-book-'));
    const storage = installStorage(agent, { bookDir });
    assert.deepEqual(storage?.commands, ['!chests', '!markChest', '!chestFor', '!markChests', '!sortChest', '!sortChests', '!viewChestAt', '!takeFromChestAt', '!putInChestAt'], 'chest sorting is on');
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
    /** Gives the bot a sorting command. A sort that never finishes fails here, saying where the bot is stuck, instead of hanging the run. */
    const sorting = async (command, args, seconds = 120) => {
        let timer;
        const stuck = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`the sort did not finish in ${seconds} s: ${JSON.stringify({
                at: bot.entity.position.floored(), window: bot.currentWindow?.type ?? null, walking: bot.pathfinder.isMoving(), lately, said: bot.output,
            })}`)), seconds * 1000);
        });
        try { return await Promise.race([getCommand(command).perform.structured(agent, ...args), stuck]); }
        finally { clearTimeout(timer); }
    };
    const sortChests = (whose, distance) => sorting('!sortChests', [whose, distance]);
    /** What a player would tell the bot about chests, through the commands a model would use for it. */
    const say = (command, ...args) => getCommand(command).perform(agent, ...args);
    /** Runs a piece of the test while a message from `source` is being handled. */
    const during = (source, run) => agent.handleMessage(source, run);
    const settled = async () => { await delay(400); await waitFor(() => !handle.recorder.busy, 20000, () => 'the look-around never finished'); await delay(300); };
    // Walking into a room, a player looks along it. Through a player's screen the bot does the same, turning
    // to each of these spots and letting world memory look; seeing all around, the turns change nothing.
    const lookAlong = async (...spots) => {
        for (const [x, y, z] of spots) { await bot.lookAt(new Vec3(x + 0.5, y + 0.5, z + 0.5), true); await settled(); }
    };

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
    /** The `components: {...}` part of one printed item, up to its own closing brace. Where it stands among
     *  the item's other fields depends on the game version (26.1 prints it first), so it is cut out by
     *  counting braces rather than by a pattern that runs to the item's last brace. */
    const componentsOf = entry => {
        const at = entry.indexOf('components: {');
        if (at < 0) return null;
        const start = entry.indexOf('{', at);
        for (let i = start, depth = 0; i < entry.length; i++) {
            if (entry[i] === '{') depth++;
            else if (entry[i] === '}' && --depth === 0) return entry.slice(start, i + 1);
        }
        return null;
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
            const extra = componentsOf(entry);
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

    await step('S1: one chest, two kinds scattered in part stacks: left alone until a player says it is hers, then merged, each kind together, nothing gained or lost', async () => {
        await fill(ONE['the chest'][0], { 0: 'cobblestone x40', 3: 'oak_log x10', 7: 'cobblestone x30', 12: 'oak_log x60', 20: 'cobblestone x5' });
        await cmd(`tp ${NAME} -14.5 70 -13.5 -90 0`);
        await delay(1500);
        await settled();
        const own = pockets();
        // Nobody has said whose this chest is, so nothing is sorted, whatever is asked for.
        const before = await readAll(ONE);
        for (const whose of ['approved', NAME, 'Alice']) {
            const refused = await sortChests(whose, 6);
            assert.equal(refused.status, 'failed', refused.text);
            assert.match(refused.text, /Nothing was sorted\.\nLeft alone within 6 blocks:\n- 1 chest with no known owner: -12, 70, -14\./, refused.text);
        }
        assert.deepEqual(await readAll(ONE), before, 'the chest is slot for slot as it was');
        // A player says it is hers, and asks.
        assert.match(say('!markChest', -12, 70, -14, 'Alice', 'same'), /is now Alice's, sorted only when asked/);
        const result = await sortChests('Alice', 6);
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(ONE);
        assert.deepEqual(show(after[0].slots), ['oak_log x64', 'oak_log x6', 'cobblestone x64', 'cobblestone x11']);
        assert.ok(packed(after[0].slots), 'from the first slot, with no gaps');
        assert.match(result.text, /^Sorted 1 chest \(Alice's\) in \d+ moves: 5 stacks are now 4\.\n- chest at -12, 70, -14: wood, stone \(4 of 27 slots used\)$/, result.text);
        assert.deepEqual(pockets(), own, 'the bot has exactly what it had before');
        return { text: result.text.split('\n')[0] };
    });

    await step('the sealed chest inside the same distance was never found, so never touched', async () => {
        assert.deepEqual(show(await read([-15, 71, -10])), ['dirt x5', 'dirt x6']);
    });

    await step('sorting it again moves nothing, and world memory knows what the chest holds now', async () => {
        const result = await sortChests('Alice', 6);
        assert.equal(result.status, 'ok', result.text);
        assert.match(result.text, /^The chest here \(Alice's\) is already in order\. Nothing was moved\./);
        const recall = getCommand('!recall').perform(agent, 'cobblestone');
        assert.match(recall, /IN CONTAINERS YOU LOOKED INTO\n- chest at -12, 70, -14: cobblestone 75 /, recall);
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
        // This one is the bot's own, which it may sort without being asked.
        assert.match(say('!markChests', 'unknown', 6, NAME, 'same'), /^Marked 1 chest as your own, may always be sorted: 12, 70, -14\.$/);
        const result = await sortChests('approved', 6);
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
        // "These are for everyone": all four in view are marked at once, then sorted together.
        assert.match(say('!markChests', 'unknown', 8, 'shared', 'same'), /^Marked 4 chests as shared, sorted only when asked: /);
        const result = await sortChests('shared', 8);
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
        assert.match(result.text, /^Sorted 4 chests \(shared\) in \d+ moves: \d+ stacks are now \d+\./, result.text);
        assert.match(result.text, /- double chest at 3, 70, 11: /, result.text);
        assert.match(result.text, /- barrel at 3, 70, 14: /, result.text);
        assert.deepEqual(pockets(), own);
        return { seconds: Number(((Date.now() - started) / 1000).toFixed(1)), report: result.text.split('\n'), stacks: [before, after].map(set => set.reduce((n, c) => n + c.slots.filter(Boolean).length, 0)) };
    });

    await step('where there is no chest it knows of, it says so', async () => {
        await cmd(`tp ${NAME} -14.5 70 13.5`);
        await delay(1500);
        await settled();
        const result = await sortChests('approved', 4);
        assert.equal(result.status, 'failed');
        assert.match(result.text, /don't see or remember a chest or barrel within 4 blocks/);
    });

    // ---- A room that several players share ----
    //
    // A second platform, too far from the first for a sort here to reach any chest there. Seven chests
    // stand in a row in front of where the bot will stand. An eighth is behind a wall at its back: the
    // bot is shown it first, so it knows of it, but cannot see it from the room.
    await cmd('forceload add 30 -10 50 10');
    await cmd('fill 30 69 -10 50 69 10 stone');
    await cmd('fill 30 70 -10 50 80 10 air');
    const ROOM = {
        aliceOne: [[41, 70, -4]], aliceTwo: [[41, 70, -2]], aliceNever: [[41, 70, 0]], bob: [[41, 70, 2]], bobAlways: [[41, 70, 4]],
        shared: [[41, 70, 6]], unclaimed: [[41, 70, -6]], aliceHidden: [[35, 70, 0]],
    };
    const only = (...ids) => Object.fromEntries(ids.map(id => [id, ROOM[id]]));
    for (const [[x, y, z]] of Object.values(ROOM)) await cmd(`setblock ${x} ${y} ${z} chest[facing=west,type=single]`);
    await cmd('fill 36 70 -3 36 73 3 stone');
    const OWN = [38, 70, 3];        // where the bot will put a chest of its own

    await step('a room that several players share: the bot is told whose each chest is, and its list says so', async () => {
        await fill(ROOM.aliceOne[0], { 0: 'cobblestone x20', 5: 'oak_log x10', 9: 'iron_ingot x5' });
        await fill(ROOM.aliceTwo[0], { 1: 'cobblestone x30', 4: 'oak_log x20', 8: 'bread x4' });
        await fill(ROOM.aliceNever[0], { 3: 'cobblestone x7', 12: 'cobblestone x9' });
        await fill(ROOM.bob[0], { 2: 'dirt x10', 6: 'dirt x12' });
        await fill(ROOM.bobAlways[0], { 4: 'sand x10', 9: 'sand x20', 13: 'stone x3' });
        await fill(ROOM.shared[0], { 5: 'coal x4', 7: 'coal x5' });
        await fill(ROOM.unclaimed[0], { 2: 'stick x3', 8: 'stick x4' });
        await fill(ROOM.aliceHidden[0], { 4: 'cobblestone x3', 11: 'cobblestone x4' });
        // Behind the wall first, to see the chest there. One chest named by where it is need not be in view.
        await cmd(`tp ${NAME} 33.5 70 0.5 -90 0`);
        await delay(1500);
        await settled();
        assert.match(say('!markChest', 35, 70, 0, 'Alice', 'same'), /is now Alice's, sorted only when asked/);
        await cmd(`tp ${NAME} 38.5 70 0.5 -90 0`);
        await delay(1500);
        await settled();
        await lookAlong([41, 70, -6], [41, 70, 6], [41, 70, 0]);
        assert.match(say('!markChest', 41, 70, -4, 'Alice', 'same'), /is now Alice's/);
        assert.match(say('!markChest', 41, 70, -2, 'alice', 'same'), /is now Alice's/, 'one owner, however the name is typed');
        assert.match(say('!markChest', 41, 70, 0, 'Alice', 'never'), /is now Alice's, never sorted/);
        assert.match(say('!markChest', 41, 70, 2, 'Bob', 'same'), /is now Bob's, sorted only when asked/);
        assert.match(say('!markChest', 41, 70, 4, 'Bob', 'always'), /is now Bob's, may always be sorted/);
        assert.match(say('!markChest', 41, 70, 6, 'shared', 'same'), /is now shared, sorted only when asked/);
        const list = say('!chests', 8);
        assert.match(list, /^CHESTS YOU KNOW WITHIN 8 BLOCKS/, list);
        assert.equal(list.split('\n').length, 9, list);
        assert.match(list, /- chest at 41, 70, 0: Alice's\. Never sorted/, list);
        assert.match(list, /- chest at 41, 70, 4: Bob's\. May always be sorted/, list);
        assert.match(list, /- chest at 41, 70, 6: shared\. Sorted only when asked/, list);
        assert.match(list, /- chest at 41, 70, -6: owner unknown\. Sorted only when asked/, list);
        assert.match(list, /- chest at 35, 70, 0: Alice's\. Sorted only when asked\. Out of sight from here/, list);
        return { list: list.split('\n') };
    });

    await step('O1, O3, O6: Alice asks for her chests: the two she can be seen to own are sorted together; her chest marked never, her chest behind the wall, and everyone else\'s are slot for slot as they were', async () => {
        const hers = only('aliceOne', 'aliceTwo'), others = only('aliceNever', 'bob', 'bobAlways', 'shared', 'unclaimed', 'aliceHidden');
        const before = await readAll(hers), untouched = await readAll(others);
        const own = pockets();
        const result = await during('Alice', () => sortChests('Alice', 8));
        assert.equal(result.status, 'ok', result.text);
        const after = await readAll(hers);
        assert.deepEqual(totals(after), totals(before), 'nothing gained or lost between her two chests');
        assert.ok(inOrder(after), `a second sort would move nothing: ${layout(after)}`);
        for (const chest of after) assert.ok(packed(chest.slots), `${chest.id} is packed from the first slot`);
        assert.deepEqual(await readAll(others), untouched, 'every other chest is slot for slot as it was');
        assert.match(result.text, /^Sorted 2 chests \(Alice's\) in \d+ moves: 6 stacks are now 4\./, result.text);
        assert.match(result.text, /\nLeft alone within 8 blocks:\n/, result.text);
        assert.match(result.text, /- 1 chest of Alice's marked never sort: 41, 70, 0/, result.text);
        assert.match(result.text, /- 2 chests of Bob's/, result.text);
        assert.match(result.text, /- 1 shared chest/, result.text);
        assert.match(result.text, /- 1 chest with no known owner: 41, 70, -6\. Ask whose it is before sorting it\./, result.text);
        assert.match(result.text, /- 1 more Alice's is nearby but out of sight from here\./, result.text);
        assert.equal(storage.book().at(41, 70, -4).lastSorted.by, 'Alice', 'who asked is kept');
        assert.deepEqual(pockets(), own);
        return { report: result.text.split('\n') };
    });

    await step('O4: a chest the bot places is written down as it is placed: a player\'s when a player asked for it, its own on its own idea; one it digs up is forgotten', async () => {
        const acting = (label, fn) => agent.actions.runAction(`action:${label}`, fn);
        const place = () => acting('placeChest', () => skills.placeBlock(bot, 'chest', ...OWN));
        const said = result => String(result.message ?? result.text ?? '');
        await cmd(`give ${NAME} chest 1`);
        await delay(500);
        const forAlice = await during('Alice', place);
        assert.match(said(forAlice), /The chest at 38, 70, 3 is noted as Alice's, because you placed it while doing what Alice asked: it is sorted only when asked\./, said(forAlice));
        assert.equal(storage.book().at(...OWN)?.owner, 'Alice');
        assert.equal(storage.book().at(...OWN)?.madeBy, 'me');

        const dug = await during('Alice', () => acting('breakChest', () => skills.breakBlockAt(bot, ...OWN)));
        await delay(500);
        assert.equal(storage.book().at(...OWN), null, `a chest the bot dug up is forgotten: ${said(dug)}`);

        await cmd(`give ${NAME} chest 1`);
        await delay(500);
        const own = await during('system', place);
        assert.match(said(own), /The chest at 38, 70, 3 is noted as your own, because you placed it on your own idea: it may always be sorted\./, said(own));
        assert.equal(storage.book().at(...OWN)?.owner, 'me');
        // What a bot started afresh would read from its folder.
        const scope = storage.book().scope;
        const saved = loadChestBook(scopeDir(bookDir, scope), { scope });
        assert.equal(saved.at(...OWN)?.owner, 'me', 'it is on disk, so it outlasts a restart of the bot');
        assert.equal(saved.at(41, 70, 4)?.sorting, 'always');
        await settled();
        assert.match(say('!chests', 8), /- chest at 38, 70, 3: your own \(you placed it\)\. May always be sorted/);
        return { placed: said(own).split('\n') };
    });

    await step('O2: on its own idea the bot sorts only what may always be sorted: its own chest and the one Bob marked always. Asked by nobody for Alice\'s, it refuses', async () => {
        await fill(OWN, { 2: 'torch x5', 7: 'torch x6' });
        const others = only('aliceOne', 'aliceTwo', 'aliceNever', 'bob', 'shared', 'unclaimed', 'aliceHidden');
        const untouched = await readAll(others), bobBefore = await readAll(only('bobAlways'));
        const refused = await during('system', () => sortChests('Alice', 8));
        assert.equal(refused.status, 'failed', refused.text);
        assert.match(refused.text, /- 2 chests of Alice's: nobody asked for these to be sorted\./, refused.text);
        const result = await during('system', () => sortChests('approved', 8));
        assert.equal(result.status, 'ok', result.text);
        const bobAfter = await readAll(only('bobAlways'));
        assert.deepEqual(totals(bobAfter), totals(bobBefore));
        assert.equal(bobAfter[0].slots.filter(Boolean).length, 2, 'the two part stacks of sand are one');
        assert.ok(inOrder(bobAfter) && packed(bobAfter[0].slots), layout(bobAfter));
        assert.deepEqual(show(await read(OWN)), ['torch x11']);
        assert.deepEqual(await readAll(others), untouched, 'every chest not marked always is slot for slot as it was');
        assert.match(result.text, /Sorted 1 chest \(Bob's\) in \d+ moves?: 3 stacks are now 2\./, result.text);
        assert.match(result.text, /Sorted 1 chest \(your own\) in \d+ moves?: 2 stacks are now 1\./, result.text);
        assert.match(result.text, /- 1 chest of Alice's marked never sort: 41, 70, 0/, result.text);
        assert.match(result.text, /- 2 chests of Alice's, sorted only when asked/, result.text);
        return { report: result.text.split('\n') };
    });

    await step('O5: a chest that is gone is dropped from the list, and from what the bot was told', async () => {
        await cmd('setblock 41 70 6 air');
        await delay(500);
        await settled();
        const list = say('!chests', 8);
        assert.doesNotMatch(list, /41, 70, 6/, list);
        assert.equal(storage.book().at(41, 70, 6), null);
        assert.equal(storage.book().at(41, 70, 4)?.owner, 'Bob', 'the chests still standing are still known');
    });

    await step('one chest named by where it is: the bot looks in it, takes from it, and puts what it took into another, saying whose each is', async () => {
        const view = await sorting('!viewChestAt', [41, 70, 4]);
        assert.equal(view.status, 'ok', view.text);
        assert.match(view.text, /^The chest at 41, 70, 4, which is Bob's, holds \(2 of 27 slots used\):\n- stone 3\n- sand 30/, view.text);
        const took = await sorting('!takeFromChestAt', [41, 70, 4, 'sand', 10]);
        assert.equal(took.status, 'ok', took.text);
        assert.match(took.text, /^Took 10 sand from the chest at 41, 70, 4, which is Bob's\./, took.text);
        assert.deepEqual(show(await read([41, 70, 4])), ['stone x3', 'sand x20']);
        assert.ok(pockets().includes('sand x10'), `the bot has the sand: ${pockets()}`);
        const put = await sorting('!putInChestAt', [41, 70, 2, 'sand', 99]);
        assert.equal(put.status, 'ok', put.text);
        assert.match(put.text, /^Put 10 sand in the chest at 41, 70, 2, which is Bob's\. That was all you had\./, put.text);
        assert.deepEqual(show(await read([41, 70, 2])).sort(), ['dirt x10', 'dirt x12', 'sand x10']);
        assert.ok(!pockets().some(item => item.startsWith('sand')), `the bot has no sand left: ${pockets()}`);
        // There is no chest in the gap between two of them.
        const missing = await sorting('!viewChestAt', [41, 70, 3]);
        assert.equal(missing.status, 'failed');
        assert.match(missing.text, /don't know of a chest or barrel at 41, 70, 3/);
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
