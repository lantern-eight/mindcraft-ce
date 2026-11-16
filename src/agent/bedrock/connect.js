// SPDX-License-Identifier: CC0-1.0
// Connecting to a Minecraft Bedrock Edition server.
//
// The bot was written for Java Edition. mineflayer hides most of the difference: asked for the Bedrock
// edition it speaks Bedrock's protocol and offers the same `bot` as on Java. What it can't hide is how a
// bot is *started*, because the two editions name versions differently, listen on different ports, sign in
// differently, and need different wiring around the connection. All of that is here, so the inherited
// start-up code needs one line to hand over (see docs/core-hooks.md) and stays as it is for Java.
//
// This file decides nothing about what the bot may know or do. It only gets it connected.
import { createRequire } from 'node:module';
import minecraftData from 'minecraft-data';
import { createBot as createMineflayerBot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import { plugin as collectblock } from 'mineflayer-collectblock';
import armorManager from 'mineflayer-armor-manager';
import { guardBotActions } from '../action_context.js';

const require = createRequire(import.meta.url);

// The port a Bedrock server listens on unless told otherwise. Java's is 25565, and this fork's sample
// settings use another one again, so a port can't simply be carried over from a Java setup.
export const DEFAULT_BEDROCK_PORT = 19132;

/** Is this bot set to play Bedrock Edition? Anything else, a missing setting included, means Java. */
export function isBedrock(settings) {
    return settings?.minecraft_edition === 'bedrock';
}

/**
 * The same Bedrock version under the two names the libraries use.
 *
 * Game data files keep both editions side by side and tell them apart by a `bedrock_` prefix, while the
 * protocol library wants the bare number. People write the bare number ("1.26.60"), so that is what
 * `minecraft_version` holds; the prefixed form is accepted too.
 *
 * "auto", or nothing, gives nulls: the protocol library then asks the server which version it runs.
 *
 * A version the installed game data doesn't have is refused here, with a message that says what to set.
 * The usual cause is a Java version number left in the setting, and without this check that surfaces much
 * later as an error from deep inside a library.
 */
export function bedrockVersion(version) {
    if (!version || version === 'auto') return { number: null, dataName: null };
    const number = String(version).replace(/^bedrock_/, '');
    if (!minecraftData.versionsByMinecraftVersion.bedrock[number]) {
        const newest = minecraftData.versions.bedrock.find(v => v.releaseType === 'release')?.minecraftVersion;
        throw new Error(`minecraft_version is "${version}", which is not a Bedrock Edition version the installed game data knows. ` +
            `Set it to the server's Bedrock version${newest ? ` (the newest known is "${newest}")` : ''}, or to "auto".`);
    }
    return { number, dataName: `bedrock_${number}` };
}

/**
 * The three settings that say where the bot will connect, made ready for a Bedrock server.
 *
 * For Java, the code that starts agents first asks the server what it is and writes the answer over these
 * settings. The question is a Java one, and a Bedrock server doesn't answer it, so on Bedrock the settings
 * are taken as they stand. -1 means "find the port" on Java, by scanning; here it means the Bedrock default.
 *
 * A version that can't work is refused here, so the mistake is reported once, by the code that starts
 * agents, before a process is started for a bot that could never join.
 */
export function bedrockServer(settings) {
    bedrockVersion(settings.minecraft_version);
    return {
        host: settings.host,
        port: settings.port > 0 ? settings.port : DEFAULT_BEDROCK_PORT,
        minecraft_version: settings.minecraft_version,
    };
}

// RakNet, the older of the two ways to reach a Bedrock server, has a fast compiled backend that is only
// built on some machines; docs/core-hooks.md says which. Is it here?
function hasCompiledRakNet() {
    try {
        require('raknet-native');
        return true;
    } catch {
        return false;
    }
}

/**
 * The options mineflayer needs to create a Bedrock bot from this fork's settings.
 *
 * `compiledRakNet` is only a parameter so that a test can say which kind of machine it is on.
 */
export function bedrockBotOptions(settings, username, { compiledRakNet = hasCompiledRakNet() } = {}) {
    const { dataName } = bedrockVersion(settings.minecraft_version);
    const options = {
        edition: 'bedrock',
        username,
        host: settings.host,
        port: settings.port > 0 ? settings.port : DEFAULT_BEDROCK_PORT,
        // The same setting as on Java. "microsoft" signs in with an Xbox account, which a server in online
        // mode requires; the library prints a code to enter in a browser the first time, then remembers.
        // mineflayer's own default for Bedrock is offline, so this has to be said either way.
        offline: settings.auth !== 'microsoft',
    };
    // Left out for "auto": naming no version is how the library is asked to find it.
    if (dataName) options.version = dataName;
    // Without the compiled backend the library falls back to a JavaScript one by itself, but only after
    // looking for the server with the missing one and printing a long error about it. Naming the
    // JavaScript backend up front makes that first look work.
    if (!compiledRakNet) options.raknetBackend = 'jsp-raknet';
    return options;
}

// The plugin that makes the Java bot eat when it is hungry can't be loaded on Bedrock. It stops while
// loading, on a helper that compares the game version with Java version numbers, and past that it eats by
// writing Java packets itself. The agent sets it up by name when it starts, so it gets this in its place:
// the same switches, connected to nothing. Until eating is written for Bedrock, a bot there doesn't eat
// by itself.
function noAutoEat() {
    return { setOpts() {}, enableAuto() {}, disableAuto() {}, cancelEat() {}, isEating: false };
}

/**
 * Create the bot for a Bedrock server and wire up what every bot needs.
 *
 * `useGameData` is given the bot's registry once the bot knows its version. On Bedrock the server hands
 * out the numbers for items and block states when the bot joins, and the bot's registry is where they
 * land. Game data loaded afresh by version name, as the Java start-up does, would hold different numbers
 * for the same things, so the rest of the code must read the bot's own copy.
 *
 * What the Java start-up does and this leaves out, on purpose:
 *   - the Fabric registry handshake: Fabric is a Java mod loader;
 *   - the position-packet throttle: it works around a Java server's packet limit, and Bedrock movement
 *     is a different packet on a fixed tick;
 *   - the filter for unreadable packets: it names errors of the Java protocol library;
 *   - the world's seed from the login packet, which world memory uses to tell worlds apart: Bedrock's
 *     login has no such field. Until a Bedrock source for it is added, a world is told apart by the
 *     server's address, or by `world_id` where that is set.
 *
 * `createBot` is only a parameter so that a test can stand in for mineflayer.
 */
export function initBedrockBot(username, settings, useGameData, { createBot = createMineflayerBot } = {}) {
    const bot = createBot(bedrockBotOptions(settings, username));

    // The same plugins as on Java, in the same order, except the one that eats. Each of these four was
    // reported working on the Bedrock adapter by the adapter's author.
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    bot.loadPlugin(collectblock);
    bot.loadPlugin(armorManager);
    bot.autoEat = noAutoEat();

    bot.once('spawn', () => guardBotActions(bot));
    bot.once('resourcePack', () => {
        bot.acceptResourcePack();
    });
    bot.once('login', () => useGameData(bot.registry));

    return bot;
}
