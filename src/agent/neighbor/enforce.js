// SPDX-License-Identifier: CC0-1.0
// Where the protection rule is enforced: the pathfinder's "may I break this?" and the bot's own dig.
//
// Rules in code can't be talked out of in chat, so the rule sits under everything that breaks a block,
// not in the prompt:
//   - The pathfinder asks `Movements.safeToBreak(block)` about every block a route would dig through, and
//     Mindcraft's block collecting asks it about every block it might collect. This module replaces that
//     method on the class once, at run time, and for a guarded bot adds the protection rule after the
//     library's own answer. No file of the pathfinder or of Mindcraft-CE is edited; a bot that isn't
//     guarded gets the library's own answer. (The same arrangement as fair play's fair_legs.js; patching
//     the class rather than one Movements object is nengoxx's, and it reaches the Movements objects that
//     skills make for themselves.)
//   - `bot.dig` is wrapped, so a skill, generated code, or the pathfinder digging on a plan made before the
//     bot saw what it was digging, is refused with words the model can act on.
import pf from 'mineflayer-pathfinder';

const guarded = new WeakMap(); // bot -> protector
let patched = false;

function patchSafeToBreak() {
    if (patched) return;
    patched = true;
    const proto = pf.Movements.prototype;
    const librarySafeToBreak = proto.safeToBreak;
    proto.safeToBreak = function (block) {
        if (!librarySafeToBreak.call(this, block)) return false;
        const protector = guarded.get(this.bot);
        return !protector || !protector.refusal(block);
    };
}

/** The error a refused dig throws. `code` lets callers tell it from a dig that failed. */
export function refusalError(block, reason) {
    const p = block.position;
    const where = `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
    return Object.assign(new Error(`Breaking ${block.name} at ${where} refused: ${reason.text}. Leave other players' builds alone: ask them, or go another way.`),
        { code: 'good_neighbor', reason: reason.why });
}

/**
 * Puts one bot under the protection rule: route planning and block collecting leave protected blocks alone,
 * and digging one is refused.
 * @param {object} bot - the mineflayer bot
 * @param {{refusal: (block: object) => object|null}} protector - from protect.js
 * @returns {() => void} undoes it
 */
export function guardBot(bot, protector) {
    patchSafeToBreak();
    guarded.set(bot, protector);
    const dig = bot.dig;
    if (typeof dig === 'function') {
        bot.dig = async function (block, ...rest) {
            const reason = guarded.get(bot)?.refusal(block);
            if (reason) throw refusalError(block, reason);
            return dig.call(this, block, ...rest);
        };
    }
    return () => {
        guarded.delete(bot);
        if (typeof dig === 'function') bot.dig = dig;
    };
}

/** The protector guarding a bot, or null. */
export const protectorOf = bot => guarded.get(bot) ?? null;
