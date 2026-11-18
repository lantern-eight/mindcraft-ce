// SPDX-License-Identifier: CC0-1.0
// A small world of named cells, and a provider for world.js that knows only some of them.
//
// For tests of skills that read the world through world.js (look_first.js, stairs_down.js). The raw bot
// knows every cell, the provider only the ones the test says the bot perceives, the way fair play's
// perception does. So a test can tell when a skill reads past what the bot perceives: its words or its
// choices would name a block it couldn't know.
import Vec3 from 'vec3';
import pf from 'mineflayer-pathfinder';
import rootSettings from '../../settings.js';
import { setSettings } from '../../src/agent/settings.js';
import { setWorldQueries } from '../../src/agent/library/world_queries.js';
import { GAME_VERSION } from './game_version.js';

export const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
// Blocks with no collision box: the body passes through them, and they can't be stood on.
export const EMPTY = new Set(['air', 'cave_air', 'water', 'lava', 'torch', 'short_grass']);

/**
 * A world of named cells, everything else air, and a provider that answers only for cells in `known`
 * (a Set of keys, or 'all'). Cells in `remembered` come back marked as memory. `faces` lists the sides
 * in view, as "x,y,z|dx,dy,dz"; with no list, every side is. Call `setWorldQueries(null)` after the test.
 */
export function namedCells({ cells = {}, known = 'all', remembered = new Set(), faces = null, at = new Vec3(0.5, 64, 0.5) } = {}) {
    const names = new Map(Object.entries(cells));
    const blockAt = pos => {
        const name = names.get(key(pos)) ?? 'air';
        return { name, position: new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)), boundingBox: EMPTY.has(name) ? 'empty' : 'block' };
    };
    const bot = {
        output: '', interrupt_code: false,
        entity: { position: at.clone(), yaw: 0 },
        game: { gameMode: 'survival', minY: -64, height: 384 },
        modes: { isOn: () => false },
        blockAt, // the raw world: the bot was sent all of it
        lookAt: async () => {},
    };
    const knows = pos => known === 'all' || known.has(key(pos));
    setWorldQueries({
        blockAt: (_bot, pos) => {
            if (!knows(pos)) return null;
            const block = blockAt(pos);
            return remembered.has(key(pos)) ? { ...block, rememberedAt: 1 } : block;
        },
        seesFace: (_bot, pos, face) => !faces || faces.has(`${key(pos)}|${face.x},${face.y},${face.z}`),
    });
    return { bot, names, knows, known };
}

/**
 * The pathfinder's Movements need a real bot and its game data. The skills under test only build them and
 * hand them to a pathfinder stand-in, so a plain object does. Returns a function that puts the real one back.
 */
export function plainMovements() {
    const real = pf.Movements;
    pf.Movements = function () { return { blocksCantBreak: new Set() }; };
    return () => { pf.Movements = real; };
}

/** A pathfinder stand-in that finds every path and arrives nowhere new. Returns the goals it was given. */
export function walker(bot) {
    const goals = [];
    bot.pathfinder = {
        setMovements() {},
        *getPathFromTo() { yield { result: { status: 'success' } }; },
        goto: async goal => { goals.push(goal); },
    };
    return goals;
}

/**
 * Loads the game data mcdata.js keeps, which goToGoal names a few blocks from. It loads when a bot logs in;
 * a bot pointed at a closed port never connects, and telling it that it logged in loads the data all the same.
 */
export async function loadGameData() {
    setSettings({ ...rootSettings, host: '127.0.0.1', port: 1, minecraft_version: GAME_VERSION, minecraft_edition: 'java', auth: 'offline' });
    const mc = await import('../../src/utils/mcdata.js');
    const bot = mc.initBot('GameData');
    bot.on('error', () => {});
    bot.emit('login');
    bot.end();
}
