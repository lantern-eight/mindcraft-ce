// SPDX-License-Identifier: CC0-1.0
// Block states by name. The game gives every state of every block a number (an oak door that is open,
// faces north and is the upper half is one number), and those numbers change with every game version.
// Memory keeps the properties by name instead, so a saved world stays readable. These two functions
// turn a number into named properties and back, using the block list of the game version in use.
//
// How a number is made up depends on the edition of the game, so the work is done by the edition seam
// (src/agent/edition/). Memory keeps the properties under the names the edition in use gives them.
import { editionOf } from '../edition/index.js';

/**
 * The named properties of a block state, such as { facing: 'north', open: 'true' }, or null for a block
 * with no properties. Every value is a string.
 */
export function propsOfState(registry, stateId) {
    return editionOf(registry).propsOfState(registry, stateId);
}

/**
 * The state number for a block name with the given properties, under this game version. A property the
 * block no longer has is ignored, and one that is missing or has an unknown value keeps the block's
 * default, so memory saved under an older game version still gives a sensible block. Null when the
 * block name itself is unknown.
 */
export function stateOfProps(registry, name, props) {
    return editionOf(registry).stateOfProps(registry, name, props);
}
