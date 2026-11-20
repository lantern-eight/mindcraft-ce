// SPDX-License-Identifier: CC0-1.0
// One owner of the use-item channel: the one button a player holds to raise a shield, eat, or draw a bow.
//
// A player can do only one of those at a time, and can't swing a sword while doing any of them. The bot's
// pieces don't know about each other: the eating plugin (mineflayer-auto-eat on Java, bedrock/eating.js on
// Bedrock) takes food in hand and starts using it whenever the bot is hungry, and drops whatever was in use
// to do so; the shield raises the off-hand whenever an arrow is coming. Left alone, a meal would drop the
// shield in the middle of a block, and the shield would cut a meal short. (asanrivas/mindcraft found the
// same with mineflayer-pvp and auto-eat: one owner at a time.)
//
// So whoever uses the channel takes it first, and gives it back when done; a taker that finds it held waits.
// Nobody takes it from another: the shield waits for a meal to end (under two seconds), and a meal waits
// for the shield to come down. Pure: no game, no timers.
//
//   createItemUse()          the channel, one per bot
//   shareEating(bot, use)    makes the bot's eating plugin take the channel for each meal

/** @returns {{take: (owner: string) => boolean, release: (owner: string) => void, owner: () => string|null}} */
export function createItemUse() {
    let holder = null;
    return {
        /** Takes the channel for `owner`. True when it is now theirs (or was already), false when another has it. */
        take(owner) {
            if (holder && holder !== owner) return false;
            holder = owner;
            return true;
        },
        /** Gives the channel back, if `owner` has it. */
        release(owner) { if (holder === owner) holder = null; },
        /** Who has the channel now, or null. */
        owner: () => holder,
    };
}

export const EATING = 'eating';

/**
 * Makes the bot's eating plugin take the channel for each meal, and pass up a meal while something else has
 * it. Both editions' plugins sit at `bot.autoEat` and start every meal through its `eat` (the Java plugin's
 * look at hunger calls `this.eat()`, Bedrock's calls `eat` on the object it handed out), so wrapping that one
 * call covers every meal they start. A meal passed up is no error: the plugin looks at hunger again in a tick
 * or a second, and eats once the channel is free.
 * The model's own `!consume` command runs as an action, and every use of the shield runs inside a reflex's
 * action too, so the two never overlap: starting one action stops the other.
 * @param {object} bot
 * @param {object} use - the channel (createItemUse)
 * @returns {boolean} whether there was a plugin to share with
 */
export function shareEating(bot, use) {
    const eater = bot.autoEat;
    if (!eater || typeof eater.eat !== 'function' || eater.eat.sharesItemUse) return Boolean(eater?.eat?.sharesItemUse);
    const eat = eater.eat;
    const shared = async function (...args) {
        if (!use.take(EATING)) return false;
        try {
            return await eat.apply(this, args);
        } finally {
            use.release(EATING);
        }
    };
    shared.sharesItemUse = true;
    eater.eat = shared;
    return true;
}
