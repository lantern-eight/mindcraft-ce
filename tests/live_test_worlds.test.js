// SPDX-License-Identifier: CC0-1.0
// Each Java live run makes a throwaway world folder; pruneTestWorlds clears away those of earlier runs, keeping
// the ones still young and the ones holding a model run's results.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pruneTestWorlds } from './helpers/test_worlds.js';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function worlds(names) {
    const root = mkdtempSync(path.join(tmpdir(), 'test-worlds-'));
    for (const [name, files = []] of names) {
        mkdirSync(path.join(root, name, 'world'), { recursive: true });
        for (const file of files) writeFileSync(path.join(root, name, file), '{}');
    }
    return root;
}

test('old test worlds go; a young one, a model run\'s results and other folders stay', () => {
    const root = worlds([
        [`agent-verification-${NOW - 2 * HOUR}`],
        [`verification-${NOW - 3 * HOUR}`],
        [`agent-verification-${NOW - 10 * 60 * 1000}`],
        [`agent-verification-${NOW - 5 * HOUR}`, ['replies.json', 'results.json']],
        [`agent-verification-${NOW - 6 * HOUR}`, ['agent-log.txt']],
        ['jar-cache'],
    ]);
    try {
        const removed = pruneTestWorlds({ root, now: NOW, env: {} }).map(dir => path.basename(dir)).sort();
        assert.deepEqual(removed, [`agent-verification-${NOW - 2 * HOUR}`, `verification-${NOW - 3 * HOUR}`]);
        assert.ok(existsSync(path.join(root, `agent-verification-${NOW - 10 * 60 * 1000}`)), 'a run that may still be going');
        assert.ok(existsSync(path.join(root, `agent-verification-${NOW - 5 * HOUR}`)), 'a model run\'s results');
        assert.ok(existsSync(path.join(root, `agent-verification-${NOW - 6 * HOUR}`)), 'a model run\'s log');
        assert.ok(existsSync(path.join(root, 'jar-cache')), 'the shared jar cache');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('MC_TEST_KEEP_WORLDS=1 keeps every world, and a missing folder is no error', () => {
    const root = worlds([[`agent-verification-${NOW - 2 * HOUR}`]]);
    try {
        assert.deepEqual(pruneTestWorlds({ root, now: NOW, env: { MC_TEST_KEEP_WORLDS: '1' } }), []);
        assert.ok(existsSync(path.join(root, `agent-verification-${NOW - 2 * HOUR}`)));
        assert.deepEqual(pruneTestWorlds({ root: path.join(root, 'nowhere'), now: NOW, env: {} }), []);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
