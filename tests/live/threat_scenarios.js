// SPDX-License-Identifier: CC0-1.0
// Live scenarios for the creeper reflex (no model calls, free to run).
//   node tests/live/threat_scenarios.js [--port=55931] [--runs=5] [--only=<part of a scene's name>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The bot runs under strict fair play with world memory, its reflexes ticking as an agent's do, and no
// model behind it. Each scene summons creepers with commands and checks what the bot does: how fast it
// takes its first step away, how far it is when the creeper goes off, that it takes no damage, that a
// creeper that keeps following is dealt with in a few rounds and the model is told once, and that other
// mobs don't set it off. Creepers are summoned with `ExplosionRadius:0b`, so a blast that catches the bot
// would do it no harm; the test counts it as a failure all the same. The test peeks at raw world data to
// check (where the creeper really is, when it explodes); the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mineflayer from 'mineflayer';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { readFileSync } from 'node:fs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55931);
const RUNS = Number(arg('runs') || 5);
const NAME = 'Wary';
const OTHER = 'Neighbor';
const results = [];
const ONLY = arg('only'); // run only the scenes whose name has this in it
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return null;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
    return result;
};
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;
const server = await vanillaFixture(port);
let bot, other, running = true;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        fair_play: 'strict', world_memory: true, threat_reflexes: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installThreatReflexes } = await import('../../src/agent/reflexes/install.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of an agent the reflexes use, without a model behind them. A message to the model is kept.
    const messages = [];
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
        // The reflexes a default profile turns on and off (cowardice off, self_defense on, and so on).
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
    const fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'threat-memory-')) });
    assert.ok(fair, 'fair play installed');
    // Standing orders given in a scene are kept in a folder of its own, never the bot's real one.
    const reflexes = installThreatReflexes(agent, { ordersDir: mkdtempSync(path.join(tmpdir(), 'threat-orders-')) });
    assert.ok(reflexes, 'threat reflexes installed');
    bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
    // The agent's update loop: a round of reflexes every 300 ms.
    (async () => {
        while (running) {
            const started = Date.now();
            try { await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
            await delay(Math.max(0, 300 - (Date.now() - started)));
        }
    })().catch(error => console.error('the update loop stopped:', error));

    // What the reflex reports, what the server really does, and how the bot's health goes.
    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    const explosions = [];
    const onExplosion = packet => {
        const creeper = Object.values(bot.entities).find(e => e.name === 'creeper');
        explosions.push({ at: performance.now(), bot: bot.entity.position.clone(), creeper: creeper?.position.clone() ?? null, packet });
    };
    bot._client.on('explosion', onExplosion);
    let lowestHealth = 20;
    bot.on('health', () => { lowestHealth = Math.min(lowestHealth, bot.health); });
    const creeperSpawns = [];
    bot.on('entitySpawn', entity => { if (entity.name === 'creeper') creeperSpawns.push({ at: performance.now(), id: entity.id }); });
    const rawCreeper = () => Object.values(bot.entities).find(e => e.name === 'creeper') ?? null;
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 2 });

    await cmd('difficulty easy');
    // The game rules by their 26.x names (they were doMobSpawning and doDaylightCycle).
    await cmd('gamerule spawn_mobs false');
    await cmd('gamerule advance_time false');
    await cmd('time set noon');
    await cmd('forceload add -40 -40 40 40');

    // A flat stone floor with its top at y 69, open air above, nothing alive but the two players.
    async function reset({ x = 0.5, z = 0.5, facing = -90 } = {}) {
        await cmd('kill @e[type=!player]');
        // Again, for the loot the mobs just killed dropped. Left lying, a creeper's gunpowder drew the bot over
        // to pick it up in the next scene (item_collecting), toward that scene's creeper.
        await cmd('kill @e[type=!player]');
        // A fill may change at most 32768 blocks, so the air goes in in slices.
        await cmd('fill -40 66 -40 40 69 40 stone');
        for (const y of [70, 74, 78]) await cmd(`fill -40 ${y} -40 40 ${y + 3} 40 air`);
        // A wall round the edge: past it the floor drops away, which no scene is about.
        for (const [a, b] of [['-40 70 -40', '40 72 -40'], ['-40 70 40', '40 72 40'], ['-40 70 -40', '-40 72 40'], ['40 70 -40', '40 72 40']])
            await cmd(`fill ${a} ${b} stone`);
        assert.doesNotMatch(server.log, /Too many blocks/, 'the arena was reset');
        await cmd(`clear ${NAME}`);
        await cmd(`effect clear ${NAME}`);
        await cmd(`effect give ${NAME} instant_health 1 5`);
        await cmd(`tp ${NAME} ${x} 70 ${z} ${facing} 0`);
        await cmd(`tp ${OTHER} 30.5 70 30.5`);
        await waitFor(() => !agent.actions.executing, 15000, () => `still running ${agent.actions.currentActionLabel}`);
        await delay(2000); // the hold from the last scene has ended, and the bot has looked around
        events.length = 0; explosions.length = 0; creeperSpawns.length = 0; messages.length = 0;
        reflexes.creeper.picture.clear();
        reflexes.zones?.clear(); // each scene starts with no danger remembered from the last one's blast
        lowestHealth = bot.health;
    }
    // Waits for the reflex to finish, and then for 2 s more in which it starts nothing new.
    async function settle(ms = 10000) {
        await waitFor(() => events.some(e => e.event === 'done'), ms, () => JSON.stringify(events));
        let quietSince = Date.now(), seen = events.length;
        await waitFor(() => {
            if (events.length !== seen || agent.actions.currentActionLabel === 'mode:creeper_safety') { seen = events.length; quietSince = Date.now(); }
            return Date.now() - quietSince > 2000;
        }, ms + 10000, () => JSON.stringify(events));
    }
    const firstStepAfter = (from, kind) => {
        const stepEvent = events.find(e => e.event === 'step' && e.at >= from);
        return stepEvent ? { ms: Math.round(stepEvent.at - from), how: stepEvent.how, kind } : null;
    };
    // The bot's distance to a spot, kept up over a stretch of time: its lowest after a given moment.
    function watchDistance(spot) {
        const seen = [];
        const listener = () => seen.push({ at: Date.now(), d: flat(bot.entity.position, spot) });
        bot.on('move', listener);
        return { stop: () => bot.off('move', listener), seen };
    }

    // Another player, for a creeper to light next to and for the bot to walk to.
    other = mineflayer.createBot({ host: '127.0.0.1', port, username: OTHER, version: GAME_VERSION, auth: 'offline' });
    other.on('error', error => console.error('Other bot error:', error.message));
    await once(other, 'spawn');
    await waitFor(() => fair.wiring && fair.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${fair.wiring?.reason}`);

    const sightTimes = [], hissTimes = [];

    for (let run = 1; run <= RUNS; run++) {
        await step(`seen only by sight (a silent creeper, normal fuse) lit 2 blocks away, run ${run}: first step within 600 ms, 7 or more blocks off when it goes off, no damage`, async () => {
            await reset();
            await cmd('summon creeper -1.5 70 0.5 {Fuse:30s,ignited:1b,ExplosionRadius:0b,NoAI:1b,Silent:1b}');
            await waitFor(() => explosions.length > 0, 6000, () => JSON.stringify(events));
            const spawned = creeperSpawns[0].at;
            const first = firstStepAfter(spawned, 'sight');
            assert.ok(first, 'it stepped away');
            // Its hiss isn't heard. The blast is the world's sound, not the creeper's, and is heard.
            assert.ok(!events.some(e => e.event === 'heard' && e.subject !== 'explosion'), 'a silent creeper is not heard');
            const off = flat(explosions[0].bot, explosions[0].creeper ?? { x: -1.5, z: 0.5 });
            assert.ok(off >= 7, `it was ${off.toFixed(1)} blocks off when it went off`);
            assert.equal(lowestHealth, 20, 'no damage');
            sightTimes.push(first.ms);
            return { firstStepMs: first.ms, how: first.how, blocksOffAtBlast: Number(off.toFixed(1)) };
        });
    }

    for (let run = 1; run <= RUNS; run++) {
        await step(`heard around a corner (long fuse, never seen), run ${run}: first step within 300 ms of the hiss, and it doesn't walk back`, async () => {
            await reset();
            await cmd('fill 2 70 -6 2 73 6 stone'); // a wall between the bot and the creeper
            await delay(1500);
            await cmd('summon creeper 4.5 70 0.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b}');
            await waitFor(() => events.some(e => e.event === 'done'), 8000, () => JSON.stringify(events));
            const heard = events.find(e => e.event === 'heard');
            assert.ok(heard, 'it heard the hiss');
            const first = firstStepAfter(heard.at, 'hiss');
            assert.ok(first, 'it stepped away');
            const decided = events.find(e => e.event === 'decided');
            assert.equal(decided.stance, 'back_off');
            assert.match(decided.key, /^heard:/, 'from the hiss alone: it never saw the creeper');
            // The creeper burns for 10 s: the bot must not walk back toward it meanwhile.
            const creeperAt = { x: 4.5, z: 0.5 };
            const afterBackOff = flat(bot.entity.position, creeperAt);
            const watch = watchDistance(creeperAt);
            await delay(6000);
            watch.stop();
            const closest = Math.min(afterBackOff, ...watch.seen.map(s => s.d));
            assert.ok(closest >= afterBackOff - 1, `it came back to ${closest.toFixed(1)} blocks after backing off to ${afterBackOff.toFixed(1)}`);
            assert.ok(afterBackOff >= 7, `it backed off to ${afterBackOff.toFixed(1)} blocks`);
            hissTimes.push(first.ms);
            return { firstStepMs: first.ms, how: first.how, backedOffTo: Number(afterBackOff.toFixed(1)), closestAfter: Number(closest.toFixed(1)) };
        });
    }

    await step('reaction times over the runs (medians): from a hiss within 300 ms, from a sighting within 600 ms', () => {
        const hiss = median(hissTimes), sight = median(sightTimes);
        assert.ok(hiss <= 300, `median ${hiss} ms from a hiss`);
        assert.ok(sight <= 600, `median ${sight} ms from a sighting`);
        return { hissMedianMs: hiss, hissMs: hissTimes, sightMedianMs: sight, sightMs: sightTimes };
    });

    await step('a lit creeper on a 2-block ledge, with no path up to it: the bot backs off anyway', async () => {
        await reset();
        await cmd('fill 2 70 -1 4 71 1 stone');
        await delay(1000);
        await cmd('summon creeper 3.5 72 0.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b}');
        await settle();
        const away = flat(bot.entity.position, { x: 3.5, z: 0.5 });
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        return { endedBlocksAway: Number(away.toFixed(1)) };
    });

    await step('a creeper lit next to another player: the bot backs off from it', async () => {
        await reset();
        await cmd(`tp ${OTHER} 5.5 70 3.5`);
        await delay(1000);
        await cmd('summon creeper 5.5 70 1.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b}');
        await settle();
        const away = flat(bot.entity.position, { x: 5.5, z: 1.5 });
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        return { endedBlocksAway: Number(away.toFixed(1)), heard: events.some(e => e.event === 'heard') };
    });

    await step('while walking to a player: the bot still backs off, and the model is told once', async () => {
        await reset();
        await cmd(`tp ${OTHER} 25.5 70 0.5`);
        await delay(1000);
        const walk = act('action:goToPlayer', () => skills.goToPlayer(bot, OTHER));
        await waitFor(() => bot.entity.position.x > 3, 8000);
        const ahead = bot.entity.position.offset(2, 0, 0);
        await cmd(`summon creeper ${ahead.x.toFixed(1)} 70 ${ahead.z.toFixed(1)} {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b,Silent:1b}`);
        await waitFor(() => events.some(e => e.event === 'done'), 8000, () => JSON.stringify(events));
        const walked = await walk;
        assert.equal(walked.interrupted, true, 'the walk was stopped');
        const away = flat(bot.entity.position, ahead);
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        assert.equal(messages.length, 1);
        assert.match(messages[0], /interrupted by creeper_safety: A creeper is about to explode/);
        return { endedBlocksAway: Number(away.toFixed(1)), message: messages[0].split('\n')[0] };
    });

    await step('during !stay: the bot still backs off', async () => {
        await reset();
        act('action:stay', () => skills.stay(bot, -1));
        await delay(500);
        await cmd('summon creeper -1.5 70 0.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b,Silent:1b}');
        await settle();
        const away = flat(bot.entity.position, { x: -1.5, z: 0.5 });
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        return { endedBlocksAway: Number(away.toFixed(1)) };
    });

    await step('a command during a back-off: the back-off finishes first, then the command runs', async () => {
        await reset();
        await cmd('summon creeper -1.5 70 0.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b,Silent:1b}');
        await waitFor(() => events.some(e => e.event === 'decided'), 4000);
        await delay(100);
        let commandStarted = null;
        const command = act('action:goToPosition', () => { commandStarted = performance.now(); return 'went nowhere'; });
        await waitFor(() => events.some(e => e.event === 'done'), 8000);
        const done = events.find(e => e.event === 'done');
        assert.equal(done.interrupted, false, 'the back-off was not stopped');
        assert.equal(done.ended, 'far enough', JSON.stringify({ events, bot: bot.entity.position }));
        const ran = await command;
        assert.equal(ran.success, true, ran.text);
        assert.ok(commandStarted > done.at, 'the command started after the back-off');
        return { commandWaitedMs: Math.round(commandStarted - done.at) };
    });

    await step('a creeper not lit yet, 5 blocks away, with self_defense on: the bot does not walk toward it', async () => {
        await reset();
        assert.equal(bot.modes.isOn('self_defense'), true);
        await cmd('summon creeper -4.5 70 0.5 {NoAI:1b}');
        const watch = watchDistance({ x: -4.5, z: 0.5 });
        await delay(4000);
        watch.stop();
        const closest = Math.min(5, ...watch.seen.map(s => s.d));
        assert.ok(closest >= 4.5, `it came to ${closest.toFixed(1)} blocks`);
        assert.equal(events.filter(e => e.event === 'decided').length, 0, 'past 3 blocks and not lit: left alone');
        return { closest: Number(closest.toFixed(1)) };
    });

    await step('backing off with lava straight behind: it turns aside, never stands in lava, takes no damage', async () => {
        await reset();
        await cmd('fill 1 69 -1 4 69 1 lava');
        await delay(1000);
        let inLava = false;
        const check = () => { if (/lava/.test(bot.blockAt(bot.entity.position.floored())?.name ?? '')) inLava = true; };
        bot.on('move', check);
        await cmd('summon creeper -1.5 70 0.5 {Fuse:200s,ignited:1b,ExplosionRadius:0b,NoAI:1b,Silent:1b}');
        await waitFor(() => events.some(e => e.event === 'done'), 8000, () => JSON.stringify(events));
        bot.off('move', check);
        assert.equal(inLava, false, 'it stepped into lava');
        assert.equal(lowestHealth, 20, 'no damage');
        assert.equal(bot.modes.isOn('self_preservation'), true);
        const away = flat(bot.entity.position, { x: -1.5, z: 0.5 });
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        return { endedBlocksAway: Number(away.toFixed(1)), firstStep: events.find(e => e.event === 'step')?.how };
    });

    // A creeper with its own mind, following the bot. The bot is "busy" (staying), as if the model had
    // given it something to do; after each back-off the model is assumed to start it again.
    async function chase({ sword }) {
        await reset({ x: 20.5 }); // with room to the west to leave it behind
        if (sword) await cmd(`give ${NAME} stone_sword`);
        await delay(500);
        let keepBusy = true;
        const busy = () => { if (keepBusy && !agent.actions.executing) act('action:stay', () => skills.stay(bot, -1)); };
        const restart = event => { if (event.event === 'done') setTimeout(busy, 1700); };
        bot.on('threat_reflex', restart);
        busy();
        await cmd('summon creeper 30.5 70 0.5 {ExplosionRadius:0b}');
        const started = Date.now();
        // Over when the creeper is dead, or when it has stopped coming for 10 s with the bot idle.
        let quietSince = Date.now();
        await waitFor(() => {
            const creeper = rawCreeper();
            if (!creeper) return true;
            if (agent.actions.currentActionLabel === 'mode:creeper_safety') quietSince = Date.now();
            return Date.now() - quietSince > 10000 && flat(bot.entity.position, creeper.position) > 10;
        }, 90000, () => JSON.stringify(events.filter(e => e.event !== 'step')).slice(-1500));
        keepBusy = false;
        bot.off('threat_reflex', restart);
        await agent.actions.stop();
        const rounds = events.filter(e => e.event === 'done').length;
        return { rounds, killed: !rawCreeper(), exploded: explosions.length, seconds: Math.round((Date.now() - started) / 1000),
            stances: events.filter(e => e.event === 'decided').map(e => e.stance) };
    }

    await step('a following creeper, with a stone sword (4 hits): finished within 5 rounds, the model told once, no blast, no damage', async () => {
        const outcome = await chase({ sword: true });
        assert.equal(outcome.exploded, 0, 'it never went off');
        assert.equal(outcome.killed, true, JSON.stringify(outcome));
        assert.ok(outcome.rounds <= 5, `${outcome.rounds} rounds`);
        assert.equal(messages.length, 1, messages.join('\n---\n'));
        assert.equal(lowestHealth, 20, 'no damage');
        return outcome;
    });

    await step('a following creeper, no weapon: left behind within 3 rounds, the model told once, no blast, no damage', async () => {
        const outcome = await chase({ sword: false });
        assert.equal(outcome.exploded, 0, 'it never went off');
        assert.ok(outcome.rounds <= 3, `${outcome.rounds} rounds: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        assert.ok(outcome.stances.includes('leave'), JSON.stringify(outcome.stances));
        assert.equal(messages.length, 1, messages.join('\n---\n'));
        assert.equal(lowestHealth, 20, 'no damage');
        return outcome;
    });

    // ---- Standing orders about creepers ----

    await step('told to fight creepers, with a stone sword: one coming is met with a hit at the first meeting, killed, no blast, no damage', async () => {
        assert.equal(reflexes.orders.give('creepers', 'fight').ok, true);
        try {
            const outcome = await chase({ sword: true });
            assert.equal(outcome.exploded, 0, 'it never went off');
            assert.equal(outcome.killed, true, JSON.stringify(outcome));
            assert.equal(outcome.stances[0], 'hit_and_step_back', `met at once: ${JSON.stringify(outcome.stances)}`);
            assert.ok(outcome.rounds <= 5, `${outcome.rounds} rounds: ${JSON.stringify(outcome.stances)}`);
            assert.equal(lowestHealth, 20, 'no damage');
            return outcome;
        } finally {
            reflexes.orders.give('creepers', 'default');
        }
    });

    await step('told to flee creepers, though armed: one coming is left behind for good at the first meeting, no blast, no damage', async () => {
        assert.equal(reflexes.orders.give('creepers', 'flee').ok, true);
        try {
            const outcome = await chase({ sword: true });
            assert.equal(outcome.exploded, 0, 'it never went off');
            assert.equal(outcome.stances[0], 'leave', `left at once: ${JSON.stringify(outcome.stances)}`);
            assert.ok(!outcome.stances.includes('hit_and_step_back'), 'never went back in');
            assert.ok(outcome.rounds <= 2, `${outcome.rounds} rounds: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
            assert.match(messages[0] ?? '', /leaving it behind, as I was told to\./);
            assert.equal(lowestHealth, 20, 'no damage');
            return outcome;
        } finally {
            reflexes.orders.give('creepers', 'default');
        }
    });

    await step('nuisance: zombies, a skeleton and a spider at night, no creeper: the creeper reflex never interrupts', async () => {
        await reset();
        await cmd('time set midnight');
        await cmd(`effect give ${NAME} resistance 60 4 true`);
        for (const [mob, x, z] of [['zombie', 8, 3], ['zombie', -7, 5], ['skeleton', 12, -6], ['spider', -9, -8], ['zombie', 3, 10]])
            await cmd(`summon ${mob} ${x}.5 70 ${z}.5`);
        await delay(30000);
        await cmd('time set noon');
        const interruptions = events.filter(e => e.event === 'decided' && e.mode === 'creeper_safety').length;
        assert.equal(interruptions, 0);
        // The other threat reflexes do deal with these mobs (mob_scenarios.js measures them).
        return { interruptionsIn30s: interruptions, otherReflexMoves: events.filter(e => e.event === 'decided' && e.mode !== 'creeper_safety').length };
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
    other?.quit();
    await server.stop();
    process.exit(process.exitCode ?? 0);
}
