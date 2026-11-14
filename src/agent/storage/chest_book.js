// SPDX-License-Identifier: CC0-1.0
// The chest book: whose each chest is, and whether the bot may sort it without being asked.
//
// A player sharing a base knows which chests are theirs, which are someone else's and which are for
// everyone, because they were told. This is where the bot keeps what it was told:
//   - the owner: a player's name, "shared" (everyone, the bot included), "me" (the bot itself), or
//     nothing at all, which means nobody has said;
//   - the sorting permission: "asked" (sort it only when a player asks), "always" (the bot may tidy it
//     whenever), or "never" (leave it as it is, even when its owner's chests are sorted).
// The bot's own chests may always be sorted unless someone says otherwise. Everything else waits to be
// asked.
//
// The book never says that a chest exists. Chests are found through the bot's senses, like everything
// else; the book only adds what was said about the ones found. So only a chest with something to say
// has an entry, and "owner unknown" is simply a chest with none.
//
// Whose a chest is goes by the latest word, whoever says it. A change of owner sets the permission
// back to that owner's default, because "always sort it" was the old owner's word.
//
// This is a plain store with an injected clock. It holds names, positions and times, never the game's
// numbers, and it never touches the game.
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from '../memory/files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'chests.json';

/** The owner words that are not a player's name. */
export const ME = 'me', SHARED = 'shared';
/** The sorting permissions. */
export const SORTING = Object.freeze(['always', 'asked', 'never']);

const keyOf = (x, y, z) => `${x},${y},${z}`;
const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const lower = owner => (owner == null ? null : String(owner).toLowerCase());

/** Are these the same owner? Names are compared without regard to capitals; unknown matches unknown. */
export const sameOwner = (a, b) => lower(a) === lower(b);

/** How a chest of this owner may be sorted when nobody has said: the bot's own always, the rest when asked. */
export const defaultSorting = owner => (sameOwner(owner, ME) ? 'always' : 'asked');

/**
 * @param {object} options
 * @param {string} options.scope - `host:port/world/dimension`; one book per scope
 * @param {() => number} [options.now]
 * @param {number} [options.history] - how many changes are remembered per chest
 */
export function createChestBook({ scope, now = Date.now, history = 5 } = {}) {
    if (!scope) throw new Error('A chest book needs a scope (server/world/dimension)');
    const byCell = new Map();   // "x,y,z" -> entry. A double chest is under both of its cells
    let dirty = false;

    const all = () => [...new Set(byCell.values())];
    function index(entry) {
        byCell.set(keyOf(entry.x, entry.y, entry.z), entry);
        if (entry.also) byCell.set(keyOf(entry.also.x, entry.also.y, entry.also.z), entry);
    }
    function unindex(entry) {
        for (const cell of [entry, entry.also]) {
            if (cell && byCell.get(keyOf(cell.x, cell.y, cell.z)) === entry) byCell.delete(keyOf(cell.x, cell.y, cell.z));
        }
    }
    function copy(entry) {
        const out = { ...entry };
        if (entry.also) out.also = { ...entry.also };
        if (entry.said) out.said = entry.said.map(word => ({ ...word }));
        if (entry.lastSorted) out.lastSorted = { ...entry.lastSorted };
        return out;
    }
    const hasSomethingToSay = entry => entry.owner != null || entry.sorting != null || entry.madeBy != null || entry.lastSorted != null;

    /**
     * The entry for a chest as the bot finds it now. A chest is found under either of its cells, so a
     * single chest that has since become a double one, or a double one that lost a half, is still the
     * same chest. A different kind of container at the same spot is not: the chest that was there is gone.
     */
    function find(chest) {
        const cells = [cellOf(chest), chest.also ? cellOf(chest.also) : null].filter(Boolean);
        for (const cell of cells) {
            const entry = byCell.get(keyOf(cell.x, cell.y, cell.z));
            if (entry && (!chest.name || entry.name === chest.name)) return entry;
        }
        return null;
    }

    /** The entry to write to: the one there is, moved to where the chest is now, or a new one. */
    function entryFor(chest) {
        const here = cellOf(chest), other = chest.also ? cellOf(chest.also) : null;
        let entry = find(chest);
        // Whatever else is filed under these cells is about a chest that is no longer there.
        for (const cell of [here, other].filter(Boolean)) {
            const stale = byCell.get(keyOf(cell.x, cell.y, cell.z));
            if (stale && stale !== entry) unindex(stale);
        }
        if (!entry) {
            entry = { ...here, also: other, name: chest.name ?? 'chest' };
        } else if (other || !entry.also) {
            // The chest says where both of its halves are (or it has one): go by that. A chest that
            // cannot say (one the bot only remembers) keeps the halves the book already knows.
            // Being filed somewhere new is worth saving, even when nothing else about the chest changed.
            const there = cell => (cell ? keyOf(cell.x, cell.y, cell.z) : '');
            if (there(entry) !== there(here) || there(entry.also) !== there(other)) dirty = true;
            unindex(entry);
            Object.assign(entry, here, { also: other });
        }
        index(entry);
        return entry;
    }

    const book = {
        scope,
        get size() { return all().length; },
        get dirty() { return dirty; },

        /** The entry filed under a cell (either cell of a double chest), or null. */
        at(x, y, z) {
            const entry = byCell.get(keyOf(Math.floor(x), Math.floor(y), Math.floor(z)));
            return entry ? copy(entry) : null;
        },
        /** The entry for a chest as found (`{x, y, z, also, name}`), or null when nothing was said about it. */
        of(chest) {
            const entry = find(chest);
            return entry ? copy(entry) : null;
        },
        /** Whose the chest is: a player's name, "shared", "me", or null when nobody has said. */
        ownerOf: chest => find(chest)?.owner ?? null,
        /** How the chest may be sorted: "always", "asked" or "never". */
        sortingOf(chest) {
            const entry = find(chest);
            return entry?.sorting ?? defaultSorting(entry?.owner ?? null);
        },

        /**
         * Someone says whose a chest is, how it may be sorted, or both.
         * @param {{x: number, y: number, z: number, also?: object|null, name?: string}} chest - as found
         * @param {object} word
         * @param {string|null} [word.owner] - a player's name, "shared", "me", or null for unknown. Left
         *   out: the owner stays as it is
         * @param {string} [word.sorting] - "always", "asked" or "never". Left out: it stays as it is,
         *   unless the owner changes, which sets it back to the new owner's default
         * @param {string|null} [word.by] - who said so, when that is known
         * @param {string} [word.madeBy] - set when the bot placed the chest itself
         * @returns {{entry: object|null, was: {owner: string|null, sorting: string}, changed: boolean}}
         *   `entry` is null when the chest is left with nothing to say
         */
        mark(chest, { owner, sorting, by = null, madeBy } = {}) {
            if (sorting !== undefined && !SORTING.includes(sorting)) throw new Error(`Sorting is always, asked or never, not "${sorting}".`);
            const was = { owner: book.ownerOf(chest), sorting: book.sortingOf(chest) };
            const entry = entryFor(chest);
            const said = { at: now(), by };
            let changed = false;

            if (owner !== undefined && !sameOwner(owner, entry.owner ?? null)) {
                if (owner == null) delete entry.owner;
                else entry.owner = sameOwner(owner, ME) ? ME : sameOwner(owner, SHARED) ? SHARED : book.spell(String(owner));
                delete entry.sorting;       // the permission was the old owner's word
                said.owner = entry.owner ?? null;
                changed = true;
            }
            if (sorting !== undefined && sorting !== (entry.sorting ?? defaultSorting(entry.owner ?? null))) {
                entry.sorting = sorting;
                said.sorting = sorting;
                changed = true;
            }
            // A permission that is only the owner's default is not worth writing down.
            if (entry.sorting === defaultSorting(entry.owner ?? null)) delete entry.sorting;
            if (madeBy !== undefined && entry.madeBy !== madeBy) { entry.madeBy = madeBy; changed = true; }

            if (changed) {
                if ('owner' in said || 'sorting' in said) entry.said = [...(entry.said ?? []), said].slice(-history);
                dirty = true;
            }
            if (!hasSomethingToSay(entry)) {
                unindex(entry);
                return { entry: null, was, changed };
            }
            return { entry: copy(entry), was, changed };
        },

        /** The chest was just sorted. `by` is who asked, when that is known. */
        sorted(chest, { by = null } = {}) {
            const entry = entryFor(chest);
            entry.lastSorted = { at: now(), by };
            dirty = true;
            return copy(entry);
        },

        /**
         * The chest block at this cell is gone. A double chest that loses a half is still a chest, so
         * its entry stays with the other half; a single one takes its entry with it.
         * @returns {boolean} whether anything was filed under that cell
         */
        dropCell(x, y, z) {
            const cell = cellOf({ x, y, z });
            const entry = byCell.get(keyOf(cell.x, cell.y, cell.z));
            if (!entry) return false;
            unindex(entry);
            if (entry.also) {
                const rest = entry.x === cell.x && entry.y === cell.y && entry.z === cell.z ? entry.also : { x: entry.x, y: entry.y, z: entry.z };
                Object.assign(entry, rest, { also: null });
                index(entry);
            }
            dirty = true;
            return true;
        },

        /** Every entry, or only one owner's, in a fixed order. */
        list({ owner } = {}) {
            return all().filter(entry => owner === undefined || sameOwner(entry.owner ?? null, owner))
                .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z).map(copy);
        },
        /** The players who own a chest here, by name. */
        owners() {
            const names = new Set(all().map(entry => entry.owner).filter(owner => owner && owner !== ME && owner !== SHARED));
            return [...names].sort();
        },
        /** A name as the book already spells it, so "alice" and "Alice" are one owner. */
        spell(name) {
            return all().find(entry => sameOwner(entry.owner ?? null, name))?.owner ?? name;
        },

        toJSON() {
            return { version: FORMAT_VERSION, scope, savedAt: now(), chests: book.list() };
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
            for (const entry of data.chests ?? []) index({ ...entry, also: entry.also ?? null });
        },
    };
    return book;
}

/** Loads the book kept in a scope folder, or starts an empty one. A damaged or mismatched file is set aside. */
export function loadChestBook(dir, { warn, ...options } = {}) {
    const book = createChestBook(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
        ...(warn ? { warn } : {}),
    });
    if (data) book._restore(data);
    return book;
}
