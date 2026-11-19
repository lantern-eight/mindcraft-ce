// SPDX-License-Identifier: CC0-1.0
// One owner per threat. The reflex that takes a mob keeps it for a few seconds, so two reflexes don't take
// turns with it: the fight starts on a zombie, a second one turns up, the mob reflex retreats, the fight
// starts again... each turn stopping the other's action and walking the bot back and forth.
//
// The owner is a mode's name. An urgent stance doesn't ask (fleeing at low health, taking cover from a mob
// aiming at the bot); the rest wait until the claim runs out. Pure: time comes from `now`.

export const CLAIM_MS = 5000;

/** @param {{now?: () => number}} [options] */
export function createClaims({ now = Date.now } = {}) {
    const claims = new Map(); // key -> { owner, until }
    return {
        /** Takes a threat for `owner`, for `ms` from now. */
        claim(key, owner, ms = CLAIM_MS) { claims.set(key, { owner, until: now() + ms }); },
        /** Which mode has the threat now, or null. */
        ownerOf(key) {
            const claim = claims.get(key);
            if (!claim) return null;
            if (now() >= claim.until) { claims.delete(key); return null; }
            return claim.owner;
        },
        clear() { claims.clear(); },
    };
}
