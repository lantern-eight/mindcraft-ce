// SPDX-License-Identifier: CC0-1.0
// The creeper reflex on a stand-in bot: it is registered after self_preservation, backs off from a lit
// creeper with the hold set first, leaves a creeper's fuse unread while it is out of view, and tells the
// model once per creeper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { ActionManager } from '../src/agent/action_manager.js';
import { heldFrom } from '../src/agent/action_hold.js';
import { initModes } from '../src/agent/modes.js';
import { installThreatReflexes } from '../src/agent/reflexes/install.js';
import { GAME_VERSION } from './helpers/game_version.js';

const registry = minecraftData(GAME_VERSION);
const SWELL = registry.entitiesByName.creeper.metadataKeys.indexOf('swell_dir');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A bot on a flat stone floor (top at y 63) that walks 0.3 blocks per 50 ms the way it last looked while
// "forward" is held, and straight away from the goal's spot while the pathfinder has a goal.
function makeBot() {
    const listeners = {};
    const controls = {};
    let facing = new Vec3(1, 0, 0);
    let goal = null;
    const bot = {
        username: 'Bot', output: '', interrupt_code: false, registry, health: 20, game: { gameMode: 'survival' },
        entity: { position: new Vec3(0.5, 64, 0.5), id: 0 },
        entities: {},
        inventory: { items: () => [] },
        controls, steps: [],
        on(name, fn) { (listeners[name] ??= []).push(fn); },
        emit(name, ...args) { for (const fn of listeners[name] ?? []) fn(...args); },
        blockAt: pos => (Math.floor(pos.y) <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }),
        nearestEntity(match) {
            return Object.values(this.entities).filter(match)
                .sort((a, b) => a.position.distanceTo(this.entity.position) - b.position.distanceTo(this.entity.position))[0] ?? null;
        },
        async lookAt(point) { const d = point.minus(bot.entity.position); facing = new Vec3(d.x, 0, d.z).normalize(); },
        setControlState(name, on) { controls[name] = on; },
        clearControlStates() { for (const key in controls) controls[key] = false; },
        pathfinder: {
            setMovements() {},
            setGoal(g) { goal = g; if (g) bot.steps.push('path'); },
            stop() { goal = null; },
        },
    };
    const timer = setInterval(() => {
        if (controls.forward) bot.entity.position = bot.entity.position.plus(facing.scaled(0.3));
        else if (goal?.goal) { // GoalInvert(GoalNear(x, y, z))
            const away = bot.entity.position.minus(new Vec3(goal.goal.x, bot.entity.position.y, goal.goal.z)).normalize();
            bot.entity.position = bot.entity.position.plus(away.scaled(0.3));
        }
    }, 50);
    bot.stopWalking = () => clearInterval(timer);
    return bot;
}

function makeAgent(profileModes = null) {
    const bot = makeBot();
    const messages = [];
    const hearing = new Set();
    const agent = {
        // Fair play's hearing, as its handle offers it: a listener told of each sound as it arrives.
        fairPlay: { onHeard: fn => { hearing.add(fn); return () => hearing.delete(fn); } },
        hear: sound => { for (const fn of hearing) fn(sound); },
        name: 'Bot', bot, task: null, shut_up: true, last_sender: null,
        prompter: { getInitModes: () => profileModes },
        self_prompter: { isActive: () => false, stopLoop() {} },
        openChat() {}, handleMessage: (role, text) => messages.push(text),
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        requestInterrupt() { bot.interrupt_code = true; bot.clearControlStates(); },
        isIdle: () => !agent.actions.executing,
    };
    agent.actions = new ActionManager(agent);
    initModes(agent);
    const installed = installThreatReflexes(agent, { config: { threat_reflexes: true } });
    return { agent, bot, messages, installed };
}
const creeper = (x, lit, extra = {}) => ({ id: 7, name: 'creeper', type: 'hostile', height: 1.7, position: new Vec3(x, 64, 0.5), metadata: { [SWELL]: lit ? 1 : -1 }, ...extra });

test('it is installed right after self_preservation, on, and nothing when the setting is off', () => {
    const { agent, bot } = makeAgent();
    const names = Object.keys(agent.bot.modes.getJson());
    assert.equal(names[names.indexOf('self_preservation') + 1], 'creeper_safety');
    assert.equal(agent.bot.modes.isOn('creeper_safety'), true);
    assert.equal(installThreatReflexes(agent, { config: {} }), null, 'missing setting: off');
    bot.stopWalking();
});

test('a lit creeper 2 blocks away: the hold goes up first, then the bot sprints straight away, past 7 blocks', async () => {
    const { agent, bot, installed } = makeAgent();
    bot.entities[7] = creeper(-1.5, true);
    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    agent.bot.modes.setOn('cowardice', false); // backing off from a lit creeper doesn't answer to cowardice
    installed.creeper.round(agent);
    assert.ok(heldFrom(agent, 'mode:self_defense'), 'lower reflexes are held from the start');
    assert.equal(heldFrom(agent, 'mode:self_preservation'), null, 'the reflex before it is not');
    await delay(20);
    assert.equal(agent.actions.currentActionLabel, 'mode:creeper_safety');
    assert.equal(bot.controls.sprint, true);
    await waitUntil(() => !agent.actions.executing, 4000);
    assert.ok(bot.entity.position.x - (-1.5) >= 7, `ended ${bot.entity.position.x + 1.5} blocks away`);
    assert.ok(bot.entity.position.x > 0.5, 'it went away from the creeper, not toward it');
    const step = events.find(e => e.event === 'step');
    assert.equal(step.how, 'dash', 'the first step needed no path search');
    assert.ok(heldFrom(agent, 'mode:self_defense'), 'held for a moment after');
    bot.stopWalking();
});

test('the model is told once per creeper, however often it comes back', async () => {
    const { agent, bot, installed, messages } = makeAgent();
    // The bot is busy when the creeper lights.
    agent.actions.runAction('action:collectBlocks', () => new Promise(() => {}));
    await delay(10);
    bot.entities[7] = creeper(-1.5, true);
    installed.creeper.round(agent);
    await waitUntil(() => !agent.actions.executing, 4000);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /interrupted by creeper_safety: A creeper is about to explode \(west, very close\); backing off\./);
    // The model starts something again, and the same creeper comes back lit.
    agent.actions.runAction('action:collectBlocks', () => new Promise(() => {}));
    await waitUntil(() => agent.actions.executing, 3000);
    bot.entities[7] = creeper(bot.entity.position.x - 2, true);
    installed.creeper.round(agent);
    await waitUntil(() => agent.actions.currentActionLabel !== 'mode:creeper_safety' && !agent.actions.executing, 4000);
    assert.equal(messages.length, 1, 'no second message for the same creeper');
    bot.stopWalking();
});

test('a hiss heard close, with no creeper in view, starts a back-off at once, away from where it came from', async () => {
    const { agent, bot } = makeAgent();
    const events = [];
    bot.on('threat_reflex', event => events.push(event));
    agent.hear({ subject: 'creeper (hissing)', direction: 'east', distance: 'close', text: 'east, close', seen: false, news: true });
    assert.ok(heldFrom(agent, 'mode:self_defense'), 'held at once, without waiting for a round');
    await waitUntil(() => events.some(e => e.event === 'step'), 1000);
    const heard = events.find(e => e.event === 'heard'), step = events.find(e => e.event === 'step');
    assert.ok(step.at - heard.at < 300, `first step ${Math.round(step.at - heard.at)} ms after the hiss`);
    await waitUntil(() => !agent.actions.executing, 4000);
    assert.ok(bot.entity.position.x < -0.5, 'it went west, away from the hiss');
    bot.stopWalking();
});

test('other sounds, and a hiss far off, start nothing', () => {
    const { agent, bot } = makeAgent();
    agent.hear({ subject: 'zombie', direction: 'east', distance: 'very close', text: 'east, very close', seen: false, news: false });
    agent.hear({ subject: 'creeper (hissing)', direction: 'east', distance: 'near', text: 'east, near', seen: false, news: true });
    assert.equal(agent.actions.executing, false);
    assert.equal(heldFrom(agent, 'mode:self_defense'), null);
    bot.stopWalking();
});

test('a creeper that slipped out of view is not read for its fuse', async () => {
    const { agent, bot, installed } = makeAgent();
    // A stand-in, as fair play hands out: its metadata reads through to the live creeper, which is lit.
    bot.entities[7] = creeper(-3.5, true, { lastSeenAt: Date.now() });
    installed.creeper.round(agent);
    assert.equal(agent.actions.executing, false, 'nothing seen lit, nothing within 3 blocks');
    bot.stopWalking();
});

test('a creeper seen dying is not backed off from, though it is still swollen', () => {
    const { agent, bot, installed } = makeAgent();
    bot.entities[7] = creeper(-1.5, true);
    bot.emit('entityDead', bot.entities[7]);
    installed.creeper.round(agent);
    assert.equal(agent.actions.executing, false);
    bot.stopWalking();
});

test('a profile that turns it off keeps it off', () => {
    const { agent, bot } = makeAgent({ creeper_safety: false });
    assert.equal(agent.bot.modes.isOn('creeper_safety'), false);
    bot.stopWalking();
});

async function waitUntil(check, ms) {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > ms) throw new Error('timed out');
        await delay(20);
    }
}
