// SPDX-License-Identifier: CC0-1.0
// Where attackEntity asks whether a mob is close enough to hit without walking to it first.
//
// attackEntity, told to land one hit (`kill` false), walks to the mob first only when it is more than five
// blocks away, the reach Mindcraft has always used. A module can install its own answer for a bot: fair
// play holds the bot to a survival player's reach, and a swing from four blocks away would be refused
// there, so it answers by that reach instead. With nothing installed, the answer is the stock one.
//
// The setter lives here rather than in skills.js on purpose: skills.js is handed to generated code, so
// a setter there would let that code change the answer.

const STOCK_REACH = 5;
const answers = new WeakMap(); // bot -> (entity) => boolean

/**
 * Installs the answer for one bot, or removes it with null.
 * @param {object} bot
 * @param {((entity: object) => boolean)|null} fn - true when the bot can hit the entity from where it stands
 */
export function setAttackReach(bot, fn) {
    if (fn) answers.set(bot, fn);
    else answers.delete(bot);
}

/** True when the bot can hit the entity from where it stands, so it needn't walk to it first. */
export function withinAttackReach(bot, entity) {
    const answer = answers.get(bot);
    if (answer) return answer(entity);
    return bot.entity.position.distanceTo(entity.position) <= STOCK_REACH;
}
