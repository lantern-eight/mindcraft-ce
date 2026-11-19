// SPDX-License-Identifier: CC0-1.0
// The idle look-around looks a baby in the eye, half as high as a grown mob. Whether a mob is a baby is
// asked of the edition seam, so a Bedrock calf counts too; Java's metadata entry means nothing there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { initModes } from '../src/agent/modes.js';
import { registerEdition } from '../src/agent/edition/index.js';
import { javaEdition } from '../src/agent/edition/java.js';

function lookedAtHeight(registry, calf) {
    const looks = [];
    const bot = {
        registry, entity: { position: new Vec3(0, 64, 0) }, entities: { 1: calf },
        nearestEntity: match => (match(calf) ? calf : null),
        lookAt: point => looks.push(point.y - 64), look: () => {},
    };
    const agent = { bot, task: null, isIdle: () => true, actions: { currentActionLabel: '' }, prompter: { getInitModes: () => null } };
    initModes(agent);
    for (const name of Object.keys(bot.modes.getJson())) bot.modes.setOn(name, name === 'idle_staring');
    return bot.modes.update().then(() => Math.round(looks[0] * 100) / 100);
}
const calf = metadata => ({ id: 1, name: 'cow', type: 'animal', height: 1.4, position: new Vec3(3, 64, 0), metadata });

test('on Java a calf is looked at half as high as a cow', async () => {
    assert.equal(await lookedAtHeight({}, calf({ 16: true })), 0.7);
    assert.equal(await lookedAtHeight({}, calf({ 16: false })), 1.4);
});

test('on Bedrock a calf is known by its flag, not by Java\'s entry', async () => {
    // A stand-in for Bedrock's answers: only isBaby matters here.
    registerEdition('bedrock-test', { ...javaEdition, isBaby: entity => Boolean(entity?.metadata?.flags?.baby) });
    const bedrock = { version: { type: 'bedrock-test' } };
    assert.equal(await lookedAtHeight(bedrock, calf({ flags: { baby: true } })), 0.7);
    assert.equal(await lookedAtHeight(bedrock, calf({ 16: true, flags: { baby: false } })), 1.4);
});
