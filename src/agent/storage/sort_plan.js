// SPDX-License-Identifier: CC0-1.0
// The sort plan: what is in a set of chests goes in, and the moves that tidy them come out.
//
// This is the thinking half of chest sorting, kept apart from the doing half on purpose. It is a pure
// function: no game, no bot, no model. That is what lets a sort be tested exactly, on any mess of
// chests, before a bot ever opens one.
//
// A plan uses the one move a player makes with the mouse: pick a stack up, click another slot, and put
// back in the first slot whatever came off. Depending on what was in the second slot that move
//   - puts the stack down          (the slot was empty),
//   - pours it in                  (the same kind was there, with room: what does not fit goes back),
//   - or swaps the two             (something else was there).
// It needs no free slot, so even a completely full chest can be sorted. Between chests the bot carries
// stacks in its own free inventory slots ("hands" here), and the same move goes chest to hands (`take`)
// and hands to chest (`put`).
//
// Where things end up:
//   - Stacks of one kind are poured together: full stacks, and at most one part stack.
//   - Kinds are laid out from the first slot by group (item_groups.js), then by name.
//   - A group of related kinds shares a chest. It stays in the chest that already holds most of it,
//     which respects a base somebody has organized and keeps the carrying short. Otherwise it goes to
//     the emptiest chest for its size, which spreads the groups out instead of packing one chest.
//   - A group too big for any chest is placed kind by kind, and a kind too big, stack by stack.
// Sorting chests that are already sorted gives no moves.
import { GROUPS, groupOf as groupByName } from './item_groups.js';

const keyOf = slot => slot.key ?? slot.name;
const copyStack = slot => (slot && slot.name && slot.count > 0 ? { name: slot.name, count: slot.count, key: keyOf(slot) } : null);
const copyChests = chests => chests.map(chest => ({ id: chest.id, slots: chest.slots.map(copyStack) }));
const same = (a, b) => (a === null || b === null ? a === b : a.key === b.key && a.count === b.count);
// Plain character order, not the reader's language: a plan must come out the same on every machine.
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const handCount = carry => Math.max(0, Math.floor(Number(carry) || 0));

/**
 * How many of each kind fit in one slot. The caller's answer is used, unless a stack in the chests is
 * already bigger than that: some servers allow what the game's data says is impossible, and a plan has
 * to go by what is really there.
 */
function stackSizes(chests, stackSize) {
    const sizes = new Map();
    for (const chest of chests) {
        for (const slot of chest.slots) {
            if (!slot) continue;
            const told = Math.floor(Number(stackSize(slot.name)));
            sizes.set(slot.key, Math.max(told >= 1 ? told : 64, slot.count, sizes.get(slot.key) ?? 0));
        }
    }
    return sizes;
}

/**
 * The one move. Takes the stack in `src[from]` to `dst[to]`; whatever comes off goes back to `src[from]`.
 * The two lists may be the same list.
 */
function shift(src, from, dst, to, sizes) {
    const held = src[from], there = dst[to];
    if (!there) {
        dst[to] = held;
        src[from] = null;
    } else if (there.key !== held.key) {
        dst[to] = held;
        src[from] = there;
    } else {
        const poured = Math.min(sizes.get(held.key) - there.count, held.count);
        dst[to] = { ...there, count: there.count + poured };
        src[from] = poured === held.count ? null : { ...held, count: held.count - poured };
    }
}

/**
 * Decides the layout to aim for: which stacks end up in which slot of which chest.
 * @returns {{id: *, slots: (object|null)[]}[]} one entry per chest, in the order given
 */
function layout(chests, { sizes, groupOf, groupOrder }) {
    const rank = group => (groupOrder.includes(group) ? groupOrder.indexOf(group) : groupOrder.length);

    // Every kind of item, with how much of it there is and where it is now.
    const kinds = new Map();
    chests.forEach((chest, ci) => {
        for (const slot of chest.slots) {
            if (!slot) continue;
            let kind = kinds.get(slot.key);
            if (!kind) {
                kind = { key: slot.key, name: slot.name, group: String(groupOf(slot.name)), size: sizes.get(slot.key), total: 0, where: new Map() };
                kinds.set(slot.key, kind);
            }
            kind.total += slot.count;
            kind.where.set(ci, (kind.where.get(ci) ?? 0) + slot.count);
        }
    });
    const inOrder = (a, b) => rank(a.group) - rank(b.group) || compare(a.group, b.group) || compare(a.name, b.name) || compare(a.key, b.key);
    const groups = new Map();
    for (const kind of [...kinds.values()].sort(inOrder)) {
        kind.fulls = Math.floor(kind.total / kind.size);
        kind.rest = kind.total % kind.size;
        kind.stacks = kind.fulls + (kind.rest ? 1 : 0);
        let group = groups.get(kind.group);
        if (!group) {
            group = { group: kind.group, kinds: [], stacks: 0, total: 0, where: new Map() };
            groups.set(kind.group, group);
        }
        group.kinds.push(kind);
        group.stacks += kind.stacks;
        group.total += kind.total;
        for (const [ci, count] of kind.where) group.where.set(ci, (group.where.get(ci) ?? 0) + count);
    }

    const free = chests.map(chest => chest.slots.length);
    const placed = chests.map(() => []);
    const place = (ci, kind, fulls, rest) => {
        placed[ci].push({ kind, fulls, rest });
        free[ci] -= fulls + (rest ? 1 : 0);
    };
    // "Roomiest" goes by how full a chest is, not by how many slots it has free. By free slots alone a
    // double chest among single ones stays the roomiest however much goes into it, and swallows every
    // group while the others stand empty. Between chests equally full, the bigger one wins, then the
    // earlier one. (Cross-multiplied, to compare the two fractions without rounding.)
    const size = chests.map(chest => chest.slots.length);
    const emptier = (a, b) => free[a] * size[b] - free[b] * size[a] || free[a] - free[b];
    const roomiest = need => {
        let pick = -1;
        for (let ci = 0; ci < free.length; ci++) if (free[ci] >= need && (pick < 0 || emptier(ci, pick) > 0)) pick = ci;
        return pick;
    };
    // The chest for a group or a kind that needs `need` slots: the one already holding most of it, when
    // it fits there; otherwise the roomiest one it fits in. -1 when it fits nowhere whole.
    //
    // This rule is what makes a second sort do nothing. Once sorted, everything is wholly in its chest,
    // so "the chest holding most of it" is the chest it is in, and it fits there because it did before.
    const homeFor = (need, where, total) => {
        for (const [ci, count] of where) if (count * 2 > total && free[ci] >= need) return ci;
        return roomiest(need);
    };

    // Big groups choose first, while there is still a chest they fit in.
    const bySize = (a, b) => b.stacks - a.stacks || rank(a.group) - rank(b.group) || compare(a.group, b.group);
    for (const group of [...groups.values()].sort(bySize)) {
        const home = homeFor(group.stacks, group.where, group.total);
        if (home >= 0) {
            for (const kind of group.kinds) place(home, kind, kind.fulls, kind.rest);
            continue;
        }
        // The group fits in no one chest, so its kinds are placed one at a time.
        for (const kind of [...group.kinds].sort((a, b) => b.stacks - a.stacks || inOrder(a, b))) {
            const spot = homeFor(kind.stacks, kind.where, kind.total);
            if (spot >= 0) {
                place(spot, kind, kind.fulls, kind.rest);
                continue;
            }
            // Not even the kind fits in one chest: fill the roomiest chests with it, full stacks first.
            // Where it is now is deliberately not looked at here, so the answer cannot change once sorted.
            let fulls = kind.fulls, rest = kind.rest;
            while (fulls > 0 || rest > 0) {
                const ci = roomiest(1);
                const slots = Math.min(free[ci], fulls + (rest ? 1 : 0));
                const whole = Math.min(fulls, slots);
                const withRest = slots > whole;
                place(ci, kind, whole, withRest ? rest : 0);
                fulls -= whole;
                if (withRest) rest = 0;
            }
        }
    }

    return chests.map((chest, ci) => {
        const slots = new Array(chest.slots.length).fill(null);
        let i = 0;
        for (const { kind, fulls, rest } of placed[ci].sort((a, b) => inOrder(a.kind, b.kind))) {
            for (let n = 0; n < fulls; n++) slots[i++] = { name: kind.name, count: kind.size, key: kind.key };
            if (rest) slots[i++] = { name: kind.name, count: rest, key: kind.key };
        }
        return { id: chest.id, slots };
    });
}

/**
 * Works out the moves that turn `state` into `target`, the way a player would do it: open a chest,
 * tidy what stays, put down what was brought, pick up what belongs elsewhere, and go on to the chest
 * that wants what is in hand. `state` is changed as the moves are made.
 */
function route(state, target, sizes, hands) {
    const bag = new Array(hands).fill(null);
    const moves = [];
    let visits = 0;
    const full = stack => stack.count >= sizes.get(stack.key);
    const partAt = (slots, key) => slots.findIndex(s => s && s.key === key && !full(s));

    // What each chest should end up holding of each kind: how many full stacks, and whether the kind's
    // one part stack lives there.
    const NOTHING = { fulls: 0, part: false };
    const wants = target.map(chest => {
        const want = new Map();
        for (const stack of chest.slots) {
            if (!stack) continue;
            const entry = want.get(stack.key) ?? { fulls: 0, part: false };
            if (full(stack)) entry.fulls++;
            else entry.part = true;
            want.set(stack.key, entry);
        }
        return want;
    });
    const wantOf = (ci, key) => wants[ci].get(key) ?? NOTHING;
    const fullsOf = (ci, key) => state[ci].slots.reduce((n, s) => n + (s && s.key === key && full(s) ? 1 : 0), 0);

    const signature = slots => slots.filter(Boolean).map(s => `${s.key}\u0000${s.count}`).sort().join('\u0001');
    const goals = target.map(chest => signature(chest.slots));
    /** Does this chest hold exactly the stacks it should, whatever slots they are in? */
    const holdsItsOwn = ci => signature(state[ci].slots) === goals[ci];
    const inOrder = ci => state[ci].slots.every((stack, i) => same(stack, target[ci].slots[i]));

    const emit = (op, ci, from, to) => {
        const slots = state[ci].slots;
        const [src, dst] = op === 'move' ? [slots, slots] : op === 'take' ? [slots, bag] : [bag, slots];
        shift(src, from, dst, to, sizes);
        moves.push({ op, chest: state[ci].id, from, to });
    };

    /** The slots of a chest whose stacks belong somewhere else, lowest first. */
    const leaving = ci => {
        const slots = state[ci].slots, goal = target[ci].slots;
        const kept = new Map();
        const out = [];
        // Full stacks already sitting where a full stack of their kind belongs are the first to be kept.
        slots.forEach((stack, i) => {
            if (stack && full(stack) && same(stack, goal[i])) kept.set(stack.key, (kept.get(stack.key) ?? 0) + 1);
        });
        slots.forEach((stack, i) => {
            if (!stack) return;
            if (!full(stack)) {
                // A part stack stays only in the chest where its kind's part stack will live. Anywhere
                // else it travels, to be poured into the others.
                if (!wantOf(ci, stack.key).part) out.push(i);
            } else if (!same(stack, goal[i])) {
                const n = kept.get(stack.key) ?? 0;
                if (n < wantOf(ci, stack.key).fulls) kept.set(stack.key, n + 1);
                else out.push(i);
            }
        });
        return out;
    };

    /** Step 1 of a visit: part stacks of one kind in this chest are poured together. */
    const pourTogether = ci => {
        const slots = state[ci].slots;
        const parts = new Map();
        slots.forEach((stack, i) => {
            if (!stack || full(stack)) return;
            if (!parts.has(stack.key)) parts.set(stack.key, []);
            parts.get(stack.key).push(i);
        });
        for (const list of parts.values()) {
            while (list.length > 1) {
                const to = list[0], from = list[list.length - 1];
                emit('move', ci, from, to);
                if (!slots[from]) list.pop();           // it all went in
                if (full(slots[to])) list.shift();      // and that one is full now
            }
        }
    };

    /**
     * The slot to put a carried stack in: its own place when that is free or holds something leaving
     * anyway, else any free slot, else the place of a stack that is leaving (they swap). -1 if none.
     */
    const spotFor = (ci, held) => {
        const slots = state[ci].slots, goal = target[ci].slots;
        const out = leaving(ci);
        const heldFull = full(held);
        // A swap hands the bot the stack that was there, so it must be one the hands can take.
        const canSwap = i => {
            const there = slots[i];
            if (there.key === held.key) return full(there) !== heldFull;     // a full and a part stack of one kind trade places
            // Never two part stacks of one kind in hand: there would be nowhere to pour them together.
            return full(there) || !bag.some(other => other && other !== held && other.key === there.key && !full(other));
        };
        const itsOwn = i => goal[i] && goal[i].key === held.key && full(goal[i]) === heldFull;
        for (let i = 0; i < slots.length; i++) {
            if (itsOwn(i) && (!slots[i] || (out.includes(i) && canSwap(i)))) return i;
        }
        const empty = slots.indexOf(null);
        if (empty >= 0) return empty;
        return out.find(canSwap) ?? -1;
    };

    /** Puts the stack in hand slot `b` into chest slot `i`. */
    const drop = (ci, b, i) => {
        const there = state[ci].slots[i], held = bag[b];
        // A part stack can't be dropped onto a full stack of its own kind: nothing would go in. Picking
        // the full one up and dropping it on the part stack swaps them just the same.
        if (there && there.key === held.key && full(there) && !full(held)) emit('take', ci, i, b);
        else emit('put', ci, b, i);
    };

    /** The last step of a visit, once the chest holds what it should: every stack to its own slot. */
    const arrange = ci => {
        const slots = state[ci].slots, goal = target[ci].slots;
        for (let i = 0; i < goal.length; i++) {
            const want = goal[i];
            if (!want || same(slots[i], want)) continue;
            // A stack like the wanted one that is not already in a slot that wants it. Slots before
            // this one are done, so it is further on.
            let from = -1;
            for (let j = i + 1; j < slots.length && from < 0; j++) {
                if (same(slots[j], want) && !same(goal[j], want)) from = j;
            }
            if (from < 0) return;
            const here = slots[i];
            // Same trick as in drop: of a full and a part stack of one kind, it is the full one that moves.
            if (here && here.key === want.key && full(here)) emit('move', ci, i, from);
            else emit('move', ci, from, i);
        }
    };

    const visit = ci => {
        visits++;
        const slots = state[ci].slots;
        pourTogether(ci);
        // A part stack in hand meets a part stack of its kind here: it is poured in.
        for (let b = 0; b < bag.length; b++) {
            if (!bag[b] || full(bag[b])) continue;
            const part = partAt(slots, bag[b].key);
            if (part >= 0) emit('put', ci, b, part);
        }
        // What is in hand and belongs here is put down.
        for (let b = 0; b < bag.length; b++) {
            const held = bag[b];
            if (!held) continue;
            const want = wantOf(ci, held.key);
            if (!(full(held) ? fullsOf(ci, held.key) < want.fulls : want.part)) continue;
            const spot = spotFor(ci, held);
            if (spot >= 0) drop(ci, b, spot);
        }
        // What belongs elsewhere is picked up, as much as the hands hold.
        for (const i of leaving(ci)) {
            const stack = slots[i];
            if (!full(stack) && bag.some(held => held && held.key === stack.key && !full(held))) continue;
            const b = bag.indexOf(null);
            if (b < 0) break;
            emit('take', ci, i, b);
        }
        if (holdsItsOwn(ci)) arrange(ci);
    };

    /** How many of the stacks in hand this chest would take. */
    const takes = ci => bag.reduce((n, held) => {
        if (!held) return n;
        if (full(held)) return n + (fullsOf(ci, held.key) < wantOf(ci, held.key).fulls ? 1 : 0);
        return n + (wantOf(ci, held.key).part || partAt(state[ci].slots, held.key) >= 0 ? 1 : 0);
    }, 0);
    const twoParts = ci => {
        const seen = new Set();
        return state[ci].slots.some(s => s && !full(s) && (seen.has(s.key) || !seen.add(s.key)));
    };
    const hasWork = ci => leaving(ci).length > 0 || twoParts(ci) || (holdsItsOwn(ci) && !inOrder(ci));
    /** The chest to open next: the one that wants most of what is in hand, else the next with work to do. */
    const next = from => {
        const count = state.length;
        if (bag.some(Boolean)) {
            let best = -1, most = 0;
            for (let step = 1; step <= count; step++) {
                const ci = (from + step) % count;
                const n = takes(ci);
                if (n > most) [best, most] = [ci, n];
            }
            if (best >= 0) return best;
        }
        for (let step = 1; step <= count; step++) {
            const ci = (from + step) % count;
            if (hasWork(ci)) return ci;
        }
        return -1;
    };

    // Every visit either puts a stack where it will stay or pours two part stacks together, so this
    // ends. The limit is a guard against a mistake in that reasoning, not something a plan runs into.
    const limit = 20 + 4 * state.reduce((n, chest) => n + chest.slots.length, 0);
    for (let at = next(-1); at >= 0 && visits < limit; at = next(at)) visit(at);
    const complete = state.every((_, ci) => inOrder(ci)) && bag.every(stack => stack === null);
    return { moves, visits, complete };
}

/**
 * Plans the sorting of a set of chests.
 *
 * @param {{id: *, slots: ({name: string, count: number, key?: string}|null)[]}[]} chests - each chest
 *   with every slot, in order: a stack, or null for an empty slot. `key` tells apart items that share
 *   a name but are not the same thing (a damaged tool, an enchanted one); stacks pour together only
 *   when their keys match. It defaults to the name.
 * @param {object} [options]
 * @param {(name: string) => number} [options.stackSize] - how many of an item fit in a slot (default 64)
 * @param {(name: string) => string} [options.groupOf] - the group an item belongs to (default: by name)
 * @param {string[]} [options.groupOrder] - the order groups are laid out in; others follow, by name
 * @param {number} [options.carry] - how many stacks the bot can carry between chests: its free
 *   inventory slots. With none, each chest is sorted where it stands.
 * @returns {{moves: {op: 'move'|'take'|'put', chest: *, from: number, to: number}[], target: object[],
 *   visits: number, complete: boolean}}
 *   `moves` in order. `move` is between two slots of a chest, `take` from a chest slot to a hand slot,
 *   `put` from a hand slot to a chest slot; in each, whatever comes off goes back to `from`.
 *   `target` is the layout the moves lead to, `visits` how many times a chest is opened, and
 *   `complete` whether the moves reach the target (always, short of a mistake in here).
 */
export function planSort(chests, { stackSize = () => 64, groupOf = groupByName, groupOrder = GROUPS, carry = 27 } = {}) {
    const state = copyChests(chests);
    const sizes = stackSizes(state, stackSize);
    const hands = handCount(carry);
    // With nothing free to carry in, nothing can go from one chest to another: sort each where it is.
    const sets = hands === 0 ? state.map(chest => [chest]) : [state];
    const plan = { moves: [], target: [], visits: 0, complete: true };
    for (const set of sets) {
        if (!set.length) continue;
        const target = layout(set, { sizes, groupOf, groupOrder });
        const done = route(set, target, sizes, hands);
        plan.moves.push(...done.moves);
        plan.target.push(...target);
        plan.visits += done.visits;
        plan.complete &&= done.complete;
    }
    return plan;
}

/**
 * Carries a list of moves out on a copy of the chests, and says what the chests and the bot's hands
 * hold afterwards. Throws on a move that could not be made, so it doubles as the check that a plan
 * is sound. The chests handed in are not changed.
 * @returns {{chests: object[], bag: (object|null)[]}}
 */
export function applyMoves(chests, moves, { stackSize = () => 64, carry = 27 } = {}) {
    const state = copyChests(chests);
    const sizes = stackSizes(state, stackSize);
    const bag = new Array(handCount(carry)).fill(null);
    const byId = new Map(state.map(chest => [chest.id, chest]));
    const has = (list, index, what) => {
        if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error(`${what} no slot ${index}.`);
    };
    for (const move of moves) {
        const chest = byId.get(move.chest);
        if (!chest) throw new Error(`There is no chest "${move.chest}".`);
        const inChest = [chest.slots, `Chest "${chest.id}" has`], inHand = [bag, 'The bot\'s hands have'];
        const ends = { move: [inChest, inChest], take: [inChest, inHand], put: [inHand, inChest] }[move.op];
        if (!ends) throw new Error(`Unknown move "${move.op}".`);
        const [[src, srcName], [dst, dstName]] = ends;
        has(src, move.from, srcName);
        has(dst, move.to, dstName);
        if (!src[move.from]) throw new Error(`${srcName} nothing in slot ${move.from}.`);
        if (src === dst && move.from === move.to) throw new Error(`Slot ${move.from} cannot be moved onto itself.`);
        shift(src, move.from, dst, move.to, sizes);
    }
    return { chests: state, bag };
}
