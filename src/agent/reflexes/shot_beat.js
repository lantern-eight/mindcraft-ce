// SPDX-License-Identifier: CC0-1.0
// The beat of an archer's shots, for a game that shows no bow drawn.
//
//   createShotBeat()     heard shots, matched to the archer seen where each came from
//   beat.hear(...)       a sound heard (fair play's hearing): a shot is noted against its archer
//   beat.due(id, ms)     whether that archer's next shot is due now, given how often it shoots
//
// A Bedrock skeleton shows nothing between taking its target and loosing each arrow: no bow drawn, so no
// tell to raise a shield for (isDrawing at the edition seam). But it shoots on a fixed beat, a shot every 3 s,
// and each shot twangs. A player who hears it learns the beat and raises the shield as the next one is due.
// This is that: each shot heard is matched to the archer seen on that side, and a short while either side of
// one beat on from it, that archer counts as about to shoot. The shield then goes up as for a bow drawn on
// Java (shield.js), and stays up until the arrow lands. The mob reflex keeps the beat as it backs out of an
// archer's range with no cover near; the fight doesn't (fight_reflex.js says why).
//
// What it goes by is what a player has. The sound comes from fair play's hearing, which gives only what it is
// (a skeleton shooting), a direction and a rough distance, never where; the archer is one the bot sees on that
// side. Without fair play there is no hearing, and no beat. How often each kind shoots is the edition's answer
// (shotBeatMs); on Java there is none, since the bow drawn is there to see. Pure: time comes from `now`.
import { describeDirection } from '../fairplay/perception.js';

export const EARLY_MS = 400;    // up this long before a shot is due: a shield blocks a moment after it goes up
export const LATE_MS = 300;     // and this long after, for a shot a little late (its sound ends the wait)
const BEATS_KEPT = 3;           // an archer silent for this many beats has stopped shooting: forgotten
const BANDS = ['very close', 'close', 'near', 'far'];

/** @param {{now?: () => number}} [options] */
export function createShotBeat({ now = Date.now } = {}) {
    const shots = new Map(); // archer's id -> when its last shot was heard

    return {
        /**
         * A sound heard. A shot is noted against the archer it came from: one of its kind in view on the side it
         * was heard from, the nearest to the distance heard. Anything else is passed over.
         * @param {{subject: string, direction: string, distance: string}} sound - as fair play's hearing gives it
         * @param {object[]} mobs - from mobsAround (mobs.js): {id, name, position, seenNow}
         * @param {{x:number, y:number, z:number}} here - where the bot is
         * @returns {number|null} the archer it was matched to
         */
        hear(sound, mobs, here) {
            const shot = /^(.+) \(shooting\)$/.exec(sound?.subject ?? '');
            if (!shot) return null;
            const band = BANDS.indexOf(sound.distance);
            const archers = mobs
                .filter(mob => mob.seenNow && mob.name === shot[1])
                .map(mob => ({ mob, where: describeDirection(here, mob.position) }))
                .filter(({ where }) => where.direction === sound.direction)
                .sort((a, b) => Math.abs(BANDS.indexOf(a.where.distance) - band) - Math.abs(BANDS.indexOf(b.where.distance) - band));
            const archer = archers[0]?.mob;
            if (!archer) return null;
            shots.set(archer.id, now());
            return archer.id;
        },
        /**
         * Whether an archer's next shot is due now: within a moment of a whole number of beats since its last
         * shot heard (a shot not heard, from out of hearing, keeps the beat going), until it has been silent for
         * a few beats.
         * @param {number} id
         * @param {number|null} beatMs - how often it shoots (the edition's shotBeatMs), or null for no beat
         */
        due(id, beatMs) {
            const last = shots.get(id);
            if (last === undefined || !beatMs) return false;
            const since = now() - last;
            const beats = Math.max(1, Math.round(since / beatMs));
            if (beats > BEATS_KEPT) { shots.delete(id); return false; }
            const off = since - beats * beatMs;
            return off >= -EARLY_MS && off <= LATE_MS;
        },
        clear() { shots.clear(); },
    };
}
