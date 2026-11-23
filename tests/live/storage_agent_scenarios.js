// SPDX-License-Identifier: CC0-1.0
// Chest owners and sorting through the whole agent: MindServer, the agent process, a real server.
//   node tests/live/storage_agent_scenarios.js                       recorded replies, no model, free
//   node tests/live/storage_agent_scenarios.js --live-model --runs=5 the model in andy.json (paid)
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The other chest tests call the commands directly. This one is told things in plain words, the way
// players do: "that chest is mine", "sort my chests", "keep them tidy". With recorded replies it
// checks the wiring a unit test cannot reach: that the chest commands are offered to the model as
// tools, that who is speaking is known when one runs, and that what was said is on disk afterwards.
// With a real model it checks the part only a model can fail: choosing the right command from the
// words. A model's answers vary, so that mode runs the conversation several times and reports how
// often each step came out right, never a single pass or fail.
//
// The server console builds the room, and reads every chest back itself.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { planSort } from '../../src/agent/storage/sort_plan.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const live = process.argv.includes('--live-model');
const runs = live ? Number(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || 3) : 1;
const NAME = live ? 'ChestLiveModel' : 'ChestReplay';
// --port and --mind-port let a second checkout run this at the same time (java_all.js passes them).
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const MIND_PORT = Number(arg('mind-port') || 8084);
const patience = live ? 180000 : 45000;     // how long one thing a player says gets to take effect

// The room: four chests in a row east of the bot, all in view. Two will be Alice's, one Bob's, and
// one is claimed only in the last step.
const ALICE_1 = [3, 70, -3], ALICE_2 = [3, 70, -1], LATER = [3, 70, 1], BOB = [3, 70, 3];
const FILL = [
    [ALICE_1, { 0: 'cobblestone 40', 5: 'oak_log 10', 9: 'cobblestone 30' }],
    [ALICE_2, { 2: 'oak_log 20', 7: 'dirt 5' }],
    [LATER, { 1: 'stone 3', 4: 'stone 4' }],
    [BOB, { 0: 'sand 7', 3: 'sand 9' }],
];
const SAID = [
    ['Bob', 'The chest at 3 70 3 is mine.'],
    ['Alice', 'The chests at 3 70 -3 and 3 70 -1 are mine.'],
    ['Alice', 'Please sort my chests.'],
    ['Alice', 'The chest at 3 70 1 is mine too. From now on you can always keep my chests tidy without asking.'],
];
// What a model that understood would call, for the run with no model.
const call = (name, args = {}) => ({ id: `call-${Math.random().toString(16).slice(2)}`, name, arguments: args });
const at = ([x, y, z]) => ({ x, y, z });
const RECORDED = [
    { calls: [call('markChest', { ...at(BOB), owner: 'Bob', sorting: 'same' })] },
    { text: 'Noted: that chest is yours, Bob.' },
    { calls: [call('markChest', { ...at(ALICE_1), owner: 'Alice', sorting: 'same' }), call('markChest', { ...at(ALICE_2), owner: 'Alice', sorting: 'same' })] },
    { text: 'Noted: those two are yours, Alice.' },
    { calls: [call('sortChests', { whose: 'Alice', distance: 8 })] },
    { text: 'Your chests are sorted, Alice.' },
    { calls: [call('markChest', { ...at(LATER), owner: 'Alice', sorting: 'same' })] },
    { calls: [call('markChests', { which: 'Alice', distance: 8, owner: 'same', sorting: 'always' })] },
    { text: 'I will keep your chests tidy.' },
];

const fixture = await vanillaFixture(Number(arg('port') || 55938));
const outcomes = [];        // one per run: { step name: true | false }
let child, socket, log = '';

/** What is really in a chest, slot by slot, as the server tells its console. */
async function read([x, y, z]) {
    const mark = fixture.log.length;
    await fixture.command(`data get block ${x} ${y} ${z} Items`);
    const answer = /has the following block data: (.*)/;
    await waitFor(() => answer.test(fixture.log.slice(mark)), 5000, () => `no answer about the chest at ${x}, ${y}, ${z}`);
    const slots = new Array(27).fill(null);
    for (const entry of fixture.log.slice(mark).match(answer)[1].match(/\{[^{}]*\}/g) ?? []) {
        const name = entry.match(/id: "minecraft:([a-z0-9_]+)"/)[1];
        slots[Number(entry.match(/Slot: (\d+)b/)[1])] = { name, count: Number(entry.match(/count: (\d+)/)?.[1] ?? 1), key: name };
    }
    return slots;
}
const show = slots => slots.map(s => (s ? `${s.name} x${s.count}` : '-')).join(' ');
/** What the bot has written down about chests, read from its own file. */
function book() {
    const dir = `bots/${NAME}/storage`;
    for (const scope of existsSync(dir) ? readdirSync(dir) : []) {
        const file = path.join(dir, scope, 'chests.json');
        if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).chests;
    }
    return [];
}
const entry = ([x, y, z]) => book().find(chest => chest.x === x && chest.y === y && chest.z === z) ?? {};

/** One conversation, from an empty book: a fresh agent, the room rebuilt, the four things said. */
async function converse(run) {
    const passed = {};
    const heard = [];
    rmSync(`bots/${NAME}`, { recursive: true, force: true });       // this test's own bot: no book, no memory from the last run
    for (const [pos, stacks] of FILL) {
        await fixture.command(`setblock ${pos.join(' ')} air`);
        await fixture.command(`setblock ${pos.join(' ')} chest[facing=west,type=single]`);
        for (const [slot, item] of Object.entries(stacks)) await fixture.command(`item replace block ${pos.join(' ')} container.${slot} with ${item}`);
    }
    const before = { later: show(await read(LATER)), bob: show(await read(BOB)) };

    const transcript = path.join(fixture.dir, `replies-${run}.json`);
    writeFileSync(transcript, JSON.stringify(RECORDED));
    const profile = live ? { ...JSON.parse(readFileSync('andy.json', 'utf8')), name: NAME, embedding: false }
        : { name: NAME, model: { api: 'replay', model: transcript }, embedding: false, use_function_calling: true, use_brain_agent: false, use_rp_agent: false };
    const profilePath = path.join(fixture.dir, `profile-${run}.json`);
    writeFileSync(profilePath, JSON.stringify(profile));
    log = '';
    child = spawn(process.execPath, ['main.js', '--profiles', profilePath], { env: { ...process.env, SETTINGS_JSON: JSON.stringify({
        host: '127.0.0.1', port: fixture.port, mindserver_port: MIND_PORT, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', init_message: '',
        num_examples: 0, max_messages: 100, load_memory: false, agent_max_steps: 20, agent_max_tool_calls: 40,
        ...fairPlaySettings(), world_memory: true, chest_sorting: true,
    }) }, stdio: ['pipe', 'pipe', 'pipe'] });
    const capture = data => { log += data; };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    await waitFor(() => log.includes(`${NAME} spawned.`), 30000, () => log.slice(-2500));
    await fixture.command(`tp ${NAME} 0.5 70 0.5 -90 0`);
    await delay(4000);      // time to look around: under fair play the bot knows only chests it has seen
    socket = io(`http://127.0.0.1:${MIND_PORT}`, { reconnection: false, auth: { controlToken: process.env.MINDCRAFT_CONTROL_TOKEN } });
    socket.on('bot-output', (agent, message) => { if (agent === NAME) heard.push(message); });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.emit('listen-to-agents');

    const say = async n => { const [from, message] = SAID[n]; socket.emit('send-message', NAME, { from, message }); await delay(300); };
    /** Waits for a thing said to take effect. A step that never does is a miss, not the end of the run. */
    const step = async (name, check) => {
        try { await waitFor(check, patience, () => log.slice(-1500)); passed[name] = true; }
        catch (error) { passed[name] = false; if (!live) throw error; }
    };

    await say(0);
    await step('"that chest is mine": written down as Bob\'s', () => entry(BOB).owner === 'Bob');
    await say(1);
    await step('"those two are mine": written down as Alice\'s', () => entry(ALICE_1).owner === 'Alice' && entry(ALICE_2).owner === 'Alice');
    await say(2);
    await step('"sort my chests": Alice\'s two are in order, and it is noted that she asked', () => entry(ALICE_1).lastSorted?.by === 'Alice' && entry(ALICE_2).lastSorted?.by === 'Alice');
    await delay(live ? 5000 : 1500);    // long enough for a sort that should not have started to show
    const sorted = [{ id: 'a1', slots: await read(ALICE_1) }, { id: 'a2', slots: await read(ALICE_2) }];
    const count = (name, chests) => chests.reduce((n, chest) => n + chest.slots.reduce((m, s) => m + (s?.name === name ? s.count : 0), 0), 0);
    passed['"sort my chests": nothing gained or lost, and a second sort would move nothing'] = planSort(sorted).moves.length === 0
        && count('cobblestone', sorted) === 70 && count('oak_log', sorted) === 30 && count('dirt', sorted) === 5;
    passed['"sort my chests": Bob\'s chest and the unclaimed one are slot for slot as they were'] = show(await read(BOB)) === before.bob && show(await read(LATER)) === before.later;
    await say(3);
    await step('"that one is mine too, keep them tidy": all three are Alice\'s and may always be sorted', () => [ALICE_1, ALICE_2, LATER].every(pos => entry(pos).owner === 'Alice' && entry(pos).sorting === 'always'));
    passed['and Bob\'s is still his, sorted only when asked'] = entry(BOB).owner === 'Bob' && entry(BOB).sorting === undefined;
    if (!live) for (const [name, ok] of Object.entries(passed)) assert.ok(ok, `${name}: ${JSON.stringify({ book: book(), heard, sorted: sorted.map(c => show(c.slots)) })}`);

    socket.emit('shutdown'); await delay(2500); socket.disconnect(); child.kill('SIGTERM'); await delay(1500);
    socket = null; child = null;
    return passed;
}

try {
    await fixture.command('forceload add -16 -16 16 16');
    await delay(1000);
    await fixture.command('fill -12 69 -12 12 69 12 stone');
    await fixture.command('fill -12 70 -12 12 77 12 air');
    await fixture.command('setworldspawn 0 70 0');
    for (let run = 1; run <= runs; run++) {
        const passed = await converse(run);
        outcomes.push(passed);
        console.log(JSON.stringify({ run, passed }));
    }
    // How often each step came out right. With recorded replies that is every time or a failure above.
    const rates = Object.fromEntries(Object.keys(outcomes[0]).map(name => [name, `${outcomes.filter(o => o[name]).length} of ${outcomes.length}`]));
    console.log(JSON.stringify({ status: 'passed', liveModel: live, runs: outcomes.length, rates }, null, 2));
} catch (error) {
    console.error(error);
    console.error(log.slice(-4000));
    console.log(JSON.stringify({ status: 'failed', error: error.message, runsDone: outcomes.length }));
    process.exitCode = 1;
} finally {
    socket?.emit('shutdown'); await delay(1500); socket?.disconnect(); child?.kill('SIGTERM');
    await fixture.stop();
    rmSync(`bots/${NAME}`, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
}
