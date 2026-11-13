// SPDX-License-Identifier: CC0-1.0
// Changes: turning "this is not how I remember it" into a short note for the model.
//
// A player who comes home and finds two chests missing and a new wall notices, and it changes what
// they do next. The bot gets the same: when it looks at a place again and what it sees differs from
// what it remembers, the differences are gathered up and reported once, in a sentence.
//
// What counts as a change (the recorder reports every difference; this file decides):
//   - a remembered block is now a different block, or gone            yes, from any viewpoint
//   - a block where the bot had seen empty space                      yes, it appeared
//   - a block where nothing was remembered, in a cube the bot had
//     already looked over from the very spot it stands on now         yes, it appeared
//   - the same, seen from somewhere new                               no: it is only newly seen
//   - a thing (chest, door...) not seen before, in a known place the
//     bot had looked over before                                      noted as "first seen"
// What is never reported, though memory is still updated:
//   - what the bot dug or placed itself
//   - anything that changed while the bot was watching (looked at under a minute ago)
//   - blocks that change by themselves: crops, leaves, grass, snow, fire, water, lava, falling sand
//
// Differences are grouped by place, or by neighbouring cubes outside one. Two seconds after the last
// difference in a group, the group becomes a note if it holds a thing or at least eight blocks; a
// smaller group is dropped as noise. A note is handed out once and kept in a short log. It states what
// was seen and carries no instruction.
import { changesByItself as defaultChangesByItself, kindOf as defaultKindOf } from './kinds.js';

const AIR = 'air';

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {(id: number) => string|null} [options.placeName] - the name of a place, when it has one
 * @param {number} [options.settleMs] - quiet time before a group of differences becomes a note
 * @param {number} [options.watchingMs] - a cube looked at more recently than this was being watched
 * @param {number} [options.minBlocks] - blocks a group needs to be worth a note, when it holds no thing
 * @param {number} [options.keep] - notes kept in the log
 */
export function createChanges({ now = Date.now, placeName = () => null, kindOf = defaultKindOf,
    changesByItself = defaultChangesByItself, settleMs = 2000, watchingMs = 60_000, minBlocks = 8, keep = 20 } = {}) {
    const open = [];    // groups still gathering differences
    const log = [];     // notes, oldest first
    let nextId = 1;
    let dirty = false;

    const stable = name => Boolean(name) && name !== AIR && !changesByItself(name);
    const bump = (counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1);

    /** What sort of difference this is, or null when it is not one worth reporting. */
    function classify({ before, after, sameViewpoint = false, mine = false, lookedAgoMs = Infinity, place = null }) {
        if (mine || lookedAgoMs < watchingMs) return null;
        if (before === after) return null;
        if (!stable(before) && !stable(after)) return null; // grass spread, leaves fell, water flowed
        if (before === null) {
            if (after === AIR) return null;
            // A thing the bot never recorded, in a place it had already looked over: new, or it was hidden.
            if (kindOf(after) && place !== null && Number.isFinite(lookedAgoMs)) return 'first seen';
            return sameViewpoint ? 'appeared' : null;
        }
        if (before === AIR) return 'appeared';
        if (after === AIR) return 'gone';
        return 'replaced';
    }

    function groupFor(diff) {
        const cube = [diff.x >> 4, diff.y >> 4, diff.z >> 4];
        let group = diff.place !== null && diff.place !== undefined
            ? open.find(g => g.place === diff.place)
            : open.find(g => g.place === null && g.cubes.some(c => Math.abs(c[0] - cube[0]) <= 1 && Math.abs(c[1] - cube[1]) <= 1 && Math.abs(c[2] - cube[2]) <= 1));
        if (!group) {
            group = { place: diff.place ?? null, cubes: [], where: { x: diff.x, y: diff.y, z: diff.z },
                gone: new Map(), added: new Map(), firstSeen: new Map(), blocks: 0, hasThing: false, lastAt: 0 };
            open.push(group);
        }
        if (!group.cubes.some(c => c[0] === cube[0] && c[1] === cube[1] && c[2] === cube[2])) group.cubes.push(cube);
        return group;
    }

    const listing = counts => {
        const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const shown = sorted.slice(0, 6).map(([name, n]) => `${name} ${n}`).join(', ');
        return sorted.length > 6 ? `${shown} and ${sorted.length - 6} more kinds` : shown;
    };

    function toNote(group, t) {
        const name = group.place !== null ? placeName(group.place) : null;
        const spot = `${group.where.x}, ${group.where.y}, ${group.where.z}`;
        const where = name ? `at ${name}` : group.place !== null ? `at a site near ${spot}` : `near ${spot}`;
        const parts = [];
        if (group.gone.size) parts.push(`Gone: ${listing(group.gone)}.`);
        if (group.added.size) parts.push(`New: ${listing(group.added)}.`);
        if (group.firstSeen.size) parts.push(`First seen: ${listing(group.firstSeen)}.`);
        return {
            id: nextId++, at: t, place: group.place, where: group.where, shown: false,
            gone: Object.fromEntries(group.gone), added: Object.fromEntries(group.added), firstSeen: Object.fromEntries(group.firstSeen),
            text: `Noticed ${where}: ${parts.join(' ')}`,
        };
    }

    return {
        get dirty() { return dirty; },
        /** How many groups of differences are still gathering. */
        get pending() { return open.length; },

        /**
         * The recorder sees a cell that differs from memory, or holds something where memory had nothing.
         * @param {object} diff
         * @param {number} diff.x @param {number} diff.y @param {number} diff.z
         * @param {string|null} diff.before - what was remembered: a block name, 'air', or null (never seen)
         * @param {string} diff.after - what is there now ('air' when empty)
         * @param {boolean} [diff.sameViewpoint] - the cube had been looked over before from this crumb
         * @param {boolean} [diff.mine] - the bot itself dug or placed this cell
         * @param {number} [diff.lookedAgoMs] - how long ago the cube was last looked over (Infinity if never)
         * @param {number|null} [diff.place] - the place the cell is in, if any
         * @returns {'gone'|'appeared'|'replaced'|'first seen'|null} what it was counted as
         */
        see(diff) {
            const what = classify(diff);
            if (!what) return null;
            const group = groupFor(diff);
            group.lastAt = now();
            group.blocks++;
            if (what === 'first seen') { bump(group.firstSeen, diff.after); group.hasThing = true; return what; }
            if (what === 'gone' || what === 'replaced') {
                if (stable(diff.before)) bump(group.gone, diff.before);
                if (kindOf(diff.before)) group.hasThing = true;
            }
            if (what === 'appeared' || what === 'replaced') {
                if (stable(diff.after)) bump(group.added, diff.after);
                if (kindOf(diff.after)) group.hasThing = true;
            }
            return what;
        },

        /**
         * Turns groups that have gone quiet into notes. Call it now and then; it is cheap.
         * @returns {object[]} the notes made by this call
         */
        settle() {
            const t = now();
            const made = [];
            for (let i = open.length - 1; i >= 0; i--) {
                const group = open[i];
                if (t - group.lastAt < settleMs) continue;
                open.splice(i, 1);
                const worthIt = group.hasThing || group.blocks >= minBlocks;
                if (!worthIt || (!group.gone.size && !group.added.size && !group.firstSeen.size)) continue;
                const note = toNote(group, t);
                log.push(note);
                made.push(note);
                dirty = true;
            }
            while (log.length > keep) log.shift();
            return made.reverse();
        },

        /** Notes not handed out yet, oldest first. Each is handed out once. */
        fresh() {
            const out = log.filter(note => !note.shown);
            for (const note of out) note.shown = true;
            if (out.length) dirty = true;
            return out.map(note => ({ ...note }));
        },

        /** The most recent notes, newest first, whether or not they were handed out. */
        recent(limit = 5) {
            return log.slice(-limit).reverse().map(note => ({ ...note }));
        },

        toJSON() { return { nextId, notes: log }; },
        markSaved() { dirty = false; },

        /** Internal: restores the log from saved data. */
        _restore(data) {
            for (const note of data?.notes ?? []) log.push(note);
            nextId = Math.max(nextId, data?.nextId ?? 1);
        },
    };
}
