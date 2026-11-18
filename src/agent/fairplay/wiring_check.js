// SPDX-License-Identifier: CC0-1.0
// A check, run when the bot spawns, that fair play is really in the way of what the bot is told.
//
// The fair query provider answers raw for a bot it doesn't know (fair_queries.js), on purpose: tests and
// other bots in the same process keep stock behavior. The cost is that a wiring mistake fails open. If
// the provider were never installed in world.js, or the bot never registered with it, everything would
// still work, and the bot would quietly see through walls. Nothing else would notice.
//
// So the check asks a question only a cheating bot could answer: it picks a block buried in the ground
// under the bot, one the bot can't see, touch or remember, and asks world.js, the way every command and
// skill does, what is there. Under fair play the answer must be "unknown", and a search for that kind
// of block right around it must come back empty. Anything else means the wiring is broken.

// Where to look for a buried block: in the column under the feet and a few beside it, from just below
// the cells the bot touches down to the bottom of the world. The bot may be standing on a platform or a
// tree far above the ground, and a few thousand table lookups cost well under a millisecond.
const FIRST_DEPTH = 3;
const SIDES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2], [-2, -2], [2, -2], [-2, 2]];
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot
 * @param {object} options.perception - the bot's perception (perception.js)
 * @param {object} options.world - world.js, or a stand-in with getBlockAtPosition
 * @param {object} options.queries - the provider world.js asks (world_queries.js `worldQueries()`)
 * @returns {{status: 'ok'|'broken'|'skipped', reason: string}}
 */
export function checkFairWiring({ bot, perception, world, queries }) {
    const feet = bot.entity?.position?.floored?.();
    if (!feet) return { status: 'skipped', reason: 'the bot has no position yet' };
    const buried = findBuried(bot, perception, feet);
    if (!buried) return { status: 'skipped', reason: 'no buried block was found under the bot to test with' };

    const { block, dx, dy, dz } = buried;
    const where = `${block.position.x}, ${block.position.y}, ${block.position.z}`;
    const told = world.getBlockAtPosition(bot, dx, dy, dz)?.name;
    if (told !== 'unknown')
        return { status: 'broken', reason: `world.js named the buried ${block.name} at ${where} (${told}), which the bot can't see` };
    const found = queries.findBlocks(bot, { matching: block.type, point: block.position, maxDistance: 1, count: 1 }) ?? [];
    if (found.some(p => p.x === block.position.x && p.y === block.position.y && p.z === block.position.z))
        return { status: 'broken', reason: `a block search found the buried ${block.name} at ${where}, which the bot can't see` };
    return { status: 'ok', reason: `the buried ${block.name} at ${where} is unknown to the bot, as it should be` };
}

// A block whose six neighbours all hide it, that perception says the bot doesn't know. Reads the raw
// world, which only this check and perception may do: it is the answer key, not something to decide by.
function findBuried(bot, perception, feet) {
    const hides = (x, y, z) => perception.sight.blocksSight(x, y, z);
    const minY = bot.game?.minY ?? -64;
    for (let depth = FIRST_DEPTH; feet.y - depth > minY; depth++) {
        for (const [sx, sz] of SIDES) {
            const x = feet.x + sx, y = feet.y - depth, z = feet.z + sz;
            if (!hides(x, y, z) || !NEIGHBOURS.every(([nx, ny, nz]) => hides(x + nx, y + ny, z + nz))) continue;
            const position = feet.offset(sx, -depth, sz);
            const block = bot.blockAt(position);
            if (!block || perception.knowsCell(position)) continue;
            // getBlockAtPosition offsets from the bot's exact position, so the offset is taken from there.
            const at = bot.entity.position;
            return { block, dx: position.x + 0.5 - at.x, dy: position.y + 0.5 - at.y, dz: position.z + 0.5 - at.z };
        }
    }
    return null;
}
