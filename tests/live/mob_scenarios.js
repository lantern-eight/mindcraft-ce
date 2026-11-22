// SPDX-License-Identifier: CC0-1.0
// Live scenarios for the mob reflex (`mob_safety`), the fight (`self_defense`) and the enderman gaze guard
// (no model calls, free to run).
//   node tests/live/mob_scenarios.js [--port=55932] [--only=<part of a scene's name>] [--stock]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The bot runs under strict fair play with world memory, its reflexes ticking as an agent's do, and no
// model behind it. Each scene summons mobs with commands and checks what the bot does and what it costs:
// the time from the threat to the first step away, how far it ends up, the damage it takes, and in a night
// full of mobs, how often it is interrupted and how many path searches its reflexes ask for. The first
// scenes check what the edition seam reads off a real server: a mob's target and aim, and the side a hit
// came from. The test peeks at raw world data to check; the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { fairPlaySettings, faceToward, lookRound, LIVE_VIEW, faceExactly } from '../helpers/live_view.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('port') || 55932);
const NAME = 'Wary';
const results = [];
const ONLY = arg('only');
// A skeleton summoned on 26.3 gets no bow (summoning skips the random dressing a natural spawn gets), and
// comes at the bot bare-handed. Every skeleton here is given one, so the scenes meet an archer.
const BOW = 'equipment:{mainhand:{id:"minecraft:bow",count:1}}';
// --stock: no threat reflexes, Mindcraft's own; only the night and standing-by scenes run, to compare.
const STOCK = process.argv.includes('--stock');
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return null;
    if (STOCK && !/^(nuisance|standing by)/.test(name)) return null;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
    return result;
};
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;
const server = await vanillaFixture(port);
let bot, running = true;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline',
        ...fairPlaySettings(), world_memory: true, threat_reflexes: !STOCK, narrate_behavior: false });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { installThreatReflexes } = await import('../../src/agent/reflexes/install.js');
    const { editionOf } = await import('../../src/agent/edition/index.js');
    const skills = await import('../../src/agent/library/skills.js');

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
    // The bot's own look, before anything wraps it (fair play paces turns, and a paced turn's steps go
    // through the gaze guard), for the enderman scene's comparison.
    const unguardedLook = bot.look;
    const fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'mob-memory-')) });
    assert.ok(fair, 'fair play installed');
    // Standing orders given in a scene are kept in a folder of its own, never the bot's real one.
    const reflexes = installThreatReflexes(agent, { ordersDir: mkdtempSync(path.join(tmpdir(), 'mob-orders-')) });
    assert.ok(STOCK ? !reflexes : reflexes, 'threat reflexes installed, unless --stock');
    // Every path search the reflexes ask for (isClearPath gives the pathfinder 100 ms), counted.
    let pathSearches = 0;
    const getPathTo = bot.pathfinder.getPathTo.bind(bot.pathfinder);
    bot.pathfinder.getPathTo = (movements, goal, timeout) => { if (timeout === 100) pathSearches++; return getPathTo(movements, goal, timeout); };
    bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
    // The agent's update loop: a round of reflexes every 300 ms. How long each round takes is kept.
    const roundMs = [];
    (async () => {
        while (running) {
            const started = Date.now();
            try { await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
            roundMs.push(Date.now() - started);
            await delay(Math.max(0, 300 - (Date.now() - started)));
        }
    })().catch(error => console.error('the update loop stopped:', error));

    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    let lowestHealth = 20, damage = 0, lastHealth = 20;
    bot.on('health', () => {
        if (bot.health < lastHealth) damage += lastHealth - bot.health;
        lastHealth = bot.health; lowestHealth = Math.min(lowestHealth, bot.health);
    });
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 2 });
    const raw = name => Object.values(bot.entities).filter(e => e.name === name);
    const edition = editionOf(bot.registry);
    // Hits the bot's shield stopped: the shield's block sound where the bot stands (an entity status, 29,
    // before 1.21.5), counted once.
    let blocked = 0, lastBlock = 0;
    const onBlock = () => { if (Date.now() - lastBlock > 100) { lastBlock = Date.now(); blocked++; } };
    edition.onSound(bot, (name, at) => { if (/shield\.block/.test(name ?? '') && at && bot.entity && bot.entity.position.distanceTo(at) < 2) onBlock(); });
    bot._client.on('entity_status', packet => { if (packet.entityId === bot.entity?.id && packet.entityStatus === 29) onBlock(); });

    await cmd('difficulty normal');
    await cmd('gamerule spawn_mobs false');
    await cmd('gamerule advance_time false');
    await cmd('time set noon');
    await cmd('forceload add -40 -40 40 40');

    // A flat stone floor with its top at y 69, a wall round the edge, open air above, nothing alive but the bot.
    // A look all round, recorded: through a player's screen world memory would otherwise keep what was
    // there before a scene built or cleared something behind the bot, a wall that is gone or one that is new,
    // and the reflexes would plan by it. Seeing all around, the bot sees it all at once anyway.
    const lookAbout = async () => {
        if (LIVE_VIEW !== 'all') await lookRound(bot, () => fair.recorder.tick({ budgetMs: Infinity }));
    };
    async function reset({ x = 0.5, z = 0.5, facing = -90 } = {}) {
        await cmd('kill @e[type=!player]');
        await cmd('kill @e[type=!player]');
        await cmd('fill -40 66 -40 40 69 40 stone');
        for (const y of [70, 74, 78]) await cmd(`fill -40 ${y} -40 40 ${y + 3} 40 air`);
        for (const [a, b] of [['-40 70 -40', '40 72 -40'], ['-40 70 40', '40 72 40'], ['-40 70 -40', '-40 72 40'], ['40 70 -40', '40 72 40']])
            await cmd(`fill ${a} ${b} stone`);
        assert.doesNotMatch(server.log, /Too many blocks/, 'the arena was reset');
        await cmd('time set noon');
        await cmd(`clear ${NAME}`);
        await cmd(`effect clear ${NAME}`);
        await cmd(`effect give ${NAME} instant_health 1 5`);
        await cmd(`effect give ${NAME} saturation 1 20`);
        await cmd(`tp ${NAME} ${x} 70 ${z} ${facing} 0`);
        await waitFor(() => !agent.actions.executing, 20000, () => `still running ${agent.actions.currentActionLabel}`);
        await agent.actions.stop();
        await delay(2000);
        await lookAbout();
        // Facing the way the scene asks again: the stock idle look-around may have turned the bot meanwhile,
        // and through a player's screen which way it faces decides what it sees.
        await faceExactly(bot, (180 - facing) * Math.PI / 180, 0);
        events.length = 0; messages.length = 0;
        if (reflexes) { reflexes.mob.clear(); reflexes.fight.clear(); reflexes.claims.clear(); reflexes.creeper.picture.clear(); reflexes.glance?.clear(); }
        lowestHealth = lastHealth = bot.health; damage = 0;
    }
    const firstStepAfter = from => events.find(e => e.event === 'step' && e.at >= from);
    const decided = mode => events.filter(e => e.event === 'decided' && (!mode || e.mode === mode));

    // ---- What the edition seam reads off a real server ----

    await step('seam: a zombie that has come for the bot is aggressive; one with no target is not', async () => {
        await reset();
        await cmd('summon zombie 0.5 70 12.5 {NoAI:1b,PersistenceRequired:1b}');
        await cmd('summon zombie -6.5 70 0.5 {PersistenceRequired:1b}');
        await waitFor(() => raw('zombie').length === 2, 5000);
        const still = raw('zombie').find(z => z.position.z > 10), coming = raw('zombie').find(z => z !== still);
        await waitFor(() => edition.isAggressive(bot.registry, coming), 8000, () => JSON.stringify(coming.metadata));
        assert.equal(edition.isAggressive(bot.registry, still), false);
        await agent.actions.stop();
        return { comingFlags: coming.metadata[bot.registry.entitiesByName.zombie.metadataKeys.indexOf('mob_flags')] };
    });

    await step('seam: a skeleton taking aim at the bot is seen aiming', async () => {
        await reset();
        reflexes.mob.mode.on = false; // only watching here
        await cmd('summon skeleton 0.5 70 12.5 {PersistenceRequired:1b,equipment:{mainhand:{id:"minecraft:bow",count:1}}}');
        await cmd(`effect give ${NAME} resistance 30 4 true`);
        await waitFor(() => raw('skeleton').length === 1, 5000);
        const skeleton = raw('skeleton')[0];
        const keys = bot.registry.entitiesByName.skeleton.metadataKeys;
        const seen = [];
        const started = Date.now();
        await waitFor(() => {
            seen.push({ ms: Date.now() - started, mob: skeleton.metadata[keys.indexOf('mob_flags')], hand: skeleton.metadata[keys.indexOf('living_entity_flags')] });
            return edition.isAiming(bot.registry, skeleton);
        }, 10000, () => JSON.stringify(seen.slice(-5)));
        reflexes.mob.mode.on = true;
        return { aimingAfterMs: Date.now() - started, flags: seen.at(-1) };
    });

    await step('seam: a hit from a zombie to the south is felt from the south, whichever way the bot faces', async () => {
        const felt = [];
        const rounds = [];
        for (const facing of [180, -90, 0]) { // the game's yaw: north, east, south
            await reset({ facing });
            reflexes.mob.mode.on = false;
            await cmd(`tp ${NAME} 0.5 70 0.5 ${facing} 0`);
            await delay(500);
            await cmd('summon zombie 0.5 70 3.5 {NoAI:1b,PersistenceRequired:1b,Tags:["hitter"]}');
            await delay(500);
            felt.length = 0;
            const packets = [];
            const rawListener = packet => { if (packet.entityId === bot.entity.id) packets.push({ yaw: packet.yaw, botYawDeg: Number((bot.entity.yaw * 180 / Math.PI).toFixed(1)) }); };
            bot._client.on('hurt_animation', rawListener);
            const listener = event => { if (event.event === 'felt') felt.push(event.direction); };
            bot.on('threat_reflex', listener);
            await cmd(`damage ${NAME} 1 minecraft:mob_attack by @e[type=zombie,tag=hitter,limit=1]`);
            await waitFor(() => felt.length > 0, 3000, () => 'no hit felt');
            bot.off('threat_reflex', listener);
            bot._client.off('hurt_animation', rawListener);
            const d = felt[0];
            rounds.push({ facing, packets, direction: { x: Number(d.x.toFixed(2)), z: Number(d.z.toFixed(2)) } });
            console.log(JSON.stringify(rounds.at(-1)));
            if (!process.env.SEAM_PROBE) assert.ok(d.z > 0.9, `facing ${facing}: felt from ${JSON.stringify(d)}, the zombie is south (+z)`);
        }
        reflexes.mob.mode.on = true;
        return { rounds };
    });

    // ---- The mob reflex ----

    await step('two zombies coming: the bot backs away from both, ends 12 or more from each (10 through a player\'s screen), takes little damage', async () => {
        await reset({ facing: 135 }); // facing north-west, between where the two zombies will be
        await cmd('summon zombie -6.5 70 0.5 {PersistenceRequired:1b}');
        await cmd('summon zombie 0.5 70 -6.5 {PersistenceRequired:1b}');
        const spawned = performance.now();
        await waitFor(() => decided('mob_safety').length > 0, 10000, () => JSON.stringify(events));
        const first = firstStepAfter(decided('mob_safety')[0].at);
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 15000, () => JSON.stringify(events));
        const zombies = raw('zombie');
        const nearest = Math.min(...zombies.map(z => flat(bot.entity.position, z.position)));
        assert.equal(decided('mob_safety')[0].key, 'crowd', JSON.stringify(decided()));
        assert.equal(decided('self_defense').length, 0, `it did not fight two: ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => ({ ...e, at: Math.round(e.at - spawned) })))}`);
        // Through a player's screen the bot backs away facing the way out and goes by where it last saw them,
        // while they come on: it ends nearer than it knows, looks back, and backs away again if they come
        // within the crowd's 8 blocks. All around it sees them the whole way.
        const least = LIVE_VIEW === 'all' ? 12 : 10;
        assert.ok(nearest >= least, `ended ${nearest.toFixed(1)} from the nearest: ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => ({ ...e, at: Math.round(e.at - spawned) })))}`);
        assert.ok(damage <= 4, `${damage} damage`);
        return { decidedAfterMs: Math.round(decided('mob_safety')[0].at - spawned), firstStepMs: first ? Math.round(first.at - decided('mob_safety')[0].at) : null,
            how: first?.how, endedFromNearest: Number(nearest.toFixed(1)), damage };
    });

    await step('while walking to a spot, two zombies: the walk is stopped, the bot backs away, the model is told once', async () => {
        await reset({ x: -20.5 });
        const walk = act('action:goToPosition', () => skills.goToPosition(bot, 25, 70, 0.5, 1));
        await waitFor(() => bot.entity.position.x > -12, 8000);
        const p = bot.entity.position;
        await cmd(`summon zombie ${(p.x + 6).toFixed(1)} 70 ${(p.z + 2).toFixed(1)} {PersistenceRequired:1b}`);
        await cmd(`summon zombie ${(p.x + 6).toFixed(1)} 70 ${(p.z - 2).toFixed(1)} {PersistenceRequired:1b}`);
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 15000, () => JSON.stringify(events));
        const walked = await walk;
        assert.equal(walked.interrupted, true, 'the walk was stopped');
        assert.equal(messages.length, 1, messages.join('\n---\n'));
        assert.match(messages[0], /interrupted by mob_safety: Two zombies are coming at me/);
        return { message: messages[0].split('\n')[0], damage };
    });

    await step('a skeleton aiming, a wall nearby: the bot gets behind it and is not hit again there', async () => {
        await reset();
        // The bot stands in the open; a wall 3 wide and 3 high is 3 blocks east and 3 south of it, so the
        // skeleton to the east sees the bot, and the shadow of the wall is a few steps away.
        await cmd('fill 3 70 3 3 72 5 cobblestone');
        await cmd(`effect give ${NAME} resistance 60 2 true`);
        // The bot sees the wall: it looks at it, as a player in a new place looks about, and world memory keeps
        // it. Through a player's screen it is just past the edge of a look east. Then it faces east again. The
        // recorder looks a few milliseconds at a time, with the facing of the moment, so the look is held.
        await faceToward(bot, { x: 3.5, y: 71, z: 4 });
        await delay(3000);
        await faceToward(bot, { x: 14.5, y: 71.6, z: 0.5 });
        await delay(500);
        await cmd('summon skeleton 14.5 70 0.5 {PersistenceRequired:1b,equipment:{mainhand:{id:"minecraft:bow",count:1}}}');
        await waitFor(() => decided('mob_safety').some(e => e.stance === 'take_cover'), 15000, () => JSON.stringify(events));
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 15000, () => JSON.stringify(events));
        const done = events.find(e => e.event === 'done' && e.mode === 'mob_safety');
        const cover = events.find(e => e.event === 'cover');
        const at = bot.entity.position.clone();
        const damageAtCover = damage;
        await delay(5000);
        assert.equal(cover?.ended, 'covered', `took cover: ${JSON.stringify(events.filter(e => e.mode === 'mob_safety'))} at ${at}`);
        assert.ok(at.x < 3 && at.z > 2 && at.z < 7, `in the wall's shadow: ${at}`);
        return { ended: done.ended, at: at.floored().toString(), damageBeforeCover: damageAtCover, damageInTheNext5s: damage - damageAtCover,
            reflexMovesAfter: decided('mob_safety').length - 1 };
    });

    // No cover near, and no getting out of range: a pen walled 8 blocks out on every side, as in the fight
    // arena, where backing away from skeletons came near death. Unarmed, so the fight doesn't rush it. With
    // a shield the bot stops behind it while the bow is drawn and until the arrow lands. (On open ground the
    // bot outruns a skeleton's first shot, and there is nothing to block.)
    for (const shield of [false, true]) {
        await step(`a skeleton aiming in a walled pen with no cover, the bot unarmed${shield ? ' with a shield it is given: it blocks the shots' : ', no shield: the damage it takes'}`, async () => {
            await reset();
            for (const [a, b] of [['-8 70 -8', '8 73 -8'], ['-8 70 8', '8 73 8'], ['-8 70 -8', '-8 73 8'], ['8 70 -8', '8 73 8']])
                await cmd(`fill ${a} ${b} stone`);
            if (shield) await cmd(`give ${NAME} shield`);
            await delay(1500);
            await lookAbout(); // the bot sees its pen
            const blocksBefore = blocked;
            await cmd('summon skeleton 5.5 70 0.5 {PersistenceRequired:1b,equipment:{mainhand:{id:"minecraft:bow",count:1}}}');
            await waitFor(() => decided('mob_safety').some(e => e.stance === 'take_cover'), 15000, () => JSON.stringify(events));
            await delay(12000);
            const raised = events.filter(e => e.event === 'shield').length;
            const fell = events.filter(e => e.event === 'cover').map(e => e.ended);
            assert.ok(fell.every(ended => ended === 'no cover' || ended === 'no way there'), `no cover was found: ${fell}`);
            if (shield) assert.ok(raised > 0 && blocked > blocksBefore, `the shield went up (${raised}) and stopped arrows (${blocked - blocksBefore})`);
            else assert.equal(raised, 0);
            return { damage: Number(damage.toFixed(1)), raised, blocked: blocked - blocksBefore, moves: decided('mob_safety').length };
        });
    }

    await step('hit twice from behind a wall by something unseen: the bot gets away from that side', async () => {
        await reset();
        await cmd('fill 2 70 -3 2 73 3 stone');
        await cmd('summon zombie 4.5 70 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["hitter"]}');
        await delay(1500);
        const start = bot.entity.position.clone();
        await cmd(`damage ${NAME} 1 minecraft:mob_attack by @e[type=zombie,tag=hitter,limit=1]`);
        await delay(800);
        await cmd(`damage ${NAME} 1 minecraft:mob_attack by @e[type=zombie,tag=hitter,limit=1]`);
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 10000, () => JSON.stringify(events));
        assert.equal(decided('mob_safety')[0].key, 'unseen hits');
        assert.ok(bot.entity.position.x < start.x - 5, `went west, away from the hits: ${bot.entity.position} ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
        return { movedWest: Number((start.x - bot.entity.position.x).toFixed(1)) };
    });

    await step('badly hurt with a zombie in view: the bot runs, it doesn\'t fight', async () => {
        await reset({ facing: 90 }); // facing west, where the zombie will be
        await cmd(`give ${NAME} stone_sword`);
        await cmd(`damage ${NAME} 15 minecraft:generic`);
        await waitFor(() => bot.health <= 5, 3000);
        // West again: through a player's screen the idle look turns the bot every second or two, and the wait
        // above is long enough for it to face away. Once the zombie is on screen, the idle look holds still.
        await faceExactly(bot, Math.PI / 2, 0);
        await cmd('summon zombie -8.5 70 0.5 {PersistenceRequired:1b}');
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 15000, () => JSON.stringify(events));
        assert.ok(['flee', 'retreat'].includes(decided('mob_safety')[0].stance), JSON.stringify(decided()));
        assert.equal(decided('self_defense').length, 0);
        const zombie = raw('zombie')[0];
        const away = zombie ? flat(bot.entity.position, zombie.position) : null;
        return { stance: decided('mob_safety')[0].stance, endedAway: away && Number(away.toFixed(1)), health: bot.health };
    });

    // ---- The fight ----

    await step('a lone zombie, the bot with a stone sword at full health: it fights and kills it', async () => {
        await reset({ facing: 90 }); // facing west, where the zombie will be
        await cmd(`give ${NAME} stone_sword`);
        await cmd('summon zombie -6.5 70 0.5 {PersistenceRequired:1b}');
        await waitFor(() => raw('zombie').length === 0, 30000, () => JSON.stringify(events));
        assert.ok(decided('self_defense').length >= 1, JSON.stringify(events));
        // Hurt under half health part way, the bot backs away from it for a moment (rule 5b): that is allowed.
        assert.ok(decided('mob_safety').every(e => e.key.startsWith('id:')), `only that zombie was backed away from: ${JSON.stringify(decided())}`);
        assert.ok(lowestHealth >= 6, `lowest health ${lowestHealth}`);
        return { damage, fights: decided('self_defense').length, backedAway: decided('mob_safety').length };
    });

    // ---- Standing orders ----

    // The health the bot had at each reflex's decision, to tell a crowd retreat the order allowed (under its
    // minimum) from one it should have prevented.
    const healthAtDecisions = [];
    bot.on('threat_reflex', event => { if (event.event === 'decided') healthAtDecisions.push({ mode: event.mode, key: event.key, health: bot.health }); });
    const { getCommand } = await import('../../src/agent/commands/index.js');
    const order = (...args) => getCommand('!setThreatRule').perform(agent, ...args);

    await step('armed with a stone sword, two zombies coming: the built-in order fights them instead of backing away, while health holds', async () => {
        await reset({ facing: 135 }); // facing north-west, between where the two zombies will be
        await cmd(`give ${NAME} stone_sword`);
        healthAtDecisions.length = 0;
        await cmd('summon zombie -6.5 70 0.5 {PersistenceRequired:1b}');
        await cmd('summon zombie 0.5 70 -6.5 {PersistenceRequired:1b}');
        const started = Date.now();
        // Over when both are dead, or when the bot has backed away (the order lapsed under half health).
        await waitFor(() => raw('zombie').length === 0 || events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 60000, () => JSON.stringify(events.filter(e => e.event !== 'step')));
        const crowdWhileFit = healthAtDecisions.filter(d => d.mode === 'mob_safety' && d.health >= 10);
        assert.ok(decided('self_defense').length >= 1, `it fought: ${JSON.stringify(decided())}`);
        assert.equal(crowdWhileFit.length, 0, `no retreat at half health or more: ${JSON.stringify(healthAtDecisions)}`);
        assert.ok(lowestHealth >= 4, `lowest health ${lowestHealth}`);
        return { killed: 2 - raw('zombie').length, seconds: Math.round((Date.now() - started) / 1000), fights: decided('self_defense').length,
            retreatsAfterLapse: decided('mob_safety').length, damage, lowestHealth };
    });

    await step('told by command to back away from zombies: a lone zombie coming is backed away from, to the order\'s distance, and the line says why', async () => {
        await reset({ facing: 90 }); // facing west, where the zombie will be
        assert.match(await order('zombies', 'flee', 0, 20), /back away from zombies to 20 blocks/);
        try {
            act('action:stay', () => skills.stay(bot, -1));
            await delay(500);
            await cmd('summon zombie -6.5 70 0.5 {PersistenceRequired:1b}');
            await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 20000, () => JSON.stringify(events));
            const zombie = raw('zombie')[0];
            const away = zombie ? flat(bot.entity.position, zombie.position) : null;
            assert.equal(decided('mob_safety')[0].reason, 'ordered', JSON.stringify(decided()));
            assert.equal(decided('self_defense').length, 0, 'not fought');
            assert.ok(away >= 14, `ended ${away?.toFixed(1)} from it`);
            assert.match(messages[0] ?? '', /backing away, as I was told to\./);
            return { endedAway: Number(away.toFixed(1)), message: messages[0].split('\n')[0], damage };
        } finally {
            await agent.actions.stop();
            await order('zombies', 'default', 0, 0);
        }
    });

    await step('told to ignore skeletons: one aiming at the bot sends it nowhere', async () => {
        await reset();
        await order('skeletons', 'ignore', 0, 0);
        try {
            await cmd(`effect give ${NAME} resistance 60 4 true`);
            await cmd('summon skeleton 12.5 70 0.5 {PersistenceRequired:1b,equipment:{mainhand:{id:"minecraft:bow",count:1}}}');
            await delay(10000);
            assert.equal(decided().length, 0, JSON.stringify(decided()));
            return { arrowsTakenAsDamage: damage };
        } finally {
            await order('skeletons', 'default', 0, 0);
        }
    });

    await step('told to fight skeletons, with a stone sword: the bot goes for an aiming skeleton instead of taking cover', async () => {
        await reset();
        await cmd(`give ${NAME} stone_sword`);
        await order('skeletons', 'fight', 0, 0);
        try {
            await cmd(`effect give ${NAME} resistance 60 2 true`);
            await cmd('summon skeleton 10.5 70 0.5 {PersistenceRequired:1b,equipment:{mainhand:{id:"minecraft:bow",count:1}}}');
            await waitFor(() => raw('skeleton').length === 0, 45000, () => JSON.stringify(events.filter(e => e.event !== 'step')));
            assert.ok(decided('self_defense').length >= 1, JSON.stringify(decided()));
            assert.equal(decided('mob_safety').filter(e => e.stance === 'take_cover').length, 0, `no cover: ${JSON.stringify(events.filter(e => e.event === 'decided' || e.event === 'done'))}`);
            return { fights: decided('self_defense').length, damage, lowestHealth };
        } finally {
            await order('skeletons', 'default', 0, 0);
        }
    });

    // ---- The gaze guard ----

    await step('the bot looks straight at an enderman\'s head: the look is lowered, and it never turns on the bot', async () => {
        await reset();
        await cmd('time set midnight');
        await cmd('summon enderman 0.5 70 -12.5 {PersistenceRequired:1b,attributes:[{id:"minecraft:movement_speed",base:0.0}]}');
        await waitFor(() => raw('enderman').length === 1, 5000);
        const enderman = raw('enderman')[0];
        const keys = bot.registry.entitiesByName.enderman.metadataKeys;
        const angry = () => enderman.metadata[keys.indexOf('creepy')] === true || edition.isAggressive(bot.registry, enderman);
        const started = Date.now();
        while (Date.now() - started < 6000) {
            await bot.lookAt(enderman.position.offset(0, 2.55, 0), true);
            await delay(100);
            assert.equal(angry(), false, 'it turned on the bot');
        }
        const pitch = bot.entity.pitch, straight = Math.atan2(enderman.position.y + 2.55 - bot.entity.position.y - 1.62, flat(bot.entity.position, enderman.position));
        // The same look without the guard: the game's rule is real, the enderman turns on the bot.
        await cmd(`effect give ${NAME} resistance 30 4 true`);
        const yaw = Math.atan2(-(enderman.position.x - bot.entity.position.x), -(enderman.position.z - bot.entity.position.z));
        const unguarded = Date.now();
        await waitFor(() => { unguardedLook(yaw, straight, true); return angry(); }, 8000, () => 'it never turned on the bot');
        const angryAfterMs = Date.now() - unguarded;
        await cmd('kill @e[type=enderman]');
        await cmd('time set noon');
        return { lookedPitch: Number(pitch.toFixed(3)), headPitch: Number(straight.toFixed(3)), unguardedAngryAfterMs: angryAfterMs };
    });

    // ---- A night full of mobs ----

    await step('nuisance: a night of zombies, skeletons and a spider for 60 s: interruptions, path searches, round time', async () => {
        await reset();
        await cmd('time set midnight');
        await cmd(`effect give ${NAME} resistance 90 4 true`);
        await cmd(`give ${NAME} stone_sword`);
        roundMs.length = 0;
        pathSearches = 0;
        for (const [mob, x, z] of [['zombie', 14, 3], ['zombie', -13, 5], ['skeleton', 16, -12], ['spider', -15, -12], ['zombie', 3, 18], ['skeleton', -18, 14]])
            await cmd(`summon ${mob} ${x}.5 70 ${z}.5 {PersistenceRequired:1b${mob === 'skeleton' ? `,${BOW}` : ''}}`);
        await delay(60000);
        await cmd('time set noon');
        const moves = decided().length;
        const byMode = Object.fromEntries(['mob_safety', 'self_defense', 'creeper_safety'].map(m => [m, decided(m).length]));
        const sorted = [...roundMs].sort((a, b) => a - b);
        if (!STOCK) assert.ok(moves <= 20, `${moves} reflex moves in a minute`);
        return { reflexes: STOCK ? 'stock' : 'threat', reflexMovesPerMinute: moves, byMode, messagesToModel: messages.length, pathSearches,
            roundMsMedian: sorted[Math.floor(sorted.length / 2)], roundMsP95: sorted[Math.floor(sorted.length * 0.95)], damage, lowestHealth };
    });

    await step('standing by: an item out of reach on a pillar, for 30 s: path searches and round time', async () => {
        await reset();
        await cmd('fill 4 70 0 4 72 0 stone');
        await cmd('summon item 4.5 73 0.5 {Item:{id:"minecraft:cobblestone",count:1},PickupDelay:0s,NoGravity:1b}');
        await delay(1000);
        roundMs.length = 0;
        pathSearches = 0;
        await delay(30000);
        const sorted = [...roundMs].sort((a, b) => a - b);
        return { reflexes: STOCK ? 'stock' : 'threat', pathSearches, roundMsMedian: sorted[Math.floor(sorted.length / 2)],
            roundMsP95: sorted[Math.floor(sorted.length * 0.95)], roundMsTotal: roundMs.reduce((a, b) => a + b, 0) };
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
