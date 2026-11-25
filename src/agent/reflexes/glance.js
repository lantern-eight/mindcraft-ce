// SPDX-License-Identifier: CC0-1.0
// The glance: turning toward what the bot heard or felt but can't see.
//
// Through a player's screen, what is behind the bot reaches it only as a sound or a hit, as it does a player.
// A player turns to look. So does the bot, for a moment (about a second), toward:
//   - a hit from something not in view (the side it came from, as the edition seam tells it);
//   - a hostile mob heard close by and not seen, or a shot heard ("skeleton (shooting)"), but never a
//     creeper's hiss: that is the creeper reflex's, which turns the bot to run;
//   - the way it ran from, as a back-off from a creeper or a mob ends: the threat is behind it then, and a
//     player who has just run looks back to see whether it follows.
// The turn is an ordinary look: paced (fairplay/turn_speed.js), kept off an enderman's eyes (gaze.js), and
// seen by perception and world memory. The idle look-around gives way while it lasts.
//
// Checked once, remembered. A miner hears zombies groan on the other side of the wall, looks once, sees
// rock, and stops looking. A glance at a sound that showed nothing leaves a note (what, which way, how far
// it sounded, where the bot stood), and the same sound from the same way doesn't turn the bot again while
// the note holds. It ends after a while, when the bot has moved on, when the sound comes closer or from
// elsewhere, and at once on a hit.
//
// A busy bot glances too, but not while it walks (the walk steers the head, and turning it would turn the
// walk) or while a reflex is moving it, except a hit's glance in a fight, and a sound waits for a dig in
// progress to finish. A hit or a shot
// doesn't wait. Only through a player's screen: seeing all around, there is nothing to turn for.
import { describeDirection } from '../fairplay/perception.js';
import * as world from '../library/world.js';

const HOLD_MS = 1000;            // how long a glance holds the head
const NOTE_MS = 90_000;          // how long "looked, saw nothing" is trusted
const NOTE_MOVED = 4;            // blocks: past this from where it looked, the wall may not be between them
const WAIT_MS = 3000;            // a sound waits this long for a break in the work, then is let go
const CLOSE = new Set(['very close', 'close']);
const IN_VIEW_WITHIN = 16;       // blocks: a hostile mob in view this near keeps the bot's eyes
const BANDS = ['very close', 'close', 'near', 'far'];
// The compass names hearing uses, as the yaw that faces them (mineflayer: 0 faces north, -z; west is +pi/2).
const YAW_OF = {
    north: 0, 'north-west': Math.PI / 4, west: Math.PI / 2, 'south-west': 3 * Math.PI / 4,
    south: Math.PI, 'south-east': -3 * Math.PI / 4, east: -Math.PI / 2, 'north-east': -Math.PI / 4,
};

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @returns {{hear: function, felt: function, ranFrom: function, tick: function, clear: function, notes: function}}
 */
export function createGlance({ now = Date.now } = {}) {
    const notes = [];      // { kind, direction, band, at, from: {x, z} }
    let pending = null;    // { yaw, at, urgent, note } waiting for a break in the work

    // Through a player's screen? Fair play's look memory knows (fairplay/look_around.js).
    const narrow = agent => Boolean(agent.fairPlay?.looks?.getScreen?.());

    function noted(kind, direction, band, here) {
        const t = now();
        for (let i = notes.length - 1; i >= 0; i--) {
            const n = notes[i];
            const stale = t - n.at > NOTE_MS || Math.hypot(here.x - n.from.x, here.z - n.from.z) > NOTE_MOVED;
            if (stale) { notes.splice(i, 1); continue; }
            // The same kind from the same way, no closer than it sounded then: already looked.
            if (n.kind === kind && n.direction === direction && BANDS.indexOf(band) >= BANDS.indexOf(n.band)) return true;
        }
        return false;
    }

    // Turns now if the bot can, else keeps it for the next break in the work.
    function ask(agent, glance) {
        if (!pending || glance.urgent || !pending.urgent) pending = { ...glance, at: now() };
        tick(agent);
    }

    /**
     * Does the waiting glance, when the work allows. Call it every round of the reflexes too: a dig ends, a
     * walk stops, and the glance can be made then.
     */
    function tick(agent) {
        if (!pending) return false;
        const bot = agent.bot;
        if (!bot?.entity?.position || !narrow(agent)) { pending = null; return false; }
        const t = now();
        if (t - pending.at > WAIT_MS) { pending = null; return false; }
        const label = agent.actions?.currentActionLabel ?? '';
        const walking = bot.pathfinder?.isMoving?.();
        // A hit from out of view turns the head in the middle of a fight too, which stands still for it (melee.js):
        // fighting one zombie, the bot was hit from behind by another for 15 s and never looked round.
        const reflexMoving = label.startsWith('mode:') && !pending.afterReflex && !(pending.hit && label === 'mode:self_defense');
        if (walking || reflexMoving) return false;
        if (bot.targetDigBlock && !pending.urgent) return false; // a sound waits for the block to be dug
        // A hostile mob in view nearby has the bot's eyes: turning to a sound would turn it off the screen,
        // and the reflexes judge by what is in view. A sound waits; a hit or a shot doesn't.
        if (!pending.urgent && world.getNearbyEntities(bot, IN_VIEW_WITHIN).some(e => e.lastSeenAt === undefined
            && bot.registry?.entitiesByName?.[e.name]?.type === 'hostile')) return false;
        const glance = pending;
        pending = null;
        const looks = agent.fairPlay.looks;
        looks.holdUntil = t + HOLD_MS;
        bot.look(glance.yaw, -0.1, false).catch?.(() => {});
        if (glance.note) {
            // Looked once. If the mob is there, it is in view now and the reflexes have it; if not, the same
            // sound from the same way is no reason to look again.
            notes.push({ ...glance.note, at: t, from: { x: bot.entity.position.x, z: bot.entity.position.z } });
        }
        bot.emit?.('threat_reflex', { event: 'glance', at: performance.now(), why: glance.why, mode: 'glance' });
        return true;
    }

    /** A sound as fair play hears it (perception's onHeard): subject, direction, distance band, seen. */
    function hear(agent, sound) {
        if (!narrow(agent) || !sound || sound.seen) return;
        const yaw = YAW_OF[sound.direction];
        if (yaw === undefined) return; // above, below or here: no way to turn
        // A creeper's hiss is the creeper reflex's: it turns the bot to run, and a glance back at the creeper
        // would turn it round again.
        if (/ \(hissing\)$/.test(sound.subject)) return;
        const shot = / \(shooting\)$/.test(sound.subject);
        const kind = sound.subject.replace(/ \(.*$/, '');
        const hostile = agent.bot?.registry?.entitiesByName?.[kind]?.type === 'hostile';
        if (!shot && !(hostile && CLOSE.has(sound.distance))) return;
        const here = agent.bot.entity?.position;
        if (!here || noted(sound.subject, sound.direction, sound.distance, here)) return;
        ask(agent, { yaw, urgent: shot, why: `heard ${sound.subject} (${sound.direction})`,
            note: { kind: sound.subject, direction: sound.direction, band: sound.distance } });
    }

    /**
     * A hit felt from a side, as a flat direction toward where it came from, with nothing in view there to
     * have dealt it. Every note is dropped: something is there after all.
     */
    function felt(agent, direction) {
        notes.length = 0;
        if (!narrow(agent) || !direction) return;
        ask(agent, { yaw: Math.atan2(-direction.x, -direction.z), urgent: true, hit: true, why: 'felt a hit' });
    }

    /** A back-off has ended: a look back the way the bot came, toward what it ran from. */
    function ranFrom(agent, start) {
        const here = agent.bot?.entity?.position;
        if (!narrow(agent) || !here || !start) return;
        const dx = start.x - here.x, dz = start.z - here.z;
        if (Math.hypot(dx, dz) < 1) return;
        ask(agent, { yaw: Math.atan2(-dx, -dz), urgent: true, afterReflex: true, why: `looked back (${describeDirection(here, start).direction})` });
    }

    return {
        hear, felt, ranFrom, tick,
        clear() { notes.length = 0; pending = null; },
        /** The notes held now, for tests and live runs. */
        notes: () => notes.map(n => ({ ...n })),
    };
}
