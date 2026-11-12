// Turns fair play on for one agent. Called once from agent.js, right after the modes are set up.
//
// What it installs, in order:
//   1. Mode lock: cheat mode can't be switched on by the model (!setMode), a player in chat, a profile,
//      or generated code. The server would refuse a non-operator's /tp anyway; the lock keeps the commands
//      from being sent at all.
//   2. Chat guard: slash commands other than a short allowlist (whispers) are dropped before they reach
//      the server. This also catches CE's login-time /skin command and any cheat branch a port forgets.
//   3. Permission watch: if the server makes the bot an operator or puts it outside survival, strict fair
//      play stops acting and says why, instead of quietly playing with powers a survival player lacks.
//   4. On spawn (and on every respawn, since the dimension may change): the seen-world map for this
//      server/world/dimension, the perception service, and the fair query provider for world.js.
// With `fair_play: "off"` (the default when the setting is absent) nothing is installed.
import settings from '../settings.js';
import { resolvePolicy } from './policy.js';
import { createPerception } from './perception.js';
import { loadSeenMap } from './seen_map.js';
import { fairQueries, registerFairPlay } from './fair_queries.js';
import { setWorldQueries } from '../library/world_queries.js';
import { createCodeRunner } from './code_runner.js';
import * as skills from '../library/skills.js';
import * as worldModule from '../library/world.js';
import Vec3 from 'vec3';

/**
 * Locks cheat mode off on a ModeController instance (bot.modes). Returns false from setOn when it
 * refuses, so callers like !setMode can say so honestly.
 */
export function lockModes(modes, policy, warn = console.warn) {
    if (policy.cheat_mode === true) return;
    const setOn = modes.setOn.bind(modes);
    const loadJson = modes.loadJson.bind(modes);
    modes.setOn = (name, on) => {
        if (name === 'cheat' && on) {
            warn('[fair play] Refused to turn on cheat mode.');
            return false;
        }
        return setOn(name, on);
    };
    modes.loadJson = json => loadJson(json?.cheat ? { ...json, cheat: false } : json);
    if (modes.isOn('cheat')) {
        warn('[fair play] The profile turned cheat mode on; fair play turned it back off.');
        setOn('cheat', false);
    }
}

/** Decides whether a chat message may be sent: plain chat always, slash commands only from the allowlist. */
export function makeChatGuard(policy) {
    const allowed = new Set(policy.slash_allowlist.map(c => c.toLowerCase()));
    return message => {
        const text = String(message);
        // mineflayer sends a message as a command only when its very first character is '/'.
        if (policy.slash_commands === true || !text.startsWith('/')) return { allowed: true };
        const command = text.slice(1).split(/\s+/)[0].toLowerCase().replace(/^minecraft:/, '');
        if (allowed.has(command)) return { allowed: true };
        return { allowed: false, reason: `Slash commands are off in fair play (/${command} was not sent).` };
    };
}

/** Wraps the real bot.chat with the chat guard. Blocked messages are dropped with a warning. */
export function guardChat(bot, chatGuard, warn = console.warn) {
    const chat = bot.chat;
    bot.chat = function (message, ...rest) {
        const verdict = chatGuard(message);
        if (!verdict.allowed) { warn(`[fair play] ${verdict.reason}`); return; }
        return chat.call(this, message, ...rest);
    };
}

/**
 * Watches for the server granting operator rights or a non-survival game mode. `onViolation(reason)`
 * runs once per new reason; `onClear()` runs when things are back to normal.
 */
export function watchPermissions(bot, { onViolation, onClear }) {
    let opLevel = 0;
    let current = null;
    const check = () => {
        const reasons = [];
        if (opLevel > 0) reasons.push(`the server made the bot an operator (level ${opLevel})`);
        const mode = bot.game?.gameMode;
        if (mode && mode !== 'survival') reasons.push(`the bot is in ${mode} mode, not survival`);
        const reason = reasons.join(' and ') || null;
        if (reason && reason !== current) onViolation(reason);
        if (!reason && current) onClear();
        current = reason;
    };
    // Entity status 24..28 on the bot's own entity is the server telling the client its operator level.
    bot._client?.on?.('entity_status', packet => {
        if (packet.entityId !== bot.entity?.id || packet.entityStatus < 24 || packet.entityStatus > 28) return;
        opLevel = packet.entityStatus - 24;
        check();
    });
    bot.on?.('game', check);
    return { check, get violation() { return current; } };
}

/** The memory scope: same shape as AgentSystem.scope(), so it works with or without native tools. */
export function scopeOf(bot, config = settings) {
    return `${config.host}:${config.port}/${config.world_id || bot.worldIdentity || 'unknown'}/${bot.game?.dimension || 'unknown'}`;
}

/**
 * @param {object} agent - the CE Agent, after initModes
 * @returns {object|null} the fair-play handle (also stored on agent.fairPlay), or null when off
 */
export function installFairPlay(agent, { config = settings, saveEveryMs = 60_000, seenDir = null, perceptionOptions = {} } = {}) {
    const policy = resolvePolicy({ ...config, ...(agent.prompter?.profile ?? {}) });
    if (policy.mode === 'off') return null;
    const bot = agent.bot;
    const chatGuard = makeChatGuard(policy);
    const say = message => { try { agent.openChat?.(message); } catch { /* chat may not be ready yet */ } };

    lockModes(bot.modes, policy);
    // mineflayer injects its plugins (bot.chat included) on 'inject_allowed', a tick after createBot
    // returns, and that injection would overwrite a wrapper installed earlier. So guard chat once the
    // plugins are in; our listener runs after mineflayer's own because it was registered later.
    if (typeof bot.chat === 'function') guardChat(bot, chatGuard);
    else bot.once('inject_allowed', () => guardChat(bot, chatGuard));

    // While fair play is broken (operator, creative, or a task harness that needs operator rights),
    // every action is refused with a reason the model can read.
    let violation = config.task ? "CE's task harness needs an operator bot; fair play uses the server console as director instead" : null;
    if (agent.actions?.runAction) {
        const runAction = agent.actions.runAction.bind(agent.actions);
        agent.actions.runAction = async (label, fn, options) => {
            if (!violation) return runAction(label, fn, options);
            const text = `Refused: fair play is on, but ${violation}.`;
            return { status: 'blocked', text, code: 'fair_play', success: false, message: text, interrupted: false, timedout: false };
        };
    }
    const permissions = watchPermissions(bot, {
        onViolation: reason => {
            violation = reason;
            console.error(`[fair play] ${reason}. Refusing to act until this is fixed.`);
            say(`Fair play is on, but ${reason}. I won't act until that's fixed.`);
        },
        onClear: () => { violation = null; say('Fair play conditions are back to normal.'); },
    });

    const handle = {
        policy, chatGuard,
        perception: null, seenMap: null,
        get violation() { return violation; },
        // Reach and good-neighbor guards plug in here (plan cards 2.2 and 3.x); the code runner calls it.
        guard: () => {},
        /**
         * The runner for model-written code (newAction, executeCode, augments). null when policy says
         * "raw" (stock behavior); throws when it says "off". One runner per agent, created on first use;
         * it reaches perception through `handle`, so it keeps working after a respawn swaps perception.
         */
        codeRunner() {
            if (policy.generated_code === 'raw') return null;
            if (policy.generated_code === 'off') throw new Error('Writing code is turned off by fair play.');
            if (!runner) {
                const perception = {
                    blockAt: pos => handle.perception?.blockAt(pos) ?? null,
                    findBlocks: options => handle.perception?.findBlocks(options) ?? [],
                    entities: () => handle.perception?.entities() ?? [],
                };
                runner = createCodeRunner({
                    realBot: bot, skills, world: worldModule, log: skills.log, Vec3, perception,
                    guard: (...args) => handle.guard(...args), chatGuard,
                    isCheatOn: () => Boolean(bot.modes?.isOn('cheat')),
                });
            }
            return runner;
        },
    };
    let runner = null;

    const mapDir = seenDir ?? `./bots/${agent.name}/seen`;
    const saveMap = () => {
        try { handle.seenMap?.save(mapDir); } catch (error) { console.warn('[fair play] Could not save the seen-world map:', error.message); }
    };

    // Each spawn may be a new dimension (or a new world identity), and each scope has its own memory.
    const onSpawn = () => {
        permissions.check();
        const scope = scopeOf(bot, config);
        if (handle.seenMap?.scope === scope && handle.perception) return;
        saveMap();
        handle.perception?.stop();
        handle.seenMap = loadSeenMap(mapDir, scope);
        handle.perception = createPerception({ bot, policy, seenMap: handle.seenMap, ...perceptionOptions });
        handle.perception.start();
        registerFairPlay(bot, { perception: handle.perception, policy });
        setWorldQueries(fairQueries);
    };
    bot.on('spawn', onSpawn);
    if (bot.entity?.position && bot.registry) onSpawn(); // already spawned (tests, late install)

    const saveTimer = setInterval(saveMap, saveEveryMs);
    saveTimer.unref?.();
    bot.on('end', () => { clearInterval(saveTimer); handle.perception?.stop(); saveMap(); });

    agent.fairPlay = handle;
    console.log(`[fair play] ${policy.mode} mode is on.`);
    return handle;
}
