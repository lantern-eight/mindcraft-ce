// SPDX-License-Identifier: CC0-1.0
// Runs every Bedrock live script, one after another, against the server the BEDROCK_TEST_* variables name
// (no model calls, free to run).
//   node tests/live/bedrock_all.js [--logs=<folder>]
// bedrock_fixture.js explains the variables; docs/bedrock.md shows a throwaway server to point them at.
// NEVER a world you care about.
//
// Each script's whole output goes to a log of its own in that folder (a new temporary folder if none is
// given), and one line is printed for each: passed or failed, how long it took, and its own summary. They
// run one at a time because they share the world: each builds its scene where the bot spawns.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bedrockTestServer } from './bedrock_fixture.js';

// The quickest first: if the bot can't join or the console doesn't answer, the smoke test says so in half a
// minute, before the skills walk spends seven minutes on it.
const SCRIPTS = ['bedrock_smoke', 'bedrock_perception', 'bedrock_memory', 'bedrock_memory_scenarios',
    'bedrock_fair_play', 'bedrock_storage', 'bedrock_stow', 'bedrock_smelting', 'bedrock_farming', 'bedrock_neighbor', 'bedrock_turning', 'bedrock_explore', 'bedrock_threats', 'bedrock_skills'];

const here = path.dirname(fileURLToPath(import.meta.url));
const logsArg = process.argv.find(arg => arg.startsWith('--logs='))?.slice('--logs='.length);
const logs = logsArg ? path.resolve(logsArg) : mkdtempSync(path.join(tmpdir(), 'bedrock-live-'));
mkdirSync(logs, { recursive: true });

// Fails here, with what to set, rather than once for every script.
const server = bedrockTestServer();
if (!server.hasConsole) throw new Error('The scenes are built from the server console: set BEDROCK_TEST_CONSOLE');
console.log(`Bedrock server ${server.host}:${server.port}; logs in ${logs}`);

/** Run one script with its output going to its log, and settle with its exit code. */
function run(script, log) {
    return new Promise(resolve => {
        const out = createWriteStream(log);
        const child = spawn(process.execPath, [path.join(here, `${script}.js`)], { stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(out);
        child.stderr.pipe(out);
        child.on('error', error => { out.end(`\n${error.stack}\n`); resolve(1); });
        child.on('close', code => out.end(() => resolve(code ?? 1)));
    });
}

/** The script's own summary: the last line of JSON with a count of steps. Later lines are only goodbyes. */
function summaryOf(log) {
    const lines = readFileSync(log, 'utf8').split('\n').reverse();
    for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
            const result = JSON.parse(line);
            if ('steps' in result || 'passedSteps' in result) return result;
        } catch { /* a line that only looks like JSON */ }
    }
    return null;
}

let failed = 0;
for (const script of SCRIPTS) {
    const log = path.join(logs, `${script}.log`);
    const started = Date.now();
    const code = await run(script, log);
    const seconds = Math.round((Date.now() - started) / 1000);
    const summary = summaryOf(log);
    const passed = code === 0 && summary?.status === 'passed';
    if (!passed) failed++;
    console.log(`${passed ? 'passed' : 'FAILED'}  ${script}  ${seconds}s  ${summary ? JSON.stringify(summary) : `exit ${code}, no summary`}`);
}
console.log(failed ? `${failed} of ${SCRIPTS.length} scripts failed; their logs say why.` : `All ${SCRIPTS.length} scripts passed.`);
process.exitCode = failed ? 1 : 0;
