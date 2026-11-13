// SPDX-License-Identifier: CC0-1.0
// The reach guard: the bot may only click, dig, place against, or hit what a player standing in its
// place could.
//
// The server checks distance for these actions but not line of sight, and mineflayer checks neither.
// So without this the bot can open a chest through a stone wall, or dig a block it has only heard
// about. Two rules, checked just before the action is sent:
//   1. Reach: the target is within a survival player's reach of the bot's eye (4.5 blocks to a block,
//      3 to a mob). The server allows a little more to forgive lag; the bot doesn't use that slack.
//   2. Sight: the target is in view this instant. Remembering where something is doesn't count, and
//      for placing a block it is the side being clicked that has to be in view.
// A refusal is an error with a message the model can act on ("move to where you can see it").
//
// Who is guarded: actions started by something that decides, meaning a command, a skill, a reflex, or
// generated code. Those all run inside one of CE's actions, which is how the guard recognises them.
// The pathfinder and the combat plugin call the same bot methods from their own timers while they
// carry an action out; they are the "legs" and stay unguarded for now (see the design, layer 6).
import { actionContext } from '../action_context.js';

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
 * @returns {{checkBlock: function, checkEntity: function}} each throws when the action isn't allowed
 */
export function createReachGuard({ policy, getPerception }) {
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
        if (distance > policy.reach_blocks + 1e-6)
            throw refusal(`You can't reach ${where}: it is ${distance.toFixed(1)} blocks away and you can reach ${policy.reach_blocks}. Move closer first.`);
        if (policy.interact_through_walls === true) return;
        if (!perception.seesCell(pos))
            throw refusal(`You can't see ${where} from here, so you can't ${verb}. Move to where you can see it.`);
        // Placing means clicking one particular side, and a player can't click a side that faces away.
        if (face && !perception.seesFace(pos, face))
            throw refusal(`You can't see the side of ${where} that you would place against. Try another side, or move.`);
    }

    function checkEntity(entity, verb = 'hit it') {
        const perception = ready();
        const pos = entity?.position;
        if (!pos) throw refusal('That is not something you can reach.');
        const what = `the ${entity.name ?? entity.username ?? 'entity'}`;
        const half = (entity.width ?? 0.6) / 2, height = entity.height ?? 1.8;
        const distance = distanceToBox(perception.eye(), pos.x - half, pos.y, pos.z - half, pos.x + half, pos.y + height, pos.z + half);
        if (distance > policy.reach_entities + 1e-6)
            throw refusal(`You can't reach ${what}: it is ${distance.toFixed(1)} blocks away and you can reach ${policy.reach_entities}. Move closer first.`);
        if (policy.interact_through_walls === true) return;
        if (!perception.seesEntity(entity))
            throw refusal(`You can't see ${what} from here, so you can't ${verb}.`);
    }

    return { checkBlock, checkEntity };
}

/**
 * Wraps the bot's own click, dig, place and hit methods so each one asks the guard first. Safe to call
 * more than once; only the first call wraps.
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
            if (deciding()) guard.checkBlock(block, verb, name === 'placeBlock' ? rest[0] : null);
            return await original.call(this, block, ...rest);
        };
    }
    for (const [name, verb] of Object.entries(ENTITY_ACTIONS)) {
        const original = bot[name];
        if (typeof original !== 'function') continue;
        if (name === 'attack') {
            // mineflayer's attack is not async, and the combat plugin calls it for its return value's timing.
            bot[name] = function (entity, ...rest) {
                if (deciding()) guard.checkEntity(entity, verb);
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
