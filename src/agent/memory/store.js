// SPDX-License-Identifier: CC0-1.0
// The store: one world's memory, with its five layers opened together and saved together.
//
//   cells    every block the bot has seen                              (cells.js)
//   things   chests and their contents, doors, beds, fields, herds     (things.js)
//   trail    where it has walked, as a graph it can route over         (trail.js)
//   places   sites it found or was told the name of                    (places.js)
//   changes  notes for when a place is not as it remembers it          (changes.js)
//
// Each server, world and dimension has its own folder, so the Nether never mixes with the overworld
// and one server's base is never looked for on another. Nothing in here touches the game: the recorder
// writes to the store and the commands read from it.
import path from 'node:path';
import { createCells, fileStorage } from './cells.js';
import { createChanges } from './changes.js';
import { readJsonFile, scopeDir, writeFileAtomic } from './files.js';
import { loadPlaces } from './places.js';
import { loadThings } from './things.js';
import { loadTrail } from './trail.js';

const CHANGES_FILE = 'changes.json';

/**
 * Opens (or starts) the memory for one scope.
 * @param {object} options
 * @param {string} options.baseDir - the folder holding every scope's memory
 * @param {string} options.scope - `host:port/world/dimension`
 * @param {() => number} [options.now]
 * @param {(a, b) => boolean} [options.canWalkStraight] - the trail's question; see trail.js
 */
export function openMemory({ baseDir, scope, now = Date.now, canWalkStraight = undefined } = {}) {
    const dir = scopeDir(baseDir, scope);
    const places = loadPlaces(dir, { scope, now });
    const changes = createChanges({ now, placeName: id => places.get(id)?.name ?? null });
    changes._restore(readJsonFile(path.join(dir, CHANGES_FILE)));
    const memory = {
        scope, dir, places, changes,
        cells: createCells({ storage: fileStorage(path.join(dir, 'cells')), now }),
        things: loadThings(dir, { scope, now }),
        trail: loadTrail(dir, { scope, now, ...(canWalkStraight ? { canWalkStraight } : {}) }),

        /**
         * Writes whatever changed. Only the layers that changed are written, and the cells stop when
         * `budgetMs` is used up and carry on at the next call, so saving never holds the game up.
         * @returns {number} cell regions still waiting to be written
         */
        save({ budgetMs = Infinity } = {}) {
            if (memory.trail.dirty) memory.trail.save(dir);
            if (memory.things.dirty) memory.things.save(dir);
            if (places.dirty) places.save(dir);
            if (changes.dirty) {
                writeFileAtomic(path.join(dir, CHANGES_FILE), JSON.stringify(changes.toJSON()));
                changes.markSaved();
            }
            return memory.cells.save({ budgetMs });
        },
    };
    return memory;
}
