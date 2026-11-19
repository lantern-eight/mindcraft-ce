// SPDX-License-Identifier: CC0-1.0
// The model's way to the standing orders (orders.js), and where the ones it gives are kept.
//
//   !threatRules                                   the orders in force, and the groups an order can name
//   !setThreatRule(mobs, order, min_health, distance)  gives an order, or clears one with "default"
//
// A player says "don't run from zombies, fight them"; the model turns that into one command, and from then
// on the reflexes apply it the moment a zombie comes, without asking the model again. The order is kept in
// the bot's own folder, so it outlasts a restart, on top of whatever the profile's `threat_rules` say.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { ALL, GROUPS, STANCES, describe, FLOOR_HEALTH, DEFAULT_MIN_HEALTH } from './orders.js';

const FILE = 'threat_rules.json';

/** What was set by command for this bot, or nothing when there is no file or it can't be read. */
export function loadSavedOrders(dir, { warn = () => {} } = {}) {
    const file = path.join(dir, FILE);
    if (!existsSync(file)) return {};
    try {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (error) {
        warn(`Could not read the standing orders in ${FILE}: ${error.message}`);
        return {};
    }
}

/** Keeps what was set by command, for the next start. */
export function saveOrders(dir, saved, { warn = () => {} } = {}) {
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, FILE), JSON.stringify(saved, null, 2));
    } catch (error) {
        warn(`Could not keep the standing orders: ${error.message}`);
    }
}

const GROUP_LIST = Object.entries(GROUPS).map(([group, names]) => `${group} (${[...new Set(names)].join(', ')})`).join('; ');

// The orders of the agent a command is run for. Commands are shared by every agent in the process, so
// they find the orders through the agent they are given, not through the one that registered them.
const ordersOf = agent => agent.threatReflexes?.orders ?? null;
const OFF = 'The threat reflexes are off, so there are no standing orders.';

/**
 * @returns {{command: object, action: boolean}[]}
 */
export function orderCommands() {
    return [
        {
            action: false,
            command: {
                name: '!threatRules',
                description: 'List your standing orders about hostile mobs: which you fight, back away from or ignore on your own, without being asked each time.',
                perform: async function (agent) {
                    if (!ordersOf(agent)) return OFF;
                    const list = ordersOf(agent).list();
                    const lines = list.length
                        ? list.map(order => `- ${describe(order.target, order)}${order.from === 'profile' ? ' [from your profile]' : ''}`)
                        : ['- none: you go by your own judgment with every mob'];
                    return ['Standing orders:', ...lines,
                        `Under ${FLOOR_HEALTH} health you run from every mob, whatever the orders. Mobs without an order: you fight one at a time when fit, and back away from crowds and strong mobs.`,
                        `Groups: ${GROUP_LIST}. "${ALL}" is every hostile mob but creepers.`].join('\n');
                },
            },
        },
        {
            action: false,
            command: {
                name: '!setThreatRule',
                description: 'Give yourself a standing order about a kind of hostile mob, applied at once by your reflexes whenever one comes, and kept. '
                    + 'Use it when a player tells you how to deal with a mob, e.g. "fight zombies" or "don\'t fight spiders, run". '
                    + `Orders: ${STANCES.join(', ')}, or default to clear one. Creepers take fight (hit and step back) and flee only.`,
                params: {
                    mobs: { type: 'string', description: `A mob name (zombie), a group (${Object.keys(GROUPS).join(', ')}), or "${ALL}" for every hostile mob but creepers.` },
                    order: { type: 'string', description: `One of ${STANCES.join(', ')}, or default.` },
                    min_health: { type: 'int', description: `Under this health the order lapses and you go by your own judgment (${FLOOR_HEALTH} to 20; 0 for ${DEFAULT_MIN_HEALTH}).`, domain: [0, 21] },
                    distance: { type: 'int', description: 'For flee: how many blocks to back away to (8 to 48; 0 for the usual).', domain: [0, 49] },
                },
                perform: async function (agent, mobs, order, min_health, distance) {
                    if (!ordersOf(agent)) return OFF;
                    return ordersOf(agent).give(mobs, order, { min_health, distance }).text;
                },
            },
        },
    ];
}
