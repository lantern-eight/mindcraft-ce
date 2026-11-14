// SPDX-License-Identifier: CC0-1.0
// A room of chests for tests, behind the few parts of a mineflayer bot that chest sorting touches:
// opening a container, clicking a slot, the cursor, the bot's own inventory, and closing.
//
// It keeps two copies of an open window, as the real thing does. One is what the server holds, which
// is the truth. The other is what the bot's side works out for itself from its own clicks, without
// waiting to be told. The two can disagree (the tests make them), and asking the server to send the
// window again brings the bot's copy back in line.
//
// The clicking here is written from how the game behaves, not from the sort plan's own idea of a move,
// so a sort that passes has been checked against something other than itself.

const clone = stack => (stack ? { ...stack } : null);
const sameKind = (a, b) => a.name === b.name && (a.tag ?? null) === (b.tag ?? null);
const idOf = pos => `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
const posOf = id => { const [x, y, z] = id.split(',').map(Number); return { x, y, z }; };

/** 'cobblestone x40' is a stack of 40, a bare name is one item, null an empty slot. `tag` marks a variant (a worn tool). */
export function stack(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'object') return { ...text };
    const [name, count = '1'] = text.split(' x');
    return { name, count: Number(count) };
}

/**
 * One left click, as the game does it: pick up, put down, pour onto the same kind, or swap.
 * `view` is { slots, cursor }.
 */
function leftClick(view, slot, sizeOf, alike = sameKind) {
    const there = view.slots[slot], held = view.cursor;
    if (!held) { view.cursor = there; view.slots[slot] = null; return; }
    if (!there) { view.slots[slot] = held; view.cursor = null; return; }
    if (!alike(there, held)) { view.slots[slot] = held; view.cursor = there; return; }
    const poured = Math.max(0, Math.min(sizeOf(there.name) - there.count, held.count));
    view.slots[slot] = { ...there, count: there.count + poured };
    view.cursor = held.count > poured ? { ...held, count: held.count - poured } : null;
}

/**
 * @param {object} [options]
 * @param {Object<string, (string|object|null)[]>} [options.chests] - "x,y,z" -> its slots, every slot listed
 * @param {(string|object|null)[]} [options.pockets] - the bot's own 36 inventory slots (27 main, then the hotbar)
 * @param {Object<string, number>} [options.sizes] - how many of an item fit in a slot, where not 64
 * @param {Object<string, number>} [options.serverSizes] - what the server really allows, where it differs
 *   from what the bot's item data says
 * @param {boolean} [options.clientIgnoresTags] - the bot's side treats variants of an item as the same
 *   thing when it guesses the result of a click (mineflayer does, for items that differ only in their
 *   components); the server never does
 * @returns {{bot: object, room: object}}
 */
export function fakeChestBot({ chests = {}, pockets = [], sizes = {}, serverSizes = null, clientIgnoresTags = false } = {}) {
    const clientSize = name => sizes[name] ?? 64;
    const serverSize = name => (serverSizes ?? sizes)[name] ?? 64;
    const toItem = (s, slot) => (s ? {
        name: s.name, count: s.count, type: s.name, metadata: 0, nbt: null, slot, stackSize: clientSize(s.name),
        components: s.tag == null ? [] : [{ type: 'custom_data', data: s.tag }], removedComponents: [],
    } : null);

    let open = null;        // the window that is open now: { id, window, server, client, size }
    let windowIds = 0;

    const room = {
        chests: new Map(Object.entries(chests).map(([id, slots]) => [id, slots.map(stack)])),
        pockets: Array.from({ length: 36 }, (_, i) => stack(pockets[i] ?? null)),
        halves: new Map(),      // "x,y,z" of the second half of a double chest -> the id of its chest
        blocked: new Set(),     // chests that refuse to open
        stuck: new Set(),       // chests that never answer at all
        opens: [],              // every chest opened, in order
        walks: [],              // every chest walked to, in order
        clicks: 0,
        dropped: [],            // stacks that ended up on the floor
        onOpen: null,           // (id, how many times it has now been opened) => void, before the window opens
        onClick: null,          // (how many clicks so far) => void, before the click lands

        /** What is really in a chest. */
        contents: id => room.chests.get(id).map(clone),
        /** What is really in a chest, as the item objects a bot would be shown. */
        items: id => room.chests.get(id).map(toItem),
        /** How many of each thing exist anywhere: in the chests, on the bot, on the floor. */
        totals() {
            const sum = {};
            const add = s => { if (s) { const key = s.tag == null ? s.name : `${s.name}#${s.tag}`; sum[key] = (sum[key] ?? 0) + s.count; } };
            for (const slots of room.chests.values()) slots.forEach(add);
            room.pockets.forEach(add);
            room.dropped.forEach(add);
            return sum;
        },
        /** The chests as the sorter is handed them. */
        descriptors: () => [...room.chests.keys()].map(id => {
            const also = [...room.halves].find(([, chest]) => chest === id)?.[0];
            return { id, ...posOf(id), also: also ? posOf(also) : null, name: 'chest' };
        }),
        blockAt(pos) {
            const key = idOf(pos);
            return room.chests.has(key) || room.halves.has(key) ? { name: 'chest', position: posOf(key) } : null;
        },
        goTo: async chest => { room.walks.push(chest.id); },
    };

    const bot = {
        username: 'Sorter',
        output: '',
        currentWindow: null,
        registry: {
            itemsByName: new Proxy({}, { get: (_, name) => ({ name, stackSize: clientSize(name) }) }),
            foodsByName: { bread: {}, apple: {}, cooked_beef: {} },
        },
        inventory: {
            get slots() {
                const out = new Array(46).fill(null);
                room.pockets.forEach((s, i) => { out[9 + i] = toItem(s, 9 + i); });
                return out;
            },
        },
        async openContainer(block) {
            const key = idOf(block.position);
            const id = room.chests.has(key) ? key : room.halves.get(key);
            if (!id || !room.chests.has(id)) throw new Error('There is no container there.');
            room.opens.push(id);
            room.onOpen?.(id, room.opens.filter(opened => opened === id).length);
            if (room.stuck.has(id)) return new Promise(() => {});
            if (room.blocked.has(id) || !room.chests.has(id)) throw new Error('The chest did not open.');
            const size = room.chests.get(id).length;
            const server = { slots: [...room.chests.get(id).map(clone), ...room.pockets.map(clone)], cursor: null };
            const client = { slots: server.slots.map(clone), cursor: null };
            const window = {
                id: ++windowIds, type: 'minecraft:generic_9x3', inventoryStart: size, inventoryEnd: size + 36,
                get slots() { return client.slots.map(toItem); },
                get selectedItem() { return toItem(client.cursor, -1); },
                close() {
                    if (bot.currentWindow !== window) return;
                    // The server hands a stack left on the cursor back to the player, or drops it.
                    if (server.cursor) {
                        const free = server.slots.findIndex((s, i) => i >= size && !s);
                        if (free >= 0) server.slots[free] = server.cursor;
                        else room.dropped.push(server.cursor);
                        server.cursor = null;
                    }
                    room.chests.set(id, server.slots.slice(0, size));
                    room.pockets = server.slots.slice(size);
                    bot.currentWindow = null;
                    open = null;
                },
            };
            open = { id, window, server, client, size };
            bot.currentWindow = window;
            return window;
        },
        async clickWindow(slot) {
            if (!open) throw new Error('No window is open.');
            room.clicks++;
            room.onClick?.(room.clicks);
            leftClick(open.server, slot, serverSize);
            leftClick(open.client, slot, clientSize, clientIgnoresTags ? (a, b) => a.name === b.name : sameKind);
        },
        /** Asks the server to send the whole window again: the bot's copy becomes the truth. */
        async _syncWindow() {
            if (!open) return;
            open.client.slots = open.server.slots.map(clone);
            open.client.cursor = clone(open.server.cursor);
        },
    };
    return { bot, room };
}
