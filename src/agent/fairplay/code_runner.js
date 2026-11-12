// The fair-play code runner: one place where all model-written code runs.
//
// CE has three ways to run generated code, and only one is sandboxed: `!newAction` runs in an SES
// compartment but is handed the raw bot; `executeCode` uses host `new Function` with the whole agent;
// generated augments are written into src/ and imported as real modules. SES confines globals, not
// capabilities: whatever objects you hand in, the code can use. So containment here means handing in
// different objects:
//   bot     the fair facade (fair_bot.js), not mineflayer's bot
//   skills  CE's skills, re-bound so each call swaps the facade for the real bot inside
//   world   CE's world queries, re-bound the same way (fair once world.js uses the fair provider)
//   Vec3    the vector factory, hardened so code can't rewrite vector math the guards rely on
//   log, console.log   write to the real bot's action output
// No agent, no process, no require/import, no timers. Every snippet gets a fresh compartment, so code
// can't leave something on a global for a later snippet to trip over.
//
// What this does NOT give: protection from a CPU-bound loop (`while (true) {}` without an await stalls
// the agent). That needs a worker thread or process. Keep allow_insecure_coding off unless you need it.
import { lockdown, makeCompartment } from '../library/lockdown.js';
import { createFairBot } from './fair_bot.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Names the runner itself puts in scope; a parameter with one of these names would shadow it.
const RESERVED = new Set(['bot', 'skills', 'world', 'Vec3', 'log', 'console', 'agent', 'args', 'arguments', 'eval']);

/**
 * @param {object} options
 * @param {object} options.realBot - the mineflayer bot
 * @param {object} options.skills - the skills module (or a test double)
 * @param {object} options.world - the world module (or a test double)
 * @param {function} options.log - skills.log: (bot, message) => void
 * @param {function} options.Vec3 - the vec3 factory
 * @param {object} options.perception - see createFairBot
 * @param {function} [options.guard] - see createFairBot
 * @param {function} [options.chatGuard] - see createFairBot
 * @param {function} [options.isCheatOn] - () => boolean; skills refuse to run while it's true, as a
 *   backstop in case cheat mode got switched on despite the mode lock
 */
export function createCodeRunner({ realBot, skills, world, log, Vec3, perception, guard, chatGuard, isCheatOn = () => false }) {
    lockdown();
    const harden = globalThis.harden;
    // Freezing the vector factory and its prototype for everyone is deliberate: generated code receives
    // real Vec3 instances, and without this it could replace `distanceTo` and fool the reach guard.
    harden(Vec3);

    const facade = createFairBot(realBot, { Vec3, perception, guard, chatGuard });
    const { fairBot, toLive, toSafe } = facade;

    // The real bot when code passes the facade; live objects for snapshots; everything else unchanged.
    // A function argument (a predicate like `b => b.name === 'sand'`) is called by host code with live
    // blocks or entities, so it is wrapped to receive snapshots instead: otherwise it could stash a
    // live object and read it later.
    const toHostArg = arg => {
        if (arg === fairBot) return realBot;
        if (typeof arg === 'function') return (...values) => arg(...values.map(v => toSafe(v)));
        return toLive(arg);
    };

    /** Wraps every function in a module so generated code can call it with the facade and snapshots. */
    function rebind(module, { blockInCheatMode }) {
        const bound = {};
        for (const [name, fn] of Object.entries(module)) {
            if (typeof fn !== 'function') continue;
            bound[name] = (...args) => {
                if (blockInCheatMode && isCheatOn())
                    throw new Error('Skills are disabled while cheat mode is on; fair play forbids cheat mode.');
                const result = fn(...args.map(toHostArg));
                return result && typeof result.then === 'function' ? result.then(v => toSafe(v)) : toSafe(result);
            };
        }
        return bound;
    }

    const write = message => log(realBot, String(message));
    const endowments = harden({
        bot: fairBot,
        skills: rebind(skills, { blockInCheatMode: true }),
        world: rebind(world, { blockInCheatMode: false }),
        Vec3,
        log: (_bot, ...message) => write(message.join(' ')),
        console: { log: (...message) => write(message.join(' ')) },
    });

    /** Evaluates source that must produce a function, in a fresh compartment. */
    function compile(source) {
        const compartment = makeCompartment(endowments);
        const fn = compartment.evaluate(String(source));
        if (typeof fn !== 'function') throw new Error('Generated code must evaluate to a function.');
        return fn;
    }

    /**
     * Compiles a function body (what executeCode and augments produce) into a callable.
     * @param {string[]} paramNames - plain identifiers, passed by position after nothing else
     * @param {string} body - the function body; may use await
     * @returns {(...args) => Promise<any>} runs with the fair bot in scope; results come back as snapshots
     */
    function compileBody(paramNames, body) {
        for (const name of paramNames) {
            if (!IDENTIFIER.test(name) || RESERVED.has(name)) throw new Error(`Invalid parameter name: ${name}`);
        }
        const fn = compile(`(async (${paramNames.join(', ')}) => {\n${body}\n})`);
        return async (...args) => toSafe(await fn(...args));
    }

    /**
     * Compiles CE's exec template, which evaluates to `async (bot) => { ... }`, and returns a
     * `main()` that runs it with the fair bot. This is what !newAction uses.
     */
    function compileTemplate(templateSource) {
        const fn = compile(templateSource);
        return { main: async () => toSafe(await fn(fairBot)) };
    }

    return { fairBot, endowments, compile, compileBody, compileTemplate };
}
