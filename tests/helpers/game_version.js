// SPDX-License-Identifier: CC0-1.0
// The game version the tests play.
//
// Live scenarios start a server from MC_TEST_SERVER_JAR and must tell the bot the same version, or it
// speaks the wrong protocol and is kicked at login. Unit tests that load game data use it too, so the
// block and item names they check are the ones a bot meets on that server. Keeping it in one place means a
// move to a newer game version changes one line here rather than every scenario.
//
// MC_TEST_VERSION picks another, to run the live scenarios against an older or newer server jar.
export const GAME_VERSION = process.env.MC_TEST_VERSION || '26.3';
