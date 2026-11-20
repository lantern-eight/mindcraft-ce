// SPDX-License-Identifier: CC0-1.0
// The fight arena: how well the bot fights, measured (no model calls, free to run).
//   node tests/live/fight_arena.js [--port=55934] [--runs=3] [--only=<part of a round's name>] [--kit=<part of a kit's name>]
//                                  [--fair=off] [--orders=none] [--out=<file for the results as JSON>]
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
import { ROUNDS, createMeter, summarize, printSummary } from './arena_meter.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55934);
const RUNS = Number(arg('runs') || 3);
const ONLY = arg('only'), KIT = arg('kit'), OUT = arg('out');
// --orders=none: no orders to fight, so the bot goes by its own judgment (and the built-in orders), and the
// arena shows what its gear lets it take on rather than how a fight it was told to take goes.
const ORDERS = arg('orders') !== 'none';
const FAIR = arg('fair') !== 'off';
const NAME = 'Fighter';

// A zombie or spider summoned with no data is dressed at random (a baby now and then, armor, a jockey). With
// data it isn't, so every round meets the same mobs. A skeleton is given its bow, which it would otherwise
// get only from that random dressing.
const ADULT = 'PersistenceRequired:1b,CanPickUpLoot:0b';
const MOB_DATA = {
    zombie: `{${ADULT},IsBaby:0b}`,
    skeleton: `{${ADULT},equipment:{mainhand:{id:"minecraft:bow",count:1}}}`,
    spider: `{${ADULT}}`,
};
// The kits, as Java's console gives them (the names are arena_meter.js's).
const KITS = [
    { name: 'bare hands', commands: [] },
    { name: 'stone sword', commands: ['give @p stone_sword'] },
    { name: 'copper sword', commands: ['give @p copper_sword'] },
    { name: 'iron kit', commands: ['give @p iron_sword',
        ...['head iron_helmet', 'chest iron_chestplate', 'legs iron_leggings', 'feet iron_boots'].map(part => `item replace entity @p armor.${part.replace(' ', ' with ')}`)] },
];

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

    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    const meter = createMeter(bot);

    const order = (...args) => getCommand('!setThreatRule').perform(agent, ...args);
    if (ORDERS) for (const group of ['zombies', 'skeletons', 'spiders'])
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
                meter.start(mobs);
                // Whether the mobs came as summoned: no armor, a bow for each skeleton.
                const dressed = mobs.map(m => ({ kind: m.name, held: m.equipment?.[0]?.name ?? null,
                    armor: (m.equipment ?? []).slice(1).filter(Boolean).map(item => item.name) }));
                await waitFor(() => meter.over(), 50000);
                const result = { ...meter.finish({ kit: kit.name, round: scene.name, run, fair: FAIR, orders: ORDERS }, events, messages),
                    odd: dressed.filter(d => d.armor.length || (d.kind === 'skeleton' && d.held !== 'bow')) };
                results.push(result);
                console.log(JSON.stringify(result));
            }
        }
    }

    // The yardstick, one line per kit and round.
    const summary = summarize(results);
    printSummary(summary);
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
