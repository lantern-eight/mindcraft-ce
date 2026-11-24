// SPDX-License-Identifier: CC0-1.0
// The threat reflexes on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_threats.js [--only=<part of a scene's name>]
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: creepers explode here, and the scenes are built and torn down from the console.
//
// The Bedrock twin of threat_scenarios.js. A Bedrock console can't summon a creeper without its wits or with
// a fuse of its own length, so a creeper is lit with the event Bedrock's own creepers use to start exploding,
// `minecraft:start_exploding_forced`, and penned in glass where it must stay put (glass hides nothing from
// the bot). Mob griefing is turned off, so a blast leaves the scene standing; it still hurts whoever is
// close, and the bot must take no damage.
//
// It also answers what the reflexes need to know about Bedrock: which flag shows the fuse is lit, that the
// hiss reaches hearing, what the server shows of a mob's target and aim (nothing, so the edition seam goes by
// the mob's kind and where it faces), and the side a hit came from (the push the server gives the bot). A
// following creeper is only ever left behind on Bedrock (docs/threat-reflexes.md). Then the mob reflex and
// the fight, briefly: the Java scenes in mob_scenarios.js are the full set.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings, faceToward, lookRound, LIVE_VIEW, faceExactly } from '../helpers/live_view.js';

const NAME = 'BedrockWary';
const report = createReport();
const { summary } = report;
// --only: the scenes whose name has this in it, after the first, which joins and sets up.
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
let joined = false;
const step = (name, fn) => {
    if (joined && ONLY && !new RegExp(ONLY).test(name)) return null;
    joined = true;
    return report.step(name, fn);
};
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;
const defaultModes = JSON.parse(readFileSync('profiles/defaults/_default.json', 'utf8')).modes;

let bot, origin, running = true;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const tpTo = (cell, yaw = 0, settle = 1200) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function waitFor(check, ms, why) {
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
    const { editionOf } = await import('../../src/agent/edition/index.js');
    const { heldFrom } = await import('../../src/agent/action_hold.js');
    const skills = await import('../../src/agent/library/skills.js');

    let agent, reflexes, fair;
    const messages = [], events = [];
    let lowestHealth = 20, blocked = 0;
    const rawCreeper = () => Object.values(bot.entities).find(e => e.name === 'creeper') ?? null;
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 2 });

    // A stone floor 40 blocks above the bot's spawn, 61 wide, with nothing above it.
    // A console line can't name a mob to remove (it would need a selector a shell could change), so peaceful
    // difficulty, which removes every hostile mob, clears the creepers, and normal difficulty comes back.
    async function reset({ facing = -90 } = {}) {
        await cmd('difficulty peaceful', 1000);
        await cmd('difficulty normal');
        await waitFor(() => !agent?.actions.executing, 15000, () => 'the reflex is still moving');
        for (let x = -30; x <= 30; x += 15) await fill([x, 1, -30], [Math.min(x + 14, 30), 6, 30], 'air'); // to 30, the floor's edge
        await fill([-30, 0, -30], [30, 0, 30], 'stone');
        await cmd(`effect ${NAME} clear`);
        // Each scene gives the bot what it needs: a sword left from the last one would change what the
        // standing orders let it fight.
        await cmd(`clear ${NAME}`);
        await cmd(`effect ${NAME} instant_health 1 5`);
        await tpTo([0, 1, 0], facing, 2500);
        // Facing the way the scene asks again: the idle look-around may have turned the bot meanwhile, and
        // through a player's screen which way it faces decides what it sees.
        await faceExactly(bot, (180 - facing) * Math.PI / 180, 0);
        events.length = 0; messages.length = 0;
        reflexes?.creeper.picture.clear();
        reflexes?.zones.clear(); // as on Java: no danger remembered from the last scene bends this one's escape
        reflexes?.glance?.clear(); // nor a look back from the last one's back-off, which would turn the bot
        lowestHealth = bot.health;
    }
    // Every zombie is summoned grown (minecraft:as_adult). A summon makes a baby now and then, and a baby runs
    // as fast as the bot sprints: one kept pace with a retreat for 5 s and caught it at the floor's edge.
    // A creeper lit where it stands, penned in glass so it can't walk.
    async function litCreeper(cell) {
        await fill([cell[0] - 1, 1, cell[2] - 1], [cell[0] + 1, 3, cell[2] + 1], 'glass');
        await fill([cell[0], 1, cell[2]], [cell[0], 2, cell[2]], 'air');
        const spot = at(...cell);
        await cmd(`summon creeper ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:start_exploding_forced`, 0);
        return { x: spot.x + 0.5, z: spot.z + 0.5 };
    }
    async function settle(ms = 12000) {
        await waitFor(() => events.some(e => e.event === 'done'), ms, () => JSON.stringify(events));
        let quietSince = Date.now(), seen = events.length;
        await waitFor(() => {
            if (events.length !== seen || agent.actions.currentActionLabel === 'mode:creeper_safety') { seen = events.length; quietSince = Date.now(); }
            return Date.now() - quietSince > 2000;
        }, ms + 10000, () => JSON.stringify(events));
    }

    await step('the bot joins, the floor is built, and fair play and the creeper reflex are installed', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule domobspawning false');
        await cmd('gamerule mobgriefing false');
        // No loot: what a zombie the bot killed drops stays on the floor through the next reset, and item
        // collecting walks the bot off its spot to pick it up. Ten blocks off, a creeper summoned for the next
        // scene was more than 16 away and never came for it.
        await cmd('gamerule domobloot false');
        await cmd('time set noon');
        agent = {
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
        fair = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-threat-memory-')) });
        assert.ok(fair, 'fair play installed');
        // Standing orders given in a scene are kept in a folder of its own, never the bot's real one.
        reflexes = installThreatReflexes(agent, { ordersDir: mkdtempSync(path.join(tmpdir(), 'bedrock-threat-orders-')) });
        assert.ok(reflexes, 'the threat reflexes installed');
        bot.on('threat_reflex', event => events.push(event));
        bot.on('health', () => { lowestHealth = Math.min(lowestHealth, bot.health); });
        // A hit the bot's shield stopped: the shield's block sound, where the bot stands.
        bot._client.on('level_sound_event', packet => {
            if (packet?.sound_id === 'item.shield.block' && bot.entity && bot.entity.position.distanceTo(packet.position) < 2) blocked++;
        });
        bot.on('idle', () => { bot.clearControlStates(); bot.pathfinder.stop(); bot.modes.unPauseAll(); });
        (async () => {
            while (running) {
                const started = Date.now();
                try { await bot.modes.update(); } catch (error) { console.error('mode update failed:', error); }
                await delay(Math.max(0, 300 - (Date.now() - started)));
            }
        })().catch(error => console.error('the update loop stopped:', error));
        await reset();
        assert.equal(bot.blockAt(at(0, 0, 0))?.name, 'stone', 'the bot stands on the floor');
    });

    await step('a creeper lit 5 blocks away is seen lit: its ignited flag is what the edition seam reads', async () => {
        await reset();
        const spot = await litCreeper([5, 1, 0]);
        await waitFor(() => rawCreeper(), 5000, () => 'no creeper arrived');
        let lit = false;
        await waitFor(() => (lit = editionOf(bot.registry).isFusing(bot.registry, rawCreeper() ?? {})), 2000,
            () => `flags: ${JSON.stringify(rawCreeper()?.metadata?.flags)}`);
        await settle();
        return { isFusing: lit, decidedOn: events.find(e => e.event === 'decided')?.key, heard: events.some(e => e.event === 'heard'), spot };
    });

    const blastDistances = [], hissTimes = [];
    for (let run = 1; run <= 3; run++) {
        await step(`a creeper lit 2 blocks away, run ${run}: the bot steps away within 300 ms of the hiss, is 7 or more blocks off when it goes off, and takes no damage`, async () => {
            await reset();
            let gone = null;
            const onGone = entity => { if (entity.name === 'creeper') gone = { bot: bot.entity.position.clone(), creeper: entity.position.clone() }; };
            bot.on('entityGone', onGone);
            await litCreeper([-2, 1, 0]);
            await waitFor(() => gone, 8000, () => JSON.stringify(events));
            bot.off('entityGone', onGone);
            const heard = events.find(e => e.event === 'heard');
            const first = events.find(e => e.event === 'step');
            assert.ok(first, `it stepped away: ${JSON.stringify(events)}`);
            const off = flat(gone.bot, gone.creeper);
            assert.ok(off >= 7, `it was ${off.toFixed(1)} blocks off when it went off: ${JSON.stringify(events)}, action ${agent.actions.currentActionLabel}, held ${heldFrom(agent, 'mode:creeper_safety')}`);
            await delay(1000);
            assert.equal(lowestHealth, 20, 'no damage');
            const ms = heard ? Math.round(first.at - heard.at) : null;
            if (heard) { assert.ok(ms <= 300, `${ms} ms from the hiss`); hissTimes.push(ms); }
            blastDistances.push(Number(off.toFixed(1)));
            return { blocksOffAtBlast: Number(off.toFixed(1)), msFromHiss: ms, how: first.how };
        });
    }

    await step('a creeper lit around a corner, never seen: the bot backs off on the hiss alone', async () => {
        await reset();
        await fill([2, 1, -6], [2, 4, 6], 'stone');
        await delay(1500);
        await litCreeper([4, 1, 0]);
        await settle();
        const decided = events.find(e => e.event === 'decided');
        assert.match(decided.key, /^heard:/, 'from the sound: it never saw the creeper');
        const away = flat(bot.entity.position, at(4.5, 0, 0.5));
        assert.ok(away >= 7, `it ended ${away.toFixed(1)} blocks away`);
        assert.equal(lowestHealth, 20, 'no damage');
        return { endedBlocksAway: Number(away.toFixed(1)) };
    });

    // Cornered: a dead end one block wide, walls to the north, south and east of the bot, and a creeper lit
    // inside its mouth, with no glass pen (glass between would take most of the blast; a lit creeper stands
    // where it is). There is nowhere to run. A Bedrock player raises a shield by sneaking (the edition seam's
    // raiseShield); faced at the blast, it stops it. Without one, the damage is what cornering costs: on easy,
    // as on Java, so a bot without a shield lives to be measured.
    for (const shield of [false, true]) {
        await step(`cornered by a lit creeper${shield ? ', with a shield it is given: it goes in the off-hand, and the bot faces the blast sneaking behind it, no damage' : ', no shield: the damage it takes'}`, async () => {
            await reset({ facing: 90 }); // facing west, where the creeper will be
            await cmd('difficulty easy');
            await fill([-3, 1, -1], [1, 2, -1], 'stone');
            await fill([-3, 1, 1], [1, 2, 1], 'stone');
            await fill([1, 1, 0], [1, 2, 0], 'stone');
            if (shield) await cmd(`give ${NAME} shield`);
            await delay(1500);
            // The bot sees the dead end it stands in, a look all round, recorded, and faces the mouth again: the
            // idle look-around may have turned it to the walls, and through a player's screen the creeper would
            // then be only heard, and a shield goes up only at one seen.
            if (LIVE_VIEW !== 'all') await lookRound(bot, () => fair.recorder.tick({ budgetMs: Infinity }));
            await faceToward(bot, at(-2, 1, 0).offset(0.5, 1.6, 0.5));
            let gone = null;
            const onGone = entity => { if (entity.name === 'creeper') gone = performance.now(); };
            bot.on('entityGone', onGone);
            const spot = at(-2, 1, 0);
            const lit = performance.now();
            await cmd(`summon creeper ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:start_exploding_forced`, 0);
            await waitFor(() => gone, 8000, () => JSON.stringify(events));
            bot.off('entityGone', onGone);
            await delay(1000);
            const raised = events.filter(e => e.event === 'shield').length;
            // When the shield went up, against when the creeper was lit and when it went.
            const upAt = events.find(e => e.event === 'shield')?.at;
            const timing = { raisedMsAfterLit: upAt ? Math.round(upAt - lit) : null, blastMsAfterLit: Math.round(gone - lit) };
            const offHand = bot.inventory.slots[45]?.name ?? null;
            if (shield) {
                assert.equal(offHand, 'shield', 'the shield was put in the off-hand');
                assert.ok(raised > 0, `the shield went up: ${JSON.stringify(events)}`);
                assert.equal(lowestHealth, 20, `no damage behind the shield (lowest health ${lowestHealth}, ${JSON.stringify(timing)})`);
            } else {
                assert.equal(raised, 0);
            }
            return { damage: Number((20 - lowestHealth).toFixed(1)), raised, offHand, ...timing };
        });
    }

    await step('a creeper following the bot, which has a stone sword: on Bedrock it is left behind, within 3 rounds, the model told once, no damage', async () => {
        await reset();
        // Near the east edge, with room to the west to leave it behind, as on Java: leaving by distance, through a
        // player's screen, can take the bot 30 blocks, and from the middle it reached the floor's edge.
        await tpTo([18, 1, 0], -90, 2500);
        await faceExactly(bot, 3 * Math.PI / 2, 0); // east, where the creeper will come from
        await cmd(`give ${NAME} stone_sword 1`, 700);
        let keepBusy = true;
        const busy = () => { if (keepBusy && !agent.actions.executing) act('action:stay', () => skills.stay(bot, -1)); };
        const restart = event => { if (event.event === 'done') setTimeout(busy, 1700); };
        bot.on('threat_reflex', restart);
        busy();
        const start = at(28, 1, 0);
        await cmd(`summon creeper ${start.x + 0.5} ${start.y} ${start.z + 0.5}`);
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
        const stances = events.filter(e => e.event === 'decided').map(e => e.stance);
        assert.ok(!stances.includes('hit_and_step_back'), 'never goes back in on Bedrock');
        const endings = events.filter(e => e.event === 'done').map(e => e.ended);
        // Through a player's screen the bot can't see whether the creeper has lost it, so it leaves by distance
        // each time, and the creeper may take up the chase once more: one round more.
        const most = LIVE_VIEW === 'all' ? 3 : 4;
        assert.ok(rounds <= most, `${rounds} rounds: ${JSON.stringify(stances)}, ended ${JSON.stringify(endings)}, times ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => Math.round(e.at / 100) / 10))}`);
        assert.ok(messages.length <= 1, `${messages.join('\n---\n')} ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => [Math.round(e.at), e.event, e.stance, e.ended, e.key]))}`);
        assert.equal(lowestHealth, 20, `no damage: ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => [Math.round(e.at), e.event, e.stance, e.ended, e.key]))}`);
        return { rounds, stances, creeperLeft: Boolean(rawCreeper()) };
    });

    // ---- The mob reflex: what a Bedrock server shows of a mob's target, its aim, and a hit ----

    // The flags a mob shows over a stretch of time: each one that was ever set, and when it first was.
    function watchFlags(mob, ms) {
        const started = Date.now(), first = {};
        return new Promise(resolve => {
            const timer = setInterval(() => {
                const all = { ...(mob.metadata?.flags ?? {}), ...Object.fromEntries(Object.entries(mob.metadata?.flags_extended ?? {}).map(([k, v]) => [`+${k}`, v])) };
                for (const [name, on] of Object.entries(all)) if (on && first[name] === undefined) first[name] = Date.now() - started;
                if (Date.now() - started > ms) { clearInterval(timer); resolve(first); }
            }, 100);
        });
    }
    const rawMob = name => Object.values(bot.entities).find(e => e.name === name) ?? null;

    await step('a zombie coming for the bot: the server shows no target, and isAggressive goes by its kind', async () => {
        await reset();
        reflexes.mob.mode.on = false; reflexes.fight.mode.on = false; // only watching here
        await cmd(`effect ${NAME} resistance 30 4 true`);
        const spot = at(8, 1, 0);
        await cmd(`summon zombie ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:as_adult`);
        await waitFor(() => rawMob('zombie'), 5000, () => 'no zombie arrived');
        const zombie = rawMob('zombie');
        let aggressiveAt = null;
        const started = Date.now();
        const watching = watchFlags(zombie, 8000);
        const check = setInterval(() => { if (aggressiveAt === null && editionOf(bot.registry).isAggressive(bot.registry, zombie)) aggressiveAt = Date.now() - started; }, 100);
        const flags = await watching;
        clearInterval(check);
        reflexes.mob.mode.on = true; reflexes.fight.mode.on = true;
        assert.notEqual(aggressiveAt, null, 'a zombie is taken to have come for the bot');
        return { flagsFirstSetMs: flags, targetEid: Number(zombie.metadata?.target_eid ?? 0), closestBlocks: Number(flat(zombie.position, bot.entity.position).toFixed(1)) };
    });

    await step('a skeleton taking aim at the bot: no flag shows it, and isAiming goes by the skeleton facing the bot', async () => {
        await reset();
        reflexes.mob.mode.on = false; reflexes.fight.mode.on = false;
        await cmd(`effect ${NAME} resistance 30 4 true`);
        const spot = at(12, 1, 0);
        await cmd(`summon skeleton ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}`);
        await waitFor(() => rawMob('skeleton'), 5000, () => 'no skeleton arrived');
        const skeleton = rawMob('skeleton');
        let aimingAt = null;
        const started = Date.now();
        const watching = watchFlags(skeleton, 8000);
        const eye = () => bot.entity.position.offset(0, 1.62, 0);
        const check = setInterval(() => { if (aimingAt === null && editionOf(bot.registry).isAiming(bot.registry, skeleton, eye())) aimingAt = Date.now() - started; }, 100);
        const flags = await watching;
        clearInterval(check);
        reflexes.mob.mode.on = true; reflexes.fight.mode.on = true;
        assert.notEqual(aimingAt, null, `it was never seen facing the bot: yaw ${skeleton.yaw}, head ${skeleton.headYaw}`);
        return { flagsFirstSetMs: flags, isAimingAfterMs: aimingAt };
    });

    // No cover near, and no getting out of range: a pen walled 8 blocks out, as in the Java scene. Unarmed, so the
    // fight doesn't rush the skeleton. A Bedrock skeleton shows no bow drawn, but shoots on a beat, each shot
    // heard: with a shield the bot stands behind it as the next one is due. Its first arrow comes unwarned.
    for (const shield of [false, true]) {
        await step(`a skeleton in a walled pen with no cover, the bot unarmed${shield ? ' with a shield it is given: it blocks the shots it hears coming' : ', no shield: the damage it takes'}`, async () => {
            await reset();
            await cmd('time set midnight'); // a skeleton burns by day
            for (const [a, b] of [[[-8, 1, -8], [8, 4, -8]], [[-8, 1, 8], [8, 4, 8]], [[-8, 1, -8], [-8, 4, 8]], [[8, 1, -8], [8, 4, 8]]])
                await fill(a, b, 'stone');
            if (shield) await cmd(`give ${NAME} shield`);
            await delay(1500);
            // The bot sees its pen, a look all round, recorded: through a player's screen memory would otherwise
            // still hold the open ground from before the walls went up, and the reflexes would plan by it.
            if (LIVE_VIEW !== 'all') await lookRound(bot, () => fair.recorder.tick({ budgetMs: Infinity }));
            const blocksBefore = blocked;
            // The hits the bot takes, when: a skeleton misses now and then (its arrow sticks in the floor), so a
            // shield up for every shot after the first may have nothing to block in a short scene. The scene
            // asks that it blocks one, or that nothing gets through once it has gone up.
            const hits = [];
            let healthNow = bot.health;
            const onHealth = () => { if (bot.health < healthNow) hits.push(performance.now()); healthNow = bot.health; };
            bot.on('health', onHealth);
            const spot = at(5, 1, 0);
            await cmd(`summon skeleton ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}`);
            await delay(15000);
            bot.off('health', onHealth);
            await cmd('time set noon');
            const raised = events.filter(e => e.event === 'shield').length;
            const firstUp = events.find(e => e.event === 'shield')?.at ?? Infinity;
            const hitsAfter = hits.filter(at => at > firstUp).length;
            if (shield) assert.ok(raised > 0 && (blocked > blocksBefore || hitsAfter === 0), `the shield went up (${raised}), stopped arrows (${blocked - blocksBefore}), and let ${hitsAfter} through after it first went up: ${JSON.stringify(events.filter(e => e.event !== 'step'))}`);
            else assert.equal(raised, 0);
            return { damage: Number((20 - lowestHealth).toFixed(1)), raised, blocked: blocked - blocksBefore, hitsAfterFirstRaise: hitsAfter };
        });
    }

    await step('a hit from a zombie to the south: the server pushes the bot north, and the hit is felt from the south', async () => {
        await reset();
        reflexes.mob.mode.on = false; reflexes.fight.mode.on = false;
        await cmd(`effect ${NAME} resistance 30 3 true`);
        const packets = [];
        const names = ['entity_event', 'set_entity_motion', 'animate', 'hurt_armor', 'motion_prediction_hints'];
        const listeners = names.map(name => {
            const fn = packet => {
                const id = Number(packet.runtime_entity_id ?? packet.runtime_id ?? packet.entity_id ?? -1);
                if (id === bot.entity.id) packets.push({ name, at: Date.now(), ...JSON.parse(JSON.stringify(packet, (k, v) => typeof v === 'bigint' ? Number(v) : v)) });
            };
            bot._client.on(name, fn);
            return [name, fn];
        });
        const felt = [];
        const onFelt = event => { if (event.event === 'felt') felt.push(event.direction); };
        bot.on('threat_reflex', onFelt);
        const spot = at(0, 1, 4); // to the south
        await cmd(`summon zombie ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:as_adult`);
        await waitFor(() => felt.length >= 1, 12000, () => `no hit felt: ${JSON.stringify(packets).slice(0, 600)}`);
        await delay(600);
        for (const [name, fn] of listeners) bot._client.off(name, fn);
        bot.off('threat_reflex', onFelt);
        reflexes.mob.mode.on = true; reflexes.fight.mode.on = true;
        assert.ok(felt[0] && felt[0].z > 0.7, `felt from ${JSON.stringify(felt[0])}: ${JSON.stringify(packets).slice(0, 400)}`);
        return { felt: felt.map(d => d && { x: Number(d.x.toFixed(2)), z: Number(d.z.toFixed(2)) }) };
    });

    await step('two zombies coming: the mob reflex backs away from both, even from a fight just taken on', async () => {
        await reset({ facing: 135 }); // facing north-west, between the two zombies
        await cmd(`effect ${NAME} resistance 30 2 true`);
        for (const cell of [[-6, 1, 0], [0, 1, -6]]) { const spot = at(...cell); await cmd(`summon zombie ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:as_adult`); }
        await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 20000, () => JSON.stringify(events));
        const decided = events.filter(e => e.event === 'decided');
        assert.equal(decided.find(e => e.mode === 'mob_safety')?.key, 'crowd', JSON.stringify(decided));
        const zombies = Object.values(bot.entities).filter(e => e.name === 'zombie');
        const nearest = Math.min(...zombies.map(z => flat(bot.entity.position, z.position)));
        const ended = events.find(e => e.event === 'done' && e.mode === 'mob_safety')?.ended;
        const where = p => `${(p.x - origin.x).toFixed(1)},${(p.z - origin.z).toFixed(1)}`;
        assert.ok(nearest >= 10, `ended ${nearest.toFixed(1)} from the nearest (${ended}), the bot at ${where(bot.entity.position)} and the zombies at ${zombies.map(z => where(z.position)).join(' and ')}; moves: ${JSON.stringify(events.filter(e => e.event === 'step').map(e => e.how))}; zones: ${JSON.stringify(reflexes.zones.list().map(z => z.kind))}`);
        return { endedFromNearest: Number(nearest.toFixed(1)), ended, stances: decided.map(e => `${e.mode}:${e.stance}`) };
    });

    await step('a lone zombie, the bot with a stone sword: the fight takes it on', async () => {
        await reset({ facing: 90 }); // facing west, where the zombie will be
        await cmd(`give ${NAME} stone_sword 1`, 700);
        const spot = at(-6, 1, 0);
        await cmd(`summon zombie ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:as_adult`);
        await waitFor(() => events.some(e => e.event === 'decided' && e.mode === 'self_defense'), 15000, () => JSON.stringify(events));
        await waitFor(() => !rawMob('zombie'), 30000, () => JSON.stringify(events));
        return { fights: events.filter(e => e.event === 'decided' && e.mode === 'self_defense').length, lowestHealth };
    });

    // ---- Standing orders ----

    await step('armed with a stone sword, two zombies coming: the built-in order fights them instead of backing away, while health holds', async () => {
        await reset({ facing: 135 }); // facing north-west, between the two zombies
        await cmd(`give ${NAME} stone_sword 1`, 700);
        const healthAt = [];
        const note = event => { if (event.event === 'decided') healthAt.push({ mode: event.mode, key: event.key, health: bot.health }); };
        bot.on('threat_reflex', note);
        for (const cell of [[-6, 1, 0], [0, 1, -6]]) { const spot = at(...cell); await cmd(`summon zombie ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} 0 0 minecraft:as_adult`); }
        const started = Date.now();
        try {
            await waitFor(() => !rawMob('zombie') || events.some(e => e.event === 'done' && e.mode === 'mob_safety'), 60000, () => JSON.stringify(events.filter(e => e.event !== 'step')));
        } finally { bot.off('threat_reflex', note); }
        assert.ok(healthAt.some(d => d.mode === 'self_defense'), `it fought: ${JSON.stringify(healthAt)}`);
        assert.equal(healthAt.filter(d => d.mode === 'mob_safety' && d.health >= 10).length, 0, `no retreat at half health or more: ${JSON.stringify(healthAt)}`);
        assert.ok(lowestHealth >= 4, `lowest health ${lowestHealth}`);
        return { killed: 2 - Object.values(bot.entities).filter(e => e.name === 'zombie').length, seconds: Math.round((Date.now() - started) / 1000),
            fights: healthAt.filter(d => d.mode === 'self_defense').length, lowestHealth };
    });

    await step('told to flee creepers: one coming is left behind for good at the first meeting, no damage', async () => {
        await reset();
        assert.equal(reflexes.orders.give('creepers', 'flee').ok, true);
        try {
            act('action:stay', () => skills.stay(bot, -1));
            await delay(500);
            // East again, where the creeper comes from: through a player's screen the idle look may have turned
            // the bot in the wait, and a creeper unseen until it is close is another scene.
            await faceExactly(bot, 3 * Math.PI / 2, 0);
            const start = at(10, 1, 0);
            await cmd(`summon creeper ${start.x + 0.5} ${start.y} ${start.z + 0.5}`);
            await waitFor(() => events.some(e => e.event === 'done' && e.mode === 'creeper_safety'), 30000, () => JSON.stringify(events.filter(e => e.event !== 'step')));
            const stances = events.filter(e => e.event === 'decided').map(e => e.stance);
            assert.equal(stances[0], 'leave', JSON.stringify(stances));
            assert.match(messages[0] ?? '', /leaving it behind, as I was told to\./);
            assert.equal(lowestHealth, 20, `no damage: ${JSON.stringify(events.filter(e => e.event !== 'step').map(e => [Math.round(e.at), e.event, e.stance, e.ended, e.key]))}`);
            const creeper = rawCreeper();
            return { stances, endedAway: creeper ? Number(flat(bot.entity.position, creeper.position).toFixed(1)) : null };
        } finally {
            await agent.actions.stop();
            reflexes.orders.give('creepers', 'default'); // the next reset's peaceful moment takes the creeper away
        }
    });

    await step('illagers in view leave a danger zone, an evoker by its Bedrock name too, and the model is told nothing', async () => {
        await reset();
        reflexes.zones.clear();
        bot.modes.behavior_log = '';
        await cmd(`effect ${NAME} resistance 60 4 true`); // nothing they throw can hurt the bot here
        reflexes.mob.mode.on = false; reflexes.fight.mode.on = false; // only watching here
        const pens = { pillager: [20, 1, -12], evocation_illager: [20, 1, 12] };
        for (const [mob, cell] of Object.entries(pens)) {
            await fill([cell[0] - 1, 1, cell[2] - 1], [cell[0] + 1, 3, cell[2] + 1], 'glass');
            await fill([cell[0], 1, cell[2]], [cell[0], 2, cell[2]], 'air');
            const spot = at(...cell);
            await cmd(`summon ${mob} ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}`);
        }
        await waitFor(() => reflexes.zones.list().filter(z => z.kind === 'illagers').length >= 2, 10000, () => JSON.stringify(reflexes.zones.list()));
        const kept = reflexes.zones.list();
        for (const cell of Object.values(pens))
            assert.ok(kept.some(z => flat(z, at(...cell).offset(0.5, 0, 0.5)) < 3), `a zone where each stood: ${JSON.stringify(kept)}`);
        assert.equal(messages.length, 0, 'no message to the model');
        reflexes.mob.mode.on = true; reflexes.fight.mode.on = true;
        return { zones: kept.map(z => ({ kind: z.kind, radius: z.radius })), log: bot.modes.behavior_log.trim() };
    });

    await step('a walk across the floor goes round a danger zone, and straight across with none', async () => {
        const walk = async () => {
            const track = [];
            const onMove = () => track.push(bot.entity.position.clone());
            bot.on('move', onMove);
            const started = Date.now();
            const goal = at(25, 1, 0);
            await act('test:walk', () => skills.goToPosition(bot, goal.x + 0.5, goal.y, goal.z + 0.5, 1));
            bot.off('move', onMove);
            const middle = at(0, 1, 0).offset(0.5, 0, 0.5);
            return { ms: Date.now() - started, reached: flat(bot.entity.position, goal.offset(0.5, 0, 0.5)) <= 2,
                closest: Number(Math.min(...track.map(p => flat(p, middle))).toFixed(1)) };
        };
        await reset();
        reflexes.zones.clear();
        await tpTo([-25, 1, 0], -90, 2500);
        const straight = await walk();
        // Without a zone the walk comes inside where the zone will be; with it, it keeps out.
        assert.ok(straight.reached && straight.closest < 9, `across, through where the zone will be: ${JSON.stringify(straight)}`);
        await reset();
        reflexes.zones.clear();
        const middle = at(0, 1, 0);
        reflexes.zones.note('archer', { x: middle.x + 0.5, y: middle.y, z: middle.z + 0.5 }); // 12 blocks across
        await tpTo([-25, 1, 0], -90, 2500);
        const round = await walk();
        assert.ok(round.reached && round.closest >= 9, `round the zone: ${JSON.stringify(round)}`);
        return { straight, round };
    });

    await step('reaction times and distances over the runs', () => ({ hissMs: hissTimes, blastDistances }));
} catch (error) {
    console.error(error);
} finally {
    running = false;
    try {
        await cmd('difficulty peaceful'); await cmd('gamerule mobgriefing true'); await cmd('gamerule domobloot true');
        // Take the floor away, the bot first back down where it began: a floor left here would lift the spawn of
        // every later script (docs/bedrock.md, "When Several Scripts Fail at Once"), and a bot left on it builds
        // its next scenes 40 blocks higher still.
        if (origin) {
            await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y - 39} ${origin.z + 0.5}`, 1500);
            for (let x = -30; x <= 30; x += 15) await fill([x, 0, -30], [Math.min(x + 14, 30), 6, 30], 'air');
        }
    } catch { /* the console is gone */ }
    console.log(JSON.stringify(summary()));
    bot?.quit();
    process.exit(summary().status === 'passed' ? 0 : 1);
}
