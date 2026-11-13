// SPDX-License-Identifier: CC0-1.0
// The fair bot: what generated code gets instead of the real mineflayer bot.
//
// A person playing survival can read their own stats and inventory, look around, press movement
// keys, and click on things they can see within reach. They can't write packets, teleport, read
// chunk data through stone, or flip the server into creative. The facade gives code exactly the
// first list:
//   - reads come back as frozen snapshots (copies), so writing `bot.entity.position.x` does nothing
//     to the real bot;
//   - searches and entity lists come from perception (what the bot has seen), never raw world data;
//   - world actions (dig, place, click, attack, open) only take targets perception knows about, and
//     pass through `guard` (the reach guard and good-neighbor rules plug in there);
//   - chat passes through `chatGuard` (no slash commands);
//   - everything else (`_client`, `world`, `creative`, `modes`, events, physics) is simply absent.
//
// Snapshots handed out are remembered in a WeakMap, so when code hands one back (`bot.dig(block)`,
// `skills.attackEntity(bot, mob)`) it is turned back into the live object, after checking the bot
// still perceives it. Code never gets a live object, and can't make up a target it never saw.

const CONTROLS = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']);
const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/; // Minecraft's own username rule

/**
 * @param {object} realBot - the mineflayer bot
 * @param {object} deps
 * @param {function} deps.Vec3 - the vec3 factory (already hardened by the code runner)
 * @param {object} deps.perception - { blockAt(pos), findBlocks(opts), entities() }: known blocks and
 *   perceived entities only (see docs: fair-play design 3.4)
 * @param {function} [deps.guard] - (action, liveTarget, extra) => void; throws to refuse
 * @param {function} [deps.chatGuard] - (message) => {allowed, reason}
 */
export function createFairBot(realBot, { Vec3, perception, guard = () => {}, chatGuard = () => ({ allowed: true }) }) {
    const harden = globalThis.harden;
    if (typeof harden !== 'function') throw new Error('createFairBot needs SES lockdown() to have run');

    // Snapshot handed out -> how to find the live thing again.
    const origins = new WeakMap();

    // ---- Snapshots: plain frozen copies of what a player could see on screen ----

    const vec = v => (v ? Vec3(v.x, v.y, v.z) : null);
    const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

    function itemSnapshot(item) {
        if (!item) return null;
        let enchants;
        try { enchants = (item.enchants || []).map(e => ({ name: String(e.name), lvl: Number(e.lvl) })); } catch { enchants = []; }
        return harden({
            name: item.name, type: item.type, count: item.count, slot: item.slot, metadata: item.metadata,
            displayName: item.displayName, stackSize: item.stackSize,
            durabilityUsed: num(item.durabilityUsed), maxDurability: num(item.maxDurability), enchants,
        });
    }

    function blockSnapshot(block) {
        if (!block) return null;
        let properties = {};
        try { properties = { ...(block.getProperties?.() ?? {}) }; } catch { /* some blocks have none */ }
        const snap = harden({
            name: block.name, type: block.type, stateId: block.stateId, metadata: block.metadata,
            displayName: block.displayName, position: vec(block.position), hardness: block.hardness,
            diggable: block.diggable, boundingBox: block.boundingBox, properties,
        });
        origins.set(snap, { kind: 'block', position: block.position });
        return snap;
    }

    // What a player can tell about a mob or player by looking: no metadata (it carries mob health and
    // other things the game never shows), no equipment internals.
    function entitySnapshot(entity) {
        if (!entity) return null;
        const snap = harden({
            id: entity.id, name: entity.name, type: entity.type, username: entity.username,
            displayName: entity.displayName, kind: entity.kind,
            position: vec(entity.position), velocity: vec(entity.velocity),
            yaw: entity.yaw, pitch: entity.pitch, height: entity.height, width: entity.width,
            onGround: entity.onGround, isValid: entity.isValid,
        });
        origins.set(snap, { kind: 'entity', id: entity.id });
        return snap;
    }

    function selfSnapshot() {
        const e = realBot.entity;
        return harden({
            id: e.id, position: vec(e.position), velocity: vec(e.velocity), yaw: e.yaw, pitch: e.pitch,
            onGround: e.onGround, height: e.height, width: e.width,
        });
    }

    // ---- Turning what code hands back into live objects ----

    const toPosition = arg => {
        const origin = origins.get(arg);
        if (origin?.kind === 'block') return origin.position;
        const p = arg?.position ?? arg;
        if (p && [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n))) return Vec3(p.x, p.y, p.z);
        return null;
    };

    /** A block the bot knows about (seen or touched), or an error the model can understand. */
    function liveBlock(arg) {
        const pos = toPosition(arg);
        if (!pos) throw new Error('Expected a block or a position.');
        const block = perception.blockAt(pos);
        if (!block) throw new Error(`You haven't seen a block at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}.`);
        return block;
    }

    /** An entity the bot perceives right now, looked up by id. */
    function liveEntity(arg) {
        const id = origins.get(arg)?.id ?? arg?.id;
        const entity = id === undefined ? null : perception.entities().find(e => e.id === id);
        if (!entity) throw new Error("You can't see that entity right now.");
        return entity;
    }

    /** An item in the bot's own inventory, by snapshot (slot), name, or type id. */
    function liveItem(arg) {
        const items = realBot.inventory.items();
        const match = typeof arg === 'string' ? items.find(i => i.name === arg)
            : typeof arg === 'number' ? items.find(i => i.type === arg)
            : items.find(i => i.slot === arg?.slot && i.name === arg?.name) ?? items.find(i => i.name === arg?.name);
        if (!match) throw new Error(`You don't have ${typeof arg === 'object' ? arg?.name : arg}.`);
        return match;
    }

    /** True when `value` is a snapshot this facade handed out. */
    const isSnapshot = value => value !== null && typeof value === 'object' && origins.has(value);

    /** Converts a snapshot back to its live object (checked against perception); other values pass through. */
    function toLive(value) {
        if (!isSnapshot(value)) return value;
        return origins.get(value).kind === 'block' ? liveBlock(value) : liveEntity(value);
    }

    // Perceived entities, nearest first.
    function perceivedEntities() {
        const here = realBot.entity.position;
        return perception.entities()
            .filter(e => e.id !== realBot.entity.id)
            .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
    }

    // Container windows become small proxies: the moves a player makes in a chest screen, nothing more.
    function containerProxy(window) {
        const proxy = {
            containerItems: () => window.containerItems().map(itemSnapshot),
            items: () => window.items().map(itemSnapshot),
            deposit: async (itemType, metadata, count) => { await window.deposit(itemType, metadata ?? null, count); },
            withdraw: async (itemType, metadata, count) => { await window.withdraw(itemType, metadata ?? null, count); },
            close: () => {
                if (typeof window.close === 'function') window.close();
                else realBot.closeWindow(window);
            },
        };
        if (typeof window.inputItem === 'function') Object.assign(proxy, {
            inputItem: () => itemSnapshot(window.inputItem()),
            fuelItem: () => itemSnapshot(window.fuelItem()),
            outputItem: () => itemSnapshot(window.outputItem()),
            putInput: async (itemType, metadata, count) => { await window.putInput(itemType, metadata ?? null, count); },
            putFuel: async (itemType, metadata, count) => { await window.putFuel(itemType, metadata ?? null, count); },
            takeInput: async () => itemSnapshot(await window.takeInput()),
            takeFuel: async () => itemSnapshot(await window.takeFuel()),
            takeOutput: async () => itemSnapshot(await window.takeOutput()),
            get fuel() { return window.fuel; },
            get progress() { return window.progress; },
        });
        return harden(proxy);
    }

    async function openWith(method, blockArg) {
        const block = liveBlock(blockArg);
        guard('open', block);
        return containerProxy(await realBot[method](block));
    }

    // ---- The facade ----

    const fairBot = {
        get username() { return realBot.username; },
        get version() { return realBot.version; },
        get entity() { return selfSnapshot(); },
        get health() { return realBot.health; },
        get food() { return realBot.food; },
        get foodSaturation() { return realBot.foodSaturation; },
        get oxygenLevel() { return realBot.oxygenLevel; },
        get isSleeping() { return Boolean(realBot.isSleeping); },
        get isRaining() { return Boolean(realBot.isRaining); },
        get heldItem() { return itemSnapshot(realBot.heldItem); },
        get experience() {
            const xp = realBot.experience;
            return xp ? harden({ level: xp.level, points: xp.points, progress: xp.progress }) : null;
        },
        get game() {
            const g = realBot.game ?? {};
            return harden({ gameMode: g.gameMode, dimension: g.dimension, difficulty: g.difficulty });
        },
        get time() {
            const t = realBot.time ?? {};
            return harden({ timeOfDay: t.timeOfDay, day: t.day, isDay: t.isDay });
        },
        // Read-only, so the interrupt checks the coder inserts keep working.
        get interrupt_code() { return Boolean(realBot.interrupt_code); },

        inventory: {
            items: () => realBot.inventory.items().map(itemSnapshot),
            get slots() { return (realBot.inventory.slots || []).map(itemSnapshot); },
            count: (nameOrType) => realBot.inventory.items()
                .filter(i => i.name === nameOrType || i.type === nameOrType).reduce((n, i) => n + i.count, 0),
            findInventoryItem: (nameOrType) => itemSnapshot(realBot.inventory.items()
                .find(i => i.name === nameOrType || i.type === nameOrType)),
            emptySlotCount: () => realBot.inventory.emptySlotCount(),
        },

        // ---- Perception: what the bot has seen, never raw chunk data ----
        blockAt: (pos) => {
            const p = toPosition(pos);
            return p ? blockSnapshot(perception.blockAt(p)) : null;
        },
        findBlocks: (options = {}) => {
            const { matching } = options;
            // A predicate from generated code only ever sees snapshots.
            const safeMatching = typeof matching === 'function' ? (block => Boolean(matching(blockSnapshot(block)))) : matching;
            return perception.findBlocks({ ...options, matching: safeMatching }).map(vec);
        },
        findBlock: (options = {}) => {
            const [first] = fairBot.findBlocks({ ...options, count: 1 });
            return first ? fairBot.blockAt(first) : null;
        },
        blockAtCursor: (maxDistance = 4.5) => blockSnapshot(realBot.blockAtCursor?.(maxDistance)), // a ray from the eye: fair by construction
        get entities() {
            return harden(Object.fromEntries(perceivedEntities().map(e => [e.id, entitySnapshot(e)])));
        },
        nearestEntity: (filter = () => true) => {
            for (const e of perceivedEntities()) {
                const snap = entitySnapshot(e);
                if (filter(snap)) return snap;
            }
            return null;
        },
        get players() {
            // Player names are on the tab list for everyone; a player's entity only when perceived.
            const seen = new Map(perceivedEntities().filter(e => e.type === 'player').map(e => [e.username, e]));
            return harden(Object.fromEntries(Object.keys(realBot.players || {}).map(name =>
                [name, { username: name, entity: entitySnapshot(seen.get(name)) }])));
        },

        // ---- Player inputs ----
        setControlState: (control, state) => {
            if (!CONTROLS.has(control)) throw new Error(`Unknown control: ${control}`);
            realBot.setControlState(control, Boolean(state));
        },
        getControlState: (control) => Boolean(realBot.getControlState?.(control)),
        clearControlStates: () => { realBot.clearControlStates(); },
        look: async (yaw, pitch, force) => { await realBot.look(Number(yaw), Number(pitch), force); },
        // Looking toward any coordinates is fair: a player can turn their head anywhere.
        lookAt: async (point, force) => { await realBot.lookAt(toPosition(point) ?? Vec3(0, 0, 0), force); },
        swingArm: (hand) => { realBot.swingArm?.(hand); },
        equip: async (item, destination = 'hand') => { await realBot.equip(liveItem(item), destination); },
        unequip: async (destination = 'hand') => { await realBot.unequip(destination); },
        toss: async (itemType, metadata, count) => { await realBot.toss(itemType, metadata ?? null, count); },
        tossStack: async (item) => { await realBot.tossStack(liveItem(item)); },
        consume: async () => { await realBot.consume(); },
        activateItem: (offHand) => { realBot.activateItem(Boolean(offHand)); },
        deactivateItem: () => { realBot.deactivateItem(); },
        setQuickBarSlot: (slot) => { realBot.setQuickBarSlot(Number(slot)); },
        waitForTicks: async (ticks) => { await realBot.waitForTicks(Number(ticks)); },

        // ---- World actions: perceived targets only, each passed through the guards ----
        dig: async (block, forceLook = true, digFace = 'raycast') => {
            const live = liveBlock(block);
            guard('dig', live);
            await realBot.dig(live, forceLook, digFace);
        },
        placeBlock: async (referenceBlock, faceVector) => {
            const live = liveBlock(referenceBlock);
            const face = toPosition(faceVector);
            if (!face) throw new Error('placeBlock needs a face direction, like new Vec3(0, 1, 0).');
            guard('place', live, { face });
            await realBot.placeBlock(live, face);
        },
        activateBlock: async (block, direction, cursorPos) => {
            const live = liveBlock(block);
            guard('activate', live);
            await realBot.activateBlock(live, toPosition(direction) ?? undefined, toPosition(cursorPos) ?? undefined);
        },
        attack: async (entity) => {
            const live = liveEntity(entity);
            guard('attack', live);
            await realBot.attack(live);
        },
        activateEntity: async (entity) => {
            const live = liveEntity(entity);
            guard('activateEntity', live);
            await realBot.activateEntity(live);
        },
        useOn: async (entity) => {
            const live = liveEntity(entity);
            guard('useOn', live);
            await realBot.useOn(live);
        },
        openContainer: (block) => openWith('openContainer', block),
        openChest: (block) => openWith('openContainer', block),
        openFurnace: (block) => openWith('openFurnace', block),

        // ---- Chat ----
        chat: (message) => {
            const text = String(message);
            const verdict = chatGuard(text);
            if (!verdict?.allowed) throw new Error(verdict?.reason || 'That message is not allowed.');
            realBot.chat(text);
        },
        whisper: (username, message) => {
            // mineflayer builds "/tell <name> <message>", so a name with spaces could smuggle in a different command.
            if (!PLAYER_NAME.test(String(username))) throw new Error('That is not a valid player name.');
            realBot.whisper(String(username), String(message));
        },
    };

    harden(fairBot);

    /** Converts a value coming back from host code (skills, world functions) into something safe to hand out. */
    function toSafe(value, depth = 0) {
        if (value === null || value === undefined) return value;
        const type = typeof value;
        if (type !== 'object') return type === 'function' ? undefined : value;
        if (value === realBot) return fairBot;
        if (depth > 6) return undefined;
        if (Array.isArray(value)) return harden(value.map(v => toSafe(v, depth + 1)));
        if (typeof value.stateId === 'number' && value.position) return blockSnapshot(value);
        if (value.id !== undefined && value.position && typeof value.height === 'number') return entitySnapshot(value);
        if (typeof value.count === 'number' && typeof value.name === 'string' && 'slot' in value) return itemSnapshot(value);
        if ([value.x, value.y, value.z].every(n => typeof n === 'number') && Object.keys(value).length <= 3) return vec(value);
        // Plain data (like a tool result): copy own enumerable fields, dropping functions and host objects.
        const copy = {};
        for (const [key, v] of Object.entries(value)) {
            const safe = toSafe(v, depth + 1);
            if (safe !== undefined) copy[key] = safe;
        }
        return harden(copy);
    }

    return { fairBot, toLive, toSafe, isSnapshot, liveBlock, liveEntity };
}
