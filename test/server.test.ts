// End-to-end: boot the real server and connect two WebSocket clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { ServerMsg } from '../shared/protocol.ts';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

before(async () => {
  server = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, GMS_PORT: String(PORT), GMS_HOST: '127.0.0.1' } });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server.kill());

function client(roomId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${roomId}`);
  const inbox: ServerMsg[] = [];
  const waiters: [(m: ServerMsg) => boolean, (m: ServerMsg) => void][] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMsg;
    inbox.push(m);
    for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m); }
  });
  const waitFor = (pred: (m: ServerMsg) => boolean) =>
    new Promise<ServerMsg>((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit);
      waiters.push([pred, res]);
      setTimeout(() => rej(new Error('timeout waiting for message')), 3000);
    });
  return { ws, inbox, waitFor, send: (m: object) => ws.send(JSON.stringify(m)) };
}

test('two clients in one room see each other move, then leave', async () => {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };

  const a = client(id);
  await once(a.ws, 'open');
  a.send({ t: 'hello', name: 'Breeca', avatar: '🦊', color: '#ff5d73' });
  const wa = (await a.waitFor((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;

  const b = client(id);
  await once(b.ws, 'open');
  b.send({ t: 'hello', name: 'Eric', avatar: '🐸', color: '#3ddc84' });
  const wb = (await b.waitFor((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  assert.deepEqual(wb.players.map((p) => p.name).sort(), ['Breeca', 'Eric']);

  a.send({ t: 'pos', lat: 34.01, lng: -118.49, acc: 6 });
  const moved = await b.waitFor((m) => m.t === 'player' && m.player.id === wa.you && m.player.pos !== null);
  assert.equal(moved.t === 'player' && moved.player.pos?.lng, -118.49);

  b.send({ t: 'pos', lat: 34.012, lng: -118.495 });
  await a.waitFor((m) => m.t === 'player' && m.player.id === wb.you && m.player.pos !== null);

  b.send({ t: 'leave' });
  const left = await a.waitFor((m) => m.t === 'left');
  assert.equal(left.t === 'left' && left.id, wb.you);
  a.ws.close();
});

/** Ask the OS for a port nobody is using, so parallel runs cannot collide. */
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

// Raw request targets that used to throw out of the async handler and kill the whole
// process (and with it every live room). `fetch` would normalise some of these away,
// so send them with node:http exactly as written.
test('hostile request targets never crash the production static server', async () => {
  const port = await freePort();
  const prod = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', GMS_PORT: String(port), GMS_HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  prod.stderr?.on('data', (d) => (stderr += d));
  const get = (path: string) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.once('error', reject);
      req.end();
    });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up && prod.exitCode === null; i++) {
      up = await get('/api/health').then((s) => s === 200, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, `production server did not start: ${stderr}`);

    assert.equal(await get('/%E0%A4%A'), 400, 'malformed percent-escape');
    assert.equal(await get('/..%2f..%2fpackage.json'), 400, 'encoded traversal');
    assert.equal(await get('/%2e%2e%2fpackage.json'), 400, 'dot-encoded traversal');
    // Protocol-relative looking targets: served as the SPA page (200) or 404 when dist/ is not built, never a crash.
    for (const p of ['//', '///', '//x', '///evil.com/a']) {
      assert.ok([200, 404].includes(await get(p)), `target ${p}`);
    }
    assert.equal(await get('/api/health'), 200, 'server must still be alive');
    assert.equal(prod.exitCode, null, `server exited: ${stderr}`);
  } finally {
    prod.kill();
    if (prod.exitCode === null) await once(prod, 'exit');
  }
});

test('unknown room is rejected', async () => {
  const c = client('doesnotexist');
  const err = await c.waitFor((m) => m.t === 'error');
  assert.equal(err.t === 'error' && err.code, 'no_room');
  assert.equal((await fetch(`${base}/api/rooms/doesnotexist`)).status, 404);
});
