// SPDX-License-Identifier: CC0-1.0
// Where the Bedrock live scripts find their server.
//
// The Java scripts start a throwaway server themselves, from a jar. That isn't possible here: the Bedrock
// Dedicated Server only runs on Linux (x86-64) and Windows, and the machine running the tests is often
// neither. So these scripts are pointed at a server that is already running, on this machine or another,
// and are told how to type into its console. docs/bedrock.md shows a throwaway server that fits.
//
//   BEDROCK_TEST_HOST     the server's address. Required.
//   BEDROCK_TEST_PORT     its game port. 19132 if not set.
//   BEDROCK_TEST_VERSION  the Bedrock version to speak, such as 1.26.60, or "auto". "auto" if not set.
//   BEDROCK_TEST_CONSOLE  a command that sends one line to the server's console, the line being added as its
//                         last argument. For a server in the itzg/minecraft-bedrock-server image:
//                           docker exec <container> send-command
//                         and for the same on another machine, put `ssh <that machine>` in front.
//                         Without it the smoke test still runs and skips the steps that need the console.
//                         The skills walk builds every scene from the console and does not run without it.
//
// NEVER point these at a world you care about. They dig, build, hand out items and move players around.
import { spawn } from 'node:child_process';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A console line may pass through a remote shell on its way to the server, and a shell would read
// characters such as ~ * $ ; or quotes its own way before the server saw them. Rather than guess at the
// quoting of every way a line can travel, only lines no shell changes are sent. Coordinates are written
// absolute for the same reason: Bedrock's relative ones start with ~.
const SAFE_LINE = /^[A-Za-z0-9 _.:\-]+$/;

/** Read the server from the environment. Throws, with what to set, when there is none. */
export function bedrockTestServer(env = process.env) {
    const host = env.BEDROCK_TEST_HOST;
    if (!host) {
        throw new Error('Set BEDROCK_TEST_HOST (and BEDROCK_TEST_PORT) to a throwaway Bedrock Dedicated Server. ' +
            'docs/bedrock.md shows how to run one.');
    }
    const port = Number(env.BEDROCK_TEST_PORT || 19132);
    const version = env.BEDROCK_TEST_VERSION || 'auto';
    const consoleCommand = (env.BEDROCK_TEST_CONSOLE || '').trim().split(/\s+/).filter(Boolean);

    /** Type one line into the server's console, and give the server a moment to act on it. */
    async function command(line, settleMs = 400) {
        if (!consoleCommand.length) throw new Error('No server console: BEDROCK_TEST_CONSOLE is not set');
        if (!SAFE_LINE.test(line)) throw new Error(`Console line has characters a shell could change: ${line}`);
        await new Promise((resolve, reject) => {
            const child = spawn(consoleCommand[0], [...consoleCommand.slice(1), line], { stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            child.on('error', reject);
            child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Console command exited ${code}: ${output.trim().slice(-300)}`)));
        });
        await delay(settleMs);
    }

    return { host, port, version, hasConsole: consoleCommand.length > 0, command };
}

/** The settings a bot needs to join that server, to be laid over the repo's own. */
export function bedrockTestSettings(server) {
    return { minecraft_edition: 'bedrock', minecraft_version: server.version, host: server.host, port: server.port, auth: 'offline' };
}

/**
 * The steps of a live script, printed one line of JSON each, the way the Java live scripts print theirs.
 *
 * `step` is something that has to work: a failure throws and ends the run. `attempt` has to work too, but
 * a failure is only recorded, so the rest of a list is still tried. `knownGap` is something known
 * not to work yet and written down in docs/bedrock.md: it is reported either way and never ends the run,
 * and when it starts passing the line says so, because the docs then want updating. `skip` is a step that
 * could not be tried.
 */
export function createReport() {
    const results = [];
    const record = (name, status, started, details) => {
        const result = { name, status, durationMs: Date.now() - started, ...(details || {}) };
        results.push(result);
        console.log(JSON.stringify(result));
    };
    const countOf = status => results.filter(result => result.status === status).length;
    return {
        results,
        async step(name, fn) {
            const started = Date.now();
            try {
                record(name, 'passed', started, await fn());
            } catch (error) {
                // Recorded before it ends the run, so the summary doesn't call the run passed.
                record(name, 'failed', started, { error: String(error.message).split('\n')[0] });
                throw error;
            }
        },
        skip(name, why) {
            record(name, 'skipped', Date.now(), { why });
        },
        /** Like `step`, but a failure is recorded and the run goes on: for a list where every item should be tried. */
        async attempt(name, fn) {
            const started = Date.now();
            try {
                record(name, 'passed', started, await fn());
            } catch (error) {
                record(name, 'failed', started, { error: String(error.message).split('\n')[0] });
            }
        },
        async knownGap(name, fn) {
            const started = Date.now();
            try {
                const details = await fn();
                record(name, 'passed', started, { ...(details || {}), note: 'This known gap is closed. Update docs/bedrock.md.' });
            } catch (error) {
                record(name, 'known_gap', started, { error: String(error.message).split('\n')[0] });
            }
        },
        passed: () => countOf('passed'),
        failed: () => countOf('failed'),
        summary: () => ({
            status: countOf('failed') ? 'failed' : 'passed',
            steps: countOf('passed'),
            failed: results.filter(result => result.status === 'failed').map(result => result.name),
            skipped: countOf('skipped'),
            knownGaps: results.filter(result => result.status === 'known_gap').map(result => result.name),
        }),
    };
}
