// SPDX-License-Identifier: CC0-1.0
// The edition seam: the few things this fork's modules read below mineflayer's `bot`, asked for by name.
//
// mineflayer hands out the same `bot` whichever game it is talking to, but a few things this fork reads
// are shaped by the game itself, not by mineflayer: how the states of blocks are numbered, how a chunk
// section lists the blocks it holds, which sounds and permissions the server sends, where the other half
// of a double chest is kept, and how a stack is moved in an open chest. Fair play, world memory and chest
// sorting ask for those here instead of reaching for the shapes themselves, so code written for one game
// doesn't quietly read another game's data wrong.
//
// This file only picks the answers that apply. java.js has the answers for Java Edition. Another edition
// of the game registers its own with registerEdition, under the type its game data gives
// (`registry.version.type`), and nothing that asks has to change.
import { javaEdition } from './java.js';

const editions = new Map([['pc', javaEdition]]); // minecraft-data calls Java Edition "pc"

/**
 * Makes an edition's answers available.
 * @param {string} type - the edition's `version.type` in its game data
 * @param {object} edition - the same functions java.js offers
 */
export function registerEdition(type, edition) {
    editions.set(type, edition);
}

/**
 * The answers for the game a registry (or plain game data) describes.
 *
 * Game data built by hand, as in unit tests, often has no version; it is taken to be Java's, the game
 * this code was written for. A game whose answers have not been registered is an error, not a guess:
 * Java's answers on another game's data come out silently wrong.
 */
export function editionOf(registry) {
    const type = registry?.version?.type ?? 'pc';
    const edition = editions.get(type);
    if (!edition) throw new Error(`No support for the "${type}" edition of Minecraft is loaded.`);
    return edition;
}
