// SPDX-License-Identifier: CC0-1.0
// Farming and good-neighbor rules, agreeing on crops.
//
// Good-neighbor rules protect what players made, and a crop is made: someone sowed it. So with those rules on,
// the bot could neither harvest a field it was asked to tend nor collect wheat from its own. The rules have no
// owner record to tell its own field from a stranger's; the field book is one. This is where it answers:
//   - a crop in the field a round of `!tendField` is tending may be cut. That round only started because the
//     field may be tended (its owner allows it, or a player asked), and it leaves the field as it was found,
//     replanted;
//   - any other crop may be cut when the field book says its field is one the bot may always tend (its own,
//     a shared one, or a player's who said "always"), or when the player who asked is the field's owner;
//   - anything else stays refused, and the refusal says how to tend a field properly, instead of only "ask".
// It answers for crops alone (the plant, never the farmland under it), and only ever lets the bot break more
// than good-neighbor rules allow on their own: it can't make a block someone's. Protected areas still win.
import { cropOfBlock } from './crops.js';
import { sameOwner } from './field_book.js';

const keyOf = (x, y, z) => `${x},${y},${z}`;

/** What the model is told when a crop isn't the bot's to cut. */
export const CROP_HINT = 'It is a crop in a field that is not yours to harvest. !tendField harvests a field and replants it, '
    + 'when the field is yours or shared or a player asks you to; !markField records whose a field is.';

/**
 * @param {object} options
 * @param {() => object} options.book - the field book for the world the bot is in now
 * @param {() => {asked?: boolean|null, by?: string|null}} [options.behind] - who is behind what the bot is doing
 * @returns {{permit: (cell: {x, y, z, name}) => ({ok: true}|{hint: string}|null),
 *   tending: (cells: {x, y, z}[]) => () => void}}
 *   `permit` is handed to the good-neighbor protector; `tending` opens a round's field and returns its close
 */
export function cropPermits({ book, behind = () => ({}) }) {
    // The farmland cells of the fields being tended right now, each counted by how many rounds hold it.
    const rounds = new Map();

    function permit({ x, y, z, name }) {
        if (!cropOfBlock(name)) return null;
        const ground = { x, y: y - 1, z };
        if (rounds.has(keyOf(ground.x, ground.y, ground.z))) return { ok: true };
        const whose = book()?.whose([ground]);
        if (whose?.owner && whose.tending === 'always') return { ok: true };
        const who = behind() ?? {};
        if (whose?.owner && who.asked && who.by && sameOwner(whose.owner, who.by)) return { ok: true };
        return { hint: CROP_HINT };
    }

    function tending(cells) {
        const keys = (cells ?? []).map(c => keyOf(c.x, c.y, c.z));
        for (const key of keys) rounds.set(key, (rounds.get(key) ?? 0) + 1);
        let open = true;
        return () => {
            if (!open) return;
            open = false;
            for (const key of keys) {
                const left = (rounds.get(key) ?? 1) - 1;
                if (left > 0) rounds.set(key, left); else rounds.delete(key);
            }
        };
    }

    return { permit, tending };
}
