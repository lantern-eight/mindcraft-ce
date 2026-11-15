// SPDX-License-Identifier: CC0-1.0
// The sort plan: what is in each chest goes in, a list of moves comes out. No game, no bot, no model.
//
// Every test runs the moves on a copy of the chests (applyMoves refuses a move that could not be made)
// and then checks the same things: nothing gained or lost, nothing left in the bot's hands, each kind
// merged and in order, and that sorting a second time does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMoves, planSort } from '../src/agent/storage/sort_plan.js';
import { GROUPS, groupOf } from '../src/agent/storage/item_groups.js';

const SIZES = { ender_pearl: 16, egg: 16, snowball: 16, oak_sign: 16, iron_pickaxe: 1, diamond_sword: 1, bow: 1, water_bucket: 1, shears: 1 };
const stackSize = name => SIZES[name] ?? 64;
const OPTIONS = { stackSize, groupOf, groupOrder: GROUPS, carry: 27 };

/** 'cobblestone x40' is a stack of 40. A bare name is one item. null is an empty slot. */
const item = text => {
    if (text === null || typeof text === 'object') return text;
    const [name, count = '1'] = text.split(' x');
    return { name, count: Number(count) };
};
const chest = (id, size, stacks = []) => ({ id, slots: Array.from({ length: size }, (_, i) => item(stacks[i] ?? null)) });
const show = slots => {
    const out = slots.map(s => (s ? `${s.name} x${s.count}` : null));
    while (out.length && out.at(-1) === null) out.pop();
    return out;
};
const keyOf = s => s.key ?? s.name;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);      // plain character order, as the plan uses
const totals = chests => {
    const sum = {};
    for (const c of chests) for (const s of c.slots) if (s) sum[keyOf(s)] = (sum[keyOf(s)] ?? 0) + s.count;
    return sum;
};
const occupied = chests => chests.reduce((n, c) => n + c.slots.filter(Boolean).length, 0);
/** Which chests hold any of the items `pick` chooses. */
const chestsWith = (chests, pick) => chests.filter(c => c.slots.some(s => s && pick(s))).map(c => c.id);

/** Plans the sort, carries it out on a copy, and checks everything a sort must always do. */
function checked(chests, options = {}) {
    const opts = { ...OPTIONS, ...options };
    const rank = group => (opts.groupOrder.includes(group) ? opts.groupOrder.indexOf(group) : opts.groupOrder.length);
    const before = totals(chests);
    const untouched = JSON.stringify(chests);

    const plan = planSort(chests, opts);
    assert.equal(JSON.stringify(chests), untouched, 'the chests handed in are left as they were');
    assert.equal(plan.complete, true, 'the plan finishes the job');

    const after = applyMoves(chests, plan.moves, opts);
    assert.ok(after.bag.every(s => s === null), 'nothing is left in the bot\'s hands');
    assert.deepEqual(totals(after.chests), before, 'nothing gained or lost');
    assert.deepEqual(after.chests, plan.target, 'the moves lead to the layout the plan aimed at');

    const parts = {};
    for (const c of after.chests) {
        const stacks = c.slots.filter(Boolean);
        assert.ok(c.slots.slice(0, stacks.length).every(Boolean), `chest ${c.id} is packed from the first slot, with no gaps`);
        for (let i = 1; i < stacks.length; i++) {
            const [a, b] = [stacks[i - 1], stacks[i]];
            const order = rank(opts.groupOf(a.name)) - rank(opts.groupOf(b.name)) || compare(a.name, b.name)
                || compare(keyOf(a), keyOf(b)) || b.count - a.count;
            assert.ok(order <= 0, `chest ${c.id}: ${a.name} x${a.count} comes before ${b.name} x${b.count}`);
        }
        for (const s of stacks) {
            assert.ok(s.count <= opts.stackSize(s.name), `${s.name} x${s.count} is not over a full stack`);
            // With nothing to carry in, a chest can only be tidied by itself, so the count is per chest.
            const where = opts.carry === 0 ? `${keyOf(s)} in chest ${c.id}` : keyOf(s);
            if (s.count < opts.stackSize(s.name)) parts[where] = (parts[where] ?? 0) + 1;
        }
    }
    for (const [what, n] of Object.entries(parts)) assert.equal(n, 1, `${what} has one part stack at most`);

    assert.deepEqual(planSort(after.chests, opts).moves, [], 'sorting what is already sorted does nothing');
    // Each stack is merged at most once, picked up once, put down once and set in its place once.
    assert.ok(plan.moves.length <= 4 * occupied(chests), `${plan.moves.length} moves for ${occupied(chests)} stacks`);
    return { plan, after: after.chests };
}

test('S1: one chest, two kinds scattered in part stacks: the stacks are merged and each kind is together', () => {
    const before = [chest('a', 27, ['cobblestone x10', null, 'oak_log x5', 'cobblestone x20', null, null, 'cobblestone x40',
        'oak_log x7', null, 'cobblestone x3', 'oak_log x60', null, null, 'cobblestone x64'])];
    const { plan, after } = checked(before);
    assert.deepEqual(show(after[0].slots), ['oak_log x64', 'oak_log x8', 'cobblestone x64', 'cobblestone x64', 'cobblestone x9']);
    assert.ok(plan.moves.every(move => move.op === 'move' && move.chest === 'a'), 'one chest is sorted in place: nothing is carried');
    assert.equal(plan.visits, 1, 'the chest is opened once');
    assert.ok(plan.moves.length <= 10, `${plan.moves.length} moves for 8 scattered stacks`);
});

test('S2: one chest, twenty kinds: merged, grouped by what they are for, then by name', () => {
    const before = [chest('a', 54, [
        'dirt x30', 'iron_pickaxe', 'bread x5', 'oak_log x40', 'cobblestone x64', 'iron_ingot x12', 'bone x7', 'redstone x33',
        'oak_stairs x20', 'wheat_seeds x18', null, 'coal x50', 'cobblestone x30', 'dirt x50', 'torch x64', 'shears',
        'spruce_planks x64', 'bread x3', null, null, 'cooked_beef x9', 'sand x22', 'string x4', 'arrow x40',
        'diamond x2', 'oak_log x40', 'torch x10', 'diamond_sword', 'coal x30', 'gravel x8', 'glass x16',
    ])];
    const { after } = checked(before);
    assert.deepEqual(show(after[0].slots), [
        'iron_pickaxe x1', 'shears x1',                                      // tools
        'arrow x40', 'diamond_sword x1',                                     // combat
        'bread x8', 'cooked_beef x9',                                        // food
        'coal x64', 'coal x16', 'diamond x2', 'iron_ingot x12',              // minerals
        'oak_log x64', 'oak_log x16', 'spruce_planks x64',                   // wood
        'cobblestone x64', 'cobblestone x30',                                // stone
        'dirt x64', 'dirt x16', 'gravel x8', 'sand x22',                     // earth
        'wheat_seeds x18',                                                   // plants
        'bone x7', 'string x4',                                              // mob drops
        'redstone x33',                                                      // redstone
        'glass x16', 'oak_stairs x20', 'torch x64', 'torch x10',             // building
    ]);
});

test('S3: four chests, many kinds, mixed up: each kind ends in one chest, and related kinds share a chest', () => {
    // Twenty-four kinds in six groups, dealt round the four chests like cards, so no chest starts as
    // "the wood chest".
    const kinds = ['oak_log', 'birch_log', 'spruce_planks', 'stick', 'cobblestone', 'stone', 'andesite', 'deepslate',
        'iron_ingot', 'coal', 'raw_iron', 'diamond', 'bread', 'cooked_beef', 'apple', 'carrot',
        'dirt', 'sand', 'gravel', 'clay_ball', 'bone', 'string', 'gunpowder', 'feather'];
    const hands = [[], [], [], []];
    let dealt = 0;
    for (const count of [40, 25, 64, 12]) {
        for (const kind of kinds) hands[dealt++ % 4].push(`${kind} x${count}`);
        dealt++;                                             // shift the deal, so a kind is not always in the same chest
    }
    const before = hands.map((stacks, i) => chest(`chest${i + 1}`, 27, stacks));
    const { plan, after } = checked(before);

    for (const kind of kinds) {
        assert.equal(chestsWith(after, s => s.name === kind).length, 1, `${kind} is all in one chest`);
    }
    for (const group of ['wood', 'stone', 'minerals', 'food', 'earth', 'mob_drops']) {
        assert.equal(chestsWith(after, s => groupOf(s.name) === group).length, 1, `${group} is all in one chest`);
    }
    assert.ok(after.every(c => c.slots.some(Boolean)), 'the groups are spread over the chests, not packed into one');
    assert.ok(plan.moves.some(move => move.op === 'take') && plan.moves.some(move => move.op === 'put'), 'stacks are carried between chests');
    assert.ok(plan.moves.length <= 3 * occupied(before), `${plan.moves.length} moves for ${occupied(before)} stacks`);
    // About 70 of the 96 stacks start in the wrong chest and 27 fit in the hands, so the bot goes
    // round the four chests three times and a little.
    assert.ok(plan.visits <= 16, `${plan.visits} chest openings for four chests`);
    assert.ok(planSort(before, { ...OPTIONS, carry: 36 }).visits < plan.visits, 'and fewer with more free slots to carry in');
});

test('a base that is already organized keeps its chests: only the strays move', () => {
    const before = [
        chest('wood', 27, ['oak_log x64', 'oak_log x64', 'oak_planks x64', 'iron_ingot x3', 'spruce_log x20']),
        chest('metal', 27, ['iron_ingot x64', 'gold_ingot x12', 'oak_log x5', 'coal x40']),
    ];
    const { plan, after } = checked(before);
    assert.deepEqual(show(after[0].slots), ['oak_log x64', 'oak_log x64', 'oak_log x5', 'oak_planks x64', 'spruce_log x20']);
    assert.deepEqual(show(after[1].slots), ['coal x40', 'gold_ingot x12', 'iron_ingot x64', 'iron_ingot x3']);
    assert.equal(plan.moves.filter(move => move.op === 'take').length, 2, 'two stacks are carried, one each way');
    assert.ok(plan.moves.length <= 10 && plan.visits <= 3, `${plan.moves.length} moves, ${plan.visits} openings`);
});

test('groups spread over chests of different sizes: a double chest does not swallow what the single ones could share', () => {
    // Four kinds of thing, a little of each in every chest, so no chest has a claim on any of them.
    const some = ['bread x5', 'iron_ingot x10', 'oak_log x10', 'cobblestone x10'];
    const { after } = checked([chest('double', 54, some), chest('a', 27, some), chest('b', 27, some), chest('c', 27, some)]);
    // Going by free slots alone, the double chest would stay the roomiest however much went into it, and
    // take all four while three chests stood empty. Going by how full each chest is, they get one each.
    for (const c of after) {
        const groups = new Set(c.slots.filter(Boolean).map(s => groupOf(s.name)));
        assert.equal(groups.size, 1, `chest ${c.id} holds one group, not ${[...groups].join(', ') || 'nothing'}`);
    }
    // And a chest that is already half full is passed over for an empty one, even with as many slots free.
    const half = chest('double', 54, Array.from({ length: 27 }, () => 'cobblestone x64'));
    const sorted = checked([half, chest('a', 27, ['oak_log x10', 'bread x3']), chest('b', 27, ['oak_log x10', 'bread x3'])]).after;
    assert.deepEqual(chestsWith(sorted, s => s.name !== 'cobblestone').sort(), ['a', 'b']);
});

test('chests that are already sorted need no moves at all', () => {
    const before = [
        chest('a', 27, ['oak_log x64', 'oak_log x5', 'spruce_planks x12']),
        chest('b', 27, ['coal x40', 'iron_ingot x64', 'iron_ingot x3']),
        chest('empty', 27),
    ];
    const plan = planSort(before, OPTIONS);
    assert.deepEqual(plan.moves, []);
    assert.equal(plan.visits, 0);
    assert.equal(plan.complete, true);
    assert.deepEqual(planSort([], OPTIONS), { moves: [], target: [], visits: 0, complete: true }, 'and no chests is no work');
});

test('a full chest with no free slot is sorted by swapping', () => {
    const kinds = ['dirt', 'oak_log', 'cobblestone', 'coal', 'bread', 'bone', 'sand', 'stone', 'iron_ingot'];
    const before = [chest('a', 27, Array.from({ length: 27 }, (_, i) => `${kinds[(i * 4) % 9]} x64`))];
    const { plan, after } = checked(before);
    assert.equal(after[0].slots.filter(Boolean).length, 27, 'it is still full');
    assert.ok(plan.moves.every(move => move.op === 'move'));
    assert.ok(plan.moves.length <= 27, `${plan.moves.length} swaps for 27 stacks`);
});

test('two full chests trade stacks even when the bot can carry only one at a time', () => {
    const wood = ['oak_log', 'birch_log', 'spruce_log', 'acacia_log', 'cherry_log', 'jungle_log', 'oak_planks', 'birch_planks', 'stick'];
    const metal = ['coal', 'iron_ingot', 'gold_ingot', 'copper_ingot', 'diamond', 'emerald', 'raw_iron', 'raw_gold', 'raw_copper'];
    const before = [
        chest('a', 9, [...wood.slice(0, 5), ...metal.slice(0, 4)].map(name => `${name} x64`)),
        chest('b', 9, [...metal.slice(4), ...wood.slice(5)].map(name => `${name} x64`)),
    ];
    const { plan, after } = checked(before, { carry: 1 });
    assert.deepEqual(chestsWith(after, s => groupOf(s.name) === 'wood'), ['a'], 'the chest with most of the wood keeps the wood');
    assert.deepEqual(chestsWith(after, s => groupOf(s.name) === 'minerals'), ['b']);
    assert.ok(plan.moves.filter(move => move.op !== 'move').every(move => (move.op === 'take' ? move.to : move.from) === 0), 'one carrying slot is used');
});

test('with nothing free to carry in, each chest is sorted where it stands', () => {
    const before = [
        chest('a', 27, ['coal x10', 'oak_log x5', 'coal x20', 'oak_log x7']),
        chest('b', 27, ['oak_log x30', 'coal x3']),
    ];
    const { plan, after } = checked(before, { carry: 0 });
    assert.ok(plan.moves.every(move => move.op === 'move'));
    assert.deepEqual(show(after[0].slots), ['coal x30', 'oak_log x12']);
    assert.deepEqual(show(after[1].slots), ['coal x3', 'oak_log x30']);
});

test('tools that do not stack stay one to a slot, and items that stack to 16 fill to 16', () => {
    const before = [chest('a', 27, ['ender_pearl x10', 'iron_pickaxe', 'ender_pearl x10', 'egg x16', 'iron_pickaxe', 'ender_pearl x3',
        'bow', 'iron_pickaxe', 'egg x2'])];
    const { after } = checked(before);
    assert.deepEqual(show(after[0].slots), ['iron_pickaxe x1', 'iron_pickaxe x1', 'iron_pickaxe x1', 'bow x1',
        'egg x16', 'egg x2', 'ender_pearl x16', 'ender_pearl x7']);
});

test('items that share a name but are not the same thing are kept apart and never merged', () => {
    const plain = { name: 'oak_sign', count: 6 };
    const written = { name: 'oak_sign', count: 6, key: 'oak_sign#written' };
    const before = [chest('a', 27, [plain, 'dirt x3', written, plain, written])];
    const { after } = checked(before);
    assert.deepEqual(after[0].slots.filter(Boolean).map(s => `${keyOf(s)} x${s.count}`),
        ['dirt x3', 'oak_sign x12', 'oak_sign#written x12']);
});

test('a kind too big for any one chest is spread over chests, whole stacks first', () => {
    const before = [
        chest('a', 9, Array.from({ length: 9 }, (_, i) => (i % 2 ? 'cobblestone x64' : 'oak_log x10'))),
        chest('b', 9, Array.from({ length: 9 }, () => 'cobblestone x60')),
    ];
    const { after } = checked(before, { carry: 4 });
    // 4 x 64 + 9 x 60 = 796 cobblestone: twelve full stacks and 28 over. 50 logs: one stack.
    const cobble = after.flatMap(c => c.slots.filter(s => s?.name === 'cobblestone').map(s => s.count));
    assert.deepEqual(cobble.sort((a, b) => b - a), [...Array(12).fill(64), 28]);
    assert.equal(chestsWith(after, s => s.name === 'oak_log').length, 1);
});

test('a stack larger than the size it was told is kept whole, not cut down', () => {
    // A server can allow what the game's data says is impossible. The plan goes by what it finds.
    const before = [chest('a', 9, ['dirt x64', 'iron_pickaxe x3', 'dirt x10'])];
    const plan = planSort(before, OPTIONS);                  // OPTIONS says a pickaxe does not stack
    const after = applyMoves(before, plan.moves, OPTIONS);
    assert.deepEqual(show(after.chests[0].slots), ['iron_pickaxe x3', 'dirt x64', 'dirt x10']);
    assert.deepEqual(after.chests, plan.target);
});

test('applyMoves refuses a move that could not be made', () => {
    const chests = [chest('a', 9, ['dirt x5'])];
    assert.throws(() => applyMoves(chests, [{ op: 'move', chest: 'a', from: 3, to: 0 }], OPTIONS), /nothing in slot 3/);
    assert.throws(() => applyMoves(chests, [{ op: 'move', chest: 'a', from: 0, to: 9 }], OPTIONS), /no slot 9/);
    assert.throws(() => applyMoves(chests, [{ op: 'take', chest: 'a', from: 0, to: 2 }], { ...OPTIONS, carry: 2 }), /no slot 2/);
    assert.throws(() => applyMoves(chests, [{ op: 'take', chest: 'nowhere', from: 0, to: 0 }], OPTIONS), /no chest "nowhere"/);
    assert.throws(() => applyMoves(chests, [{ op: 'fling', chest: 'a', from: 0, to: 1 }], OPTIONS), /Unknown move "fling"/);
    const moved = applyMoves(chests, [{ op: 'take', chest: 'a', from: 0, to: 1 }, { op: 'put', chest: 'a', from: 1, to: 4 }], OPTIONS);
    assert.deepEqual(show(moved.chests[0].slots), [null, null, null, null, 'dirt x5']);
    assert.deepEqual(show(chests[0].slots), ['dirt x5'], 'and it works on a copy');
});

// A small seeded generator, so a failure can be run again exactly.
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('any mess of chests sorts: 300 random sets, from nearly empty to completely full', () => {
    // Made-up items: the letter is the group, and the number decides how many fit in a slot.
    const names = [];
    for (const group of 'abcdef') for (let n = 1; n <= 6; n++) names.push(`${group}_${n}`);
    const sizeOf = name => [64, 64, 64, 16, 1, 64][Number(name.split('_')[1]) - 1];
    const options = { stackSize: sizeOf, groupOf: name => name[0], groupOrder: [...'abcdef'] };
    let moves = 0, stacks = 0, visits = 0;
    for (let seed = 1; seed <= 300; seed++) {
        const random = seeded(seed);
        const pick = list => list[Math.floor(random() * list.length)];
        const fill = pick([0.1, 0.4, 0.7, 0.95, 1]);
        const pool = names.slice(0, 3 + Math.floor(random() * (names.length - 3)));
        const chests = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => {
            const size = pick([9, 27, 27, 54]);
            return chest(`c${i}`, size, Array.from({ length: size }, () => {
                if (random() >= fill) return null;
                const name = pick(pool);
                const size = sizeOf(name);
                return `${name} x${random() < 0.5 ? size : 1 + Math.floor(random() * size)}`;
            }));
        });
        const carry = pick([1, 2, 5, 27, 36]);
        try {
            const { plan } = checked(chests, { ...options, carry });
            moves += plan.moves.length; stacks += occupied(chests); visits += plan.visits;
        } catch (error) {
            error.message = `seed ${seed} (${chests.length} chests, carry ${carry}, fill ${fill}): ${error.message}`;
            throw error;
        }
    }
    // On average a stack takes well under three moves, though the worst case allowed is four.
    assert.ok(moves <= 3 * stacks, `${moves} moves for ${stacks} stacks over 300 sets, ${visits} chest openings`);
    if (process.env.SORT_PLAN_STATS) console.log(`${moves} moves for ${stacks} stacks over 300 sets, ${visits} chest openings`);
});
