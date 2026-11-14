// SPDX-License-Identifier: CC0-1.0
// What the model can ask of world memory (!recall, !places, !namePlace), saved places kept in it, and
// turning the whole thing on through the fair-play installer with the `world_memory` setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { initModes } from '../src/agent/modes.js';
import { getCommand } from '../src/agent/commands/index.js';
import { setWorldQueries } from '../src/agent/library/world_queries.js';
import { installFairPlay } from '../src/agent/fairplay/install.js';
import { MemoryBank } from '../src/agent/memory_bank.js';
import { openMemory } from '../src/agent/memory/store.js';
import { scopeDir } from '../src/agent/memory/files.js';
import { placeBank } from '../src/agent/memory/install.js';
import { namePlace, placesText, recallText, withNotes } from '../src/agent/memory/commands.js';

const SCOPE = 'local:55916/w1/overworld';
const HERE = { x: 0.5, y: 64, z: 0.5 };

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** A memory filled by hand: a base with chests to the east, sand to the north, cows, wheat and a trail. */
function filled() {
    const now = clock();
    const memory = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'recall-')), scope: SCOPE, now });
    for (let x = 0; x <= 20; x += 0.25) { now.advance(50); memory.trail.visit({ x: x + 0.5, y: 64, z: 0.5 }); }
    const crumb = memory.trail.current;
    for (const [pos, name] of [[[20, 64, 2], 'chest'], [[22, 64, 2], 'chest'], [[21, 64, 4], 'furnace'], [[20, 64, 5], 'red_bed'], [[24, 64, 3], 'oak_door']]) {
        const { thing } = memory.things.see({ x: pos[0], y: pos[1], z: pos[2] }, name, { from: crumb });
        memory.places.noteThing(thing);
        memory.cells.write(...pos, name);
    }
    memory.things.setContents({ x: 20, y: 64, z: 2 }, [{ name: 'iron_ingot', count: 30 }, { name: 'bread', count: 4 }]);
    memory.things.see({ x: 3, y: 12, z: -40 }, 'diamond_ore');
    for (let x = 0; x < 6; x++) memory.cells.write(x, 63, -30, 'sand');
    memory.cells.markLooked(0, 3, -2, null);
    memory.things.setHerds(2, 4, 0, [{ kind: 'cow', count: 4, x: 40, y: 64, z: 3 }]);
    memory.things.setField(1, 4, 1, 'wheat', { count: 12, ripe: 5, min: { x: 16, y: 64, z: 16 }, max: { x: 19, y: 64, z: 18 } });
    now.advance(600_000);
    return { memory, now };
}

test('!recall answers for a block, a thing, a kind, an item, an animal, a crop, a place and changes', () => {
    const { memory, now } = filled();
    const recall = what => recallText(memory, HERE, what, { now });

    const sand = recall('sand').split('\n');
    assert.equal(sand[0], 'REMEMBERED sand (nearest first)');
    assert.match(sand[1], /^- at 0, 63, -30: 30 blocks north, seen 10 minutes ago$/);
    assert.equal(sand.at(-1), '- and more farther away');

    const chest = recall('chest').split('\n');
    assert.match(chest[1], /^- at 20, 64, 2: 20 blocks east, seen 10 minutes ago, about \d+ seconds on foot by a way you know; inside 10 minutes ago: iron_ingot 30, bread 4$/);
    assert.equal(chest.length, 3);

    assert.match(recall('containers'), /- chest at 20, 64, 2.*\n- furnace at 21, 64, 4.*\n- chest at 22, 64, 2/);
    assert.match(recall('doors'), /- oak_door at 24, 64, 3/);

    const iron = recall('iron');
    assert.match(iron, /^IN CONTAINERS YOU OPENED\n- chest at 20, 64, 2: iron_ingot 30 \(looked 10 minutes ago\), 20 blocks east, about \d+ seconds on foot/);
    assert.match(recall('diamond_ore'), /- at 3, 12, -40: \d+ blocks north/);
    assert.match(recall('cow'), /^ANIMALS YOU REMEMBER\n- cow x4 near 40, 64, 3: 40 blocks east, seen 10 minutes ago/);
    assert.match(recall('wheat'), /FIELDS YOU REMEMBER\n- wheat x12 \(5 ripe when last seen\) near 18, 64, 17/);
    assert.match(recall('unobtainium'), /^You don't remember any "unobtainium"\./);
    assert.equal(recall('changes'), 'You have not noticed any place changing.');

    memory.places.name(1, 'the base');
    assert.match(recall('The Base'), /^PLACE\n- "the base" near 22, 64, 4: chest 2, furnace 1, oak_door 1, red_bed 1 \(2\d blocks east\), about \d+ seconds on foot by a way you know$/);

    memory.changes.see({ x: 20, y: 64, z: 2, before: 'chest', after: 'air', place: 1, lookedBefore: true });
    now.advance(2000);
    memory.changes.settle();
    assert.equal(recall('changes'), 'CHANGES YOU NOTICED (newest first)\n- just now: Noticed at the base: Gone: chest 1.');
});

test('!places lists what is where, and !namePlace names the place the bot stands in', () => {
    const { memory } = filled();
    assert.equal(placesText(memory, HERE), 'PLACES YOU KNOW (nearest first)\n- an unnamed site near 22, 64, 4: chest 2, furnace 1, oak_door 1, red_bed 1 (22 blocks east)');
    assert.equal(namePlace(memory, { x: 21.5, y: 64, z: 3.5 }, ' home '), 'This place is now called "home".');
    assert.match(placesText(memory, { x: 21.5, y: 64, z: 3.5 }), /- "home" near 22, 64, 4: .* \(you are here\)$/);
    assert.equal(namePlace(memory, { x: -200.5, y: 70, z: 9.5 }, 'lookout'), 'There is no known site here, so this spot is saved as "lookout".');
    assert.match(placesText(memory, HERE), /- "lookout" near -201, 70, 9: nothing remembered there \(\d+ blocks west\)$/);

    const empty = openMemory({ baseDir: mkdtempSync(path.join(tmpdir(), 'recall-')), scope: SCOPE });
    assert.match(placesText(empty, HERE), /^You don't know of any places yet\./);
});

test('a change note is added to an action result once, and never when there is none', () => {
    const { memory, now } = filled();
    const result = { success: true, text: 'You have reached the base.', message: 'You have reached the base.' };
    assert.equal(withNotes(result, memory), result, 'nothing noticed: the result is untouched');
    memory.changes.see({ x: 20, y: 64, z: 2, before: 'chest', after: 'air', place: 1, lookedBefore: true });
    now.advance(2000);
    memory.changes.settle();
    assert.equal(withNotes(result, memory).text, 'You have reached the base.\nNoticed at a site near 20, 64, 2: Gone: chest 1.');
    assert.equal(withNotes(result, memory), result, 'each note is passed on once');
    assert.equal(withNotes(result, null), result);
    assert.equal(withNotes('plain text', memory), 'plain text');
});

test('saved places live in world memory, behind the same calls the old place bank had', () => {
    const { memory } = filled();
    const old = new MemoryBank();
    old.rememberPlace('mine', 5, 20, 5);            // saved before world memory was on
    let open = null;
    const bank = placeBank(() => open, old);
    assert.deepEqual(bank.recallPlace('mine'), [5, 20, 5], 'with no world open, the old bank answers');

    open = memory;
    bank.rememberPlace('camp', 100.5, 70, -3.5);
    assert.deepEqual(bank.recallPlace('camp'), [100.5, 70, -3.5]);
    assert.equal(memory.places.byName('camp').kind, 'named', 'it is a place now');
    assert.deepEqual(old.recallPlace('camp'), [100.5, 70, -3.5], 'and still in the old bank, so nothing is lost if memory is turned off');
    assert.deepEqual(bank.getJson(), { mine: [5, 20, 5], camp: [100.5, 70, -3.5] });
    assert.equal(bank.getKeys(), 'mine, camp');

    bank.loadJson({ mine: [5, 20, 5], quarry: [9, 40, 9] });   // the agent system loading its save file
    assert.deepEqual(memory.places.byName('quarry').spot, { x: 9, y: 40, z: 9 });
    assert.deepEqual(bank.recallPlace('quarry'), [9, 40, 9]);
    assert.equal(bank.recallPlace('nowhere'), undefined);
});

test('world_memory: true turns it all on through the fair-play installer, per world, and saves it', async () => {
    const w = fixtureWorld({ min: [-16, -4, -16], max: [16, 16, 16] });
    w.fill('stone', [-16, 0, -16], [16, 0, 16]);
    w.set('chest', 3, 1, 3);
    w.fill('stone', [5, 1, -3], [5, 3, 3]);
    w.set('sand', 8, 1, 0);                          // behind the wall
    const bot = stubBot(w);
    bot._client = new EventEmitter();
    bot.game = { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 };
    bot.worldIdentity = 'w1';
    bot.chat = () => {};
    bot.entity.onGround = true;
    const agent = {
        name: 'Fairy', bot, task: null, openChat: () => {}, memory_bank: new MemoryBank(),
        prompter: { profile: {}, getInitModes: () => ({}) },
        actions: { runAction: async () => ({ success: true, text: 'done', message: 'done' }) },
    };
    initModes(agent);
    const memoryDir = mkdtempSync(path.join(tmpdir(), 'fair-memory-'));
    const config = { fair_play: 'strict', world_memory: true, host: 'localhost', port: 1 };
    const handle = installFairPlay(agent, { config, memoryDir, perceptionOptions: { ...NO_BUDGETS } });
    try {
        assert.ok(handle.memory, 'world memory is open');
        assert.equal(handle.seenMap, null, 'in place of the seen-world map');
        assert.equal(handle.memory.scope, 'localhost:1/w1/overworld');
        handle.recorder.tick({ budgetMs: Infinity });
        assert.equal(handle.memory.cells.read(3, 1, 3), 'chest');
        assert.equal(handle.memory.cells.read(8, 1, 0), null, 'the sand behind the wall was not seen');

        // The model's commands answer from it.
        assert.match(getCommand('!recall').perform(agent, 'chest'), /^REMEMBERED chest \(nearest first\)\n- at 3, 1, 3/);
        assert.match(getCommand('!recall').perform(agent, 'sand'), /^You don't remember any "sand"/);
        assert.match(getCommand('!places').perform(agent), /an unnamed site near 3, 1, 3: chest 1/);
        assert.equal(getCommand('!namePlace').perform(agent, 'hut'), 'This place is now called "hut".');
        agent.memory_bank.rememberPlace('door', 1, 1, 1);
        assert.equal(handle.memory.places.byName('door').kind, 'named', 'a saved spot inside a named site is a place of its own');
        assert.deepEqual(agent.memory_bank.recallPlace('door'), [1, 1, 1]);

        // A new dimension gets a memory of its own; the old one is saved on the way out.
        bot.game.dimension = 'the_nether';
        bot.emit('spawn');
        assert.equal(handle.memory.scope, 'localhost:1/w1/the_nether');
        assert.equal(handle.memory.cells.read(3, 1, 3), null);
        assert.equal(existsSync(path.join(scopeDir(memoryDir, 'localhost:1/w1/overworld'), 'things.json')), true);
        assert.equal(openMemory({ baseDir: memoryDir, scope: 'localhost:1/w1/overworld' }).places.byName('hut').id, 1);
    } finally {
        bot.emit('end');
        setWorldQueries(null);
    }
});
