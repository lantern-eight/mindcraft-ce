// SPDX-License-Identifier: CC0-1.0
// When an action fails, what the model is told must not include a stack trace. A stack names files by their
// full path on the machine running the bot, which gives away the home folder (often the person's name) to the
// model provider. Mindcraft-CE's older action manager added "Stack trace:" to the message; this pins down that
// the action runtime this fork runs sends the error's own message and nothing more, so an upstream change that
// brings stack text back fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ActionManager } from '../src/agent/action_manager.js';

function manager() {
    const bot = Object.assign(new EventEmitter(), { output: '' });
    const agent = { bot, clearBotLogs: () => { bot.output = ''; }, requestInterrupt: () => {} };
    return new ActionManager(agent);
}

// Everything the model could read from a finished action.
const modelFacing = result => [result.text, result.message].filter(Boolean).join('\n');

test('a failed action reports its error message without a stack trace or local paths', async () => {
    const quiet = console.error;
    console.error = () => {}; // the runtime logs the stack locally, which is fine; keep the test output clean
    try {
        const error = new Error('Could not reach the chest.');
        // Node names modules by file URL, with spaces and the like encoded, so look for both spellings.
        const local = [process.cwd(), pathToFileURL(process.cwd()).href, homedir(), pathToFileURL(homedir()).href];
        assert.ok(local.some(p => error.stack.includes(p)), 'the stack really does name local files');
        const result = await manager().runAction('test:fail', async () => { throw error; });
        const text = modelFacing(result);
        assert.equal(result.status, 'failed');
        assert.match(text, /Could not reach the chest\./);
        assert.ok(!/\n\s+at /.test(text), `no stack frames: ${text}`);
        for (const p of local) assert.ok(!text.includes(p), `no local path (${p})`);
        assert.ok(!text.includes('file://'), 'no file URLs');
    } finally {
        console.error = quiet;
    }
});
