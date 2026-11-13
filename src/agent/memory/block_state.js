// SPDX-License-Identifier: CC0-1.0
// Block states by name. The game gives every state of every block a number (an oak door that is open,
// faces north and is the upper half is one number), and those numbers change with every game version.
// Memory keeps the properties by name instead, so a saved world stays readable. These two functions
// turn a number into named properties and back, using the block list of the game version in use.

const valuesOf = property => property.values
    ?? (property.type === 'bool' ? ['true', 'false'] : Array.from({ length: property.num_values }, (_, i) => String(i)));

/**
 * The named properties of a block state, such as { facing: 'north', open: 'true' }, or null for a block
 * with no properties. Every value is a string.
 */
export function propsOfState(registry, stateId) {
    const block = registry.blocksByStateId[stateId];
    if (!block?.states?.length) return null;
    // A state number is the block's first number plus an offset that packs one digit per property,
    // the last property in the lowest place.
    let rest = stateId - block.minStateId;
    const props = {};
    for (let i = block.states.length - 1; i >= 0; i--) {
        const property = block.states[i];
        props[property.name] = valuesOf(property)[rest % property.num_values];
        rest = Math.floor(rest / property.num_values);
    }
    return props;
}

/**
 * The state number for a block name with the given properties, under this game version. A property the
 * block no longer has is ignored, and one that is missing or has an unknown value keeps the block's
 * default, so memory saved under an older game version still gives a sensible block. Null when the
 * block name itself is unknown.
 */
export function stateOfProps(registry, name, props) {
    const block = registry.blocksByName[name];
    if (!block) return null;
    const base = block.defaultState ?? block.minStateId;
    const states = block.states ?? [];
    if (!props || !states.length) return base;
    const digits = [];
    let rest = base - block.minStateId;
    for (let i = states.length - 1; i >= 0; i--) {
        digits[i] = rest % states[i].num_values;
        rest = Math.floor(rest / states[i].num_values);
    }
    let offset = 0;
    states.forEach((property, i) => {
        const wanted = props[property.name] === undefined ? -1 : valuesOf(property).indexOf(String(props[property.name]));
        offset = offset * property.num_values + (wanted >= 0 ? wanted : digits[i]);
    });
    return block.minStateId + offset;
}
