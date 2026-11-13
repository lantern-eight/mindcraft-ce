// SPDX-License-Identifier: CC0-1.0
// Turns world memory on for one agent, in one world.
//
// World memory is its own feature behind its own setting (`world_memory`). It needs eyes to know what
// is in view, and those are perception's, so for now it is started from the fair-play installer, which
// already makes a perception service at every spawn. Each server, world and dimension gets its own
// memory: a spawn in a new dimension closes one and opens another.
import { createPerception } from '../fairplay/perception.js';
import { createRecorder } from './recorder.js';
import { openMemory } from './store.js';

/**
 * Opens the memory for a scope, and starts the recorder that fills it and the perception that answers
 * from it.
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot, spawned
 * @param {object} options.policy - the fair-play policy perception works under
 * @param {string} options.scope - `host:port/world/dimension`
 * @param {string} options.baseDir - the folder holding every scope's memory
 * @param {object} [options.perceptionOptions] - passed on to createPerception
 * @returns {{memory: object, recorder: object, perception: object}}
 */
export function attachWorldMemory({ bot, policy, scope, baseDir, perceptionOptions = {} }) {
    // The recorder and perception need each other: perception answers from what the recorder wrote,
    // and the recorder looks with perception's eyes. The recorder is made first and given its eyes after.
    let recorder = null;
    const memory = openMemory({ baseDir, scope, canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory });
    const perception = createPerception({ bot, policy, seenMap: recorder.view, backgroundPass: false, ...perceptionOptions });
    recorder.attach(perception);
    return { memory, recorder, perception };
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
