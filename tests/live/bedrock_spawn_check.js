// SPDX-License-Identifier: CC0-1.0
// Shows what stands at the world spawn of the Bedrock test server, and with --clear takes it away, down to the
// flat world's own ground (no model calls, free to run).
//   node tests/live/bedrock_spawn_check.js [--clear]
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about: --clear empties a block of the world 65 wide, from the ground to the sky.
//
// Why it matters: a player joining for the first time is put above whatever stands at the world spawn, and the
// live scripts build their scenes where the bot then is, most of them 40 blocks above it. Whatever is left
// standing there (a scene from a run stopped part way, something built by hand) lifts every later spawn, and the
// scenes with it, until they run into the top of the world and several scripts fail at once while building.
//
// This prints, layer by layer, the blocks that are not air above the flat ground within 32 blocks of where the
// bot spawned. --clear fills that space with air from the console (it needs BEDROCK_TEST_CONSOLE). It only does
// so on a flat world like the one docs/bedrock.md describes, whose top layer is grass at y -61; on any other
// world it stops without changing anything.
import { once } from 'node:events';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { bedrockTestServer, bedrockTestSettings, delay } from './bedrock_fixture.js';

const NAME = 'SpawnCheck';
const REACH = 32;          // how far from the spawn to look and to clear; the widest scene reaches 20
const GROUND = -61;        // the top of a default flat world: grass over two dirt over bedrock at -64
const TOP = 319;           // the highest block of the overworld
const LAYERS_PER_FILL = 7; // 65 x 65 x 7 blocks stays under the 32768 one fill may change

const clear = process.argv.includes('--clear');
const server = bedrockTestServer();
if (clear && !server.hasConsole) throw new Error('--clear works through the server console: set BEDROCK_TEST_CONSOLE');

let bot;
try {
    setSettings({ ...rootSettings, ...bedrockTestSettings(server) });
    const { initBot } = await import('../../src/utils/mcdata.js');
    const { Vec3 } = await import('vec3');
    bot = initBot(NAME);
    bot.on('error', error => console.error('Bot error:', error.message));
    await Promise.race([once(bot, 'spawn'), delay(30000).then(() => { throw new Error('No spawn within 30 s'); })]);
    await delay(2500); // the chunks around the bot come in after the spawn

    const spawn = bot.entity.position.floored();
    const cx = spawn.x, cz = spawn.z;
    const area = (2 * REACH + 1) ** 2;

    /** Count the blocks of each name in one layer of the area, leaving out air and what hasn't arrived. */
    function layer(y) {
        const names = new Map();
        for (let x = cx - REACH; x <= cx + REACH; x++) {
            for (let z = cz - REACH; z <= cz + REACH; z++) {
                const name = bot.blockAt(new Vec3(x, y, z))?.name;
                if (name && name !== 'air') names.set(name, (names.get(name) ?? 0) + 1);
            }
        }
        return names;
    }

    /** Print every layer above the flat ground that holds anything; say how many there were. */
    function report() {
        let found = 0;
        for (let y = TOP; y > GROUND; y--) {
            const names = layer(y);
            if (!names.size) continue;
            found++;
            console.log(`  y ${y}: ${[...names].map(([name, count]) => `${name} ${count}`).join(', ')}`);
        }
        return found;
    }

    console.log(`A fresh player spawns at ${spawn.x}, ${spawn.y}, ${spawn.z}. On the flat world's own ground that is y ${GROUND + 1}.`);
    console.log(`Above the flat ground, within ${REACH} blocks of the spawn:`);
    const found = report();
    if (!found) console.log('  nothing.');

    if (!clear) {
        if (found) console.log('Run again with --clear to take it away (a throwaway world only).');
    } else if (found) {
        // Down to the ground, in the middle of the area: the server only changes chunks within its tick distance
        // (4 chunks by default) of a player, so a bot outside the area would leave its far corners as they were.
        await server.command(`tp ${NAME} ${cx + 0.5} ${GROUND + 1} ${cz + 0.5}`, 3000);
        const grass = layer(GROUND).get('grass_block') ?? 0;
        if (grass < area * 0.9) {
            throw new Error(`Not the flat world this expects: y ${GROUND} is grass in ${grass} of ${area} places. Nothing was changed.`);
        }
        for (let top = TOP; top > GROUND; top -= LAYERS_PER_FILL) {
            const bottom = Math.max(GROUND + 1, top - LAYERS_PER_FILL + 1);
            await server.command(`fill ${cx - REACH} ${bottom} ${cz - REACH} ${cx + REACH} ${top} ${cz + REACH} air`, 150);
        }
        await delay(2000);
        console.log('Cleared. What is left above the flat ground:');
        const left = report();
        if (!left) console.log('  nothing.');
        else process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    bot?.quit();
    setTimeout(() => process.exit(), 1000).unref();
}
