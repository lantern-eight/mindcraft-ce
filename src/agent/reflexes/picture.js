// SPDX-License-Identifier: CC0-1.0
// The threat picture: what the bot knows about the creepers around it, from what it sees and hears.
//
// It is rebuilt a little at a time: each reflex round tells it which creepers are in view and whether
// each one's fuse is lit (a player sees a creeper swell and flash), and a sound handler tells it about a
// hiss or an explosion. It keeps one entry per creeper, and says for each where it is (or is thought to
// be), whether it counts as lit, and how far its fuse has burned.
//
// How the game behaves, which the estimates follow (Java Edition):
//   - A creeper lights its fuse when its target comes within 3 blocks. The fuse burns while the target
//     stays within 7 blocks and in its sight, and runs back down **one tick at a time** otherwise; it
//     doesn't reset at once. It explodes when it has burned 30 ticks (1.5 s).
//   - The hiss plays only when the fuse starts from nothing. A creeper that half went out and lit again
//     makes no new hiss, so a hiss is remembered until something settles it, not just for 1.5 s.
//
// A sound gives a direction and a rough distance, never coordinates (perception's hearing). Where an entry
// needs a position, to back away from, it is rebuilt from the direction and the middle of the distance
// band, measured from where the bot stood when it heard it. The sound may have been nearer than that, by
// up to the band's `slack`, so a back-off from it goes that much farther.
//
// Pure: no bot, no game. Time comes from `now`, positions are plain {x, y, z}.

export const FUSE_TICKS = 30;          // a creeper explodes after its fuse burns this long
export const FUSE_RANGE = 7;           // its fuse keeps burning while its target is this close
export const HEARD_MEMORY_MS = 10000;  // a hiss with nothing new is forgotten after this
const TICK_MS = 50;
const SIGHT_GRACE_MS = 500;            // a sighting this soon after a hiss may not show the fuse yet
const EXPLOSION_MEMORY_MS = 1500;
const BLEW_UP_WITHIN = 6;              // blocks between a lit creeper and a blast heard, for the blast to be it
const FROM_ITS_SIDE = Math.cos(Math.PI / 3); // a hit within 60 degrees of a creeper's side came from it
const VANISHED_MS = 250;              // a lit creeper missing this long from a spot in view went off
const DEATH_MEMORY_MS = 2000;          // a hiss from where a creeper died this lately is that creeper,
const DIED_WITHIN = 3;                 // and from this near where it fell
const SAME_CREEPER = 6;                // a creeper seen this close to where a hiss was placed is the one that hissed

// The middle of each of hearing's distance bands (perception.js describeDirection), and how much nearer
// than that the sound may really have been: a back-off from a heard creeper goes that much farther.
const BAND_MIDDLE = { 'very close': 2, close: 7, near: 15, far: 25 };
const BAND_SLACK = { 'very close': 2, close: 3, near: 5, far: 5 };
// Hearing's eight directions, in the order of their angle (0 is south, going through west).
const COMPASS = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clampFuse = ticks => Math.max(0, Math.min(FUSE_TICKS, ticks));

/** How much nearer than the middle of its distance band a sound may really have been. */
export const slackOfBand = band => BAND_SLACK[band] ?? 0;

/**
 * A point a sound came from, rebuilt from what hearing gives: its direction and distance band, from where
 * the bot stood. Never more exact than that.
 */
export function pointFromSound({ direction, distance }, from) {
    const r = BAND_MIDDLE[distance] ?? BAND_MIDDLE.close;
    if (direction === 'above' || direction === 'below' || direction === 'here') {
        const dy = direction === 'above' ? r : direction === 'below' ? -r : 0;
        return { x: from.x, y: from.y + dy, z: from.z };
    }
    const index = COMPASS.indexOf(direction);
    if (index < 0) return null;
    const angle = index * Math.PI / 4;
    const round = v => Math.round(v * 100) / 100 + 0; // no -0, no 4e-16 left over from the sine
    return { x: round(from.x - Math.sin(angle) * r), y: from.y, z: round(from.z + Math.cos(angle) * r) };
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now] - clock in ms
 */
export function createThreatPicture({ now = Date.now } = {}) {
    const tracks = new Map(); // key -> entry, see makeTrack
    const mergedInto = new Map(); // a heard entry's key -> the key of the creeper seen that it turned out to be
    const resolve = key => { while (mergedInto.has(key)) key = mergedInto.get(key); return key; };
    let explosion = null;     // { position, at }: the last explosion heard
    const deaths = [];        // { position, at }: creepers seen to die lately, oldest first

    const makeTrack = (key, fields) => ({
        key, id: null, position: null, slack: 0, source: 'seen', seenNow: false, lit: false, litByHiss: false,
        fuse: 0, updatedAt: now(), lastSeenAt: null, heardAt: null, encounters: 0, told: false, ...fields,
    });

    // Moves an entry's fuse estimate on to now: up a tick per tick while it is seen lit, or out of sight
    // within its range of the bot (cautious); down a tick per tick otherwise.
    function advance(track, self, t) {
        const ticks = (t - track.updatedAt) / TICK_MS;
        track.updatedAt = t;
        if (ticks <= 0) return;
        const close = track.position && dist(track.position, self.position) - track.slack <= FUSE_RANGE;
        const burning = track.seenNow ? track.lit : (track.lit || track.fuse > 0) && close;
        track.fuse = clampFuse(track.fuse + (burning ? ticks : -ticks));
    }

    return {
        /**
         * The creepers in view this round. Any creeper of the picture not listed is out of view now.
         * @param {{id: number, position: object, lit: boolean}[]} creepers
         * @param {{position: object}} self
         * @param {object} [options]
         * @param {(position: object) => boolean} [options.spotInView] - can the bot see this spot right now? Told
         *   by perception; without it, no creeper is taken to have gone off unheard
         */
        see(creepers, self, { spotInView } = {}) {
            const t = now();
            const inView = new Set();
            for (const creeper of creepers) {
                const key = `id:${creeper.id}`;
                inView.add(key);
                let track = tracks.get(key);
                if (!track) tracks.set(key, track = makeTrack(key, { id: creeper.id }));
                advance(track, self, t);
                track.position = { x: creeper.position.x, y: creeper.position.y, z: creeper.position.z };
                track.seenNow = true;
                track.lastSeenAt = t;
                // A hiss just heard from it counts until its fuse can show (hear, below).
                track.lit = Boolean(creeper.lit) || (track.heardAt !== null && t - track.heardAt < SIGHT_GRACE_MS);
                // A hiss placed near it was this creeper: what was heard settles into what is seen.
                for (const heard of tracks.values()) {
                    if (heard.source !== 'heard' || dist(heard.position, track.position) > SAME_CREEPER) continue;
                    if (!track.lit && t - heard.heardAt < SIGHT_GRACE_MS) { track.lit = true; continue; } // the fuse may not show yet
                    track.fuse = Math.max(track.fuse, heard.fuse); // the fuse burned while it was only heard
                    track.encounters = Math.max(track.encounters, heard.encounters);
                    track.told ||= heard.told;
                    tracks.delete(heard.key);
                    mergedInto.set(heard.key, key);
                }
            }
            for (const track of [...tracks.values()]) {
                if (track.source !== 'seen' || inView.has(track.key)) continue;
                advance(track, self, t);
                track.seenNow = false;
                // Last seen lit, and not there now where the bot can see it stood: it went off. A swelling
                // creeper stands still (the game stops its walking while the fuse burns), so it hasn't stepped
                // aside. A silent creeper's blast makes no sound (the game sends it with its sound turned off),
                // so only the eyes can tell; without this it stayed in the picture, still lit, and the bot got
                // away from it again when it next came near the spot. An unlit one is kept: it walked somewhere.
                if (track.lit && t - track.lastSeenAt >= VANISHED_MS && track.position && spotInView?.(track.position)) {
                    tracks.delete(track.key);
                    for (const [from, to] of mergedInto) if (to === track.key) mergedInto.delete(from);
                }
            }
        },

        /**
         * A sound hearing passed on: a hiss, an explosion. Takes only what hearing gives (subject,
         * direction, distance band), never a position.
         * @param {{subject: string, direction: string, distance: string}} sound
         * @param {{position: object}} self - where the bot is as it hears it
         */
        hear(sound, self) {
            const t = now();
            const position = pointFromSound(sound, self.position);
            if (!position) return;
            if (sound.subject === 'explosion') {
                explosion = { position, slack: BAND_SLACK[sound.distance] ?? 0, at: t };
                // A lit creeper the bot knows of near where the blast sounded is the one that went off: it is
                // gone. Without this a creeper that blew up out of view stayed in the picture, still lit, and
                // the bot went on getting away from it.
                for (const track of [...tracks.values()]) {
                    if (!(track.lit || track.fuse > 0) || !track.position) continue;
                    if (dist(track.position, position) - track.slack - explosion.slack > BLEW_UP_WITHIN) continue;
                    tracks.delete(track.key);
                    for (const [from, to] of mergedInto) if (to === track.key) mergedInto.delete(from);
                }
                return;
            }
            if (!/^creeper \(hissing\)$/.test(sound.subject)) return;
            // From where a creeper was just seen to die: that one, already gone.
            while (deaths.length && t - deaths[0].at > DEATH_MEMORY_MS) deaths.shift();
            const slack = BAND_SLACK[sound.distance] ?? 0;
            if (deaths.some(death => dist(death.position, position) - slack <= DIED_WITHIN)) return;
            // From near where a creeper the bot sees, or saw lately, is: that one lighting, not a new one.
            // Through a player's screen a creeper the bot steps back from is soon behind it, and its hiss
            // made a creeper of its own, which the bot then backed off from again. One in view may not show
            // its fuse yet (SIGHT_GRACE_MS): the hiss counts for it until it does.
            let same = null, nearest = Infinity;
            for (const track of tracks.values()) {
                if (track.source !== 'seen' || !track.position) continue;
                const d = dist(track.position, position) - slack - track.slack;
                if (d <= SAME_CREEPER && d < nearest) { same = track; nearest = d; }
            }
            if (same) {
                Object.assign(same, { lit: true, updatedAt: t, heardAt: t });
                return;
            }
            // One heard creeper per direction: a second hiss from there is the same one lighting again.
            const key = `heard:${sound.direction}`;
            mergedInto.delete(key); // a new hiss from there is a creeper of its own until seen
            const track = tracks.get(key) ?? makeTrack(key, { source: 'heard' });
            Object.assign(track, { position, slack: BAND_SLACK[sound.distance] ?? BAND_SLACK.close, lit: true, litByHiss: true, fuse: 0, updatedAt: t, heardAt: t });
            tracks.set(key, track);
        },

        /**
         * Every creeper the bot knows of, nearest first, with its estimates brought up to now. Entries that
         * are settled are dropped: a heard creeper whose fuse would have run down since, or that nothing
         * new has been heard of for a while.
         * @param {{position: object}} self
         */
        creepers(self) {
            const t = now();
            const out = [];
            for (const track of [...tracks.values()]) {
                if (track.source === 'heard') {
                    advance(track, self, t);
                    // Settled: it would have gone out by now (the bot got away and its fuse ran down), or
                    // nothing new for a long while.
                    // (Its spot may be nearer than rebuilt, by the band's slack.)
                    const ranDown = track.fuse === 0 && dist(track.position, self.position) - track.slack > FUSE_RANGE;
                    if (ranDown || t - track.heardAt > HEARD_MEMORY_MS) { tracks.delete(track.key); continue; }
                } else if (!track.seenNow) {
                    advance(track, self, t);
                    // A creeper out of view for long with its fuse down is left to sight to find again.
                    if (track.fuse === 0 && t - track.lastSeenAt > HEARD_MEMORY_MS) { tracks.delete(track.key); continue; }
                }
                out.push({
                    key: track.key, id: track.id, source: track.source, position: { ...track.position }, slack: track.slack,
                    seenNow: track.seenNow, unseenMs: track.lastSeenAt === null ? null : t - track.lastSeenAt,
                    lit: track.lit, fuse: track.fuse, encounters: track.encounters,
                    told: track.told, distance: dist(track.position, self.position),
                });
            }
            return out.sort((a, b) => a.distance - b.distance);
        },

        /**
         * A hit felt, from the side `direction` points to ({x, z}, a unit step toward it). A lit creeper out of
         * view, close, on that side, whose fuse has burned through by now, is what hit: its blast. It is
         * gone. A silent creeper's blast makes no sound, and one that went off behind the bot as it ran is
         * neither heard nor seen, only felt; without this it stayed in the picture, still lit.
         * @param {{x: number, z: number}} direction
         * @param {{position: object}} self
         */
        felt(direction, self) {
            const t = now();
            for (const track of [...tracks.values()]) {
                if (track.seenNow || !(track.lit || track.fuse > 0) || !track.position) continue;
                advance(track, self, t);
                if (track.fuse < FUSE_TICKS) continue;
                const dx = track.position.x - self.position.x, dz = track.position.z - self.position.z;
                const d = Math.hypot(dx, dz);
                if (d - track.slack > BLEW_UP_WITHIN) continue;
                if (d > 0.5 && (dx * direction.x + dz * direction.z) / d < FROM_ITS_SIDE) continue;
                tracks.delete(track.key);
                for (const [from, to] of mergedInto) if (to === track.key) mergedInto.delete(from);
            }
        },

        /**
         * A creeper seen to die: it is gone. Where it fell is kept a moment: the game may still play its hiss
         * there, and a hiss from that spot is the creeper the bot saw die, not a new one.
         * @param {number} id
         * @param {object} [position] - where it died
         */
        forget(id, position = null) {
            const key = `id:${id}`;
            tracks.delete(key);
            for (const [from, to] of mergedInto) if (to === key) mergedInto.delete(from);
            if (position) deaths.push({ position: { x: position.x, y: position.y, z: position.z }, at: now() });
        },

        /** An explosion heard within the last moment, as {position, distance}, or null. */
        explosion(self) {
            if (!explosion || now() - explosion.at > EXPLOSION_MEMORY_MS) return null;
            return { position: { ...explosion.position }, slack: explosion.slack, distance: dist(explosion.position, self.position) };
        },

        /**
         * The key an entry goes by now. A heard creeper that has since been seen goes by the seen one's key,
         * so a back-off that started on the hiss follows the creeper as it is seen.
         */
        resolve,

        /** Counts a back-off from this creeper: the next time it comes, it is following the bot. */
        noteBackOff(key) {
            const track = tracks.get(resolve(key));
            if (track) track.encounters++;
        },

        /** Marks the model as told about this creeper, so a chase sends one message, not one per round. */
        noteTold(key) {
            const track = tracks.get(resolve(key));
            if (track) track.told = true;
        },

        /** Forgets everything, as after a respawn. */
        clear() { tracks.clear(); mergedInto.clear(); explosion = null; },
    };
}
