// SPDX-License-Identifier: CC0-1.0
// File helpers shared by the memory layers: where one world's memory lives, and reading and writing it
// so that a crash or a damaged file never costs more than that one file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The folder for one scope (server, world, dimension). Each scope has its own memory, so two worlds
 * never mix. The scope is hashed into the name so that any string makes a safe folder.
 */
export function scopeDir(baseDir, scope) {
    const slug = String(scope).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    const hash = createHash('sha1').update(String(scope)).digest('hex').slice(0, 10);
    return path.join(baseDir, `${slug}-${hash}`);
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
