// SPDX-License-Identifier: CC0-1.0
// Farming on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_farming.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console, and random ticks are
// turned off while it runs.
//
// The Bedrock twin of farming_scenarios.js, for what depends on the edition of the game: Bedrock calls a
// crop's stage `growth` and its beetroot block `beetroot`, and the bot learns a crop is ripe through the
// edition seam and world memory's translation. Whose field it is is the same code on both editions and is
// left to the Java scenarios.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings } from '../helpers/live_view.js';

const NAME = 'BedrockFarmer';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`, 60);
const tpTo = (cell, yaw = 0, settle = 1500) => cmd(`tp ${NAME} ${at(...cell).x + 0.5} ${at(...cell).y} ${at(...cell).z + 0.5} ${yaw} 0`, settle);

// The field, from the middle of the platform: farmland from x 3 to 9, z -2 to 2, on the platform's level,
// water in its middle. Rows: ripe wheat, young wheat, ripe carrots, ripe beetroot then empty, empty.
const X0 = 3, X1 = 9, WATER = [6, 0, 0];
const isWater = (x, z) => x === WATER[0] && z === WATER[2];
async function buildField() {
    await fill([-12, 1, -12], [14, 8, 12], 'air');
    await fill([-12, 0, -12], [14, 0, 12], 'grass_block');
    await fill([-12, -1, -12], [14, -1, 12], 'stone');
    await fill([X0, 0, -2], [X1, 0, 2], 'farmland ["moisturized_amount"=7]');
    await set(WATER, 'water');
    for (let x = X0; x <= X1; x++) {
        await set([x, 1, -2], 'wheat ["growth"=7]');
        await set([x, 1, -1], 'wheat ["growth"=2]');
        if (!isWater(x, 0)) await set([x, 1, 0], 'carrots ["growth"=7]');
        if (x <= 5) await set([x, 1, 1], 'beetroot ["growth"=7]');
    }
    await delay(800);
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, farming: true });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { ActionManager } = await import('../../src/agent/action_manager.js');
    const { initModes } = await import('../../src/agent/modes.js');
    const { installFairPlay } = await import('../../src/agent/fairplay/install.js');
    const { tendField } = await import('../../src/agent/farming/tend.js');
    const { createFieldBook } = await import('../../src/agent/farming/field_book.js');
    const skills = await import('../../src/agent/library/skills.js');

    let agent, handle;
    const sent = [];
    const raw = cell => bot.blockAt(at(...cell)); // the test may peek; the bot may not
    const growthAt = cell => Number(raw(cell)?.getProperties().growth);
    const have = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
    const farmlandLeft = () => {
        let n = 0;
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z) && raw([x, 0, z])?.name === 'farmland') n++;
        return n;
    };
    const FARMLAND = (X1 - X0 + 1) * 5 - 1;
    const reset = async (kit = []) => {
        await buildField();
        await cmd(`clear ${NAME}`);
        for (const item of kit) await cmd(`give ${NAME} ${item}`, 300);
        await tpTo([0, 1, 0], -90);
    };

    await step('the bot joins, and farming runs with fair play and world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]);
        for (const method of ['write', 'queue']) {
            const send = bot._client[method].bind(bot._client);
            bot._client[method] = (name, ...rest) => { sent.push(name); return send(name, ...rest); };
        }
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await cmd('gamerule randomtickspeed 0');
        await cmd('gamerule domobspawning false');
        await cmd('time set noon');
        agent = {
            name: NAME, bot, task: null, shut_up: true, last_sender: null, blocked_actions: [],
            prompter: { profile: {}, getInitModes: () => ({}) },
            self_prompter: { isActive: () => false, stopLoop: () => {} },
            openChat: () => {}, handleMessage: (source, run) => Promise.resolve(typeof run === 'function' ? run() : undefined),
            clearBotLogs: () => { bot.output = ''; bot.interrupt_code = false; },
            requestInterrupt: () => {
                bot.interrupt_code = true; bot.stopDigging(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.pvp?.stop();
            },
            isIdle: () => !agent.actions.executing,
        };
        agent.actions = new ActionManager(agent);
        initModes(agent);
        handle = installFairPlay(agent, { memoryDir: mkdtempSync(path.join(tmpdir(), 'bedrock-farming-')) });
        assert.ok(handle?.memory, 'fair play and world memory are on');
    });

    const act = (label, fn) => agent.actions.runAction(label, fn, { timeout: 5 });

    await step('a round cuts only the ripe crops, replants every cell it cut, sows the empty farmland, and tramples nothing', async () => {
        await reset(['wheat_seeds 2']);
        const book = createFieldBook({ scope: 'live' });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: true, by: 'Alex' }, name: NAME, memory: handle.memory }));
        assert.match(result.text, /not ripe yet/);
        assert.ok(['ok', 'partial'].includes(result.status), result.text);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${result.text}`);
        try { checkRound(); } catch (error) { error.message += ` (${result.text} ${bot.output ?? ''})`; throw error; }
        return { text: result.text };
    });

    function checkRound() {
        for (let x = X0; x <= X1; x++) {
            assert.equal(raw([x, 1, -1])?.name, 'wheat', `the young wheat at ${x} is still there`);
            assert.equal(growthAt([x, 1, -1]), 2, 'and still at stage 2');
            assert.ok(raw([x, 1, -2])?.name === 'wheat' && growthAt([x, 1, -2]) < 7, `the cut wheat at ${x} was replanted (there: ${raw([x, 1, -2])?.name})`);
            if (!isWater(x, 0)) assert.ok(raw([x, 1, 0])?.name === 'carrots' && growthAt([x, 1, 0]) < 7, `carrots replanted at ${x}`);
        }
        for (let x = X0; x <= 5; x++) assert.ok(raw([x, 1, 1])?.name === 'beetroot' && growthAt([x, 1, 1]) < 7, `beetroot replanted at ${x} (there: ${raw([x, 1, 1])?.name})`);
        // Carrots are their own seed, and may all go back into the ground: wheat and beetroot can't.
        assert.ok(have('wheat') > 0 && have('beetroot') > 0, 'the harvest reached the inventory');
    }

    await step('collecting wheat takes only the ripe plants', async () => {
        await reset();
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'wheat', X1 - X0 + 1));
        const text = result.text ?? result.message ?? String(result);
        for (let x = X0; x <= X1; x++) assert.equal(growthAt([x, 1, -1]), 2, `the young wheat at ${x} is untouched: ${text}`);
        const left = [];
        for (let x = X0; x <= X1; x++) if (raw([x, 1, -2])?.name === 'wheat') left.push(x);
        assert.deepEqual(left, [], `ripe wheat left standing: ${text}`);
        return { text };
    });

    await step('with good-neighbor rules on, a stranger\'s wheat is not collected, and a field the bot is asked to tend is tended', async () => {
        await reset(['wheat_seeds 2']);
        const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
        const { installFarming } = await import('../../src/agent/farming/install.js');
        const { getCommand } = await import('../../src/agent/commands/index.js');
        const config = { ...rootSettings, ...bedrockTestSettings(server), ...fairPlaySettings(), world_memory: true, farming: true,
            good_neighbor: { protect_builds: true, protect_chests: true, protect_animals: true, protected_areas: [] } };
        // As agent.js does it: good-neighbor rules first, then farming, which answers them about crops.
        const neighbor = installGoodNeighbor(agent, { config });
        const farming = installFarming(agent, { config, bookDir: mkdtempSync(path.join(tmpdir(), 'bedrock-farming-book-')) });
        assert.ok(neighbor && farming, 'both installed');
        try {
            const cells = [];
            for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) cells.push(at(x, 0, z));
            farming.book().mark(cells, { owner: 'Alex' });
            // Alex's field, tended only when asked: the bot's own idea to collect wheat leaves it standing.
            const refused = await act('test:collect', () => skills.collectBlockResult(bot, 'wheat', 3));
            const refusedText = refused.text ?? refused.message ?? String(refused);
            for (let x = X0; x <= X1; x++) assert.equal(growthAt([x, 1, -2]), 7, `Alex's ripe wheat at ${x} stands: ${refusedText}`);
            assert.equal(have('wheat'), 0, refusedText);
            // A round of tending, as a command, with nobody to tell it was the bot's own idea: it is tended,
            // beetroot (Bedrock's `beetroot`, Java's `beetroots`) and all.
            const tendedText = String(await getCommand('!tendField').perform(agent, 'any') ?? '');
            assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${tendedText}`);
            try { checkRound(); } catch (error) { error.message += ` (${tendedText} ${bot.output ?? ''})`; throw error; }
            return { refused: refusedText.trim().slice(-200) };
        } finally { neighbor.stop(); farming.stop(); }
    });

    await step('after all of that, the bot sent no command', () => {
        assert.ok(!sent.includes('command_request'), 'no command was sent');
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try {
        await cmd('gamerule randomtickspeed 1');
        if (origin) await fill([-12, -1, -12], [14, 8, 12], 'air');
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
