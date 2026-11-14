// SPDX-License-Identifier: CC0-1.0
// Turns world memory on for one agent, in one world.
//
// World memory is its own feature behind its own setting (`world_memory`). It needs eyes to know what
// is in view, and those are perception's, so for now it is started from the fair-play installer, which
// already makes a perception service at every spawn. Each server, world and dimension gets its own
// memory: a spawn in a new dimension closes one and opens another.
import { createPerception } from '../fairplay/perception.js';
import { setTravelGuide } from '../library/travel_guide.js';
import { moveKindOf } from './kinds.js';
import { createNavigator, pathfinderLegs, targetOf } from './navigator.js';
import { createRecorder } from './recorder.js';
import { openMemory } from './store.js';

// One navigator per bot, for the world it is in now. Travel has a single hook for every bot in the
// process, so the guide installed there looks the bot's own navigator up here.
const navigators = new WeakMap();

/**
 * The guide travel calls before it plans a walk: follows the trail when this bot knows a way.
 * Anything that goes wrong is logged and left to ordinary travel, except an interrupt, which has to
 * reach the caller so the walk really stops.
 */
async function guide(bot, goal, log) {
    const navigator = navigators.get(bot);
    const target = navigator ? targetOf(goal) : null;
    if (!target) return;
    try {
        await navigator.follow(target, { say: text => log(bot, text) });
    } catch (error) {
        if (bot.interrupt_code) throw error;
        console.warn('[world memory] Could not follow the trail:', error.message);
    }
}

/**
 * Opens the memory for a scope, and starts the recorder that fills it and the perception that answers
 * from it.
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot, spawned
 * @param {object} options.policy - the fair-play policy perception works under
 * @param {string} options.scope - `host:port/world/dimension`
 * @param {string} options.baseDir - the folder holding every scope's memory
 * @param {object} [options.perceptionOptions] - passed on to createPerception
 * @returns {{memory: object, recorder: object, perception: object, navigator: object|null}}
 */
export function attachWorldMemory({ bot, policy, scope, baseDir, perceptionOptions = {} }) {
    // The recorder and perception need each other: perception answers from what the recorder wrote,
    // and the recorder looks with perception's eyes. The recorder is made first and given its eyes after.
    let recorder = null;
    const memory = openMemory({ baseDir, scope, canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory });
    const perception = createPerception({ bot, policy, seenMap: recorder.view, backgroundPass: false, ...perceptionOptions });
    recorder.attach(perception);
    // Travel follows the trail from here on. A bot without the pathfinder (a test stub) simply has none.
    // A remembered block stands in the way when it is solid and is not a door or gate, which opens.
    const blocksWay = name => bot.registry.blocksByName[name]?.boundingBox === 'block' && moveKindOf(name) !== 'door';
    const navigator = bot.pathfinder ? createNavigator({ memory, legs: pathfinderLegs(bot), blocksWay }) : null;
    if (navigator) {
        navigators.set(bot, navigator);
        setTravelGuide(guide);
    } else navigators.delete(bot);
    return { memory, recorder, perception, navigator };
}

/**
 * Saved places, kept in world memory. It stands in for Mindcraft-CE's MemoryBank (a name-to-position
 * map behind !rememberHere and !goToRememberedPlace) and offers the same five calls, so the commands
 * and the agent system's save file work unchanged. A name saved here becomes a place: it gets the trail
 * crumb the bot stood on, shows up in !places, and can be asked about with !recall.
 *
 * The original bank is kept underneath. It still holds everything, so turning world memory off loses
 * nothing, and it answers on its own while no world is open (before the first spawn).
 *
 * @param {() => object|null} getMemory - the open memory, or null
 * @param {object} bank - the MemoryBank being stood in for
 */
export function placeBank(getMemory, bank) {
    const adopt = (name, pos) => {
        const memory = getMemory();
        if (memory && Array.isArray(pos) && !memory.places.byName(name)) memory.places.remember(name, { x: pos[0], y: pos[1], z: pos[2] });
    };
    return {
        rememberPlace(name, x, y, z) {
            bank.rememberPlace(name, x, y, z);
            const memory = getMemory();
            memory?.places.remember(name, { x, y, z }, { crumb: memory.trail.current });
        },
        recallPlace(name) {
            const spot = getMemory()?.places.byName(name)?.spot;
            return spot ? [spot.x, spot.y, spot.z] : bank.recallPlace(name);
        },
        getJson: () => bank.getJson(),
        loadJson(json) {
            bank.loadJson(json);
            for (const [name, pos] of Object.entries(json ?? {})) adopt(name, pos); // places saved before world memory was on
        },
        getKeys() {
            const names = new Set(bank.getKeys().split(', ').filter(Boolean));
            const memory = getMemory();
            for (const place of memory?.places.near({ x: 0, y: 0, z: 0 }, { limit: Infinity }) ?? []) if (place.name) names.add(place.name);
            return [...names].join(', ');
        },
    };
}
