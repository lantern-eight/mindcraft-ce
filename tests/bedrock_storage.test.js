// SPDX-License-Identifier: CC0-1.0
// Which block is the other half of a Bedrock double chest (src/agent/bedrock/edition.js). Chest sorting
// and world memory both ask it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bedrockEdition } from '../src/agent/bedrock/edition.js';

// ---- The other half of a double chest ----

// A chest's block entity as the bot gets it from a Bedrock server: an NBT compound, each field typed.
const entity = fields => ({ type: 'compound', name: '', value: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { type: 'int', value: v }])) });

test('a Bedrock chest names the other half of its double chest in its block entity', () => {
    const block = { position: { x: 2, y: -19, z: -2 }, entity: entity({ x: 2, y: -19, z: -2, pairx: 3, pairz: -2, pairlead: 1 }) };
    assert.deepEqual(bedrockEdition.otherHalfOf(block), { x: 3, y: -19, z: -2 });
    // The same, read from fields already stripped of their types, from a position inside the block.
    assert.deepEqual(bedrockEdition.otherHalfOf({ position: { x: 3.5, y: -19, z: -1.5 }, entity: { pairx: 2, pairz: -2 } }), { x: 2, y: -19, z: -2 });
});

test('a single chest, a chest the bot only remembers, and a pairing that cannot be one name no other half', () => {
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ x: 2, y: 0, z: 0 }) }), null, 'no pairing');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 } }), null, 'remembered: no block entity');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ pairx: 4, pairz: 0 }) }), null, 'two blocks away');
    assert.equal(bedrockEdition.otherHalfOf({ position: { x: 2, y: 0, z: 0 }, entity: entity({ pairx: 3, pairz: 1 }) }), null, 'corner to corner');
    assert.equal(bedrockEdition.otherHalfOf(null), null);
});
