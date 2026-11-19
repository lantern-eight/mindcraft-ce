// SPDX-License-Identifier: CC0-1.0
// Standing orders: what a player told the bot to do about a kind of mob, applied by the reflexes at once,
// without waiting for the model. "Don't run from zombies, fight them." Pure: no game, no files.
//
// An order names a mob (`zombie`), a group (`zombies`: zombie, husk, drowned and zombie villagers) or `all`
// (every hostile mob but creepers, which are named on their own), and says one of:
//   fight             fight it when it comes for the bot, however many there are and however strong it is
//   fight_when_armed  the same, while the bot carries a sword or an axe; unarmed, the bot's own judgment
//   flee              back away from it when it comes, to `distance` blocks
//   ignore            neither fight it nor move away from it
// The most exact one wins: a mob's own name, then its group, then `all`.
//
// Each order has a minimum health (6 to 20, half health unless told). Under it the order lapses and the bot
// goes by its own judgment again: a fight order at 8 health becomes a retreat, an ignored zombie that keeps
// hitting is dealt with. Under 6 the bot runs from everything whatever the orders say: no order reaches the
// low-health run.
//
// Creepers take `fight` (hit it and step back at the first meeting, armed well enough, Java only) and `flee`
// (leave it for good at once). `ignore` is refused: a lit creeper is always backed off from, and the way
// to stop that is to switch `creeper_safety` off.
//
// Where orders come from: the profile's `threat_rules` are the bottom layer (with built-in defaults when the
// profile says nothing), and what the model set by command goes on top and is kept per bot. A command can
// also clear an order the profile gave: `default` stands for "no order", and is kept as such.

export const STANCES = ['fight', 'fight_when_armed', 'flee', 'ignore'];
export const DEFAULT_MIN_HEALTH = 10;  // half health
export const FLOOR_HEALTH = 6;         // under this the low-health run takes over, whatever the orders
export const FLEE_DISTANCE = 16;
export const CREEPER_FLEE_DISTANCE = 22; // well past the 16 a creeper follows
const MAX_DISTANCE = 48;

// Groups the way a player names mobs. Both editions' names are listed: Bedrock calls an evoker
// `evocation_illager`, a zombified piglin `zombie_pigman`, and has a second zombie villager.
export const GROUPS = {
    zombies: ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_villager_v2'],
    skeletons: ['skeleton', 'stray', 'bogged'],
    spiders: ['spider', 'cave_spider'],
    creepers: ['creeper'],
    endermen: ['enderman'],
    illagers: ['pillager', 'vindicator', 'evoker', 'evocation_illager', 'illusioner', 'ravager'],
    witches: ['witch'],
    slimes: ['slime', 'magma_cube'],
    piglins: ['piglin', 'piglin_brute', 'zombified_piglin', 'zombie_pigman'],
    hoglins: ['hoglin', 'zoglin'],
    guardians: ['guardian', 'elder_guardian'],
    nether: ['blaze', 'ghast', 'wither_skeleton'],
};
export const ALL = 'all';

// The built-in orders when the profile has no `threat_rules`: an armed bot stands and fights the mobs that
// unarmed trials already showed it could beat one at a time. A profile with `"threat_rules": {}` has none.
export const BUILT_IN = {
    zombies: { stance: 'fight_when_armed' },
    spider: { stance: 'fight_when_armed' },
};

const groupOf = name => Object.keys(GROUPS).find(group => GROUPS[group].includes(name)) ?? null;
const isCreeper = target => target === 'creeper' || target === 'creepers';

/**
 * Checks one order and fills in what it left out.
 * @param {string} target - a mob, a group or `all`
 * @param {string|object} order - a stance, or {stance, min_health, distance}
 * @param {(name: string) => boolean} [isMob] - whether a name is a mob of this game
 * @returns {{ok: true, target: string, order: object}|{ok: false, error: string}}
 */
export function checkOrder(target, order, isMob = () => true) {
    target = String(target ?? '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
    const fields = typeof order === 'string' ? { stance: order } : { ...order };
    const stance = String(fields.stance ?? '').trim().toLowerCase();
    if (target !== ALL && !GROUPS[target] && !isMob(target)) {
        const near = GROUPS[`${target}s`] ? ` Did you mean "${target}s", the group?` : '';
        return { ok: false, error: `"${target}" is not a mob, a group or "all".${near}` };
    }
    if (!STANCES.includes(stance))
        return { ok: false, error: `"${fields.stance}" is not an order. Use one of: ${STANCES.join(', ')}, or default to clear it.` };
    if (isCreeper(target) && stance === 'ignore')
        return { ok: false, error: 'Creepers can\'t be ignored: a lit creeper is always backed off from. Turn the creeper_safety mode off to stop that.' };
    const minHealth = Number(fields.min_health ?? 0) || DEFAULT_MIN_HEALTH;
    if (minHealth < FLOOR_HEALTH || minHealth > 20)
        return { ok: false, error: `The minimum health must be from ${FLOOR_HEALTH} to 20 (under ${FLOOR_HEALTH} the bot always runs).` };
    const flee = stance === 'flee';
    const distance = flee ? (Number(fields.distance ?? 0) || (isCreeper(target) ? CREEPER_FLEE_DISTANCE : FLEE_DISTANCE)) : null;
    if (flee && (distance < 8 || distance > MAX_DISTANCE))
        return { ok: false, error: `The distance to back away to must be from 8 to ${MAX_DISTANCE} blocks.` };
    return { ok: true, target, order: { stance, min_health: minHealth, ...(flee ? { distance } : {}) } };
}

/**
 * The orders the bot goes by: the profile's, and what was set by command on top.
 * @param {object} [options]
 * @param {object|undefined} [options.profile] - the profile's `threat_rules`; undefined means the built-in ones
 * @param {object} [options.saved] - what was set by command: target -> order, or null for "no order"
 * @param {(saved: object) => void} [options.save] - keeps what was set by command
 * @param {(name: string) => boolean} [options.isMob]
 * @param {(text: string) => void} [options.warn] - for a profile order that doesn't check out
 */
export function createStandingOrders({ profile, saved = {}, save = () => {}, isMob = () => true, warn = () => {} } = {}) {
    const base = {};
    for (const [target, order] of Object.entries(profile === undefined || profile === null ? BUILT_IN : profile)) {
        const checked = checkOrder(target, order, isMob);
        if (checked.ok) base[checked.target] = checked.order;
        else warn(`threat_rules: ${checked.error}`);
    }
    const set = {};
    for (const [target, order] of Object.entries(saved ?? {})) {
        if (order === null) { set[target] = null; continue; }
        const checked = checkOrder(target, order, isMob);
        if (checked.ok) set[checked.target] = checked.order;
    }
    const effective = () => {
        const all = { ...base, ...set };
        for (const target of Object.keys(all)) if (all[target] === null) delete all[target];
        return all;
    };

    return {
        /**
         * Gives an order, or clears one with `default`.
         * @returns {{ok: boolean, text: string}}
         */
        give(target, stance, { min_health = 0, distance = 0 } = {}) {
            const clearing = String(stance ?? '').trim().toLowerCase() === 'default';
            // Clearing checks only the target: `fight` stands in for a stance any target takes.
            const checked = checkOrder(target, clearing ? 'fight' : { stance, min_health, distance }, isMob);
            if (!checked.ok) return { ok: false, text: checked.error };
            const key = checked.target;
            if (clearing) {
                const had = effective()[key];
                set[key] = null;
                save({ ...set });
                return { ok: true, text: had ? `Cleared the order about ${key}: the bot goes by its own judgment there.` : `There was no order about ${key}.` };
            }
            set[key] = checked.order;
            save({ ...set });
            return { ok: true, text: `From now on: ${describe(key, checked.order)}.` };
        },
        /** Every order in force, with where it came from: 'profile' or 'command'. */
        list() {
            return Object.entries(effective()).map(([target, order]) => ({ target, ...order, from: target in set ? 'command' : 'profile' }));
        },
        /**
         * The order that applies to one mob now, or null when the bot goes by its own judgment: none was
         * given, it waits for a weapon the bot hasn't got, or the bot's health is under its minimum.
         * @param {string} name - the mob's name as the game gives it
         * @param {{health: number, armed: boolean}} self
         * @returns {{stance: 'fight'|'flee'|'ignore', distance?: number, min_health: number, target: string}|null}
         */
        orderFor(name, self) {
            const all = effective();
            const target = name in all ? name : (groupOf(name) in all ? groupOf(name) : (name !== 'creeper' && ALL in all ? ALL : null));
            if (!target) return null;
            const order = all[target];
            if (self.health < Math.max(order.min_health, FLOOR_HEALTH)) return null;
            if (order.stance === 'fight_when_armed' && !self.armed) return null;
            const stance = order.stance === 'fight_when_armed' ? 'fight' : order.stance;
            return { ...order, stance, target };
        },
    };
}

const STANCE_TEXT = {
    fight: 'fight', fight_when_armed: 'fight, when armed,', flee: 'back away from', ignore: 'ignore',
};

/** "fight zombies (down to 10 health)": one order, as the model reads it. */
export function describe(target, order) {
    const who = target === ALL ? 'every hostile mob but creepers' : target.replace(/_/g, ' ');
    const how = order.stance === 'flee' ? ` to ${order.distance} blocks` : '';
    return `${STANCE_TEXT[order.stance]} ${who}${how} (down to ${order.min_health} health)`;
}
