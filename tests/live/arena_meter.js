// SPDX-License-Identifier: CC0-1.0
// What the fight arenas measure, the same on both editions (fight_arena.js on Java, bedrock_fight_arena.js on
// Bedrock): for each round, whether the bot won, ran or died, how long it took, the damage it took, its swings,
// how many of them landed, and swings per kill; and a line per kit and round summing the runs up.
//
// The arenas read raw world data to measure. The bot never may.

// The rounds both arenas run: mobs by kind, at offsets in blocks from the bot.
export const ROUNDS = [
    { name: '1 zombie', mobs: [['zombie', 7, 0]] },
    { name: '2 zombies', mobs: [['zombie', 7, 0], ['zombie', -6, 3]] },
    { name: '3 zombies', mobs: [['zombie', 7, 0], ['zombie', -6, 3], ['zombie', 0, -7]] },
    { name: '1 spider', mobs: [['spider', 7, 0]] },
    { name: '1 skeleton', mobs: [['skeleton', 7, 3]] },
    { name: '2 skeletons', mobs: [['skeleton', 7, 3], ['skeleton', -7, -3]] },
    { name: 'mixed', mobs: [['zombie', 7, 0], ['zombie', -6, 3], ['skeleton', 0, 7], ['spider', 5, -5]] },
];
export const KIT_NAMES = ['bare hands', 'stone sword', 'copper sword', 'iron kit', 'stone sword and shield', 'iron kit and shield'];
export const ROUND_MS = 45000;
const LANDED_WITHIN_MS = 500; // a flinch this soon after a swing at a mob is that swing landing

const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};
const round1 = value => (value == null ? null : Math.round(value * 10) / 10);

/**
 * Watches the bot through a round. Swings are its attacks; a swing landed when its mob showed the hurt flash
 * within half a second, as a player sees a hit land. A mob counts as killed when the server says it died, or
 * when it is gone from the bot's tracking (Bedrock removes a dead mob without a death status every time).
 * @param {object} bot
 * @param {object} [options]
 * @param {number} [options.brink] - health at or under which the round counts as lost by death, and `onBrink`
 *     is told (to heal the bot before it really dies); none: only a real death counts
 * @param {() => void} [options.onBrink]
 */
export function createMeter(bot, { brink = 0, onBrink = () => {} } = {}) {
    let round = null;
    const attack = bot.attack;
    bot.attack = function (target, ...rest) {
        if (round) round.swings.push({ id: target?.id, at: Date.now(), landed: false });
        return attack.call(this, target, ...rest);
    };
    bot.on('entityHurt', entity => {
        if (!round?.ids.has(entity.id)) return;
        const swing = round.swings.find(s => s.id === entity.id && !s.landed && Date.now() - s.at < LANDED_WITHIN_MS);
        if (swing) swing.landed = true;
    });
    bot.on('entityDead', entity => { if (round?.ids.has(entity.id)) round.dead.add(entity.id); });
    bot.on('health', () => {
        if (!round) return;
        if (bot.health < round.health) round.damage += round.health - bot.health;
        round.health = bot.health;
        round.lowest = Math.min(round.lowest, bot.health);
        if (brink > 0 && bot.health > 0 && bot.health <= brink && !round.died) { round.died = true; onBrink(); }
    });
    bot.on('death', () => { if (round) round.died = true; });

    return {
        /** Counts a hit the bot's shield stopped (each arena knows how its edition says so). */
        blocked() { if (round) round.blocked++; },
        /** Starts a round against these mobs (as the bot's tracking has them). */
        start(mobs) {
            round = { ids: new Set(mobs.map(m => m.id)), dead: new Set(), swings: [], damage: 0, health: bot.health, blocked: 0,
                lowest: bot.health, died: false, startedAt: Date.now() };
        },
        alive: () => [...round.ids].filter(id => !round.dead.has(id) && bot.entities[id]).length,
        over: () => round.died || [...round.ids].every(id => round.dead.has(id) || !bot.entities[id]) || Date.now() - round.startedAt > ROUND_MS,
        /**
         * Ends the round and gives its result.
         * @param {object} fields - kit, round, run and anything else to keep with it
         * @param {object[]} events - the reflexes' events during the round
         */
        finish(fields, events, messages) {
            const r = round;
            round = null;
            const killed = [...r.ids].filter(id => r.dead.has(id) || !bot.entities[id]).length;
            const ran = events.some(e => e.event === 'decided' && e.mode === 'mob_safety');
            const outcome = r.died ? 'died' : killed === r.ids.size ? 'won' : ran ? 'ran' : 'timed out';
            const landed = r.swings.filter(s => s.landed).length;
            return { ...fields, outcome, seconds: round1((Date.now() - r.startedAt) / 1000), killed, of: r.ids.size,
                damage: round1(r.damage), lowestHealth: round1(r.lowest), swings: r.swings.length, landed,
                swingsPerKill: killed ? round1(r.swings.length / killed) : null,
                fights: events.filter(e => e.event === 'decided' && e.mode === 'self_defense').length,
                retreats: events.filter(e => e.event === 'decided' && e.mode === 'mob_safety').length,
                shieldRaised: events.reduce((n, e) => n + (e.event === 'done' ? e.blocks ?? 0 : 0), 0), blocked: r.blocked,
                messagesToModel: messages.length };
        },
    };
}

/** One line per kit and round, from every run of it. */
export function summarize(results) {
    const groups = new Map();
    for (const r of results) {
        const key = `${r.kit} | ${r.round}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    return [...groups].map(([key, runs]) => {
        const won = runs.filter(r => r.outcome === 'won');
        const swings = runs.reduce((n, r) => n + r.swings, 0), kills = runs.reduce((n, r) => n + r.killed, 0);
        const landed = runs.reduce((n, r) => n + r.landed, 0);
        return { key, runs: runs.length, won: won.length, ran: runs.filter(r => r.outcome === 'ran').length,
            died: runs.filter(r => r.outcome === 'died').length, medianSecondsWon: round1(median(won.map(r => r.seconds))),
            medianDamage: round1(median(runs.map(r => r.damage))), swingsPerKill: kills ? round1(swings / kills) : null,
            blocked: runs.reduce((n, r) => n + (r.blocked ?? 0), 0),
            landedShare: swings ? round1(landed / swings) : null };
    });
}

/** Prints the summary, a line each. */
export function printSummary(summary) {
    console.log('\nkit | round: won/runs (ran, died), median s to win, median damage, swings per kill, share landed, hits blocked');
    for (const s of summary)
        console.log(`${s.key}: ${s.won}/${s.runs} (${s.ran} ran, ${s.died} died), ${s.medianSecondsWon ?? '-'} s, ${s.medianDamage} dmg, ${s.swingsPerKill ?? '-'} swings/kill, ${s.landedShare ?? '-'} landed, ${s.blocked} blocked`);
}
