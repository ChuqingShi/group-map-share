import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { ConnectionLimiter, MessageBucket, callerIp, hostKeyOk, originOk } from '../server/security.ts';

const req = (remote: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress: remote }, headers }) as unknown as IncomingMessage;

test('X-Forwarded-For is believed only from a known proxy or from loopback', () => {
  assert.equal(callerIp(req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }), false), '203.0.113.9', 'remote client cannot forge it');
  assert.equal(callerIp(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), false), '1.2.3.4', 'local proxy such as Tailscale');
  assert.equal(callerIp(req('::ffff:127.0.0.1', { 'x-forwarded-for': '5.6.7.8' }), false), '5.6.7.8');
  assert.equal(callerIp(req('10.1.1.1', { 'x-forwarded-for': '1.2.3.4' }), true), '1.2.3.4', 'declared proxy (Render)');
  assert.equal(callerIp(req('203.0.113.9'), false), '203.0.113.9');
});

test('host key: open when unset, exact match when set, no early exit on prefixes', () => {
  assert.equal(hostKeyOk(undefined, undefined), true);
  assert.equal(hostKeyOk('secret', 'secret'), true);
  assert.equal(hostKeyOk('secret', 'secre'), false);
  assert.equal(hostKeyOk('secret', 'secret!'), false);
  assert.equal(hostKeyOk('secret', undefined), false);
  assert.equal(hostKeyOk('secret', ['secret']), false);
  assert.equal(hostKeyOk('secret', ''), false);
});

test('origin: same site passes, other sites and junk fail, no Origin (non-browser) passes', () => {
  const host = 'x.ts.net:8443';
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'https://x.ts.net:8443' })), true);
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'https://x.ts.net' })), true, 'port differences on the same host are fine');
  assert.equal(originOk(req('1.1.1.1', { host: 'localhost:8790', 'x-forwarded-host': 'x.ts.net', origin: 'https://x.ts.net' })), true, 'proxy that rewrites Host');
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'https://evil.example' })), false);
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'null' })), false);
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'not a url' })), false);
  assert.equal(originOk(req('1.1.1.1', { host })), true);
  assert.equal(originOk(req('1.1.1.1', { host, origin: 'https://other.example' }), ['other.example']), true, 'explicitly allowed');
});

test('connection limiter caps per address and frees slots', () => {
  const l = new ConnectionLimiter(2);
  assert.ok(l.acquire('a') && l.acquire('a'));
  assert.equal(l.acquire('a'), false);
  assert.ok(l.acquire('b'));
  l.release('a');
  assert.ok(l.acquire('a'));
  l.release('zzz'); // releasing something we never held must not go negative
  assert.ok(l.acquire('zzz'));
});

test('message bucket allows bursts, blocks floods, and refills', () => {
  const b = new MessageBucket(5, 10, 0);
  for (let i = 0; i < 5; i++) assert.ok(b.allow(0), `burst ${i}`);
  assert.equal(b.allow(0), false);
  assert.equal(b.allow(50), false, 'half a token is not enough');
  assert.ok(b.allow(150), 'refilled after 150 ms');
});

// --- the real server ---------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

test('public-facing server: host key gates room creation, headers are set, origin and floods are refused', async () => {
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', GMS_PORT: String(port), GMS_HOST: '127.0.0.1', GMS_HOST_KEY: 'demo-key-123' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr?.on('data', (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;
  const sockets: WebSocket[] = [];
  try {
    let up = false;
    for (let i = 0; i < 50 && !up && server.exitCode === null; i++) {
      up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, `server did not start: ${stderr}`);

    // Starting an event needs the host key; joining does not.
    assert.equal((await fetch(`${base}/api/rooms`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'x-host-key': 'wrong' } })).status, 403);
    const ok = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'x-host-key': 'demo-key-123', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Demo' }) });
    assert.equal(ok.status, 201);
    const { id, name } = (await ok.json()) as { id: string; name: string };
    assert.equal(name, 'Demo');
    const info = await fetch(`${base}/api/rooms/${id}`);
    assert.equal(info.status, 200, 'anyone with the link can look the event up');
    assert.equal(info.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(info.headers.get('x-frame-options'), 'DENY');
    assert.match(info.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);

    // A page on another website cannot open a socket to the room; a same-site page can.
    const open = (origin?: string) =>
      new Promise<'open' | 'rejected'>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}`, origin ? { headers: { origin } } : undefined);
        sockets.push(ws);
        ws.once('open', () => resolve('open'));
        ws.once('unexpected-response', () => resolve('rejected'));
        ws.once('error', () => resolve('rejected'));
      });
    assert.equal(await open('https://evil.example'), 'rejected');
    assert.equal(await open(`http://127.0.0.1:${port}`), 'open');
    assert.equal(await open(), 'open');

    // Sitting on a socket without ever saying hello gets you dropped; flooding gets you dropped.
    const flood = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}`);
    sockets.push(flood);
    await once(flood, 'open');
    flood.send(JSON.stringify({ t: 'hello', name: 'Flood', avatar: '🦊', color: '#ff5d73' }));
    const closed = once(flood, 'close');
    for (let i = 0; i < 400; i++) flood.send(JSON.stringify({ t: 'pos', lat: 1, lng: 1 }));
    const [code] = (await Promise.race([closed, new Promise<[number]>((r) => setTimeout(() => r([-1]), 3000))])) as [number];
    assert.equal(code, 4009, 'flooding socket is closed');

    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal(server.exitCode, null, `server died: ${stderr}`);
  } finally {
    for (const ws of sockets) ws.terminate();
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
  }
});

test('a socket on a missing room, or one that never says hello, cannot crash the server or hold a slot', async () => {
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, GMS_PORT: String(port), GMS_HOST: '127.0.0.1', GMS_HELLO_TIMEOUT_MS: '300' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr?.on('data', (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;
  const sockets: WebSocket[] = [];
  try {
    let up = false;
    for (let i = 0; i < 50 && !up && server.exitCode === null; i++) {
      up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, `server did not start: ${stderr}`);

    // 45 sockets to a room that does not exist, more than the 30 per address allowed: each must free its slot.
    for (let i = 0; i < 45; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=nope`);
      sockets.push(ws);
      await new Promise((r) => ws.once('close', r));
    }
    // A real room's socket that never says hello is closed by the hello timeout.
    const { id } = (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { id: string };
    const idle = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}`);
    sockets.push(idle);
    await once(idle, 'open');
    const [code] = (await once(idle, 'close')) as [number];
    assert.equal(code, 4008, 'idle socket dropped by the hello timeout');
    // Wait past the timeout of the sockets above: a leaked timer on the no-room path used to crash the process here.
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(server.exitCode, null, `server died: ${stderr}`);
    const ok = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}`);
    sockets.push(ok);
    await once(ok, 'open'); // still accepted, so no slot leaked
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    for (const ws of sockets) ws.terminate();
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
  }
});
