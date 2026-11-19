// SPDX-License-Identifier: CC0-1.0
// Danger zones: places where the bot met danger, remembered for a while, that routes bend around.
//
// The reflexes deal with a danger while it is in front of the bot. A player also remembers where it
// was: pillagers by that tower, a skeleton in that ravine, something that exploded over there. They walk
// round those places for a while instead of straight back in. Each zone here is one such memory: a kind,
// a middle, a size, a price, and when it is forgotten. The danger watch (danger_watch.js) notes them from
// what the bot saw and heard, and the route search pays their price (src/agent/library/place_costs.js),
// rising toward the middle, so a route goes round when going round is cheap enough, and a bot inside one
// walks out for free.
//
// Pure: no game, no timers. Tested with plain objects and a clock.
//
// The kinds, and what each is sized to:
//   illagers     pillagers, vindicators, evokers, ravagers seen. They patrol, and an outpost or a raid has
//                many, so the zone is wide and lasts the longest.
//   archer       a mob seen aiming at the bot. A skeleton shoots from about 15 blocks; the zone is the spot
//                it stood, wide enough to keep out of its range while the bot passes.
//   explosion    an explosion heard. Whatever blew up (a creeper, a creeper's friends) is gone or nearby;
//                a small zone, since hearing gives the place only roughly.
//   unseen_hits  where the bot stood when something it couldn't see kept hitting it.
// A zone that turns out wider than the bot thought costs a detour; one narrower costs a hit. So when the
// place is known only roughly (a sound's distance band), the zone grows by how far off it may be.

export const ZONE_KINDS = Object.freeze({
    illagers: { radius: 32, height: 16, lifeMs: 20 * 60_000, price: 64 },
    archer: { radius: 12, height: 8, lifeMs: 5 * 60_000, price: 24 },
    explosion: { radius: 8, height: 6, lifeMs: 5 * 60_000, price: 16 },
    unseen_hits: { radius: 6, height: 4, lifeMs: 5 * 60_000, price: 12 },
});

/**
 * @param {object} [options]
 * @param {() => number} [options.now] - clock in ms
 * @param {number} [options.max] - zones kept at most; past it, the one that would be forgotten soonest goes
 * @param {object} [options.kinds] - the kinds, as ZONE_KINDS
 * @returns {object} the zones: note, priceAt, list, clear
 */
export function createDangerZones({ now = Date.now, max = 32, kinds = ZONE_KINDS } = {}) {
    const zones = [];
    let nextId = 1;

    function forgetOld(t = now()) {
        for (let i = zones.length - 1; i >= 0; i--) if (zones[i].until <= t) zones.splice(i, 1);
    }

    return {
        /**
         * Notes danger at a place. Danger of the same kind near the middle of a zone already kept is that
         * zone again: it is remembered for longer, not kept twice.
         * @param {string} kind - one of the kinds
         * @param {{x: number, y: number, z: number}} position - where the danger was
         * @param {object} [options]
         * @param {number} [options.slack] - how far off the position may be: the zone grows by that much
         * @returns {{zone: object, isNew: boolean}|null} null for a kind there is none of
         */
        note(kind, position, { slack = 0 } = {}) {
            const size = kinds[kind];
            if (!size || !position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
            const t = now();
            forgetOld(t);
            const same = zones.find(zone => zone.kind === kind
                && Math.hypot(zone.x - position.x, zone.z - position.z) <= zone.radius / 2
                && Math.abs(zone.y - position.y) <= zone.height);
            if (same) {
                same.until = t + size.lifeMs;
                same.lastAt = t;
                return { zone: { ...same }, isNew: false };
            }
            const zone = { id: nextId++, kind, x: position.x, y: position.y, z: position.z,
                radius: size.radius + slack, height: size.height + slack, price: size.price,
                since: t, lastAt: t, until: t + size.lifeMs };
            zones.push(zone);
            if (zones.length > max) {
                let soonest = 0;
                for (let i = 1; i < zones.length; i++) if (zones[i].until < zones[soonest].until) soonest = i;
                zones.splice(soonest, 1);
            }
            return { zone: { ...zone }, isNew: true };
        },

        /**
         * What a cell costs to be in: for each zone it is in, the zone's price at its middle, falling
         * evenly to nothing at its edge. Asked for every step of every route search, so it is kept simple.
         * Zones are round seen from above and reach `height` up and down from their middle.
         */
        priceAt(x, y, z) {
            if (zones.length === 0) return 0;
            const t = now();
            let price = 0;
            for (const zone of zones) {
                if (zone.until <= t || Math.abs(y - zone.y) > zone.height) continue;
                const d = Math.hypot(x + 0.5 - zone.x, z + 0.5 - zone.z);
                if (d < zone.radius) price += zone.price * (1 - d / zone.radius);
            }
            return price;
        },

        /** The zones kept now, oldest first, as copies. */
        list() {
            forgetOld();
            return zones.map(zone => ({ ...zone }));
        },

        /** Forgets every zone: another dimension has other places at the same coordinates. */
        clear() { zones.length = 0; },
    };
}
