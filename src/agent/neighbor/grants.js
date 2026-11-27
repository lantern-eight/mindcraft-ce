// SPDX-License-Identifier: CC0-1.0
// Grants: a player lets the bot break exact blocks that good-neighbor rules protect.
//
// The rules keep the bot off whatever someone built, and that includes the owner's own wishes: "take that
// plank out, it's in the way" was refused with no way round it. A grant is how a player says yes. It is kept
// as narrow as it can be:
//   - exact cells, a block or a small box of them, never "anything round here";
//   - each cell once: breaking it uses the grant up;
//   - for a while only (ten minutes), so a grant forgotten about doesn't stay open.
//
// Only a player can grant, by typing it in chat themselves: `!allowBreak x y z`, or two corners for a box.
// It is read here, from the player's own message, before any model sees it, and it is not a command the
// model has. So the model can never let the bot break someone's build on its own say-so, whatever a player
// asks it. (The shape is nengoxx's grant, one cell at a time, and luv2crawl's `allow_dig_once`.)

const TTL_MS = 10 * 60 * 1000;
const MAX_CELLS = 64;
const WORD = /^\s*!?allowBreak\b/i;

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * Reads a grant out of a player's message: `!allowBreak x y z` or `!allowBreak x1 y1 z1 x2 y2 z2`, with or
 * without brackets and commas.
 * @param {string} message
 * @returns {null|{error: string}|{min: {x,y,z}, max: {x,y,z}, count: number}} null when the message isn't a
 *   grant at all; `error` when it is one that can't be used, said back to the player
 */
export function parseGrant(message) {
    const text = String(message ?? '');
    if (!WORD.test(text)) return null;
    const numbers = (text.replace(WORD, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(n => Math.floor(Number(n)));
    if (numbers.length !== 3 && numbers.length !== 6) return { error: 'Say which block: !allowBreak x y z, or two corners for a box: !allowBreak x1 y1 z1 x2 y2 z2.' };
    const [x1, y1, z1, x2 = x1, y2 = y1, z2 = z1] = numbers;
    const min = { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) };
    const max = { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) };
    const count = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
    if (count > MAX_CELLS) return { error: `That is ${count} blocks. I take at most ${MAX_CELLS} at a time: give a smaller box.` };
    return { min, max, count };
}

/**
 * The grants a bot holds.
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.ttlMs] - how long a grant lasts unused
 */
export function createGrants({ now = Date.now, ttlMs = TTL_MS } = {}) {
    const cells = new Map(); // "x,y,z" -> { by, until }

    const live = (cellKey) => {
        const grant = cells.get(cellKey);
        if (!grant) return null;
        if (grant.until <= now()) { cells.delete(cellKey); return null; }
        return grant;
    };

    return {
        /**
         * Grants every cell of a box to the bot, once each.
         * @param {{min: {x,y,z}, max: {x,y,z}}} box - from parseGrant
         * @param {string} by - the player who granted it
         */
        grant({ min, max }, by) {
            const until = now() + ttlMs;
            for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++)
                cells.set(key(x, y, z), { by, until });
        },

        /** Who granted this cell, while the grant holds, or null. */
        grantedBy(x, y, z) { return live(key(x, y, z))?.by ?? null; },

        /** The cell was broken: its grant is used up. */
        use(x, y, z) { cells.delete(key(x, y, z)); },

        /** How many cells are granted now. */
        get size() {
            for (const cellKey of [...cells.keys()]) live(cellKey);
            return cells.size;
        },
    };
}

/**
 * Listens for grants in the chat. Wraps the agent's `handleMessage` (no inherited file is edited): a
 * player's own message that is a grant is taken here and answered, and never reaches the model. Messages
 * from the bot itself, from the system, or from another bot are passed on untouched: none of them can grant.
 * @param {object} agent
 * @param {object} options
 * @param {object} options.grants - from createGrants
 * @param {(name: string) => boolean} [options.isBot] - is this the name of another bot?
 * @param {(text: string) => void} [options.say] - how the bot answers
 * @returns {{stop: () => void}}
 */
export function grantListener(agent, { grants, isBot = () => false, say = text => agent.openChat?.(text) }) {
    const original = agent.handleMessage;
    if (typeof original !== 'function') return { stop() {} };
    const isPlayer = source => typeof source === 'string' && source && source !== 'system' && source !== agent.name && !isBot(source);
    agent.handleMessage = function (source, message, ...rest) {
        const asked = isPlayer(source) ? parseGrant(message) : null;
        if (asked) {
            try {
                if (asked.error) say(asked.error);
                else {
                    grants.grant(asked, source);
                    const { min, max, count } = asked;
                    const where = count === 1 ? `the block at ${min.x}, ${min.y}, ${min.z}`
                        : `the ${count} blocks from ${min.x}, ${min.y}, ${min.z} to ${max.x}, ${max.y}, ${max.z}`;
                    say(`Okay, ${source}: I may break ${where}, once each, in the next 10 minutes.`);
                }
            } catch (error) { console.warn('[good neighbor] a grant could not be taken:', error?.message ?? error); }
            return Promise.resolve(true);
        }
        return original.call(this, source, message, ...rest);
    };
    return { stop() { agent.handleMessage = original; } };
}
