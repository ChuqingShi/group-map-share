// End-to-end: boot the real server and connect two WebSocket clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
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
  a.send({ t: 'hello', name: 'Ann', avatar: '🦊', color: '#ff5d73' });
  const wa = (await a.waitFor((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;

  const b = client(id);
  await once(b.ws, 'open');
  b.send({ t: 'hello', name: 'Bob', avatar: '🐸', color: '#3ddc84' });
  const wb = (await b.waitFor((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  assert.deepEqual(wb.players.map((p) => p.name).sort(), ['Ann', 'Bob']);

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

test('unknown room is rejected', async () => {
  const c = client('doesnotexist');
  const err = await c.waitFor((m) => m.t === 'error');
  assert.equal(err.t === 'error' && err.code, 'no_room');
  assert.equal((await fetch(`${base}/api/rooms/doesnotexist`)).status, 404);
});
