import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry, cleanName, type Conn } from '../server/rooms.ts';
import type { ServerMsg } from '../shared/protocol.ts';

function fakeConn() {
  const inbox: ServerMsg[] = [];
  const conn: Conn & { inbox: ServerMsg[]; closed: boolean } = {
    inbox,
    closed: false,
    send: (m) => inbox.push(m),
    close: () => (conn.closed = true),
  };
  return conn;
}

function setup() {
  let now = 1_000_000;
  const reg = new RoomRegistry({ now: () => now, idleMs: 1000, offlineGraceMs: 500, minPosIntervalMs: 100 });
  return { reg, tick: (ms: number) => (now += ms) };
}

test('room ids are long and unique', () => {
  const { reg } = setup();
  const a = reg.create()!;
  const b = reg.create()!;
  assert.notEqual(a.id, b.id);
  assert.ok(a.id.length >= 22);
});

test('players see each other join and move', () => {
  const { reg, tick } = setup();
  const room = reg.create()!;
  const ca = fakeConn();
  const cb = fakeConn();
  const a = reg.join(room, ca, { name: 'Ann', avatar: '🦊', color: '#ff5d73' });
  const b = reg.join(room, cb, { name: 'Bob', avatar: '🐸', color: '#3ddc84' });
  assert.ok('id' in a && 'id' in b);

  const welcomeB = cb.inbox[0];
  assert.equal(welcomeB.t, 'welcome');
  assert.equal(welcomeB.t === 'welcome' && welcomeB.players.length, 2);
  assert.ok(ca.inbox.some((m) => m.t === 'player' && m.player.name === 'Bob'));

  tick(200);
  reg.updatePosition(room, a.id, 51.5, -0.12, 8);
  const seen = cb.inbox.findLast((m) => m.t === 'player');
  assert.equal(seen?.t === 'player' && seen.player.pos?.lat, 51.5);
});

test('rejects bad coordinates and throttles floods', () => {
  const { reg, tick } = setup();
  const room = reg.create()!;
  const r = reg.join(room, fakeConn(), { name: 'x', avatar: '?', color: 'red' }) as { id: string };
  const p = room.members.get(r.id)!.player;
  assert.equal(p.avatar, '🦊', 'unknown avatar falls back');
  assert.equal(reg.updatePosition(room, r.id, 200, 0, null), false);
  assert.equal(reg.updatePosition(room, r.id, 'a', 0, null), false);
  tick(200);
  reg.updatePosition(room, r.id, 1, 1, null);
  reg.updatePosition(room, r.id, 2, 2, null); // within 100 ms: dropped
  assert.equal(p.pos?.lat, 1);
});

test('names are cleaned and capped', () => {
  assert.equal(cleanName('  Al\u0000ice \n  B '), 'Alice B');
  assert.equal(cleanName(''), 'Player');
  assert.equal([...cleanName('x'.repeat(100))].length, 24);
});

test('stop sharing forgets the position', () => {
  const { reg, tick } = setup();
  const room = reg.create()!;
  const r = reg.join(room, fakeConn(), { name: 'A', avatar: '🦊', color: '#ff5d73' }) as { id: string };
  tick(200);
  reg.updatePosition(room, r.id, 1, 1, null);
  reg.setSharing(room, r.id, false);
  assert.equal(room.members.get(r.id)!.player.pos, null);
});

test('reconnect with token resumes the same player; old tab is kicked', () => {
  const { reg } = setup();
  const room = reg.create()!;
  const c1 = fakeConn();
  const r1 = reg.join(room, c1, { name: 'A', avatar: '🦊', color: '#ff5d73' }) as { id: string };
  const w = c1.inbox[0] as Extract<ServerMsg, { t: 'welcome' }>;
  const c2 = fakeConn();
  const r2 = reg.join(room, c2, { name: 'A', avatar: '🦊', color: '#ff5d73', token: w.token }) as { id: string };
  assert.equal(r2.id, r1.id);
  assert.equal(room.members.size, 1);
  assert.ok(c1.closed);
  assert.equal(reg.owns(room, r1.id, c1), false);
  // The stale socket closing must not mark the resumed player offline.
  reg.disconnect(room, r1.id, c1);
  assert.equal(room.members.get(r1.id)!.player.online, true);
});

test('disconnected players expire, then idle rooms expire', () => {
  const { reg, tick } = setup();
  const room = reg.create()!;
  const c = fakeConn();
  const r = reg.join(room, c, { name: 'A', avatar: '🦊', color: '#ff5d73' }) as { id: string };
  reg.disconnect(room, r.id, c);
  assert.equal(room.members.get(r.id)!.player.online, false);
  tick(600);
  reg.sweep();
  assert.equal(room.members.size, 0);
  assert.ok(reg.get(room.id), 'room survives until idle timeout');
  tick(1100);
  reg.sweep();
  assert.equal(reg.get(room.id), undefined);
});
