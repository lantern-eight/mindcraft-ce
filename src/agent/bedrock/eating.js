// SPDX-License-Identifier: CC0-1.0
// Eating when hungry, on Bedrock.
//
// On Java a plugin does this (mineflayer-auto-eat), and the agent sets it up by name when it starts:
// `bot.autoEat.setOpts(...)`, then `bot.autoEat.enableAuto()`. That plugin can't be loaded on Bedrock. A
// helper it brings along compares version numbers in a way a Bedrock version has no answer to, and stops
// while loading. What the plugin does is small, though, and the adapter has the one call it needs
// (`bot.consume`). So this is the same behavior written for a Bedrock bot, with the same switches, and it
// is put where the agent looks for it.
//
// The numbers it starts with are the plugin's own, so a Bedrock bot and a Java bot get hungry alike.
import { createRequire } from 'node:module';
import { withoutAction } from '../action_context.js';

const require = createRequire(import.meta.url);

// The plugin's defaults. The agent overrides some of them when it starts (see agent.js).
const DEFAULTS = {
    minHunger: 15,           // eat when hunger (0 to 20) is below this
    minHealth: 14,           // or when health is below this: health comes back from food
    priority: 'foodPoints',  // which number in the food table picks the meal
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
    returnToLastItem: true,  // hold again what was in hand before the meal
};

// The bot looks at its hunger once in this many game ticks: about once a second.
const TICKS_BETWEEN_LOOKS = 20;

// A meal that has not finished after this long is said to be stuck. Eating takes under two seconds, and the
// adapter gives up on the eating part itself after four.
const SLOW_MEAL_MS = 10_000;

// The same thing gone wrong is said again only after this long. A hungry bot tries again every second, and
// the log would otherwise fill with one line.
const QUIET_REPEATS_MS = 30_000;

// A look at hunger is due every second, on the game's ticks. When none has come for this long, the ticks
// have stopped, and a timer of its own says so: a bot whose ticks stopped would otherwise never look, and
// so never say anything either.
const NO_LOOK_MS = 10_000;

/**
 * What is food, and how filling, for the items a Bedrock server has.
 *
 * The installed game data has no table of foods for Bedrock. What a food is worth is the same in both
 * editions, and current Bedrock names its foods as Java does, so Java's table is read and narrowed to the
 * items this server really has. A food it has no item for can't be in the bot's hands anyway.
 */
export function foodValues(itemsByName) {
    if (!itemsByName) return {};
    const minecraftData = require('minecraft-data');
    const { latestSupportedVersion } = require('mineflayer');
    const java = minecraftData(latestSupportedVersion)?.foodsByName ?? {};
    return Object.fromEntries(Object.entries(java).filter(([name]) => itemsByName[name]));
}

/**
 * The thing the agent finds at `bot.autoEat` on Bedrock. Nothing happens until `enableAuto()` is called.
 *
 * `log`, `now`, `slowMealMs` and `noLookMs` are only parameters so that a test can watch what it says, and when.
 */
export function bedrockEater(bot, { log = console.log, now = Date.now, slowMealMs = SLOW_MEAL_MS, noLookMs = NO_LOOK_MS } = {}) {
    const opts = { ...DEFAULTS };
    let foods = null; // read on first use: the bot's own item list is not there until it has joined
    let eating = false;
    let enabled = false;
    let ticks = 0;
    let lastLook = 0;     // when hunger was last looked at
    let watchdog = null;  // the timer that notices when the looks stop
    // The meal under way: when it started, and which part of it is running. Shared with check(), which says
    // what a hungry bot is waiting on.
    let mealStartedAt = 0;
    let step = '';

    // A meal that goes wrong is no error (see eat()), but it is said, so that a bot that stays hungry can
    // be told apart from one that has no food. Each thing is said once, and again only after a while. `key`
    // names the thing, for a line whose numbers change from one time to the next.
    const lastSaid = new Map();
    function say(line, key = line) {
        const at = now();
        if (at - (lastSaid.get(key) ?? -Infinity) < QUIET_REPEATS_MS) return;
        lastSaid.set(key, at);
        log(`[bedrock] ${line}`);
    }
    const reasonOf = error => error?.message ?? String(error);

    // Why a hungry bot is not eating, said rarely. Each reason has its own quiet time, so a new one is said at
    // once. Every way check() can pass up a meal says something here: once, a bot sat at no hunger with its
    // bread untouched for most of a minute, and nothing said why.
    const hungerNow = () => `hunger ${bot.food} of 20, health ${bot.health}`;
    const notEating = (reason, why) => say(`Hungry (${hungerNow()}), but not eating: ${why}`, `not eating: ${reason}`);

    const foodTable = () => (foods ??= foodValues(bot.registry?.itemsByName));

    // The best meal the bot is holding, or nothing.
    function choose() {
        const table = foodTable();
        const worth = item => table[item.name]?.[opts.priority] ?? 0;
        return (bot.inventory?.items?.() ?? [])
            .filter(item => table[item.name] && !opts.bannedFood.includes(item.name))
            .sort((a, b) => worth(b) - worth(a))[0] ?? null;
    }

    async function eat(food) {
        eating = true;
        mealStartedAt = now();
        const held = bot.heldItem;
        // Which part of the meal is under way, to say where it went wrong or got stuck.
        step = `taking ${food.name} in hand`;
        // Nothing here stops a meal that hangs: taking food in hand has no time limit of its own, and the
        // next look waits for this meal. So it is at least said where it is stuck.
        const stuck = setTimeout(() => {
            say(`A meal is stuck: ${step} has not finished after ${Math.round(slowMealMs / 1000)} s. The bot eats again once it does.`);
        }, slowMealMs);
        stuck.unref?.();
        try {
            await bot.equip(food, 'hand');
            step = `eating ${food.name}`;
            await bot.consume();
            return true;
        } catch (error) {
            // A meal can be cut short: the bot is hit, a skill takes the hand back, the food is gone. That
            // is no error. The bot is still hungry, and looks again in a second.
            say(`Couldn't eat: ${step} failed: ${reasonOf(error)}`);
            return false;
        } finally {
            clearTimeout(stuck);
            try {
                if (opts.returnToLastItem && held && held.name !== food.name) {
                    const again = bot.inventory.items().find(item => item.type === held.type);
                    if (again) await bot.equip(again, 'hand');
                }
            } catch { /* nothing to hold again; the next skill equips what it needs */ }
            eating = false;
        }
    }

    // Whether the bot wants a meal: hungry, or hurt and not full. A full stomach takes no food.
    const wantsFood = () => (bot.food < opts.minHunger || bot.health < opts.minHealth) && bot.food < 20;

    // One look at the bot's hunger, and a meal if it wants one.
    async function check() {
        // Hunger the bot can't read is never "low", so it would never eat, without a word.
        if (!Number.isFinite(bot.food)) {
            say(`Can't tell how hungry the bot is: its hunger reads ${bot.food}.`, 'not eating: hunger unknown');
            return;
        }
        if (!wantsFood()) return;
        if (eating) {
            const seconds = Math.round((now() - mealStartedAt) / 1000);
            // A meal takes under two seconds. One still running a few seconds later is worth a word.
            if (seconds >= 5) notEating('meal', `a meal is still under way from ${seconds} s ago (${step}).`);
            return;
        }
        // The server refuses a change of what the bot holds while a chest or the like is open, and a
        // sleeping bot can't eat. Both pass, and the bot is still hungry afterwards.
        if (bot.currentWindow) {
            notEating('window', `a window is open (${bot.currentWindow.type ?? bot.currentWindow.title ?? 'a container'}), and the server refuses a change of what is in hand while one is.`);
            return;
        }
        if (bot.isSleeping) {
            notEating('asleep', 'the bot is asleep.');
            return;
        }
        const food = choose();
        if (!food) {
            const banned = (bot.inventory?.items?.() ?? []).filter(item => opts.bannedFood.includes(item.name) && foodTable()[item.name]);
            notEating('food', banned.length
                ? `it holds only food it won't eat (${[...new Set(banned.map(item => item.name))].join(', ')}).`
                : 'it holds nothing to eat.');
            return;
        }
        await eat(food);
    }

    function onTick() {
        if (++ticks < TICKS_BETWEEN_LOOKS) return;
        ticks = 0;
        lastLook = now();
        // A meal belongs to no skill. It must not be stopped because the skill that happened to be running
        // was cancelled, so it runs outside any action (action_context.js).
        withoutAction(() => { check().catch(error => say(`Looking at hunger failed: ${reasonOf(error)}`)); });
    }

    // The looks come on the game's ticks, and the adapter stops its ticks while physics is off. A hungry bot
    // whose looks have stopped is said, with whether physics is on, by a timer that does not need the ticks.
    function noticeNoLooks() {
        if (!Number.isFinite(bot.food) || !wantsFood()) return;
        const seconds = Math.round((now() - lastLook) / 1000);
        if (now() - lastLook < noLookMs) return;
        const physics = bot.physicsEnabled === false ? 'physics is off' : 'physics is on';
        notEating('no looks', `hunger has not been looked at for ${seconds} s: the game's ticks have stopped (${physics}).`);
    }

    function enableAuto() {
        if (enabled) return;
        enabled = true;
        lastLook = now();
        bot.on('physicsTick', onTick);
        watchdog = setInterval(noticeNoLooks, Math.max(1000, noLookMs / 2));
        watchdog.unref?.();
        // The timer would outlive a bot that has left. Put away with it.
        bot.once?.('end', disableAuto);
    }

    function disableAuto() {
        if (!enabled) return;
        enabled = false;
        bot.removeListener('physicsTick', onTick);
        bot.removeListener?.('end', disableAuto);
        clearInterval(watchdog);
        watchdog = null;
    }

    return {
        opts,
        setOpts(changes) { Object.assign(opts, changes); },
        enableAuto,
        disableAuto,
        cancelEat() { if (eating) bot.deactivateItem?.(); },
        get isEating() { return eating; },
        get enabled() { return enabled; },
        check,
        noticeNoLooks,
    };
}
