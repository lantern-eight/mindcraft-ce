// SPDX-License-Identifier: CC0-1.0
// Live scenarios for danger zones (no model calls, free to run).
//   node tests/live/danger_scenarios.js [--port=55933] [--only=<part of a scene's name>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The bot runs under strict fair play with world memory and the threat reflexes, as an agent does, with no
// model behind it. Mobs are summoned with commands; the bot notes zones from what it sees and hears, and
// then walks with the travel skill a command would call. What is measured:
//   - a walk across an arena, with no zone and then with one where illagers were seen: how close the
//     walk comes to where they stood, and how much longer it takes;
//   - a walk out of the middle of a zone: straight, and no slower;
//   - the zones a skeleton aiming at the bot and an explosion heard leave, and where they are;
//   - the lines the model gets: none from a zone. The behavior log says once that the bot saw illagers.
// The test peeks at raw world data to check; the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55933);
const NAME = 'Careful';
const ONLY = arg('only');
const results = [];
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return null;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
    return result;
};
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round1 = v => Math.round(v * 10) / 10;

const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;
const server = await vanillaFixture(port);
let bot, running = true;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        fair_play: 'strict', world_memory: true, threat_reflexes: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installThreatReflexes } = await import('../../src/agent/reflexes/install.js');
    const { placeCostAt } = await import('../../src/agent/library/place_costs.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills, fair play and the reflexes use, without a model behind them.
    const messages = [];
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
        prompter: { profile: {}, getInitModes: () => defaultModes },
        self_prompter: { isActive: () => false, stopLoop: () => {} },
        openChat: () => {}, handleMessage: (role, text) => messages.push(text),
        clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt: () => {
            bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
        },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'danger-memory-')) });
    assert.ok(fair, 'fair play installed');
    const reflexes = installThreatReflexes(agent);
    assert.ok(reflexes?.zones, 'threat reflexes installed, with danger zones');
    const zones = reflexes.zones;
    bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
    // The agent's update loop: a round of reflexes every 300 ms.
    (async () => {
        while (running) {
            const started = Date.now();
            try { await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
            await delay(Math.max(0, 300 - (Date.now() - started)));
        }
    })().catch(error => console.error('the update loop stopped:', error));

    let damage = 0, lastHealth = 20;
    bot.on('health', () => { if (bot.health < lastHealth) damage += lastHealth - bot.health; lastHealth = bot.health; });
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 3 });

    await cmd('difficulty normal');
    await cmd('gamerule spawn_mobs false');
    await cmd('gamerule advance_time false');
    await cmd('time set noon');
    await cmd('forceload add -40 -40 40 40');

    // A flat stone floor with its top at y 69, a wall round the edge, open air above, nothing alive but the bot.
    async function reset({ x = -36.5, z = 0.5, facing = -90, clearZones = true } = {}) {
        await cmd('kill @e[type=!player]');
        await cmd('kill @e[type=!player]');
        await cmd('fill -40 66 -40 40 69 40 stone');
        for (const y of [70, 74, 78]) await cmd(`fill -40 ${y} -40 40 ${y + 3} 40 air`);
        for (const [a, b] of [['-40 70 -40', '40 72 -40'], ['-40 70 40', '40 72 40'], ['-40 70 -40', '-40 72 40'], ['40 70 -40', '40 72 40']])
            await cmd(`fill ${a} ${b} stone`);
        assert.doesNotMatch(server.log, /Too many blocks/, 'the arena was reset');
        await cmd('time set noon');
        await cmd(`effect give ${NAME} instant_health 1 5`);
        await cmd(`effect give ${NAME} saturation 1 20`);
        await cmd(`tp ${NAME} ${x} 70 ${z} ${facing} 0`);
        await waitFor(() => !agent.actions.executing, 20000, () => `still running ${agent.actions.currentActionLabel}`);
        await agent.actions.stop();
        await delay(2000);
        if (clearZones) zones.clear();
        messages.length = 0;
        bot.modes.behavior_log = '';
        lastHealth = bot.health; damage = 0;
    }

    /** Walks with the travel skill, and says how it went: the time, the track, how close it came to a spot. */
    async function walk(to, { near = null, deadlineMs = 90000 } = {}) {
        const track = [];
        const onMove = () => track.push(bot.entity.position.clone());
        bot.on('move', onMove);
        const started = Date.now();
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => { agent.requestInterrupt(); resolve({ message: 'deadline' }); }, deadlineMs); });
        const result = await Promise.race([act('test:walk', () => skills.goToPosition(bot, to.x, to.y, to.z, 1)), deadline]);
        clearTimeout(timer);
        bot.off('move', onMove);
        const ms = Date.now() - started;
        const end = bot.entity.position;
        return {
            ms, reached: flat(end, to) <= 2, end: { x: round1(end.x), z: round1(end.z) },
            closest: near ? round1(Math.min(...track.map(p => flat(p, near)))) : null,
            widest: round1(Math.max(...track.map(p => Math.abs(p.z - to.z)))),
            length: round1(track.slice(1).reduce((sum, p, i) => sum + flat(track[i], p), 0)),
            said: (result.message ?? result.text ?? '').trim().slice(0, 200),
        };
    }

    const MIDDLE = { x: 0.5, y: 70, z: 0.5 };
    const ACROSS = { x: 36.5, y: 70, z: 0.5 };
    let control = null;

    // ---- Illagers ----

    await step('with no zone, the walk across the arena goes straight', async () => {
        await reset();
        control = await walk(ACROSS, { near: MIDDLE });
        assert.ok(control.reached, `got there: ${JSON.stringify(control)}`);
        assert.ok(control.closest < 3, `straight past the middle: ${JSON.stringify(control)}`);
        return control;
    });

    await step('illagers in view make a zone, said once in the behavior log and never to the model', async () => {
        await reset();
        await cmd('summon pillager 0.5 70 0.5 {NoAI:1b,PersistenceRequired:1b}');
        await cmd('summon vindicator 2.5 70 3.5 {NoAI:1b,PersistenceRequired:1b}');
        const started = Date.now();
        await waitFor(() => zones.list().some(z => z.kind === 'illagers'), 8000, () => JSON.stringify(zones.list()));
        const noticedMs = Date.now() - started;
        await delay(2500);
        const kept = zones.list();
        assert.equal(kept.length, 1, `one zone for both: ${JSON.stringify(kept)}`);
        assert.ok(flat(kept[0], MIDDLE) < 4, 'where they stood');
        assert.equal(bot.modes.behavior_log.match(/keeping away from there/g)?.length, 1, bot.modes.behavior_log);
        assert.equal(messages.length, 0, 'no line to the model');
        assert.ok(placeCostAt(bot, 0, 70, 0) > 60, 'routes pay to go in');
        await cmd('kill @e[type=!player]');
        return { noticedMs, zone: { x: round1(kept[0].x), z: round1(kept[0].z), radius: kept[0].radius }, log: bot.modes.behavior_log.trim() };
    });

    await step('the walk across goes round where the illagers were', async () => {
        await reset({ clearZones: false });
        assert.ok(zones.list().some(z => z.kind === 'illagers'), 'the zone is still remembered');
        const round = await walk(ACROSS, { near: MIDDLE });
        assert.ok(round.reached, `got there: ${JSON.stringify(round)}`);
        assert.ok(round.closest >= 16, `kept away from where they stood: ${JSON.stringify(round)}`);
        assert.equal(messages.length, 0, 'no line to the model');
        return { ...round, slower: control ? round1(round.ms / control.ms) : null, longer: control ? round1(round.length / control.length) : null };
    });

    await step('from the middle of the zone, the bot walks straight out', async () => {
        await reset({ x: 4.5, clearZones: false });
        assert.ok(placeCostAt(bot, 4, 70, 0) > 50, 'it stands well inside');
        const out = await walk(ACROSS);
        assert.ok(out.reached, `got out: ${JSON.stringify(out)}`);
        assert.ok(out.widest <= 3, `straight out, not round: ${JSON.stringify(out)}`);
        return out;
    });

    // ---- What else makes a zone ----

    await step('a skeleton aiming at the bot leaves a zone where it stood', async () => {
        await reset({ x: -20.5 });
        await cmd('summon skeleton -6.5 70 0.5 {PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}');
        const started = Date.now();
        await waitFor(() => zones.list().some(z => z.kind === 'archer'), 15000, () => JSON.stringify(zones.list()));
        const zone = zones.list().find(z => z.kind === 'archer');
        const skeleton = Object.values(bot.entities).find(e => e.name === 'skeleton');
        const off = skeleton ? round1(flat(zone, skeleton.position)) : null;
        await cmd('kill @e[type=!player]');
        assert.ok(off !== null && off < 4, `at the skeleton: ${off} blocks off`);
        return { noticedMs: Date.now() - started, off, damage };
    });

    await step('an explosion heard leaves a zone where it was heard, wide enough to hold where it was', async () => {
        await reset({ x: -20.5 });
        // 13 blocks east: inside fair play's hearing (16 blocks), and what hearing calls "near" (10 to 20).
        const spot = { x: -7.5, y: 70, z: 0.5 };
        await cmd(`summon creeper ${spot.x} 70 ${spot.z} {Fuse:1s,ignited:1b,ExplosionRadius:0b,NoAI:1b}`);
        await waitFor(() => zones.list().some(z => z.kind === 'explosion'), 6000, () => `no zone: ${JSON.stringify(zones.list())}`);
        const zone = zones.list().find(z => z.kind === 'explosion');
        const off = round1(flat(zone, spot));
        assert.ok(off < zone.radius, `the real spot is inside the zone: ${off} blocks off, radius ${zone.radius}`);
        return { off, radius: zone.radius, messages: messages.length };
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
    running = false;
    bot?.quit();
    await server.stop();
    process.exit(process.exitCode ?? 0);
}
