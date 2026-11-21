// SPDX-License-Identifier: CC0-1.0
// The fight arena on a real Bedrock Dedicated Server: how well the bot fights, measured (no model calls,
// free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_fight_arena.js
//       [--runs=3] [--only=<part of a round's name>] [--kit=<part of a kit's name>] [--orders=none] [--shield=nobeat]
//       [--out=<file for the results as JSON>]
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: it builds an arena, fills it with mobs and lets the bot die in it.
//
// The Bedrock twin of fight_arena.js, with the same rounds and kits and the same measures (arena_meter.js).
// It is a yardstick, not a check: run before and after a change to how the bot fights. Bedrock's console
// differs: it can't remove mobs by kind, so peaceful difficulty clears them between rounds; a zombie is
// summoned with the event that makes it an adult, since nothing else stops one coming out a baby; the kits
// are given with Bedrock's commands; and a round counts as lost by death at 4 health, when the bot is healed,
// since a Bedrock bot that really dies may not come back.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, delay, freshStart } from './bedrock_fixture.js';
import { ROUNDS, createMeter, summarize, printSummary } from './arena_meter.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const RUNS = Number(arg('runs') || 3);
const ONLY = arg('only'), KIT = arg('kit'), OUT = arg('out');
// --shield=nobeat: the shield doesn't keep the beat of a skeleton's shots, to measure what the beat gives.
const NO_BEAT = arg('shield') === 'nobeat';
// --orders=none: no orders to fight, so the bot goes by its own judgment (and the built-in orders), and the
// arena shows what its gear lets it take on rather than how a fight it was told to take goes.
const ORDERS = arg('orders') !== 'none';
const NAME = 'BedrockFighter';
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The arena is built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

// The kits, as Bedrock's console gives them (the names are arena_meter.js's).
const armor = ['head iron_helmet', 'chest iron_chestplate', 'legs iron_leggings', 'feet iron_boots']
    .map(part => part.split(' ')).map(([slot, item]) => `replaceitem entity ${NAME} slot.armor.${slot} 0 ${item}`);
const KITS = [
    { name: 'bare hands', commands: [] },
    { name: 'stone sword', commands: [`give ${NAME} stone_sword`] },
    { name: 'copper sword', commands: [`give ${NAME} copper_sword`] },
    { name: 'iron kit', commands: [`give ${NAME} iron_sword`, ...armor] },
    // The shield is given, not put in the off-hand: putting it there is the bot's to do. A Bedrock skeleton
    // shows no bow drawn, so the shield goes up against none of these mobs: the kit checks it changes nothing.
    { name: 'stone sword and shield', commands: [`give ${NAME} stone_sword`, `give ${NAME} shield`] },
];
// Summoned the way that gives the same mob every round: a zombie made an adult by its own event.
const SUMMON_EVENT = { zombie: ' 0 0 minecraft:as_adult', skeleton: '', spider: '' };

const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;
const results = [];
let bot, origin, running = true;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);

async function waitFor(check, ms, why = () => 'timed out') {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(why());
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, threat_reflexes: true, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installThreatReflexes } = await import('../../src/agent/reflexes/install.js');
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const { shieldTuning } = await import('../../src/agent/reflexes/shield.js');
    shieldTuning.beat = !NO_BEAT;

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
    await delay(2500);
    await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
    origin = bot.entity.position.floored().offset(0, 40, 0);

    const messages = [], events = [];
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
    assert.ok(installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-arena-memory-')) }), 'fair play installed');
    const reflexes = installThreatReflexes(agent, { ordersDir: mkdtempSync(path.join(tmpdir(), 'bedrock-arena-orders-')) });
    assert.ok(reflexes, 'the threat reflexes installed');
    bot.on('threat_reflex', event => events.push(event));
    bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
    (async () => {
        while (running) {
            const started = Date.now();
            try { if (bot.entity && bot.health > 0) await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
            await delay(Math.max(0, 300 - (Date.now() - started)));
        }
    })().catch(error => console.error('the update loop stopped:', error));
    // A bot that really dies here may stay dead (see the gamerule below), which would end the run. So a round
    // is lost "by death" when health falls to 4 or under, and the console heals the bot then: below the 6 where
    // the bot runs, and more than most single hits here (a zombie's 3, a spider's 2) from dying.
    const meter = createMeter(bot, { brink: 4, onBrink: () => { cmd(`effect ${NAME} instant_health 1 10`, 0).catch(() => {}); } });
    // A Bedrock server tells of a hit a shield stopped with the shield's block sound, where the bot stands.
    bot._client.on('level_sound_event', packet => {
        if (packet?.sound_id === 'item.shield.block' && bot.entity && bot.entity.position.distanceTo(packet.position) < 2) meter.blocked();
    });

    // Fight every kind in the arena down to 6 health, the floor no order goes under, as on Java.
    const order = (...args) => getCommand('!setThreatRule').perform(agent, ...args);
    if (ORDERS) for (const group of ['zombies', 'skeletons', 'spiders'])
        assert.match(await order(group, 'fight', 6, 0), /fight/, `the order to fight ${group}`);

    await cmd('gamerule domobspawning false');
    await cmd('gamerule mobgriefing false');
    await cmd('gamerule keepinventory true');
    // No loot: the rotten flesh and bones of a run's kills would lie about the spawn for the next script's bot to pick up.
    await cmd('gamerule domobloot false');
    await cmd('gamerule dodaylightcycle false');
    // A bot that dies here sometimes stays dead: the pinned libraries don't always finish the respawn the server
    // starts (docs/bedrock.md, Known Gaps). Respawning at once, with no death screen, always comes back.
    await cmd('gamerule doimmediaterespawn true');

    // A stone floor 40 blocks above where the bot spawned, walled 10 blocks out on every side and 4 high,
    // at midnight, as on Java.
    async function reset(kit) {
        await cmd('difficulty peaceful', 1000);
        await cmd('difficulty normal');
        await waitFor(() => bot.entity && bot.health > 0, 40000, () => `the bot did not respawn (health ${bot.health}, alive ${bot.isAlive})`);
        await waitFor(() => !agent.actions.executing, 20000, () => `still running ${agent.actions.currentActionLabel}`);
        await fill([-16, 1, -16], [16, 6, 16], 'air');
        await fill([-16, 0, -16], [16, 0, 16], 'stone');
        for (const [a, b] of [[[-10, 1, -10], [10, 4, -10]], [[-10, 1, 10], [10, 4, 10]], [[-10, 1, -10], [-10, 4, 10]], [[10, 1, -10], [10, 4, 10]]])
            await fill(a, b, 'stone');
        await cmd('time set midnight');
        await cmd(`clear ${NAME}`);
        await cmd(`effect ${NAME} clear`);
        await cmd(`effect ${NAME} instant_health 1 5`);
        await cmd(`effect ${NAME} saturation 1 20`);
        for (const line of kit.commands) await cmd(line);
        await cmd(`tp ${NAME} ${at(0, 1, 0).x + 0.5} ${at(0, 1, 0).y} ${at(0, 1, 0).z + 0.5} -90 0`, 1500);
        await agent.actions.stop();
        await delay(1000);
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
                for (const [kind, x, z] of scene.mobs) {
                    const spot = at(x, 1, z);
                    await cmd(`summon ${kind} ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}${SUMMON_EVENT[kind]}`, 100);
                }
                await waitFor(() => raw(kinds).length === scene.mobs.length, 8000, () => `${raw(kinds).length} of ${scene.mobs.length} mobs seen`);
                meter.start(raw(kinds));
                await waitFor(() => meter.over(), 50000);
                const result = meter.finish({ kit: kit.name, round: scene.name, run, edition: 'bedrock', orders: ORDERS, beat: !NO_BEAT }, events, messages);
                results.push(result);
                console.log(JSON.stringify(result));
            }
        }
    }

    const summary = summarize(results);
    printSummary(summary);
    if (OUT) writeFileSync(OUT, JSON.stringify({ edition: 'bedrock', runs: RUNS, results, summary }, null, 2));
    assert.ok(results.length > 0, 'at least one round ran');
    console.log(JSON.stringify({ status: 'passed', rounds: results.length }));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, rounds: results.length }));
    process.exitCode = 1;
} finally {
    running = false;
    // Put the world back as the other Bedrock scripts expect it: with these rules left on, a later script's bot
    // keeps what it picked up here (rotten flesh in its hand where a block should be) and respawns differently.
    // Peaceful takes the last mobs away; the arena itself is cleared, so no later floor lands on it.
    try {
        for (const line of ['gamerule keepinventory false', 'gamerule doimmediaterespawn false', 'gamerule dodaylightcycle true',
            'gamerule mobgriefing true', 'gamerule domobloot true', 'difficulty peaceful', `clear ${NAME}`, `effect ${NAME} clear`])
            await cmd(line);
        if (origin) {
            await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y - 39} ${origin.z + 0.5}`, 1500); // down first: a fall of 40 kills
            await fill([-16, 0, -16], [16, 6, 16], 'air');
        }
    } catch { /* the console is gone */ }
    bot?.quit?.();
    process.exit(process.exitCode ?? 0);
}
