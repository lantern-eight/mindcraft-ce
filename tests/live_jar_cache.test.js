// SPDX-License-Identifier: CC0-1.0
// The live scenarios start a throwaway server each run. Its jar unpacks (and for Paper, downloads and patches)
// the game into its working folder on first start, which costs about a minute. jarCacheArgs points that work
// at one shared folder instead, so only the first run pays for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { jarCacheArgs } from './helpers/server_jar_cache.js';

test('by default the cache is a folder under server_data, passed as bundlerRepoDir', () => {
    const args = jarCacheArgs({}, { create: false });
    assert.deepEqual(args, [`-DbundlerRepoDir=${path.resolve('server_data/jar-cache')}`]);
});

test('MC_TEST_JAR_CACHE picks another folder, made if missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jar-cache-test-'));
    const dir = path.join(root, 'nested', 'cache');
    try {
        const args = jarCacheArgs({ MC_TEST_JAR_CACHE: dir });
        assert.deepEqual(args, [`-DbundlerRepoDir=${dir}`]);
        assert.ok(existsSync(dir), 'the folder is created so the server does not have to');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('MC_TEST_JAR_CACHE=off gives the old behavior: each server unpacks its own copy', () => {
    assert.deepEqual(jarCacheArgs({ MC_TEST_JAR_CACHE: 'off' }), []);
});

test('a folder with "!" in its path is refused, since Paper will not start from one', () => {
    assert.throws(() => jarCacheArgs({ MC_TEST_JAR_CACHE: '/tmp/bad!dir' }, { create: false }), /!/);
});
