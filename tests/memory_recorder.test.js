// SPDX-License-Identifier: CC0-1.0
// The recorder: what the bot sees and does goes into the memory store, and nothing else does.
//
// These run the real recorder and the real perception over a small hand-built world, with a stand-in
// for the bot. They are the end-to-end versions of the change tests (A1 to A6), plus the trail, container
// and "perception answers from memory" checks. No server, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';
import { fixtureWorld, stubBot, NO_BUDGETS } from './helpers/fixture_world.js';
import { createPerception } from '../src/agent/fairplay/perception.js';
import { resolvePolicy } from '../src/agent/fairplay/policy.js';
import { openMemory } from '../src/agent/memory/store.js';
import { createRecorder } from '../src/agent/memory/recorder.js';
import { propsOfState, stateOfProps } from '../src/agent/memory/block_state.js';
import { registerEdition } from '../src/agent/edition/index.js';
import { javaEdition } from '../src/agent/edition/java.js';

// Strict, but seeing all around: these scenes put things on every side of the bot to test something other
// than the view. The narrowed view, strict's own, has tests of its own.
const ALL_AROUND = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 360 } });
const SCOPE = 'local:55916/w1/overworld';

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = ms => { t += ms; };
    return now;
}

/** A flat stone floor at y 0, the bot standing on it at the origin, and whatever `build` adds. */
function setup(build = () => {}, { baseDir = mkdtempSync(path.join(tmpdir(), 'memory-')), now = clock(), entities = [], prepare = () => {}, policy = ALL_AROUND, tickClock } = {}) {
    const world = fixtureWorld({ min: [-40, -4, -40], max: [40, 24, 40] });
    world.fill('stone', [-40, 0, -40], [40, 0, 40]);
    build(world);
    const bot = stubBot(world, { entities });
    bot.entity.onGround = true;
    prepare(bot);
    let recorder = null;
    const memory = openMemory({ baseDir, scope: SCOPE, now, canWalkStraight: (a, b) => recorder.canWalkStraight(a, b) });
    recorder = createRecorder({ bot, memory, now, tickBudgetMs: Infinity, ...(tickClock ? { clock: tickClock } : {}) });
    // Perception is handed world memory as its memory, and leaves the looking around to the recorder.
    const perception = createPerception({ bot, policy, memory: recorder.view, now, ...NO_BUDGETS });
    recorder.attach(perception);
    recorder.listen(); // hear the bot move, dig, place and open things; the tests call tick() themselves
    const lookAround = () => { bot.emit('blockUpdate', null, { position: bot.entity.position }); recorder.tick(); };
    const walkTo = (x, y, z) => {
        const from = bot.entity.position.clone();
        const steps = Math.max(1, Math.round(from.distanceTo(new Vec3(x, y, z)) * 4));
        for (let i = 1; i <= steps; i++) {
            const f = i / steps;
            bot.moveTo(from.x + (x - from.x) * f, from.y + (y - from.y) * f, from.z + (z - from.z) * f);
            now.advance(50);
            bot.emit('move');
        }
    };
    /** Lets the two quiet seconds pass and collects the notes. */
    const notes = () => { now.advance(2000); recorder.tick(); return memory.changes.fresh().map(note => note.text); };
    return { world, bot, memory, perception, recorder, now, lookAround, walkTo, notes, baseDir };
}

test('only what is in view is written: a buried ore is not, a chest in the open is a thing', () => {
    const { memory, lookAround, recorder } = setup(w => {
        w.fill('stone', [4, 1, -2], [8, 5, 2]);
        w.set('diamond_ore', 6, 3, 0);                 // buried in the stone
        w.set('diamond_ore', 4, 2, -5);                // standing alone, in view
        w.set('chest', 3, 1, 3, { facing: 'north' });
    });
    lookAround();
    assert.equal(recorder.busy, false, 'the whole look-around fitted in one unlimited slice');
    assert.equal(memory.cells.read(6, 3, 0), null, 'the buried ore was never seen');
    assert.equal(memory.cells.read(5, 3, 0), null, 'nor the stone around it');
    assert.equal(memory.cells.read(4, 3, 0), 'stone', 'the face of the stone was');
    assert.equal(memory.cells.read(4, 2, -5), 'diamond_ore');
    assert.equal(memory.cells.read(2, 0, 2), 'stone', 'the floor is remembered too, not only things like chests');
    assert.equal(memory.cells.read(2, 1, 2), 'air', 'and the air just above it was seen to be empty');
    assert.equal(memory.cells.read(2, 5, 2), null, 'open air higher up is not recorded');

    const chest = memory.things.get(3, 1, 3);
    assert.equal(chest.kind, 'container');
    assert.equal(chest.state.facing, 'north', 'its state is kept by name');
    assert.equal(memory.things.nearest(['diamond_ore'], { x: 0, y: 1, z: 0 }).length, 1);
    assert.equal(memory.places.at({ x: 3, y: 1, z: 3 }).kind, 'found', 'a chest makes a place');
    assert.equal(memory.cells.wasLookedFrom(0, 0, 0, memory.trail.current), false, 'no crumb yet: the bot has not moved');
});

test('a game that keeps a double chest\'s pairing outside the state still makes the two halves one thing', () => {
    // As on Bedrock: two chests whose states say nothing of each other, whose block entities name each
    // other. The game data here is Java's, so Java's answers are swapped for ones that read the entity.
    registerEdition('pc', { ...javaEdition, otherHalfOf: block => block.entity?.pair ?? null });
    try {
        const { memory, lookAround } = setup(w => {
            w.set('chest', 3, 1, 3, { facing: 'north', type: 'single' });
            w.set('chest', 4, 1, 3, { facing: 'north', type: 'single' });
            w.set('chest', 7, 1, 3, { facing: 'north', type: 'single' });
        }, {
            prepare: bot => {
                const blockAt = bot.blockAt;
                const pairs = { '3,1,3': { x: 4, y: 1, z: 3 }, '4,1,3': { x: 3, y: 1, z: 3 } };
                bot.blockAt = pos => {
                    pos.floored(); // as the real bot's does: a plain {x, y, z} throws
                    const block = blockAt(pos);
                    const pair = pairs[`${pos.x},${pos.y},${pos.z}`];
                    return block && pair ? Object.assign(block, { entity: { pair } }) : block;
                };
            },
        });
        lookAround();
        const double = memory.things.get(3, 1, 3);
        assert.equal(double.kind, 'container');
        assert.deepEqual([double, double.also].map(p => p.x).sort(), [3, 4], 'one thing in both cells');
        assert.deepEqual(memory.things.get(4, 1, 3), double, 'the same thing from either half');
        assert.equal(memory.things.get(7, 1, 3).also ?? null, null, 'a chest with no partner stays single');
        assert.equal(memory.things.count('chest'), 2);
    } finally {
        registerEdition('pc', javaEdition);
    }
});

test('a sign is remembered with what it says, read from the block as the bot sees it', () => {
    const { memory, lookAround } = setup(w => {
        w.set('oak_sign', 3, 1, 3);
    }, {
        prepare: bot => {
            const blockAt = bot.blockAt;
            bot.blockAt = pos => {
                pos.floored(); // as the real bot's does: a plain {x, y, z} throws
                const block = blockAt(pos);
                // As the game gives it: each side's lines on rows of their own, the front side first.
                return block?.name === 'oak_sign' ? Object.assign(block, { getSignText: () => ['Wheat farm\nthis way\n\n', ''] }) : block;
            };
        },
    });
    lookAround();
    const sign = memory.things.get(3, 1, 3);
    assert.equal(sign?.kind, 'sign', JSON.stringify(sign));
    assert.equal(sign.text, 'Wheat farm / this way');
});

// A shelf the bot sees, with what the server says stands on it (mineflayer keeps it on the block).
function shelfScene(facing, items) {
    return setup(w => {
        w.set('oak_shelf', 3, 1, 3, { facing, powered: false, side_chain: 'unconnected', waterlogged: false });
    }, {
        prepare: bot => {
            const blockAt = bot.blockAt;
            bot.blockAt = pos => {
                pos.floored(); // as the real bot's does: a plain {x, y, z} throws
                const block = blockAt(pos);
                // As a real block: its properties read from its state, and the block entity mineflayer keeps.
                return block?.name === 'oak_shelf'
                    ? Object.assign(block, { getProperties: () => propsOfState(bot.registry, block.stateId), blockEntity: { Items: items() } }) : block;
            };
        },
    });
}

test('what stands on a shelf is remembered when its front is in view, as a container\'s contents', () => {
    // The bot stands at the origin, south-west of the shelf: a shelf facing west shows it its front.
    let items = [{ Slot: 0, id: 'minecraft:iron_ingot', count: 7 }, { Slot: 2, id: 'minecraft:string', count: 4 }];
    const { memory, lookAround, bot, recorder } = shelfScene('west', () => items);
    lookAround();
    const shelf = memory.things.get(3, 1, 3);
    assert.equal(shelf?.kind, 'container', JSON.stringify(shelf));
    assert.deepEqual(shelf.contents.items, { iron_ingot: 7, string: 4 });
    assert.equal(shelf.contents.freeSlots, 1);
    assert.equal(shelf.contents.slots, 3);
    // Someone takes the iron: the game sends the shelf's block entity again, and the bot looks again.
    items = [{ Slot: 2, id: 'minecraft:string', count: 4 }];
    bot.emit('blockEntityData', bot.blockAt(new Vec3(3, 1, 3)));
    recorder.tick();
    assert.deepEqual(memory.things.get(3, 1, 3).contents.items, { string: 4 });
});

test('a shelf seen from behind is remembered, but not what is on it', () => {
    // From the origin the bot is behind a shelf at 3, 1, 3 facing east or south, and in front of one facing
    // north or west.
    for (const facing of ['east', 'south']) {
        const { memory, lookAround } = shelfScene(facing, () => [{ Slot: 1, id: 'minecraft:diamond', count: 3 }]);
        lookAround();
        const shelf = memory.things.get(3, 1, 3);
        assert.equal(shelf?.kind, 'container', facing);
        assert.equal(shelf.contents ?? null, null, `facing ${facing}, its front is away from the bot`);
    }
});

test('what a sign says is asked of the edition seam, which knows where the game keeps it', () => {
    // Another edition keeps a sign's text in a block entity of its own shape, which the block can't read.
    registerEdition('pc', { ...javaEdition, signSidesOf: block => block?.entity?.sides ?? [] });
    try {
        const { memory, lookAround } = setup(w => {
            w.set('oak_sign', 3, 1, 3);
        }, {
            prepare: bot => {
                const blockAt = bot.blockAt;
                bot.blockAt = pos => {
                    pos.floored();
                    const block = blockAt(pos);
                    return block?.name === 'oak_sign' ? Object.assign(block, { entity: { sides: ['Iron\nin the east', ''] } }) : block;
                };
            },
        });
        lookAround();
        assert.equal(memory.things.get(3, 1, 3).text, 'Iron / in the east');
    } finally {
        registerEdition('pc', javaEdition);
    }
});

test('nothing runs while the bot stands still in an unchanged world', () => {
    const { recorder, world, bot, memory } = setup();
    recorder.tick();
    assert.equal(memory.cells.read(1, 0, 1), 'stone', 'the first look happens');
    world.set('oak_planks', 2, 1, 2);       // changed with no notice to the bot (a stale chunk, say)
    recorder.tick();
    assert.equal(memory.cells.read(2, 1, 2), 'air', 'no look, so the change is not seen');
    bot.emit('blockUpdate', null, { position: new Vec3(2, 1, 2) });
    recorder.tick();
    assert.equal(memory.cells.read(2, 1, 2), 'oak_planks', 'a block changing nearby starts a look');

    // So does a chunk arriving: a bot that lands somewhere before its chunks load must look again.
    world.set('glass', 3, 1, 3);
    bot.emit('chunkColumnLoad', new Vec3(0, 0, 0));
    recorder.tick();
    assert.equal(memory.cells.read(3, 1, 3), 'glass');
    world.set('glass', 4, 1, 4);
    bot.emit('chunkColumnLoad', new Vec3(1600, 0, 1600));   // a chunk far away is no reason to look
    recorder.tick();
    assert.equal(memory.cells.read(4, 1, 4), 'air');
});

const NARROW = resolvePolicy({ fair_play: 'custom', fair_play_custom: { fov_degrees: 70 } });

test('a narrow view: only what is on screen is written, and turning round starts a new look', () => {
    const { memory, recorder, bot } = setup(w => {
        w.set('diamond_ore', 0, 1, -8);                // ahead: the bot faces north (-z)
        w.set('gold_ore', 0, 1, 8);                    // behind
        w.set('chest', 8, 1, 0, { facing: 'west' });   // off to the right, past the screen's edge
    }, { policy: NARROW });
    bot.entity.pitch = -0.4; // looking a little down, as a player walking does
    recorder.tick();
    assert.equal(memory.cells.read(0, 1, -8), 'diamond_ore');
    assert.equal(memory.cells.read(0, 1, 8), null, 'the ore behind was not on screen');
    assert.equal(memory.things.get(8, 1, 0), null, 'nor the chest to the side');
    assert.equal(memory.cells.read(0, 0, 0), 'stone', 'the ground under its feet is known by touch');
    assert.equal(memory.cells.lookedAt(0, 0, 0), 1_000_000, 'the cube it stands in was looked at');
    assert.equal(memory.cells.lookedAt(0, 0, -1), 1_000_000, 'and the one ahead');
    assert.equal(memory.cells.lookedAt(-2, 0, 1), 0, 'one wholly behind it was not');

    bot.entity.yaw = -0.3; // a small turn, about 17 degrees: no new look
    recorder.tick();
    assert.equal(memory.things.get(8, 1, 0), null);
    bot.entity.yaw = -Math.PI / 2; // a quarter turn right, to face east
    recorder.tick();
    assert.equal(memory.things.get(8, 1, 0)?.name, 'chest', 'facing it now');
    assert.equal(memory.cells.read(0, 1, 8), null, 'the gold is still behind');
    bot.entity.yaw = Math.PI; // and round to face south
    recorder.tick();
    assert.equal(memory.cells.read(0, 1, 8), 'gold_ore');
});

test('a narrow view: a turn while a look is under way looks again at what the new screen shows', () => {
    // A clock that moves a millisecond each time it is read: a tick with a budget of 1 does one step of work.
    let ms = 0;
    const { memory, recorder, bot } = setup(w => w.set('gold_ore', 0, 1, 8), { policy: NARROW, tickClock: () => ms++ });
    bot.entity.pitch = -0.4;
    // Facing north, through the cube the bot stands in (the gold's), with the rest of the look still to go.
    recorder.tick({ budgetMs: 1 });
    while (!memory.cells.lookedAt(0, 0, 0)) recorder.tick({ budgetMs: 1 });
    assert.equal(recorder.busy, true, 'the look is under way');
    assert.equal(memory.cells.read(0, 1, 8), null, 'the gold is behind');
    // It turns round while the look goes on: the cube it already went over is looked at again, facing south.
    bot.entity.yaw = Math.PI;
    while (recorder.busy && memory.cells.read(0, 1, 8) === null) recorder.tick({ budgetMs: 1 });
    assert.equal(memory.cells.read(0, 1, 8), 'gold_ore', 'seen before the look ended');
});

test('A1 and A2: a wall of planks replaced by glass while the bot was away is one note; no change, no note', () => {
    const { world, lookAround, notes, now, walkTo } = setup(w => w.fill('oak_planks', [5, 1, -3], [5, 3, 3]));
    lookAround();
    assert.deepEqual(notes(), [], 'a first look is not a change');
    now.advance(3_600_000);
    lookAround();
    assert.deepEqual(notes(), [], 'A2: an hour later, nothing has changed');

    world.fill('glass', [5, 1, -3], [5, 3, 3]);
    now.advance(3_600_000);
    walkTo(2, 1, 6);                          // it comes at the wall from a different side
    lookAround();
    const [note, ...rest] = notes();
    assert.equal(rest.length, 0);
    assert.match(note, /^Noticed near .*: Gone: oak_planks \d+\. New: glass \d+\.$/);
    assert.equal(Number(note.match(/glass (\d+)/)[1]) >= 8, true);
});

test('A3: a hut built on ground the bot had seen is a note naming planks, from any side', () => {
    const { world, lookAround, notes, now, walkTo } = setup();
    lookAround();
    world.fill('oak_planks', [6, 1, -2], [10, 3, 2]);    // a hut appears on the open floor
    world.fill('air', [7, 1, -1], [9, 2, 1]);
    now.advance(3_600_000);
    walkTo(-3, 1, 4);
    lookAround();
    const [note] = notes();
    assert.match(note, /^Noticed near .*: New: oak_planks \d+\.$/);
    // Only the bottom row stands where it had seen empty air, but the wall above it is counted too.
    assert.equal(Number(note.match(/oak_planks (\d+)/)[1]) >= 20, true, note);
});

test('A4: a hut the bot comes across for the first time is recorded, not reported', () => {
    const { memory, lookAround, notes } = setup(w => w.fill('oak_planks', [6, 1, -2], [10, 3, 2]));
    lookAround();
    assert.equal(memory.cells.read(6, 2, 0), 'oak_planks');
    assert.deepEqual(notes(), []);
});

test('A5: the bot\'s own digging and placing, and what it watched change, make no note', () => {
    const { world, bot, memory, lookAround, notes, now } = setup(w => w.fill('stone', [5, 1, -4], [5, 3, 4]));
    lookAround();
    now.advance(3_600_000);
    // It digs a row out of the wall and builds a row of cobblestone, as mineflayer would report it.
    for (let z = -4; z <= 4; z++) {
        world.set('air', 5, 2, z);
        bot.emit('diggingCompleted', { position: new Vec3(5, 2, z) });
        world.set('cobblestone', 3, 1, z);
        bot.emit('blockPlaced', null, { position: new Vec3(3, 1, z) });
    }
    lookAround();
    assert.deepEqual(notes(), []);
    assert.equal(memory.cells.read(5, 2, 0), 'air', 'memory is still brought up to date');
    assert.equal(memory.cells.tagOf(3, 1, 0), 'placed', 'and it knows which blocks are its own');

    // Someone else changes the wall while the bot stands there looking at it.
    world.fill('glass', [5, 3, -4], [5, 3, 4]);
    lookAround();
    assert.deepEqual(notes(), [], 'it saw those cells a moment ago: it watched them change');
});

test('a wall torn down in front of a bot that stood a quiet while looking at it is no news', () => {
    const { world, recorder, lookAround, notes, now } = setup(w => w.fill('stone', [4, 1, -4], [4, 3, 4]));
    lookAround();
    // Two minutes standing still with nothing changing: the timer ticks, and there is nothing new to see.
    for (let s = 0; s < 120; s++) { now.advance(1000); recorder.tick(); }
    world.fill('air', [4, 1, -4], [4, 3, 4]);
    lookAround();
    assert.deepEqual(notes(), [], 'it was looking at the wall the whole time');
});

test('a cell out of view for minutes is not counted as watched because its cube stayed in view', () => {
    // A pillar with a slab of glowstone on its east side. Seen from the east, then the bot walks round to
    // the west, where the pillar hides the glowstone but not the floor, which shares the glowstone's cube.
    const { world, lookAround, notes, now, walkTo, memory } = setup(w => {
        w.fill('stone', [5, 1, -1], [5, 4, 1]);
        w.fill('glowstone', [6, 1, -1], [6, 4, 1]);
    });
    walkTo(10, 1, 0);
    lookAround();
    assert.equal(memory.cells.read(6, 2, 0), 'glowstone', 'seen from the east');
    walkTo(1, 1, 0);
    for (let s = 0; s < 120; s++) { now.advance(1000); lookAround(); }   // looking around all the while
    world.fill('air', [6, 1, -1], [6, 4, 1]);
    walkTo(10, 1, 0);
    lookAround();
    assert.deepEqual(notes(), ['Noticed near 6, 4, 1: Gone: glowstone 12.'], 'it last saw the glowstone minutes ago, from the other side');
});

// mineflayer's digging plugin drops every 'diggingCompleted' listener when the bot dies, the recorder's
// among them. The plugin may have registered its own 'death' handler before the recorder or after it.
for (const order of ['before', 'after']) {
    test(`after a death (mineflayer's handler registered ${order} the recorder's) the bot still knows its own digging`, async () => {
        const dropDigListeners = bot => bot.on('death', () => bot.removeAllListeners('diggingCompleted'));
        const { world, bot, memory, recorder, lookAround } = setup(w => w.fill('stone', [5, 1, -2], [5, 3, 2]), {
            prepare: order === 'before' ? dropDigListeners : () => {},
        });
        if (order === 'after') dropDigListeners(bot);
        lookAround();

        bot.emit('death');
        await new Promise(resolve => setImmediate(resolve));
        world.set('air', 5, 2, 0);
        bot.emit('diggingCompleted', { position: new Vec3(5, 2, 0) });
        assert.equal(memory.cells.tagOf(5, 2, 0), 'dug', 'the cell it dug is marked as its own doing');

        // Twice over, and never twice heard: one listener, however many deaths.
        bot.emit('death');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(bot.listenerCount('diggingCompleted'), 1);

        // Once stopped, a death does not bring the listener back.
        recorder.stop();
        bot.emit('death');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(bot.listenerCount('diggingCompleted'), 0);
    });
}

test('A6: a chest gone from a known place is a note, however little else changed', () => {
    const { world, memory, lookAround, notes, now } = setup(w => {
        w.set('chest', 4, 1, 0, { facing: 'west' });
        w.set('crafting_table', 4, 1, 1);
    });
    lookAround();
    memory.places.name(memory.places.at({ x: 4, y: 1, z: 0 }).id, 'the base');
    world.set('air', 4, 1, 0);
    now.advance(3_600_000);
    lookAround();
    assert.deepEqual(notes(), ['Noticed at the base: Gone: chest 1.']);
    assert.equal(memory.things.get(4, 1, 0).provenance, 'gone');

    // A double chest is one thing in two cells: new, it is one new chest; gone, one chest gone.
    world.set('chest', 4, 1, 3, { facing: 'west', type: 'right' });
    world.set('chest', 4, 1, 4, { facing: 'west', type: 'left' });
    now.advance(3_600_000);
    lookAround();
    assert.deepEqual(notes(), ['Noticed at the base: New: chest 1.'], 'it stands where the bot had seen empty floor');
    assert.equal(memory.things.count('chest'), 1);
    world.set('air', 4, 1, 3); world.set('air', 4, 1, 4);
    now.advance(3_600_000);
    lookAround();
    assert.deepEqual(notes(), ['Noticed at the base: Gone: chest 1.']);
    assert.equal(memory.things.nearest(['chest'], { x: 0, y: 1, z: 0 }).length, 0);
});

test('walking drops crumbs, and the walk test keeps crumbs either side of a wall or a gap apart', () => {
    const { memory, recorder, walkTo } = setup(w => {
        w.fill('stone', [-10, 1, 3], [20, 3, 3]);        // a wall along z = 3
        w.set('glass', 4, 1, 3); w.set('glass', 4, 2, 3); // with a window in it
        w.fill('air', [10, 0, -8], [11, 0, -6]);          // and a hole in the floor elsewhere
    });
    walkTo(13, 1, 0.5);
    assert.equal(memory.trail.size, 4, 'a crumb every four blocks');
    assert.equal(recorder.canWalkStraight({ x: 0.5, y: 1, z: 0.5 }, { x: 4.5, y: 1, z: 1.5 }), true);
    assert.equal(recorder.canWalkStraight({ x: 0.5, y: 1, z: 2.5 }, { x: 0.5, y: 1, z: 4.5 }), false, 'a wall is in the way');
    assert.equal(recorder.canWalkStraight({ x: 4.5, y: 1, z: 2.5 }, { x: 4.5, y: 1, z: 4.5 }), false, 'glass can be seen through, not walked through');
    assert.equal(recorder.canWalkStraight({ x: 9.5, y: 1, z: -7 }, { x: 12.5, y: 1, z: -7 }), false, 'nor can a hole in the floor be walked over');
    assert.equal(recorder.canWalkStraight({ x: 0.5, y: 1, z: 0.5 }, { x: 0.5, y: 1, z: 200 }), false, 'what is not loaded is not known');
});

test('opening a container records what is in it, and closing it records what the bot left', async () => {
    // A stand-in for mineflayer's openBlock and the window it gives back.
    const stacks = [{ name: 'iron_ingot', count: 40 }, { name: 'bread', count: 5 }];
    const window = { inventoryStart: 54, containerItems: () => stacks };
    const { bot, memory, recorder, now } = setup(w => {
        // A double chest facing west: seen from the front, its left half is the one to the south.
        w.set('chest', 2, 1, 0, { facing: 'west', type: 'right' });
        w.set('chest', 2, 1, 1, { facing: 'west', type: 'left' });
    }, { prepare: b => { b.openBlock = async () => window; } });
    recorder.tick();
    assert.equal(memory.things.count('chest'), 1, 'the two halves are one chest');
    assert.equal(memory.things.get(2, 1, 0).contents, undefined, 'it has not looked inside yet');
    await bot.openBlock({ position: new Vec3(2, 1, 1) });
    assert.deepEqual(memory.things.get(2, 1, 0).contents.items, { iron_ingot: 40, bread: 5 });
    assert.equal(memory.things.get(2, 1, 0).contents.freeSlots, 52);

    stacks.pop();                               // it takes the bread
    now.advance(4000);
    bot.emit('windowClose', window);
    assert.deepEqual(memory.things.get(2, 1, 1).contents.items, { iron_ingot: 40 });
    assert.equal(memory.things.findItem('iron', { x: 0, y: 1, z: 0 })[0].total, 40);
    assert.equal(memory.things.findItem('bread', { x: 0, y: 1, z: 0 }).length, 0);

    // A recorder that has stopped (the bot left for another dimension) hears nothing more.
    recorder.stop();
    stacks.push({ name: 'diamond', count: 1 });
    await bot.openBlock({ position: new Vec3(2, 1, 1) });
    assert.equal(memory.things.findItem('diamond', { x: 0, y: 1, z: 0 }).length, 0);
});

test('fields and herds are kept per cube from what is in view', () => {
    const cow = (id, x, z) => ({ id, type: 'animal', name: 'cow', position: new Vec3(x, 1, z), height: 1.4, width: 0.9 });
    const { memory, lookAround, bot } = setup(w => {
        for (let x = 3; x <= 6; x++) w.set('wheat', x, 1, 2, { age: x === 3 ? 7 : 2 });
    }, { entities: [cow(1, 5.5, -4.5), cow(2, 6.5, -5.5), cow(3, 7.5, -4.5)] });
    lookAround();
    const [field] = memory.things.fieldsNear({ x: 0, y: 1, z: 0 });
    assert.deepEqual([field.crop, field.count, field.ripe], ['wheat', 4, 1]);
    const [herd] = memory.things.herdsNear({ x: 0, y: 1, z: 0 });
    assert.deepEqual([herd.kind, herd.count], ['cow', 3]);
    assert.deepEqual([herd.x, herd.z], [6, -5], 'roughly the middle of them');

    // The cows wander off; the next look over that cube finds none.
    for (const id of [1, 2, 3]) delete bot.entities[id];
    lookAround();
    assert.equal(memory.things.herdsNear({ x: 0, y: 1, z: 0 }).length, 0);
});

test('perception answers from memory for what is out of sight, in the state it was last seen', () => {
    const { world, bot, memory, perception, lookAround, walkTo } = setup(w => {
        w.fill('stone', [-6, 1, 6], [6, 4, 6]);                    // a wall to hide behind
        w.set('oak_door', 3, 1, 0, { half: 'lower', open: 'true', facing: 'east' });
        w.set('oak_door', 3, 2, 0, { half: 'upper', open: 'true', facing: 'east' });
        w.set('sand', -4, 1, -2);
    });
    lookAround();
    assert.equal(memory.things.count('oak_door'), 1, 'both halves are one door');
    walkTo(0.5, 1, 8.5);                                             // round behind the wall
    world.set('air', 3, 1, 0); world.set('air', 3, 2, 0);            // the door is taken while it can't see

    const door = perception.blockAt(new Vec3(3, 1, 0));
    assert.equal(door?.name, 'oak_door', 'it still believes the door is there');
    assert.equal(propsOfState(bot.registry, door.stateId).open, 'true', 'and that it was open');
    assert.ok(door.rememberedAt, 'the answer is marked as a memory');

    // A search finds remembered blocks of any kind.
    const stone = bot.registry.blocksByName.sand.id;
    const [found] = perception.findBlocks({ matching: stone, maxDistance: 32, count: 1 });
    assert.deepEqual([found.x, found.y, found.z], [-4, 1, -2]);
    const byTest = perception.findBlocks({ matching: block => block.name === 'sand', maxDistance: 32, count: 3 });
    assert.equal(byTest.length, 1);
});

test('block states go to names and back, and survive a game version that renumbers them', () => {
    const { registry } = fixtureWorld();
    const door = registry.blocksByName.oak_door;
    for (const stateId of [door.minStateId, door.minStateId + 7, door.maxStateId]) {
        const props = propsOfState(registry, stateId);
        assert.equal(stateOfProps(registry, 'oak_door', props), stateId);
    }
    assert.equal(propsOfState(registry, registry.blocksByName.stone.defaultState), null);
    assert.equal(stateOfProps(registry, 'stone', { made_up: 'x' }), registry.blocksByName.stone.defaultState);
    assert.equal(stateOfProps(registry, 'not_a_block', {}), null);
    // A property the new version dropped is ignored, and a missing one keeps the default.
    const partial = stateOfProps(registry, 'oak_door', { open: 'true', gone_in_this_version: 'yes' });
    assert.equal(propsOfState(registry, partial).open, 'true');
    assert.equal(propsOfState(registry, partial).half, propsOfState(registry, door.defaultState).half);
});

test('memory is saved per world and read back by a new session', () => {
    const first = setup(w => w.set('chest', 3, 1, 3));
    first.walkTo(6, 1, 0.5);
    first.lookAround();
    first.memory.places.name(1, 'camp');
    assert.equal(first.memory.save(), 0);

    const again = setup(() => {}, { baseDir: first.baseDir });
    assert.equal(again.memory.cells.read(3, 1, 3), 'chest');
    assert.equal(again.memory.things.count('chest'), 1);
    assert.equal(again.memory.places.byName('camp').id, 1);
    assert.equal(again.memory.trail.size, 2);
    assert.equal(openMemory({ baseDir: first.baseDir, scope: 'local:55916/w1/the_nether' }).trail.size, 0, 'another dimension starts empty');
});

test('a hut that appeared is tagged as built by someone, the rows above its first one too', () => {
    const { world, memory, lookAround, now, walkTo } = setup();
    lookAround();
    world.fill('oak_planks', [6, 1, -2], [10, 3, 2]);
    world.fill('air', [7, 1, -1], [9, 2, 1]);
    now.advance(3_600_000);
    walkTo(-3, 1, 4);
    lookAround();
    assert.equal(memory.cells.tagOf(6, 1, 0), 'built', 'the row on ground it had seen');
    assert.equal(memory.cells.tagOf(6, 3, 0), 'built', 'and the wall above it, first seen in the same look');
    assert.equal(memory.cells.tagOf(0, 0, 0), null, 'the floor it always stood on is nobody\'s doing');
});

test('a dirt wall put up while the bot watched is tagged built, its own blocks are not', () => {
    const { world, bot, memory, lookAround } = setup();
    lookAround();
    // Someone walls off the way with dirt, in front of the bot. That is no news worth a note, but it is someone's.
    for (let z = -2; z <= 2; z++) world.set('dirt', 4, 1, z);
    lookAround();
    assert.equal(memory.cells.tagOf(4, 1, 0), 'built');
    // The bot places cobblestone itself.
    world.set('cobblestone', -3, 1, 0);
    bot.emit('blockPlaced', null, { position: new Vec3(-3, 1, 0) });
    lookAround();
    assert.equal(memory.cells.tagOf(-3, 1, 0), 'placed');
    // Gravel falling where there was air is nobody's.
    world.set('gravel', 2, 1, 3);
    lookAround();
    assert.equal(memory.cells.tagOf(2, 1, 3), null);
});

test('a block the bot placed is its own only while it stands: someone else\'s block in its place is built', () => {
    const { world, bot, memory, lookAround } = setup(w => w.set('short_grass', -3, 1, 2));
    lookAround();
    // The bot places cobblestone, one block in the open and one over a tuft of grass.
    world.set('cobblestone', -3, 1, 0);
    bot.emit('blockPlaced', null, { position: new Vec3(-3, 1, 0) });
    world.set('cobblestone', -3, 1, 2);
    bot.emit('blockPlaced', null, { position: new Vec3(-3, 1, 2) });
    lookAround();
    assert.equal(memory.cells.tagOf(-3, 1, 0), 'placed');
    assert.equal(memory.cells.tagOf(-3, 1, 2), 'placed', 'the grass it placed over was no one else\'s doing');
    // Someone takes the first away and later sets a plank there; someone swaps the second for a plank at once.
    world.set('air', -3, 1, 0);
    world.set('oak_planks', -3, 1, 2);
    lookAround();
    assert.equal(memory.cells.tagOf(-3, 1, 0), null, 'the bot\'s block is gone');
    assert.equal(memory.cells.tagOf(-3, 1, 2), 'built', 'a plank in place of its block is someone\'s');
    world.set('oak_planks', -3, 1, 0);
    lookAround();
    assert.equal(memory.cells.tagOf(-3, 1, 0), 'built', 'and so is one set where its block was');
});
