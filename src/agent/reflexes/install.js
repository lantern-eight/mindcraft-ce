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
//     from something unseen.
import settings from '../settings.js';
import { registerMode } from '../modes.js';
import { keepPathVerdicts } from '../library/path_verdicts.js';
import { createCreeperReflex } from './creeper_reflex.js';
import { createMobReflex } from './mob_reflex.js';
import { createClaims } from './claims.js';

/**
 * @param {object} agent - the agent, once its modes are set up
 * @param {object} [options]
 * @param {object} [options.config] - the settings to go by
 * @returns {{creeper: object, mob: object}|null} what was installed, or null when the setting is off
 */
export function installThreatReflexes(agent, { config = settings } = {}) {
    // Only an outright `true` turns it on, so a config that leaves the key out gets stock behavior.
    if (config.threat_reflexes !== true) return null;
    // The reflexes ask whether they can walk to a mob every round; an answer found a moment ago is kept.
    keepPathVerdicts(agent.bot);
    const creeper = createCreeperReflex();
    registerMode(creeper.mode, { after: 'self_preservation' });
    // A new life, or a new world, starts with nothing known about creepers.
    agent.bot.on?.('respawn', () => creeper.picture.clear());
    creeper.watch(agent.bot);
    // Under fair play the bot hears, and a hiss reaches the reflex the moment it arrives. Without fair play
    // there is no hearing, and the reflex goes by sight alone.
    agent.fairPlay?.onHeard?.(sound => creeper.hear(agent, sound));
    const claims = createClaims();
    const mob = createMobReflex({ claims });
    registerMode(mob.mode, { after: creeper.mode.name });
    mob.watch(agent.bot);
    agent.bot.on?.('respawn', () => { mob.clear(); claims.clear(); });
    const handle = { creeper, mob, claims };
    agent.threatReflexes = handle;
    return handle;
}
