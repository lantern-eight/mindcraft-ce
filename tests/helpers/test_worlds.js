// SPDX-License-Identifier: CC0-1.0
// Clears away the worlds of earlier live runs.
//
// Every Java live script starts a throwaway server in a new folder under server_data, so no run sees what
// another left behind. Nothing removed those folders afterwards, and at a few megabytes each they piled up into
// gigabytes. Removing a folder when its own server stops isn't possible: the scripts that drive a model write
// their transcripts and results into it after the server is down, to be read later. So each new server clears
// the folders of runs before it instead, keeping any that hold such results.
import path from 'node:path';
import { readdirSync, rmSync, statSync } from 'node:fs';

// The folders the live scripts make: vanilla_fixture.js's and mining_scenarios.js's, each named by its start time.
const WORLD = /^(agent-)?verification-(\d+)$/;
// What only a script writes there, after a run with a model: such a folder is kept.
const RESULTS = /^(results|replies.*|agent-log\.txt)/;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Removes the test worlds under `root` that started over an hour ago and hold no results. The hour leaves alone
 * a run that may still be going, in a second checkout or a terminal of its own.
 * @param {object} [options]
 * @param {string} [options.root] - where the worlds are
 * @param {number} [options.now]
 * @param {object} [options.env] - MC_TEST_KEEP_WORLDS=1 keeps them all, to look into a world after a run
 * @returns {string[]} the folders removed
 */
export function pruneTestWorlds({ root = 'server_data', now = Date.now(), env = process.env } = {}) {
    if (env.MC_TEST_KEEP_WORLDS === '1') return [];
    let names;
    try { names = readdirSync(root); } catch { return []; }
    const removed = [];
    for (const name of names) {
        const match = WORLD.exec(name);
        if (!match || now - Number(match[2]) < HOUR_MS) continue;
        const dir = path.join(root, name);
        try {
            if (!statSync(dir).isDirectory() || readdirSync(dir).some(file => RESULTS.test(file))) continue;
            rmSync(dir, { recursive: true, force: true });
            removed.push(dir);
        } catch { /* gone already, or not ours to remove: leave it */ }
    }
    return removed;
}
