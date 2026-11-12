// Fair-play sight: could a survival player standing here see that block, point, or mob?
//
// This is the geometric heart of fair play. Mineflayer receives every block in every loaded chunk,
// buried ore included, so "what the bot knows" has to be narrowed to "what a straight line from
// its eye can reach". Everything else in the fair-play layer (the perception service, the seen-world
// map, the reach guard) asks these questions.
//
// The module is pure: it never touches mineflayer. The caller passes
//   - getStateId(x, y, z): the block state id at a cell, or null/undefined when the client doesn't
//     have that cell (an unloaded chunk). Unknown cells block sight: guessing "air" would let the bot
//     see into chunks it has never received.
//   - stopsSight: a Uint8Array from buildStopsSightTable(), 1 for state ids that hide what's behind.
// That keeps the hot loop allocation-free (numbers in, numbers out) and lets unit tests run on tiny
// hand-built worlds instead of a server.

// The six face directions of a block, as [x, y, z] unit normals.
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Where on a face we aim, as fractions across the face's two in-plane axes: the center first (the
// common case, so most checks finish after one ray), then four points near the corners so a face
// that is only partly hidden still counts as seen.
const FACE_SAMPLES = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];

// Aim points sit this far outside the face, inside the open neighbour cell, so the ray ends in the
// cell the face is seen *from* and never has to decide which side of a plane it landed on.
const FACE_OFFSET = 1e-3;

// Blocks that stop light (so minecraft-data rates them filterLight 15) but that you can see through.
const SEE_THROUGH_OVERRIDES = new Set(['tinted_glass']);

// Points on an entity we try to see: just above its feet, its middle, and just below its head.
// Seeing any one of them is enough, the way a player spots a mob's head over a wall.
const ENTITY_SAMPLE_HEIGHTS = [0.1, 0.5, 0.9];

// A collision shape that fills its whole cell.
const isFullCube = shape => Array.isArray(shape) && shape.length === 1 && shape[0].join(',') === '0,0,0,1,1,1';

/**
 * Builds the table of block states that hide what's behind them: full, opaque cubes.
 *
 * minecraft-data's `transparent` flag can't be used alone for this: it marks chests, slabs, stairs,
 * fences and farmland as non-transparent although you can plainly see past them. Two rules together
 * get it right:
 *   1. A block with a full `block` bounding box that stops all light (`filterLight === 15`) is an
 *      opaque cube in every state: stone, ores, logs, furnaces.
 *   2. A non-transparent block counts in just the states whose collision shape fills the cell. In
 *      practice that is the double slab: a single slab lets you see over it, two stacked are a wall.
 * Other non-full shapes (single slabs, stairs, fences) count as see-through. That is slightly generous,
 * since a bottom slab does hide the lower half of what's behind it, and can be tightened later.
 *
 * @param {object} registry - minecraft-data or bot.registry
 * @returns {Uint8Array} indexed by state id; 1 = blocks sight
 */
export function buildStopsSightTable(registry) {
    let maxState = 0;
    for (const block of registry.blocksArray) maxState = Math.max(maxState, block.maxStateId);
    const table = new Uint8Array(maxState + 1);
    const shapes = registry.blockCollisionShapes;
    for (const block of registry.blocksArray) {
        if (SEE_THROUGH_OVERRIDES.has(block.name)) continue;
        if (block.boundingBox === 'block' && block.filterLight === 15) {
            table.fill(1, block.minStateId, block.maxStateId + 1);
        } else if (!block.transparent && shapes) {
            const perState = shapes.blocks[block.name];
            const shapeOf = offset => shapes.shapes[Array.isArray(perState) ? perState[offset] : perState];
            for (let id = block.minStateId; id <= block.maxStateId; id++)
                if (isFullCube(shapeOf(id - block.minStateId))) table[id] = 1;
        }
    }
    return table;
}

/**
 * The direction a bot is looking, using mineflayer's convention (yaw 0 faces north, -z; positive pitch
 * looks up). Same formula as mineflayer's ray_trace plugin.
 */
export function viewDirection(yaw, pitch) {
    const cosPitch = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch };
}

/**
 * Creates the sight checks over one world.
 * @param {object} options
 * @param {(x:number, y:number, z:number) => number|null|undefined} options.getStateId
 * @param {Uint8Array} options.stopsSight - from buildStopsSightTable
 */
export function createSight({ getStateId, stopsSight }) {
    if (typeof getStateId !== 'function') throw new Error('createSight needs getStateId(x, y, z)');
    if (!(stopsSight instanceof Uint8Array)) throw new Error('createSight needs a stopsSight table');

    /** True when the cell hides what's behind it, including cells the client doesn't have. */
    function blocksSight(x, y, z) {
        const id = getStateId(x, y, z);
        if (id === null || id === undefined) return true;
        return stopsSight[id] === 1;
    }

    /**
     * Walks the cells a straight segment passes through, from the cell holding `a` to the cell holding
     * `b` (3-D DDA, Amanatides and Woo). The start cell is never checked: it's where the eye is, and a
     * bot with its head in water or tall grass can still see. The end cell is checked.
     *
     * Each axis takes exactly as many steps as the cells between start and end, so the walk always ends
     * on b's cell even when floating point rounds a crossing the wrong way. When a line crosses exactly
     * through an edge or corner, it steps through one of the neighbouring cells, so two solid blocks
     * touching at an edge stay a closed wall rather than leaking sight through the seam.
     */
    function segmentClear(ax, ay, az, bx, by, bz) {
        let x = Math.floor(ax), y = Math.floor(ay), z = Math.floor(az);
        const ex = Math.floor(bx), ey = Math.floor(by), ez = Math.floor(bz);
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const sx = Math.sign(ex - x), sy = Math.sign(ey - y), sz = Math.sign(ez - z);
        let rx = Math.abs(ex - x), ry = Math.abs(ey - y), rz = Math.abs(ez - z);

        // tMax*: how far along the segment (0..1) until the next crossing on that axis.
        // tDelta*: how far along the segment one whole cell is on that axis.
        const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
        const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
        const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
        let tMaxX = dx > 0 ? (x + 1 - ax) / dx : dx < 0 ? (x - ax) / dx : Infinity;
        let tMaxY = dy > 0 ? (y + 1 - ay) / dy : dy < 0 ? (y - ay) / dy : Infinity;
        let tMaxZ = dz > 0 ? (z + 1 - az) / dz : dz < 0 ? (z - az) / dz : Infinity;

        while (rx + ry + rz > 0) {
            // An axis with no steps left can't be chosen, whatever rounding says.
            const mx = rx > 0 ? tMaxX : Infinity;
            const my = ry > 0 ? tMaxY : Infinity;
            const mz = rz > 0 ? tMaxZ : Infinity;
            if (mx <= my && mx <= mz) { x += sx; tMaxX += tDeltaX; rx--; }
            else if (my <= mz) { y += sy; tMaxY += tDeltaY; ry--; }
            else { z += sz; tMaxZ += tDeltaZ; rz--; }
            if (blocksSight(x, y, z)) return false;
        }
        return true;
    }

    /** Distance and field-of-view limits. Returns false when the point is out of range or out of view. */
    function withinView(eye, px, py, pz, opts) {
        const dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const maxDistance = opts?.maxDistance ?? Infinity;
        if (distSq > maxDistance * maxDistance) return false;
        const fov = opts?.fovDegrees ?? 360;
        if (fov < 360 && opts?.viewDir && distSq > 0) {
            const v = opts.viewDir;
            const vLen = Math.hypot(v.x, v.y, v.z) || 1;
            const cos = (dx * v.x + dy * v.y + dz * v.z) / (Math.sqrt(distSq) * vLen);
            if (cos < Math.cos((fov / 2) * Math.PI / 180)) return false;
        }
        return true;
    }

    /**
     * Can a straight line from the eye reach this point? Checks every cell after the eye's, up to and
     * including the point's own cell.
     */
    function canSeePoint(eye, point, opts) {
        if (!withinView(eye, point.x, point.y, point.z, opts)) return false;
        return segmentClear(eye.x, eye.y, eye.z, point.x, point.y, point.z);
    }

    /** Does this block touch at least one cell you could see it from? The cheap first filter. */
    function hasOpenFace(x, y, z) {
        for (const [nx, ny, nz] of FACES)
            if (!blocksSight(x + nx, y + ny, z + nz)) return true;
        return false;
    }

    /**
     * Is any face of the block at (x, y, z) visible from the eye?
     *
     * A face counts when (1) it points toward the eye, (2) the cell in front of it lets sight through,
     * and (3) a straight line from the eye reaches a point just in front of it without crossing
     * anything that blocks sight. Interior blocks fail (2) for every face, so they cost six table
     * lookups and no rays.
     *
     * @returns {{face:number[], point:{x:number,y:number,z:number}}|null} the face and aim point that
     *   were seen (the reach guard aims there), or null when no face is visible.
     */
    function canSeeBlock(eye, x, y, z, opts) {
        if (!withinView(eye, x + 0.5, y + 0.5, z + 0.5, { maxDistance: opts?.maxDistance })) return null;
        const origin = [x, y, z];
        const eyeArr = [eye.x, eye.y, eye.z];
        for (const face of FACES) {
            const axis = face[0] !== 0 ? 0 : face[1] !== 0 ? 1 : 2;
            const sign = face[axis];
            const plane = origin[axis] + (sign > 0 ? 1 : 0);
            // (1) Back faces: the eye must be on the outside of the face's plane.
            if ((eyeArr[axis] - plane) * sign <= 0) continue;
            // (2) A face pressed against an opaque block can't be seen from anywhere.
            if (blocksSight(x + face[0], y + face[1], z + face[2])) continue;
            // (3) Aim at sample points just outside the face.
            const u = (axis + 1) % 3, v = (axis + 2) % 3;
            for (const [su, sv] of FACE_SAMPLES) {
                const p = [0, 0, 0];
                p[axis] = plane + sign * FACE_OFFSET;
                p[u] = origin[u] + su;
                p[v] = origin[v] + sv;
                const point = { x: p[0], y: p[1], z: p[2] };
                if (canSeePoint(eye, point, opts)) return { face: [...face], point };
            }
        }
        return null;
    }

    /**
     * Can the eye see any of an entity's sample points (feet, middle, head)?
     * @param {{position:{x:number,y:number,z:number}, height:number}} entity - position is at the feet
     */
    function canSeeEntity(eye, entity, opts) {
        const height = entity.height ?? 1.8;
        for (const fraction of ENTITY_SAMPLE_HEIGHTS) {
            const point = { x: entity.position.x, y: entity.position.y + height * fraction, z: entity.position.z };
            if (canSeePoint(eye, point, opts)) return true;
        }
        return false;
    }

    return { blocksSight, hasOpenFace, canSeePoint, canSeeBlock, canSeeEntity };
}
