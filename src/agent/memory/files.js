// SPDX-License-Identifier: CC0-1.0
// File helpers shared by the memory layers: where one world's memory lives, and reading and writing it
// so that a crash or a damaged file never costs more than that one file.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The folder for one scope (world and dimension). Each scope has its own memory, so two worlds
 * never mix. The scope is hashed into the name so that any string makes a safe folder.
 */
export function scopeDir(baseDir, scope) {
    const slug = String(scope).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    const hash = createHash('sha1').update(String(scope)).digest('hex').slice(0, 10);
    return path.join(baseDir, `${slug}-${hash}`);
}

/**
 * Carries one world's memory over from a folder kept under an older name for the same world, when the world
 * has no folder of its own yet. Scopes once included the server's address, so a world reached at a new
 * address (a LAN world gets a new port every session) started over; this gives it back what it had.
 *
 * Each folder's saved files say which scope they belong to. Of the folders whose scope `isFormer` accepts,
 * the most recently written one is copied, and the scope recorded in its files is changed to the new one so
 * they load. The old folder is left as it was. Folders from other old addresses of the same world are not
 * merged in: each of those sessions started empty, and the newest is the one the bot last knew.
 *
 * @param {string} baseDir - the folder holding every scope's folder
 * @param {string} scope - the scope about to be opened
 * @param {object} options
 * @param {(oldScope: string) => boolean} options.isFormer - is this an older name for the same world?
 * @param {(note: string) => void} [options.say] - told once what was carried over
 * @returns {string|null} the scope it was carried over from, or null when nothing was
 */
export function adoptFormerScope(baseDir, scope, { isFormer, say = console.log } = {}) {
    const dir = scopeDir(baseDir, scope);
    if (existsSync(dir) || !existsSync(baseDir)) return null;
    let best = null;
    for (const name of readdirSync(baseDir)) {
        const folder = path.join(baseDir, name);
        if (!statSync(folder).isDirectory()) continue;
        const files = readdirSync(folder).filter(file => file.endsWith('.json'));
        const old = files.map(file => scopeIn(path.join(folder, file))).find(Boolean);
        if (!old || !isFormer(old)) continue;
        const written = Math.max(...files.map(file => statSync(path.join(folder, file)).mtimeMs));
        if (!best || written > best.written) best = { folder, old, written };
    }
    if (!best) return null;
    cpSync(best.folder, dir, { recursive: true });
    for (const file of readdirSync(dir).filter(file => file.endsWith('.json'))) {
        const full = path.join(dir, file);
        try {
            const data = JSON.parse(readFileSync(full, 'utf8'));
            if (data?.scope === best.old) writeFileAtomic(full, JSON.stringify({ ...data, scope }));
        } catch { /* a damaged file stays as it is; its loader sets it aside */ }
    }
    say(`Memory of this world was kept under its old address (${best.old}); carried over to ${scope}.`);
    return best.old;
}

/** The scope a saved file says it belongs to, or null. */
function scopeIn(file) {
    try {
        const scope = JSON.parse(readFileSync(file, 'utf8'))?.scope;
        return typeof scope === 'string' ? scope : null;
    } catch { return null; }
}

/** Writes a file through a temporary one and a rename, so a crash never leaves half a file behind. */
export function writeFileAtomic(file, data) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, data);
    renameSync(tmp, file);
}

/** Moves a file that can't be used out of the way, keeping it for inspection. */
export function setAside(file, reason, warn = console.warn) {
    const aside = `${file}.damaged-${Date.now()}`;
    try { renameSync(file, aside); } catch { /* leave it; the caller starts empty either way */ }
    warn(`Memory file ${path.basename(file)} could not be used (${reason}); kept as ${path.basename(aside)}.`);
}

/**
 * Reads a JSON file. A missing file is null. A damaged one, or one `check` rejects (it returns a reason),
 * is set aside and also reads as null: memory then starts empty instead of stopping the bot.
 */
export function readJsonFile(file, { check = null, warn = console.warn } = {}) {
    if (!existsSync(file)) return null;
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        const problem = check ? check(data) : null;
        if (problem) throw new Error(problem);
        return data;
    } catch (error) {
        setAside(file, error.message, warn);
        return null;
    }
}
