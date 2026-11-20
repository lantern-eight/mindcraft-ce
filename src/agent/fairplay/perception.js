// SPDX-License-Identifier: CC0-1.0
// Perception: what this bot knows about the world right now, under the fair-play rules.
//
// Mineflayer receives every block in every loaded chunk and every entity the server tracks, walls or no
// walls. Perception is the one place allowed to read that raw data, and it only *returns* what a survival
// player in the bot's place could know:
//   - touch:    the cells the bot's body occupies and their neighbours (a player feels these);
//   - sight:    blocks and entities a straight line from the eye reaches (sight.js), within distance and
//               field of view;
//   - memory:   blocks it saw before (world memory, src/agent/memory/), exactly as it remembers them.
//               With world memory off it remembers nothing out of view;
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
//   believedAt(x, y, z)     the same for route planning, which also needs "known to be empty" told from "never seen"
//   findBlocks(options)     mineflayer findBlocks options; positions of known matching blocks, nearest first
//   entities()              entities the bot perceives (not itself): the live ones in view, and a stand-in
//                           frozen where it was last seen for one that just slipped out of view
//   liveOf(entity)          the live entity behind such a stand-in, for the reach guard
//   seesCell / seesFace / seesEntity   what is in view this instant, for the reach guard
//   heard(options)          recent sounds, summarised
//   onHeard(listener)       told of each sound as it arrives, summarised the same way
//   start() / stop()        start listening for sounds; end the service for good and remove its listeners
// The looking around that fills memory is world memory's recorder (memory/recorder.js), not perception's.
import Vec3 from 'vec3';
import { buildStopsSightTable, createSight, viewDirection } from './sight.js';
import { lazyStateTable, scanSection, sectionsInRange } from './block_scan.js';
import { stateOfProps } from '../memory/block_state.js';
import { editionOf } from '../edition/index.js';

const PLAYER_EYE_HEIGHT = 1.62;
const NAMETAG_RANGE = 64; // vanilla name tags render through walls up to about this far
const CROUCH_EYE_HEIGHT = 1.27; // mineflayer sets this on players who are sneaking

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

// Blocks whose opening and closing a player hears, by the word in their sound's name. Every kind of
// wooden door, trapdoor and fence gate has its own sound, so those are matched by how the word ends.
const CONTAINER_SOUNDS = { chest: 'chest', trapped_chest: 'chest', ender_chest: 'ender_chest',
    barrel: 'barrel', shulker_box: 'shulker_box' };
function openedBlock(word) {
    if (word.startsWith('copper_chest')) return 'chest'; // and its weathered and oxidized sounds
    if (word.endsWith('trapdoor')) return 'trapdoor';
    if (word.endsWith('door')) return 'door';
    if (word.endsWith('fence_gate')) return 'fence_gate';
    return CONTAINER_SOUNDS[word] ?? null;
}

/**
 * The kinds of sound that don't come from a mob the bot could look at, and how `heard` treats them:
 * a door or chest is "seen" when the spot it sounded from is in view; footsteps, when a mob is standing
 * there; an explosion is news even in plain view.
 */
export const SOUND_SOURCES = Object.freeze({ block: 'block', footsteps: 'footsteps', explosion: 'explosion', mob: 'mob' });
export function soundSource(subject) {
    if (subject === 'explosion') return SOUND_SOURCES.explosion;
    if (subject === 'footsteps') return SOUND_SOURCES.footsteps;
    if (/ \((opened|closed)\)$/.test(subject)) return SOUND_SOURCES.block;
    return SOUND_SOURCES.mob;
}

/**
 * Turns a sound name into what made it, or null for one not worth telling the model about. Mobs by
 * their kind ("minecraft:entity.zombie.ambient" is "zombie"); doors, trapdoors, fence gates and
 * containers by what happened to them ("door (opened)"); a block's step sound, which the server plays
 * for a mob walking on it, as "footsteps"; and "explosion". Other players' footsteps never arrive:
 * each player's own game plays them, the server doesn't send them.
 */
export function soundSubject(soundName) {
    const raw = String(soundName).replace(/^minecraft:/, '');
    if (raw === 'entity.generic.explode') return 'explosion';
    const opened = raw.match(/^block\.([a-z_]+)\.(open|close)$/);
    if (opened) {
        const what = openedBlock(opened[1]);
        return what ? `${what} (${opened[2] === 'open' ? 'opened' : 'closed'})` : null;
    }
    if (/^block\.[a-z_]+\.step$/.test(raw)) return 'footsteps';
    const name = raw.replace(/_/g, '.');
    const match = name.match(/^entity\.([a-z]+(?:\.[a-z]+)?)\./);
    if (!match) return null;
    const subject = match[1].replace(/\.(ambient|hurt|death|step|attack|shoot|primed)$/, '');
    if (['player', 'generic', 'item', 'experience', 'arrow', 'fishing', 'firework', 'lightning', 'boat', 'minecart'].includes(subject.split('.')[0]))
        return null;
    const what = subject.replace(/\./g, '_');
    // A creeper's hiss and a bow's twang are told apart from the mob's other noises, as a player hears them.
    if (/primed/.test(name)) return `${what} (hissing)`;
    if (/\.shoot$/.test(name)) return `${what} (shooting)`;
    return what;
}

/**
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot
 * @param {object} options.policy - from resolvePolicy
 * @param {object} [options.memory] - what the bot remembers: world memory's view of its store
 *   (memory/recorder.js `view`). Without one the bot only knows what it touches and sees now
 * @param {function} [options.getStateId] - (x, y, z) => state id or null; defaults to a fast live reader
 * @param {function} [options.getColumn] - (chunkX, chunkZ) => chunk column or null; defaults to the bot's world
 * @param {function} [options.now] - wall clock in ms, for memory and "how long ago"
 * @param {function} [options.clock] - fine-grained clock in ms, for the time budgets below
 * @param {number} [options.permanenceMs] - how long a mob that slips out of view stays known
 * @param {number} [options.searchBudgetMs] - most time one findBlocks() may spend scanning
 * @param {function} [options.warn] - where a search cut short by that budget is reported
 */
export function createPerception({ bot, policy, memory = null, getStateId = null, getColumn = null, now = Date.now,
    clock = () => performance.now(), permanenceMs = 3000, searchBudgetMs = 200, warn = console.warn } = {}) {
    const edition = editionOf(bot.registry);
    const liveReader = getStateId ? null : liveStateReader(bot, edition);
    const readState = getStateId ?? liveReader.read;
    const columnAt = getColumn ?? ((cx, cz) => bot.world.getColumn(cx, cz));
    const stopsSight = buildStopsSightTable(bot.registry);
    const sight = createSight({ getStateId: readState, stopsSight });
    const blockSightDistance = policy.sight_distance === 'server' ? Infinity : policy.sight_distance;
    const narrowView = (policy.fov_degrees ?? 360) < 360;
    const nameOfState = stateId => bot.registry.blocksByStateId[stateId]?.name;

    const lastSeenEntity = new Map(); // entity id -> { at, x, y, z, yaw, pitch }: when and where last seen
    const standIns = new Map(); // entity id -> the stand-in handed out while it is out of view
    const liveBehind = new WeakMap(); // stand-in -> the live entity
    const stillOut = new Set(); // ids handed out as stand-ins in the current entities() pass

    // Searches cut short by the time budget. A cut search still answers with the nearest it found, so
    // nothing fails: without a count and a line in the log, a budget that trips all the time (a slow
    // machine, a huge radius) would only show as a bot that misses blocks a little farther out.
    let searchesCut = 0, cutsSinceWarning = 0, lastWarning = -Infinity;
    function noteSearchCut(maxDistance) {
        searchesCut++;
        cutsSinceWarning++;
        const at = clock();
        if (at - lastWarning < 60_000) return; // at most one line a minute, saying how many since the last
        warn(`[fair play] A block search within ${maxDistance} blocks ran out of its ${searchBudgetMs} ms and answered from what it had scanned`
            + (cutsSinceWarning > 1 ? ` (${cutsSinceWarning} searches cut short since the last note).` : '.'));
        lastWarning = at;
        cutsSinceWarning = 0;
    }
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

    // The bot is looking at this cell right now: memory is told what is there.
    function noteSeen(x, y, z, name, stateId) {
        memory?.observeBlock({ x, y, z }, name, 'observed', stateId);
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
        // A saved state id is trusted only while it still means the same block; ids shift between game
        // versions. World memory keeps the properties by name instead, which survive a game update.
        const stateId = Number.isInteger(entry.stateId) && nameOfState(entry.stateId) === entry.name ? entry.stateId
            : entry.state ? stateOfProps(bot.registry, entry.name, entry.state)
            : (type.defaultState ?? type.minStateId);
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
        const entry = memory?.get(x, y, z);
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

    /**
     * What the bot believes fills a cell, for planning a route (fair_legs.js). Unlike blockAt it tells
     * "I know this is empty" from "I have never seen this", which is the difference between a drop and
     * ground the bot simply has not looked at yet.
     *
     *   - a cell it touches, or sees right now within `range` blocks: the live block. A route search asks
     *     about thousands of cells, and a sight check on a far one is a long line to walk, so beyond
     *     `range` only memory answers. With `sight: "all"` there is no limit, as there is none on sight;
     *   - a block it remembers: a stand-in built from memory, as in blockAt;
     *   - a cell it remembers as open space: a stand-in block of air;
     *   - anything else: null, never seen.
     *
     * @returns {object|null}
     */
    function believedAt(x, y, z, range = Infinity) {
        if (!bot.entity?.position) return null;
        beginLook();
        const inRange = policy.sight === 'all'
            || (x + 0.5 - eyeNow.x) ** 2 + (y + 0.5 - eyeNow.y) ** 2 + (z + 0.5 - eyeNow.z) ** 2 <= range * range;
        if (touching(x, y, z) || (inRange && visibleNow(x, y, z))) {
            const live = bot.blockAt(new Vec3(x, y, z));
            if (live) {
                noteSeen(x, y, z, live.name, live.stateId);
                return live;
            }
        }
        return remembered(x, y, z) ?? (memory?.sawOpen(x, y, z) ? standIn({ name: 'air', x, y, z, lastSeen: 0 }) : null);
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
        const mayMatch = lazyStateTable(bot.registry, stateId => {
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
            if (found.length >= count && section.minDistSq > worst) break;
            if (clock() > deadline) { noteSearchCut(maxDistance); break; }
            const column = columnAt(section.cx, section.cz);
            if (!column) continue;
            scanSection(edition, column, section.cx, section.sy, section.cz, minY, mayMatch, (x, y, z, stateId) => {
                const d2 = (x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2;
                if (d2 > r2 || !perceivable(x, y, z)) return;
                if (needsBlock && !accepts(bot.blockAt(new Vec3(x, y, z)))) return;
                memory?.observeBlock({ x, y, z }, nameOfState(stateId), 'observed', stateId);
                found.push({ x, y, z, d2 });
            });
            if (found.length >= count) {
                found.sort(nearestFirst);
                found.length = count;
                worst = found[count - 1].d2;
            }
        }

        // Remembered blocks that are out of sight (or in chunks that aren't loaded any more).
        if (memory) {
            const names = byType ? ids.map(id => bot.registry.blocks[id]?.name).filter(Boolean) : null;
            // Memory holds every block the bot has seen, so it is asked for the nearest few that could
            // match; for a predicate, "could match" is judged per block name on a stand-in block.
            const entries = memory.recall({ names, point: { x: ox, y: oy, z: oz }, maxDistance, count: count + found.length,
                accepts: name => accepts(standIn({ name, x: ox, y: oy, z: oz, lastSeen: 0 })) });
            const have = entries.length ? new Set(found.map(f => `${f.x},${f.y},${f.z}`)) : null;
            for (const entry of entries) {
                const d2 = (entry.x - ox) ** 2 + (entry.y - oy) ** 2 + (entry.z - oz) ** 2;
                if (d2 > r2 || have.has(`${entry.x},${entry.y},${entry.z}`)) continue;
                let block;
                if (perceivable(entry.x, entry.y, entry.z)) {
                    // In view right now, so the live world is the truth and memory gets corrected.
                    block = bot.blockAt(new Vec3(entry.x, entry.y, entry.z));
                    if (!block) continue;
                    if (block.name !== entry.name) { memory.observeCell(entry, block.name); continue; }
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
            if (known) {
                const p = entity.position;
                lastSeenEntity.set(entity.id, { at: t, x: p.x, y: p.y, z: p.z, yaw: entity.yaw, pitch: entity.pitch });
                out.push(entity);
                continue;
            }
            const seen = lastSeenEntity.get(entity.id);
            if (seen && t - seen.at <= permanenceMs) out.push(standInFor(entity, seen)); // just slipped out of view
        }
        // Stand-ins last only while their mob is out of view and still remembered.
        for (const id of standIns.keys()) if (!stillOut.has(id)) standIns.delete(id);
        stillOut.clear();
        return out;
    }

    /**
     * A mob that slipped out of view is still known for a moment, so reflexes don't flicker when it walks
     * behind a tree. But a player who loses sight of it knows only where it was, not where it has gone:
     * handing out the live entity would let a skill follow it behind the wall. So it is handed out as a
     * stand-in, standing still where it was last seen. Everything else (its id, kind, size) reads through
     * to the live entity. The same stand-in is handed out for as long as the mob stays out of view, so a
     * caller that keeps it can still find it in the next list.
     */
    function standInFor(entity, seen) {
        stillOut.add(entity.id);
        const kept = standIns.get(entity.id);
        if (kept && liveBehind.get(kept) === entity && kept.lastSeenAt === seen.at) return kept;
        const standIn = Object.freeze(Object.create(entity, {
            position: { value: new Vec3(seen.x, seen.y, seen.z), enumerable: true },
            velocity: { value: new Vec3(0, 0, 0), enumerable: true },
            yaw: { value: seen.yaw, enumerable: true },
            pitch: { value: seen.pitch, enumerable: true },
            lastSeenAt: { value: seen.at },
        }));
        liveBehind.set(standIn, entity);
        standIns.set(entity.id, standIn);
        return standIn;
    }

    /** The live entity behind a stand-in from entities(); anything else is returned as it is. */
    const liveOf = entity => liveBehind.get(entity) ?? entity;

    // ---- Hearing ----
    //
    // Built from the sounds the server sends, which the edition seam reads (src/agent/edition/): a server
    // only sends a sound to players close enough to hear it, so this is what a player with subtitles on
    // would get.

    const heardListeners = new Set();

    function hearSound(soundName, position) {
        const subject = soundSubject(soundName);
        if (!subject || !position || !bot.entity?.position) return;
        if (Math.hypot(position.x - bot.entity.position.x, position.y - bot.entity.position.y, position.z - bot.entity.position.z) > policy.hearing_radius) return;
        const sound = { subject, source: soundSource(subject), position: { x: position.x, y: position.y, z: position.z }, at: now() };
        heardLog.push(sound);
        if (heardLog.length > 50) heardLog.shift();
        if (!heardListeners.size) return;
        // A listener gets what heard() gives for this one sound, and nothing more: no position. Whether the
        // source is in view is worked out only if a listener asks, since that means looking around.
        let inView = null;
        const told = describeSound(sound, bot.entity.position, () => (inView ??= entities()));
        for (const listener of heardListeners) {
            try { listener(told); } catch (error) { warn(`[fair play] A listener for sounds failed: ${error.message}`); }
        }
    }

    /**
     * Calls `listener(sound)` the moment each sound is heard, with what heard() would list for it:
     * subject, direction, distance band, `seen`, `news`, `text`. Never where it came from. A reflex that
     * must react to a creeper's hiss faster than its next round uses this.
     * @returns {() => void} stops listening
     */
    function onHeard(listener) {
        heardListeners.add(listener);
        return () => heardListeners.delete(listener);
    }

    // One sound as heard() reports it. `inView` gives the entities in view, asked for only when needed.
    function describeSound(sound, here, inView) {
        const where = describeDirection(here, sound.position);
        const kind = sound.subject.replace(/ \(.*$/, '');
        const near = (p, range) => Math.hypot(p.x - sound.position.x, p.y - sound.position.y, p.z - sound.position.z) <= range;
        let seen = null;
        const seenNow = () => {
            if (seen !== null) return seen;
            if (sound.source === SOUND_SOURCES.block) seen = seesCellNow(sound.position);
            else if (sound.source === SOUND_SOURCES.footsteps) seen = inView().some(e => near(e.position, 2));
            else if (sound.source === SOUND_SOURCES.explosion) seen = false;
            else seen = inView().some(e => e.name === kind && near(e.position, 4));
            return seen;
        };
        const news = sound.source === SOUND_SOURCES.explosion || / \(hissing\)$/.test(sound.subject);
        const out = { subject: sound.subject, ...where, news };
        Object.defineProperty(out, 'seen', { get: seenNow, enumerable: true });
        return out;
    }

    /**
     * What the bot heard recently: subject, direction and rough distance, newest first, no coordinates.
     * Two cows in different directions are two entries. `seen` says whether the source is in view (a mob
     * of that kind standing where the sound came from, or the spot a door or chest sounded from), so
     * callers can leave out noises whose source the bot can already see. `news` marks a sound worth
     * telling even then: a creeper's hiss, an explosion.
     */
    function heard({ withinMs = 10000 } = {}) {
        const t = now();
        const here = bot.entity.position;
        const inView = entities();
        const latest = new Map();
        for (const sound of heardLog) {
            if (t - sound.at > withinMs) continue;
            const { seen, ...told } = describeSound(sound, here, () => inView);
            latest.set(`${sound.subject}|${told.direction}`, { ...told, seen, at: sound.at });
        }
        return [...latest.values()].sort((a, b) => b.at - a.at)
            .map(({ at, ...sound }) => ({ ...sound, secondsAgo: Math.round((t - at) / 1000) }));
    }

    const seesCellNow = p => {
        beginLook();
        return perceivable(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    };

    // ---- Lifetime ----

    let stopHearing = null;
    // Anything that changes the world makes cached sight answers stale.
    const worldEvents = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload'];
    for (const event of worldEvents) bot.on?.(event, invalidate);

    /** Starts listening for the sounds the server sends. */
    function start() {
        if (stopHearing) return;
        stopHearing = edition.onSound(bot, hearSound);
    }

    /** Ends the service for good and removes every listener it added. */
    function stop() {
        stopHearing?.();
        stopHearing = null;
        for (const event of worldEvents) bot.off?.(event, invalidate);
        liveReader?.dispose();
    }

    return {
        eye, blockAt, believedAt, findBlocks, entities, liveOf, heard, onHeard, start, stop, hearSound, invalidate,
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
        /**
         * Was this entity in view at some moment within the last `ms`? In view now counts. For hits the
         * combat plugin times on its own: a mob that slips behind a tree mid-swing may still be struck,
         * one sealed behind a wall may not.
         */
        seenWithin: (entity, ms) => {
            const live = liveOf(entity);
            if (policy.sight === 'all') return true;
            beginLook();
            if (sight.canSeeEntity(eyeNow, live, { ...viewOpts, maxDistance: policy.entity_distance })) {
                const p = live.position;
                lastSeenEntity.set(live.id, { at: now(), x: p.x, y: p.y, z: p.z, yaw: live.yaw, pitch: live.pitch });
                return true;
            }
            const seen = lastSeenEntity.get(live.id);
            return Boolean(seen) && now() - seen.at <= ms;
        },
        /** Is this entity in view right now? No name-tag rule and no "just slipped out of view" grace. */
        seesEntity: entity => {
            entity = liveOf(entity); // a stand-in's own spot is where the mob was, not where it is
            beginLook();
            return policy.sight === 'all' || sight.canSeeEntity(eyeNow, entity, { ...viewOpts, maxDistance: policy.entity_distance });
        },
        knowsCell: pos => blockAt(pos) !== null,
        /** Counts for live runs: `searchesCut` is how many block searches ran out of their time budget. */
        stats: () => ({ searchesCut }),
        sight,
        // For the world-memory recorder, which does its own looking around with the same eyes: the raw
        // block reader and chunk columns. Nothing that decides what the bot does may use these.
        readState, columnAt,
    };
}

// Reads block state ids straight from the bot's chunk columns, reusing one position object and caching
// the last column, so a ray costs almost nothing per cell. Unloaded columns read as unknown (null). The
// cached column is dropped whenever chunks load or unload, so a reloaded chunk is never read stale.
// `dispose` removes the two listeners; without it a new pair would pile up on every dimension change.
function liveStateReader(bot, edition) {
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
            return edition.readStateId(column, local);
        },
        dispose() {
            bot.off?.('chunkColumnLoad', forget);
            bot.off?.('chunkColumnUnload', forget);
        },
    };
}
