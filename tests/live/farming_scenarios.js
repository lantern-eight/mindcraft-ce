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
        // What the last scene dropped and left lying would be picked up into this one's counts.
        await cmd('kill @e[type=item]');
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
        // Farmland turned to dirt under the bot's feet, and what the bot was doing just then: where it stood,
        // how it moved, in water or not, jumping or not. A trampled cell says how it was trampled.
        const trampled = [];
        const onBlock = (before, after) => {
            if (before?.name !== 'farmland' || after?.name !== 'dirt') return;
            const e = bot.entity, v = e.velocity;
            trampled.push({ s: Number(((Date.now() - t0) / 1000).toFixed(1)), cell: `${after.position.x},${after.position.z}`,
                bot: `${e.position.x.toFixed(2)},${e.position.y.toFixed(2)},${e.position.z.toFixed(2)}`,
                v: `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`, onGround: e.onGround, inWater: Boolean(e.isInWater),
                jump: bot.getControlState('jump'), sprint: bot.getControlState('sprint'), pathing: Boolean(bot.pathfinder.isMoving?.()) });
        };
        bot.on('blockUpdate', onBlock);
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'wheat', X1 - X0 + 1));
        bot.off('mining_progress', onProgress);
        bot.off('blockUpdate', onBlock);
        const text = `${result.text ?? result.message ?? String(result)} [${progress.join(' | ')}]${trampled.length ? ` trampled: ${JSON.stringify(trampled)}` : ''}`;
        for (let x = X0; x <= X1; x++) assert.equal(ageAt(x, Y + 1, -1), 2, `the young wheat at ${x} is untouched (there: ${raw(x, Y + 1, -1)?.name} on ${raw(x, Y, -1)?.name}): ${text}`);
        const left = [];
        for (let x = X0; x <= X1; x++) if (raw(x, Y + 1, -2)?.name === 'wheat') left.push(x);
        assert.deepEqual(left, [], `ripe wheat left standing: ${text}`);
        assert.ok(have('wheat') >= X1 - X0 + 1, `got ${have('wheat')} wheat: ${text}`);
        return { text };
    });

    // New farmland the test finds after making a field: every farmland cell near the field that isn't part of it.
    const { sowField } = await import('../../src/agent/farming/sow.js');
    const inField = (x, z) => x >= X0 && x <= X1 && z >= -2 && z <= 2;
    const newFarmland = () => {
        const out = [];
        for (let x = -12; x <= 16; x++) for (let z = -12; z <= 12; z++) if (!inField(x, z) && raw(x, Y, z)?.name === 'farmland') out.push({ x, y: Y, z });
        return out;
    };
    const wetFrom = (cell, water) => Math.abs(cell.x - water.x) <= 4 && Math.abs(cell.z - water.z) <= 4;

    await step('a field is made by water: as many cells as there are seeds, all wet and sown, none on the path, none trampled', async () => {
        await reset({ kit: ['stone_hoe 1', 'wheat_seeds 6'] });
        // No field here this time: only grass, the water at 6, 69, 0, a path across, and wild grass to cut.
        // The crops first: farmland taken from under them would pop them off as drops, seeds for the bot to
        // pick up. And whatever did drop is cleared last.
        await cmd(`fill ${X0} ${Y + 1} -2 ${X1} ${Y + 1} 2 air`);
        await cmd(`fill ${X0} ${Y} -2 ${X1} ${Y} 2 grass_block`);
        await cmd(`setblock ${WATER.x} ${Y} ${WATER.z} water`);
        await cmd('kill @e[type=item]');
        await cmd(`fill 4 ${Y} -6 4 ${Y} 6 dirt_path`);
        await cmd(`fill 5 ${Y + 1} 1 8 ${Y + 1} 3 short_grass`);
        await delay(1500);
        const book = createFieldBook({ scope: 'live' });
        const result = await act('test:sow', () => sowField(bot, { size: 9, book, behind: { asked: false }, name: NAME }));
        // Farmland anywhere: where the field used to be, and round it.
        const made = newFarmland();
        const tilled = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (raw(x, Y, z)?.name === 'farmland') tilled.push({ x, y: Y, z });
        const all = made.concat(tilled);
        assert.equal(all.length, 6, `six cells, one for each seed: ${result.text}`);
        for (const c of all) {
            assert.ok(wetFrom(c, WATER), `${c.x}, ${c.z} is kept wet by the water`);
            assert.equal(raw(c.x, Y + 1, c.z)?.name, 'wheat', `${c.x}, ${c.z} is sown: ${result.text}`);
            assert.equal(book.whose([c]).owner, ME, 'and is the bot\'s own');
        }
        for (let z = -6; z <= 6; z++) assert.equal(raw(4, Y, z)?.name, 'dirt_path', `the path at z ${z} is left as it was`);
        // Seeds left over come only from the wild grass it cut (grass drops a wheat seed now and then).
        assert.ok(have('wheat_seeds') <= 2, `the seeds went into the ground: ${have('wheat_seeds')} left`);
        assert.match(result.text, /Made a field of 6 farmland/);
        return { text: result.text };
    });

    await step('the bot\'s own field is made bigger from its edge, and none of it is trampled', async () => {
        await reset({ kit: ['stone_hoe 1', 'carrot 4'] });
        const book = createFieldBook({ scope: 'live' });
        const field = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) field.push({ x, y: Y, z });
        book.mark(field, { owner: ME });
        const result = await act('test:sow', () => sowField(bot, { seed: 'carrot', size: 4, book, behind: { asked: false }, name: NAME }));
        const made = newFarmland();
        assert.equal(made.length, 4, `four new cells: ${result.text}`);
        for (const c of made) {
            assert.ok(field.some(f => Math.abs(f.x - c.x) <= 2 && Math.abs(f.z - c.z) <= 2), `${c.x}, ${c.z} grows from the field`);
            assert.equal(raw(c.x, Y + 1, c.z)?.name, 'carrots', `${c.x}, ${c.z} is sown with carrots`);
            assert.equal(book.whose([c]).owner, ME);
        }
        assert.equal(farmlandLeft(), FARMLAND, `the field itself is whole: ${result.text}`);
        assert.match(result.text, /Made the field beside you bigger by 4 farmland/);
        return { text: result.text };
    });

    await step('on its own idea the bot keeps clear of a field nobody said it may tend', async () => {
        await reset({ kit: ['stone_hoe 1', 'wheat_seeds 4'] });
        const book = createFieldBook({ scope: 'live' });
        const field = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) field.push({ x, y: Y, z });
        book.mark(field, { owner: 'Alex' });
        const result = await act('test:sow', () => sowField(bot, { size: 4, book, behind: { asked: false }, name: NAME }));
        const made = newFarmland();
        assert.equal(made.length, 4, `four cells: ${result.text}`);
        for (const c of made) {
            assert.ok(!field.some(f => Math.abs(f.x - c.x) <= 1 && Math.abs(f.z - c.z) <= 1), `${c.x}, ${c.z} does not touch Alex's field`);
            assert.equal(book.whose([c]).owner, ME, 'the new field is the bot\'s');
        }
        assert.equal(book.whose(field).owner, 'Alex', 'Alex\'s field is still Alex\'s');
        assert.equal(farmlandLeft(), FARMLAND);
        return { text: result.text };
    });

    await step('with good-neighbor rules on, a stranger\'s wheat is not collected, and a field the bot is asked to tend is tended', async () => {
        await reset({ kit: ['wheat_seeds 2'] });
        const { installGoodNeighbor } = await import('../../src/agent/neighbor/install.js');
        const { installFarming } = await import('../../src/agent/farming/install.js');
        const { getCommand } = await import('../../src/agent/commands/index.js');
        const config = { ...rootSettings, ...fairPlaySettings(), world_memory: true, farming: true,
            good_neighbor: { protect_builds: true, protect_chests: true, protect_animals: true, protected_areas: [] } };
        // As agent.js does it: good-neighbor rules first, then farming, which answers them about crops.
        const neighbor = installGoodNeighbor(agent, { config });
        const farming = installFarming(agent, { config, bookDir: mkdtempSync(path.join(tmpdir(), 'farming-book-')) });
        assert.ok(neighbor && farming, 'both installed');
        try {
            const cells = [];
            for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) cells.push({ x, y: Y, z });
            farming.book().mark(cells, { owner: 'Alex' });
            // Alex's field, tended only when asked: the bot's own idea to collect wheat leaves it standing.
            const refused = await act('test:collect', () => skills.collectBlockResult(bot, 'wheat', 3));
            const refusedText = refused.text ?? refused.message ?? String(refused);
            for (let x = X0; x <= X1; x++) assert.equal(ageAt(x, Y + 1, -2), 7, `Alex's ripe wheat at ${x} stands: ${refusedText}`);
            assert.equal(have('wheat'), 0, refusedText);
            // A round of tending, as a command, with nobody to tell it was the bot's own idea: it is tended.
            const tendedText = String(await getCommand('!tendField').perform(agent, 'any') ?? '');
            assert.ok(have('wheat') > 0, `wheat reached the inventory: ${tendedText}`);
            for (let x = X0; x <= X1; x++) {
                assert.equal(raw(x, Y + 1, -2)?.name, 'wheat', `the cut wheat at ${x} was replanted: ${tendedText}`);
                assert.ok(ageAt(x, Y + 1, -2) < 7, `with a new plant at ${x}`);
            }
            assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${tendedText}`);
            return { refused: refusedText.trim().slice(-200), tended: tendedText.trim().slice(-300) };
        } finally { neighbor.stop(); farming.stop(); }
    });

    await step('melons and pumpkins: the fruit beside each stem is picked, the stems stay, a gap among melon stems is sown with melon seed', async () => {
        // The bot is given melon seed only: the gap among the melon stems is what it sows with it.
        await reset({ kit: ['melon_seeds 3'] });
        // Melon stems at 7 and 9 on the empty row (z 2), their melons to the south on the grass beside the
        // field, and a young one at 8 on the row before, round a gap at 8, 2. A pumpkin at 4, its fruit south.
        await cmd(`fill ${X0} ${Y + 1} 1 ${X1} ${Y + 1} 2 air`);
        await cmd(`fill ${X0} ${Y + 1} 1 5 ${Y + 1} 1 beetroots[age=3]`);
        for (const x of [7, 9]) await cmd(`setblock ${x} ${Y + 1} 2 attached_melon_stem[facing=south]`);
        await cmd(`setblock 8 ${Y + 1} 1 melon_stem[age=7]`);
        await cmd(`setblock 4 ${Y + 1} 2 attached_pumpkin_stem[facing=south]`);
        for (const x of [7, 9]) await cmd(`setblock ${x} ${Y + 1} 3 melon`);
        await cmd(`setblock 4 ${Y + 1} 3 pumpkin`);
        await delay(800);
        const book = createFieldBook({ scope: 'live' });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: true, by: 'Alex' }, name: NAME, memory: handle.memory }));
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.ok(['ok', 'partial'].includes(result.status), said);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${said}`);
        for (const x of [7, 9]) assert.equal(raw(x, Y + 1, 3)?.name, 'air', `the melon at ${x} was picked: ${said}`);
        assert.equal(raw(4, Y + 1, 3)?.name, 'air', `the pumpkin was picked: ${said}`);
        for (const x of [7, 9]) assert.match(raw(x, Y + 1, 2)?.name ?? '', /melon_stem$/, `the melon stem at ${x} stands`);
        assert.equal(raw(8, Y + 1, 1)?.name, 'melon_stem', 'the young melon stem stands');
        assert.match(raw(4, Y + 1, 2)?.name ?? '', /pumpkin_stem$/, 'the pumpkin stem stands');
        assert.equal(raw(8, Y + 1, 2)?.name, 'melon_stem', `the gap among the melon stems is sown with melon seed: ${said}`);
        assert.ok(have('melon_slice') >= 6, `the melons' slices reached the bag (${have('melon_slice')}): ${said}`);
        assert.equal(have('pumpkin'), 1, `so did the pumpkin: ${said}`);
        assert.match(result.text, /Harvested[^.]*2 melon/, said);
        assert.match(result.text, /Harvested[^.]*1 pumpkin/, said);
        return { text: said };
    });

    await step('asked to, the bot makes bone meal at a composter and ripens young wheat with it, cutting nothing', async () => {
        // A composter behind the bot, out of a narrowed view; 64 seeds fill it about twice (each has a 30% chance
        // to raise it a level, and 7 levels fill it). Then 8 bone meal more for the young wheat.
        await reset({ kit: ['wheat_seeds 64'] });
        await cmd(`setblock -2 ${Y + 1} 0 composter`);
        await delay(500);
        const { composting } = await import('../../src/agent/farming/compost.js');
        const { boneMealField } = await import('../../src/agent/farming/bone_meal.js');
        const made = await act('test:compost', () => composting().compost(bot, 'wheat_seeds', 64, { behind: { asked: true, by: 'Alex' } }));
        const madeText = String(made.text ?? '').replace(/\n/g, ' | ');
        assert.equal(made.status, 'ok', madeText);
        assert.equal(have('wheat_seeds'), 0, `all 64 went in: ${madeText}`);
        const fromCompost = have('bone_meal');
        assert.ok(fromCompost >= 1, `the full composter gave bone meal: ${madeText}`);
        const level = Number(raw(-2, Y + 1, 0)?.getProperties().level);
        assert.match(madeText, new RegExp(`took ${fromCompost} bone_meal out. It is at level ${level} of 7`), `the report says what the server has (level ${level})`);

        await cmd(`give ${NAME} bone_meal 8`);
        await delay(500);
        const book = createFieldBook({ scope: 'live' });
        const before = have('bone_meal');
        const result = await act('test:bonemeal', () => boneMealField(bot, { count: 8, book, behind: { asked: true, by: 'Alex' }, memory: handle.memory }));
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.equal(result.status, 'ok', said);
        const used = before - have('bone_meal');
        assert.equal(used, 8, `it used the eight it was asked to: ${said}`);
        const ripened = [];
        for (let x = X0; x <= X1; x++) if (ageAt(x, Y + 1, -1) === 7) ripened.push(x);
        // Each bone meal grows wheat two to five stages, so eight ripen at least two plants from stage 2.
        assert.ok(ripened.length >= 2, `young wheat ripened at ${ripened.join(', ')}: ${said}`);
        assert.match(said, new RegExp(`${ripened.length} plants? (is|are) ripe now`), said);
        for (let x = X0; x <= X1; x++) {
            assert.equal(ageAt(x, Y + 1, -2), 7, `the ripe wheat at ${x} is not cut`);
            assert.equal(raw(x, Y + 1, -1)?.name, 'wheat', `the wheat at ${x} is not cut`);
        }
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${said}`);
        return { compost: madeText, boneMeal: said };
    });

    // What is really in a chest, by item, from the server's console: the test may look, the bot may not.
    const chestHolds = async ({ x, y, z }) => {
        const mark = server.log.length;
        await cmd(`data get block ${x} ${y} ${z} Items`);
        const answer = /has the following block data: (.*)/;
        await waitFor(() => answer.test(server.log.slice(mark)), 5000, () => `no answer about the block at ${x}, ${y}, ${z}`);
        const out = {};
        for (const entry of server.log.slice(mark).match(answer)[1].match(/\{[^{}]*id: "minecraft:[a-z0-9_]+"[^{}]*\}/g) ?? []) {
            const name = entry.match(/id: "minecraft:([a-z0-9_]+)"/)[1];
            out[name] = (out[name] ?? 0) + Number(entry.match(/count: (\d+)/)?.[1] ?? 1);
        }
        return out;
    };

    await step('a round takes the harvest to the chests by the field that are for it, keeping seed and food, and tramples nothing', async () => {
        // Carrots to start with, so that there is more food than the bot keeps.
        await reset({ kit: ['wheat_seeds 2', 'carrot 20'] });
        // Beside the field, off the farmland: a chest for plants, one for food, and one for anything.
        const PLANTS = { x: 4, y: Y + 1, z: 4 }, FOOD = { x: 6, y: Y + 1, z: 4 }, ANYTHING = { x: 8, y: Y + 1, z: 4 };
        for (const c of [PLANTS, FOOD, ANYTHING]) await cmd(`setblock ${c.x} ${c.y} ${c.z} chest[facing=north]`);
        const { installStorage } = await import('../../src/agent/storage/install.js');
        const { storerOf } = await import('../../src/agent/library/store_way.js');
        const { getCommand } = await import('../../src/agent/commands/index.js');
        // A message is answered by running it, so chest storage's watcher (which wraps this) can tell a player asked.
        agent.handleMessage = (source, run) => Promise.resolve(typeof run === 'function' ? run() : undefined);
        const storage = installStorage(agent, { config: { ...rootSettings, chest_sorting: true, store_and_fetch: true },
            bookDir: mkdtempSync(path.join(tmpdir(), 'farming-chests-')) });
        assert.ok(storage && storerOf(bot), 'chest storage is on, with putting away');
        // A player puts the chests by the field and says what they are for. The bot has looked at them.
        await bot.lookAt(new Vec3(6.5, Y + 1.5, 4.5), true);
        await delay(1000);
        for (const [c, what] of [[PLANTS, 'plants'], [FOOD, 'food'], [ANYTHING, null]]) {
            assert.match(String(await agent.handleMessage('Alex', () => getCommand('!markChest').perform(agent, c.x, c.y, c.z, NAME, 'same'))), /is now|was already/);
            if (what) assert.match(String(await agent.handleMessage('Alex', () => getCommand('!chestFor').perform(agent, c.x, c.y, c.z, what))), new RegExp(`For ${what}`));
        }
        await bot.lookAt(new Vec3(9.5, Y + 1, 0.5), true);

        const book = createFieldBook({ scope: 'live' });
        const cells = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) cells.push({ x, y: Y, z });
        book.mark(cells, { owner: ME });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: false }, name: NAME, memory: handle.memory, store: storerOf(bot) }));
        assert.ok(['ok', 'partial'].includes(result.status), result.text);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled: ${result.text}`);
        assert.match(result.text, /The harvest, to the field's chest: Put away/, result.text);

        const plants = await chestHolds(PLANTS), food = await chestHolds(FOOD), anything = await chestHolds(ANYTHING);
        const growing = block => cells.filter(c => raw(c.x, Y + 1, c.z)?.name === block).length;
        assert.equal(plants.wheat, X1 - X0 + 1, `all the wheat went to the chest for plants: ${JSON.stringify(plants)} ${result.text}`);
        assert.equal(have('wheat'), 0, 'none of it kept');
        assert.equal(have('wheat_seeds'), Math.min(growing('wheat'), have('wheat_seeds') + (plants.wheat_seeds ?? 0)),
            `seed kept for each cell of wheat, the rest stored: ${JSON.stringify(plants)} ${result.text}`);
        assert.equal(food.wheat ?? 0, 0, 'no wheat in the chest for food');
        assert.equal(plants.carrot ?? 0, 0, 'carrots are food, not plants');
        const eat = have('carrot') + have('beetroot'), stored = (food.carrot ?? 0) + (food.beetroot ?? 0);
        // Food: 16 in all, or a carrot for each carrot cell when there are more (seed to sow the field again).
        const meant = Math.min(eat + stored, Math.max(16, growing('carrots')));
        assert.equal(eat, meant, `food kept, 16 in all or a carrot for each of ${growing('carrots')} carrot cells, the rest stored: kept ${eat}, stored ${JSON.stringify(food)}`);
        assert.ok(stored > 0, `the food the bot doesn't keep went to the chest for food: ${JSON.stringify(food)}`);
        assert.deepEqual(anything, {}, 'the chest for anything is left alone');
        return { text: result.text };
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
