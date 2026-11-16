// SPDX-License-Identifier: CC0-1.0
// Live villager scenarios against a real server (no model calls, free to run).
//   node tests/live/villager_scenarios.js [--port=55931]
// Needs Node 22, Java 25 and a server jar: set MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//
// The unit tests check how a villager's job, level and age are read from metadata shaped by hand. These
// check that the shapes are the ones a real server sends (the job's entry has already moved once between
// versions), and that Mindcraft's trading skills work end to end on them: `!entities` names each job,
// a child is refused, the trades are shown, and a trade is made.
//
// The server console summons the villagers, standing still so they stay in reach, and gives the bot
// what the first trade asks for. Afterwards the bot's inventory is read to see the trade went through.
import assert from 'node:assert/strict';
import mineflayer from 'mineflayer';
import { vanillaFixture, delay, waitFor } from './vanilla_fixture.js';
import { GAME_VERSION } from '../helpers/game_version.js';
import * as skills from '../../src/agent/library/skills.js';
import * as mc from '../../src/utils/mcdata.js';
import { getCommand } from '../../src/agent/commands/index.js';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 55931);
const NAME = 'Trader';
const fixture = await vanillaFixture(port);
let bot;
let passed = 0;
const step = async (title, run) => {
    await run();
    passed++;
    console.log(`ok - ${title}`);
};

try {
    await fixture.command('forceload add -16 -16 16 16'); await delay(800);
    await fixture.command('fill -8 69 -8 8 69 8 stone');
    await fixture.command('fill -8 70 -8 8 75 8 air');
    await fixture.command('setworldspawn 0 70 0');
    bot = mineflayer.createBot({ host: '127.0.0.1', port, username: NAME, version: GAME_VERSION, auth: 'offline' });
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); });
    bot.output = '';
    await fixture.command(`tp ${NAME} 0.5 70 0.5`);
    await fixture.command('summon minecraft:villager 2.5 70 0.5 {NoAI:1b,VillagerData:{profession:"minecraft:librarian",level:3,type:"minecraft:plains"}}');
    await fixture.command('summon minecraft:villager -2.5 70 0.5 {NoAI:1b,Age:-24000}');
    await fixture.command('summon minecraft:villager 0.5 70 2.5 {NoAI:1b,VillagerData:{profession:"minecraft:mason",level:1,type:"minecraft:desert"}}');
    const villagers = () => Object.values(bot.entities).filter(entity => mc.villagerOf(entity));
    await waitFor(() => villagers().filter(entity => mc.villagerOf(entity).baby || mc.villagerOf(entity).profession).length >= 3,
        15000, () => JSON.stringify(villagers().map(entity => mc.villagerOf(entity))));
    const find = test => villagers().find(entity => test(mc.villagerOf(entity)));
    const librarian = find(v => v.profession === 'librarian');
    const child = find(v => v.baby);

    await step('each villager\'s job, level and age are read from what the server sends', async () => {
        assert.deepEqual(mc.villagerOf(librarian), { baby: false, profession: 'librarian', level: 3 });
        assert.deepEqual(mc.villagerOf(find(v => v.profession === 'mason')), { baby: false, profession: 'mason', level: 1 });
        assert.equal(mc.villagerOf(child).baby, true);
    });

    await step('!entities names each grown villager\'s job and lists the child apart', async () => {
        const text = getCommand('!entities').perform({ name: NAME, bot });
        assert.match(text, /3 villager\(s\)/);
        assert.match(text, new RegExp(`\\(${librarian.id}:Librarian L3\\)`));
        assert.match(text, /Mason L1/);
        assert.match(text, new RegExp(`Baby IDs: ${child.id} \\(babies cannot trade\\)`));
    });

    await step('a child is not traded with', async () => {
        bot.output = '';
        assert.equal(await skills.showVillagerTrades(bot, child.id), false);
        assert.match(bot.output, /baby villager/);
    });

    await step('a grown villager\'s trades are shown', async () => {
        bot.output = '';
        assert.equal(await skills.showVillagerTrades(bot, librarian.id), true, bot.output);
        assert.match(bot.output, /Villager has \d+ available trades:\n1: \(0\/\d+\) /);
    });

    await step('a trade is made, and its goods arrive', async () => {
        const window = await bot.openVillager(librarian);
        const first = window.trades[0];
        window.close();
        await delay(500);
        await fixture.command(`give ${NAME} ${first.inputItem1.name} ${first.inputItem1.count}`);
        if (first.inputItem2) await fixture.command(`give ${NAME} ${first.inputItem2.name} ${first.inputItem2.count}`);
        await waitFor(() => bot.inventory.count(bot.registry.itemsByName[first.inputItem1.name].id) >= first.inputItem1.count, 5000);
        bot.output = '';
        assert.equal(await skills.tradeWithVillager(bot, librarian.id, 1, 1), true, bot.output);
        await waitFor(() => bot.inventory.count(bot.registry.itemsByName[first.outputItem.name].id) >= first.outputItem.count, 5000,
            () => bot.inventory.items().map(item => `${item.count} ${item.name}`).join(', '));
    });

    console.log(`\n${passed} of 5 villager scenarios passed`);
} catch (err) {
    console.error(`\nFAILED after ${passed} passed:`, err);
    process.exitCode = 1;
} finally {
    bot?.quit();
    await fixture.stop();
}
process.exit(process.exitCode ?? 0);
