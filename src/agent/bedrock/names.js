// SPDX-License-Identifier: CC0-1.0
// Bedrock's names for blocks and their states, in Java Edition's terms, for world memory's kinds.js.
//
// kinds.js decides what a block is (a door, a bed, a crop that is ripe) from Java's names and properties.
// Bedrock names some blocks differently (`wooden_door`, `bed`, `mob_spawner`, `beetroot`) and describes
// every state with other properties (a door's top half is `upper_block_bit=1`, a crop's age is `growth`).
// World memory keeps Bedrock's names, which are the ones the rest of a Bedrock bot uses; this only answers
// kinds.js, which is handed the translation when a Bedrock bot starts (connect.js).
//
// The game data has a table from every Bedrock block state to the Java state it stands for. That table
// fills in what Bedrock doesn't say: every Bedrock bed comes out black, since its color is kept elsewhere,
// and every Bedrock chest comes out as the right half of a double chest, since Bedrock pairs chests
// elsewhere too. Taken at its word, memory would pair every chest with a neighbour that isn't there. So a
// Java property that comes out the same for every state of a Bedrock block is left out: it was filled in,
// not translated. The name still says what kind of thing the block is, which is all kinds.js reads it for.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// "minecraft:wooden_door[open_bit=1,upper_block_bit=0]" -> { name: 'wooden_door', props: { open_bit: '1', ... } }
function parseState(text) {
    const match = /^(?:minecraft:)?([^[]+)(?:\[(.*)\])?$/.exec(text);
    if (!match) return null;
    const props = {};
    for (const pair of (match[2] ?? '').split(',')) {
        if (!pair) continue;
        const at = pair.indexOf('=');
        props[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return { name: match[1], props };
}

// One way to write a block state, whatever order its properties come in: Bedrock's table lists them
// sorted by name. Flags are kept as 1 and 0, as Bedrock writes them.
const valueText = value => (typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
const stateKey = (name, props) => `${name}[${Object.keys(props).sort().map(key => `${key}=${valueText(props[key])}`).join(',')}]`;

/**
 * The translation for kinds.js (see translateNamesWith there), built from a table of Bedrock states to
 * Java states as the game data has it.
 *
 * @param {Object<string, string>} table - Bedrock state -> Java state, both written "minecraft:name[a=1,b=x]"
 * @returns {(name: string, state?: object|null) => {name: string, state: object|null}|null} null for a
 *   name the table doesn't have
 */
export function bedrockToJava(table) {
    const names = new Map();   // Bedrock name -> the Java name of its first state in the table
    const states = new Map();  // Bedrock state, as stateKey writes it -> Java state
    const seen = new Map();    // Bedrock name -> Java property -> the values it comes out as
    for (const [bedrockText, javaText] of Object.entries(table)) {
        const bedrock = parseState(bedrockText), java = parseState(javaText);
        if (!bedrock || !java) continue;
        if (!names.has(bedrock.name)) names.set(bedrock.name, java.name);
        states.set(stateKey(bedrock.name, bedrock.props), java);
        let values = seen.get(bedrock.name);
        if (!values) seen.set(bedrock.name, values = new Map());
        for (const [key, value] of Object.entries(java.props)) {
            if (!values.has(key)) values.set(key, new Set());
            values.get(key).add(value);
        }
    }
    // Only properties that change with the Bedrock state were translated; the rest were filled in.
    const translated = new Map([...seen].map(([name, values]) =>
        [name, new Set([...values].filter(([, found]) => found.size > 1).map(([key]) => key))]));

    return (name, state) => {
        const javaName = names.get(name);
        if (!javaName) return null;
        if (!state) return { name: javaName, state: state ?? null };
        const java = states.get(stateKey(name, state));
        if (!java) return { name: javaName, state: null }; // a state the table doesn't have: no guessing
        const keep = translated.get(name);
        return { name: java.name, state: Object.fromEntries(Object.entries(java.props).filter(([key]) => keep.has(key))) };
    };
}

/**
 * The translation for a Bedrock version's game data, or null when the installed game data has no table
 * for it. The table comes with minecraft-data, which points each Bedrock version at the newest table it has.
 */
export function bedrockNamesFor(version) {
    const table = require('minecraft-data/data.js').bedrock?.[version]?.blocksB2J;
    return table ? bedrockToJava(table) : null;
}
