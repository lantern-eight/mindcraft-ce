// SPDX-License-Identifier: CC0-1.0
// Runs every Java live script, one after another, with the narrow view and then seeing all around (no model
// calls, free to run). Each script starts its own throwaway server, from MC_TEST_JAVA and MC_TEST_SERVER_JAR.
//   node tests/live/java_all.js [--views=narrow,all] [--only=mob_scenarios,threat_scenarios] [--logs=<folder>] [--port=<n>]
//
// Fair play can see through a player's screen or all around (fov_degrees), and people run it both ways, so a
// release runs the scenes both ways: live_view.js reads the MC_TEST_VIEW this sets for each pass. Each
// script's whole output goes to a log of its own in that folder (a new temporary folder if none is given),
// and one line is printed for each: passed or failed, how long it took, and the end of its own summary. They
// run one at a time because they share a port and the server jar cache. With --port every script is given that
// port for its server and the next one for the MindServer of a script that starts one, so a second run, from
// another checkout, can go on beside this one on ports of its own.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The quickest and most basic first, so a server that won't start or a broken sense shows up in a minute,
// before the long agent and reflex scenes. The perception bench and the fight arenas are left out: they
// measure rather than check, and run on their own.
const SCRIPTS = ['fairplay_perception_smoke', 'fairplay_scenarios', 'narrow_view_scenarios', 'look_first_scenarios',
    'memory_scenarios', 'navigator_scenarios', 'legs_scenarios', 'travel_scenarios', 'explore_scenarios', 'turning_scenarios', 'mining_scenarios',
    'neighbor_scenarios', 'storage_scenarios', 'stow_scenarios', 'storage_agent_scenarios', 'smelting_scenarios', 'farming_scenarios', 'danger_scenarios', 'mob_scenarios', 'threat_scenarios',
    'villager_scenarios', 'agent_scenarios', 'narration_scenarios'];
const VIEWS = ['narrow', 'all'];

const here = path.dirname(fileURLToPath(import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const listOption = name => option(name)?.split(',').map(s => s.trim().replace(/\.js$/, '')).filter(Boolean);

const views = listOption('views') ?? VIEWS;
const port = option('port');
if (port !== undefined && !(Number(port) > 1024 && Number(port) < 65535)) throw new Error(`--port takes a port number, not "${port}"`);
const portArgs = port ? [`--port=${port}`, `--mind-port=${Number(port) + 1}`] : [];
const unknownView = views.find(view => !VIEWS.includes(view));
if (unknownView) throw new Error(`--views takes ${VIEWS.join(' and ')}, not "${unknownView}"`);
const scripts = listOption('only') ?? SCRIPTS;
const unknownScript = scripts.find(script => !existsSync(path.join(here, `${script}.js`)));
if (unknownScript) throw new Error(`No live script tests/live/${unknownScript}.js`);

// Fails here, with what to set, rather than once for every script. The same default as vanilla_fixture.js.
const jar = process.env.MC_TEST_SERVER_JAR || 'server_data/local-test/server.jar';
if (!existsSync(path.resolve(jar))) throw new Error('Set MC_TEST_SERVER_JAR to a Minecraft Java server jar');

const logsArg = option('logs');
const logs = logsArg ? path.resolve(logsArg) : mkdtempSync(path.join(tmpdir(), 'java-live-'));
mkdirSync(logs, { recursive: true });
console.log(`Views ${views.join(', ')}; ${scripts.length} scripts each; logs in ${logs}`);

/** Run one script with its output going to its log, and settle with its exit code. */
function run(script, view, log) {
    return new Promise(resolve => {
        const out = createWriteStream(log);
        const child = spawn(process.execPath, [path.join(here, `${script}.js`), ...portArgs], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, MC_TEST_VIEW: view },
        });
        child.stdout.pipe(out);
        child.stderr.pipe(out);
        child.on('error', error => { out.end(`\n${error.stack}\n`); resolve(1); });
        child.on('close', code => out.end(() => resolve(code ?? 1)));
    });
}

/**
 * A short summary from the script's log. The scripts end in different ways (a line of JSON, JSON spread over
 * lines, a sentence), so this takes the last one-line JSON result with a status, else the last line that
 * says passed or failed, cut short. Whether it passed comes from the exit code, never from this.
 */
function summaryOf(log) {
    const lines = readFileSync(log, 'utf8').split('\n').map(line => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
            const result = JSON.parse(line);
            if ('status' in result) return JSON.stringify(result).slice(0, 200);
        } catch { /* a line that only looks like JSON */ }
    }
    return lines.find(line => /passed|failed/i.test(line))?.slice(0, 200) ?? 'no summary';
}

const failures = [];
for (const view of views) {
    for (const script of scripts) {
        const log = path.join(logs, `${view}-${script}.log`);
        const started = Date.now();
        const code = await run(script, view, log);
        const seconds = Math.round((Date.now() - started) / 1000);
        if (code !== 0) failures.push(`${view} ${script}`);
        console.log(`${code === 0 ? 'passed' : 'FAILED'}  ${view}  ${script}  ${seconds}s  ${summaryOf(log)}`);
    }
}
const total = views.length * scripts.length;
console.log(failures.length
    ? `${failures.length} of ${total} runs failed (${failures.join(', ')}); their logs say why.`
    : `All ${total} runs passed.`);
process.exitCode = failures.length ? 1 : 0;
