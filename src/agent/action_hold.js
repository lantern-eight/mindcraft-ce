// SPDX-License-Identifier: CC0-1.0
// A hold on starting actions, for a reflex that must not be stopped part way.
//
// Starting an action stops the one running (action_runtime.js), whoever asks: a reflex lower in the list, a
// command from the model, the self-prompter, or the action that was interrupted coming back. That is
// usually right. It is not while the bot is backing off from a lit creeper: a lower reflex's fight, or a
// command to walk back to a player, would stop the back-off and keep the bot in the blast.
//
// So a reflex that has to finish sets a hold **before** it starts its action, and lifts it a little after.
// While it holds:
//   - a reflex the hold doesn't let through is turned down at once, and isn't even run (modes.js asks before
//     each one). What it saw is stale by the time the hold ends, so it must look again rather than wait;
//   - anything else (a command, the self-prompter, a resumed action) waits for the hold to end, then starts.
//     If a hold begins while it is already in line to start, it is turned down with the reason instead.
// The hold always ends, by `release` or after `maxMs`, so a reflex that fails can't freeze the bot.
//
// It lives beside action_runtime.js, not in a reflex's own folder, because both action_runtime.js and
// modes.js ask it. Generated code isn't handed this module, so it can't set or lift a hold.
import { toolResult } from './tool_result.js';

const holds = new WeakMap(); // agent -> the hold in force, if any

const now = () => Date.now();
const inForce = hold => Boolean(hold) && now() < Math.min(hold.endsAt, hold.deadline);

/**
 * Holds every start the hold doesn't let through, until it is released.
 * @param {object} agent
 * @param {object} options
 * @param {(label: string) => boolean} options.lets - true for an action label that may still start (the
 *     holder's own, and anything more urgent than it)
 * @param {string} options.reason - said to whatever is held: "the bot is backing off from a creeper"
 * @param {number} [options.maxMs] - the longest it can last, whatever happens
 * @param {string} [options.kind] - what the hold is for, so its holder can tell it from another's
 * @returns {{release: (afterMs?: number) => void, reason: (text: string) => void}}
 */
export function holdActions(agent, { lets, reason, maxMs = 15000, kind = 'move' }) {
    const previous = holds.get(agent);
    const hold = { lets, reason, kind, endsAt: Infinity, deadline: now() + maxMs, waiters: previous?.waiters ?? new Set(), timer: null };
    clearTimeout(previous?.timer);
    holds.set(agent, hold);
    const wake = () => {
        if (holds.get(agent) !== hold || inForce(hold)) return;
        holds.delete(agent);
        for (const resolve of hold.waiters) resolve();
        hold.waiters.clear();
    };
    hold.timer = setTimeout(wake, maxMs);
    hold.timer.unref?.();
    return {
        /** Lifts the hold, now or `afterMs` from now. */
        release(afterMs = 0) {
            if (holds.get(agent) !== hold) return;
            hold.endsAt = Math.min(hold.deadline, now() + afterMs);
            clearTimeout(hold.timer);
            hold.timer = setTimeout(wake, Math.max(0, hold.endsAt - now()));
            hold.timer.unref?.();
        },
        /** Changes what is said to whatever is held. */
        reason(text) { hold.reason = text; },
    };
}

/** What the hold in force is for (its `kind`), or null when none is. */
export function holdKind(agent) {
    const hold = holds.get(agent);
    return inForce(hold) ? hold.kind : null;
}

/** Why an action with this label may not start now, or null when it may. */
export function heldFrom(agent, label) {
    const hold = holds.get(agent);
    if (!inForce(hold) || hold.lets(label)) return null;
    return hold.reason;
}

function heldResult(label, reason) {
    const reflex = label.startsWith('mode:');
    const text = `${label.replace(/^\w+:/, '')} was not started: ${reason}.` + (reflex ? '' : ' Try again in a moment.');
    // A reflex turned down counts as interrupted, so nobody is told about it; a command is not, so the
    // model reads why.
    return { ...toolResult('cancelled', text, 'held'), success: false, message: text, interrupted: reflex, timedout: false };
}

/**
 * Asked by runAction before a start gets in line. A reflex the hold doesn't let through is turned down; any
 * other start waits for the hold to end. Null means go ahead.
 */
export async function waitOutHold(agent, label) {
    while (true) {
        const reason = heldFrom(agent, label);
        if (!reason) return null;
        if (label.startsWith('mode:')) return heldResult(label, reason);
        const hold = holds.get(agent);
        await new Promise(resolve => {
            hold.waiters.add(resolve);
            // In case the hold ends without a wake-up (its time ran out between two checks).
            setTimeout(resolve, Math.max(10, Math.min(hold.endsAt, hold.deadline) - now()));
        });
    }
}

/**
 * Asked by runAction when a start reaches the front of the line, just before it would stop the action
 * running. A hold that began while it waited turns it down, whatever it is.
 */
export function refusedByHold(agent, label) {
    const reason = heldFrom(agent, label);
    return reason ? heldResult(label, reason) : null;
}
