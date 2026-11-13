// SPDX-License-Identifier: CC0-1.0
// What the model can ask of world memory, and how the answers read.
//
// The model never sees the store itself. It asks short questions and gets short answers, so the prompt
// stays small however much the bot remembers:
//   !recall(what)     a block name, a kind of thing ("chest", "door"), an item ("iron": what is in the
//                     chests it opened), an animal, a crop, a place name, or "changes"
//   !places           the places it knows, near and far, and what is at each
//   !namePlace(name)  names the place it is standing in
// Change notes are also added to the result of the action during which they were noticed, once each.
//
// Everything here is text built from the store. Nothing reads the live world.
import { isCrop, isHerdAnimal, kindOf } from './kinds.js';

export const ago = ms => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 30) return 'just now';
    if (seconds < 90) return 'a minute ago';
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
    if (seconds < 5400) return 'an hour ago';
    if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
    return seconds < 129600 ? 'a day ago' : `${Math.round(seconds / 86400)} days ago`;
};

/** "12 blocks north-east", the way a player would say it. 8-way compass, no coordinates. */
function whereFrom(here, to) {
    const dx = to.x - here.x, dz = to.z - here.z;
    const distance = Math.hypot(dx, to.y - here.y, dz);
    if (distance < 1.5) return 'right here';
    const names = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];
    const index = ((Math.round(Math.atan2(-dx, dz) / (Math.PI / 4)) % 8) + 8) % 8;
    const flat = Math.hypot(dx, dz);
    const direction = flat < 1.5 ? (to.y > here.y ? 'above' : 'below') : names[index];
    return `${Math.round(distance)} blocks ${direction}`;
}

// Words the model might use for a kind of thing, beyond exact block names.
const KIND_WORDS = { container: 'container', containers: 'container', storage: 'container', chests: 'container',
    workstation: 'workstation', workstations: 'workstation', door: 'passage', doors: 'passage', gate: 'passage',
    bed: 'bed', beds: 'bed', sign: 'sign', signs: 'sign', portal: 'portal', portals: 'portal',
    ore: 'ore', ores: 'ore', spawner: 'spawner', spawners: 'spawner' };

/** How long the walk is along the trail, when the trail joins here to there. Empty when it doesn't. */
function walkText(memory, here, target) {
    const start = memory.trail.nearest(here, { maxDistance: 8, levelWeight: 2 });
    const end = target.from ?? memory.trail.nearest(target, { maxDistance: 8, levelWeight: 2 })?.id;
    if (!start || end == null) return '';
    const route = memory.trail.route(start.id, end);
    return route ? `, about ${Math.max(1, Math.round(route.seconds))} seconds on foot by a way you know` : '';
}

const contentsOf = items => Object.entries(items).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name} ${n}`).join(', ');

/** What a place holds, as "chest 4, furnace 2, red_bed 1", from the things remembered inside its box. */
function placeContents(memory, place) {
    const counts = {};
    for (const thing of memory.things.within(place.min, place.max)) {
        if (thing.kind !== 'ore') counts[thing.name] = (counts[thing.name] ?? 0) + 1;
    }
    return contentsOf(counts);
}

function placeLine(memory, here, place) {
    const label = place.name ? `"${place.name}"` : 'an unnamed site';
    const contents = placeContents(memory, place);
    const centre = { x: (place.min.x + place.max.x) / 2, y: (place.min.y + place.max.y) / 2, z: (place.min.z + place.max.z) / 2 };
    const where = place.distance !== undefined && place.distance <= 4 ? 'you are here' : whereFrom(here, place.spot ?? centre);
    const spot = place.spot ?? { x: Math.round(centre.x), y: place.min.y, z: Math.round(centre.z) };
    return `- ${label} near ${Math.floor(spot.x)}, ${Math.floor(spot.y)}, ${Math.floor(spot.z)}: ${contents || 'nothing remembered there'} (${where})`;
}

/**
 * Text for !recall.
 * @param {object} memory - from openMemory
 * @param {{x:number,y:number,z:number}} here - where the bot is
 * @param {string} what - what the model asked about
 */
export function recallText(memory, here, what, { limit = 5, now = Date.now } = {}) {
    const query = String(what ?? '').trim();
    const key = query.toLowerCase().replace(/\s+/g, '_');
    const t = now();
    const sections = [];
    const hitLine = (hit, first, label = '') => `- ${label}at ${hit.x}, ${hit.y}, ${hit.z}: ${whereFrom(here, { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 })}`
        + `${hit.lastSeen ? `, seen ${ago(t - hit.lastSeen)}` : ''}${first ? walkText(memory, here, hit) : ''}`;

    if (key === 'changes') {
        const notes = memory.changes.recent(limit);
        return notes.length ? `CHANGES YOU NOTICED (newest first)\n${notes.map(note => `- ${ago(t - note.at)}: ${note.text}`).join('\n')}`
            : 'You have not noticed any place changing.';
    }

    const place = memory.places.byName(query);
    if (place) sections.push(`PLACE\n${placeLine(memory, here, place)}${walkText(memory, here, { ...(place.spot ?? place.min), from: place.crumb })}`);

    if (isHerdAnimal(key) || key === 'animals') {
        const herds = memory.things.herdsNear(here, { kind: key === 'animals' ? null : key, limit });
        if (herds.length) sections.push(`ANIMALS YOU REMEMBER\n${herds.map((herd, i) => `- ${herd.kind} x${herd.count} near ${herd.x}, ${herd.y}, ${herd.z}: `
            + `${whereFrom(here, herd)}, seen ${ago(t - herd.lastSeen)}${i === 0 ? walkText(memory, here, herd) : ''}`).join('\n')}`);
    }

    if (isCrop(key) || key === 'crops' || key === 'fields') {
        const fields = memory.things.fieldsNear(here, { crop: isCrop(key) ? key : null, limit });
        if (fields.length) sections.push(`FIELDS YOU REMEMBER\n${fields.map((field, i) => `- ${field.crop} x${field.count} (${field.ripe} ripe when last seen) near `
            + `${Math.round(field.x)}, ${Math.round(field.y)}, ${Math.round(field.z)}: ${whereFrom(here, field)}, seen ${ago(t - field.lastSeen)}${i === 0 ? walkText(memory, here, field) : ''}`).join('\n')}`);
    }

    // Blocks. Things come with when they were last seen and where the bot stood; plain blocks come from the cells.
    const kindWord = KIND_WORDS[key];
    if (kindOf(key) || kindWord) {
        const hits = kindOf(key) ? memory.things.nearest([key], here, { limit }) : memory.things.nearest(null, here, { kinds: [kindWord], limit });
        if (hits.length) {
            const lines = hits.map((hit, i) => hitLine(hit, i === 0, kindOf(key) ? '' : `${hit.name} `)
                + `${hit.contents ? `; inside ${ago(t - hit.contents.at)}: ${contentsOf(hit.contents.items) || 'nothing'}` : ''}${hit.text ? `; it says "${hit.text}"` : ''}`);
            const more = kindOf(key) ? memory.things.count(key) - hits.length : 0;
            sections.push(`REMEMBERED ${key} (nearest first)\n${lines.join('\n')}${more > 0 ? `\n- and ${more} more farther away` : ''}`);
        }
    } else if (key) {
        const hits = memory.cells.nearest([key], here, { maxDistance: 512, limit: limit + 1 });
        if (hits.length) {
            const lines = hits.slice(0, limit).map((hit, i) => hitLine({ ...hit, lastSeen: memory.cells.lookedAt(hit.x >> 4, hit.y >> 4, hit.z >> 4) }, i === 0));
            sections.push(`REMEMBERED ${key} (nearest first)\n${lines.join('\n')}${hits.length > limit ? '\n- and more farther away' : ''}`);
        }
    }

    // Items: what was in the containers it opened.
    const holders = memory.things.findItem(key, here, { limit });
    if (holders.length) {
        sections.push(`IN CONTAINERS YOU OPENED\n${holders.map((hit, i) => `- ${hit.name} at ${hit.x}, ${hit.y}, ${hit.z}: ${contentsOf(hit.items)} `
            + `(looked ${ago(t - hit.lookedAt)}), ${whereFrom(here, { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 })}${i === 0 ? walkText(memory, here, hit) : ''}`).join('\n')}`);
    }

    if (sections.length) return sections.join('\n');
    return `You don't remember any "${query}". You remember every block you have seen, things like chests and doors, what was in `
        + 'the containers you opened, places, fields, animals, and "changes". Explore to see more.';
}

/** Text for !places. */
export function placesText(memory, here, { limit = 10 } = {}) {
    const places = memory.places.near(here, { limit });
    if (!places.length) return "You don't know of any places yet. A place is found when you see chests, workstations, beds or doors together. "
        + 'You can also name the spot you stand on with !rememberHere.';
    return `PLACES YOU KNOW (nearest first)\n${places.map(place => placeLine(memory, here, place)).join('\n')}`;
}

/** Names the place the bot is standing in, or the bare spot when it is in none. */
export function namePlace(memory, here, name) {
    const place = memory.places.at(here);
    if (place) {
        memory.places.name(place.id, name);
        return `This place is now called "${String(name).trim()}".`;
    }
    memory.places.remember(name, here, { crumb: memory.trail.current });
    return `There is no known site here, so this spot is saved as "${String(name).trim()}".`;
}

/** Adds any change notes not yet shown to an action's result, so the model hears of them once, in passing. */
export function withNotes(result, memory) {
    if (!memory || !result || typeof result !== 'object') return result;
    const notes = memory.changes.fresh();
    if (!notes.length) return result;
    const add = text => (typeof text === 'string' ? `${text}\n${notes.map(note => note.text).join('\n')}` : text);
    return { ...result, text: add(result.text), message: add(result.message) };
}

const memoryOf = agent => agent.fairPlay?.memory ?? null;
const OFF = 'World memory is off (set world_memory to true in settings.js).';

export const placesCommand = {
    name: '!places',
    description: 'List the places you know of, nearest first, with what you remember at each.',
    perform: agent => (memoryOf(agent) ? placesText(memoryOf(agent), agent.bot.entity.position) : OFF),
};

export const namePlaceCommand = {
    name: '!namePlace',
    description: 'Give a name to the place you are standing in (a site you found, or just this spot).',
    params: { 'name': { type: 'string', description: 'The name for this place.' } },
    perform: (agent, name) => (memoryOf(agent) ? namePlace(memoryOf(agent), agent.bot.entity.position, name) : OFF),
};
