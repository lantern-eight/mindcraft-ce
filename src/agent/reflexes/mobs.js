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
import { bestWeapon } from './decide.js';
import { offHandOf } from './shield.js';

const LOOK_WITHIN = 24;

/**
 * The hostile mobs within 24 blocks, nearest first, as plain objects for the decisions.
 * @param {object} bot
 * @param {Set<number>} [dying] - mobs seen dying, which can't fight any more
 * @param {object} [beat] - the beat of shots heard (shot_beat.js): an archer whose next shot is due counts as
 *     drawing, where the game shows no bow drawn
 * @returns {{id:number, name:string, position:object, distance:number, seenNow:boolean, aiming:boolean,
 *     drawing:boolean, aggressive:boolean, height:number}[]} drawing: about to loose a shot (a bow drawn),
 *     the moment to raise a shield
 */
export function mobsAround(bot, dying = new Set(), beat = null) {
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
                drawing: seenNow && (edition.isDrawing(bot.registry, entity, eye)
                    || Boolean(beat?.due(entity.id, edition.shotBeatMs(entity.name, bot.game?.difficulty)))),
                aggressive: seenNow && edition.isAggressive(bot.registry, entity),
            };
        });
}

/** The mob with this id as the bot sees it now, live and in view, or null. */
export function mobInView(bot, id) {
    return world.getNearbyEntities(bot, LOOK_WITHIN).find(entity => entity.id === id && entity.lastSeenAt === undefined) ?? null;
}

/**
 * The standing order that applies to each mob now, as the decisions ask for it.
 * @param {object|null} orders - the standing orders (orders.js), or none
 * @param {object} self - from selfOf
 */
export function ordersFor(orders, self) {
    if (!orders) return () => null;
    return mob => orders.orderFor(mob.name, self);
}

/** Notes a line in the behavior log, and says it in chat when the bot narrates what it does. */
export function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// Armor points of each piece, the same on both editions: what the armor bar shows a player.
const PIECE_POINTS = { helmet: 0, chestplate: 1, leggings: 2, boots: 3 };
const ARMOR_POINTS = {
    leather: [1, 3, 2, 1], copper: [2, 4, 3, 1], golden: [2, 5, 3, 1], chainmail: [2, 5, 4, 1],
    iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3], netherite: [3, 8, 6, 3],
};
const pointsOf = name => {
    if (name === 'turtle_helmet') return 2;
    const [, material, piece] = /^([a-z]+)_(helmet|chestplate|leggings|boots)$/.exec(name ?? '') ?? [];
    return ARMOR_POINTS[material]?.[PIECE_POINTS[piece]] ?? 0;
};

/** The armor points of what the bot wears, as its armor bar shows them. */
export function armorOf(bot) {
    if (typeof bot.getEquipmentDestSlot !== 'function') return 0;
    return ['head', 'torso', 'legs', 'feet']
        .map(part => bot.inventory?.slots?.[bot.getEquipmentDestSlot(part)]?.name)
        .reduce((sum, name) => sum + pointsOf(name), 0);
}

/** What the bot knows about itself, for the decisions: where it is, its health and food, whether it carries
 *  a sword or an axe (for an order to fight when armed), and the armor it wears and whether it has a shield
 *  (for how much it takes on). */
export function selfOf(bot) {
    const position = bot.entity.position;
    return {
        position: { x: position.x, y: position.y, z: position.z },
        health: bot.health ?? 20, food: bot.food ?? 20, gameMode: bot.game?.gameMode,
        armed: bestWeapon(bot.inventory?.items?.().map(item => item.name) ?? [], editionOf(bot.registry).meleeOf) !== null,
        armor: armorOf(bot),
        // In the off-hand already, or carried: the fight puts a carried one there as it starts.
        shielded: offHandOf(bot)?.name === 'shield' || Boolean(bot.inventory?.items?.().some(item => item.name === 'shield')),
    };
}
