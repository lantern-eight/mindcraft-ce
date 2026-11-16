// SPDX-License-Identifier: CC0-1.0
// Moving a stack in an open chest on Bedrock: the edition seam's `moveStack` (see src/agent/edition/java.js).
//
// Chest sorting makes each move the way a player does with the mouse: onto an empty slot the stack is put
// down, onto the same kind of item it is poured in and what doesn't fit stays where it was, onto anything
// else the two swap. On Java that is three clicks on a cursor. Bedrock has no clicks: a client asks the
// server to move items with an item stack request, and the server answers yes or no. One request does any
// of the three, so a move is one request here.
//
// The adapter has a `clickWindow` that turns two clicks into one such request, but it always asks for a
// plain move: onto another kind of item that is refused, and onto the same kind it asks to move more than
// fits. So this asks for exactly the move the plan means.
//
// The server's answer only says yes or no, with the new counts of the slots it touched. The bot's copy of
// the window is brought up to date from that here; the server sends the chest's side again on its own,
// and that is the truth if the two differ. A refused move changes nothing, and chest sorting, which
// checks every move against what it sees, plans again.

import Vec3 from 'vec3';

// The window numbers its slots as on Java: the chest's first, then the bot's 27 main slots, then the
// nine of its hotbar. Bedrock names each by the container it is in and its place there.
const MAIN = 27, HOTBAR = 9;

/**
 * What Bedrock calls the open container's own slots in a request. Most containers' are "container", but
 * a barrel's are "barrel" and a shulker box's "shulker", and the server refuses a move that names the
 * wrong one: every move into a barrel was refused until this was asked.
 */
export function containerSideOf(blockName) {
    if (blockName === 'barrel') return 'barrel';
    if (blockName?.endsWith('shulker_box')) return 'shulker';
    return 'container';
}
// The ids Bedrock's item stack request actions go by, which the server reads (not the names).
const LEGACY_ID = { take: 0, place: 1, swap: 2 };

/** The Bedrock container and slot behind one of the window's slots, or null for a slot it doesn't have. */
export function bedrockSlotOf(window, slot, side = 'container') {
    const start = window.inventoryStart;
    if (!Number.isInteger(slot) || slot < 0) return null;
    if (slot < start) return { container: side, slot };
    if (slot < start + MAIN) return { container: 'inventory', slot: 9 + (slot - start) };
    if (slot < start + MAIN + HOTBAR) return { container: 'hotbar', slot: slot - start - MAIN };
    return null;
}

/** Would the game pour one of these stacks onto the other? The same item, with nothing different about it. */
export function stacksWith(a, b) {
    if (!a || !b || a.type !== b.type || (a.metadata ?? 0) !== (b.metadata ?? 0)) return false;
    return JSON.stringify(a.nbt ?? null) === JSON.stringify(b.nbt ?? null);
}

/**
 * The one request that makes a move, and what it should leave in the two slots: `{action, from, to}`,
 * `from` and `to` being `{item, count}` (the item that ends up there, and how many; a count of 0 is
 * empty). Null when there is nothing to do: nothing to move, or no room on a stack of the same kind.
 */
export function planMove(window, from, to, side = 'container') {
    const a = window.slots[from], b = window.slots[to];
    const src = bedrockSlotOf(window, from, side), dst = bedrockSlotOf(window, to, side);
    if (!a || !src || !dst || from === to) return null;
    const info = (where, item) => ({ slot_type: { container_id: where.container }, slot: where.slot, stack_id: item?.stackId ?? 0 });
    if (b && !stacksWith(a, b)) {
        return {
            action: { type_id: 'swap', legacy_type_id: LEGACY_ID.swap, source: info(src, a), destination: info(dst, b) },
            from: { item: b, count: b.count }, to: { item: a, count: a.count },
        };
    }
    const room = b ? Math.max(0, (b.stackSize ?? 64) - b.count) : a.count;
    const count = Math.min(a.count, room);
    if (count <= 0) return null;
    // A move out of the chest into the bot's own slots is a take, as the adapter's own withdraw makes it.
    const ownSlot = where => where.container === 'inventory' || where.container === 'hotbar';
    const type = !ownSlot(src) && ownSlot(dst) ? 'take' : 'place';
    return {
        action: { type_id: type, legacy_type_id: LEGACY_ID[type], count, source: info(src, a), destination: info(dst, b) },
        from: { item: a, count: a.count - count }, to: { item: b ?? a, count: (b?.count ?? 0) + count },
    };
}

/** A copy of an item with another count, so the window's items and the inventory's are never shared. */
function withCount(item, count, slot) {
    if (!item || count <= 0) return null;
    const copy = typeof item.clone === 'function' ? item.clone() : Object.assign(Object.create(Object.getPrototypeOf(item)), item);
    copy.count = count;
    copy.slot = slot;
    return copy;
}

/** The new stack id the server gave one slot, from its answer, or undefined when it doesn't say. */
function stackIdIn(response, where) {
    for (const container of response?.containers ?? []) {
        const id = container.slot_type?.container_id;
        // The chest's own side may come back under the name the server gives the block's container.
        const matches = id === where.container || (where.container === 'container' && id === 'level_entity');
        if (!matches) continue;
        const entry = (container.slots ?? []).find(s => s.slot === where.slot);
        if (entry?.item_stack_id != null) return entry.item_stack_id;
    }
    return undefined;
}

/** What Bedrock calls the open window's own slots, from the block the window belongs to. */
export function sideOfWindow(bot, window) {
    const at = window.position;
    return containerSideOf(at ? bot.blockAt?.(new Vec3(at.x, at.y, at.z))?.name : null);
}

/**
 * Moves the stack in one slot of the open chest window onto another, with one item stack request. Waits
 * for the server's answer, and brings the bot's copy of the window (and of its own inventory) up to date.
 */
export async function moveStack(bot, window, from, to) {
    const side = sideOfWindow(bot, window);
    const move = planMove(window, from, to, side);
    if (!move) return;
    if (typeof bot._stack?.stackReq !== 'function') throw new Error('this Bedrock bot cannot move items (no item stack requests)');
    const { status, response } = await bot._stack.stackReq([move.action]);
    if (status !== 'ok') return; // refused: nothing moved
    for (const [slot, { item, count }] of [[from, move.from], [to, move.to]]) {
        const where = bedrockSlotOf(window, slot, side);
        const next = withCount(item, count, slot);
        const stackId = stackIdIn(response, where);
        if (next && stackId !== undefined) next.stackId = stackId;
        if (slot < window.inventoryStart) {
            window.updateSlot(slot, next);
        } else {
            // The bot's own slot: its inventory is the truth, and the adapter copies it into the window.
            const own = where.container === 'hotbar' ? 36 + where.slot : where.slot;
            bot.inventory.updateSlot(own, next ? withCount(next, next.count, own) : null);
            if (window.slots[slot] !== undefined && (window.slots[slot]?.count ?? 0) !== (next?.count ?? 0)) window.slots[slot] = next;
        }
    }
}

