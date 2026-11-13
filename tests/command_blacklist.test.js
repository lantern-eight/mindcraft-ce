// A blacklisted command must be gone everywhere: from lookup, and from the docs shown to the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blacklistCommands, getCommand, getCommandDocs } from '../src/agent/commands/index.js';

test('a blacklisted command is removed from the command docs as well as from lookup', () => {
    const agent = { blocked_actions: [] }; // nothing blocked per agent, so only the blacklist can hide it
    assert.match(getCommandDocs(agent), /!searchWiki/);
    blacklistCommands(['!searchWiki', '!stop']);
    assert.equal(getCommand('!searchWiki'), undefined);
    assert.doesNotMatch(getCommandDocs(agent), /!searchWiki/);
    assert.ok(getCommand('!stop'), '!stop can never be blacklisted');
});
