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
    // How the bot moved while a scene ran, for a failure to say how a cell was trampled: each farmland that
    // turned to dirt, and each time the bot went into water, with where it was (from the platform's middle,
    // as the cells are named), how it moved and whether the pathfinder was walking it. Started by reset().
    // Also what dropped while it ran, and what still lies near the field after it: whether a seed short for
    // replanting never dropped, or dropped and was left lying.
    let motion = [], since = Date.now(), wasInWater = false, dropped = {};
    const moment = () => {
        const e = bot.entity, v = e.velocity, p = e.position.minus(origin);
        return { s: Number(((Date.now() - since) / 1000).toFixed(1)), at: `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`,
            v: `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`, onGround: e.onGround, inWater: Boolean(e.isInWater),
            jump: bot.getControlState('jump'), pathing: Boolean(bot.pathfinder?.isMoving?.()) };
    };
    const watchMotion = () => {
        // The last two seconds of where the bot was, and its last few calls that act on the world (a dig, a
        // click on a block, an equip, a walk), so a trampled cell says what came just before it.
        const recent = [], calls = [];
        for (const name of ['dig', 'activateBlock', 'equip', 'placeBlock']) {
            const real = bot[name].bind(bot);
            bot[name] = (target, ...rest) => {
                const p = target?.position?.minus?.(origin);
                calls.push({ s: Number(((Date.now() - since) / 1000).toFixed(1)), call: name, on: p ? `${target.name} ${p.x},${p.y},${p.z}` : target?.name ?? String(target) });
                if (calls.length > 6) calls.shift();
                return real(target, ...rest);
            };
        }
        const goto = bot.pathfinder.goto.bind(bot.pathfinder);
        bot.pathfinder.goto = goal => {
            calls.push({ s: Number(((Date.now() - since) / 1000).toFixed(1)), call: 'goto', on: origin && goal?.x !== undefined ? `${goal.x - origin.x},${goal.y - origin.y},${goal.z - origin.z}` : '?' });
            if (calls.length > 6) calls.shift();
            return goto(goal);
        };
        bot.on('blockUpdate', (before, after) => {
            if (before?.name !== 'farmland' || after?.name === 'farmland' || !origin) return;
            const c = after.position.minus(origin);
            motion.push({ trampled: `${c.x},${c.z}: ${after.name}`, ...moment(), before: recent.slice(), calls: calls.slice() });
        });
        bot.on('itemDrop', entity => {
            const item = entity.getDroppedItem?.();
            const name = item?.name ?? '?';
            dropped[name] = (dropped[name] ?? 0) + (item?.count ?? 1);
        });
        const timer = setInterval(() => {
            if (origin && bot.entity) {
                const e = bot.entity, p = e.position.minus(origin);
                recent.push(`${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}${e.onGround ? '' : ' air'}`);
                if (recent.length > 20) recent.shift();
            }
            const inWater = Boolean(bot.entity?.isInWater);
            if (inWater && !wasInWater && origin) motion.push({ intoWater: true, ...moment() });
            wasInWater = inWater;
        }, 100);
        timer.unref();
    };
    const lying = () => Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(at(6, 1, 0)) < 10).map(e => {
        const p = e.position.minus(origin);
        return `${e.getDroppedItem?.()?.name ?? '?'} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
    });
    const motionText = () => `${motion.length ? ` motion: ${JSON.stringify(motion)}` : ''} dropped: ${JSON.stringify(dropped)} lying: ${JSON.stringify(lying())}`;
    // The farmland cells of the field that aren't farmland any more, for a failure to name.
    const trampled = () => {
        const out = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z) && raw([x, 0, z])?.name !== 'farmland') out.push(`${x},${z}: ${raw([x, 0, z])?.name}`);
        return out.join(' ') + motionText();
    };
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
        motion = []; dropped = {}; since = Date.now();
    };

    await step('the bot joins, and farming runs with fair play and world memory', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]);
        watchMotion();
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
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled (${trampled()}): ${result.text}`);
        try { checkRound(result.text); } catch (error) { error.message += ` (${result.text} ${bot.output ?? ''})${motionText()}`; throw error; }
        return { text: result.text, dropped, ...(motion.length ? { motion } : {}) };
    });

    function checkRound(text) {
        for (let x = X0; x <= X1; x++) {
            assert.equal(raw([x, 1, -1])?.name, 'wheat', `the young wheat at ${x} is still there`);
            assert.equal(growthAt([x, 1, -1]), 2, 'and still at stage 2');
            assert.ok(raw([x, 1, -2])?.name === 'wheat' && growthAt([x, 1, -2]) < 7, `the cut wheat at ${x} was replanted (there: ${raw([x, 1, -2])?.name})`);
            if (!isWater(x, 0)) assert.ok(raw([x, 1, 0])?.name === 'carrots' && growthAt([x, 1, 0]) < 7, `carrots replanted at ${x}`);
        }
        // A Bedrock beetroot drops 0 to 3 seeds (a Java one always at least 1), so the three cut here give fewer
        // than three about one round in twenty-five. A player can't replant without a seed either: the cells
        // left over must be empty, said to be, and with no beetroot seed in the bag or left lying about.
        const bare = [];
        for (let x = X0; x <= 5; x++) {
            if (raw([x, 1, 1])?.name === 'beetroot' && growthAt([x, 1, 1]) < 7) continue;
            assert.equal(raw([x, 1, 1])?.name, 'air', `beetroot replanted at ${x} (there: ${raw([x, 1, 1])?.name})`);
            bare.push(x);
        }
        if (bare.length) {
            const where = `beetroot left unplanted at ${bare.join(', ')}`;
            assert.ok((dropped.beetroot_seeds ?? 0) < 3, `${where}, though ${dropped.beetroot_seeds} seeds dropped`);
            assert.equal(have('beetroot_seeds'), 0, `${where}, with beetroot seeds in the bag`);
            assert.ok(!lying().some(item => item.startsWith('beetroot_seeds')), `${where}, with beetroot seeds left lying`);
            assert.match(text, /farmland left empty: no seed for it/, `${where}, and the round didn't say why`);
        }
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

    await step('collecting sugar cane cuts the stalk above its bottom block, and leaves a lone bottom block', async () => {
        // Bedrock's sugar cane block is `reeds`, and collecting takes Bedrock's block names, so the model asks
        // for reeds (its item is still sugar_cane). On the grass beside a strip of water west of the bot: a
        // stalk three high at z 4 and a single block at z 2. Random ticks are off, so neither grows.
        await reset();
        await fill([-4, 0, 1], [-4, 0, 5], 'water');
        await fill([-3, 1, 4], [-3, 3, 4], 'reeds');
        await set([-3, 1, 2], 'reeds');
        await delay(800);
        const result = await act('test:collect', () => skills.collectBlockResult(bot, 'reeds', 2));
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.equal(raw([-3, 1, 4])?.name, 'reeds', `the stalk's bottom block stays: ${said}`);
        assert.equal(raw([-3, 2, 4])?.name, 'air', `the stalk above it is cut: ${said}`);
        assert.equal(raw([-3, 1, 2])?.name, 'reeds', `the lone bottom block stays: ${said}`);
        assert.ok(have('sugar_cane') >= 2, `the cane reached the bag (${have('sugar_cane')}): ${said}`);
        assert.match(said, /only the bottom block of each plant/);
        return { text: said };
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
            assert.equal(farmlandLeft(), FARMLAND, `farmland trampled (${trampled()}): ${tendedText}`);
            try { checkRound(tendedText); } catch (error) { error.message += ` (${tendedText} ${bot.output ?? ''})${motionText()}`; throw error; }
            return { refused: refusedText.trim().slice(-200), dropped, ...(motion.length ? { motion } : {}) };
        } finally { neighbor.stop(); farming.stop(); }
    });

    await step('a field is made by water, and the bot\'s own field is made bigger from its edge, with nothing trampled', async () => {
        const { sowField } = await import('../../src/agent/farming/sow.js');
        const { ME } = await import('../../src/agent/farming/field_book.js');
        const inField = (x, z) => x >= X0 && x <= X1 && z >= -2 && z <= 2;
        const farmlandAround = () => {
            const out = [];
            for (let x = -10; x <= 13; x++) for (let z = -10; z <= 10; z++) if (raw([x, 0, z])?.name === 'farmland') out.push({ x, z });
            return out;
        };
        const wet = c => Math.abs(c.x - WATER[0]) <= 4 && Math.abs(c.z - WATER[2]) <= 4;

        // A new field: the old one taken up, wild grass to cut, the water left where it was.
        await reset(['stone_hoe 1', 'wheat_seeds 5']);
        // The crops first: farmland taken from under them would pop them off as drops, seeds for the bot to
        // pick up. And whatever did drop is cleared last.
        await fill([X0, 1, -2], [X1, 1, 2], 'air');
        await fill([X0, 0, -2], [X1, 0, 2], 'grass_block');
        await set(WATER, 'water');
        await cmd('kill @e[type=item]');
        await fill([5, 1, 1], [8, 1, 3], 'short_grass');
        await delay(1500);
        const book = createFieldBook({ scope: 'live' });
        const made = await act('test:sow', () => sowField(bot, { size: 9, book, behind: { asked: false }, name: NAME }));
        const fresh = farmlandAround();
        assert.equal(fresh.length, 5, `five cells, one for each seed: ${made.text} ${bot.output ?? ''}`);
        for (const c of fresh) {
            assert.ok(wet(c), `${c.x}, ${c.z} is kept wet`);
            assert.equal(raw([c.x, 1, c.z])?.name, 'wheat', `${c.x}, ${c.z} is sown: ${made.text}`);
            assert.equal(book.whose([at(c.x, 0, c.z)]).owner, ME);
        }

        // The bot's own field, made bigger.
        await reset(['stone_hoe 1', 'carrot 3']);
        await delay(500);
        const field = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) field.push(at(x, 0, z));
        book.mark(field, { owner: ME });
        const bigger = await act('test:sow', () => sowField(bot, { seed: 'carrot', size: 3, book, behind: { asked: false }, name: NAME }));
        const added = farmlandAround().filter(c => !inField(c.x, c.z));
        assert.equal(added.length, 3, `three new cells: ${bigger.text} ${bot.output ?? ''}`);
        for (const c of added) {
            assert.ok(c.x >= X0 - 2 && c.x <= X1 + 2 && Math.abs(c.z) <= 4, `${c.x}, ${c.z} grows from the field`);
            assert.equal(raw([c.x, 1, c.z])?.name, 'carrots', `${c.x}, ${c.z} is sown with carrots`);
        }
        assert.equal(farmlandLeft(), FARMLAND, `the field itself is whole: ${bigger.text}`);
        return { made: made.text, bigger: bigger.text };
    });

    await step('melons and pumpkins: the fruit beside each stem is picked, the stems stay, a gap among melon stems is sown with melon seed', async () => {
        // As on Java: melon stems at 7 and 9 on the empty row, their melons (Bedrock's `melon_block`) to the
        // south beside the field, a young stem at 8 on the row before, round a gap at 8, 2; a pumpkin at 4.
        // Bedrock keeps one stem block, grown or not, and the bot is given melon seed only.
        await reset(['melon_seeds 3']);
        await fill([X0, 1, 1], [X1, 1, 2], 'air');
        for (let x = X0; x <= 5; x++) await set([x, 1, 1], 'beetroot ["growth"=7]');
        for (const x of [7, 9]) await set([x, 1, 2], 'melon_stem ["growth"=7]');
        await set([8, 1, 1], 'melon_stem ["growth"=7]');
        await set([4, 1, 2], 'pumpkin_stem ["growth"=7]');
        for (const x of [7, 9]) await set([x, 1, 3], 'melon_block');
        await set([4, 1, 3], 'pumpkin');
        await delay(800);
        const book = createFieldBook({ scope: 'live' });
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: true, by: 'Alex' }, name: NAME, memory: handle.memory }));
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.ok(['ok', 'partial'].includes(result.status), said);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled (${trampled()}): ${said}`);
        for (const x of [7, 9]) assert.equal(raw([x, 1, 3])?.name, 'air', `the melon at ${x} was picked: ${said}`);
        assert.equal(raw([4, 1, 3])?.name, 'air', `the pumpkin was picked: ${said}`);
        for (const x of [7, 9]) assert.equal(raw([x, 1, 2])?.name, 'melon_stem', `the melon stem at ${x} stands`);
        assert.equal(raw([8, 1, 1])?.name, 'melon_stem', 'the young melon stem stands');
        assert.equal(raw([4, 1, 2])?.name, 'pumpkin_stem', 'the pumpkin stem stands');
        assert.equal(raw([8, 1, 2])?.name, 'melon_stem', `the gap among the melon stems is sown with melon seed: ${said}`);
        assert.ok(have('melon_slice') >= 6, `the melons' slices reached the bag (${have('melon_slice')}): ${said}`);
        assert.equal(have('pumpkin'), 1, `so did the pumpkin: ${said}`);
        assert.match(result.text, /Harvested[^.]*2 melon/, said);
        assert.match(result.text, /Harvested[^.]*1 pumpkin/, said);
        return { text: said, dropped, ...(motion.length ? { motion } : {}) };
    });

    await step('asked to, the bot makes bone meal at a composter and ripens young wheat with it, cutting nothing', async () => {
        // As on Java: a composter behind the bot, out of a narrowed view, filled about twice by 64 seeds; then
        // 8 bone meal more for the young wheat. Bedrock calls the composter's level `composter_fill_level`.
        await reset(['wheat_seeds 64']);
        await set([-2, 1, 0], 'composter');
        await delay(500);
        const { composting } = await import('../../src/agent/farming/compost.js');
        const { boneMealField } = await import('../../src/agent/farming/bone_meal.js');
        const made = await act('test:compost', () => composting().compost(bot, 'wheat_seeds', 64, { behind: { asked: true, by: 'Alex' } }));
        const madeText = String(made.text ?? '').replace(/\n/g, ' | ');
        assert.equal(made.status, 'ok', madeText);
        assert.equal(have('wheat_seeds'), 0, `all 64 went in: ${madeText}`);
        const fromCompost = have('bone_meal');
        assert.ok(fromCompost >= 1, `the full composter gave bone meal: ${madeText}`);
        const level = Number(raw([-2, 1, 0])?.getProperties().composter_fill_level);
        assert.match(madeText, new RegExp(`took ${fromCompost} bone_meal out. It is at level ${level} of 7`), `the report says what the server has (level ${level})`);

        await cmd(`give ${NAME} bone_meal 8`, 300);
        await delay(500);
        const book = createFieldBook({ scope: 'live' });
        const before = have('bone_meal');
        const result = await act('test:bonemeal', () => boneMealField(bot, { count: 8, book, behind: { asked: true, by: 'Alex' }, memory: handle.memory }));
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.equal(result.status, 'ok', said);
        assert.equal(before - have('bone_meal'), 8, `it used the eight it was asked to: ${said}`);
        const ripened = [];
        for (let x = X0; x <= X1; x++) if (growthAt([x, 1, -1]) === 7) ripened.push(x);
        // Each bone meal grows wheat two to five stages, so eight ripen at least two plants from stage 2.
        assert.ok(ripened.length >= 2, `young wheat ripened at ${ripened.join(', ')}: ${said}`);
        assert.match(said, new RegExp(`${ripened.length} plants? (is|are) ripe now`), said);
        for (let x = X0; x <= X1; x++) {
            assert.equal(growthAt([x, 1, -2]), 7, `the ripe wheat at ${x} is not cut`);
            assert.equal(raw([x, 1, -1])?.name, 'wheat', `the wheat at ${x} is not cut`);
        }
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled (${trampled()}): ${said}`);
        return { compost: madeText, boneMeal: said, ...(motion.length ? { motion } : {}) };
    });

    await step('a round takes the harvest to the chests by the field that are for it, keeping seed and food, and tramples nothing', async () => {
        // Carrots to start with, so that there is more food than the bot keeps.
        await reset(['wheat_seeds 2', 'carrot 20']);
        // Beside the field, off the farmland: a chest for plants, one for food, and one for anything.
        const PLANTS = [4, 1, 4], FOOD = [6, 1, 4], ANYTHING = [8, 1, 4];
        for (const c of [PLANTS, FOOD, ANYTHING]) await set(c, 'chest');
        const rawOpen = bot.openContainer;
        const { installStorage } = await import('../../src/agent/storage/install.js');
        const { storerOf } = await import('../../src/agent/library/store_way.js');
        const { getCommand } = await import('../../src/agent/commands/index.js');
        const storage = installStorage(agent, { config: { ...rootSettings, ...bedrockTestSettings(server), chest_sorting: true, store_and_fetch: true },
            bookDir: mkdtempSync(path.join(tmpdir(), 'bedrock-farming-chests-')) });
        assert.ok(storage && storerOf(bot), 'chest storage is on, with putting away');
        // A player puts the chests by the field and says what they are for. The bot has looked at them.
        await bot.lookAt(at(6, 1.5, 4.5), true);
        await delay(1500);
        for (const [c, what] of [[PLANTS, 'plants'], [FOOD, 'food'], [ANYTHING, null]]) {
            const p = at(...c);
            assert.match(String(await agent.handleMessage('Alex', () => getCommand('!markChest').perform(agent, p.x, p.y, p.z, NAME, 'same'))), /is now|was already/);
            if (what) assert.match(String(await agent.handleMessage('Alex', () => getCommand('!chestFor').perform(agent, p.x, p.y, p.z, what))), new RegExp(`For ${what}`));
        }
        await bot.lookAt(at(9.5, 1, 0.5), true);

        const book = createFieldBook({ scope: 'live' });
        const { ME } = await import('../../src/agent/farming/field_book.js');
        const cells = [];
        for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (!isWater(x, z)) cells.push(at(x, 0, z));
        book.mark(cells, { owner: ME });
        // Every meal the bot eats while the scene runs (the auto-eat plugin eats when it is hungry): a carrot
        // eaten after the round would read as one the round didn't keep.
        const meals = [];
        const consume = bot.consume.bind(bot);
        bot.consume = (...args) => { meals.push(`${bot.heldItem?.name} at food ${bot.food}`); return consume(...args); };
        const result = await act('test:tend', () => tendField(bot, { book, behind: { asked: false }, name: NAME, memory: handle.memory, store: storerOf(bot) }));
        bot.consume = consume;
        // The report on one line: a failure message keeps only its first.
        const said = String(result.text ?? '').replace(/\n/g, ' | ');
        assert.ok(['ok', 'partial'].includes(result.status), said);
        assert.equal(farmlandLeft(), FARMLAND, `farmland trampled (${trampled()}): ${said}`);
        assert.match(result.text, /The harvest, to the field's chest: Put away/, said);

        // What is really in each chest: opened by the test's own hands from in front of it, off the field.
        const kept = { wheat: have('wheat'), wheat_seeds: have('wheat_seeds'), carrot: have('carrot'), beetroot: have('beetroot'), eat: have('carrot') + have('beetroot') };
        const growing = block => { let n = 0; for (let x = X0; x <= X1; x++) for (let z = -2; z <= 2; z++) if (raw([x, 1, z])?.name === block) n++; return n; };
        const wheatCells = growing('wheat');
        const holds = async cell => {
            if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
            await tpTo([cell[0], 1, cell[2] + 2], 180, 800);
            const window = await rawOpen(bot.blockAt(at(...cell))).catch(async () => { await delay(1000); return rawOpen(bot.blockAt(at(...cell))); });
            try {
                const out = {};
                for (let i = 0; i < window.inventoryStart; i++) { const item = window.slots[i]; if (item?.name) out[item.name] = (out[item.name] ?? 0) + item.count; }
                return out;
            } finally { window.close(); await delay(400); }
        };
        const plants = await holds(PLANTS), food = await holds(FOOD), anything = await holds(ANYTHING);
        assert.equal(plants.wheat, X1 - X0 + 1, `all the wheat went to the chest for plants: ${JSON.stringify(plants)} ${said}`);
        assert.equal(kept.wheat, 0, 'none of it kept');
        assert.equal(kept.wheat_seeds, Math.min(wheatCells, kept.wheat_seeds + (plants.wheat_seeds ?? 0)),
            `seed kept for each cell of wheat, the rest stored: ${JSON.stringify(plants)} ${said}`);
        assert.equal(plants.carrot ?? 0, 0, 'carrots are food, not plants');
        const stored = (food.carrot ?? 0) + (food.beetroot ?? 0);
        const bag = `carrot ${kept.carrot}, beetroot ${kept.beetroot} then; carrot ${have('carrot')}, beetroot ${have('beetroot')}, food ${bot.food} now; meals: ${meals.join(', ') || 'none'}`;
        // Food: 16 in all, or a carrot for each carrot cell when there are more (seed to sow the field again).
        const meant = Math.min(kept.eat + stored, Math.max(16, growing('carrots')));
        assert.equal(kept.eat, meant, `food kept, 16 in all or a carrot for each of ${growing('carrots')} carrot cells, the rest stored: kept ${kept.eat} (${bag}), stored ${JSON.stringify(food)}: ${said}`);
        assert.ok(stored > 0, `the food the bot doesn't keep went to the chest for food: ${JSON.stringify(food)}`);
        assert.deepEqual(anything, {}, 'the chest for anything is left alone');
        return { text: result.text, dropped, ...(motion.length ? { motion } : {}) };
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
        // What the scenes dropped and left lying would be picked up by the next script's bot.
        if (origin) await cmd('kill @e[type=item]');
        if (origin) await fill([-12, -1, -12], [14, 8, 12], 'air');
    } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
