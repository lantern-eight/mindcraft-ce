// SPDX-License-Identifier: CC0-1.0
// The reach guard: the bot may only click, dig, place against, or hit what a player standing in its
// place could.
//
// The server checks distance for these actions but not line of sight, and mineflayer checks neither.
// So without this the bot can open a chest through a stone wall, or dig a block it has only heard
// about. Two rules, checked just before the action is sent:
//   1. Reach: the target is within a survival player's reach of the bot's eye. That differs by edition
//      (on Java 4.5 blocks to a block and 3 to a mob, on Bedrock 5 and 3), so the edition seam is asked.
//      The server allows more to forgive lag; the bot doesn't use that slack.
//   2. Sight: the target is in view this instant. Remembering where something is doesn't count, and
//      for placing a block it is the side being clicked that has to be in view.
// Under a narrowed field of view a player turns to face a block before clicking it, so for the block
// actions the bot does the same: a block within reach but off screen is looked at first, and then
// checked. One behind a wall is still refused once the bot faces it. A mob is not turned to: whoever
// swings at it looks at it first (the fight, the reflexes, the combat plugin), and a swing at one
// behind is refused.
// A refusal is an error with a message the model can act on ("move to where you can see it").
//
// Who is guarded: actions started by something that decides, meaning a command, a skill, a reflex, or
// generated code. Those all run inside one of CE's actions, which is how the guard recognises them.
// The pathfinder and the combat plugin call the same bot methods from their own timers while they
// carry an action out; they are the "legs" and stay unguarded for now (see the design, layer 6).
import Vec3 from 'vec3';
import { actionContext } from '../action_context.js';
import { editionOf } from '../edition/index.js';

// What each guarded bot method does to its target, for the refusal message.
const BLOCK_ACTIONS = {
    dig: 'dig it', placeBlock: 'place a block against it', activateBlock: 'use it',
    openContainer: 'open it', openChest: 'open it', openFurnace: 'open it', openBlock: 'open it',
};
const ENTITY_ACTIONS = { attack: 'hit it', activateEntity: 'use it', useOn: 'use that on it' };

const refusal = message => Object.assign(new Error(message), { code: 'fair_play_reach' });

// Distance from a point to the nearest point of a box (0 when the point is inside it).
function distanceToBox(p, minX, minY, minZ, maxX, maxY, maxZ) {
    const dx = Math.max(minX - p.x, 0, p.x - maxX);
    const dy = Math.max(minY - p.y, 0, p.y - maxY);
    const dz = Math.max(minZ - p.z, 0, p.z - maxZ);
    return Math.hypot(dx, dy, dz);
}

/**
 * @param {object} options
 * @param {object} options.policy - from resolvePolicy
 * @param {() => object|null} options.getPerception - the current perception service, or null before spawn
 * @param {() => object|null} [options.getRegistry] - the bot's game data, for the game's own reach. Without
 *   it, as in tests on hand-built worlds, the game is taken to be Java
 * @returns {{checkBlock: function, checkEntity: function, withinReach: function}} the checks throw when the
 *   action isn't allowed; withinReach says whether a mob is near enough to hit
 */
export function createReachGuard({ policy, getPerception, getRegistry = () => null }) {
    // "survival" in the policy means whatever a survival player of the game in play can reach. Asked each
    // time rather than once: the guard is made before the bot knows which game it has joined.
    const reachOf = kind => {
        const setting = policy[`reach_${kind}`];
        return typeof setting === 'number' ? setting : editionOf(getRegistry()).survivalReach()[kind];
    };
    const ready = () => {
        const perception = getPerception();
        if (!perception) throw refusal("Fair play isn't ready yet; the bot has to finish spawning first.");
        return perception;
    };

    /**
     * @param {{position:{x:number,y:number,z:number}}} block
     * @param {string} verb - what would be done to it, for the message
     * @param {{x:number,y:number,z:number}|null} [face] - for placing: the side being clicked
     */
    function checkBlock(block, verb = 'use it', face = null) {
        const perception = ready();
        const pos = block?.position;
        if (!pos) throw refusal('That is not a block.');
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const where = `the block at ${x}, ${y}, ${z}`;
        const distance = distanceToBox(perception.eye(), x, y, z, x + 1, y + 1, z + 1);
        const reach = reachOf('blocks');
        if (distance > reach + 1e-6)
            throw refusal(`You can't reach ${where}: it is ${distance.toFixed(1)} blocks away and you can reach ${reach}. Move closer first.`);
        if (policy.interact_through_walls === true) return;
        if (!perception.seesCell(pos))
            throw refusal(`You can't see ${where} from here, so you can't ${verb}. Move to where you can see it.`);
        // Placing means clicking one particular side, and a player can't click a side that faces away.
        if (face && !perception.seesFace(pos, face))
            throw refusal(`You can't see the side of ${where} that you would place against. Try another side, or move.`);
    }

    /**
     * Where to look before acting on a block, or null when there is no need to turn: the view is all
     * around, the block (or the side to be clicked) is on screen already, or it is out of reach, which
     * checkBlock refuses without a turn. Aims at the middle of the block, or of the side to be clicked.
     * @returns {Vec3|null}
     */
    function aimFor(block, face = null) {
        const perception = getPerception();
        const pos = block?.position;
        if (!perception?.screenNow?.() || !pos || policy.interact_through_walls === true) return null;
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        if (distanceToBox(perception.eye(), x, y, z, x + 1, y + 1, z + 1) > reachOf('blocks') + 1e-6) return null;
        if (face ? perception.seesFace(pos, face) : perception.seesCell(pos)) return null;
        const side = face ? [Math.sign(face.x), Math.sign(face.y), Math.sign(face.z)] : [0, 0, 0];
        return new Vec3(x + 0.5 + side[0] * 0.5, y + 0.5 + side[1] * 0.5, z + 0.5 + side[2] * 0.5);
    }

    // Eye to the nearest part of the mob's box, as the game measures a hit.
    function distanceToEntity(perception, entity) {
        const pos = entity.position;
        const half = (entity.width ?? 0.6) / 2, height = entity.height ?? 1.8;
        return distanceToBox(perception.eye(), pos.x - half, pos.y, pos.z - half, pos.x + half, pos.y + height, pos.z + half);
    }

    /** True when the entity is within the bot's reach right now. Sight is not asked: only distance. */
    function withinReach(entity) {
        const perception = getPerception();
        entity = perception?.liveOf?.(entity) ?? entity;
        if (!perception || !entity?.position) return false;
        return distanceToEntity(perception, entity) <= reachOf('entities') + 1e-6;
    }

    function checkEntity(entity, verb = 'hit it') {
        const perception = ready();
        // A mob that just slipped out of view is handed out as a stand-in where it was last seen. Reach
        // and sight are judged on the mob itself, where it is now.
        entity = perception.liveOf?.(entity) ?? entity;
        const pos = entity?.position;
        if (!pos) throw refusal('That is not something you can reach.');
        const what = `the ${entity.name ?? entity.username ?? 'entity'}`;
        const distance = distanceToEntity(perception, entity);
        const reach = reachOf('entities');
        if (distance > reach + 1e-6)
            throw refusal(`You can't reach ${what}: it is ${distance.toFixed(1)} blocks away and you can reach ${reach}. Move closer first.`);
        if (policy.interact_through_walls === true) return;
        if (!perception.seesEntity(entity))
            throw refusal(`You can't see ${what} from here, so you can't ${verb}.`);
    }

    /**
     * A hit nobody decided on just now: the combat plugin's, struck from its own timer while it carries
     * out a fight an action started. That action was checked when it began, but the plugin swings at
     * its target for as long as it stays within its range, wall or no wall. Such a hit is let through
     * when the target is within reach and the bot saw it within the last second, so a mob that slips
     * behind a tree for a moment can still be struck.
     */
    function allowsUndecidedHit(entity) {
        const perception = getPerception();
        if (!perception) return false;
        entity = perception.liveOf?.(entity) ?? entity;
        if (!entity?.position || distanceToEntity(perception, entity) > reachOf('entities') + 1e-6) return false;
        return policy.interact_through_walls === true || perception.seenWithin(entity, UNDECIDED_HIT_SIGHT_MS);
    }

    return { checkBlock, checkEntity, withinReach, allowsUndecidedHit, aimFor };
}

// How recently a target must have been in view for the combat plugin's own swing at it.
const UNDECIDED_HIT_SIGHT_MS = 1000;

/**
 * Wraps the bot's own click, dig, place and hit methods so each one asks the guard first. Safe to call
 * more than once; only the first call wraps. A block action turns toward its block first when the guard
 * says to (aimFor), through bot.lookAt, so the enderman gaze guard has that look too.
 *
 * @param {object} bot - the mineflayer bot, after its plugins are loaded
 * @param {{checkBlock: function, checkEntity: function}} guard
 * @param {object} [options]
 * @param {() => boolean} [options.deciding] - true when the call comes from a command, skill, reflex or
 *   generated code; the default asks CE's action context
 */
export function installReachGuard(bot, guard, { deciding = () => actionContext(bot) !== null } = {}) {
    if (bot.fairPlayReachGuard) return;
    bot.fairPlayReachGuard = guard;
    for (const [name, verb] of Object.entries(BLOCK_ACTIONS)) {
        const original = bot[name];
        if (typeof original !== 'function') continue;
        // async, so a refusal arrives as a rejected promise like any other failure of these methods.
        bot[name] = async function (block, ...rest) {
            if (deciding()) {
                const face = name === 'placeBlock' ? rest[0] : null;
                const aim = guard.aimFor?.(block, face);
                if (aim && typeof bot.lookAt === 'function') await bot.lookAt(aim);
                guard.checkBlock(block, verb, face);
            }
            return await original.call(this, block, ...rest);
        };
    }
    for (const [name, verb] of Object.entries(ENTITY_ACTIONS)) {
        const original = bot[name];
        if (typeof original !== 'function') continue;
        if (name === 'attack') {
            // mineflayer's attack is not async, and the combat plugin calls it for its return value's timing.
            // A swing from the plugin's own timer is not refused with an error, which would land inside the
            // plugin: it just doesn't happen, and the plugin swings again on its next turn.
            bot[name] = function (entity, ...rest) {
                if (deciding()) guard.checkEntity(entity, verb);
                else if (guard.allowsUndecidedHit && !guard.allowsUndecidedHit(entity)) return undefined;
                return original.call(this, entity, ...rest);
            };
        } else {
            bot[name] = async function (entity, ...rest) {
                if (deciding()) guard.checkEntity(entity, verb);
                return await original.call(this, entity, ...rest);
            };
        }
    }
}
