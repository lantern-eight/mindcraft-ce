// SPDX-License-Identifier: CC0-1.0
// Giving a Bedrock bot the shapes the rest of the code expects.
//
// mineflayer's Bedrock adapter offers the same `bot` as on Java, but here and there what a call hands
// back has another shape. The skills and this fork's modules are written against the Java shape, and
// there is one copy of them for both editions. So the difference is evened out here, once, on the bot
// itself, instead of in every caller.
//
// Only differences in shape belong in this file. Something that is plainly a mistake in the adapter is
// fixed in the adapter; something Bedrock can't do at all is listed in docs/bedrock.md.
//
// This is a mineflayer plugin: load it after the bot is created and it runs once the adapter's own
// plugins are in place.

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// How long a chest gets to open. The adapter waits three seconds for the same thing.
const OPEN_TIMEOUT_MS = 5000;

/**
 * Chests, barrels and the like.
 *
 * On Java, opening one hands back the window with `deposit`, `withdraw` and `close` on it:
 *
 *     const chest = await bot.openContainer(block);
 *     await chest.deposit(item.type, null, 3);
 *     chest.close();
 *
 * On Bedrock the adapter's `openContainer` only clicks the block and hands back nothing. The window
 * arrives a moment later as `bot.currentWindow`, and moving items is done by calls on the bot. After this,
 * `openContainer`, `openChest` and `openBlock` all wait for the window and hand it back with those three
 * calls on it.
 *
 * As on Java, the first two go through `bot.openBlock`, looked up when they are called. World memory
 * wraps `bot.openBlock` to note what was in a chest, and that one wrapper has to see every way in.
 */
function chestsLikeJava(bot) {
    if (typeof bot.openContainer !== 'function') return; // an adapter without containers: nothing to shape
    const click = bot.openContainer.bind(bot);

    // The adapter itself calls bot.openContainer and then watches for the window in its own way, without
    // waiting for what the call hands back. A promise that fails with nobody waiting on it stops Node, so
    // every promise handed out here is given a listener of its own. A caller that does wait still gets
    // the failure.
    const neverUnheard = promise => {
        promise.catch(() => {});
        return promise;
    };

    async function openAndWait(block) {
        const before = bot.currentWindow;
        click(block);
        const deadline = Date.now() + OPEN_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const window = bot.currentWindow;
            if (window && window !== before) return withHands(window);
            await delay(50);
        }
        throw new Error(`The ${block?.name ?? 'container'} did not open`);
    }

    function withHands(window) {
        // A crafting table or a furnace opens a window too, and the adapter has its own calls for those.
        // These three are added to whatever opened and are simply not used there.
        if (typeof window.deposit !== 'function') window.deposit = (itemType, metadata, count) => bot.deposit(itemType, metadata ?? null, count ?? null);
        if (typeof window.withdraw !== 'function') window.withdraw = (itemType, metadata, count) => bot.withdraw(itemType, metadata ?? null, count ?? null);
        if (typeof window.close !== 'function') window.close = () => { if (bot.currentWindow === window) bot.closeWindow(window); };
        return window;
    }

    bot.openBlock = block => neverUnheard(openAndWait(block));
    bot.openContainer = block => neverUnheard(Promise.resolve().then(() => bot.openBlock(block)));
    bot.openChest = bot.openContainer;
}

/** The plugin. Each shape is its own function above, so the list of what is evened out stays readable. */
export function javaShapes(bot) {
    chestsLikeJava(bot);
}
