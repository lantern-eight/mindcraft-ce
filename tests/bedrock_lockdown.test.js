// SPDX-License-Identifier: CC0-1.0
// Model-written code runs in an SES sandbox, and the sandbox can only be set up if the libraries a Bedrock
// connection loads leave JavaScript's built-ins in a state SES can tame (src/agent/bedrock/lockdown_ready.js).
// This loads them the way a connection does and then sets the sandbox up. Each test file runs in its own
// process, so the sandbox set up here touches no other test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadReflectMetadataForLockdown, reflectMetadataPath } from '../src/agent/bedrock/lockdown_ready.js';
import { lockdown, makeCompartment } from '../src/agent/library/lockdown.js';

const REGISTRY = Symbol.for('@reflect-metadata:registry');

test('the copy of reflect-metadata the connection would load is found', () => {
    const found = reflectMetadataPath();
    assert.ok(found, 'found');
    assert.equal(path.basename(path.dirname(found)), 'reflect-metadata');
});

test('loaded first, it leaves Reflect in a state the sandbox can be set up from, after the connection\'s libraries load', () => {
    assert.equal(loadReflectMetadataForLockdown(), true);
    assert.equal(Object.getOwnPropertyDescriptor(Reflect, REGISTRY)?.configurable, true, 'its registry can be deleted');
    assert.equal(typeof Reflect.getMetadata, 'function', 'the library works as before');
    assert.equal(loadReflectMetadataForLockdown(), false, 'only once');

    // What the connection's encrypted channel loads, found the same way the connection finds it.
    let at = import.meta.url;
    for (const name of ['mineflayer', 'bedrock-protocol', 'nethernet', 'werift']) at = createRequire(at).resolve(name);
    assert.equal(typeof createRequire(at)('@peculiar/x509').X509Certificate, 'function');

    // SES warns about each piece of the library it strips; that is expected, and kept out of the output here.
    const warn = console.warn, error = console.error, log = console.log;
    console.warn = console.error = console.log = () => {};
    try {
        lockdown();
    } finally {
        Object.assign(console, { warn, error, log });
    }
    assert.ok(Object.isFrozen(Reflect), 'the sandbox is set up');
    assert.equal(makeCompartment({}).evaluate('[1, 2, 3].map(n => n * 2).join()'), '2,4,6');
});
