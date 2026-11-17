// SPDX-License-Identifier: CC0-1.0
// Keeps model-written code working on a Bedrock bot.
//
// Code the model writes (`!newAction`, and fair play's code runner) runs in an SES sandbox, and the first
// run calls SES `lockdown()`, which freezes JavaScript's built-in objects and strips anything it doesn't
// know from them. On Java that works. A current Bedrock server is reached over NetherNet, whose encrypted
// channel (DTLS, in the `werift` library) loads `@peculiar/x509`, which loads `reflect-metadata`. That
// library adds functions to the global `Reflect`, which SES can strip, and one property keyed by a symbol
// that it makes impossible to delete. SES can't strip that one, and `lockdown()` throws. So on Bedrock
// every piece of model-written code failed, with fair play or without.
//
// This loads `reflect-metadata` before the connection does, the same copy the connection would load, and
// leaves that one property deletable. Everything else about the library is as it was. When `lockdown()`
// runs later it strips the library's additions with a warning for each, as it does for anything unknown.
// The library keeps what it needs in its own closure, and the code that uses it has finished with the
// global functions by then: checked live, a bot stays connected through `lockdown()`, and a second bot
// connects after it.
//
// This is a clash between two libraries that each work as designed, not a mistake in either, so it stays
// until one of them changes. `reflect-metadata` makes the property undeletable on purpose, so that every
// copy of the library shares one registry; its `no-conflict` entry, made for SES, still puts it on the
// global `Reflect`. SES removes what it doesn't know from the built-in objects on purpose, and won't leave
// an undeletable one behind, since anything left there is shared by all sandboxed code. Neither has an
// option to change that.
//
// connect.js calls it as it starts a Bedrock bot, before the bot connects; never for a Java bot, whose
// libraries don't load `reflect-metadata` at all. If the libraries are ever installed without this chain
// (a newer NetherNet that doesn't use them), there is nothing to do and it does nothing.
import { createRequire } from 'node:module';

// How the connection reaches `reflect-metadata`: each package is looked up from the one before it, so the
// copy loaded here is the one the connection gets, however npm has nested them.
const CHAIN = ['mineflayer', 'bedrock-protocol', 'nethernet', 'werift', '@peculiar/x509', 'reflect-metadata'];

// Where reflect-metadata keeps its registry on `Reflect`, shared between copies of the library.
const REGISTRY = Symbol.for('@reflect-metadata:registry');

/** The path of the copy of `reflect-metadata` the Bedrock connection would load, or null if it has none. */
export function reflectMetadataPath(from = import.meta.url) {
    try {
        let at = from;
        for (const name of CHAIN) at = createRequire(at).resolve(name);
        return at;
    } catch {
        return null;
    }
}

/**
 * Load `reflect-metadata` with its registry left deletable. Returns true when it was loaded here, false
 * when there was nothing to load or something else loaded it first.
 */
export function loadReflectMetadataForLockdown(path = reflectMetadataPath()) {
    if (!path || Object.prototype.hasOwnProperty.call(Reflect, REGISTRY)) return false;
    const define = Object.defineProperty;
    // Only the one property is changed, and only while the library loads.
    Object.defineProperty = (target, key, descriptor) =>
        define(target, key, target === Reflect && key === REGISTRY ? { ...descriptor, configurable: true } : descriptor);
    try {
        createRequire(import.meta.url)(path);
    } finally {
        Object.defineProperty = define;
    }
    return true;
}
