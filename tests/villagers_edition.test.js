// SPDX-License-Identifier: CC0-1.0
// Mindcraft-CE's villager code (the `!entities` list, and finding a villager to trade with) asks the
// edition seam what a villager is, how old it is and what its job is, instead of reading Java's metadata
// itself. These tests swap in an edition that keeps all of that somewhere else, as Bedrock does, and
// check that the villager code follows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { getCommand } from '../src/agent/commands/index.js';
import { getVillagerProfession } from '../src/agent/library/world.js';
import { showVillagerTrades } from '../src/agent/library/skills.js';
import { registerEdition } from '../src/agent/edition/index.js';
import { javaEdition } from '../src/agent/edition/java.js';

// An edition whose villagers are called "trader_v9" and carry their facts in plain fields. The game data
// in these tests is Java's (none is loaded), so Java's answers are the ones swapped out.
const otherEdition = {
    ...javaEdition,
    villagerOf: entity => entity?.name === 'trader_v9'
        ? { baby: entity.facts.young, profession: entity.facts.job, level: entity.facts.rank }
        : null,
};

function withOtherEdition(run) {
    registerEdition('pc', otherEdition);
    return Promise.resolve().then(run).finally(() => registerEdition('pc', javaEdition));
}

const trader = (id, facts) => ({ id, name: 'trader_v9', type: 'mob', position: new Vec3(id, 64, 0), metadata: {}, facts });

test('a villager\'s job is read through the seam', () => withOtherEdition(() => {
    assert.equal(getVillagerProfession(trader(1, { young: false, job: 'cleric', rank: 2 })), 'Cleric L2');
    assert.equal(getVillagerProfession(trader(2, { young: false, job: 'mason', rank: null })), 'Mason', 'no level said');
    assert.equal(getVillagerProfession(trader(3, { young: false, job: null, rank: null })), 'Adult', 'a grown villager whose job is unknown');
    assert.equal(getVillagerProfession(trader(4, { young: true, job: null, rank: null })), 'Unknown');
}));

test('!entities counts villagers under one name, whatever the game calls them', () => withOtherEdition(() => {
    const entities = {
        1: trader(1, { young: false, job: 'librarian', rank: 1 }),
        2: trader(2, { young: true, job: null, rank: null }),
        3: { id: 3, name: 'cow', type: 'mob', position: new Vec3(3, 64, 0), metadata: {} },
    };
    const bot = { username: 'Bot', entity: { position: new Vec3(0, 64, 0) }, entities, players: {} };
    const text = getCommand('!entities').perform({ name: 'Bot', bot });
    assert.match(text, /entities: 2 villager\(s\) - Adults: \(1:Librarian L1\) - Baby IDs: 2 \(babies cannot trade\)/);
    assert.match(text, /entities: 1 cow\(s\)/);
    assert.doesNotMatch(text, /trader_v9/, 'the game\'s own name for them is not shown');
}));

function tradingBot(entities) {
    const opened = [];
    const bot = {
        username: 'Bot', output: '', entities, players: {},
        entity: { position: new Vec3(0, 64, 0) },
        registry: { entitiesByName: {} }, // this game has no "villager" entry, as Bedrock's has none by that id
        openVillager: async entity => {
            opened.push(entity.id);
            return { trades: [], close() {} };
        },
    };
    return { bot, opened };
}

test('a villager to trade with is recognised through the seam', () => withOtherEdition(async () => {
    const { bot, opened } = tradingBot({ 1: trader(1, { young: false, job: 'farmer', rank: 1 }) });
    await showVillagerTrades(bot, 1);
    assert.deepEqual(opened, [1], 'the villager was opened');
    assert.doesNotMatch(bot.output, /not a villager/);
}));

test('a baby villager, or something else, is not traded with', () => withOtherEdition(async () => {
    const { bot, opened } = tradingBot({
        1: trader(1, { young: true, job: null, rank: null }),
        2: { id: 2, name: 'cow', type: 'mob', position: new Vec3(2, 64, 0), metadata: {} },
    });
    assert.equal(await showVillagerTrades(bot, 1), false);
    assert.match(bot.output, /baby villager/);
    assert.equal(await showVillagerTrades(bot, 2), false);
    assert.match(bot.output, /Entity is not a villager/);
    assert.deepEqual(opened, []);
}));

test('asked for a villager that is not there, the bot lists those it can see', () => withOtherEdition(async () => {
    const { bot } = tradingBot({
        1: trader(1, { young: false, job: 'fletcher', rank: 3 }),
        2: trader(2, { young: true, job: null, rank: null }),
    });
    assert.equal(await showVillagerTrades(bot, 99), false);
    assert.match(bot.output, /1: Fletcher L3/);
    assert.match(bot.output, /2: baby villager/);
}));
