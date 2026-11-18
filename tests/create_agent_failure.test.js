// SPDX-License-Identifier: CC0-1.0
// An agent that fails to start must not stay listed on the MindServer. createAgent listed it before
// checking the game server, so when the check failed the agent stayed behind with no process: shown in
// the MindServer's page, and its name refused as "already exists" when tried again from there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { createMindServer } from '../src/mindcraft/mindserver.js';
import { createAgent } from '../src/mindcraft/mindcraft.js';

test('an agent whose start fails is not left on the MindServer', async () => {
    // A MindServer of its own, on a free loopback port: with no control token, a loopback client may ask it.
    delete process.env.MINDCRAFT_CONTROL_TOKEN;
    delete process.env.MINDCRAFT_BIND_HOST;
    const server = createMindServer(false, 0);
    await once(server, 'listening');
    const client = io(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'] });
    try {
        // A Bedrock agent asked to play a Java version can't work, and fails before its process starts.
        const result = await createAgent({ profile: { name: 'ghost_agent' }, minecraft_edition: 'bedrock', minecraft_version: '26.3', host: '127.0.0.1', port: 19132 });
        assert.equal(result.success, false);
        await once(client, 'connect');
        const answer = await new Promise(resolve => client.emit('get-settings', 'ghost_agent', resolve));
        assert.match(answer.error ?? '', /not found/, 'the failed agent is not listed');
    } finally {
        client.close();
        server.close();
    }
});
