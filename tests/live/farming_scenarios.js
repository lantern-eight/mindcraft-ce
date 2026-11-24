// SPDX-License-Identifier: CC0-1.0
// Live farming scenarios against a real server (no model calls, free to run).
//   node tests/live/farming_scenarios.js [--port=55942] [--only=<regex>] [--view=all]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// A field is built from the console with crops at known ages and random ticks off, so nothing grows while a
// scene runs. The bot tends it through fair play and world memory as an agent does. The test peeks at the
// real blocks to check what happened; the bot never may.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import { LIVE_VIEW, faceExactly, fairPlaySettings } from '../helpers/live_view.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55942);
const NAME = 'Farmer';
const results = [];
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const step = async (name, fn) => {
    if (ONLY && !new RegExp(ONLY).test(name)) return;
    const started = Date.now();
    const details = await fn();
    const result = { name, status: 'passed', durationMs: Date.now() - started, ...(details || {}) };
    results.push(result);
    console.log(JSON.stringify(result));
};

const server = await vanillaFixture(port);
let bot;
try {
    setSettings({ ...rootSettings, host: '127.0.0.1', port, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline', ...fairPlaySettings(), world_memory: true, farming: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { tendField } = await import('../../src/agent/farming/tend.js');
    const { createFieldBook, ME } = await import('../../src/agent/farming/field_book.js');
    const skills = await import('../../src/agent/library/skills.js');

    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await once(bot, 'spawn');
    const cmd = server.command;

    // The parts of a CE agent that skills, reflexes and fair play use, without a model behind them.
    const agent = {
        name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
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
    const handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'farming-memory-')) });
    assert.ok(handle, 'fair play installed');
    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 5 });
    // The test may peek at the real blocks; the bot may not.
    const raw = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const ageAt = (x, y, z) => Number(raw(x, y, z)?.getProperties().age);
    const have = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

    // The field: farmland from x 3 to 9, z -2 to 2, at y 69, with water in the middle (6, 69, 0).
    //   z -2: ripe wheat          z -1: young wheat (age 2)       z 0: ripe carrots
    //   z  1: ripe beetroot on x 3 to 5, empty farmland beyond     z 2: empty farmland
    const X0 = 3, X1 = 9, Y = 69;
    const WATER = { x: 6, z: 0 };
    const isWater = (x, z) => x === WATER.x && z === WATER.z;
    async function buildField() {
        await cmd('fill -12 56 -12 16 68 12 stone');
        await cmd('fill -12 69 -12 16 69 12 grass_block');
        await cmd('fill -12 70 -12 16 90 12 air');
        await cmd(`fill ${X0} ${Y} -2 ${X1} ${Y} 2 farmland[moisture=7]`);
        await cmd(`setblock ${WATER.x} ${Y} ${WATER.z} water`);
        await cmd(`fill ${X0} ${Y + 1} -2 ${X1} ${Y + 1} -2 wheat[age=7]`);
        await cmd(`fill ${X0} ${Y + 1} -1 ${X1} ${Y + 1} -1 wheat[age=2]`);
        for (let x = X0; x <= X1; x++) if (!isWater(x, 0)) await cmd(`setblock ${x} ${Y + 1} 0 carrots[age=7]`);
        await cmd(`fill ${X0} ${Y + 1} 1 5 ${Y + 1} 1 beetroots[age=3]`);
    }
    async function reset({ x = 0.5, z = 0.5, facing = -90, kit = [] } = {}) {
        await buildField();
        await cmd(`clear ${NAME}`);
        for (const item of kit) await cmd(`give ${NAME} ${item}`);
        await cmd(`tp ${NAME} ${x} 70 ${z} ${facing} 0`);
        await delay(1500);
    }
    const farmlandLeft = () => {
        let n = 0;
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z) && raw(x, Y, z)?.name === 'farmland') n++;
        return n;
    };
    const FARMLAND = (X1 - X0 + 1) * 5 - 1;

    // Nothing grows by itself during a scene. Both spellings: the rule was renamed in 1.21.11.
    await cmd('gamerule randomTickSpeed 0');
    await cmd('gamerule random_tick_speed 0');
    await cmd('gamerule doDaylightCycle false');
    await cmd('time set noon');
    await waitFor(() => handle.wiring && handle.wiring.status !== 'skipped', 12000, () => `the wiring check said: ${handle.wiring?.reason}`);

    await step('a round cuts only the ripe crops, replants every cell it cut, sows the empty farmland, and tramples nothing', async () => {
        await reset({ kit: ['wheat_seeds 2'] });
        const book = createFieldBook({ scope: 'live' });
        const before = { wheat: have('wheat'), carrot: have('carrot'), beetroot: have('beetroot') };
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: true, by: 'Alex' }, name: NAME, memory: handle.memory }));
        assert.ok(['ok', 'partial'].includes(result.status), result.text);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${result.text}`);
        for (let x = X0; x <= X1; x++) {
            assert.equal(raw(x, Y + 1, -1)?.name, 'wheat', `the young wheat at ${x} is still there`);
            assert.equal(ageAt(x, Y + 1, -1), 2, `and still at age 2`);
            assert.equal(raw(x, Y + 1, -2)?.name, 'wheat', `the cut wheat at ${x} was replanted`);
            assert.ok(ageAt(x, Y + 1, -2) < 7, `with a new plant at ${x}`);
            if (!isWater(x, 0)) assert.ok(raw(x, Y + 1, 0)?.name === 'carrots' && ageAt(x, Y + 1, 0) < 7, `carrots replanted at ${x}`);
        }
        for (let x = X0; x <= 5; x++) assert.ok(raw(x, Y + 1, 1)?.name === 'beetroots' && ageAt(x, Y + 1, 1) < 3, `beetroot replanted at ${x}`);
        const sown = [];
        for (let x = X0; x <= X1; x++) for (const z of [1, 2]) if (!(z === 1 && x <= 5)) sown.push(raw(x, Y + 1, z)?.name);
        assert.ok(sown.filter(n => n !== 'air').length >= 4, `the empty farmland was sown: ${sown.join(', ')}`);
        assert.ok(have('wheat') > before.wheat, 'wheat reached the inventory');
        // Carrots are their own seed, and may all go back into the ground as replanting and sowing.
        assert.ok(have('beetroot') > before.beetroot, 'so did beetroot');
        assert.match(result.text, /Harvested[^.]*carrots/);
        assert.match(result.text, /Harvested/);
        assert.match(result.text, /not ripe yet/);
        assert.equal(book.whose([{ x: X0, y: Y, z: -2 }]).owner, 'Alex', 'tended at Alex\'s asking, the field is noted as Alex\'s');
        return { text: result.text };
    });

    await step('a field behind the bot is found by looking round, and tended', async () => {
        await reset({ facing: 90 }); // west, away from the field
        await faceExactly(bot, Math.PI / 2, 0);
        const book = createFieldBook({ scope: 'live' });
        book.mark([{ x: X0, y: Y, z: -2 }], { owner: ME });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: null }, name: NAME, memory: handle.memory }));
        assert.ok(['ok', 'partial'].includes(result.status), result.text);
        assert.equal(farmlandLeft(), FARMLAND);
        assert.ok(have('wheat') > 0, result.text);
        return { text: result.text, view: LIVE_VIEW };
    });

    await step('on its own idea the bot leaves a field nobody said it may tend, and breaks nothing', async () => {
        await reset();
        const book = createFieldBook({ scope: 'live' });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: false }, name: NAME, memory: handle.memory }));
        assert.equal(result.status, 'blocked', result.text);
        assert.match(result.text, /nobody has said whose it is/);
        assert.equal(ageAt(X0, Y + 1, -2), 7, 'the ripe wheat is still standing');
        assert.equal(have('wheat'), 0);
        // Its own field it tends on its own idea.
        book.mark([{ x: X0, y: Y, z: -2 }, { x: X0 + 1, y: Y, z: -2 }], { owner: ME });
        const own = await act('test:tend', () => tendField(bot, { book, behind: { asked: false }, name: NAME, memory: handle.memory }));
        assert.ok(['ok', 'partial'].includes(own.status), own.text);
        assert.match(own.text, /it is yours/);
        return { refused: result.text, own: own.text };
    });

    await step('collecting wheat takes only the ripe plants', async () => {
        await reset();
        const progress = [];
        const onProgress = m => progress.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m.message}`);
        const t0 = Date.now();
        bot.on('mining_progress', onProgress);
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'wheat', X1 - X0 + 1));
        bot.off('mining_progress', onProgress);
        const text = `${result.text ?? result.message ?? String(result)} [${progress.join(' | ')}]`;
        for (let x = X0; x <= X1; x++) assert.equal(ageAt(x, Y + 1, -1), 2, `the young wheat at ${x} is untouched: ${text}`);
        const left = [];
        for (let x = X0; x <= X1; x++) if (raw(x, Y + 1, -2)?.name === 'wheat') left.push(x);
        assert.deepEqual(left, [], `ripe wheat left standing: ${text}`);
        assert.ok(have('wheat') >= X1 - X0 + 1, `got ${have('wheat')} wheat: ${text}`);
        return { text };
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
}
