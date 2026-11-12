// Perception: what this bot knows about the world right now, under the fair-play rules.
//
// Mineflayer receives every block in every loaded chunk and every entity the server tracks, walls or no
// walls. Perception is the one place allowed to read that raw data, and it only *returns* what a survival
// player in the bot's place could know:
//   - touch:    the cells the bot's body occupies and their neighbours (a player feels these);
//   - sight:    blocks and entities a straight line from the eye reaches (sight.js), within distance and
//               field of view;
//   - memory:   blocks it saw before (seen_map.js), as long as they still match what it remembers;
//   - hearing:  sounds the server actually sent, as "zombie, north-east, close" (never coordinates);
//   - players:  name tags show through walls within 64 blocks unless the player is sneaking.
// The fair query provider (world.js), the fair bot facade (generated code), and the guards all ask here.
//
// Interface used by the rest of fair play:
//   blockAt(pos)            the live block if the bot knows it, else null
//   findBlocks(options)     mineflayer findBlocks options; positions of known matching blocks, nearest first
//   entities()              live entities the bot perceives (not itself)
//   canSeeBlock(pos)        sight check only, for the reach guard
//   heard(options)          recent sounds, summarised
//   tick()                  the background pass that notices notable blocks (ores, chests, sand...)
import Vec3 from 'vec3';
import { buildStopsSightTable, createSight, viewDirection } from './sight.js';
import { blockCategory } from './policy.js';

const PLAYER_EYE_HEIGHT = 1.62;
const NAMETAG_RANGE = 64; // vanilla name tags render through walls up to about this far
const CROUCH_EYE_HEIGHT = 1.27; // mineflayer sets this on players who are sneaking

// Block types worth remembering beyond ores, containers and stations: what chores and travel need.
const EXTRA_NOTABLE = ['sand', 'red_sand', 'gravel', 'clay', 'spawner', 'trial_spawner', 'nether_portal',
    'end_portal_frame', 'pumpkin', 'melon', 'sugar_cane', 'bee_nest', 'beehive', 'obsidian', 'crying_obsidian',
    'budding_amethyst', 'suspicious_sand', 'suspicious_gravel', 'bamboo', 'cactus', 'wheat', 'carrots',
    'potatoes', 'beetroots', 'sweet_berry_bush', 'pointed_dripstone'];

/** Default set of block names the background pass records in the seen-world map. */
export function defaultNotableNames(registry) {
    return registry.blocksArray.map(b => b.name).filter(name =>
        blockCategory(name) !== 'other' || EXTRA_NOTABLE.includes(name) || name.endsWith('_log') || name.endsWith('_stem'));
}

// Body cells (feet, head) and their six-way neighbours, as offsets from the feet cell.
const TOUCH_OFFSETS = [
    [0, 0, 0], [0, 1, 0], [0, -1, 0], [0, 2, 0],
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
];

/** 8-way compass direction and a rough distance, the way a player hears a sound. Never coordinates. */
export function describeDirection(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const flat = Math.hypot(dx, dz);
    const names = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];
    // atan2(-dx, dz): 0 is south (+z), going clockwise through west (-x), north (-z), east (+x).
    const angle = Math.atan2(-dx, dz);
    const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    const direction = flat < 1.5 ? (dy > 0 ? 'above' : dy < 0 ? 'below' : 'here') : names[index];
    const distance = Math.hypot(dx, dy, dz);
    const howFar = distance <= 4 ? 'very close' : distance <= 10 ? 'close' : distance <= 20 ? 'near' : 'far';
    const vertical = flat >= 1.5 && dy > 4 ? ', above' : flat >= 1.5 && dy < -4 ? ', below' : '';
    return { direction, distance: howFar, text: `${direction}${vertical}, ${howFar}` };
}

/** Turns a sound name like "minecraft:entity.zombie.ambient" into what made it ("zombie"), or null. */
export function soundSubject(soundName) {
    const name = String(soundName).replace(/^minecraft:/, '').replace(/_/g, '.');
    const match = name.match(/^entity\.([a-z]+(?:\.[a-z]+)?)\./);
    if (!match) return null;
    const subject = match[1].replace(/\.(ambient|hurt|death|step|attack|shoot|primed)$/, '');
    if (['player', 'generic', 'item', 'experience', 'arrow', 'fishing', 'firework', 'lightning', 'boat', 'minecart'].includes(subject.split('.')[0]))
        return null;
    const what = subject.replace(/\./g, '_');
    return /primed/.test(name) ? `${what} (hissing)` : what;
}

/**
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot
 * @param {object} options.policy - from resolvePolicy
 * @param {object} [options.seenMap] - from seen_map.js; without one the bot only knows what it sees now
 * @param {function} [options.getStateId] - (x, y, z) => state id or null; defaults to a fast live reader
 * @param {function} [options.now]
 * @param {number} [options.permanenceMs] - how long a mob that slips out of view stays known
 */
export function createPerception({ bot, policy, seenMap = null, getStateId = null, now = Date.now,
    permanenceMs = 3000, notableNames = null, notableRadius = 32, checksPerTick = 600 } = {}) {
    const readState = getStateId ?? liveStateReader(bot);
    const stopsSight = buildStopsSightTable(bot.registry);
    const sight = createSight({ getStateId: readState, stopsSight });
    const blockSightDistance = policy.sight_distance === 'server' ? Infinity : policy.sight_distance;
    const notableIds = (notableNames ?? defaultNotableNames(bot.registry))
        .map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);

    const lastSeenEntity = new Map(); // entity id -> time last seen (object permanence)
    const heardLog = [];
    let visibility = new Map(); // per-eye-position cache of visibility answers
    let cacheEye = '';
    let pending = []; // notable candidates still to check, carried across ticks
    let lastPassAt = -Infinity, lastPassEye = null;

    const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
    const keyOf = p => `${p.x},${p.y},${p.z}`;

    function eye() {
        const p = bot.entity.position;
        return { x: p.x, y: p.y + (bot.entity.eyeHeight ?? PLAYER_EYE_HEIGHT), z: p.z };
    }

    function viewOptions(maxDistance) {
        const fov = policy.fov_degrees ?? 360;
        return fov >= 360 ? { maxDistance } : { maxDistance, fovDegrees: fov, viewDir: viewDirection(bot.entity.yaw, bot.entity.pitch) };
    }

    function refreshCache() {
        const e = eye();
        const k = `${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)},${(bot.entity.yaw ?? 0).toFixed(2)}`;
        if (k !== cacheEye) { visibility = new Map(); cacheEye = k; }
    }

    function touching(cell) {
        const feet = floor(bot.entity.position);
        return TOUCH_OFFSETS.some(([dx, dy, dz]) => cell.x === feet.x + dx && cell.y === feet.y + dy && cell.z === feet.z + dz);
    }

    /** Sight only: is this cell visible from the eye right now? */
    function visibleNow(cell) {
        if (policy.sight === 'all') return true;
        refreshCache();
        const k = keyOf(cell);
        if (visibility.has(k)) return visibility.get(k);
        let seen;
        const opts = viewOptions(blockSightDistance);
        if (policy.sight === 'open_face') {
            const e = eye();
            seen = sight.hasOpenFace(cell.x, cell.y, cell.z)
                && Math.hypot(cell.x + 0.5 - e.x, cell.y + 0.5 - e.y, cell.z + 0.5 - e.z) <= blockSightDistance;
        } else if (sight.blocksSight(cell.x, cell.y, cell.z)) {
            seen = Boolean(sight.canSeeBlock(eye(), cell.x, cell.y, cell.z, opts));
        } else {
            // See-through cells (air, water, glass, a chest): the middle of the cell, or any face.
            seen = sight.canSeePoint(eye(), { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 }, opts)
                || Boolean(sight.canSeeBlock(eye(), cell.x, cell.y, cell.z, opts));
        }
        visibility.set(k, seen);
        return seen;
    }

    const isNotable = live => live && notableIds.includes(live.type);

    function remember(cell, live) {
        if (seenMap && isNotable(live)) seenMap.observeBlock(cell, live.name);
    }

    /** Does the bot know this cell's block? Touch, sight, or a memory that still matches. */
    function knows(cell, live) {
        if (!live) return false;
        if (touching(cell)) return true;
        if (visibleNow(cell)) { remember(cell, live); return true; }
        const memory = seenMap?.get(cell.x, cell.y, cell.z);
        return Boolean(memory && memory.name === live.name && memory.provenance !== 'gone' && memory.provenance !== 'reported');
    }

    function blockAt(pos) {
        const cell = floor(pos);
        const live = bot.blockAt(new Vec3(cell.x, cell.y, cell.z));
        return knows(cell, live) ? live : null;
    }

    const matches = (live, matching) => (typeof matching === 'function' ? Boolean(matching(live))
        : Array.isArray(matching) ? matching.includes(live.type) : live.type === matching);

    function findBlocks(options = {}) {
        const { matching, maxDistance = 16, count = 1, point } = options;
        const origin = point ?? bot.entity.position;
        const out = [];
        const taken = new Set();
        // Raw candidates are only looked at privately; each must pass knows() before it is returned.
        const candidates = bot.findBlocks({ ...options, count: Math.max(count * 8, 512) });
        for (const pos of candidates) {
            if (out.length >= count) break;
            if (knows(floor(pos), bot.blockAt(pos))) { out.push(pos); taken.add(keyOf(floor(pos))); }
        }
        // Remembered blocks the raw scan didn't reach (for example, farther down its candidate list).
        if (seenMap && out.length < count && Number.isFinite(maxDistance)) {
            const r = maxDistance;
            const box = seenMap.within({ x: origin.x - r, y: origin.y - r, z: origin.z - r }, { x: origin.x + r, y: origin.y + r, z: origin.z + r });
            for (const entry of box) {
                if (taken.has(keyOf(entry))) continue;
                const pos = new Vec3(entry.x, entry.y, entry.z);
                if (pos.distanceTo(origin) > r) continue;
                const live = bot.blockAt(pos);
                if (live && live.name === entry.name && matches(live, matching)) { out.push(pos); taken.add(keyOf(entry)); }
            }
            out.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
        }
        return out.slice(0, count);
    }

    function canSeeEntity(entity) {
        const opts = viewOptions(policy.entity_distance);
        return sight.canSeeEntity(eye(), entity, opts);
    }

    function entities() {
        const here = bot.entity.position;
        const t = now();
        const out = [];
        for (const entity of Object.values(bot.entities)) {
            if (entity === bot.entity || !entity.position) continue;
            const distance = entity.position.distanceTo(here);
            let known = false;
            if (entity.type === 'player' && policy.players_through_walls === 'nametag'
                && distance <= NAMETAG_RANGE && entity.eyeHeight !== CROUCH_EYE_HEIGHT) {
                known = true; // a standing player's name tag shows through walls
            } else if (policy.sight === 'all' && distance <= policy.entity_distance) {
                known = true;
            } else if (distance <= policy.entity_distance && canSeeEntity(entity)) {
                known = true;
            }
            if (known) lastSeenEntity.set(entity.id, t);
            else if (t - (lastSeenEntity.get(entity.id) ?? -Infinity) <= permanenceMs) known = true; // just slipped out of view
            if (known) out.push(entity);
        }
        return out;
    }

    // ---- Hearing ----

    function hearSound(soundName, position) {
        const subject = soundSubject(soundName);
        if (!subject || !position) return;
        if (position.distanceTo(bot.entity.position) > policy.hearing_radius) return;
        heardLog.push({ subject, position: { x: position.x, y: position.y, z: position.z }, at: now() });
        if (heardLog.length > 50) heardLog.shift();
    }

    function hearEntity(entityId) {
        const entity = bot.entities[entityId];
        if (!entity?.position || entity.position.distanceTo(bot.entity.position) > policy.hearing_radius) return;
        heardLog.push({ subject: entity.name ?? entity.username ?? 'something', position: { ...entity.position }, at: now() });
        if (heardLog.length > 50) heardLog.shift();
    }

    /** What the bot heard recently: subject, direction and rough distance, newest first, no coordinates. */
    function heard({ withinMs = 10000 } = {}) {
        const t = now();
        const here = bot.entity.position;
        const latest = new Map();
        for (const sound of heardLog) if (t - sound.at <= withinMs) latest.set(sound.subject, sound);
        return [...latest.values()].sort((a, b) => b.at - a.at)
            .map(s => ({ subject: s.subject, ...describeDirection(here, s.position), secondsAgo: Math.round((t - s.at) / 1000) }));
    }

    // ---- Background pass: notice notable blocks, correct memory, note biome and explored areas ----

    function tick() {
        if (!bot.entity?.position) return;
        const t = now();
        const e = eye();
        const moved = !lastPassEye || Math.hypot(e.x - lastPassEye.x, e.y - lastPassEye.y, e.z - lastPassEye.z) >= 1;
        if (pending.length === 0 && (moved || t - lastPassAt >= 1000) && notableIds.length) {
            pending = bot.findBlocks({ matching: notableIds, maxDistance: notableRadius, count: 4096 });
            lastPassAt = t; lastPassEye = e;
            if (seenMap) reconcileMemory();
            if (seenMap) {
                seenMap.markExplored(bot.entity.position);
                try {
                    const biomeId = bot.world.getBiome(bot.entity.position);
                    const name = bot.registry.biomes?.[biomeId]?.name;
                    if (name) seenMap.recordBiome(bot.entity.position, name);
                } catch { /* biome data missing in some test worlds */ }
            }
        }
        const batch = pending.splice(0, checksPerTick);
        for (const pos of batch) {
            const cell = floor(pos);
            if (visibleNow(cell)) {
                remember(cell, bot.blockAt(pos));
                seenMap?.markExplored(cell);
            }
        }
    }

    // Look again at remembered blocks near the bot: refresh the ones still there, mark vanished ones gone.
    function reconcileMemory() {
        const p = bot.entity.position, r = notableRadius;
        for (const entry of seenMap.within({ x: p.x - r, y: p.y - r, z: p.z - r }, { x: p.x + r, y: p.y + r, z: p.z + r })) {
            if (visibleNow(entry)) {
                const live = bot.blockAt(new Vec3(entry.x, entry.y, entry.z));
                if (live) seenMap.observeCell(entry, live.name);
            }
        }
    }

    let timer = null;
    const onSound = (name, position) => hearSound(name, position);
    const onEntitySound = packet => hearEntity(packet.entityId);

    function start({ intervalMs = 300 } = {}) {
        if (timer) return;
        bot.on('soundEffectHeard', onSound);
        bot._client?.on?.('entity_sound_effect', onEntitySound); // mob noises; mineflayer doesn't surface these
        timer = setInterval(() => { try { tick(); } catch (error) { console.warn('Perception tick failed:', error.message); } }, intervalMs);
        timer.unref?.(); // never the only thing keeping the process alive
    }

    function stop() {
        clearInterval(timer);
        timer = null;
        bot.off?.('soundEffectHeard', onSound);
        bot._client?.off?.('entity_sound_effect', onEntitySound);
    }

    return {
        eye, blockAt, findBlocks, entities, heard, tick, start, stop, hearSound, hearEntity,
        canSeeBlock: pos => { const c = floor(pos); return sight.canSeeBlock(eye(), c.x, c.y, c.z, viewOptions(blockSightDistance)); },
        knowsCell: pos => knows(floor(pos), bot.blockAt(pos)),
        sight,
    };
}

// Reads block state ids straight from the bot's chunk columns, reusing one position object and caching
// the last column, so a ray costs no allocations per cell. Unloaded columns read as unknown (null). The
// cached column is dropped whenever chunks load or unload, so a reloaded chunk is never read stale.
function liveStateReader(bot) {
    const local = { x: 0, y: 0, z: 0 };
    let cx = NaN, cz = NaN, column = null;
    const forget = () => { cx = NaN; cz = NaN; column = null; };
    bot.on?.('chunkColumnLoad', forget);
    bot.on?.('chunkColumnUnload', forget);
    return (x, y, z) => {
        const nx = x >> 4, nz = z >> 4;
        if (nx !== cx || nz !== cz) { column = bot.world.getColumn(nx, nz) ?? null; cx = nx; cz = nz; }
        if (!column) return null;
        local.x = x & 15; local.y = y; local.z = z & 15;
        return column.getBlockStateId(local);
    };
}
