// SPDX-License-Identifier: CC0-1.0
// Handing an item to a player: walk up to them, throw it to them, and see them take it.
//
// Mindcraft's own `giveToPlayer` (skills.js) stops three blocks away and throws at the player's feet. On Java
// that carries far enough; on Bedrock a thrown item flies less far, and aimed down at the feet it landed a
// block from the bot and two from the player, and the bot picked it back up itself. A player handing
// something over steps close and throws it at the other player, about chest high, so it lands at their feet.
// That is what this does, for !bringItem. `!givePlayer` keeps Mindcraft's own.
//
// Finding the player goes through `world.getPlayerEntity`, which fair play limits to a player the bot knows
// is there; the walk goes through `goToPlayer`, which fair legs plan. A bot that has just fetched the thing
// from a chest faces the chest, with its back to whoever asked, so a player out of view is looked round for
// first (fair play's look round, a look at a time, stopping once they are seen), as a player turns back.
import * as world from '../library/world.js';
import { goToPlayer } from '../library/skills.js';
import { lookAround } from '../fairplay/look_around.js';

/** How close it walks before it throws: near enough that the throw lands at their feet. */
export const HAND_OVER_DISTANCE = 2;
/** Turns the bot every way afresh, a look at a time, until `found` says to stop. Nothing to do seeing all around. */
const lookRoundFor = (bot, found) => lookAround(bot, { since: Date.now(), stop: found });

/** How long the player has to take it. A thrown item can't be picked up for two seconds. */
const TAKE_MS = 4000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const countOf = (bot, name) => (bot.inventory?.items?.() ?? []).filter(item => item.name === name).reduce((n, item) => n + item.count, 0);

/**
 * Throws `count` of an item to a player and waits for them to take it.
 * @param {object} bot
 * @param {string} name - the item
 * @param {string} player - who gets it
 * @param {number} count
 * @param {object} [options]
 * @param {(bot: object, name: string, distance: number) => Promise<*>} [options.walk] - stands in for goToPlayer in tests
 * @param {(bot: object, found: () => boolean) => Promise<*>} [options.lookFor] - looks round until `found`; stands
 *     in for fair play's look round in tests
 * @param {() => boolean} [options.stopped] - whether the action was stopped
 * @param {number} [options.takeMs] - how long the player has to take it
 * @returns {Promise<{thrown: number, taken: boolean, problem?: string}>}
 */
export async function handOver(bot, name, player, count, { walk = goToPlayer, lookFor = lookRoundFor, stopped = () => Boolean(bot.interrupt_code), takeMs = TAKE_MS } = {}) {
    const known = () => Boolean(world.getPlayerEntity(bot, player));
    if (!known()) await lookFor(bot, () => stopped() || known());
    if (!known()) return { thrown: 0, taken: false, problem: `you don't know where ${player} is: they need to be near and in view` };
    await walk(bot, player, HAND_OVER_DISTANCE);
    const target = world.getPlayerEntity(bot, player);
    if (!target) return { thrown: 0, taken: false, problem: `${player} went out of sight` };

    let taken = false;
    const onCollect = collector => { if (collector?.username === player) taken = true; };
    bot.on('playerCollect', onCollect);
    try {
        // About chest high: the throw goes out level and comes down at their feet.
        await bot.lookAt(target.position.offset(0, 1.1, 0), true);
        const before = countOf(bot, name);
        let left = count;
        while (left > 0) {
            const stack = bot.inventory.items().find(item => item.name === name);
            if (!stack) break;
            const n = Math.min(left, stack.count);
            await bot.toss(stack.type, null, n);
            left -= n;
        }
        const thrown = Math.max(0, before - countOf(bot, name));
        if (!thrown) return { thrown, taken: false, problem: 'the throw did not leave your inventory' };
        for (const until = Date.now() + takeMs; !taken && !stopped() && Date.now() < until;) await delay(200);
        return { thrown, taken };
    } finally {
        bot.off?.('playerCollect', onCollect);
    }
}
