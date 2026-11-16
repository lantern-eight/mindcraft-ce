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
 */
export function bedrockEater(bot) {
    const opts = { ...DEFAULTS };
    let foods = null; // read on first use: the bot's own item list is not there until it has joined
    let eating = false;
    let enabled = false;
    let ticks = 0;

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
        const held = bot.heldItem;
        try {
            await bot.equip(food, 'hand');
            await bot.consume();
            return true;
        } catch {
            // A meal can be cut short: the bot is hit, a skill takes the hand back, the food is gone. That
            // is no error. The bot is still hungry, and looks again in a second.
            return false;
        } finally {
            try {
                if (opts.returnToLastItem && held && held.name !== food.name) {
                    const again = bot.inventory.items().find(item => item.type === held.type);
                    if (again) await bot.equip(again, 'hand');
                }
            } catch { /* nothing to hold again; the next skill equips what it needs */ }
            eating = false;
        }
    }

    // One look at the bot's hunger, and a meal if it wants one.
    async function check() {
        if (eating) return;
        const wantsFood = bot.food < opts.minHunger || bot.health < opts.minHealth;
        if (!wantsFood || !(bot.food < 20)) return; // a full stomach takes no food
        // The server refuses a change of what the bot holds while a chest or the like is open, and a
        // sleeping bot can't eat. Both pass, and the bot is still hungry afterwards.
        if (bot.currentWindow || bot.isSleeping) return;
        const food = choose();
        if (food) await eat(food);
    }

    function onTick() {
        if (++ticks < TICKS_BETWEEN_LOOKS) return;
        ticks = 0;
        // A meal belongs to no skill. It must not be stopped because the skill that happened to be running
        // was cancelled, so it runs outside any action (action_context.js).
        withoutAction(() => { check().catch(() => {}); });
    }

    return {
        opts,
        setOpts(changes) { Object.assign(opts, changes); },
        enableAuto() {
            if (enabled) return;
            enabled = true;
            bot.on('physicsTick', onTick);
        },
        disableAuto() {
            if (!enabled) return;
            enabled = false;
            bot.removeListener('physicsTick', onTick);
        },
        cancelEat() { if (eating) bot.deactivateItem?.(); },
        get isEating() { return eating; },
        get enabled() { return enabled; },
        check,
    };
}
