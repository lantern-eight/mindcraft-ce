// SPDX-License-Identifier: CC0-1.0
// One shared folder for what a server jar unpacks on its first start.
//
// Both kinds of jar the live scenarios run are launchers, not the server itself. Mojang's server jar unpacks
// its libraries and the real server jar next to it; Paper's launcher first downloads Mojang's jar and patches
// it, which takes about a minute. Both write into their working folder, and every throwaway server gets a
// fresh one, so every run used to pay that minute again.
//
// Both launchers read the Java system property `bundlerRepoDir` and put that work there instead. They check
// each file's hash before using it, so a folder shared between runs, or between jars of different game
// versions, is reused when it matches and redone when it doesn't. Only one server should fill it at a time:
// run the live scripts one after another, as they need anyway (they share a port).
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const DEFAULT_DIR = 'server_data/jar-cache';

/**
 * The extra Java arguments that point a server jar at the shared cache folder.
 * @param {object} env - where to read MC_TEST_JAR_CACHE from: a folder, or `off` for no cache.
 * @param {{create?: boolean}} options - create the folder if missing (on by default; tests turn it off).
 * @returns {string[]} arguments to put before `-jar`.
 */
export function jarCacheArgs(env = process.env, { create = true } = {}) {
    const choice = env.MC_TEST_JAR_CACHE;
    if (choice === 'off') return [];
    const dir = path.resolve(choice || DEFAULT_DIR);
    // Paper's launcher refuses to run from a path with '!' in it (it breaks jar URLs). Say so here, where the
    // reason is clear, rather than as a server that never finishes starting.
    if (dir.includes('!')) throw new Error(`MC_TEST_JAR_CACHE may not contain '!': ${dir}`);
    if (create) mkdirSync(dir, { recursive: true });
    return [`-DbundlerRepoDir=${dir}`];
}
