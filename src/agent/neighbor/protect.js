// SPDX-License-Identifier: CC0-1.0
// The protection rule: may the bot break this block, or is it someone's?
//
// A block is someone's unless something says it is free to break. In this order:
//   1. the bot put it there itself: free (its scaffolding, its crafting table);
//   2. it is inside a protected area from the settings: someone's, whatever it is;
//   3. world memory saw it turn up where there had been empty space, or in place of another block, with
//      nobody but someone else to have put it there: someone's, even dirt (a tunnel walled off);
//   4. a log: free only as part of a natural tree (trees.js); leaves: free unless placed by hand;
//   5. natural terrain by name (natural.js): free. Anything else (planks, glass, cobblestone, a rail) was made
//      by someone: theirs.
// Logs and leaves skip rule 3: a sapling grows into a tree where there was air, and that tree is the
// world's. The tree test judges them instead.
//
// The rule only ever forbids. It reads the world through the reader it is handed, which under fair play is
// what the bot sees and remembers, so it can make the bot more careful than a player but never better
// informed. It decides nothing else: where it is enforced is enforce.js.
import { isCanopy, isEmpty, isNaturalTerrain, isTrunk } from './natural.js';
import { createTreeJudge } from './trees.js';

const FLUIDS = new Set(['water', 'lava', 'bubble_column']);

/** A protected area from the settings, checked, or null when it can't be used. */
export function compileArea(area) {
    if (!area || typeof area !== 'object') return null;
    const name = typeof area.name === 'string' && area.name ? area.name : 'protected area';
    const dimension = typeof area.dimension === 'string' ? area.dimension.replace('minecraft:', '') : null;
    const finite = (...values) => values.every(Number.isFinite);
    if (area.min && area.max && finite(area.min.x, area.min.y, area.min.z, area.max.x, area.max.y, area.max.z)) {
        const lo = axis => Math.min(area.min[axis], area.max[axis]), hi = axis => Math.max(area.min[axis], area.max[axis]);
        const [x0, y0, z0, x1, y1, z1] = [lo('x'), lo('y'), lo('z'), hi('x'), hi('y'), hi('z')];
        return { name, dimension, contains: p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1 };
    }
    if (finite(area.x, area.z, area.radius) && area.radius > 0) {
        const r2 = area.radius * area.radius;
        return { name, dimension, contains: p => (p.x + 0.5 - area.x) ** 2 + (p.z + 0.5 - area.z) ** 2 <= r2 };
    }
    return null;
}

/**
 * @param {object} options
 * @param {(x: number, y: number, z: number) => ({name: string, placedLeaves?: boolean|null}|null)} options.read -
 *   what the bot knows at a cell, by Java name (see trees.js)
 * @param {(name: string) => string} [options.javaName] - a block's name in Java's terms
 * @param {(x: number, y: number, z: number) => string|null} [options.tagOf] - world memory's tag for a cell:
 *   'placed', 'dug', 'built' or null. Without world memory, nothing is known built
 * @param {(x: number, y: number, z: number) => boolean} [options.placedNow] - placed by the bot this session
 * @param {(stateId: number) => boolean} [options.leavesPersist] - were these leaves placed by hand (the edition seam)
 * @param {object[]} [options.areas] - protected areas, from compileArea
 * @param {() => string} [options.dimension] - the dimension the bot is in
 * @param {() => number} [options.now]
 * @param {(x: number, y: number, z: number) => string|null} [options.grantedBy] - the player who let the bot break
 *   this cell (grants.js), or null. A granted cell may be broken, whatever else holds
 * @returns {{refusal: (block: object) => ({why: string, text: string, hint?: string}|null), isTree: function,
 *   permit: (fn: function) => () => void}} `permit` adds another module's say (see `refusal`), and returns its removal
 */
export function createProtector({ read, javaName = name => name, tagOf = () => null, placedNow = () => false,
    leavesPersist = () => false, areas = [], dimension = () => 'overworld', now = Date.now, grantedBy = () => null }) {
    const mine = (x, y, z) => placedNow(x, y, z) || tagOf(x, y, z) === 'placed';
    const trees = createTreeJudge({ read, own: mine, now });
    // Other modules' say over blocks they know more about (farming, over the crops of fields the bot may tend).
    // Each is asked `{x, y, z, name}` and answers `{ok: true}` to let the bot break it, `{hint}` to add advice to
    // a refusal, or null. A permit can only free a block: it is asked after protected areas, which stay absolute.
    const permits = new Set();

    /**
     * Why the bot may not break this block, or null when it may.
     * @param {{name: string, position: {x,y,z}, stateId?: number, rememberedAt?: number}} block
     */
    function refusal(block) {
        if (!block?.name || !block.position) return null;
        const name = javaName(block.name);
        if (isEmpty(name) || FLUIDS.has(name)) return null;
        const x = Math.floor(block.position.x), y = Math.floor(block.position.y), z = Math.floor(block.position.z);
        // A player let the bot break this very block: that comes before every other rule, protected areas too.
        if (grantedBy(x, y, z)) return null;
        if (mine(x, y, z)) return null;
        const here = String(dimension() ?? 'overworld').replace('minecraft:', '');
        const area = areas.find(a => (!a.dimension || a.dimension === here) && a.contains({ x, y, z }));
        if (area) return { why: 'area', text: `it is inside the protected area "${area.name}"` };
        let hint = null;
        for (const permit of permits) {
            const say = permit({ x, y, z, name });
            if (say?.ok) return null;
            if (say?.hint) hint ??= say.hint;
        }
        const reason = rule(x, y, z, name, block);
        return reason && hint ? { ...reason, hint } : reason;
    }

    /** The rule itself, for a block no permit freed: why it is someone's, or null. */
    function rule(x, y, z, name, block) {
        const trunk = isTrunk(name), canopy = isCanopy(name);
        if (!trunk && !canopy && tagOf(x, y, z) === 'built') return { why: 'built', text: `I saw someone put it there` };
        if (trunk) return trees.isTree(x, y, z, name) ? null : { why: 'not a tree', text: `it is not part of a tree I can see, so it may be someone's build` };
        if (canopy) {
            // Only leaves in view right now say whether a hand placed them; remembered ones count as grown.
            const placed = name.endsWith('_leaves') && block.stateId != null && block.rememberedAt === undefined && leavesPersist(block.stateId);
            return placed ? { why: 'made', text: `those leaves were placed by hand` } : null;
        }
        if (isNaturalTerrain(name)) return null;
        return { why: 'made', text: `${name} isn't natural ground, so someone made it` };
    }

    return {
        refusal,
        isTree: (x, y, z, name) => trees.isTree(x, y, z, javaName(name)),
        permit(fn) { permits.add(fn); return () => permits.delete(fn); },
    };
}
