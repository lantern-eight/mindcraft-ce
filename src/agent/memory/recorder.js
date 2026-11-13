// SPDX-License-Identifier: CC0-1.0
// The recorder: watches what the bot sees and does, and writes it into the memory store.
//
// It is the only part of world memory that touches the game. It never calls a model and never decides
// what the bot does. Its jobs:
//   1. Look around. For every cube within reach, test each block that could be seen for a line of sight
//      from the bot's eyes, and write the ones in view to the store. Only what is in view is written:
//      memory is what the bot saw, whatever the fair-play setting.
//   2. Notice differences. A cell that is in view and no longer holds what memory says is corrected,
//      and reported to the change notes.
//   3. Keep things up to date: chests, doors, beds and the rest, the crops per cube, the animals in view.
//   4. Drop trail crumbs as the bot moves.
//   5. Take a snapshot of a container's contents when the bot opens it and again when it closes it.
//   6. Tag what the bot digs and places, so its own work is never reported back to it as a change.
//
// The look-around is spread over many short slices (a few milliseconds each), so it never holds up the
// bot's own movement. Nothing runs while the bot stands still and no block near it changes.
import { buildStopsSightTable } from '../fairplay/sight.js';
import { scanSection, sectionsInRange } from '../fairplay/block_scan.js';
import { propsOfState } from './block_state.js';
import { AIR, OTHER_NAME } from './cells.js';
import { isCrop, isHerdAnimal, isRipe, kindOf, moveKindOf, partnerOffset, startsPlace } from './kinds.js';

const WATCHING_MS = 60_000; // a cell seen this recently was being watched: a change to it is no surprise
const cubeKey = (cx, cy, cz) => `${cx},${cy},${cz}`;

/**
 * @param {object} options
 * @param {object} options.bot - the mineflayer bot
 * @param {object} options.memory - from openMemory (store.js)
 * @param {object} options.perception - from createPerception; the recorder uses its eyes
 * @param {() => number} [options.now] - wall clock in ms
 * @param {() => number} [options.clock] - fine-grained clock in ms, for the time budget
 * @param {number} [options.radius] - how far around the bot it looks
 * @param {number} [options.tickBudgetMs] - most time one tick() may spend
 */
export function createRecorder({ bot, memory, perception, now = Date.now, clock = () => performance.now(),
    radius = 24, tickBudgetMs = 4 } = {}) {
    const registry = bot.registry;
    const { cells, things, places, trail, changes } = memory;
    const { sight, readState, columnAt } = perception;
    const stopsSight = buildStopsSightTable(registry);
    const VIEW = { maxDistance: radius + 2 };

    // What the recorder needs to know about each block state, worked out once.
    const isAir = new Uint8Array(stopsSight.length);
    const isSolid = new Uint8Array(stopsSight.length);   // a full block the bot can't walk through
    const holdsUp = new Uint8Array(stopsSight.length);    // something to stand on or in: solid, water, a ladder
    for (const block of registry.blocksArray) {
        const range = [block.minStateId, block.maxStateId + 1];
        if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') isAir.fill(1, ...range);
        if (block.boundingBox === 'block') { isSolid.fill(1, ...range); holdsUp.fill(1, ...range); }
        if (moveKindOf(block.name) !== 'walk' && moveKindOf(block.name) !== 'door') holdsUp.fill(1, ...range);
    }
    const kinds = new Map();   // block name -> kind, so kinds.js is asked once per name
    const kindFor = name => { let kind = kinds.get(name); if (kind === undefined) kinds.set(name, kind = kindOf(name)); return kind; };
    const props = new Map();   // state id -> properties by name
    const propsFor = stateId => { let p = props.get(stateId); if (p === undefined) props.set(stateId, p = propsOfState(registry, stateId)); return p; };

    // Which cells the bot has seen in the last minute, per cube: one bit a cell. A difference at a cell
    // it just saw happened in front of it, which is not news. `before` is when the cube was last looked
    // over before this stretch of watching began, so "I had looked here on an earlier visit" stays true
    // however long the bot stays.
    const recent = new Map();
    function recently(x, y, z, t) {
        const key = cubeKey(x >> 4, y >> 4, z >> 4);
        let entry = recent.get(key);
        if (!entry || t - entry.last > WATCHING_MS) {
            entry = { bits: new Uint8Array(512), last: t, before: cells.lookedAt(x >> 4, y >> 4, z >> 4) };
            recent.set(key, entry);
        }
        const i = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
        const seen = (entry.bits[i >> 3] >> (i & 7)) & 1;
        entry.bits[i >> 3] |= 1 << (i & 7);
        entry.last = t;
        return { watched: seen === 1, lookedBefore: entry.before > 0 };
    }

    let eye = null;                 // where the current look is from
    let feet = { x: 0, y: 0, z: 0 };
    let pass = null;                // the look-around in progress
    let lastPassEye = null;
    let worldChanged = true;        // a block changed nearby since the last look began
    let opened = null;              // the container window the bot has open, and where the container is
    let timer = null;
    let listening = false;

    /** Touch: the cells the body is in, the ones just below and above, and the four beside each. */
    function touching(x, y, z) {
        const sideways = Math.abs(x - feet.x) + Math.abs(z - feet.z);
        const dy = y - feet.y;
        return sideways === 0 ? dy >= -1 && dy <= 2 : sideways === 1 && (dy === 0 || dy === 1);
    }

    /** Is this cell in view? Gives the face it was seen through when there is one, else true, else null. */
    function look(x, y, z, stateId) {
        if (touching(x, y, z)) return true;
        if (!stopsSight[stateId] && sight.canSeePoint(eye, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, VIEW)) return true;
        return sight.canSeeBlock(eye, x, y, z, VIEW)?.face ?? null;
    }

    function signText(x, y, z) {
        try { return bot.blockAt({ x, y, z })?.getSignText?.().join(' / ').trim() || undefined; } catch { return undefined; }
    }

    // ---- Writing one seen cell ----

    function noteDifference(x, y, z, before, after, t) {
        const tag = cells.tagOf(x, y, z);
        const mine = tag === 'dug' ? after === AIR : tag === 'placed' ? after !== AIR : false;
        const { watched, lookedBefore } = recently(x, y, z, t);
        changes.see({ x, y, z, before, after, mine, watched, lookedBefore, place: places.at({ x, y, z })?.id ?? null });
        if (before && kindFor(before)) things.seeCell({ x, y, z }, after);
        if (before && isCrop(before) && pass?.cube) pass.cube.crops.add(before);
    }

    /** The bot sees (or touches) this cell holding this block state right now. */
    function record(x, y, z, stateId) {
        const type = registry.blocksByStateId[stateId];
        if (!type) return;
        const name = isAir[stateId] ? AIR : type.name;
        const t = now();
        const before = cells.write(x, y, z, name);
        const kind = name === AIR ? null : kindFor(name);
        if (before === null) { if (kind) noteDifference(x, y, z, null, name, t); else recently(x, y, z, t); }
        else if (before !== name && before !== OTHER_NAME) noteDifference(x, y, z, before, name, t);
        else recently(x, y, z, t);
        if (kind) {
            const state = propsFor(stateId);
            const offset = partnerOffset(name, state);
            const { thing, isNew } = things.see({ x, y, z }, name, {
                state, from: trail.current, day: bot.time?.day ?? null,
                partner: offset ? { x: x + offset.x, y: y + offset.y, z: z + offset.z } : null,
                ...(kind === 'sign' ? { text: signText(x, y, z) } : {}),
            });
            if (isNew && startsPlace(kind)) places.noteThing(thing);
        } else if (pass?.cube && isCrop(name)) {
            pass.cube.crops.add(name);
            if (isRipe(name, propsFor(stateId))) pass.cube.ripe.set(name, (pass.cube.ripe.get(name) ?? 0) + 1);
        }
    }

    function recordAt(pos) {
        const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
        const stateId = readState(x, y, z);
        if (stateId != null) record(x, y, z, stateId);
    }

    // ---- The look-around ----

    function startPass() {
        const p = bot.entity.position;
        eye = perception.eye();
        feet = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        const minY = bot.game?.minY ?? -64;
        const maxY = minY + (bot.game?.height ?? 384) - 1;
        pass = { sections: sectionsInRange(feet, radius, minY, maxY), next: 0, queue: [], cube: null, minY,
            crumb: trail.current };
        lastPassEye = eye;
        worldChanged = false;
        try {
            const biome = registry.biomes?.[bot.world.getBiome(p)]?.name;
            if (biome) things.recordBiome(p, biome);
        } catch { /* biome data is missing in some test worlds */ }
    }

    // Gathers the cells of one cube that could be in view: blocks with an open side, and remembered
    // blocks that are now air. Buried blocks are dropped here, before they cost a ray.
    function scanCube(section) {
        const { cx, sy: cy, cz } = section;
        const column = columnAt(cx, cz);
        if (!column) return; // not loaded: nothing can be said about it
        // The cube counts as looked over from here only if all of it is within reach.
        const reach = (lo, at) => Math.max(Math.abs(lo - at), Math.abs(lo + 15 - at));
        const whole = Math.hypot(reach(cx * 16, feet.x), reach(cy * 16, feet.y), reach(cz * 16, feet.z)) <= radius;
        pass.cube = { cx, cy, cz, whole, crops: new Set(), ripe: new Map() };
        const remembered = cells.hasCells(cx, cy, cz);
        if (column.sections?.[cy - (pass.minY >> 4)]?.solidBlockCount === 0 && !remembered) return; // open air, and nothing to check
        const r2 = radius * radius;
        scanSection(column, cx, cy, cz, pass.minY, () => true, (x, y, z, stateId) => {
            if ((x - feet.x) ** 2 + (y - feet.y) ** 2 + (z - feet.z) ** 2 > r2) return;
            if (isAir[stateId]) {
                if (!remembered) return;
                const was = cells.read(x, y, z);
                if (was === null || was === AIR) return;
            } else if (stopsSight[stateId] && !sight.hasOpenFace(x, y, z) && !touching(x, y, z)) {
                return;
            }
            pass.queue.push(x, y, z, stateId);
        });
    }

    function finishCube(cube) {
        cells.markLooked(cube.cx, cube.cy, cube.cz, cube.whole ? pass.crumb : null);
        if (!cube.crops.size) return;
        // A field is what memory holds of that crop in the cube, so plants hidden from this angle still count.
        const summary = cells.cubeSummary(cube.cx, cube.cy, cube.cz)?.names;
        for (const crop of cube.crops) {
            const entry = summary?.get(crop);
            things.setField(cube.cx, cube.cy, cube.cz, crop,
                { count: entry?.count ?? 0, ripe: cube.ripe.get(crop) ?? 0, min: entry?.min ?? null, max: entry?.max ?? null },
                { from: pass.crumb, day: bot.time?.day ?? null });
        }
    }

    // Animals in view, per cube. A remembered herd whose spot is in view with no such animal near it has
    // moved on, and is forgotten; one whose spot can't be seen from here is left as it was remembered.
    function finishPass() {
        const groups = new Map();
        for (const entity of perception.entities()) {
            if (!isHerdAnimal(entity.name) || !entity.position) continue;
            const p = entity.position;
            const key = cubeKey(Math.floor(p.x) >> 4, Math.floor(p.y) >> 4, Math.floor(p.z) >> 4);
            const group = groups.get(key) ?? groups.set(key, new Map()).get(key);
            const herd = group.get(entity.name) ?? group.set(entity.name, { kind: entity.name, count: 0, x: 0, y: 0, z: 0 }).get(entity.name);
            herd.count++; herd.x += p.x; herd.y += p.y; herd.z += p.z;
        }
        const how = { from: pass.crumb, day: bot.time?.day ?? null };
        for (const herd of things.herdsNear(feet, { maxDistance: radius })) {
            const key = cubeKey(herd.x >> 4, herd.y >> 4, herd.z >> 4);
            if (groups.has(key) || !sight.canSeePoint(eye, { x: herd.x + 0.5, y: herd.y + 0.5, z: herd.z + 0.5 }, VIEW)) continue;
            things.setHerds(herd.x >> 4, herd.y >> 4, herd.z >> 4, [], how);
        }
        for (const [key, group] of groups) {
            // The middle of the animals, rounded down so it stays inside their cube.
            things.setHerds(...key.split(',').map(Number), [...group.values()].map(h => ({ kind: h.kind, count: h.count,
                x: Math.floor(h.x / h.count), y: Math.floor(h.y / h.count), z: Math.floor(h.z / h.count) })), how);
        }
        const t = now();
        for (const [key, entry] of recent) if (t - entry.last > WATCHING_MS) recent.delete(key);
    }

    /** One slice of work. Call it often; it returns as soon as its time is used up or nothing is left to do. */
    function tick({ budgetMs = tickBudgetMs } = {}) {
        if (!bot.entity?.position) return;
        changes.settle();
        const p = bot.entity.position;
        if (!pass) {
            const e = perception.eye();
            const moved = !lastPassEye || Math.hypot(e.x - lastPassEye.x, e.y - lastPassEye.y, e.z - lastPassEye.z) >= 1;
            if (!moved && !worldChanged) return; // standing still in an unchanged world: nothing new to see
            startPass();
        } else if (Math.abs(Math.floor(p.x) - feet.x) + Math.abs(Math.floor(p.y) - feet.y) + Math.abs(Math.floor(p.z) - feet.z) > 16) {
            startPass(); // the bot has left the area this look was covering
        }
        const deadline = clock() + budgetMs;
        do {
            if (pass.queue.length) {
                const stateId = pass.queue.pop(), z = pass.queue.pop(), y = pass.queue.pop(), x = pass.queue.pop();
                const seen = look(x, y, z, stateId);
                if (!seen) continue;
                record(x, y, z, stateId);
                if (seen !== true) {
                    // The cell in front of the face it saw: the bot looked straight through it.
                    const fx = x + seen[0], fy = y + seen[1], fz = z + seen[2];
                    const front = readState(fx, fy, fz);
                    if (front != null && isAir[front]) cells.sawEmpty(fx, fy, fz);
                }
            } else if (pass.cube) {
                finishCube(pass.cube);
                pass.cube = null;
            } else if (pass.next < pass.sections.length) {
                scanCube(pass.sections[pass.next++]);
            } else {
                finishPass();
                pass = null;
                break;
            }
        } while (clock() < deadline);
    }

    // ---- The trail ----

    function onMove() {
        const p = bot.entity?.position;
        if (!p) return;
        const under = readState(Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z));
        const kind = under == null ? 'walk' : moveKindOf(registry.blocksByStateId[under]?.name);
        const supported = Boolean(bot.entity.onGround) || Boolean(bot.entity.isInWater) || kind === 'ladder' || kind === 'water';
        trail.visit(p, { kind, supported });
    }

    /**
     * Could the bot walk in a straight line between two spots? Every half block along the line there
     * has to be room for its body and something under its feet, allowing a step up or down of one block.
     * A wall, a pane of glass or a gap in the floor all say no. The trail asks this before treating two
     * nearby crumbs as the same spot.
     */
    function canWalkStraight(a, b) {
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 2));
        for (let i = 0; i <= steps; i++) {
            const f = i / steps;
            const x = Math.floor(a.x + (b.x - a.x) * f), z = Math.floor(a.z + (b.z - a.z) * f);
            const y = Math.floor(a.y + (b.y - a.y) * f + 0.2);
            let room = false;
            for (const level of [y, y + 1, y - 1]) {
                const feetCell = readState(x, level, z), head = readState(x, level + 1, z), ground = readState(x, level - 1, z);
                if (feetCell == null || head == null || ground == null) return false; // not loaded: can't tell
                if (!isSolid[feetCell] && !isSolid[head] && (holdsUp[ground] || holdsUp[feetCell])) { room = true; break; }
            }
            if (!room) return false;
        }
        return true;
    }

    // ---- Containers, and the bot's own digging and placing ----

    function snapshot() {
        if (!opened) return;
        const window = opened.window;
        const items = window.containerItems().map(item => ({ name: item.name, count: item.count }));
        const slots = Number.isInteger(window.inventoryStart) ? window.inventoryStart : null;
        recordAt(opened.pos); // the bot has its hands on it: make sure memory has the container itself
        things.setContents(opened.pos, items, { slots, freeSlots: slots === null ? null : slots - window.containerItems().length });
    }

    // Every way of opening a container block goes through bot.openBlock, so one wrapper sees them all.
    function watchContainers() {
        if (typeof bot.openBlock !== 'function' || bot.openBlock.worldMemory) return;
        const openBlock = bot.openBlock;
        bot.openBlock = async function (block, ...rest) {
            const window = await openBlock.call(this, block, ...rest);
            try {
                if (block?.position && typeof window?.containerItems === 'function') { opened = { window, pos: block.position }; snapshot(); }
            } catch (error) { console.warn('[world memory] Could not note what is in the container:', error.message); }
            return window;
        };
        bot.openBlock.worldMemory = true;
    }
    const onWindowClose = window => {
        if (opened?.window !== window) return;
        try { snapshot(); } catch { /* the window is gone; the look taken when it opened stands */ }
        opened = null;
    };
    const onDug = block => { if (block?.position) { cells.tag(block.position.x, block.position.y, block.position.z, 'dug'); recordAt(block.position); } };
    const onPlaced = (oldBlock, newBlock) => {
        const pos = newBlock?.position ?? oldBlock?.position;
        if (pos) { cells.tag(pos.x, pos.y, pos.z, 'placed'); recordAt(pos); }
    };
    const onBlockUpdate = (oldBlock, newBlock) => {
        const pos = (newBlock ?? oldBlock)?.position;
        const p = bot.entity?.position;
        if (pos && p && Math.abs(pos.x - p.x) <= radius && Math.abs(pos.y - p.y) <= radius && Math.abs(pos.z - p.z) <= radius) worldChanged = true;
    };
    const onDeath = () => trail.breakStretch();
    const listeners = [['move', onMove], ['windowClose', onWindowClose], ['diggingCompleted', onDug], ['blockPlaced', onPlaced],
        ['blockUpdate', onBlockUpdate], ['death', onDeath]];

    // ---- What perception is told the bot remembers ----
    //
    // Perception answers "what is there?" for cells out of sight from memory. This is world memory in
    // the shape perception expects of a memory: the same few calls the seen-world map offers.
    const view = {
        recordsAll: true,
        scope: memory.scope,
        observeBlock(pos, name, provenance, stateId) {
            if (Number.isInteger(stateId)) record(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), stateId);
            else recordAt(pos);
        },
        observeCell(pos) { recordAt(pos); },
        /** What the bot believes is at a cell, or null: a thing with its state, or a plain block by name. */
        get(x, y, z) {
            const thing = things.get(x, y, z);
            if (thing && thing.provenance !== 'gone' && thing.provenance !== 'reported') {
                const main = thing.x === x && thing.y === y && thing.z === z;
                return { x, y, z, name: thing.name, state: (main ? thing.state : thing.alsoState) ?? null, lastSeen: thing.lastSeen, provenance: 'observed' };
            }
            const name = cells.read(x, y, z);
            if (!name || name === AIR || name === OTHER_NAME) return null;
            return { x, y, z, name, lastSeen: cells.lookedAt(x >> 4, y >> 4, z >> 4), provenance: 'observed' };
        },
        /** The nearest remembered blocks that could match: by name, or by a test on the name. */
        recall({ names = null, accepts = null, point, maxDistance, count }) {
            const wanted = names ?? [...cells.namesWithin(point, maxDistance)].filter(name => name !== OTHER_NAME && accepts(name));
            if (!wanted.length) return [];
            return cells.nearest(wanted, point, { maxDistance, limit: count })
                .map(hit => view.get(hit.x, hit.y, hit.z)).filter(Boolean);
        },
        within: () => [],
        markExplored() {},
        recordBiome: (pos, name) => things.recordBiome(pos, name),
    };

    return {
        view, tick, canWalkStraight, recordAt,
        /** Is a look-around in progress? */
        get busy() { return pass !== null; },

        /** Starts listening for the bot moving, opening containers, digging and placing. start() does this too. */
        listen() {
            if (listening) return;
            listening = true;
            watchContainers();
            for (const [event, listener] of listeners) bot.on?.(event, listener);
        },

        /** Starts recording: the listeners, and the look-around on a timer. */
        start({ intervalMs = 150 } = {}) {
            if (timer) return;
            this.listen();
            timer = setInterval(() => { try { tick(); } catch (error) { console.warn('[world memory] Recorder tick failed:', error.message); } }, intervalMs);
            timer.unref?.(); // never the only thing keeping the process alive
        },

        /** Stops for good and removes every listener it added. */
        stop() {
            clearInterval(timer);
            timer = null;
            for (const [event, listener] of listeners) bot.off?.(event, listener);
            listening = false;
        },
    };
}
