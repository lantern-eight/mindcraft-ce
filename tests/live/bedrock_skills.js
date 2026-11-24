// SPDX-License-Identifier: CC0-1.0
// Mindcraft's stock skills, one at a time, on a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_skills.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// The server needs a flat world, survival mode, offline mode and a console. NEVER a world you care about.
//
// The skills were written for Java Edition and there is one copy of them. This calls each the way the
// agent does, with fair play off, and checks what it did in the world. Each skill gets its own scene,
// built from the server console, and its own inventory, so one failing does not spoil the next. The few
// skills that need another player get a second bot, which joins for them and only stands where it is put.
//
// A skill listed with `gap` is known not to work on Bedrock yet, and docs/bedrock.md says so. It is tried
// anyway and never fails the run; when it starts working the output says so. Every other skill has to
// work, and all of them are tried before the run reports.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshBot, freshStart } from './bedrock_fixture.js';

const NAME = 'BedrockSkills';
const FRIEND = 'BedrockFriend';
const only = process.argv.find(arg => arg.startsWith('--only='))?.split('=')[1]?.split(',');
const report = createReport();
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The skills walk builds its scenes from the server console: set BEDROCK_TEST_CONSOLE');

let bot, friend, skills, initBot, villagerOf, getCommand, origin;
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;
const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
const blockName = (dx, dy, dz) => bot.blockAt(at(dx, dy, dz))?.name;
const cmd = (line, settle) => server.command(line, settle);
const give = (item, n = 1) => cmd(`give ${NAME} ${item} ${n}`, 700);
const setblock = (dx, dy, dz, block) => cmd(`setblock ${xyz(at(dx, dy, dz))} ${block}`);

// Back to flat ground with air above it, the bot at the middle with empty hands, and daylight.
async function reset() {
    bot.interrupt_code = false;
    bot.output = '';
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    await cmd(`fill ${xyz(at(-8, 0, -8))} ${xyz(at(8, 4, 8))} air`);
    await cmd(`fill ${xyz(at(-8, -1, -8))} ${xyz(at(8, -1, 8))} grass_block`);
    // Three layers of dirt under the grass, not one: digDown digs two blocks and stops at a drop of three
    // below them, and a test world can have a hollow there (a scene cleared from a platform built lower).
    await cmd(`fill ${xyz(at(-8, -4, -8))} ${xyz(at(8, -2, 8))} dirt`);
    await pickUpDrops();
    await cmd(`clear ${NAME}`);
    await cmd('time set noon');
    await cmd(`tp ${NAME} ${origin.x} ${origin.y} ${origin.z}`, 900);
}

// What one scene leaves lying on the ground, the bot would pick up in the middle of a later one, and a
// count there would be off by it: a block broken in one scene was now and then picked up while the bot
// walked to the chest in another. So the bot is put on top of every drop before its hands are emptied.
// (The server could remove drops in one line, but that line needs characters the console can't be
// trusted to pass: see bedrock_fixture.js.)
async function pickUpDrops() {
    const lying = entity => entity.name === 'item' && entity.position.distanceTo(origin) < 16;
    const deadline = Date.now() + 10000; // something thrown can't be picked up for its first two seconds
    for (let drop; Date.now() < deadline && (drop = Object.values(bot.entities).find(lying));) {
        const { x, y, z } = drop.position;
        await cmd(`tp ${NAME} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`, 500);
    }
}

const nearest = name => Object.values(bot.entities)
    .filter(entity => entity.name === name && entity !== bot.entity)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];

// Nothing safe to send on the console takes an animal away again, so the bot does it, with a skill that
// has a scene of its own above.
async function putDown(animal) {
    await give('iron_sword', 1);
    await withinTime(skills.attackNearest(bot, animal, true), 60000, `tidying up the ${animal}`);
}

// The second player, put at a spot, once the first bot has seen it there.
async function friendAt(dx, dy, dz) {
    if (!friend) {
        friend = initBot(FRIEND);
        friend.on('error', error => console.error('Second bot error:', error.message));
        await Promise.race([once(friend, 'spawn'), delay(30000).then(() => { throw new Error('The second bot did not spawn within 30 s'); })]);
        await freshBot(server, friend); // nothing left from a last run in its hands
        await delay(2000);
    }
    await cmd(`tp ${FRIEND} ${xyz(at(dx, dy, dz))}`, 900);
    const spot = at(dx, dy, dz).offset(0.5, 0, 0.5);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const seen = bot.players[FRIEND]?.entity;
        if (seen && seen.position.distanceTo(spot) < 1.5) return seen;
        await delay(200);
    }
    throw new Error(`The first bot does not see ${FRIEND} where it was put`);
}

// Villagers for the trading scenes, each standing in a pit two blocks deep so it can't wander off; the
// reset after the scene fills the pits in, villagers and all. A spawn event that names a job doesn't
// reliably give that job on this server (one asked for a farmer came out a shepherd, others with no job
// at all), so several are summoned, and a scene trades with whichever came out with one. The last pit
// holds a child.
async function villagersInPits() {
    const jobs = ['cleric', 'librarian', 'butcher', 'armorer', 'shepherd'];
    const spots = [...jobs.map((job, i) => ({ dx: -4 + 2 * i, dz: 4, event: `minecraft:spawn_${job}` })),
        { dx: 0, dz: -4, event: 'minecraft:entity_born' }];
    for (const { dx, dz, event } of spots) {
        await cmd(`fill ${xyz(at(dx, -2, dz))} ${xyz(at(dx, -1, dz))} air`, 100);
        await cmd(`summon villager ${xyz(at(dx, -2, dz))} 0 0 ${event}`, 100);
    }
    const inPit = ({ dx, dz }) => Object.values(bot.entities).find(entity => villagerOf(entity) &&
        entity.position.y < origin.y - 0.5 &&
        Math.abs(entity.position.x - (origin.x + dx + 0.5)) < 1 && Math.abs(entity.position.z - (origin.z + dz + 0.5)) < 1);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !spots.every(inPit)) await delay(300);
    await delay(1500); // a villager's job is sent a moment after the villager itself
    const child = inPit(spots.at(-1));
    const working = spots.slice(0, -1).map(inPit).find(entity => {
        const villager = entity && villagerOf(entity);
        return villager && !villager.baby && villager.profession && !['unemployed', 'nitwit'].includes(villager.profession);
    });
    const found = spots.map(inPit).map(entity => entity && villagerOf(entity));
    assert.ok(working, `no villager came out with a job: ${JSON.stringify(found)}`);
    assert.ok(child && villagerOf(child).baby, `the last pit holds no child: ${JSON.stringify(found)}`);
    return { working, child, job: villagerOf(working).profession };
}

// A skill that never comes back must not hold up the rest: it is told to stop, as the agent would.
async function withinTime(promise, ms, what) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms / 1000} s`)), ms); });
    try {
        return await Promise.race([promise, late]);
    } catch (error) {
        bot.interrupt_code = true;
        bot.pathfinder?.stop();
        bot.clearControlStates?.();
        await delay(1200);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

const said = () => bot.output.trim().split('\n').slice(-2).join(' / ');

// Each: the scene, the call, and what must be true afterwards. `seconds` is how long the call may take.
const walk = [
    { name: 'getBiomeName: the biome the bot stands in', async run() {
        // The test world is a flat world, which is all plains. Bedrock chunks carry the biome as Bedrock's own
        // number; the bot reads it from the chunk and names it from the game data.
        const world = await import('../../src/agent/library/world.js');
        assert.equal(world.getBiomeName(bot), 'plains');
    } },
    { name: 'collectBlock: break two logs by hand and pick them up', async run() {
        await setblock(3, 0, 2, 'oak_log'); await setblock(3, 1, 2, 'oak_log');
        const ok = await withinTime(skills.collectBlock(bot, 'oak_log', 2), 60000, 'collectBlock');
        assert.ok(ok, said());
        assert.equal(count('oak_log'), 2, said());
    } },
    // The cases of the Java mining scenarios (tests/live/mining_scenarios.js), each a scene here. The skill
    // is collectBlock's own (collectBlockResult), which reports how many blocks it broke and what it gained.
    { name: 'collectBlock: a log above the bot\'s head, reached without building up', async run() {
        await setblock(0, 3, 0, 'oak_log');
        const result = await withinTime(skills.collectBlockResult(bot, 'oak_log', 1), 40000, 'collectBlock');
        assert.equal(result.status, 'ok', result.text);
        assert.equal(result.broken, 1, result.text);
        assert.equal(count('oak_log'), 1, said());
    } },
    { name: 'collectBlock: iron ore in view, and deepslate iron ore buried in stone', async run() {
        await give('stone_pickaxe', 1);
        await setblock(3, 0, 0, 'iron_ore');
        await cmd(`fill ${xyz(at(5, 0, -1))} ${xyz(at(7, 2, 1))} stone`);
        await setblock(6, 1, 0, 'deepslate_iron_ore');
        const result = await withinTime(skills.collectBlockResult(bot, 'iron_ore', 2), 90000, 'collectBlock');
        assert.equal(result.status, 'ok', result.text);
        assert.equal(result.broken, 2, result.text);
        assert.ok(count('raw_iron') >= 2, `the bot holds ${count('raw_iron')} raw iron; ${said()}`);
    } },
    { name: 'collectBlock: obsidian with a diamond pickaxe', async run() {
        await give('diamond_pickaxe', 1);
        await setblock(2, 0, 1, 'obsidian');
        const result = await withinTime(skills.collectBlockResult(bot, 'obsidian', 1), 60000, 'collectBlock');
        assert.equal(result.status, 'ok', result.text);
        assert.equal(count('obsidian'), 1, said());
    } },
    { name: 'collectBlock: stopped in the middle of obsidian, then asked again', async run() {
        await give('diamond_pickaxe', 1);
        await setblock(2, 0, 1, 'obsidian');
        const pending = skills.collectBlockResult(bot, 'obsidian', 1);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && bot.targetDigBlock?.name !== 'obsidian') await delay(100);
        assert.equal(bot.targetDigBlock?.name, 'obsidian', 'the bot never started on the obsidian');
        await delay(1500);
        // What the agent does when told to stop: raise the flag, stop digging and walking.
        bot.interrupt_code = true;
        bot.stopDigging();
        bot.pathfinder.setGoal(null);
        const stopped = await withinTime(pending, 20000, 'the stopped collectBlock');
        assert.equal(stopped.status, 'cancelled', stopped.text);
        assert.equal(blockName(2, 0, 1), 'obsidian', 'the obsidian went anyway');
        bot.interrupt_code = false;
        bot.output = '';
        const again = await withinTime(skills.collectBlockResult(bot, 'obsidian', 1), 60000, 'collectBlock, asked again');
        assert.equal(again.status, 'ok', again.text);
        assert.equal(count('obsidian'), 1, said());
    } },
    { name: 'collectBlock: an enchanted pickaxe digs at its own speed', async run() {
        await give('diamond_pickaxe', 1);
        await setblock(2, 0, 1, 'obsidian');
        assert.ok(await skills.equip(bot, 'diamond_pickaxe'), said());
        await delay(500);
        const plain = bot.digTime(bot.blockAt(at(2, 0, 1)));
        await cmd(`enchant ${NAME} efficiency 5`, 1200);
        const fast = bot.digTime(bot.blockAt(at(2, 0, 1)));
        assert.ok(fast < plain / 2, `obsidian takes ${plain} ms with a plain diamond pickaxe and ${fast} ms with efficiency V`);
        const result = await withinTime(skills.collectBlockResult(bot, 'obsidian', 1), 30000, 'collectBlock');
        assert.equal(result.status, 'ok', result.text);
        assert.equal(count('obsidian'), 1, said());
    } },
    { name: 'craftRecipe: planks from a log, in the bot\'s own grid', async run() {
        await give('oak_log', 1);
        const ok = await withinTime(skills.craftRecipe(bot, 'oak_planks', 1), 30000, 'craftRecipe');
        assert.ok(ok, said());
        assert.equal(count('oak_planks'), 4, said());
    } },
    { name: 'craftRecipe: a crafting table from planks', async run() {
        await give('oak_planks', 4);
        const ok = await withinTime(skills.craftRecipe(bot, 'crafting_table', 1), 30000, 'craftRecipe');
        assert.ok(ok, said());
        assert.equal(count('crafting_table'), 1, said());
    } },
    { name: 'craftRecipe: a pickaxe, at a crafting table the bot puts down', async run() {
        await give('oak_planks', 3); await give('stick', 2); await give('crafting_table', 1);
        const ok = await withinTime(skills.craftRecipe(bot, 'wooden_pickaxe', 1), 45000, 'craftRecipe');
        assert.ok(ok, said());
        assert.equal(count('wooden_pickaxe'), 1, said());
    } },
    { name: 'placeBlock: put a block where it is told', async run() {
        await give('cobblestone', 4);
        const ok = await withinTime(skills.placeBlock(bot, 'cobblestone', at(2, 0, -2).x, at(2, 0, -2).y, at(2, 0, -2).z), 30000, 'placeBlock');
        assert.ok(ok, said());
        assert.equal(blockName(2, 0, -2), 'cobblestone', said());
    } },
    { name: 'placeBlock: a thin layer of snow is no block in the way; a Bedrock snow block is', async run() {
        // Mindcraft's list of what may be built over names Java's thin layer "snow". On Bedrock that is
        // "snow_layer", and "snow" is a whole block.
        await give('cobblestone', 4);
        await setblock(2, 0, -2, 'snow_layer');
        await delay(400);
        assert.ok(await withinTime(skills.placeBlock(bot, 'cobblestone', at(2, 0, -2).x, at(2, 0, -2).y, at(2, 0, -2).z), 30000, 'placeBlock'), said());
        assert.equal(blockName(2, 0, -2), 'cobblestone', said());
        assert.doesNotMatch(bot.output, /in the way/, `the layer was taken for a block: ${said()}`);
        bot.output = '';
        await give('iron_shovel', 1); // a block of snow is only broken with a shovel in hand
        await setblock(2, 0, -2, 'snow');
        await delay(400);
        assert.ok(await withinTime(skills.placeBlock(bot, 'cobblestone', at(2, 0, -2).x, at(2, 0, -2).y, at(2, 0, -2).z), 30000, 'placeBlock'), said());
        assert.equal(blockName(2, 0, -2), 'cobblestone', said());
        assert.match(bot.output, /snow in the way/, `the snow block was built over: ${said()}`);
    } },
    { name: 'breakBlockAt: break the block at a spot', async run() {
        await setblock(2, 0, -2, 'cobblestone'); await give('iron_pickaxe', 1);
        const ok = await withinTime(skills.breakBlockAt(bot, at(2, 0, -2).x, at(2, 0, -2).y, at(2, 0, -2).z), 30000, 'breakBlockAt');
        assert.ok(ok, said());
        assert.equal(blockName(2, 0, -2), 'air', said());
    } },
    { name: 'equip: hold a tool', async run() {
        await give('iron_pickaxe', 1); await give('cobblestone', 1);
        const ok = await withinTime(skills.equip(bot, 'iron_pickaxe'), 15000, 'equip');
        assert.ok(ok, said());
        assert.equal(bot.heldItem?.name, 'iron_pickaxe', said());
    } },
    { name: 'equip: put on armor', async run() {
        await give('iron_helmet', 1);
        const ok = await withinTime(skills.equip(bot, 'iron_helmet'), 15000, 'equip');
        assert.ok(ok, said());
        await delay(500);
        assert.equal(bot.inventory.slots[5]?.name, 'iron_helmet', `head slot holds ${bot.inventory.slots[5]?.name}; ${said()}`);
    } },
    { name: 'putInChest, viewChest, takeFromChest', async run() {
        await setblock(3, 0, -2, 'chest'); await give('cobblestone', 8);
        assert.ok(await withinTime(skills.putInChest(bot, 'cobblestone', 5), 30000, 'putInChest'), said());
        assert.equal(count('cobblestone'), 3, `the bot holds ${count('cobblestone')} after putting 5 of 8 in; ${said()}`);
        bot.output = '';
        assert.ok(await withinTime(skills.viewChest(bot), 30000, 'viewChest'), said());
        assert.match(bot.output, /cobblestone/, 'the chest was read');
        assert.ok(await withinTime(skills.takeFromChest(bot, 'cobblestone', 2), 30000, 'takeFromChest'), said());
        assert.equal(count('cobblestone'), 5, `the bot holds ${count('cobblestone')} after taking 2 back; ${said()}`);
    } },
    { name: 'smeltItem: iron in a furnace', async run() {
        await setblock(3, 0, -2, 'furnace'); await give('raw_iron', 1); await give('coal', 1);
        const ok = await withinTime(skills.smeltItem(bot, 'raw_iron', 1), 60000, 'smeltItem');
        assert.ok(ok, said());
        assert.equal(count('iron_ingot'), 1, said());
    } },
    { name: 'discard: throw items away', async run() {
        await give('cobblestone', 3);
        const ok = await withinTime(skills.discard(bot, 'cobblestone', 3), 30000, 'discard');
        assert.ok(ok, said());
        assert.equal(count('cobblestone'), 0, said());
    } },
    { name: 'consume: eat', async run() {
        await give('golden_apple', 1); // the one food that can be eaten on a full stomach
        const ok = await withinTime(skills.consume(bot, 'golden_apple'), 20000, 'consume');
        assert.ok(ok, said());
        await delay(800);
        assert.equal(count('golden_apple'), 0, said());
    } },
    { name: 'attackNearest: kill an animal', async run() {
        await give('iron_sword', 1);
        await cmd(`summon pig ${xyz(at(4, 0, 3))}`, 1500);
        // Counted, not "no pig in sight": an animal that wandered in by itself is not this scene's.
        const pigs = () => Object.values(bot.entities).filter(entity => entity.name === 'pig');
        const before = pigs().length;
        assert.ok(before > 0, 'the pig did not appear');
        const ok = await withinTime(skills.attackNearest(bot, 'pig', true), 60000, 'attackNearest');
        assert.ok(ok, said());
        await delay(1000);
        assert.equal(pigs().length, before - 1, `there were ${before} pigs and there are ${pigs().length}; ${said()}`);
    } },
    { name: 'goToPosition and goToNearestBlock', async run() {
        await setblock(6, 0, 5, 'chest');
        assert.ok(await withinTime(skills.goToPosition(bot, at(-5, 0, -5).x, at(-5, 0, -5).y, at(-5, 0, -5).z, 1), 40000, 'goToPosition'), said());
        assert.ok(bot.entity.position.distanceTo(at(-5, 0, -5)) < 2.5, `ended ${bot.entity.position.distanceTo(at(-5, 0, -5)).toFixed(1)} blocks away`);
        assert.ok(await withinTime(skills.goToNearestBlock(bot, 'chest', 2), 40000, 'goToNearestBlock'), said());
        assert.ok(bot.entity.position.distanceTo(at(6, 0, 5)) < 3.5, `ended ${bot.entity.position.distanceTo(at(6, 0, 5)).toFixed(1)} blocks from the chest`);
    } },
    { name: 'goToBed: sleep in a bed at night', async run() {
        await setblock(3, 0, 3, 'bed');
        await cmd('time set night', 1500);
        let slept = false;
        const watch = setInterval(() => { slept = slept || Boolean(bot.isSleeping); }, 100);
        try {
            // The skill only returns once the bot is awake again, so the morning is brought on from here.
            const sleeping = skills.goToBed(bot);
            await withinTime(Promise.race([sleeping, delay(15000)]), 20000, 'goToBed');
            assert.ok(slept, `the bot never lay down; ${said()}`);
            await cmd('time set noon', 1500);
            await withinTime(sleeping, 15000, 'waking up');
        } finally {
            clearInterval(watch);
        }
    } },
    { name: 'tillAndSow: till soil and plant seeds', async run() {
        await give('wooden_hoe', 1); await give('wheat_seeds', 2);
        await setblock(2, -1, 1, 'water');
        const spot = at(2, -1, 2);
        const ok = await withinTime(skills.tillAndSow(bot, spot.x, spot.y, spot.z, 'wheat_seeds'), 30000, 'tillAndSow');
        assert.ok(ok, said());
        await delay(800);
        assert.equal(blockName(2, -1, 2), 'farmland', `the soil is ${blockName(2, -1, 2)}; ${said()}`);
        assert.equal(blockName(2, 0, 2), 'wheat', `above it is ${blockName(2, 0, 2)}; ${said()}`);
    } },
    { name: 'useDoor: walk through a door', async run() {
        await cmd(`fill ${xyz(at(3, 0, -3))} ${xyz(at(3, 1, 3))} cobblestone`);
        await cmd(`fill ${xyz(at(3, 0, 0))} ${xyz(at(3, 1, 0))} air`);
        await setblock(3, 0, 0, 'wooden_door');
        const ok = await withinTime(skills.useDoor(bot, at(3, 0, 0)), 30000, 'useDoor');
        assert.ok(ok, said());
        // The skill opens the door and walks forward for a fixed 0.6 s, so where it ends depends on where
        // it started from. In the doorway or beyond means the door opened and the bot went in.
        assert.ok(bot.entity.position.x > at(3, 0, 0).x + 0.2, `the bot is at x ${bot.entity.position.x.toFixed(1)}, still in front of the door at x ${at(3, 0, 0).x}`);
    } },
    { name: 'useDoor: find a door by itself, and pass one already open', async run() {
        await cmd(`fill ${xyz(at(3, 0, -3))} ${xyz(at(3, 1, 3))} cobblestone`);
        await cmd(`fill ${xyz(at(3, 0, 0))} ${xyz(at(3, 1, 0))} air`);
        await setblock(3, 0, 0, 'wooden_door');
        await delay(500);
        await bot.activateBlock(bot.blockAt(at(3, 0, 0)));
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && !bot.blockAt(at(3, 0, 0))?._properties?.open_bit) await delay(100);
        assert.ok(bot.blockAt(at(3, 0, 0))?._properties?.open_bit, 'the door did not open for the scene');
        // No position: the skill looks for the nearest door by name. It mustn't shut this one first.
        const ok = await withinTime(skills.useDoor(bot), 30000, 'useDoor');
        assert.ok(ok, said());
        assert.ok(bot.entity.position.x > at(3, 0, 0).x + 0.2, `the bot is at x ${bot.entity.position.x.toFixed(1)}, still in front of the door at x ${at(3, 0, 0).x}`);
    } },
    { name: 'digDown: dig straight down', async run() {
        await give('iron_shovel', 1);
        const before = bot.entity.position.y;
        const ok = await withinTime(skills.digDown(bot, 2), 40000, 'digDown');
        assert.ok(ok, said());
        assert.ok(before - bot.entity.position.y >= 1.5, `went down ${(before - bot.entity.position.y).toFixed(1)} blocks; ${said()}`);
    } },
    { name: 'digDown after a walk: the bot goes down the hole it digs', async run() {
        // digDown digs the column under the bot's feet. A bot standing off the middle of its block stands
        // partly on the next one, and doesn't drop into the hole. On Java the pathfinder puts the bot in the
        // middle of its block when it stops; on Bedrock it can't (the server refuses that shift).
        await give('iron_shovel', 1);
        const offsets = [];
        for (const [dx, dz] of [[4, 3], [-3, 4], [3, -4]]) {
            const there = at(dx, 0, dz);
            assert.ok(await withinTime(skills.goToPosition(bot, there.x, there.y, there.z, 0), 30000, 'goToPosition'), said());
            await delay(600);
            const p = bot.entity.position;
            offsets.push(Math.max(Math.abs(p.x - Math.floor(p.x) - 0.5), Math.abs(p.z - Math.floor(p.z) - 0.5)));
            const before = p.y;
            const ok = await withinTime(skills.digDown(bot, 2), 40000, 'digDown');
            assert.ok(ok, said());
            await delay(800);
            assert.ok(before - bot.entity.position.y >= 1.5,
                `went down ${(before - bot.entity.position.y).toFixed(1)} blocks, standing ${offsets.at(-1).toFixed(2)} off the middle; ${said()}`);
            await reset();
            await give('iron_shovel', 1);
        }
        return { offMiddle: offsets.map(o => Number(o.toFixed(2))) };
    } },
    { name: 'wait and stay: stand still', async run() {
        const before = bot.entity.position.clone();
        assert.ok(await withinTime(skills.wait(bot, 300), 5000, 'wait'), said());
        assert.ok(await withinTime(skills.stay(bot, 1), 5000, 'stay'), said());
        assert.ok(bot.entity.position.distanceTo(before) < 0.5, 'the bot moved');
    } },
    { name: 'moveAway: walk off', async run() {
        const before = bot.entity.position.clone();
        assert.ok(await withinTime(skills.moveAway(bot, 6), 30000, 'moveAway'), said());
        const went = bot.entity.position.distanceTo(before);
        assert.ok(went >= 5, `went ${went.toFixed(1)} blocks; ${said()}`);
    } },
    { name: 'pickupNearbyItems: pick up what lies around', async run() {
        await give('cobblestone', 3);
        assert.ok(await withinTime(skills.discard(bot, 'cobblestone', 3), 15000, 'discard'), said());
        await delay(2500); // something thrown can't be picked up for its first two seconds
        assert.ok(await withinTime(skills.pickupNearbyItems(bot), 20000, 'pickupNearbyItems'), said());
        assert.equal(count('cobblestone'), 3, `the bot holds ${count('cobblestone')} of the 3 it threw; ${said()}`);
    } },
    { name: 'clearNearestFurnace: empty a furnace', async run() {
        await setblock(3, 0, -2, 'furnace');
        await cmd(`replaceitem block ${xyz(at(3, 0, -2))} slot.container 0 raw_iron 3`);
        assert.ok(await withinTime(skills.clearNearestFurnace(bot), 30000, 'clearNearestFurnace'), said());
        await delay(500);
        assert.equal(count('raw_iron'), 3, `the bot holds ${count('raw_iron')} of the 3 that were in it; ${said()}`);
    } },
    { name: 'activateNearestBlock: open a gate', async run() {
        await setblock(3, 0, 1, 'birch_fence_gate');
        const before = bot.blockAt(at(3, 0, 1));
        assert.equal(before?.name, 'birch_fence_gate');
        assert.ok(await withinTime(skills.activateNearestBlock(bot, 'birch_fence_gate'), 20000, 'activateNearestBlock'), said());
        await delay(600);
        assert.notEqual(bot.blockAt(at(3, 0, 1))?.stateId, before.stateId, `the gate is as it was; ${said()}`);
    } },
    { name: 'goToNearestEntity: walk up to an animal', async run() {
        await cmd(`summon cow ${xyz(at(6, 0, 5))}`, 1500);
        try {
            assert.ok(await withinTime(skills.goToNearestEntity(bot, 'cow', 2), 40000, 'goToNearestEntity'), said());
            const apart = nearest('cow')?.position.distanceTo(bot.entity.position);
            assert.ok(apart < 5, `ended ${apart?.toFixed(1)} blocks from the cow; ${said()}`);
        } finally {
            await putDown('cow');
        }
    } },
    { name: 'useToolOn: shear a sheep', async run() {
        await give('shears', 1);
        // A plain summon makes a lamb one time in twenty, and a lamb can't be sheared. Bedrock's sheep has an
        // event that makes an adult, and only an adult; it also leaves out the step that picks a color.
        await cmd(`summon sheep ${xyz(at(4, 0, 3))} 0 0 spawn_adult`, 1500);
        try {
            assert.ok(await withinTime(skills.useToolOn(bot, 'shears', 'sheep'), 40000, 'useToolOn'), said());
            await delay(1500);
            const wool = Object.values(bot.entities).some(entity => entity.name === 'item' && /wool/.test(entity.item?.name ?? ''));
            // What the bot saw, for when it fails: whether the sheep was sheared at all, and what lies about.
            const sheared = nearest('sheep')?.metadata?.flags?.sheared;
            const lying = Object.values(bot.entities).filter(entity => entity.name === 'item').map(entity => entity.item?.name ?? '?');
            // Wool of any color counts, carried or lying about: a sheep that came out gray gives gray wool,
            // and the bot often picks it up at once.
            const carried = bot.inventory.items().some(item => /wool/.test(item.name));
            assert.ok(wool || carried,
                `no wool came off the sheep (sheared: ${sheared}; lying about: ${lying.join(', ') || 'nothing'}); ${said()}`);
        } finally {
            await putDown('sheep');
        }
    } },
    { name: 'useToolOn: fill a bucket with water', async run() {
        await give('bucket', 1);
        await setblock(3, -1, 2, 'water');
        assert.ok(await withinTime(skills.useToolOn(bot, 'bucket', 'water'), 40000, 'useToolOn'), said());
        await delay(800);
        assert.equal(count('water_bucket'), 1, said());
    } },
    { name: 'goToSurface: get on top of what is overhead', async run() {
        // One block over the bot's head. The surface there is its top, and the way up is a pillar of the
        // bot's own blocks, which the pathfinder builds.
        await give('dirt', 8);
        await setblock(0, 2, 0, 'cobblestone');
        assert.ok(await withinTime(skills.goToSurface(bot), 40000, 'goToSurface'), said());
        assert.ok(bot.entity.position.y >= at(0, 3, 0).y - 0.1, `the bot is ${(bot.entity.position.y - origin.y).toFixed(1)} blocks up, and the top is 3 up; ${said()}`);
    } },
    { name: 'defendSelf: fight off a zombie', async run() {
        // The test world is peaceful, so monsters are let in for this scene only. Going back to peaceful
        // also takes away any that came by themselves in the meantime.
        await give('iron_sword', 1);
        await cmd('time set midnight');
        await cmd('difficulty normal');
        try {
            await cmd(`summon zombie ${xyz(at(4, 0, 3))} 0 0 minecraft:as_adult`, 1500);
            assert.ok(await withinTime(skills.defendSelf(bot, 12), 60000, 'defendSelf'), said());
            await delay(800);
            assert.ok(!nearest('zombie') || nearest('zombie').position.distanceTo(bot.entity.position) > 12, 'the zombie is still there');
        } finally {
            await cmd('difficulty peaceful', 1200);
        }
    } },
    { name: 'eating by itself: a hungry bot eats what it holds', async run() {
        // Not a skill: the agent switches this on when it starts, and from then on nobody calls it. Hunger
        // only falls outside peaceful, and falls fast under the hunger effect.
        await give('bread', 3);
        bot.autoEat.setOpts({ minHunger: 14 });
        bot.autoEat.enableAuto();
        await cmd('difficulty normal');
        try {
            await cmd(`effect ${NAME} hunger 30 255`);
            const deadline = Date.now() + 40000;
            while (Date.now() < deadline && count('bread') === 3) await delay(500);
            assert.ok(count('bread') < 3, `the bot is at ${bot.food} of 20 hunger and still holds all its bread`);
        } finally {
            bot.autoEat.disableAuto();
            await cmd(`effect ${NAME} clear`);
            await cmd('difficulty peaceful', 1200);
        }
    } },

    { name: 'villagers: jobs in !entities, a child refused, trades shown', async run() {
        const { working, child, job } = await villagersInPits();
        const listed = getCommand('!entities').perform({ name: NAME, bot });
        const shown = `${job[0].toUpperCase()}${job.slice(1)} L1`;
        assert.ok(listed.includes(`(${working.id}:${shown})`), `the ${job} is not listed as one: ${listed}`);
        assert.ok(listed.includes(`Baby IDs: ${child.id} `), `the child is not listed as one: ${listed}`);
        assert.ok(!listed.includes('villager_v2'), `listed under Bedrock's own name: ${listed}`);
        assert.equal(await withinTime(skills.showVillagerTrades(bot, child.id), 20000, 'showVillagerTrades on a child'), false);
        assert.match(bot.output, /baby villager/, said());
        bot.output = '';
        assert.ok(await withinTime(skills.showVillagerTrades(bot, working.id), 40000, 'showVillagerTrades'), said());
        assert.match(bot.output, /Villager has \d+ available trades:\n1: \(0\/\d+\) /, said());
    } },
    { name: 'tradeWithVillager: pay for a trade and get its goods', async run() {
        const { working } = await villagersInPits();
        assert.ok(await withinTime(skills.showVillagerTrades(bot, working.id), 40000, 'showVillagerTrades'), said());
        const first = bot.trades[0];
        await give(first.inputItem1.name, first.inputItem1.count);
        if (first.inputItem2) await give(first.inputItem2.name, first.inputItem2.count);
        const before = count(first.outputItem.name);
        bot.output = '';
        assert.ok(await withinTime(skills.tradeWithVillager(bot, working.id, 1, 1), 40000, 'tradeWithVillager'), said());
        await delay(800);
        assert.equal(count(first.outputItem.name), before + first.outputItem.count, said());
    } },

    // The scenes with a second player come last. Joining makes the second bot the one the game data is read
    // from (there is one bot to a process when the agent runs), which is harmless here and would not be
    // for a crafting scene after it.
    { name: 'goToPlayer: walk up to another player', async run() {
        const player = await friendAt(6, 0, -6);
        await withinTime(skills.goToPlayer(bot, FRIEND, 3), 40000, 'goToPlayer');
        const apart = player.position.distanceTo(bot.entity.position);
        assert.ok(apart < 4.5, `ended ${apart.toFixed(1)} blocks from the player; ${said()}`);
    } },
    { name: 'giveToPlayer: hand items to another player', async run() {
        await friendAt(5, 0, 4);
        await cmd(`clear ${FRIEND}`);
        await give('cobblestone', 2);
        assert.ok(await withinTime(skills.giveToPlayer(bot, 'cobblestone', FRIEND, 2), 60000, 'giveToPlayer'), said());
        await delay(500);
        const got = friend.inventory.items().filter(item => item.name === 'cobblestone').reduce((sum, item) => sum + item.count, 0);
        assert.equal(got, 2, `the other player holds ${got} of the 2; ${said()}`);
        assert.equal(count('cobblestone'), 0, said());
    } },
    { name: 'followPlayer: keep up with another player', async run() {
        const player = await friendAt(4, 0, 0);
        const following = skills.followPlayer(bot, FRIEND, 3);
        try {
            await delay(1500);
            await cmd(`tp ${FRIEND} ${xyz(at(-7, 0, 6))}`, 900);
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline && player.position.distanceTo(bot.entity.position) > 5) await delay(300);
            const apart = player.position.distanceTo(bot.entity.position);
            assert.ok(apart <= 5, `the player went 12 blocks off and the bot is still ${apart.toFixed(1)} blocks behind; ${said()}`);
        } finally {
            // The skill follows until it is told to stop, as the agent would tell it.
            bot.interrupt_code = true;
            await withinTime(following, 5000, 'stopping followPlayer').catch(() => {});
            bot.pathfinder.stop();
        }
    } },
];

// Known not to work on Bedrock yet, by the start of each scene's name. Keep in step with docs/bedrock.md.
const GAPS = new Map([]);

let joined = false;
try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server), fair_play: 'off', world_memory: false, chest_sorting: false });
    ({ initBot, villagerOf } = await import('../../src/utils/mcdata.js'));
    skills = await import('../../src/agent/library/skills.js');
    ({ getCommand } = await import('../../src/agent/commands/index.js'));

    await report.step('the bot joins and spawns', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500);
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        // What the agent gives a bot before any skill runs.
        bot.modes = { pause() {}, unpause() {}, isOn: () => false };
        bot.output = '';
        return { version: bot.version };
    });
    joined = true;
    origin = bot.entity.position.floored();
    // Animals and monsters that turn up by themselves would walk into the scenes. The ones a scene needs
    // are summoned. This is left off afterwards: the server is a throwaway.
    await cmd('gamerule domobspawning false');

    for (const scene of walk) {
        if (only && !only.some(word => scene.name.startsWith(word))) continue;
        await reset();
        const gap = [...GAPS].find(([start]) => scene.name.startsWith(start));
        if (gap) await report.knownGap(scene.name, scene.run);
        else await report.attempt(scene.name, scene.run);
    }
    console.log(JSON.stringify(report.summary()));
    if (report.failed()) process.exitCode = 1;
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, passedSteps: report.passed() }));
    process.exitCode = 1;
} finally {
    try {
        if (joined) await reset();
    } catch (error) {
        console.error('Could not tidy the test area:', error.message);
    }
    bot?.quit?.();
    friend?.quit?.();
    // The Bedrock client keeps timers alive after it closes; nothing here is left to wait for.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
}
