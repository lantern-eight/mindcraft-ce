// SPDX-License-Identifier: CC0-1.0
// Keeps fair play from quietly springing a leak.
//
// Fair play works because everything that looks for a block or an entity asks world.js, which answers
// from what the bot can perceive. One skill that calls `bot.findBlocks` or reads `bot.entities` itself
// goes straight around that. This test reads the source and fails when such a call appears, so a new
// or ported skill has to use world.* (or explain itself in the list below) before it can land.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'src';
// The fair-play modules are the boundary itself: perception is the one place that may read raw data.
const SKIP = ['src/agent/fairplay/', 'src/agent/library/world_queries.js'];

// Raw ways of asking mineflayer what is out there.
const RAW_SEARCH = [
    [/\.findBlocks?\(/, 'findBlocks / findBlock'],
    [/\.nearestEntity\(/, 'nearestEntity'],
    [/\.entities\b/, 'the entity table'],
    [/\.players\[[^\]]+\]\??\.entity/, "a player's entity from the player list"],
];

// The few raw reads that are allowed, each with its reason. Matched by file and by the exact line.
const ALLOWED = [
    {
        file: 'src/agent/library/skills.js',
        line: 'if (!bot.entities[nearest.id]) pickedUp++;',
        why: 'Confirms that a dropped item the bot just walked onto is gone. It learns nothing about where anything is.',
    },
];

function* sourceFiles(dir) {
    for (const name of readdirSync(dir)) {
        const file = path.posix.join(dir, name);
        if (statSync(file).isDirectory()) yield* sourceFiles(file);
        else if (file.endsWith('.js')) yield file;
    }
}

test('P3: nothing outside the fair-play boundary searches the raw world', () => {
    const found = [];
    const used = new Set();
    for (const file of sourceFiles(ROOT)) {
        if (SKIP.some(prefix => file.startsWith(prefix))) continue;
        readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
            const line = text.trim();
            if (line.startsWith('//') || line.startsWith('*')) return; // comments and doc examples
            if (line.includes('worldQueries()')) return; // world.js asking the provider: the fair route
            for (const [pattern, what] of RAW_SEARCH) {
                if (!pattern.test(line)) continue;
                const allowed = ALLOWED.find(a => a.file === file && a.line === line);
                if (allowed) used.add(allowed);
                else found.push(`${file}:${index + 1} uses ${what}: ${line}`);
            }
        });
    }
    assert.deepEqual(found, [], 'Use world.* instead (see docs/core-hooks.md), or add the line to ALLOWED with a reason:\n' + found.join('\n'));
    assert.deepEqual(ALLOWED.filter(a => !used.has(a)).map(a => a.line), [], 'these ALLOWED entries no longer match anything; remove them');
});

test('every allowed raw read says why', () => {
    for (const entry of ALLOWED) assert.ok(entry.why.length > 20, entry.line);
});
