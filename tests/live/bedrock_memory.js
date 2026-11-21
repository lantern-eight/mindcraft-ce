// SPDX-License-Identifier: CC0-1.0
// Live check of world memory on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_memory.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: the scene is built and torn down from the console.
//
// The unit tests run the recorder over Bedrock chunks built by hand. This runs it over what a real server
// sends: a door, a bed, two chests side by side and a crop, placed by the server the way a player's would
// be, both halves of the door and the bed included, and the two chests paired into one double chest.
// Memory has to keep each as the one thing it is, under Bedrock's own names, see none of what is buried,
// and still know the door's state once it can't see it.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';
import { fairPlaySettings, lookRound } from '../helpers/live_view.js';

const NAME = 'BedrockMemory';
const { step, summary } = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scene is built from the server console: set BEDROCK_TEST_CONSOLE');
const cmd = server.command;

let bot, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const fill = (a, b, block) => cmd(`fill ${xyz(at(...a))} ${xyz(at(...b))} ${block}`);
const set = (a, block) => cmd(`setblock ${xyz(at(...a))} ${block}`);
const cellsOf = thing => [thing, thing.also].filter(Boolean).map(p => `${p.x - origin.x},${p.y - origin.y},${p.z - origin.z}`).sort();

// A stone platform high above the ground, with dirt under it, and the things on top. The bot stands in
// the middle at (0, 1, 0).
async function buildScene() {
    await fill([-12, 1, -12], [12, 8, 12], 'air');
    await fill([-12, -2, -12], [12, -1, 12], 'dirt');
    await fill([-12, 0, -12], [12, 0, 12], 'stone');
    await set([4, 1, 0], 'wooden_door');   // the server places both halves
    await set([-3, 1, 3], 'bed');          // and both halves of the bed
    await set([2, 1, -4], 'chest');
    await set([3, 1, -4], 'chest');        // beside the first, facing the same way: the server pairs them
    await set([-5, 0, -4], 'farmland');
    await set([-5, 1, -4], 'wheat');
}

// The cells around the bot's body, which wall it in when filled.
const AROUND = [[1, 1, 0], [1, 2, 0], [-1, 1, 0], [-1, 2, 0], [0, 1, 1], [0, 2, 1], [0, 1, -1], [0, 2, -1], [0, 3, 0]];

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server) });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { createPerception } = await import('../../src/agent/fairplay/perception.js');
    const { resolvePolicy } = await import('../../src/agent/fairplay/policy.js');
    const { openMemory } = await import('../../src/agent/memory/store.js');
    const { createRecorder } = await import('../../src/agent/memory/recorder.js');
    const { propsOfState } = await import('../../src/agent/memory/block_state.js');

    await step('the bot joins, and the scene is built', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        origin = bot.entity.position.floored().offset(0, 40, 0);
        await buildScene(); // straight above the bot, in chunks it already has
        await cmd(`tp ${NAME} ${origin.x + 0.5} ${origin.y + 1} ${origin.z + 0.5}`, 2500);
        assert.equal(bot.blockAt(at(0, 0, 0))?.name, 'stone', 'the bot stands on the platform');
    });

    let t = Date.now();
    const now = () => t;
    let recorder = null;
    const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'bedrock-memory-')), scope: 'live/overworld', now,
        canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory, now, tickBudgetMs: Infinity });
    const perception = createPerception({ bot, policy: resolvePolicy(fairPlaySettings()), memory: recorder.view,
        now, searchBudgetMs: Infinity });
    recorder.attach(perception);

    await step('a look around keeps what is in view, and nothing that is buried', async () => {
        const started = performance.now();
        recorder.tick();
        const ms = performance.now() - started;
        // Through a player's screen one look sees one side: the bot turns round, and memory looks each time.
        await lookRound(bot, () => recorder.tick());
        assert.equal(memory.cells.read(at(5, 0, 5).x, at(5, 0, 5).y, at(5, 0, 5).z), 'stone');
        assert.equal(memory.cells.read(at(5, -1, 5).x, at(5, -1, 5).y, at(5, -1, 5).z), null, 'the dirt under the floor');
        return { wholeLookMs: Math.round(ms) };
    });

    await step('the door and the bed are each one thing, under Bedrock\'s names', () => {
        const door = memory.things.get(at(4, 1, 0).x, at(4, 1, 0).y, at(4, 1, 0).z);
        assert.equal(door?.kind, 'passage', `door: ${JSON.stringify(door)}`);
        assert.equal(door.name, 'wooden_door');
        assert.deepEqual(cellsOf(door), ['4,1,0', '4,2,0']);
        assert.equal(memory.things.count('wooden_door'), 1);
        const bed = memory.things.get(at(-3, 1, 3).x, at(-3, 1, 3).y, at(-3, 1, 3).z);
        assert.equal(bed?.kind, 'bed', `bed: ${JSON.stringify(bed)}`);
        assert.equal(cellsOf(bed).length, 2, 'both halves');
        assert.equal(memory.things.count('bed'), 1);
        return { door: door.state, bed: bed.state };
    });

    await step('the two chests are one double chest, and the wheat is a field', () => {
        // Bedrock pairs them in their block entities, not their states.
        const chest = memory.things.get(at(2, 1, -4).x, at(2, 1, -4).y, at(2, 1, -4).z);
        assert.equal(chest?.kind, 'container', JSON.stringify(chest));
        assert.deepEqual(cellsOf(chest), ['2,1,-4', '3,1,-4']);
        assert.equal(memory.things.count('chest'), 1);
        const fields = memory.things.fieldsNear(at(-5, 1, -4), { maxDistance: 16 });
        assert.ok(fields.some(field => field.crop === 'wheat' && field.count === 1 && field.ripe === 0), JSON.stringify(fields));
        return { chests: memory.things.count('chest') };
    });

    await step('walled in, the bot still knows the door, as it last saw it', async () => {
        for (const cell of AROUND) await cmd(`setblock ${xyz(at(...cell))} stone`, 150);
        await delay(1000);
        perception.invalidate();
        const upper = perception.blockAt(at(4, 2, 0));
        assert.ok(upper?.rememberedAt, 'the upper half comes from memory, not from the world');
        assert.equal(upper.name, 'wooden_door');
        assert.equal(propsOfState(bot.registry, upper.stateId).upper_block_bit, '1');
        const lower = perception.blockAt(at(4, 1, 0));
        assert.equal(propsOfState(bot.registry, lower.stateId).upper_block_bit, '0');
        for (const cell of AROUND) await cmd(`setblock ${xyz(at(...cell))} air`, 150);
    });
    perception.stop();
    recorder.stop();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try { if (origin) await fill([-12, -2, -12], [12, 8, 12], 'air'); } catch (error) { console.error('Tear-down failed:', error.message); }
    bot?.quit();
    const result = summary();
    console.log(JSON.stringify(result));
    if (result.status !== 'passed') process.exitCode = 1;
    setTimeout(() => process.exit(), 1000).unref();
}
