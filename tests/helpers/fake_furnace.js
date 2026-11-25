// SPDX-License-Identifier: CC0-1.0
// A small world of furnaces for the smelting tests: a bot with an inventory, furnaces that burn fuel and
// smelt by game ticks, and a clock that only moves when the code under test sleeps. So a smelt of 130
// items, which takes over twenty minutes in the game, runs in a moment, and every wait is exact.
//
// The furnaces follow the game's rules closely enough for what smelting decides: an item takes 200 ticks,
// coal burns 1600 and a plank or a log 300, fuel is used only while there is something to smelt, the
// output holds one stack, and a furnace is lit while its last piece of fuel still burns.
import { Vec3 } from 'vec3';
import { productOf } from '../../src/agent/smelting/recipes.js';

const BURN_TICKS = { coal: 1600, charcoal: 1600, oak_planks: 300, spruce_planks: 300, oak_log: 300, coal_block: 16000, lava_bucket: 20000 };
const TICK_MS = 50;
const ITEM_TICKS = 200;

const key = pos => `${pos.x},${pos.y},${pos.z}`;
const stack = (name, count) => (count > 0 ? { name, count } : null);

/**
 * @param {object} options
 * @param {Object<string, number>} options.inventory - what the bot carries
 * @param {{at: number[], input?: object, fuel?: object, output?: object, neverOpens?: boolean}[]} [options.furnaces]
 * @param {number[][]} [options.lavaCauldrons] - full lava cauldrons (Java's `lava_cauldron`)
 * @param {number[]} [options.botAt]
 */
export function fakeFurnaceWorld({ inventory = {}, furnaces = [], lavaCauldrons = [], botAt = [0, 64, 0] } = {}) {
    const cauldrons = new Map(lavaCauldrons.map(at => [key(new Vec3(...at)), { position: new Vec3(...at), lava: true }]));
    let held = null;
    let clock = 0;
    const bag = { ...inventory };
    const logs = [];
    const placed = new Map(); // key -> furnace
    const events = [];

    const makeFurnace = ({ at, input = null, fuel = null, output = null, neverOpens = false, throwOnPut = false }) => ({
        position: new Vec3(...at), slots: [input, fuel, output], burn: 0, progress: 0, neverOpens, throwOnPut,
    });
    for (const spec of furnaces) { const f = makeFurnace(spec); placed.set(key(f.position), f); }

    const add = (name, count) => { bag[name] = (bag[name] ?? 0) + count; if (bag[name] <= 0) delete bag[name]; };

    function tickFurnace(f) {
        const [input, fuel, output] = f.slots;
        const product = input ? productOf(input.name) : null;
        const canOutput = input && (!output || (output.name === product && output.count < 64));
        if (f.burn <= 0 && canOutput && fuel) {
            f.burn = BURN_TICKS[fuel.name] ?? 300;
            // A bucket of lava leaves its empty bucket in the slot as it catches.
            f.slots[1] = fuel.name === 'lava_bucket' ? stack('bucket', 1) : stack(fuel.name, fuel.count - 1);
        }
        if (f.burn > 0) {
            f.burn--;
            if (canOutput) {
                f.progress++;
                if (f.progress >= ITEM_TICKS) {
                    f.progress = 0;
                    f.slots[0] = stack(input.name, input.count - 1);
                    f.slots[2] = stack(product, (output?.count ?? 0) + 1);
                }
            } else f.progress = 0;
        } else f.progress = 0;
    }

    const advance = ms => {
        const ticks = Math.floor((clock + ms) / TICK_MS) - Math.floor(clock / TICK_MS);
        clock += ms;
        for (let i = 0; i < ticks; i++) for (const f of placed.values()) tickFurnace(f);
    };

    const blockOf = f => ({ name: 'furnace', position: f.position.clone(), boundingBox: 'block', getProperties: () => ({ lit: f.burn > 0 }) });

    const bot = {
        registry: { itemsByName: new Proxy({}, { get: (_, name) => ({ id: name }) }) },
        entity: { position: new Vec3(...botAt), eyeHeight: 1.62 },
        inventory: { items: () => Object.entries(bag).map(([name, count]) => ({ name, count })) },
        currentWindow: null,
        interrupt_code: false,
        modes: { pause: () => {} },
        async lookAt() {},
        async equip(item) { held = item?.name ?? null; },
        async activateBlock(block) {
            const c = cauldrons.get(key(block.position));
            if (!c?.lava || held !== 'bucket' || !(bag.bucket > 0)) return;
            add('bucket', -1);
            add('lava_bucket', 1);
            c.lava = false;
            held = 'lava_bucket';
        },
        closeWindow(window) { if (bot.currentWindow === window) bot.currentWindow = null; events.push('close'); },
        openFurnace(block) {
            const f = placed.get(key(block.position));
            if (!f) return Promise.reject(new Error('no furnace there'));
            events.push(`open ${key(block.position)}`);
            if (f.neverOpens) return new Promise(() => {});
            const window = {
                get slots() { return f.slots; },
                async putInput(name, _m, count) { return put(0, name, count); },
                async putFuel(name, _m, count) { return put(1, name, count); },
                async takeInput() { return take(0); },
                async takeFuel() { return take(1); },
                async takeOutput() { return take(2); },
            };
            function put(slot, name, count) {
                if (f.throwOnPut) throw new Error('the server lagged');
                const have = bag[name] ?? 0;
                const now = f.slots[slot];
                const moved = Math.min(count, have, 64 - (now?.count ?? 0));
                if (moved <= 0) return;
                add(name, -moved);
                f.slots[slot] = stack(name, (now?.count ?? 0) + moved);
            }
            function take(slot) {
                const item = f.slots[slot];
                if (!item) return null;
                add(item.name, item.count);
                f.slots[slot] = null;
                return item;
            }
            bot.currentWindow = window;
            return Promise.resolve(window);
        },
    };

    const cauldronBlock = c => ({ name: c.lava ? 'lava_cauldron' : 'cauldron', position: c.position.clone(), boundingBox: 'block', getProperties: () => ({}) });
    const blockAt = (_bot, pos) => {
        const f = placed.get(key(pos));
        if (f) return blockOf(f);
        const c = cauldrons.get(key(pos));
        if (c) return cauldronBlock(c);
        // Flat ground: solid below y 64, air from 64 up.
        return { name: pos.y < 64 ? 'stone' : 'air', position: new Vec3(pos.x, pos.y, pos.z), boundingBox: pos.y < 64 ? 'block' : 'empty' };
    };

    const world = {
        getInventoryCounts: () => ({ ...bag }),
        getNearestBlocksWhere(_bot, predicate, range, count) {
            const from = bot.entity.position;
            if (predicate({ name: 'air' })) {
                const cells = [];
                for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
                    const p = from.floored().offset(dx, 0, dz);
                    if (!placed.has(key(p))) cells.push(blockAt(bot, p));
                }
                return cells.sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from)).slice(0, count);
            }
            return [...[...placed.values()].map(blockOf), ...[...cauldrons.values()].map(cauldronBlock)].filter(predicate)
                .filter(b => b.position.distanceTo(from) <= range)
                .sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from)).slice(0, count);
        },
    };

    const skills = {
        log: (_bot, text) => logs.push(text),
        async goToPosition(_bot, x, y, z) { bot.entity.position = new Vec3(x + 1.5, y, z + 0.5); return true; },
        async placeBlock(_bot, name, x, y, z) {
            if (name !== 'furnace' || !(bag.furnace > 0)) return false;
            add('furnace', -1);
            const f = makeFurnace({ at: [x, y, z] });
            placed.set(key(f.position), f);
            return true;
        },
        async breakBlockAt(_bot, x, y, z) {
            const k = key({ x, y, z });
            if (!placed.has(k) || !Object.keys(bag).some(name => name.endsWith('_pickaxe'))) return false;
            placed.delete(k);
            add('furnace', 1);
            return true;
        },
        async pickupNearbyItems() { return true; },
        async craftRecipe(_bot, name, times) {
            const log = name.replace(/_planks$/, '_log');
            if (!(bag[log] >= times)) return false;
            add(log, -times);
            add(name, 4 * times);
            return true;
        },
    };

    return {
        bot, world, skills, blockAt, logs, events, bag,
        furnaceAt: (...at) => placed.get(key(new Vec3(...at))),
        cauldronAt: (...at) => cauldrons.get(key(new Vec3(...at))),
        now: () => clock,
        sleep: async ms => { advance(ms); await Promise.resolve(); },
        advance,
    };
}
