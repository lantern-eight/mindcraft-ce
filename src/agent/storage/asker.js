// SPDX-License-Identifier: CC0-1.0
// Who is behind what the bot is doing right now: a player who asked, or the bot's own idea?
//
// Chest sorting needs to know, for two things. A chest that is neither the bot's own nor marked
// "always" is sorted only when a player asks, so the bot acting on its own idea must leave it alone.
// And a chest the bot places while doing what a player asked is most likely that player's, where one
// it places on its own idea is its own.
//
// The agent never says outright who a command is for, so this pieces it together from two places:
//   - Every message the agent handles comes in through `agent.handleMessage(source, ...)`, and a
//     message stays "being handled" until whatever it led to is done. This wraps that one method on
//     the agent it is given (no inherited file is edited) and keeps the list of who is being answered.
//   - With native tools on, a task can outlive the message that started it. The task keeps who it is
//     for (`agent.taskAgent.source`) for as long as it runs.
// A `source` of "system" or the bot's own name is the bot prompting itself.
//
// The answer errs one way on purpose. When a player is anywhere in the picture, the request counts as
// asked for: the bot must never refuse a player because of a guess. And when nothing can be told, the
// answer is "unknown", which the rest of chest sorting treats as allowed.

/**
 * Starts keeping track of who the agent is answering.
 * @param {object} agent - the agent; its `handleMessage` is wrapped when it has one
 * @returns {{behind: () => {asked: boolean|null, by: string|null}, stop: () => void}}
 *   `behind()` says who is behind what the bot is doing now: `asked` is true with the player's name
 *   in `by`, false when the bot is prompting itself, or null when that cannot be told
 */
export function requestWatcher(agent) {
    const answering = [];       // the messages being handled now, oldest first
    const isSelf = source => source === 'system' || source === agent.name;
    const isName = source => typeof source === 'string' && source.length > 0;

    const original = agent.handleMessage;
    if (typeof original === 'function') {
        agent.handleMessage = function (source, ...rest) {
            const entry = { source };
            answering.push(entry);
            const done = () => { const i = answering.indexOf(entry); if (i >= 0) answering.splice(i, 1); };
            let outcome;
            try { outcome = original.call(this, source, ...rest); }
            catch (error) { done(); throw error; }
            return Promise.resolve(outcome).finally(done);
        };
    }

    return {
        behind() {
            // A player being answered right now, the latest one first.
            const player = answering.findLast(entry => isName(entry.source) && !isSelf(entry.source));
            if (player) return { asked: true, by: player.source };
            // A task still running from an earlier message.
            const task = agent.taskAgent;
            if (task?.is_running && isName(task.source)) return isSelf(task.source) ? { asked: false, by: null } : { asked: true, by: task.source };
            // Only the bot's own prompting.
            if (answering.some(entry => isSelf(entry.source))) return { asked: false, by: null };
            return { asked: null, by: null };
        },
        /** Puts the agent's own `handleMessage` back. */
        stop() {
            if (typeof original === 'function') agent.handleMessage = original;
            answering.length = 0;
        },
    };
}
