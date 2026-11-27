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

import minecraftData from 'minecraft-data';
import { GAME_VERSION } from './game_version.js';

const ITEM_NAMES = new Set(Object.keys(minecraftData(GAME_VERSION).itemsByName));
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
 * Moves up to `count` of an item from one run of slots to another, the way the game's own "take" and
 * "put" do it: onto part stacks of the same kind first, then into empty slots. What fits is moved
 * even when not all of it does, and then it throws, as mineflayer does.
 * `view` is { slots, cursor }; `from` and `to` are [first slot, one past the last].
 */
function transfer(view, name, count, from, to, sizeOf) {
    const within = (i, [start, end]) => i >= start && i < end;
    let left = count;
    while (left > 0) {
        const source = view.slots.findIndex((s, i) => within(i, from) && s?.name === name);
        if (source < 0) throw new Error(`Can't find ${name} in slots [${from[0]} - ${from[1]}]`);
        const stack = view.slots[source];
        let target = view.slots.findIndex((s, i) => within(i, to) && s && sameKind(s, stack) && s.count < sizeOf(name));
        if (target < 0) target = view.slots.findIndex((s, i) => within(i, to) && !s);
        if (target < 0) throw new Error('destination full');
        const moved = Math.min(left, stack.count, sizeOf(name) - (view.slots[target]?.count ?? 0));
        view.slots[target] = { ...stack, count: (view.slots[target]?.count ?? 0) + moved };
        view.slots[source] = stack.count > moved ? { ...stack, count: stack.count - moved } : null;
        left -= moved;
    }
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
    const heard = new Map(); // event name -> the bot's listeners for it
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
        // An older copy of the open window that is still on its way when the bot next asks the server
        // what is there: (the server's { slots, cursor }) => { slots, cursor }. The bot gets it first,
        // and the true copy a few milliseconds later, as on a real server after a quick run of clicks.
        lateCopy: null,

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
            // The game's own items, as a real registry has them: a name that is no item is not one here either.
            itemsByName: new Proxy({}, { get: (_, name) => (ITEM_NAMES.has(name) ? { id: name, name, stackSize: clientSize(name) } : undefined) }),
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
            server.sizeOf = serverSize; client.sizeOf = clientSize;
            // The same thing happens on the server and in the bot's copy; a problem is reported once.
            const both = fn => {
                let problem = null;
                for (const view of [server, client]) { try { fn(view); } catch (error) { problem = error; } }
                if (problem) throw problem;
            };
            const window = {
                id: ++windowIds, type: 'minecraft:generic_9x3', inventoryStart: size, inventoryEnd: size + 36,
                get slots() { return client.slots.map(toItem); },
                get selectedItem() { return toItem(client.cursor, -1); },
                // mineflayer's own "take out" and "put in": between the chest's slots and the bot's.
                async withdraw(type, metadata, count) {
                    // mineflayer refuses outright when no slot of the bot's is empty, even with room on a stack.
                    if (client.slots.slice(size).every(Boolean)) throw new Error('Unable to withdraw, Bot inventory is full.');
                    both(view => transfer(view, type, count, [0, size], [size, size + 36], view.sizeOf));
                },
                async deposit(type, metadata, count) { both(view => transfer(view, type, count, [size, size + 36], [0, size], view.sizeOf)); },
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
        /** mineflayer's `transfer`: moves up to `count` of an item from one run of a window's slots to another. */
        async transfer({ window, itemType, count, sourceStart, sourceEnd, destStart, destEnd }) {
            if (!open || open.window !== window) throw new Error('No window is open.');
            const problems = [];
            for (const view of [open.server, open.client]) {
                try { transfer(view, itemType, count, [sourceStart, sourceEnd], [destStart, destEnd], view.sizeOf); }
                catch (error) { problems.push(error); }
            }
            if (problems.length) throw problems[0];
        },
        on(name, fn) { heard.set(name, [...(heard.get(name) ?? []), fn]); },
        off(name, fn) { heard.set(name, (heard.get(name) ?? []).filter(listener => listener !== fn)); },
        /** Asks the server to send the whole window again: the bot's copy becomes the truth. */
        async _syncWindow() {
            if (!open) return;
            const current = open;
            const truth = () => {
                current.client.slots = current.server.slots.map(clone);
                current.client.cursor = clone(current.server.cursor);
            };
            if (!room.lateCopy) return truth();
            const stale = room.lateCopy({ slots: current.server.slots.map(clone), cursor: clone(current.server.cursor) });
            room.lateCopy = null;
            current.client.slots = stale.slots.map(clone);
            current.client.cursor = clone(stale.cursor);
            setTimeout(() => {
                if (open !== current) return;
                truth();
                for (const fn of heard.get(`setWindowItems:${current.window.id}`) ?? []) fn();
            }, 5);
        },
    };
    return { bot, room };
}
