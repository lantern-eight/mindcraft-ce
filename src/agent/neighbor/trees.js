// SPDX-License-Identifier: CC0-1.0
// Is this log part of a tree, or a beam in someone's cabin?
//
// Logs are the one block a player both gathers from the wild and builds with as it is. A player tells
// them apart at a glance: a tree stands bare, its trunk running up into leaves; a cabin's logs touch
// planks, glass, a door, a torch. This does the same, from what the bot knows of the cells around the log
// (the reader it is handed; under fair play that is what the bot sees and remembers, never the raw world).
//
// A log is part of a tree when the logs of its kind joined to it (touching, corners included):
//   - touch only what a world puts by a trunk: air, water, leaves, the ground, vines, cocoa, a bee nest;
//   - and touch grown leaves (or a Nether fungus's wart blocks) in at least a few places above the lowest log.
// There is no test of the ground under the trunk, so a trunk the bot has started felling is still a tree.
// The idea of a bare trunk running into a canopy is nengoxx's (`src/agent/work/protect.js`, MIT); keeping
// a tree a tree while it is felled is LarsHamb's (`natural_tree.js`). Neither's code is used here.
//
// A tree once recognized stays one for the session, log by log: after its lowest logs are cut, its
// leaves start to fall, and the bot must still be able to finish it. A "not a tree" is kept only a few
// seconds, since it may only mean the bot hasn't seen the canopy yet; once it looks up, it is a tree.
import { besideTrees, isCanopy, isEmpty } from './natural.js';

const MAX_LOGS = 160;        // a giant 2x2 spruce or jungle tree, branches included, stays under this
const MIN_LEAVES = 3;        // leaves touching the trunk before it counts as having a canopy
const NO_KEPT_MS = 5000;
const MAX_KEPT = 20000;      // cells remembered as tree or not before the lists are started afresh

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * @param {object} options
 * @param {(x: number, y: number, z: number) => ({name: string, placedLeaves?: boolean|null}|null)} options.read -
 *   what the bot knows at a cell, by Java name, or null when it knows nothing there. `placedLeaves` is true
 *   for leaves a player placed, false for grown ones, null when it can't be told (only remembered)
 * @param {(x: number, y: number, z: number) => boolean} [options.own] - was the block at this cell the bot's own
 *   doing? Its crafting table or torch beside a tree doesn't make the tree a cabin
 * @param {() => number} [options.now]
 * @returns {{isTree: (x: number, y: number, z: number, name: string) => boolean}}
 */
export function createTreeJudge({ read, own = () => false, now = Date.now }) {
    const trees = new Set();        // logs known to be part of a tree, for the session
    const notTrees = new Map();     // log -> when it was found not to be part of one

    function judge(x, y, z, name) {
        const logs = [[x, y, z]];
        const seen = new Set([key(x, y, z)]);
        let leaves = 0, minY = y, bare = true;
        const canopy = [];
        for (let i = 0; i < logs.length && bare; i++) {
            const [lx, ly, lz] = logs[i];
            for (let dx = -1; dx <= 1 && bare; dx++) for (let dy = -1; dy <= 1 && bare; dy++) for (let dz = -1; dz <= 1; dz++) {
                if (!dx && !dy && !dz) continue;
                const nx = lx + dx, ny = ly + dy, nz = lz + dz;
                const k = key(nx, ny, nz);
                if (seen.has(k)) continue;
                seen.add(k);
                const block = read(nx, ny, nz);
                if (!block) continue; // not known: says nothing either way
                if (block.name === name) {
                    if (logs.length >= MAX_LOGS) { bare = false; break; }
                    logs.push([nx, ny, nz]);
                    minY = Math.min(minY, ny);
                    continue;
                }
                if (isCanopy(block.name)) {
                    if (block.placedLeaves !== true) canopy.push(ny);
                    continue;
                }
                // Another kind of log beside it is two trees growing close, as in any forest.
                if (block.name.endsWith('_log') || isEmpty(block.name) || besideTrees(block.name) || own(nx, ny, nz)) continue;
                bare = false;
                break;
            }
        }
        if (bare) leaves = canopy.filter(at => at > minY).length;
        return { tree: bare && leaves >= MIN_LEAVES, logs };
    }

    return {
        isTree(x, y, z, name) {
            const k = key(x, y, z);
            if (trees.has(k)) return true;
            const no = notTrees.get(k);
            if (no !== undefined && now() - no < NO_KEPT_MS) return false;
            if (trees.size > MAX_KEPT) trees.clear();
            if (notTrees.size > MAX_KEPT) notTrees.clear();
            const { tree, logs } = judge(x, y, z, name);
            // Every log found was judged along with this one.
            const t = now();
            for (const [lx, ly, lz] of logs) {
                if (tree) { trees.add(key(lx, ly, lz)); notTrees.delete(key(lx, ly, lz)); }
                else notTrees.set(key(lx, ly, lz), t);
            }
            return tree;
        },
    };
}
