import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { clientIp, serverConfig } from '../server/config.ts';

test('locally, PORT is ignored in favour of GMS_PORT / 8787', () => {
  assert.equal(serverConfig({ PORT: '18789' }).port, 8787);
  assert.equal(serverConfig({ PORT: '18789', NODE_ENV: 'production' }).port, 8787);
  assert.equal(serverConfig({ PORT: '18789', GMS_PORT: '9000' }).port, 9000);
});

test("on Render, Render's PORT wins and we bind all interfaces", () => {
  const c = serverConfig({ RENDER: 'true', PORT: '10000', GMS_PORT: '9000', NODE_ENV: 'production' });
  assert.deepEqual(c, { port: 10000, host: '0.0.0.0', serveStatic: true, behindProxy: true });
  assert.equal(serverConfig({ RENDER: 'true', GMS_PORT: '9000' }).port, 9000);
});

test('X-Forwarded-For is only trusted behind the proxy', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage;
  assert.equal(clientIp(req, true), '203.0.113.7');
  assert.equal(clientIp(req, false), '10.0.0.1');
});
