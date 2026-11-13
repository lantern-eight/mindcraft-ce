// SPDX-License-Identifier: CC0-1.0
// Perception: what this bot knows about the world right now, under the fair-play rules.
//
// Mineflayer receives every block in every loaded chunk and every entity the server tracks, walls or no
// walls. Perception is the one place allowed to read that raw data, and it only *returns* what a survival
// player in the bot's place could know:
//   - touch:    the cells the bot's body occupies and their neighbours (a player feels these);
//   - sight:    blocks and entities a straight line from the eye reaches (sight.js), within distance and
//               field of view;
//   - memory:   blocks it saw before (seen_map.js), exactly as it remembers them;
//   - hearing:  sounds the server actually sent, as "zombie, north-east, close" (never coordinates);
//   - players:  name tags show through walls within 64 blocks unless the player is sneaking.
// The fair query provider (world.js), the fair bot facade (generated code), and the guards all ask here.
//
// How it answers "what block is there?":
//   - a cell the bot touches or sees right now: the live block (and memory is corrected to match);
//   - a cell out of sight that it saw before: a stand-in built from memory alone, in the exact state it
//     was last seen. The live world is never consulted for it, so the bot can't learn that a crop
//     ripened or a chest vanished while it wasn't looking. That also makes memory work for places whose
//     chunks aren't loaded any more;
//   - anything else: unknown.
//
// Interface used by the rest of fair play:
//   blockAt(pos)            the block the bot knows there (live or remembered), else null
//   findBlocks(options)     mineflayer findBlocks options; positions of known matching blocks, nearest first
//   entities()              live entities the bot perceives (not itself)
//   seesCell / seesFace / seesEntity   what is in view this instant, for the reach guard
//   heard(options)          recent sounds, summarised
//   tick()                  one slice of the background pass that notices notable blocks (ores, chests, sand...)
//   stop()                  ends the service for good and removes its listeners
import Vec3 from 'vec3';
import { buildStopsSightTable, createSight, viewDirection } from './sight.js';
import { blockCategory } from './policy.js';
import { lazyStateTable, scanSection, sectionsInRange } from './block_scan.js';

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
 * @param {function} [options.getColumn] - (chunkX, chunkZ) => chunk column or null; defaults to the bot's world
 * @param {function} [options.now] - wall clock in ms, for memory and "how long ago"
 * @param {function} [options.clock] - fine-grained clock in ms, for the time budgets below
 * @param {number} [options.permanenceMs] - how long a mob that slips out of view stays known
 * @param {string[]} [options.notableNames] - block names the background pass remembers
 * @param {number} [options.notableRadius] - how far around the bot the background pass looks
 * @param {number} [options.tickBudgetMs] - most time one tick() may spend; the pass carries on next tick
 * @param {number} [options.searchBudgetMs] - most time one findBlocks() may spend scanning
 */
export function createPerception({ bot, policy, seenMap = null, getStateId = null, getColumn = null, now = Date.now,
    clock = () => performance.now(), permanenceMs = 3000, notableNames = null, notableRadius = 32,
    tickBudgetMs = 4, searchBudgetMs = 200 } = {}) {
    const liveReader = getStateId ? null : liveStateReader(bot);
    const readState = getStateId ?? liveReader.read;
    const columnAt = getColumn ?? ((cx, cz) => bot.world.getColumn(cx, cz));
    const stopsSight = buildStopsSightTable(bot.registry);
    const sight = createSight({ getStateId: readState, stopsSight });
    const blockSightDistance = policy.sight_distance === 'server' ? Infinity : policy.sight_distance;
    const narrowView = (policy.fov_degrees ?? 360) < 360;
    const nameOfState = stateId => bot.registry.blocksByStateId[stateId]?.name;

    // Which block states the background pass remembers, as a table so the scan's inner loop is one lookup.
    const notableState = new Uint8Array(stopsSight.length);
    const notableNameSet = new Set(notableNames ?? defaultNotableNames(bot.registry));
    for (const name of notableNameSet) {
        const block = bot.registry.blocksByName[name];
        if (block) notableState.fill(1, block.minStateId, block.maxStateId + 1);
    }
    const isNotableState = stateId => notableState[stateId] === 1;

    const lastSeenEntity = new Map(); // entity id -> time last seen (object permanence)
    const heardLog = [];

    // ---- Where the bot is looking from, worked out once at the start of each query ----
    //
    // Sight answers are cached for as long as the eye stays put, because a search asks about the same
    // cells many times. The cache is thrown away when the eye moves (or turns, under a narrowed field
    // of view) and when the world changes: without that, an ore uncovered by digging while standing
    // still would stay "not visible".
    const visibility = new Map(); // cell (packed into one number, relative to the eye's cell) -> boolean
    let eyeNow = null, viewOpts = null;
    let feetX = 0, feetY = 0, feetZ = 0;
    let cacheX = 0, cacheY = 0, cacheZ = 0;
    let cacheEye = null, cacheYaw = NaN, cachePitch = NaN, cacheStale = true;
    const invalidate = () => { cacheStale = true; };

    function eye() {
        const p = bot.entity.position;
        return { x: p.x, y: p.y + (bot.entity.eyeHeight ?? PLAYER_EYE_HEIGHT), z: p.z };
    }

    function beginLook() {
        const e = eye();
        const yaw = bot.entity.yaw ?? 0, pitch = bot.entity.pitch ?? 0;
        const turned = narrowView && (yaw !== cacheYaw || pitch !== cachePitch);
        if (cacheStale || turned || !cacheEye || e.x !== cacheEye.x || e.y !== cacheEye.y || e.z !== cacheEye.z) {
            visibility.clear();
            cacheEye = e; cacheYaw = yaw; cachePitch = pitch; cacheStale = false;
            cacheX = Math.floor(e.x); cacheY = Math.floor(e.y); cacheZ = Math.floor(e.z);
        }
        eyeNow = e;
        viewOpts = narrowView
            ? { maxDistance: blockSightDistance, fovDegrees: policy.fov_degrees, viewDir: viewDirection(yaw, pitch) }
            : { maxDistance: blockSightDistance };
        const p = bot.entity.position;
        feetX = Math.floor(p.x); feetY = Math.floor(p.y); feetZ = Math.floor(p.z);
    }

    /** Touch: the cells the body is in (feet, head), the ones just below and above, and the four beside each. */
    function touching(x, y, z) {
        const sideways = Math.abs(x - feetX) + Math.abs(z - feetZ);
        const dy = y - feetY;
        if (sideways === 0) return dy >= -1 && dy <= 2;
        return sideways === 1 && (dy === 0 || dy === 1);
    }

    /** Sight only: is this cell visible from the eye right now? */
    function visibleNow(x, y, z) {
        if (policy.sight === 'all') return true;
        const dx = x - cacheX + 512, dy = y - cacheY + 512, dz = z - cacheZ + 512;
        const cacheable = dx >= 0 && dx < 1024 && dy >= 0 && dy < 1024 && dz >= 0 && dz < 1024;
        const key = (dx * 1024 + dy) * 1024 + dz;
        if (cacheable) {
            const known = visibility.get(key);
            if (known !== undefined) return known;
        }
        let seen;
        if (policy.sight === 'open_face') {
            seen = sight.hasOpenFace(x, y, z)
                && Math.hypot(x + 0.5 - eyeNow.x, y + 0.5 - eyeNow.y, z + 0.5 - eyeNow.z) <= blockSightDistance;
        } else if (sight.blocksSight(x, y, z)) {
            // A solid block with no open side can't be seen from anywhere: six lookups, no rays.
            seen = sight.hasOpenFace(x, y, z) && Boolean(sight.canSeeBlock(eyeNow, x, y, z, viewOpts));
        } else {
            // See-through cells (air, water, glass, a chest): the middle of the cell, or any face.
            seen = sight.canSeePoint(eyeNow, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, viewOpts)
                || Boolean(sight.canSeeBlock(eyeNow, x, y, z, viewOpts));
        }
        if (cacheable) visibility.set(key, seen);
        return seen;
    }

    /** Does the bot perceive this cell right now, by touch or by sight? */
    const perceivable = (x, y, z) => touching(x, y, z) || visibleNow(x, y, z);

    // ---- Memory ----

    // The bot is looking at this cell right now. Remember it if it's notable; otherwise make sure memory
    // doesn't still claim something notable is here.
    function noteSeen(x, y, z, name, stateId) {
        if (!seenMap) return;
        const notable = Number.isInteger(stateId) ? isNotableState(stateId) : notableNameSet.has(name);
        if (notable) seenMap.observeBlock({ x, y, z }, name, 'observed', stateId);
        else seenMap.observeCell({ x, y, z }, name);
    }

    // Every live block shares one class, which can also build a block from a bare state id. Found lazily
    // from the first loaded block, so this module needs no direct dependency on prismarine-block.
    let BlockClass;
    function blockClass() {
        if (BlockClass === undefined) {
            const sample = bot.blockAt(bot.entity.position);
            if (!sample) return null; // nothing loaded yet; look again next time
            BlockClass = typeof sample.constructor?.fromStateId === 'function' ? sample.constructor : null;
        }
        return BlockClass;
    }

    /** A block built purely from a memory entry: what the bot believes is there. */
    function standIn(entry) {
        const type = bot.registry.blocksByName[entry.name];
        if (!type) return null;
        // A saved state id is trusted only while it still means the same block; ids shift between game versions.
        const stateId = Number.isInteger(entry.stateId) && nameOfState(entry.stateId) === entry.name
            ? entry.stateId : (type.defaultState ?? type.minStateId);
        const Block = blockClass();
        const block = Block ? Block.fromStateId(stateId, 0) : {
            name: type.name, type: type.id, stateId, displayName: type.displayName, hardness: type.hardness,
            diggable: type.diggable, boundingBox: type.boundingBox,
        };
        block.position = new Vec3(entry.x, entry.y, entry.z);
        block.rememberedAt = entry.lastSeen; // marks it as memory, and says how old the memory is
        return block;
    }

    function remembered(x, y, z) {
        const entry = seenMap?.get(x, y, z);
        if (!entry || entry.provenance === 'gone' || entry.provenance === 'reported') return null;
        return standIn(entry);
    }

    // ---- Blocks ----

    function blockAt(pos) {
        if (!bot.entity?.position) return null;
        beginLook();
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const live = bot.blockAt(new Vec3(x, y, z));
        if (live && perceivable(x, y, z)) {
            noteSeen(x, y, z, live.name, live.stateId);
            return live;
        }
        return remembered(x, y, z);
    }

    const worldBounds = () => {
        const minY = bot.game?.minY ?? -64;
        return { minY, maxY: minY + (bot.game?.height ?? 384) - 1 };
    };
    const nearestFirst = (a, b) => a.d2 - b.d2;

    /**
     * Positions of blocks the bot knows about that match, nearest first. Takes mineflayer's findBlocks
     * options: `matching` (a block id, a list of ids, or a predicate), `maxDistance`, `count`, `point`.
     *
     * Two sources, merged by distance: cells perceived right now (found by scanning the loaded chunks
     * and keeping only what touch or sight reaches), and remembered blocks that are out of sight.
     */
    function findBlocks(options = {}) {
        if (!bot.entity?.position) return [];
        beginLook();
        const { matching, maxDistance = 16, count = 1 } = options;
        const point = options.point ?? bot.entity.position;
        const ox = Math.floor(point.x), oy = Math.floor(point.y), oz = Math.floor(point.z);
        const r2 = maxDistance * maxDistance;
        const byType = typeof matching !== 'function';
        const ids = byType ? [].concat(matching) : null;
        const extra = typeof options.useExtraInfo === 'function' ? options.useExtraInfo : null;
        const needsBlock = !byType || extra !== null; // a predicate has to be shown the real block
        const accepts = block => Boolean(block) && (byType || Boolean(matching(block))) && (!extra || Boolean(extra(block)));

        // "Could a block in this state match at all?" is decided once per state, not once per cell.
        const mayMatch = lazyStateTable(stopsSight.length, stateId => {
            const type = bot.registry.blocksByStateId[stateId];
            if (!type) return false;
            if (byType) return ids.includes(type.id);
            const Block = blockClass();
            if (!Block) return true;
            // A predicate that needs more than the block type (its position, say) can't be judged from a
            // bare state; treat it as "maybe" and let the real block decide.
            try { return Boolean(matching(Block.fromStateId(stateId, 0))); } catch { return true; }
        });

        let found = [];
        let worst = Infinity; // squared distance of the count-th nearest so far
        const { minY, maxY } = worldBounds();
        const deadline = clock() + searchBudgetMs;
        for (const section of sectionsInRange({ x: ox, y: oy, z: oz }, maxDistance, minY, maxY)) {
            // Sections come nearest first, so once enough are found and the next section is farther than
            // all of them, nothing better is left. The time budget is a safety net for huge searches:
            // what was found so far is still the nearest known within the part that was scanned.
            if ((found.length >= count && section.minDistSq > worst) || clock() > deadline) break;
            const column = columnAt(section.cx, section.cz);
            if (!column) continue;
            scanSection(column, section.cx, section.sy, section.cz, minY, mayMatch, (x, y, z, stateId) => {
                const d2 = (x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2;
                if (d2 > r2 || !perceivable(x, y, z)) return;
                if (needsBlock && !accepts(bot.blockAt(new Vec3(x, y, z)))) return;
                if (seenMap && isNotableState(stateId)) seenMap.observeBlock({ x, y, z }, nameOfState(stateId), 'observed', stateId);
                found.push({ x, y, z, d2 });
            });
            if (found.length >= count) {
                found.sort(nearestFirst);
                found.length = count;
                worst = found[count - 1].d2;
            }
        }

        // Remembered blocks that are out of sight (or in chunks that aren't loaded any more).
        if (seenMap) {
            const names = byType ? ids.map(id => bot.registry.blocks[id]?.name).filter(Boolean) : null;
            const entries = seenMap.within({ x: ox - maxDistance, y: oy - maxDistance, z: oz - maxDistance },
                { x: ox + maxDistance, y: oy + maxDistance, z: oz + maxDistance }, names);
            const have = entries.length ? new Set(found.map(f => `${f.x},${f.y},${f.z}`)) : null;
            for (const entry of entries) {
                const d2 = (entry.x - ox) ** 2 + (entry.y - oy) ** 2 + (entry.z - oz) ** 2;
                if (d2 > r2 || have.has(`${entry.x},${entry.y},${entry.z}`)) continue;
                let block;
                if (perceivable(entry.x, entry.y, entry.z)) {
                    // In view right now, so the live world is the truth and memory gets corrected.
                    block = bot.blockAt(new Vec3(entry.x, entry.y, entry.z));
                    if (!block) continue;
                    if (block.name !== entry.name) { seenMap.observeCell(entry, block.name); continue; }
                } else {
                    block = standIn(entry);
                }
                if (!block || (byType && !ids.includes(block.type)) || (needsBlock && !accepts(block))) continue;
                found.push({ x: entry.x, y: entry.y, z: entry.z, d2 });
            }
        }
        found.sort(nearestFirst);
        return found.slice(0, count).map(f => new Vec3(f.x, f.y, f.z));
    }

    // ---- Entities ----

    function entities() {
        if (!bot.entity?.position) return [];
        beginLook();
        const here = bot.entity.position;
        const t = now();
        const entityView = { ...viewOpts, maxDistance: policy.entity_distance };
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
            } else if (distance <= policy.entity_distance && sight.canSeeEntity(eyeNow, entity, entityView)) {
                known = true;
            }
            if (known) lastSeenEntity.set(entity.id, t);
            else if (t - (lastSeenEntity.get(entity.id) ?? -Infinity) <= permanenceMs) known = true; // just slipped out of view
            if (known) out.push(entity);
        }
        return out;
    }

    // ---- Hearing ----
    //
    // Built from the sound packets the server sends, read directly (nothing is ever sent back). The
    // server only sends a sound to players close enough to hear it, so this is what a player with
    // subtitles on would get. mineflayer's own `soundEffectHeard` event can't be used: on 1.21 it looks
    // each sound up one place off in the sound list, so a cow's moo arrives named as an unrelated sound
    // and its hurt cry as its death cry.

    // minecraft-data numbers its sound list from 0 in some versions and from 1 in others; the protocol
    // always counts from 0. Going by where the list starts keeps the lookup right either way.
    const soundBase = bot.registry.soundsArray?.[0]?.id ?? 0;

    /** The name of the sound a packet carries, or null. */
    function soundNameOf(packet) {
        if (typeof packet?.soundName === 'string') return packet.soundName;                 // older servers name it outright
        if (typeof packet?.sound?.data?.soundName === 'string') return packet.sound.data.soundName; // a sound given by name
        const id = packet?.sound ? packet.sound.soundId : packet?.soundId;                   // its place in the game's sound list
        return Number.isInteger(id) ? bot.registry.sounds?.[id + soundBase]?.name ?? null : null;
    }

    function hearSound(soundName, position) {
        const subject = soundSubject(soundName);
        if (!subject || !position || !bot.entity?.position) return;
        if (Math.hypot(position.x - bot.entity.position.x, position.y - bot.entity.position.y, position.z - bot.entity.position.z) > policy.hearing_radius) return;
        heardLog.push({ subject, position: { x: position.x, y: position.y, z: position.z }, at: now() });
        if (heardLog.length > 50) heardLog.shift();
    }

    /**
     * What the bot heard recently: subject, direction and rough distance, newest first, no coordinates.
     * Two cows in different directions are two entries. `seen` says whether something of that kind the
     * bot can see is standing where the sound came from, so callers can leave out noises whose source
     * is already in view.
     */
    function heard({ withinMs = 10000 } = {}) {
        const t = now();
        const here = bot.entity.position;
        const inView = entities();
        const latest = new Map();
        for (const sound of heardLog) {
            if (t - sound.at > withinMs) continue;
            const where = describeDirection(here, sound.position);
            const kind = sound.subject.replace(/ \(.*$/, '');
            const seen = inView.some(e => e.name === kind
                && Math.hypot(e.position.x - sound.position.x, e.position.y - sound.position.y, e.position.z - sound.position.z) <= 4);
            latest.set(`${sound.subject}|${where.direction}`, { subject: sound.subject, ...where, seen, at: sound.at });
        }
        return [...latest.values()].sort((a, b) => b.at - a.at)
            .map(({ at, ...sound }) => ({ ...sound, secondsAgo: Math.round((t - at) / 1000) }));
    }

    // ---- Background pass: notice notable blocks, correct memory, note biome and explored areas ----
    //
    // A pass covers the sections within `notableRadius` of where it started. It scans them for notable
    // block states, then ray-checks the ones that could possibly be seen. Both steps are spread over as
    // many ticks as they need: each tick stops when its time budget is used up, so the pass never holds
    // up the bot's own movement and physics for more than a few milliseconds at a time.
    let passSections = [], nextSection = 0; // sections still to scan
    let passCells = [];                     // notable cells waiting for a sight check
    let passFrom = null, passMinY = -64;
    let lastPassAt = -Infinity, lastPassEye = null;

    function startPass(t) {
        const { minY, maxY } = worldBounds();
        passFrom = { x: feetX, y: feetY, z: feetZ };
        passMinY = minY;
        passSections = sectionsInRange(passFrom, notableRadius, minY, maxY);
        nextSection = 0;
        passCells = [];
        lastPassAt = t; lastPassEye = eyeNow;
        if (!seenMap) return;
        correctMemory();
        seenMap.markExplored(bot.entity.position);
        try {
            const biomeId = bot.world.getBiome(bot.entity.position);
            const name = bot.registry.biomes?.[biomeId]?.name;
            if (name) seenMap.recordBiome(bot.entity.position, name);
        } catch { /* biome data missing in some test worlds */ }
    }

    // Remembered blocks nearby whose cell now holds something else: if the bot can see the cell, memory
    // is corrected (the old entry is marked gone). Ones it can't see stay as they were remembered. The
    // cheap comparison comes first so only cells that actually changed cost a sight check.
    function correctMemory() {
        const r = notableRadius;
        for (const entry of seenMap.within({ x: feetX - r, y: feetY - r, z: feetZ - r }, { x: feetX + r, y: feetY + r, z: feetZ + r })) {
            const stateId = readState(entry.x, entry.y, entry.z);
            if (stateId == null) continue;
            const name = nameOfState(stateId);
            if (name !== entry.name && perceivable(entry.x, entry.y, entry.z)) seenMap.observeCell(entry, name, stateId);
        }
    }

    function tick({ budgetMs = tickBudgetMs } = {}) {
        if (!bot.entity?.position) return;
        beginLook();
        const t = now();
        const idle = nextSection >= passSections.length && passCells.length === 0;
        const farFromPass = passFrom && Math.abs(feetX - passFrom.x) + Math.abs(feetY - passFrom.y) + Math.abs(feetZ - passFrom.z) > 16;
        if (idle || farFromPass) {
            const moved = !lastPassEye || Math.hypot(eyeNow.x - lastPassEye.x, eyeNow.y - lastPassEye.y, eyeNow.z - lastPassEye.z) >= 1;
            if (!moved && t - lastPassAt < 1000) return;
            startPass(t);
        }
        const r2 = notableRadius * notableRadius;
        const deadline = clock() + budgetMs;
        do {
            if (passCells.length) {
                const cell = passCells.pop();
                if (visibleNow(cell.x, cell.y, cell.z)) {
                    seenMap?.observeBlock(cell, nameOfState(cell.stateId), 'observed', cell.stateId);
                    seenMap?.markExplored(cell);
                }
            } else if (nextSection < passSections.length) {
                const section = passSections[nextSection++];
                const column = columnAt(section.cx, section.cz);
                if (!column) continue;
                scanSection(column, section.cx, section.sy, section.cz, passMinY, isNotableState, (x, y, z, stateId) => {
                    if ((x - passFrom.x) ** 2 + (y - passFrom.y) ** 2 + (z - passFrom.z) ** 2 > r2) return;
                    // Buried solid blocks are dropped here, before they cost a ray.
                    if (sight.blocksSight(x, y, z) && !sight.hasOpenFace(x, y, z) && !touching(x, y, z)) return;
                    passCells.push({ x, y, z, stateId });
                });
            } else break;
        } while (clock() < deadline);
    }

    // ---- Lifetime ----

    let timer = null;
    // Sounds played at a spot carry their position in eighths of a block; sounds attached to an
    // entity come from wherever that entity is.
    const onSound = packet => hearSound(soundNameOf(packet), { x: packet.x / 8, y: packet.y / 8, z: packet.z / 8 });
    const onEntitySound = packet => hearSound(soundNameOf(packet), bot.entities[packet.entityId]?.position);
    const soundPackets = [['sound_effect', onSound], ['named_sound_effect', onSound], ['entity_sound_effect', onEntitySound]];
    // Anything that changes the world makes cached sight answers stale.
    const worldEvents = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload'];
    for (const event of worldEvents) bot.on?.(event, invalidate);

    function start({ intervalMs = 150 } = {}) {
        if (timer) return;
        for (const [packet, listener] of soundPackets) bot._client?.on?.(packet, listener);
        timer = setInterval(() => { try { tick(); } catch (error) { console.warn('Perception tick failed:', error.message); } }, intervalMs);
        timer.unref?.(); // never the only thing keeping the process alive
    }

    /** Ends the service for good: stops the background pass and removes every listener it added. */
    function stop() {
        clearInterval(timer);
        timer = null;
        for (const [packet, listener] of soundPackets) bot._client?.off?.(packet, listener);
        for (const event of worldEvents) bot.off?.(event, invalidate);
        liveReader?.dispose();
    }

    return {
        eye, blockAt, findBlocks, entities, heard, tick, start, stop, hearSound, invalidate,
        canSeeBlock: pos => {
            beginLook();
            return sight.canSeeBlock(eyeNow, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), viewOpts);
        },
        /** Touch or sight, right now (no memory): can the bot perceive this cell as it stands? */
        seesCell: pos => {
            beginLook();
            return perceivable(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        },
        /** Is this one side of a block in view? `face` is a unit normal with x, y, z. */
        seesFace: (pos, face) => {
            beginLook();
            return Boolean(sight.canSeeBlock(eyeNow, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z),
                { ...viewOpts, face: [Math.sign(face.x), Math.sign(face.y), Math.sign(face.z)] }));
        },
        /** Is this entity in view right now? No name-tag rule and no "just slipped out of view" grace. */
        seesEntity: entity => {
            beginLook();
            return policy.sight === 'all' || sight.canSeeEntity(eyeNow, entity, { ...viewOpts, maxDistance: policy.entity_distance });
        },
        knowsCell: pos => blockAt(pos) !== null,
        /** Is this a kind of block the background pass records in the seen-world map? */
        remembers: name => notableNameSet.has(name),
        sight,
    };
}

// Reads block state ids straight from the bot's chunk columns, reusing one position object and caching
// the last column, so a ray costs almost nothing per cell. Unloaded columns read as unknown (null). The
// cached column is dropped whenever chunks load or unload, so a reloaded chunk is never read stale.
// `dispose` removes the two listeners; without it a new pair would pile up on every dimension change.
function liveStateReader(bot) {
    const local = { x: 0, y: 0, z: 0 };
    let cx = NaN, cz = NaN, column = null;
    const forget = () => { cx = NaN; cz = NaN; column = null; };
    bot.on?.('chunkColumnLoad', forget);
    bot.on?.('chunkColumnUnload', forget);
    return {
        read(x, y, z) {
            const nx = x >> 4, nz = z >> 4;
            if (nx !== cx || nz !== cz) { column = bot.world.getColumn(nx, nz) ?? null; cx = nx; cz = nz; }
            if (!column) return null;
            local.x = x & 15; local.y = y; local.z = z & 15;
            return column.getBlockStateId(local);
        },
        dispose() {
            bot.off?.('chunkColumnLoad', forget);
            bot.off?.('chunkColumnUnload', forget);
        },
    };
}
