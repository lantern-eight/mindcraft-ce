// SPDX-License-Identifier: CC0-1.0
// The field book: whose each field is, and whether the bot may tend it without being asked.
//
// A player on a shared server doesn't harvest a field because it is there: it is someone's. This is where
// the bot keeps what it knows about that, cell by cell of farmland:
//   - the owner: a player's name, "shared" (everyone's, the bot's too), "me" (the bot's own), or nothing,
//     which means nobody has said;
//   - the tending permission: "always" (the bot may tend it whenever it decides to) or "asked" (only when
//     a player asks). The bot's own and shared fields are "always" unless someone says otherwise.
// It is kept per cell because a field changes shape: rows are added, a corner is dug up. A field's owner
// is the owner of most of the cells the book knows in it.
//
// The book never says a field exists. Fields are found through the bot's senses; the book only adds what
// was said or done about the cells found. It holds names, positions and times, never the game's numbers,
// and never touches the game. The same pattern as the chest book of chest sorting.
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from '../memory/files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'fields.json';

/** The owner words that are not a player's name. */
export const ME = 'me', SHARED = 'shared';
/** The tending permissions. */
export const TENDING = Object.freeze(['always', 'asked']);

const keyOf = (x, y, z) => `${x},${y},${z}`;
const lower = owner => (owner == null ? null : String(owner).toLowerCase());

/** Are these the same owner? Names are compared without regard to capitals; unknown matches unknown. */
export const sameOwner = (a, b) => lower(a) === lower(b);

/** How a field of this owner may be tended when nobody has said: the bot's own and shared ones whenever. */
export const defaultTending = owner => (sameOwner(owner, ME) || sameOwner(owner, SHARED) ? 'always' : 'asked');

/**
 * @param {object} options
 * @param {string} options.scope - which world and dimension (fairplay/install.js `scopeOf`); one book per scope
 * @param {() => number} [options.now]
 */
export function createFieldBook({ scope, now = Date.now } = {}) {
    if (!scope) throw new Error('A field book needs a scope (world/dimension)');
    const byCell = new Map(); // "x,y,z" -> { owner, tending, at }
    let dirty = false;

    const book = {
        scope,
        get dirty() { return dirty; },

        /**
         * Whose the field made of these cells is, as far as the book knows: the owner of most of its known
         * cells, with that owner's permission. `known` is how many of the cells the book has a word on.
         * @param {{x: number, y: number, z: number}[]} cells
         * @returns {{owner: string|null, tending: string, known: number, mixed: boolean}}
         */
        whose(cells) {
            const votes = new Map();
            let known = 0;
            for (const c of cells ?? []) {
                const entry = byCell.get(keyOf(c.x, c.y, c.z));
                if (!entry) continue;
                known++;
                const k = lower(entry.owner);
                const vote = votes.get(k) ?? { owner: entry.owner, tending: entry.tending, n: 0, at: 0 };
                vote.n++;
                // The latest word on any cell sets the permission of that owner's part.
                if (entry.at >= vote.at) { vote.tending = entry.tending; vote.at = entry.at; }
                votes.set(k, vote);
            }
            if (!known) return { owner: null, tending: 'asked', known: 0, mixed: false };
            const best = [...votes.values()].sort((a, b) => b.n - a.n || b.at - a.at)[0];
            return { owner: best.owner, tending: best.tending, known, mixed: votes.size > 1 };
        },

        /**
         * Says whose these cells are, and how they may be tended. The latest word wins, whoever says it.
         * A change of owner sets the permission back to that owner's default unless one is given.
         * @param {{x: number, y: number, z: number}[]} cells
         * @param {{owner?: string|null, tending?: string|null}} word
         */
        mark(cells, { owner, tending = null } = {}) {
            if (tending !== null && !TENDING.includes(tending)) throw new Error(`Tending must be one of ${TENDING.join(', ')}`);
            for (const c of cells ?? []) {
                const k = keyOf(c.x, c.y, c.z);
                const before = byCell.get(k);
                const who = owner === undefined ? before?.owner ?? null : owner;
                if (who === null) {
                    if (byCell.delete(k)) dirty = true;
                    continue;
                }
                const keep = before && sameOwner(before.owner, who) ? before.tending : defaultTending(who);
                byCell.set(k, { owner: who, tending: tending ?? keep, at: now() });
                dirty = true;
            }
        },

        /**
         * Notes the owner of the cells the book has no word on yet, leaving the rest as they are. Used when the
         * bot tends or sows a field for someone: what was already said stays said.
         */
        claimUnknown(cells, owner) {
            const fresh = (cells ?? []).filter(c => !byCell.has(keyOf(c.x, c.y, c.z)));
            if (fresh.length) book.mark(fresh, { owner });
            return fresh.length;
        },

        /** Forgets a cell that is no longer farmland. */
        forget(cell) {
            if (byCell.delete(keyOf(cell.x, cell.y, cell.z))) dirty = true;
        },

        /** How many cells each owner has, for a summary. */
        owners() {
            const counts = new Map();
            for (const entry of byCell.values()) counts.set(entry.owner, (counts.get(entry.owner) ?? 0) + 1);
            return [...counts].map(([owner, cells]) => ({ owner, cells })).sort((a, b) => b.cells - a.cells);
        },

        toJSON() {
            const cells = [...byCell].map(([k, e]) => [k, e.owner, e.tending, e.at]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
            return { version: FORMAT_VERSION, scope, savedAt: now(), cells };
        },
        /** Writes the book into its scope folder. */
        save(dir) {
            const file = path.join(dir, FILE_NAME);
            writeFileAtomic(file, JSON.stringify(book.toJSON()));
            dirty = false;
            return file;
        },
        /** Internal: fills an empty book from a saved file's data. */
        _restore(data) {
            for (const [k, owner, tending, at] of data.cells ?? []) {
                if (typeof k === 'string' && owner && TENDING.includes(tending)) byCell.set(k, { owner, tending, at: at ?? 0 });
            }
        },
    };
    return book;
}

/** Loads the book kept in a scope folder, or starts an empty one. A damaged or mismatched file is set aside. */
export function loadFieldBook(dir, { warn, ...options } = {}) {
    const book = createFieldBook(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
        ...(warn ? { warn } : {}),
    });
    if (data) book._restore(data);
    return book;
}

/**
 * May the bot tend this field now? A player is never refused: when a player asks, or when it can't be told
 * who asked, yes. On the bot's own idea, only a field whose owner allows it ("always": its own and shared
 * fields by default, and a player's that the player said may always be tended).
 * @param {{owner: string|null, tending: string}} whose - from `book.whose`
 * @param {{asked?: boolean|null}} behind - from the request watcher
 * @returns {{ok: boolean, why?: string}}
 */
export function mayTend(whose, behind = {}) {
    if (behind.asked !== false) return { ok: true };
    if (whose.owner && whose.tending === 'always') return { ok: true };
    if (!whose.owner) return { ok: false, why: 'unknown' };
    return { ok: false, why: 'theirs' };
}
