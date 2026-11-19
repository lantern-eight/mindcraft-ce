// SPDX-License-Identifier: CC0-1.0
// The fight arena: how well the bot fights, measured (no model calls, free to run).
//   node tests/live/fight_arena.js [--port=55934] [--runs=3] [--only=<part of a round's name>] [--kit=<part of a kit's name>]
//                                  [--fair=off] [--out=<file for the results as JSON>]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The other live scenes check what the reflexes decide. This one measures how a fight goes once the bot has
// decided to fight: rounds of zombies, skeletons and spiders against kits from bare hands to iron, each round
// run several times, since a fight is never the same twice. For each it records whether the bot won, ran or
// died, how long it took, the damage it took, how often it swung, how many swings landed (the mob's hurt
// flash) and swings per kill. It asserts almost nothing: it is a yardstick, run before and after a change to
// how the bot fights, and the numbers go into docs/threat-reflexes.md.
//
// The bot fights through its own reflexes, as it would in a game: standing orders tell it to fight every
// kind in the arena down to 6 health, the floor no order goes under, so the fight is what is measured and not
// the choice to start one. Under 6 the mob reflex runs, which counts as "ran". The bot plays under strict
// fair play unless --fair=off. The test reads raw world data to measure; the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55934);
const RUNS = Number(arg('runs') || 3);
const ONLY = arg('only'), KIT = arg('kit'), OUT = arg('out');
const FAIR = arg('fair') !== 'off';
const NAME = 'Fighter';
const ROUND_MS = 45000;

// A zombie or spider summoned with no data is dressed at random (a baby now and then, armor, a jockey). With
// data it isn't, so every round meets the same mobs. A skeleton is given its bow, which it would otherwise
// get only from that random dressing.
const ADULT = 'PersistenceRequired:1b,CanPickUpLoot:0b';
const MOB_DATA = {
    zombie: `{${ADULT},IsBaby:0b}`,
    skeleton: `{${ADULT},equipment:{mainhand:{id:"minecraft:bow",count:1}}}`,
    spider: `{${ADULT}}`,
};
const ROUNDS = [
    { name: '1 zombie', mobs: [['zombie', 7, 0]] },
    { name: '2 zombies', mobs: [['zombie', 7, 0], ['zombie', -6, 3]] },
    { name: '3 zombies', mobs: [['zombie', 7, 0], ['zombie', -6, 3], ['zombie', 0, -7]] },
    { name: '1 spider', mobs: [['spider', 7, 0]] },
    { name: '1 skeleton', mobs: [['skeleton', 7, 3]] },
    { name: '2 skeletons', mobs: [['skeleton', 7, 3], ['skeleton', -7, -3]] },
    { name: 'mixed', mobs: [['zombie', 7, 0], ['zombie', -6, 3], ['skeleton', 0, 7], ['spider', 5, -5]] },
];
const KITS = [
    { name: 'bare hands', commands: [] },
    { name: 'stone sword', commands: ['give @p stone_sword'] },
    { name: 'copper sword', commands: ['give @p copper_sword'] },
    { name: 'iron kit', commands: ['give @p iron_sword',
        ...['head iron_helmet', 'chest iron_chestplate', 'legs iron_leggings', 'feet iron_boots'].map(part => `item replace entity @p armor.${part.replace(' ', ' with ')}`)] },
];

const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};
const round1 = value => (value == null ? null : Math.round(value * 10) / 10);

const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;
const server = await vanillaFixture(port);
const results = [];
let bot, running = true;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        fair_play: FAIR ? 'strict' : 'off', world_memory: FAIR, threat_reflexes: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installThreatReflexes } = await import('../../src/agent/reflexes/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

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
    const fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'arena-memory-')) });
    assert.ok(FAIR ? fair : !fair, `fair play ${FAIR ? 'installed' : 'off'}`);
    const reflexes = installThreatReflexes(agent, { ordersDir: mkdtempSync(path.join(tmpdir(), 'arena-orders-')) });
    assert.ok(reflexes, 'threat reflexes installed');
    bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
    // The agent's update loop: a round of reflexes every 300 ms.
    (async () => {
        while (running) {
            const started = Date.now();
            try { if (bot.entity && bot.health > 0) await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
            await delay(Math.max(0, 300 - (Date.now() - started)));
        }
    })().catch(error => console.error('the update loop stopped:', error));

    // What the round counts. Swings are the bot's attacks; a swing "landed" when its target shows the hurt
    // flash within half a second, the way a player sees a hit land.
    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    let round = null;
    const attack = bot.attack;
    bot.attack = function (target, ...rest) {
        if (round) round.swings.push({ id: target?.id, at: Date.now() });
        return attack.call(this, target, ...rest);
    };
    bot.on('entityHurt', entity => {
        if (!round?.ids.has(entity.id)) return;
        const swing = round.swings.find(s => s.id === entity.id && !s.landed && Date.now() - s.at < 500);
        if (swing) swing.landed = true;
    });
    bot.on('entityDead', entity => { if (round?.ids.has(entity.id)) round.dead.add(entity.id); });
    bot.on('health', () => {
        if (!round) return;
        if (bot.health < round.health) round.damage += round.health - bot.health;
        round.health = bot.health;
        round.lowest = Math.min(round.lowest, bot.health);
    });
    bot.on('death', () => { if (round) round.died = true; });

    const order = (...args) => getCommand('!setThreatRule').perform(agent, ...args);
    for (const group of ['zombies', 'skeletons', 'spiders'])
        assert.match(await order(group, 'fight', 6, 0), /fight/, `the order to fight ${group}`);

    await cmd('difficulty normal');
    await cmd('gamerule spawn_mobs false');
    await cmd('gamerule advance_time false');
    await cmd('gamerule keep_inventory true');
    await cmd('forceload add -24 -24 24 24');

    // A stone floor with its top at y 69, walled 10 blocks out on every side and 4 high, open above, at
    // midnight so nothing burns. Small, as LarsHamb's arena was: a mob can't wander off and the bot can't
    // run far, so a round ends in a fight.
    async function reset(kit) {
        await cmd('kill @e[type=!player]');
        await cmd('kill @e[type=!player]');
        await cmd('fill -16 66 -16 16 69 16 stone');
        for (const y of [70, 74]) await cmd(`fill -16 ${y} -16 16 ${y + 3} 16 air`);
        for (const [a, b] of [['-10 70 -10', '10 73 -10'], ['-10 70 10', '10 73 10'], ['-10 70 -10', '-10 73 10'], ['10 70 -10', '10 73 10']])
            await cmd(`fill ${a} ${b} stone`);
        assert.doesNotMatch(server.log, /Too many blocks/, 'the arena was reset');
        await waitFor(() => bot.entity && bot.health > 0, 20000, () => 'the bot did not respawn');
        await cmd('time set midnight');
        await cmd(`clear ${NAME}`);
        await cmd(`effect clear ${NAME}`);
        await cmd(`effect give ${NAME} instant_health 1 5`);
        await cmd(`effect give ${NAME} saturation 1 20`);
        for (const line of kit.commands) await cmd(line.replace('@p', NAME));
        await cmd(`tp ${NAME} 0.5 70 0.5 -90 0`);
        await waitFor(() => !agent.actions.executing, 20000, () => `still running ${agent.actions.currentActionLabel}`);
        await agent.actions.stop();
        await delay(1500);
        reflexes.mob.clear(); reflexes.fight.clear(); reflexes.claims.clear(); reflexes.creeper.picture.clear();
        reflexes.zones?.clear?.();
        events.length = 0; messages.length = 0;
    }

    const raw = names => Object.values(bot.entities).filter(e => names.includes(e.name));
    for (const kit of KITS) {
        if (KIT && !new RegExp(KIT).test(kit.name)) continue;
        for (const scene of ROUNDS) {
            if (ONLY && !new RegExp(ONLY).test(scene.name)) continue;
            for (let run = 1; run <= RUNS; run++) {
                await reset(kit);
                const kinds = [...new Set(scene.mobs.map(([kind]) => kind))];
                for (const [kind, x, z] of scene.mobs) await cmd(`summon ${kind} ${x + 0.5} 70 ${z + 0.5} ${MOB_DATA[kind]}`);
                await waitFor(() => raw(kinds).length === scene.mobs.length, 5000, () => `${raw(kinds).length} of ${scene.mobs.length} mobs seen`);
                const mobs = raw(kinds);
                round = { ids: new Set(mobs.map(m => m.id)), dead: new Set(), swings: [], damage: 0, health: bot.health, lowest: bot.health, died: false };
                // Whether the mobs came as summoned: no babies, no armor, a bow for each skeleton.
                const dressed = mobs.map(m => ({ kind: m.name, held: m.equipment?.[0]?.name ?? null,
                    armor: (m.equipment ?? []).slice(1).filter(Boolean).map(item => item.name) }));
                const started = Date.now();
                const alive = () => [...round.ids].filter(id => !round.dead.has(id) && bot.entities[id]).length;
                await waitFor(() => round.died || alive() === 0 || Date.now() - started > ROUND_MS, ROUND_MS + 5000);
                const seconds = (Date.now() - started) / 1000;
                const killed = round.dead.size;
                const ran = events.some(e => e.event === 'decided' && e.mode === 'mob_safety');
                const outcome = round.died ? 'died' : alive() === 0 ? 'won' : ran ? 'ran' : 'timed out';
                const landed = round.swings.filter(s => s.landed).length;
                const result = { kit: kit.name, round: scene.name, run, fair: FAIR, outcome, seconds: round1(seconds), killed, of: scene.mobs.length,
                    damage: round1(round.damage), lowestHealth: round1(round.lowest), swings: round.swings.length, landed,
                    swingsPerKill: killed ? round1(round.swings.length / killed) : null,
                    fights: events.filter(e => e.event === 'decided' && e.mode === 'self_defense').length,
                    retreats: events.filter(e => e.event === 'decided' && e.mode === 'mob_safety').length,
                    messagesToModel: messages.length,
                    odd: dressed.filter(d => d.armor.length || (d.kind === 'skeleton' && d.held !== 'bow')) };
                round = null;
                results.push(result);
                console.log(JSON.stringify(result));
            }
        }
    }

    // The yardstick, one line per kit and round.
    const groups = new Map();
    for (const r of results) {
        const key = `${r.kit} | ${r.round}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const summary = [...groups].map(([key, runs]) => {
        const won = runs.filter(r => r.outcome === 'won');
        const swings = runs.reduce((n, r) => n + r.swings, 0), kills = runs.reduce((n, r) => n + r.killed, 0);
        const landed = runs.reduce((n, r) => n + r.landed, 0);
        return { key, runs: runs.length, won: won.length, ran: runs.filter(r => r.outcome === 'ran').length,
            died: runs.filter(r => r.outcome === 'died').length, medianSecondsWon: round1(median(won.map(r => r.seconds))),
            medianDamage: round1(median(runs.map(r => r.damage))), swingsPerKill: kills ? round1(swings / kills) : null,
            landedShare: swings ? round1(landed / swings) : null };
    });
    console.log('\nkit | round: won/runs (ran, died), median s to win, median damage, swings per kill, share landed');
    for (const s of summary)
        console.log(`${s.key}: ${s.won}/${s.runs} (${s.ran} ran, ${s.died} died), ${s.medianSecondsWon ?? '-'} s, ${s.medianDamage} dmg, ${s.swingsPerKill ?? '-'} swings/kill, ${s.landedShare ?? '-'} landed`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ gameVersion: GAME_VERSION, fair: FAIR, runs: RUNS, results, summary }, null, 2));

    assert.ok(results.length > 0, 'at least one round ran');
    assert.doesNotMatch(server.log, new RegExp(`${NAME} issued server command`), 'the bot issued no command');
    console.log(JSON.stringify({ status: 'passed', rounds: results.length }));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, rounds: results.length }));
    process.exitCode = 1;
} finally {
    running = false;
    bot?.quit();
    await server.stop();
    process.exit(process.exitCode ?? 0);
}
