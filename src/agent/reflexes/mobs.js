// SPDX-License-Identifier: CC0-1.0
// What the mob reflex and the fight know about the hostile mobs around the bot, read the fair way.
//
// Mobs come from world.js, like every reflex's: what is in view under fair play, everything the server
// tracks without it. A mob that just slipped out of view is handed out as a stand-in where it was last
// seen; it is kept as a place to keep away from, and nothing is read from it (its aim or its target would
// be read from the live mob behind the wall). Whether a mob is aiming or has a target is asked of the
// edition seam: a player sees a bow raised, arms out.
//
// Creepers are left out: the creeper reflex owns them.
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import settings from '../settings.js';
import { editionOf } from '../edition/index.js';

const LOOK_WITHIN = 24;

/**
 * The hostile mobs within 24 blocks, nearest first, as plain objects for the decisions.
 * @param {object} bot
 * @param {Set<number>} [dying] - mobs seen dying, which can't fight any more
 * @returns {{id:number, name:string, position:object, distance:number, seenNow:boolean, aiming:boolean,
 *     aggressive:boolean, height:number}[]}
 */
export function mobsAround(bot, dying = new Set()) {
    const edition = editionOf(bot.registry);
    const here = bot.entity.position;
    const eye = { x: here.x, y: here.y + (bot.entity.eyeHeight ?? 1.62), z: here.z };
    return world.getNearbyEntities(bot, LOOK_WITHIN)
        .filter(entity => mc.isHostile(entity) && entity.name !== 'creeper' && !dying.has(entity.id))
        .map(entity => {
            const seenNow = entity.lastSeenAt === undefined;
            return {
                id: entity.id, name: entity.name, height: entity.height ?? 1.8,
                position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
                distance: entity.position.distanceTo(here), seenNow,
                aiming: seenNow && edition.isAiming(bot.registry, entity, eye),
                aggressive: seenNow && edition.isAggressive(bot.registry, entity),
            };
        });
}

/** The mob with this id as the bot sees it now, live and in view, or null. */
export function mobInView(bot, id) {
    return world.getNearbyEntities(bot, LOOK_WITHIN).find(entity => entity.id === id && entity.lastSeenAt === undefined) ?? null;
}

/** Notes a line in the behavior log, and says it in chat when the bot narrates what it does. */
export function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

/** What the bot knows about itself, for the decisions. */
export function selfOf(bot) {
    const position = bot.entity.position;
    return {
        position: { x: position.x, y: position.y, z: position.z },
        health: bot.health ?? 20, food: bot.food ?? 20, gameMode: bot.game?.gameMode,
    };
}
