// SPDX-License-Identifier: CC0-1.0
// The danger watch: notes danger zones (danger_zones.js) from what the bot sees, hears and feels.
//
// It looks the fair way, like the reflexes: mobs through world.js (what is in view under fair play), a
// mob's aim through the edition seam (a player sees a bow raised), sounds through fair play's hearing (a
// direction and a distance band, never a position). Nothing out of view becomes a zone: a stand-in where a
// mob was last seen is not a sighting.
//
//   illagers     a pillager, vindicator, evoker, illusioner or ravager in view, looked for once a second
//   archer       a mob in view aiming at the bot within 16 blocks, at the spot it stands
//   explosion    an explosion heard, at the spot rebuilt from its direction and band, grown by how far
//                off that may be (picture.js pointFromSound)
//   unseen_hits  where the bot stood when the mob reflex decided to get away from hits it couldn't see
//                the cause of (it reports its decisions as `threat_reflex` events)
//
// It runs on its own timer, not as a mode: turning a reflex off with !setMode stops the bot reacting, not
// remembering where the danger was. A new illager zone is noted in the behavior log, so the model knows
// why the bot's walks go round that way; the others come with a reflex's own line already.
import * as world from '../library/world.js';
import { editionOf } from '../edition/index.js';
import { describeDirection } from '../fairplay/perception.js';
import { pointFromSound, slackOfBand } from './picture.js';
import { say } from './mobs.js';

const ILLAGERS = new Set(['pillager', 'vindicator', 'evoker', 'illusioner', 'ravager']);
const LOOK_WITHIN = 48;   // illagers are noted as far as the bot can see them
const AIM_WITHIN = 16;    // as the mob reflex: a skeleton shoots from about 15 blocks
const LOOK_EVERY_MS = 1000;

/**
 * @param {object} options
 * @param {object} options.zones - from createDangerZones
 * @param {number} [options.everyMs] - how often to look; 0 for never (tests call look())
 * @returns {{look: Function, hear: Function, decided: Function, watch: Function, stop: Function}}
 */
export function createDangerWatch({ zones, everyMs = LOOK_EVERY_MS }) {
    let dimension;
    let timer = null;

    // No danger to remember for a bot that takes no damage. Another dimension has other places at the
    // same coordinates, so a change of dimension forgets them all.
    function ready(bot) {
        if (!bot?.entity?.position) return false;
        const mode = bot.game?.gameMode;
        if (mode === 'creative' || mode === 'spectator') return false;
        if (bot.game?.dimension !== dimension) {
            if (dimension !== undefined) zones.clear();
            dimension = bot.game?.dimension;
        }
        return true;
    }

    /** One look around: illagers in view, and mobs aiming at the bot. */
    function look(agent) {
        const bot = agent.bot;
        if (!ready(bot)) return;
        const edition = editionOf(bot.registry);
        const here = bot.entity.position;
        const eye = { x: here.x, y: here.y + (bot.entity.eyeHeight ?? 1.62), z: here.z };
        for (const entity of world.getNearbyEntities(bot, LOOK_WITHIN)) {
            if (entity.lastSeenAt !== undefined || !entity.position) continue; // a stand-in, not a sighting
            const position = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
            if (ILLAGERS.has(entity.name)) {
                const noted = zones.note('illagers', position);
                if (noted?.isNew) say(agent, `Saw a ${entity.name.replace(/_/g, ' ')} (${describeDirection(here, position).text}); keeping away from there for a while.`);
            }
            if (entity.position.distanceTo(here) <= AIM_WITHIN && edition.isAiming(bot.registry, entity, eye))
                zones.note('archer', position);
        }
    }

    /** A sound hearing passed on: an explosion becomes a zone where it is thought to have been. */
    function hear(agent, sound) {
        const bot = agent.bot;
        if (sound?.subject !== 'explosion' || !ready(bot)) return;
        const position = pointFromSound(sound, bot.entity.position);
        if (position) zones.note('explosion', position, { slack: slackOfBand(sound.distance) });
    }

    /** A reflex's decision, as it reports it: hits from something unseen make a zone where the bot stands. */
    function decided(agent, event) {
        if (event?.event !== 'decided' || event.reason !== 'unseen hits' || !ready(agent.bot)) return;
        const p = agent.bot.entity.position;
        zones.note('unseen_hits', { x: p.x, y: p.y, z: p.z });
    }

    /** Starts looking once a second, and listening to the reflexes' decisions, for one agent. */
    function watch(agent) {
        agent.bot.on?.('threat_reflex', event => decided(agent, event));
        if (everyMs > 0) {
            timer = setInterval(() => {
                try { look(agent); } catch (error) { console.warn('[danger zones] Could not look around:', error.message); }
            }, everyMs);
            timer.unref?.(); // never the only thing keeping the process alive
            agent.bot.on?.('end', stop);
        }
    }

    function stop() {
        clearInterval(timer);
        timer = null;
    }

    return { look, hear, decided, watch, stop };
}
