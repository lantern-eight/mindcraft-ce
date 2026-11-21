// SPDX-License-Identifier: CC0-1.0
// The mob reflex and the fight on a stand-in bot: where they sit in the mode list, backing away from two
// zombies with the hold set first, one message per threat, a lone zombie fought and given up on, the fight
// leaving a crowd to the mob reflex, and `!stay` pausing neither the mob reflex nor the creeper reflex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import minecraftData from 'minecraft-data';
import { ActionManager } from '../src/agent/action_manager.js';
import { heldFrom } from '../src/agent/action_hold.js';
import { initModes } from '../src/agent/modes.js';
import { installThreatReflexes } from '../src/agent/reflexes/install.js';
import { GAME_VERSION } from './helpers/game_version.js';

const registry = minecraftData(GAME_VERSION);
const MOB_FLAGS = registry.entitiesByName.zombie.metadataKeys.indexOf('mob_flags');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A bot on a flat stone floor (top at y 63) that walks `stride` blocks (0.3) per 50 ms the way it last looked while
// "forward" is held, and straight away from the goal while the pathfinder has an inverted goal.
function makeBot({ stride = 0.3 } = {}) {
    const listeners = {};
    const controls = {};
    let facing = new Vec3(1, 0, 0);
    let goal = null;
    const bot = {
        username: 'Bot', output: '', interrupt_code: false, registry, health: 20, food: 20, game: { gameMode: 'survival' },
        entity: { position: new Vec3(0.5, 64, 0.5), id: 0 },
        entities: {}, controls, attacking: null,
        inventory: { items: () => [] }, heldItem: null,
        async equip(item) { bot.heldItem = item; },
        on(name, fn) { (listeners[name] ??= []).push(fn); },
        off(name, fn) { listeners[name] = (listeners[name] ?? []).filter(other => other !== fn); },
        attack(mob) { bot.attacking = mob; },
        emit(name, ...args) { for (const fn of listeners[name] ?? []) fn(...args); },
        blockAt: pos => (Math.floor(pos.y) <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }),
        nearestEntity(match) {
            return Object.values(this.entities).filter(match)
                .sort((a, b) => a.position.distanceTo(this.entity.position) - b.position.distanceTo(this.entity.position))[0] ?? null;
        },
        async lookAt(point) { const d = point.minus(bot.entity.position); facing = new Vec3(d.x, 0, d.z).normalize(); },
        async look(yaw) { facing = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw)); },
        setControlState(name, on) { controls[name] = on; },
        clearControlStates() { for (const key in controls) controls[key] = false; },
        pathfinder: {
            setMovements() {},
            setGoal(g) { goal = g; },
            stop() { goal = null; },
            getPathTo: async () => ({ status: 'success' }),
        },
    };
    // Away from every point of an inverted goal: GoalNear, or a GoalCompositeAny of them.
    const awayPoints = () => (goal?.goal?.goals ?? (goal?.goal ? [goal.goal] : [])).map(g => new Vec3(g.x, 64, g.z));
    const timer = setInterval(() => {
        if (controls.forward) bot.entity.position = bot.entity.position.plus(facing.scaled(stride));
        else if (awayPoints().length) {
            let away = new Vec3(0, 0, 0);
            for (const p of awayPoints()) away = away.plus(bot.entity.position.minus(p).normalize());
            bot.entity.position = bot.entity.position.plus(new Vec3(away.x, 0, away.z).normalize().scaled(stride));
        }
    }, 50);
    bot.stopWalking = () => clearInterval(timer);
    return bot;
}

function makeAgent(profileModes = null, { threatRules, stride } = {}) {
    const bot = makeBot({ stride });
    const messages = [];
    const agent = {
        name: 'Bot', bot, task: null, shut_up: true, last_sender: null,
        prompter: { getInitModes: () => profileModes, profile: threatRules === undefined ? {} : { threat_rules: threatRules } },
        self_prompter: { isActive: () => false, stopLoop() {} },
        openChat() {}, handleMessage: (role, text) => messages.push(text),
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt() { bot.interrupt_code = true; bot.clearControlStates(); },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const ordersDir = mkdtempSync(path.join(tmpdir(), 'threat-rules-'));
    const installed = installThreatReflexes(agent, { config: { threat_reflexes: true }, ordersDir });
    return { agent, bot, messages, installed };
}
let nextId = 100;
const zombie = (x, z = 0.5, aggressive = true) => ({
    id: nextId++, name: 'zombie', type: 'hostile', height: 1.95, position: new Vec3(x, 64, z), metadata: { [MOB_FLAGS]: aggressive ? 0x04 : 0 },
});
const put = (bot, ...mobs) => { for (const mob of mobs) bot.entities[mob.id] = mob; return mobs; };

test('the mob reflex sits right after the creeper reflex; the fight keeps self_defense\'s place and switch', () => {
    const { agent, bot } = makeAgent();
    const names = Object.keys(agent.bot.modes.getJson());
    assert.deepEqual(names.slice(0, 3), ['self_preservation', 'creeper_safety', 'mob_safety']);
    assert.equal(names[names.indexOf('cowardice') + 1], 'self_defense');
    assert.equal(agent.bot.modes.isOn('mob_safety'), true);
    assert.equal(agent.bot.modes.isOn('self_defense'), true);
    bot.stopWalking();
});

test('two zombies coming: the hold goes up first, then the bot backs away from both, past 16 blocks', async () => {
    const { agent, bot, installed } = makeAgent();
    put(bot, zombie(-4.5, 0.5), zombie(0.5, -5.5));
    installed.mob.round(agent);
    assert.ok(heldFrom(agent, 'mode:self_defense'), 'the fight is held from the start');
    assert.equal(heldFrom(agent, 'mode:creeper_safety'), null, 'the creeper reflex, before it, is not');
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:mob_safety');
    await waitUntil(() => !agent.actions.executing, 9000);
    const p = bot.entity.position;
    assert.ok(p.x > 0.5 && p.z > 0.5, `away from both (west and north): ${p}`);
    assert.ok(Math.hypot(p.x + 4.5, p.z - 0.5) >= 16 && Math.hypot(p.x - 0.5, p.z + 5.5) >= 16, `past 16 from each: ${p}`);
    bot.stopWalking();
});

for (const view of ['all around', 'through a player\'s screen']) {
    test(`two zombies that slip out of view while the bot backs away, seeing ${view}`, async () => {
        // A slow walker: the zombies have been out of view 2 s before it gets far enough.
        const { agent, bot, installed } = makeAgent(null, { stride: 0.1 });
        // Through a player's screen the bot backs away facing the way out, so the zombies leave its view at
        // once: that says nothing about whether they have lost it, and it goes on to its distance.
        if (view !== 'all around') agent.fairPlay = { looks: { getScreen: () => ({}) } };
        const events = [];
        bot.on('threat_reflex', event => events.push(event));
        const mobs = put(bot, zombie(-4.5, 0.5), zombie(0.5, -5.5));
        try {
            installed.mob.round(agent);
            await delay(100);
            for (const mob of mobs) delete bot.entities[mob.id]; // out of view
            await waitUntil(() => !agent.actions.executing, 12000);
            const done = events.find(e => e.event === 'done');
            if (view === 'all around') assert.equal(done?.ended, 'done', 'all around, out of view means they lost it');
            else assert.equal(done?.ended, 'far enough', 'it went on to its distance');
        } finally {
            bot.stopWalking();
        }
    });
}

test('the model is told once per threat, however often the crowd comes back', async () => {
    const { agent, bot, installed, messages } = makeAgent();
    agent.actions.runAction('action:collectBlocks', () => new Promise(() => {}));
    await delay(10);
    const crowd = put(bot, zombie(-3.5), zombie(-4.5, 2.5));
    installed.mob.round(agent);
    await waitUntil(() => !agent.actions.executing, 9000);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /interrupted by mob_safety: Two zombies are coming at me \(west, very close\); backing away from them\./);
    agent.actions.runAction('action:collectBlocks', () => new Promise(() => {}));
    await waitUntil(() => agent.actions.executing, 3000);
    await delay(1600); // the hold after the move
    for (const mob of crowd) mob.position = bot.entity.position.offset(-3, 0, 0);
    installed.mob.round(agent);
    await waitUntil(() => agent.actions.currentActionLabel !== 'mode:mob_safety' && !agent.actions.executing, 9000);
    assert.equal(messages.length, 1, 'no second message for the same crowd');
    bot.stopWalking();
});

test('a lone zombie is fought; two are not; one that has not come for the bot is left alone', async () => {
    const { agent, bot, installed } = makeAgent();
    const [one] = put(bot, zombie(-3.5));
    await installed.fight.round(agent);
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:self_defense');
    await waitUntil(() => bot.attacking, 3000); // it closes in, then swings
    assert.equal(bot.attacking.id, one.id);
    delete bot.entities[one.id]; // it dies
    await waitUntil(() => !agent.actions.executing, 3000); // the fight stops when the mob is gone

    put(bot, zombie(-3.5), zombie(-5.5));
    await installed.fight.round(agent);
    assert.equal(agent.actions.executing, false, 'two: no fight');
    bot.entities = {};
    put(bot, zombie(-3.5, 0.5, false));
    await installed.fight.round(agent);
    assert.equal(agent.actions.executing, false, 'no target: no fight');
    bot.stopWalking();
});

test('a zombie the bot can\'t walk to is not fought', async () => {
    const { agent, bot, installed } = makeAgent();
    bot.pathfinder.getPathTo = async () => ({ status: 'noPath' });
    put(bot, zombie(-3.5));
    await installed.fight.round(agent);
    assert.equal(agent.actions.executing, false);
    bot.stopWalking();
});

test('hurt and with a zombie coming, the bot backs away instead of fighting', async () => {
    const { agent, bot, installed } = makeAgent();
    bot.health = 8;
    put(bot, zombie(-3.5));
    await installed.fight.round(agent);
    assert.equal(agent.actions.executing, false, 'no fight under half health');
    installed.mob.round(agent);
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:mob_safety');
    await waitUntil(() => !agent.actions.executing, 9000);
    assert.ok(bot.entity.position.x > 10, `went east, away: ${bot.entity.position}`);
    bot.stopWalking();
});

test('armed, the built-in order fights two zombies one after the other, without stopping in between, instead of backing away', async () => {
    const { agent, bot, installed, messages } = makeAgent();
    bot.inventory.items = () => [{ name: 'iron_sword' }];
    const [near, far] = put(bot, zombie(-3.5), zombie(-5.5, 2.5));
    installed.mob.round(agent);
    assert.equal(agent.actions.executing, false, 'no crowd retreat');
    agent.actions.runAction('action:collectBlocks', () => new Promise(() => {}));
    await delay(10);
    await installed.fight.round(agent);
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:self_defense');
    await waitUntil(() => bot.attacking, 3000);
    assert.equal(bot.attacking.id, near.id, 'the nearer one first');
    assert.equal(bot.heldItem?.name, 'iron_sword');
    delete bot.entities[near.id];
    await waitUntil(() => bot.attacking.id === far.id, 3000); // then the other, in the same fight
    assert.equal(agent.actions.currentActionLabel, 'mode:self_defense');
    bot.health = 9; // under the order's minimum: the fight stops, and the crowd rules are back
    await waitUntil(() => !agent.actions.executing, 3000);
    assert.match(messages[0], /Fighting the zombie \(west, very close\), as I was told to\./, 'the model is told once, as it ends');
    bot.stopWalking();
});

test('a standing order given by command applies at the next round: flee from a lone zombie', async () => {
    const { agent, bot, installed } = makeAgent(null, { threatRules: {} });
    put(bot, zombie(-3.5));
    installed.mob.round(agent);
    assert.equal(agent.actions.executing, false, 'a lone zombie is a fair fight');
    installed.orders.give('zombies', 'flee', { distance: 12 });
    installed.mob.round(agent);
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:mob_safety');
    await waitUntil(() => !agent.actions.executing, 9000);
    assert.ok(bot.entity.position.x >= 8, `went east, away: ${bot.entity.position}`);
    bot.stopWalking();
});

test('!stay pauses the fight, but not the mob reflex', async () => {
    const { agent, bot } = makeAgent();
    agent.actions.runAction('action:stay', () => new Promise(() => {}));
    await delay(10);
    // What the stay skill pauses, by name.
    for (const name of ['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'torch_placing', 'item_collecting'])
        agent.bot.modes.pause(name);
    put(bot, zombie(-3.5), zombie(-4.5, 2.5));
    await agent.bot.modes.update();
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:mob_safety', 'it backs away from the crowd anyway');
    await waitUntil(() => !agent.actions.executing, 9000);
    bot.stopWalking();
});

// Last: what a profile says about the modes is kept for the rest of the process, as for a real agent.
test('a profile that turns them off keeps them off', () => {
    const { agent, bot } = makeAgent({ self_defense: false, mob_safety: false });
    assert.equal(agent.bot.modes.isOn('self_defense'), false);
    assert.equal(agent.bot.modes.isOn('mob_safety'), false);
    bot.stopWalking();
});

async function waitUntil(check, ms) {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > ms) throw new Error('timed out');
        await delay(20);
    }
}

test('the armor the bot wears, in the points its armor bar shows', async () => {
    const { armorOf } = await import('../src/agent/reflexes/mobs.js');
    const wearing = (...names) => {
        const slots = {};
        names.forEach((name, i) => { slots[5 + i] = name ? { name } : null; });
        return { inventory: { slots }, getEquipmentDestSlot: part => ({ head: 5, torso: 6, legs: 7, feet: 8 })[part] };
    };
    assert.equal(armorOf(wearing('iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots')), 15, 'a full iron set');
    assert.equal(armorOf(wearing('diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots')), 20);
    assert.equal(armorOf(wearing(null, 'diamond_chestplate', 'iron_leggings', null)), 13);
    assert.equal(armorOf(wearing('turtle_helmet', 'leather_chestplate', null, 'chainmail_boots')), 6);
    assert.equal(armorOf(wearing(null, null, null, null)), 0);
    assert.equal(armorOf({ inventory: { slots: {} } }), 0, 'a bot that can\'t say where armor goes');
});
