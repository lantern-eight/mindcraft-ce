// SPDX-License-Identifier: CC0-1.0
// Starting a bot for Bedrock Edition: which settings become which mineflayer options, and what gets wired
// to the new bot. No server and no network; mineflayer is stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import settings from '../settings.js';
import agentSettings, { setSettings } from '../src/agent/settings.js';
import { initBot } from '../src/utils/mcdata.js';
import { createAgent } from '../src/mindcraft/mindcraft.js';
import {
    DEFAULT_BEDROCK_PORT, isBedrock, bedrockVersion, bedrockServer, bedrockBotOptions, initBedrockBot, acceptServerKey, worldIdentityOf,
    gameDataFor,
} from '../src/agent/bedrock/connect.js';

const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));

// For the tests of what bedrockServer makes of the settings, whichever libraries this checkout installs.
const installed = { librariesInstalled: () => true };

const bedrockSettings = (over = {}) => ({
    minecraft_edition: 'bedrock', minecraft_version: '1.26.60', host: 'example.test', port: 19132, auth: 'offline', ...over,
});

test('only the word "bedrock" picks Bedrock; a missing setting means Java', () => {
    assert.equal(isBedrock({ minecraft_edition: 'bedrock' }), true);
    assert.equal(isBedrock({ minecraft_edition: 'java' }), false);
    assert.equal(isBedrock({}), false);
    assert.equal(isBedrock(undefined), false);
});

test('the edition setting is listed for MindServer, with the same default as settings.js', () => {
    // MindServer drops any setting that isn't on its list from an agent created through its page or API.
    // Unlisted, a Bedrock bot made that way would quietly start as a Java one.
    assert.ok(spec.minecraft_edition, 'minecraft_edition is missing from settings_spec.json');
    assert.deepEqual(spec.minecraft_edition.options, ['java', 'bedrock']);
    assert.equal(spec.minecraft_edition.default, settings.minecraft_edition);
});

test('the default edition comes with a version and a port for it', () => {
    // main defaults to Java Edition, and the bedrock branch, which installs the Bedrock libraries, to
    // Bedrock (CLAUDE.md, "Two Editions, Two Branches"). Either way the rest of the defaults fit.
    if (isBedrock(settings)) {
        assert.equal(settings.port, DEFAULT_BEDROCK_PORT, 'a Bedrock server\'s usual port');
        assert.equal(settings.minecraft_version, 'auto', 'whatever the server runs');
    } else {
        assert.equal(settings.minecraft_edition, 'java', 'Java Edition, said in so many words');
        assert.notEqual(settings.port, DEFAULT_BEDROCK_PORT);
    }
    assert.equal(spec.port.default, settings.port, 'and MindServer offers the same');
});

test('Bedrock chosen where its libraries are not installed is refused, and the message says where they are', () => {
    assert.throws(() => bedrockServer(bedrockSettings(), { librariesInstalled: () => false }), /bedrock branch.*"java"/s);
    // A wrong version is still reported as that, whichever libraries are installed.
    assert.throws(() => bedrockServer(bedrockSettings({ minecraft_version: '26.3' }), { librariesInstalled: () => false }),
        /not a Bedrock Edition version/);
});

test('a version is given to game data with the bedrock_ prefix and to the protocol without it', () => {
    assert.deepEqual(bedrockVersion('1.26.60'), { number: '1.26.60', dataName: 'bedrock_1.26.60' });
    assert.deepEqual(bedrockVersion('bedrock_1.26.60'), { number: '1.26.60', dataName: 'bedrock_1.26.60' });
});

test('"auto" or no version leaves the choice to the server', () => {
    for (const version of ['auto', '', null, undefined]) {
        assert.deepEqual(bedrockVersion(version), { number: null, dataName: null });
    }
    assert.ok(!('version' in bedrockBotOptions(bedrockSettings({ minecraft_version: 'auto' }), 'bot')));
});

test('a Java version left in the setting is refused, and the message says what to set', () => {
    assert.throws(() => bedrockVersion('26.3'), /not a Bedrock Edition version.*"auto"/s);
    assert.throws(() => bedrockBotOptions(bedrockSettings({ minecraft_version: '26.3' }), 'bot'), /not a Bedrock Edition version/);
    assert.throws(() => bedrockServer(bedrockSettings({ minecraft_version: '26.3' })), /not a Bedrock Edition version/);
});

test('the options name the edition, the server and the bot', () => {
    const options = bedrockBotOptions(bedrockSettings({ port: 19200 }), 'andy', { compiledRakNet: true });
    assert.deepEqual(options, {
        edition: 'bedrock', username: 'andy', host: 'example.test', port: 19200, offline: true, version: 'bedrock_1.26.60',
    });
});

test('no port, or the "find it" port of a Java setup, becomes the Bedrock default', () => {
    for (const port of [-1, 0, undefined]) {
        assert.equal(bedrockBotOptions(bedrockSettings({ port }), 'bot').port, DEFAULT_BEDROCK_PORT);
        assert.equal(bedrockServer(bedrockSettings({ port }), installed).port, DEFAULT_BEDROCK_PORT);
    }
    assert.equal(DEFAULT_BEDROCK_PORT, 19132);
});

test('auth "microsoft" signs in; anything else joins offline', () => {
    assert.equal(bedrockBotOptions(bedrockSettings({ auth: 'microsoft' }), 'bot').offline, false);
    assert.equal(bedrockBotOptions(bedrockSettings({ auth: 'offline' }), 'bot').offline, true);
    assert.equal(bedrockBotOptions(bedrockSettings({ auth: undefined }), 'bot').offline, true);
});

test('without the compiled RakNet backend the JavaScript one is named up front', () => {
    assert.equal(bedrockBotOptions(bedrockSettings(), 'bot', { compiledRakNet: false }).raknetBackend, 'jsp-raknet');
    assert.ok(!('raknetBackend' in bedrockBotOptions(bedrockSettings(), 'bot', { compiledRakNet: true })));
});

test('the server to connect to is the settings as they stand: no lookup', () => {
    assert.deepEqual(bedrockServer(bedrockSettings({ port: 19200 }), installed),
        { host: 'example.test', port: 19200, minecraft_version: '1.26.60' });
    // "auto" stays "auto": it is the bot's own start-up that leaves the version to the server.
    assert.equal(bedrockServer(bedrockSettings({ minecraft_version: 'auto' }), installed).minecraft_version, 'auto');
});

// A bot as mineflayer would hand it back, recording what is done to it.
function fakeMineflayer() {
    const calls = { options: null, plugins: [], acceptedPack: 0 };
    const bot = new EventEmitter();
    bot.loadPlugin = plugin => calls.plugins.push(plugin);
    bot.acceptResourcePack = () => { calls.acceptedPack++; };
    bot.registry = { version: { minecraftVersion: '1.26.60', type: 'bedrock' } };
    const createBot = options => { calls.options = options; return bot; };
    return { bot, calls, createBot };
}

test('the bot is created with the Bedrock options and the plugins that work there', () => {
    const { bot, calls, createBot } = fakeMineflayer();
    const made = initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    assert.equal(made, bot);
    assert.equal(calls.options.edition, 'bedrock');
    assert.equal(calls.options.username, 'andy');
    assert.equal(calls.options.version, 'bedrock_1.26.60');
    // Walking, fighting, collecting and armor, then this fork's own plugin that evens out the adapter's
    // shapes. The fifth plugin of the Java bot, the one that eats, is not among them: it can't be loaded
    // on Bedrock, and this fork's own eater stands in its place.
    assert.equal(calls.plugins.length, 5);
    assert.ok(calls.plugins.every(plugin => typeof plugin === 'function'));
});

test('the agent sets up eating by name, as on Java, and finds the Bedrock eater there', () => {
    // The agent calls these two when it starts, on either edition. tests/bedrock_eating.test.js has what
    // the eater then does.
    const { bot, createBot } = fakeMineflayer();
    initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    bot.autoEat.setOpts({ minHunger: 14 });
    assert.equal(bot.autoEat.opts.minHunger, 14);
    assert.equal(bot.autoEat.enabled, false, 'nothing eats until the agent says so');
    bot.autoEat.enableAuto();
    assert.equal(bot.autoEat.enabled, true);
    assert.equal(bot.autoEat.isEating, false);
    bot.autoEat.disableAuto();
});

test("the rest of the code is handed the bot's own registry at login, once", () => {
    const { bot, createBot } = fakeMineflayer();
    const handed = [];
    initBedrockBot('andy', bedrockSettings(), registry => handed.push(registry), { createBot });
    assert.deepEqual(handed, [], 'nothing before login');
    bot.emit('login');
    bot.emit('login'); // a reconnect inside one process must not swap the data under running code
    assert.equal(handed.length, 1);
    // Not a copy by version name: what is handed over reads through to the object the bot fills in, so a
    // number the server hands out later is seen too.
    assert.equal(Object.getPrototypeOf(handed[0]), bot.registry);
    bot.registry.itemsByName = { stone: { id: 7 } };
    assert.equal(handed[0].itemsByName.stone.id, 7);
});

test('biomes are the registry\'s own: the world answers with a number the table knows', () => {
    const registry = { version: { type: 'bedrock' }, biomes: { 1: { id: 1, name: 'plains' } }, blocksByName: { stone: { id: 1 } } };
    const data = gameDataFor(registry);
    assert.equal(data.biomes, registry.biomes);
    assert.equal(data.biomes[1].name, 'plains');
    // Everything else is the registry's own.
    assert.equal(data.blocksByName, registry.blocksByName);
    assert.equal(data.version.type, 'bedrock');
});

test('recipes are the ones the server sent, asked for by item number', () => {
    // The skills read the game data's recipes by item number. The installed table is for an old Bedrock
    // version and laid out another way, so the answer has to come from the bot, in Java's layout.
    const registry = { recipes: { 2: 'the installed table' }, version: { type: 'bedrock' } };
    const planks = { id: 900, type: 'shapeless', result: { type: 2, count: 4 }, ingredients: [{ name: 'oak_log', id: 1, count: 1 }], shape: null };
    const bot = { recipesAll: id => (id === 2 ? [planks] : []) };
    const data = gameDataFor(registry, bot);
    assert.deepEqual(data.recipes[2], [{ ingredients: [1], result: { id: 2, count: 4 } }]);
    assert.equal(data.recipes[7], undefined, 'no recipe: nothing, not an empty list');
    assert.equal(gameDataFor(registry).recipes[2], undefined, 'without a bot there is no recipe list to read');
    assert.equal(registry.recipes[2], 'the installed table', "the bot's registry is left as it was");
});

test('a resource pack the server offers is accepted', () => {
    const { bot, calls, createBot } = fakeMineflayer();
    initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    bot.emit('resourcePack');
    assert.equal(calls.acceptedPack, 1);
});

test('none of the Java-only wiring touches the connection', () => {
    // The Java start-up wraps the client's write and emit, and listens for Java packets on it. A Bedrock
    // client is another class with other packets; leaving it alone is the point.
    const { bot, createBot } = fakeMineflayer();
    bot._client = new EventEmitter();
    const write = bot._client.write = () => {};
    const emit = bot._client.emit;
    initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    assert.equal(bot._client.write, write);
    assert.equal(bot._client.emit, emit);
    assert.deepEqual(bot._client.eventNames(), ['start_game'], 'only the Bedrock packet that names the world');
});

test('the world is named by a hash of the seed the server sends, and by nothing when there is none', () => {
    const name = worldIdentityOf({ seed: [393228526, -1366742413] });
    assert.match(name, /^[0-9a-f]{16}$/);
    assert.ok(!name.includes('393228526'), 'the seed itself is not shown');
    assert.equal(worldIdentityOf({ seed: [393228526, -1366742413] }), name, 'the same world, the same name');
    assert.notEqual(worldIdentityOf({ seed: [393228526, 1] }), name);
    assert.equal(worldIdentityOf({ seed: 12345n }), worldIdentityOf({ seed: 12345n }));
    for (const hidden of [{ seed: [0, 0] }, { seed: 0n }, { seed: 0 }, {}, null]) assert.equal(worldIdentityOf(hidden), null);

    const { bot, createBot } = fakeMineflayer();
    bot._client = new EventEmitter();
    initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    bot._client.emit('start_game', { seed: [393228526, -1366742413] });
    assert.equal(bot.worldIdentity, name);
});

test("the server's key is accepted and printed, and no transport is forced by it", () => {
    // The library asks for this when a dedicated server signs its side of the HTTP hand-off.
    const client = { options: { nethernet: {} } };
    const printed = [];
    acceptServerKey(client, line => printed.push(line));
    assert.equal(client.options.nethernet.onServerKey('sha256:abc', 'http://example.test:19132'), true);
    assert.match(printed[0], /example\.test:19132.*sha256:abc/);
    // It is not among the options the bot is created with: there it would rule out the older transport.
    assert.ok(!('nethernet' in bedrockBotOptions(bedrockSettings(), 'bot')));
    assert.ok(!('transport' in bedrockBotOptions(bedrockSettings(), 'bot')));
});

test('a key that was pinned is left to the library to enforce', () => {
    const pinned = { options: { nethernet: { serverKey: 'sha256:abc' } } };
    acceptServerKey(pinned);
    assert.equal(pinned.options.nethernet.onServerKey, undefined);
    // A client of another shape (a stand-in, or an older library) is left alone.
    acceptServerKey({});
    acceptServerKey(undefined);
});

// The two places inherited code hands over to this module. Both are checked with a Java version left in
// the settings: the Bedrock module refuses it by name, and the Java code never would, so the refusal shows
// which of the two ran. Nothing connects anywhere.

test("the bot start-up hands a Bedrock bot to this module before any Java set-up", () => {
    const before = { ...agentSettings };
    try {
        setSettings(bedrockSettings({ minecraft_version: '26.3' }));
        assert.throws(() => initBot('andy'), /not a Bedrock Edition version/);
    } finally {
        setSettings(before);
    }
});

test('starting an agent for Bedrock skips the Java server lookup, and refuses a version that cannot work', async () => {
    const result = await createAgent({ profile: { name: 'bedrock_connect_test' }, ...bedrockSettings({ minecraft_version: '26.3' }) });
    assert.equal(result.success, false);
    assert.match(result.error, /not a Bedrock Edition version/);
});
