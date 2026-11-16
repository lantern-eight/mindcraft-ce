// SPDX-License-Identifier: CC0-1.0
// The libraries that speak Bedrock Edition are not released yet. package.json takes them from branches,
// pinned by commit (docs/core-hooks.md lists them). Each of those branches is several people's unmerged
// work put together, so the set is checked here as a whole: can the installed libraries, with no server at
// all, do the things a Bedrock bot does first? Know the game version, turn a block id from the server into
// a block, hold blocks in a chunk, and give the walking code Bedrock's numbers.
//
// A pin that goes back to a release too early, or a merge from the Java branch that puts an older pin
// back, fails here instead of in front of a server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import registryFactory from 'prismarine-registry';
import chunkFactory from 'prismarine-chunk';
import blockFactory from 'prismarine-block';
import physicsModule from 'prismarine-physics';
import pf from 'mineflayer-pathfinder';

const require = createRequire(import.meta.url);

// The Bedrock version this branch works with. The README says the same; one of the tests holds them
// together.
const BEDROCK_VERSION = '1.26.60';

// A registry as the bot has it once a server has said hello. On Bedrock the server sends the item list and
// says whether block ids are hashes, and the registry isn't usable for blocks until it has been told.
// Current servers send hashes, so that is the default here.
function bedrockRegistry({ hashed = true } = {}) {
    const registry = registryFactory(`bedrock_${BEDROCK_VERSION}`);
    const itemstates = registry.itemsArray.map(item => ({
        name: `minecraft:${item.name}`, runtime_id: item.id, component_based: false,
    }));
    registry.handleStartGame({ block_network_ids_are_hashes: hashed, itemstates });
    return registry;
}

test('the README names the Bedrock version these checks run on', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.ok(readme.includes(`Bedrock Edition, currently ${BEDROCK_VERSION}`),
        `README.md should say the branch targets Bedrock Edition ${BEDROCK_VERSION}`);
});

test('game data knows the Bedrock version, and still knows Java', () => {
    const bedrock = minecraftData(`bedrock_${BEDROCK_VERSION}`);
    assert.equal(bedrock.version.type, 'bedrock');
    assert.equal(bedrock.version.minecraftVersion, BEDROCK_VERSION);
    assert.ok(bedrock.blocksByName.stone, 'Bedrock block data is installed');
    // The same install serves the Java bot, so the Java live scenarios keep running on this branch.
    assert.equal(minecraftData('26.3').version.type, 'pc');
});

test('mineflayer has both editions', () => {
    const mineflayer = require('mineflayer');
    assert.equal(mineflayer.latestSupportedVersion, '26.3', 'the Java side is still the 26.3 work');
    assert.ok(Array.isArray(mineflayer.bedrockTestedVersions), 'the Bedrock adapter is in this mineflayer');
    // The transport from this release on is the one current Bedrock servers speak. npm would pick an older
    // one by itself on Node 22, so package.json names it.
    assert.equal(require('bedrock-protocol/package.json').version, '3.61.0');
    // A current dedicated server takes a direct connection by a hand-off over HTTP, which is newer than
    // that release. Without it the bot finds no server at the address and the connection times out.
    assert.equal(typeof require('nethernet').pingHttp, 'function', 'the transport can ask a server over HTTP');
    assert.equal(typeof require('bedrock-protocol/src/nethernet/http.js').pingHttp, 'function',
        'the protocol library has the HTTP hand-off');
});

for (const hashed of [true, false]) {
    test(`a chunk holds Bedrock blocks and gives them back (${hashed ? 'hashed' : 'plain'} block ids)`, () => {
        const registry = bedrockRegistry({ hashed });
        const Chunk = chunkFactory(registry);
        const column = new Chunk({ x: 0, z: 0 });
        const names = ['stone', 'oak_log', 'oak_stairs', 'chest', 'water', 'oak_fence'];
        names.forEach((name, x) => {
            column.setBlockStateId(new Vec3(x, 64, 0), registry.blocksByName[name].defaultState);
        });
        assert.deepEqual(names.map((_, x) => column.getBlock(new Vec3(x, 64, 0)).name), names);
    });
}

test('a Bedrock block has its shape and its own names for its states', () => {
    const registry = bedrockRegistry();
    const Block = blockFactory(registry);
    const stairs = Block.fromStateId(registry.blocksByName.oak_stairs.defaultState, 0);
    assert.equal(stairs.name, 'oak_stairs');
    // Two boxes: the slab half and the step. All-empty shapes would mean the state lookup fell through,
    // and the bot would walk into every staircase.
    assert.equal(stairs.shapes.length, 2);
    // Bedrock's state names are not Java's (`half`, `facing`). Code in this repo that reads a block's
    // properties has to expect these, which is why they are spelled out here.
    assert.deepEqual(Object.keys(stairs.getProperties()).sort(),
        ['minecraft:corner', 'upside_down_bit', 'weirdo_direction']);
});

test('walking uses Bedrock numbers, not Java ones', () => {
    const { Physics } = physicsModule;
    const air = { getBlock: () => null };
    const bedrock = Physics(bedrockRegistry(), air);
    const java = Physics(registryFactory('26.3'), air);
    // With Java's speed a Bedrock server sees a player moving half again too fast and pulls it back.
    assert.ok(bedrock.playerSpeed < java.playerSpeed,
        `Bedrock walking speed ${bedrock.playerSpeed} should be below Java's ${java.playerSpeed}`);
});

test('the pathfinder can tell a fence from a full block on Bedrock', () => {
    const registry = bedrockRegistry();
    const bot = { registry, entity: {}, inventory: { items: () => [] }, game: {} };
    const movements = new pf.Movements(bot);
    // Bedrock blocks have no first-state number, which the pathfinder used to sort blocks into kinds.
    // Without the Bedrock change both sets come out empty, and the bot tries to walk over fences.
    assert.ok(movements.fences.size > 0, 'fences are recognised');
    assert.ok(movements.carpets.size > 0, 'carpets are recognised');
    assert.ok(movements.fences.has(registry.blocksByName.oak_fence.id));
});
