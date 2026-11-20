// SPDX-License-Identifier: CC0-1.0
// Live smoke test for Bedrock Edition against a real Bedrock Dedicated Server (no model calls, free to run).
//   BEDROCK_TEST_HOST=... BEDROCK_TEST_PORT=... BEDROCK_TEST_CONSOLE="..." node tests/live/bedrock_smoke.js
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// The server should have a flat world, survival mode and offline mode. NEVER a world you care about.
//
// The unit tests check that the bot is started the right way. This checks what only a server can: that the
// bot gets in at all, and that the first things any skill leans on work there. It goes through the repo's
// own start-up (initBot), not a bare mineflayer bot, so the edition setting and its hooks are part of what
// is tested. Fair play is not involved: this is the layer under it.
//
// Steps that need items or blocks handed out use the server console, and are skipped when there is none.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Vec3 from 'vec3';
import pathfinderPlugin from 'mineflayer-pathfinder';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, createReport, delay, freshStart } from './bedrock_fixture.js';

const { Movements, goals } = pathfinderPlugin;
const NAME = 'BedrockSmoke';

const { step, skip, summary, passed } = createReport();

const server = bedrockTestServer();
let bot;
let origin; // the block the bot stands in when the test starts; everything is placed from here
const names = () => bot.inventory.items().map(item => `${item.name} x${item.count}`);
const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
const at = (dx, dy, dz) => origin.offset(dx, dy, dz);
const xyz = position => `${position.x} ${position.y} ${position.z}`;

// The work area, cleared before and after: a strip east of the bot, back to flat ground with air above it.
async function clearArea() {
    if (!server.hasConsole) return;
    await server.command(`fill ${xyz(at(-2, 0, -3))} ${xyz(at(14, 3, 3))} air`);
    await server.command(`fill ${xyz(at(-2, -1, -3))} ${xyz(at(14, -1, 3))} grass_block`);
    // Dirt under the grass, so the hole the bot digs has a floor. A test world can have a hollow under
    // its ground (a scene cleared from a platform built lower), and the drop then falls out of reach.
    await server.command(`fill ${xyz(at(-2, -4, -3))} ${xyz(at(14, -2, 3))} dirt`);
    await server.command(`clear ${NAME}`);
}

try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server) });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const mcdata = await import('../../src/utils/mcdata.js');

    await step('the bot joins and spawns', async () => {
        bot = initBot(NAME);
        bot.on('error', error => console.error('Bot error:', error.message));
        await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
        await delay(2500); // the chunks around the bot arrive after the spawn
        await freshStart(server, [bot]); // the world as a script expects it, whatever the last run left
        assert.equal(bot.registry.version.type, 'bedrock');
        assert.equal(bot.game.gameMode, 'survival', 'the test world should be in survival');
        return { version: bot.version, gameMode: bot.game.gameMode, dimension: bot.game.dimension };
    });

    origin = bot.entity.position.floored();
    await clearArea();
    await delay(800);

    await step('game data comes from the bot, with the numbers this server handed out', () => {
        // The rest of the code looks names up through mcdata. On Bedrock that has to be the bot's own
        // registry (see initBedrockBot); a copy loaded by version name could number things differently.
        assert.equal(mcdata.getItemId('stone'), bot.registry.itemsByName.stone.id);
        assert.equal(mcdata.getBlockId('stone'), bot.registry.blocksByName.stone.id);
        assert.equal(mcdata.makeItem('stone', 1).name, 'stone');
    });

    await step('the bot sees the blocks around it', () => {
        const ground = bot.blockAt(at(0, -1, 0));
        const feet = bot.blockAt(at(0, 0, 0));
        assert.ok(ground && ground.name !== 'air', `stands on ${ground?.name}`);
        assert.equal(feet?.name, 'air');
        // Shapes are what walking and sight are computed from; a block with none would be walked into.
        assert.ok(ground.shapes.length > 0, 'the ground has a shape');
        return { ground: ground.name };
    });

    await step('chat goes out and comes back', async () => {
        const heard = new Promise(resolve => bot.on('chat', (username, message) => { if (message.includes('smoke check')) resolve(username); }));
        bot.chat('smoke check');
        const from = await Promise.race([heard, delay(5000).then(() => { throw new Error('The chat line did not come back'); })]);
        return { from };
    });

    await step('the bot walks ten blocks, at a speed the server accepts', async () => {
        bot.pathfinder.setMovements(new Movements(bot));
        const from = bot.entity.position.clone();
        const started = Date.now();
        await bot.pathfinder.goto(new goals.GoalNear(origin.x + 10, origin.y, origin.z, 0));
        const seconds = (Date.now() - started) / 1000;
        const distance = bot.entity.position.distanceTo(from);
        const speed = distance / seconds;
        // A server that thinks the bot moved too fast pulls it back. Standing still afterwards shows it:
        // the position would jump. A jump of under half a block is something else and is expected: when
        // the pathfinder stops the bot it sets its speed to nothing at once, which a Bedrock server doesn't
        // do. The server lets the player slow down by its own reckoning, and up to a second later says
        // where it stopped, and the bot takes the server's word for it.
        const stopped = bot.entity.position.clone();
        await delay(1500);
        const pulledBack = bot.entity.position.distanceTo(stopped);
        const settled = bot.entity.position.distanceTo(from);
        assert.ok(settled > 9, `walked ${settled.toFixed(2)} blocks`);
        assert.ok(speed > 3 && speed < 7, `speed ${speed.toFixed(2)} blocks a second`);
        assert.ok(pulledBack < 0.6, `the server moved the bot ${pulledBack.toFixed(2)} blocks after it stopped`);
        return { blocks: Number(settled.toFixed(2)), blocksPerSecond: Number(speed.toFixed(2)), pulledBack: Number(pulledBack.toFixed(3)) };
    });

    let dug;
    await step('the bot digs a block by hand', async () => {
        const block = bot.blockAt(at(12, -1, 0));
        assert.ok(block && block.name !== 'air', `nothing to dig: ${block?.name}`);
        dug = block.name;
        await bot.dig(block);
        await delay(800);
        assert.equal(bot.blockAt(at(12, -1, 0))?.name, 'air');
        return { dug };
    });

    let carried;
    await step('the bot picks up what dropped', async () => {
        // The drop lands in the hole or beside it, and is picked up a moment after the bot touches it. So
        // the bot walks to wherever the drop is, as often as it takes, for a few seconds.
        const hole = at(12, -1, 0);
        const deadline = Date.now() + 10000;
        const lying = () => Object.values(bot.entities).find(entity => entity.name === 'item' && entity.position.distanceTo(hole) < 4);
        const where = position => (position ? `${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}` : 'nowhere to be seen');
        while (bot.inventory.items().length === 0 && Date.now() < deadline) {
            const target = lying()?.position.floored() ?? hole;
            await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 0)).catch(() => {});
            await delay(700);
        }
        assert.ok(bot.inventory.items().length > 0, `nothing was picked up: the bot is at ${where(bot.entity.position)}, the drop is ${where(lying()?.position)}, and the bot takes the hole to hold ${bot.blockAt(hole)?.name}`);
        carried = bot.inventory.items()[0].name;
        return { inventory: names() };
    });

    await step('the bot places a block', async () => {
        await bot.pathfinder.goto(new goals.GoalNear(origin.x + 10, origin.y, origin.z, 0));
        await bot.equip(bot.inventory.items().find(item => item.name === carried), 'hand');
        await bot.placeBlock(bot.blockAt(at(11, -1, 1)), new Vec3(0, 1, 0));
        await delay(800);
        assert.equal(bot.blockAt(at(11, 0, 1))?.name, carried);
        return { placed: carried };
    });

    if (!server.hasConsole) {
        skip('a block put back where the bot dug stays there', 'no server console');
        skip('the bot puts items in a chest and takes some back', 'no server console');
        skip('the bot crafts in its own grid', 'no server console');
        skip('the bot crafts with what it just crafted', 'no server console');
    } else {
        await step('a block put back where the bot dug stays there', async () => {
            // The server has to hear that the bot let go of the block it broke. One that still has the bot
            // down as breaking that spot breaks whatever turns up there next, and leaves its item lying in
            // the hole. The bot is still in reach of the hole here, which is when that happens.
            await server.command(`setblock ${xyz(at(12, -1, 0))} grass_block`, 1500);
            assert.equal(bot.blockAt(at(12, -1, 0))?.name, 'grass_block');
        });

        await step('the bot puts items in a chest and takes some back', async () => {
            // Written the way the skills use a chest on Java: the opened chest is an object with deposit,
            // withdraw and close on it. The adapter's own answer has another shape, which the Bedrock
            // module evens out (src/agent/bedrock/java_shapes.js).
            await server.command(`setblock ${xyz(at(9, 0, 2))} chest`);
            await server.command(`give ${NAME} cobblestone 8`, 900);
            const block = bot.blockAt(at(9, 0, 2));
            assert.equal(block?.name, 'chest');
            const cobblestone = bot.registry.itemsByName.cobblestone.id;
            const chest = await bot.openContainer(block);
            const inside = () => chest.containerItems().filter(item => item.name === 'cobblestone').reduce((sum, item) => sum + item.count, 0);
            await chest.deposit(cobblestone, null, 8);
            await delay(500);
            assert.equal(inside(), 8, 'all eight went in');
            assert.equal(count('cobblestone'), 0);
            await chest.withdraw(cobblestone, null, 3);
            await delay(500);
            assert.equal(inside(), 5, 'three came back out');
            // What came out has to be usable again. The server knows every stack by a number it hands out,
            // and refuses to move one whose number the bot has lost.
            await chest.deposit(cobblestone, null, 1);
            await delay(500);
            assert.equal(inside(), 6, 'and one of those went back in');
            assert.equal(count('cobblestone'), 2);
            chest.close();
            await delay(500);
            assert.equal(bot.currentWindow, null);
            return { inChest: 6, carried: 2 };
        });

        await step('the bot crafts in its own grid', async () => {
            await server.command(`give ${NAME} oak_log 2`, 900);
            const recipes = bot.recipesFor(bot.registry.itemsByName.oak_planks.id, null, 1, null);
            assert.ok(recipes.length > 0, 'no recipe for oak planks');
            await bot.craft(recipes[0], 1, null);
            await delay(800);
            assert.equal(count('oak_planks'), 4);
            return { inventory: names() };
        });

        await step('the bot crafts with what it just crafted', async () => {
            // Planks from the last step into a crafting table. Like the chest, this needs the bot to know
            // the number the server gave the stack it made.
            const recipes = bot.recipesFor(bot.registry.itemsByName.crafting_table.id, null, 1, null);
            assert.ok(recipes.length > 0, 'no recipe for a crafting table');
            await bot.craft(recipes[0], 1, null);
            await delay(800);
            assert.equal(count('crafting_table'), 1);
            assert.equal(count('oak_planks'), 0);
            return { inventory: names() };
        });
    }

    console.log(JSON.stringify(summary()));
} catch (error) {
    console.error(error);
    console.log(JSON.stringify({ status: 'failed', error: error.message, passedSteps: passed() }));
    process.exitCode = 1;
} finally {
    try {
        if (origin) await clearArea();
    } catch (error) {
        console.error('Could not tidy the test area:', error.message);
    }
    bot?.quit?.();
    // The Bedrock client keeps timers alive after it closes; nothing here is left to wait for.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
}
