// SPDX-License-Identifier: CC0-1.0
// Which field of view a live script runs fair play with.
//
// Strict fair play sees through a player's screen (fov_degrees 70). Most live scenes are about something
// else (walls, memory, reflexes), and are worth running both ways: with the screen, as the bot plays, and
// all around, which shows whether a failure comes from the view or from the thing the scene is about.
//   MC_TEST_VIEW=all   (or --view=all)    all around: strict with fov_degrees 360
//   anything else                         strict, the narrow view
// An environment variable, so that bedrock_all.js passes it on to every script it starts.
const chosen = process.argv.find(a => a.startsWith('--view='))?.split('=')[1] ?? process.env.MC_TEST_VIEW;

/** 'all' or 'narrow'. */
export const LIVE_VIEW = chosen === 'all' ? 'all' : 'narrow';

/** The fair-play settings for that view, to spread into setSettings or resolvePolicy. */
export function fairPlaySettings() {
    return LIVE_VIEW === 'all' ? { fair_play: 'custom', fair_play_custom: { fov_degrees: 360 } } : { fair_play: 'strict' };
}
