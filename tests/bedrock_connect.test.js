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
    DEFAULT_BEDROCK_PORT, isBedrock, bedrockVersion, bedrockServer, bedrockBotOptions, initBedrockBot, acceptServerKey,
    gameDataFor,
} from '../src/agent/bedrock/connect.js';

const spec = JSON.parse(readFileSync('src/mindcraft/public/settings_spec.json', 'utf8'));

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
        assert.equal(bedrockServer(bedrockSettings({ port })).port, DEFAULT_BEDROCK_PORT);
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
    assert.deepEqual(bedrockServer(bedrockSettings({ port: 19200 })),
        { host: 'example.test', port: 19200, minecraft_version: '1.26.60' });
    // "auto" stays "auto": it is the bot's own start-up that leaves the version to the server.
    assert.equal(bedrockServer(bedrockSettings({ minecraft_version: 'auto' })).minecraft_version, 'auto');
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
    // on Bedrock.
    assert.equal(calls.plugins.length, 5);
    assert.ok(calls.plugins.every(plugin => typeof plugin === 'function'));
});

test('the agent can still set up eating by name, though nothing eats yet', () => {
    // The agent calls these two when it starts, on either edition. Without a stand-in it would stop there.
    const { bot, createBot } = fakeMineflayer();
    initBedrockBot('andy', bedrockSettings(), () => {}, { createBot });
    bot.autoEat.setOpts({ minHunger: 14 });
    bot.autoEat.enableAuto();
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

test('the biome is "unknown" on Bedrock, whatever the world answers', () => {
    // The adapter doesn't read biomes yet: every spot answers with the first biome in the table. Inherited
    // code looks the answer up in the game data and stops on one it can't find.
    const registry = { version: { type: 'bedrock' }, biomes: { 0: { id: 0, name: 'bamboo_jungle' } }, blocksByName: { stone: { id: 1 } } };
    const data = gameDataFor(registry);
    assert.equal(data.biomes[0].name, 'unknown', 'not the first biome in the table');
    assert.equal(data.biomes[{ id: 0, name: 'bamboo_jungle' }].name, 'unknown', 'Bedrock answers with an object, not a number');
    assert.equal(data.biomes[4321].name, 'unknown');
    // Everything else is the registry's own.
    assert.equal(data.blocksByName, registry.blocksByName);
    assert.equal(data.version.type, 'bedrock');
    assert.equal(registry.biomes[0].name, 'bamboo_jungle', "the bot's registry is left as it was");
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
    assert.equal(bot._client.eventNames().length, 0);
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
