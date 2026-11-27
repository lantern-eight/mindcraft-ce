// SPDX-License-Identifier: CC0-1.0
// The last walk, kept with world memory so that "explore on" carries on after a restart.
//
// A person who went exploring east yesterday knows which way they were going. Without this, a bot that was
// restarted starts afresh: towards the land it has seen least of, which is usually the same way, but not
// always. The walk is kept in the folder of the world and dimension it was made in, beside the rest of world
// memory, so the Nether's walk never carries on in the overworld. Without world memory nothing is saved.
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from '../memory/files.js';

const FILE = 'explore.json';

const isPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.z);
const isTrail = t => isPoint(t?.origin) && isPoint(t?.end) && Number.isFinite(t?.heading) && typeof t?.bearing === 'boolean';

/**
 * The walk saved for this scope, or null.
 * @param {string} dir - the scope's memory folder
 * @param {string} scope - which world and dimension; a file saved for another one is not used
 */
export function loadWalk(dir, scope) {
    const data = readJsonFile(path.join(dir, FILE), { check: d => (isTrail(d?.trail) ? null : 'no walk in it') });
    if (!data || data.scope !== scope) return null;
    const { origin, end, heading, bearing } = data.trail;
    return { origin: { x: origin.x, z: origin.z }, end: { x: end.x, z: end.z }, heading, bearing };
}

/**
 * Saves the walk for this scope. The scope goes in the file, as in every memory file, so that memory carried
 * over to a new name for the same world (files.js, `adoptFormerScope`) brings it along.
 */
export function saveWalk(dir, scope, trail) {
    writeFileAtomic(path.join(dir, FILE), JSON.stringify({ scope, trail }));
}
