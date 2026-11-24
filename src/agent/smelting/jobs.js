// SPDX-License-Identifier: CC0-1.0
// Jobs: what the bot has left smelting, and where. A player who loads a furnace and walks off remembers
// which furnace has their sand in it and about when the glass will be done; this is that memory.
//
// One job per furnace: what the bot is smelting in it, how many it means to smelt there in all, how many
// it has put in and taken out so far, the fuel it put in, and when the furnace should be done with what is
// in it. A job is written as soon as the bot puts something in, so a smelt that is stopped, or a bot that
// restarts, still knows. It goes when the bot has taken back everything of its own.
//
// What a furnace really holds is known only by opening it: a job is the bot's belief, with the time it was
// last true. Someone may have emptied the furnace since.
//
// A plain store with an injected clock, kept per world scope (one file per world and dimension, like the
// chest book), so it needs no world memory. It holds names, positions and times only.
import path from 'node:path';
import { readJsonFile, writeFileAtomic } from '../memory/files.js';

const FORMAT_VERSION = 1;
const FILE_NAME = 'smelting_jobs.json';

const keyOf = pos => `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
const copy = job => (job ? { ...job, fuelPut: { ...job.fuelPut } } : null);
const distanceTo = (job, from) => Math.hypot(job.x + 0.5 - from.x, job.y + 0.5 - from.y, job.z + 0.5 - from.z);

/**
 * How much of a job is in the furnace now, as the bot believes: what it put in and has not seen come out.
 * Input still smelting and output not yet taken both count.
 */
export const stillInFurnace = job => Math.max(0, (job?.loaded ?? 0) - (job?.collected ?? 0));

/** How many of a job are left to put in: smelted in all, less what went in already. */
export const leftToLoad = job => Math.max(0, (job?.total ?? 0) - (job?.loaded ?? 0));

/**
 * Is what a furnace holds the bot's own job, and nothing else? Its input is the job's item, its output the
 * job's product, and there is no more of either than the bot put in and hasn't taken out. Then the bot may
 * take from it and add to it: it isn't someone else's furnace in use.
 * @param {object|null} job
 * @param {{input: {name, count}|null, output: {name, count}|null}} slots
 */
export function holdsOnly(job, { input, output }) {
    if (!job) return false;
    if (input && input.name !== job.input) return false;
    if (output && output.name !== job.product) return false;
    return (input?.count ?? 0) + (output?.count ?? 0) <= stillInFurnace(job);
}

/**
 * @param {object} options
 * @param {string} options.scope - which world and dimension, from `scopeOf` in fairplay/install.js
 * @param {() => number} [options.now]
 */
export function createJobs({ scope, now = Date.now } = {}) {
    if (!scope) throw new Error('A jobs store needs a scope (world and dimension)');
    const byKey = new Map();
    let dirty = false;

    const store = {
        scope,
        get dirty() { return dirty; },

        /** The job at a furnace, or null. */
        at(pos) { return copy(byKey.get(keyOf(pos))); },

        /** Every job, nearest first when `from` is given, else soonest ready first. */
        list({ from = null, input = null, maxDistance = Infinity } = {}) {
            const jobs = [...byKey.values()].filter(job => !input || job.input === input)
                .filter(job => !from || distanceTo(job, from) <= maxDistance).map(copy);
            return from ? jobs.sort((a, b) => distanceTo(a, from) - distanceTo(b, from))
                : jobs.sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
        },

        /**
         * Starts a job at a furnace, or takes up the one already there for the same item. `total` is how
         * many the bot means to smelt there from now on, counting what of its own is in it already; what it
         * collected before stays counted.
         */
        start(pos, { kind = 'furnace', input, product, total, placed = false }) {
            const key = keyOf(pos);
            const was = byKey.get(key);
            if (was && was.input === input) {
                was.total = was.collected + Math.max(total, stillInFurnace(was));
                dirty = true;
                return copy(was);
            }
            const [x, y, z] = key.split(',').map(Number);
            const job = { x, y, z, kind, input, product, total, loaded: 0, collected: 0, fuelPut: {}, placed,
                startedAt: now(), readyAt: null, toldReady: false, seenAt: now() };
            byKey.set(key, job);
            dirty = true;
            return copy(job);
        },

        /**
         * Notes what the bot just did at a furnace: `loaded` and `collected` add to the counts, `fuelPut`
         * adds (or with a negative count takes back) fuel, `readyAt` replaces when the furnace should be done.
         */
        note(pos, { loaded = 0, collected = 0, fuelPut = {}, readyAt } = {}) {
            const job = byKey.get(keyOf(pos));
            if (!job) return null;
            job.loaded += loaded;
            job.collected += collected;
            for (const [name, count] of Object.entries(fuelPut)) {
                const left = (job.fuelPut[name] ?? 0) + count;
                if (left > 0) job.fuelPut[name] = left; else delete job.fuelPut[name];
            }
            if (readyAt !== undefined) { job.readyAt = readyAt; job.toldReady = false; }
            job.seenAt = now();
            dirty = true;
            return copy(job);
        },

        /** The bot has said the job is ready: it isn't said again until the job changes. */
        toldReady(pos) {
            const job = byKey.get(keyOf(pos));
            if (job && !job.toldReady) { job.toldReady = true; dirty = true; }
        },

        /** The job is over (or the furnace gone): forgets it. */
        end(pos) {
            if (byKey.delete(keyOf(pos))) dirty = true;
        },

        toJSON() {
            return { version: FORMAT_VERSION, scope, jobs: [...byKey.values()].map(copy) };
        },

        save(dir) {
            writeFileAtomic(path.join(dir, FILE_NAME), JSON.stringify(store.toJSON()));
            dirty = false;
        },

        _restore(data) {
            for (const job of data.jobs ?? []) {
                if (![job.x, job.y, job.z].every(Number.isFinite) || !job.input) continue;
                byKey.set(keyOf(job), { ...job, fuelPut: { ...(job.fuelPut ?? {}) } });
            }
        },
    };
    return store;
}

/** Loads the jobs kept in a scope folder, or starts with none. A damaged or mismatched file is set aside. */
export function loadJobs(dir, { warn, ...options } = {}) {
    const jobs = createJobs(options);
    const data = readJsonFile(path.join(dir, FILE_NAME), {
        check: d => (d.version !== FORMAT_VERSION || d.scope !== options.scope ? 'version or scope mismatch' : null),
        ...(warn ? { warn } : {}),
    });
    if (data) jobs._restore(data);
    return jobs;
}
