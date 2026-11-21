// SPDX-License-Identifier: CC0-1.0
// Turns the threat reflexes on for an agent. Called once from agent.js, after fair play and chest sorting.
//
// The threat reflexes are their own feature behind their own setting (`threat_reflexes`). They need
// nothing else from this fork: with fair play off they see the way every stock reflex does, and with it on
// they see only what the bot sees, because they ask world.js. Fair play adds one thing, hearing: a creeper's
// hiss or an explosion reaches the reflex the moment the server sends it.
//
// In the order of the mode list, which is their priority:
//   - the creeper reflex, `creeper_safety` (creeper_reflex.js), right after `self_preservation`;
//   - the mob reflex, `mob_safety` (mob_reflex.js), right after it: low health, mobs aiming, crowds, hits
//     from something unseen;
//   - the fight (fight_reflex.js), which takes over Mindcraft's `self_defense` in its own place.
// The mob reflex and the fight share one set of claims (claims.js), one owner per threat. And every look
// the bot makes keeps clear of an enderman's eyes (gaze.js).
//
// A carried shield goes in the off-hand, and the moves raise it where a player would (shield.js): when an
// archer draws its bow, or, backing out of its range where the game shows no bow drawn (Bedrock), when the beat
// of its shots heard says the next is due (shot_beat.js). The
// shield, eating and the swing share the use-item channel (item_use.js), one owner at a time, so a meal
// doesn't drop the shield mid-block and the shield doesn't cut a meal short.
//
// Beside the reflexes, danger zones: the danger watch (danger_watch.js) remembers where the bot met
// danger for a while (danger_zones.js), and every route the bot plans pays to go deeper into one
// (src/agent/library/place_costs.js), so its walks bend round them.
//
// And standing orders (orders.js): what a player told the bot to do about a kind of mob, fight, flee or
// ignore, which all three reflexes apply. They start from the profile's `threat_rules`, and the model adds
// to them by command (order_commands.js), kept in the bot's own folder.
import settings from '../settings.js';
import { registerMode } from '../modes.js';
import { registerCommand } from '../commands/index.js';
import { createStandingOrders } from './orders.js';
import { loadSavedOrders, orderCommands, saveOrders } from './order_commands.js';
import { keepPathVerdicts } from '../library/path_verdicts.js';
import { createCreeperReflex } from './creeper_reflex.js';
import { createMobReflex } from './mob_reflex.js';
import { createFightReflex } from './fight_reflex.js';
import { createClaims } from './claims.js';
import { createItemUse, shareEating } from './item_use.js';
import { createShield } from './shield.js';
import { createShotBeat } from './shot_beat.js';
import { mobsAround } from './mobs.js';
import { guardGaze } from './gaze.js';
import { createGlance } from './glance.js';
import { createDangerZones } from './danger_zones.js';
import { createDangerWatch } from './danger_watch.js';
import { addPlaceCosts } from '../library/place_costs.js';

/**
 * @param {object} agent - the agent, once its modes are set up
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @param {string} [options.ordersDir] - the folder the standing orders set by command are kept in
 * @returns {{creeper: object, mob: object, fight: object, zones: object, orders: object}|null} what was
 *     installed, or null when the setting is off
 */
export function installThreatReflexes(agent, { config = settings, ordersDir = null } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.threat_reflexes !== true) return null;
    // The reflexes ask whether they can walk to a mob every round; an answer found a moment ago is kept.
    keepPathVerdicts(agent.bot);
    const orders = installOrders(agent, ordersDir ?? `./bots/${agent.name}`);
    // The use-item channel, shared with the eating plugin, which may come only as the bot joins.
    const use = createItemUse();
    if (!shareEating(agent.bot, use)) agent.bot.once?.('spawn', () => shareEating(agent.bot, use));
    const shield = createShield(agent.bot, { use });
    const creeper = createCreeperReflex({ orders, shield });
    registerMode(creeper.mode, { after: 'self_preservation' });
    // A new life, or a new world, starts with nothing known about creepers.
    agent.bot.on?.('respawn', () => creeper.picture.clear());
    creeper.watch(agent.bot);
    // Under fair play the bot hears, and a hiss reaches the reflex the moment it arrives. Without fair play
    // there is no hearing, and the reflex goes by sight alone.
    const zones = createDangerZones();
    const watch = createDangerWatch({ zones });
    const beat = createShotBeat();
    // Through a player's screen, a sound or a hit from what the bot can't see turns its head (glance.js).
    const glance = createGlance();
    agent.fairPlay?.onHeard?.(sound => {
        creeper.hear(agent, sound);
        glance.hear(agent, sound);
        watch.hear(agent, sound);
        // A shot heard, matched to the archer seen on that side (only shots: the rest pass at once).
        if (/ \(shooting\)$/.test(sound.subject) && agent.bot?.entity) beat.hear(sound, mobsAround(agent.bot), agent.bot.entity.position);
    });
    const claims = createClaims();
    let fight = null;
    // A mob the fight gave up on is the mob reflex's again, whatever the orders said (ordersAfterGivingUp).
    const mob = createMobReflex({ claims, orders, shield, beat, gaveUp: id => fight?.gaveUpOn(id) ?? false });
    registerMode(mob.mode, { after: creeper.mode.name });
    mob.watch(agent.bot);
    // The fight keeps the stock switch's state: on unless the profile or a command said otherwise.
    fight = createFightReflex({ claims, orders, shield, use });
    fight.mode.on = agent.bot.modes.exists('self_defense') ? agent.bot.modes.isOn('self_defense') : true;
    registerMode(fight.mode, { after: 'cowardice' });
    fight.watch(agent.bot);
    agent.bot.on?.('respawn', () => { mob.clear(); fight.clear(); claims.clear(); beat.clear(); glance.clear(); });
    // A hit from the unseen, and the end of a back-off, reach the glance through the reflexes' own reports.
    let ranFromStart = null;
    agent.bot.on?.('threat_reflex', event => {
        if (event.event === 'felt' && event.unseen) glance.felt(agent, event.direction);
        if (event.event === 'decided' && /flee|retreat|cover|back|leave/.test(String(event.stance))) ranFromStart = agent.bot.entity?.position?.clone?.() ?? null;
        if (event.event === 'done' && ranFromStart) { glance.ranFrom(agent, ranFromStart); ranFromStart = null; }
    });
    // A glance waiting for a break in the work is looked at a few times a second.
    const glanceTimer = setInterval(() => { try { glance.tick(agent); } catch (error) { console.warn('[threat reflexes] The glance failed:', error.message); } }, 200);
    glanceTimer.unref?.();
    agent.bot.on?.('end', () => clearInterval(glanceTimer));
    // No look the bot makes, whoever asks for it, meets an enderman's eyes.
    guardGaze(agent.bot);
    // Where the bot met danger, its routes go round for a while. The zones outlive a respawn: the places
    // are as dangerous as they were. The watch forgets them when the dimension changes.
    watch.watch(agent);
    addPlaceCosts(agent.bot, zones);
    const handle = { creeper, mob, fight, claims, zones, watch, orders, shield, use, beat };
    agent.threatReflexes = handle;
    return handle;
}

// The standing orders: the profile's `threat_rules` (the built-in ones when the profile has none), with
// what the model set by command on top, and the two commands that read and give them.
function installOrders(agent, dir) {
    const warn = text => console.warn(`[threat reflexes] ${text}`);
    // A name is checked against the game's list of mobs once the bot knows its game; before, any is taken.
    const isMob = name => { const known = agent.bot?.registry?.entitiesByName; return known ? Boolean(known[name]) : true; };
    const orders = createStandingOrders({
        profile: agent.prompter?.profile?.threat_rules,
        saved: loadSavedOrders(dir, { warn }),
        save: saved => saveOrders(dir, saved, { warn }),
        isMob, warn,
    });
    for (const { command, action } of orderCommands()) registerCommand(command, { action });
    return orders;
}
