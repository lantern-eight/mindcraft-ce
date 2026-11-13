// Fair-play settings must be on MindServer's list of known settings.
//
// An agent created from the MindServer page or its API has every setting that isn't on that list
// removed, and missing ones filled in from the list's defaults. If `fair_play` weren't listed, such an
// agent would start with the setting gone, which means "off": fair play silently disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import settings from '../settings.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';

const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));
const KEYS = ['fair_play', 'fair_play_custom', 'good_neighbor'];

// What MindServer does to the settings of an agent created through its API.
function throughMindServer(given) {
    const out = { ...given };
    for (const key in spec) if (!(key in out)) out[key] = spec[key].default;
    for (const key in out) if (!(key in spec)) delete out[key];
    return out;
}

test('every fair-play setting is listed, with the same default as settings.js', () => {
    for (const key of KEYS) {
        assert.ok(spec[key], `${key} is missing from settings_spec.json`);
        assert.deepEqual(spec[key].default, settings[key], `${key} has a different default in settings.js`);
    }
});

test('an agent created through MindServer keeps fair play: strict by default, or what it was given', () => {
    assert.equal(resolvePolicy(throughMindServer({ profile: { name: 'a' } })).mode, 'strict');
    const custom = throughMindServer({ profile: { name: 'a' }, fair_play: 'custom', fair_play_custom: { ores_through_walls: true } });
    assert.equal(resolvePolicy(custom).ores_through_walls, true);
    assert.equal(resolvePolicy(throughMindServer({ profile: { name: 'a' }, fair_play: 'off' })).mode, 'off');
});
