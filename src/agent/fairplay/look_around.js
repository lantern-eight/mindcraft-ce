// SPDX-License-Identifier: CC0-1.0
// Looking around: which ways the bot has looked lately, and turning to the ones it hasn't.
//
// Through a player's screen the bot sees one side at a time. A player who wants to know what is about turns
// round, and so does the bot: before giving up a search, when the model asks (!lookAround), and while it
// stands idle. Each turn is an ordinary look, so it is paced like any other (turn_speed.js), the enderman
// gaze guard has every step, and perception and world memory see what each step faces.
//
// The circle is kept as eight headings (north, north-east, ...). A heading counts as looked at when the
// screen faced it, from about where the bot stands now, within the last little while. Turning to the ones
// left over covers the circle in three or four looks. Seeing all around, there is nothing to turn for.

const HEADINGS = 8;
const STEP = 2 * Math.PI / HEADINGS;
const NEAR = 4;            // blocks: a look from farther away than this saw other ground
const FRESH_MS = 15_000;   // a heading looked at this recently need not be looked at again
const PITCH = -0.35;       // about 20 degrees down: the ground near the bot and the land beyond both on screen
const HOLD_MS = 250;       // each look is held this long, so world memory has time to look as well
const memories = new WeakMap(); // bot -> what it has looked at

const headingOf = yaw => ((Math.round(yaw / STEP) % HEADINGS) + HEADINGS) % HEADINGS;
const yawOf = heading => heading * STEP;
const angleBetween = (a, b) => ((b - a) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

/**
 * What the bot has looked at, per heading: when, and from where. Kept up by watching the bot's facing each
 * game tick, so every look counts, whoever made it.
 * @param {object} bot
 * @param {object} [options]
 * @param {() => object|null} [options.getScreen] - the screen it sees through (perception's screenNow), null all around
 * @param {() => number} [options.now]
 */
export function watchLooks(bot, { getScreen = () => null, now = Date.now } = {}) {
    let memory = memories.get(bot);
    if (memory) { memory.getScreen = getScreen; return memory; }
    const seenAt = new Array(HEADINGS).fill(-Infinity);
    const seenFrom = new Array(HEADINGS).fill(null);
    memory = {
        getScreen,
        /** Notes the headings the screen covers now. */
        note() {
            const screen = memory.getScreen();
            const entity = bot.entity;
            if (!screen || !entity?.position || !Number.isFinite(entity.yaw)) return;
            const halfWidth = (screen.widthDegrees / 2) * Math.PI / 180;
            const t = now(), from = { x: entity.position.x, z: entity.position.z };
            for (let h = 0; h < HEADINGS; h++) {
                if (Math.abs(angleBetween(entity.yaw, yawOf(h))) <= halfWidth) { seenAt[h] = t; seenFrom[h] = from; }
            }
        },
        /** The headings not looked at lately from about here, nearest turn first. Empty seeing all around. */
        unseen({ freshMs = FRESH_MS, since = -Infinity } = {}) {
            const entity = bot.entity;
            if (!memory.getScreen() || !entity?.position) return [];
            memory.note();
            const t = now(), here = entity.position;
            const stale = [];
            for (let h = 0; h < HEADINGS; h++) {
                const from = seenFrom[h];
                const fresh = t - seenAt[h] <= freshMs && seenAt[h] >= since && from && Math.hypot(from.x - here.x, from.z - here.z) <= NEAR;
                if (!fresh) stale.push(h);
            }
            return stale.sort((a, b) => Math.abs(angleBetween(entity.yaw, yawOf(a))) - Math.abs(angleBetween(entity.yaw, yawOf(b))));
        },
        /** When a heading was last looked at, from anywhere: the idle look-around turns to the stalest. */
        lastSeen: heading => seenAt[heading],
        stop() { bot.off?.('physicsTick', memory.note); memories.delete(bot); },
    };
    bot.on?.('physicsTick', memory.note);
    memories.set(bot, memory);
    return memory;
}

/** The look memory of a bot, if it has one. */
export const looksOf = bot => memories.get(bot) ?? null;

/**
 * Turns the bot through the headings it hasn't looked at lately from about here, a look at a time, holding
 * each long enough for world memory to look. Does nothing seeing all around, or when every way is fresh.
 * @param {object} bot
 * @param {object} [options]
 * @param {number} [options.freshMs] - a heading looked at more recently than this is skipped
 * @param {number} [options.since] - and only if looked at since this time: the start of a look round asked for
 * @param {number} [options.holdMs] - how long each look is held
 * @param {() => boolean} [options.stop] - true to stop part way (an interrupted action)
 * @returns {Promise<number>} how many looks it took
 */
export async function lookAround(bot, { freshMs = FRESH_MS, since = -Infinity, holdMs = HOLD_MS, stop = () => Boolean(bot.interrupt_code) } = {}) {
    const memory = looksOf(bot);
    if (!memory) return 0;
    let looks = 0;
    for (let stale = memory.unseen({ freshMs, since }); stale.length && looks < HEADINGS; stale = memory.unseen({ freshMs, since })) {
        if (stop()) break;
        // The farthest stale heading within one turn of the screen's width would leave a gap; the nearest one
        // turned to brings its neighbours on screen with it.
        await bot.look(yawOf(stale[0]), PITCH);
        memory.note();
        looks++;
        await new Promise(resolve => setTimeout(resolve, holdMs));
    }
    return looks;
}

// A find this close needs no look round first: nothing unseen can be nearer than the cells about the feet.
const NEAR_ENOUGH = 3;

/**
 * Before a search decides (library/search_look.js): looks around when the bot hasn't looked every way from
 * about here lately, and the search found nothing, or only something farther than a step or two. World
 * memory answers for what the bot saw before, nearest first, so a tree it passed a minute ago already wins
 * without a turn; what memory can't know is a way the bot never looked.
 * @returns {Promise<boolean>} whether it looked around
 */
export async function lookBeforeSearching(bot, nearest) {
    const memory = looksOf(bot);
    if (!memory?.unseen().length) return false;
    const here = bot.entity?.position;
    if (nearest && here && Math.hypot(nearest.x + 0.5 - here.x, nearest.y + 0.5 - here.y, nearest.z + 0.5 - here.z) <= NEAR_ENOUGH) return false;
    return (await lookAround(bot)) > 0;
}

/**
 * The model's !lookAround, as an action: turns round, and says how many looks it took.
 * @returns {Promise<string>}
 */
export async function lookAroundCommand(bot) {
    if (!looksOf(bot)?.getScreen()) return 'You see all around you already.';
    // Every way afresh, whatever was looked at before: the model asked.
    const looks = await lookAround(bot, { since: Date.now() });
    return looks ? `Looked around (${looks} looks). What you saw is in !entities, !nearbyBlocks and your memory.` : 'You have just looked every way.';
}

/** The heading looked at least lately: where an idle look goes next. */
export function stalestHeading(bot) {
    const memory = looksOf(bot);
    if (!memory) return null;
    let best = 0;
    for (let h = 1; h < HEADINGS; h++) if (memory.lastSeen(h) < memory.lastSeen(best)) best = h;
    return { heading: best, yaw: yawOf(best) };
}

export { headingOf, yawOf };
