// SPDX-License-Identifier: MIT
//
// MIT License
//
// Copyright (c) 2024 Kolby Nottingham
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// The order in which a round of farming visits the cells of a field, a plough's. Ported from the
// akarkin1/mindcraft-fk fork of Mindcraft (packs/farming/crop_logic.js, `visitOrder`), which is under the MIT
// License above, the same as the code this fork inherits. Kept in a file of its own so it stays under that
// license; the rest of src/agent/farming/ is this fork's own (CC0). See ATTRIBUTION.md.

/**
 * The order in which the bot visits the cells: row by row, turning at the end of each row, like a plough.
 * Rows run along the longer side of the field (along x when both are equal). The first row is the one
 * nearest the start, begun at its end nearer the start; the bot works towards the nearer edge of the field
 * first, then the rows on the other side. Holes, water and odd shapes only leave cells out.
 * @param {{x: number, z: number}[]} cells
 * @param {{x: number, z: number}|null} start - where the bot is; null: the lowest corner
 * @returns {object[]} the same cell objects, in a new array
 */
export function visitOrder(cells, start) {
    const valid = (Array.isArray(cells) ? cells : []).filter(c => c && Number.isFinite(c.x) && Number.isFinite(c.z));
    if (valid.length === 0) return [];
    const xs = valid.map(c => c.x), zs = valid.map(c => c.z);
    const minX = Math.min(...xs), minZ = Math.min(...zs);
    const alongX = Math.max(...xs) - minX >= Math.max(...zs) - minZ;
    const rowOf = c => (alongX ? c.z : c.x);
    const posOf = c => (alongX ? c.x : c.z);
    const s = start && Number.isFinite(start.x) && Number.isFinite(start.z)
        ? { x: Math.floor(start.x), z: Math.floor(start.z) } : { x: minX, z: minZ };
    const sRow = alongX ? s.z : s.x;
    const sPos = alongX ? s.x : s.z;

    const rows = new Map();
    for (const c of valid) {
        const r = rowOf(c);
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(c);
    }
    const keys = [...rows.keys()].sort((a, b) => a - b);
    let first = 0;
    for (let i = 1; i < keys.length; i++) {
        if (Math.abs(keys[i] - sRow) < Math.abs(keys[first] - sRow)) first = i;
    }
    const lower = keys.slice(0, first).reverse();
    const upper = keys.slice(first + 1);
    const sequence = [keys[first], ...(lower.length <= upper.length ? [...lower, ...upper] : [...upper, ...lower])];

    const firstRow = rows.get(keys[first]).map(posOf);
    let ascending = Math.abs(Math.min(...firstRow) - sPos) <= Math.abs(Math.max(...firstRow) - sPos);
    const out = [];
    for (const key of sequence) {
        out.push(...[...rows.get(key)].sort((a, b) => (ascending ? posOf(a) - posOf(b) : posOf(b) - posOf(a))));
        ascending = !ascending;
    }
    return out;
}
