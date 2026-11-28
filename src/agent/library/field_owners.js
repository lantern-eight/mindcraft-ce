// SPDX-License-Identifier: CC0-1.0
// Where !recall asks whose a remembered field is.
//
// World memory remembers fields (what grows where, how much was ripe) but not whose they are: that is what
// farming's field book was told. A module can install, for a bot, a way to say whose a remembered field is;
// farming installs one that asks its field book. With nothing installed, !recall says nothing of owners.
// It lives here, between the two, so that neither module needs the other to be on.

const owners = new WeakMap(); // bot -> (field: {min, max}) => string|null

/**
 * Installs the way for one bot, or removes it with null.
 * @param {object} bot
 * @param {((field: {min: {x,y,z}, max: {x,y,z}}) => string|null)|null} way - a few words on whose the field
 *   whose crops span this box is ("Alex's field"), or null when nobody has said
 */
export function setFieldOwners(bot, way) {
    if (way) owners.set(bot, way);
    else owners.delete(bot);
}

/** The way installed for this bot, or one that knows nothing. */
export function fieldOwnersOf(bot) {
    return owners.get(bot) ?? (() => null);
}
