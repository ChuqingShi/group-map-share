import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomRegistry, type Conn } from '../server/rooms.ts';
import { Persister, SNAPSHOT_FILE } from '../server/persist.ts';
import type { ServerMsg } from '../shared/protocol.ts';

function fakeConn() {
  const inbox: ServerMsg[] = [];
  const conn: Conn & { inbox: ServerMsg[] } = { inbox, send: (m) => inbox.push(m), close: () => {} };
  return conn;
}

const clock = (start = 5_000_000) => {
  let now = start;
  return { now: () => now, tick: (ms: number) => (now += ms) };
};

/** An event with two people, a mood, a contact line, an organizer, a flag, an RSVP, a no thanks and a suggestion. */
function busyEvent(reg: RoomRegistry) {
  const room = reg.create('Dinner crew')!;
  const a = reg.join(room, fakeConn(), { name: 'Ann', avatar: '🦊', color: '#ff5d73', organizer: true });
  const b = reg.join(room, fakeConn(), { name: 'Bob', avatar: '🐸', color: '#3ddc84' });
  assert.ok('id' in a && 'id' in b);
  reg.updatePosition(room, a.id, 34.01, -118.49, 5);
  reg.setMood(room, a.id, 'hungry', 'so hungry');
  reg.setContact(room, b.id, 'bob@example.com');
  const plan = reg.createPlan(room, a.id, { kind: 'dinner', place: "Joe's Tacos", note: 'by the pier', lat: 34.011, lng: -118.491 })!;
  const c = reg.join(room, fakeConn(), { name: 'Cy', avatar: '🐙', color: '#4da3ff' });
  assert.ok('id' in c);
  reg.joinPlan(room, c.id, plan.id);
  reg.suggestPlan(room, b.id, plan.id, 'Thai place', 'closer'); // also counts as Bob's no thanks
  const tokenA = room.members.get(a.id)!.token;
  return { room, a: a.id, b: b.id, c: c.id, plan, tokenA };
}

test('a snapshot brings an event back with its people, flags and RSVPs, but never anyone\'s location', () => {
  const t = clock();
  const before = new RoomRegistry({ now: t.now });
  const { room, a, b, c, plan } = busyEvent(before);
  assert.ok(room.members.get(a)!.player.pos, 'Ann had a position');

  const text = JSON.stringify(before.toSnapshot());
  assert.ok(!text.includes('34.01,') && !text.includes('"pos":{'), 'no position in the file');

  const after = new RoomRegistry({ now: t.now });
  assert.equal(after.restore(JSON.parse(text)), 1);
  const back = after.get(room.id)!;
  assert.equal(back.name, 'Dinner crew');
  assert.equal(back.members.size, 3);
  const ann = back.members.get(a)!.player;
  assert.equal(ann.name, 'Ann');
  assert.equal(ann.organizer, true);
  assert.equal(ann.mood?.id, 'hungry');
  assert.equal(ann.pos, null);
  assert.equal(ann.online, false);
  assert.equal(back.members.get(b)!.player.contact, 'bob@example.com');
  const p = back.plans.get(plan.id)!;
  assert.equal(p.place, "Joe's Tacos");
  assert.deepEqual(p.joined.sort(), [a, c].sort(), 'Ann and Cy are in');
  assert.deepEqual(p.declined, [b], 'Bob said no thanks');
  assert.equal(p.suggestions.length, 1);
  assert.equal(p.suggestions[0].place, 'Thai place');
});

test('after a restart people resume as themselves with their old token', () => {
  const t = clock();
  const before = new RoomRegistry({ now: t.now });
  const { room, a, tokenA } = busyEvent(before);

  const after = new RoomRegistry({ now: t.now });
  after.restore(JSON.parse(JSON.stringify(before.toSnapshot())));
  const back = after.get(room.id)!;
  const conn = fakeConn();
  const res = after.join(back, conn, { name: 'Ann', avatar: '🦊', color: '#ff5d73', token: tokenA });
  assert.deepEqual(res, { id: a }, 'same player id');
  const welcome = conn.inbox[0];
  assert.equal(welcome.t === 'welcome' && welcome.token, tokenA);
  assert.equal(welcome.t === 'welcome' && welcome.plans.length, 1, 'her flag is still there');
  assert.equal(welcome.t === 'welcome' && welcome.roomName, 'Dinner crew');
  assert.equal(back.members.size, 3, 'no duplicate Ann');
});

test('people who never come back are still dropped on time, counted from when the event was saved', () => {
  const t = clock();
  const before = new RoomRegistry({ now: t.now, offlineGraceMs: 10_000, ghostGraceMs: 500 });
  const { room, a } = busyEvent(before);
  const after = new RoomRegistry({ now: t.now, offlineGraceMs: 10_000, ghostGraceMs: 500 });
  after.restore(JSON.parse(JSON.stringify(before.toSnapshot())));
  t.tick(11_000);
  after.sweep();
  assert.equal(after.get(room.id)?.members.has(a) ?? false, false);
});

test('damaged or hand-edited snapshots are skipped, not trusted', () => {
  const t = clock();
  const reg = new RoomRegistry({ now: t.now });
  assert.equal(reg.restore(null), 0);
  assert.equal(reg.restore('nope'), 0);
  assert.equal(reg.restore({ v: 2, rooms: [] }), 0);
  assert.equal(reg.restore({ v: 1, rooms: 'x' }), 0);
  const good = new RoomRegistry({ now: t.now });
  busyEvent(good);
  const snap = JSON.parse(JSON.stringify(good.toSnapshot()));
  const evil = {
    ...snap,
    rooms: [
      null,
      42,
      { id: 'short', members: [], plans: [] },
      { ...snap.rooms[0], id: 'x'.repeat(10) },
      // a real event whose contents have been tampered with
      {
        ...snap.rooms[0],
        id: 'tampered-room-id-0123456789',
        name: 'A‮\u0000b'.repeat(30),
        members: [
          { token: 'tok-tok-tok-tok-1', player: { id: 'p1', name: '<script>', avatar: 'not-an-avatar', color: 'red', contact: 'c'.repeat(500), mood: { id: 'bogus' } } },
          { token: 'x', player: { id: 'p2' } },
          { token: 'tok-tok-tok-tok-3', player: { id: '../etc' } },
          'garbage',
        ],
        plans: [
          { id: 'q1', by: 'p1', kind: 'dinner', place: 'ok', lat: 1, lng: 2, joined: ['p1', 'ghost', 7], declined: 'x' },
          { id: 'q2', by: 'nobody', kind: 'dinner', place: 'orphan', lat: 1, lng: 2 },
          { id: 'q3', by: 'p1', kind: 'rave', place: 'bad kind', lat: 1, lng: 2 },
          { id: 'q4', by: 'p1', kind: 'lunch', place: 'bad coords', lat: 1000, lng: 2 },
        ],
      },
    ],
  };
  const out = new RoomRegistry({ now: t.now });
  assert.equal(out.restore(evil), 1, 'only the tampered-but-usable event survives');
  const room = out.get('tampered-room-id-0123456789')!;
  assert.deepEqual([...room.members.keys()], ['p1']);
  const p1 = room.members.get('p1')!.player;
  assert.equal(p1.avatar !== 'not-an-avatar', true);
  assert.equal(p1.mood, null);
  assert.ok(p1.contact.length <= 80);
  assert.ok(!/[‮\u0000]/.test(room.name) && room.name.length <= 40);
  assert.deepEqual([...room.plans.keys()], ['q1']);
  assert.deepEqual(room.plans.get('q1')!.joined, ['p1']);
  assert.deepEqual(room.plans.get('q1')!.declined, []);
});

test('the saver writes a private file, only when something changed, and loads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'groupz-persist-'));
  const t = clock();
  const reg = new RoomRegistry({ now: t.now });
  const saver = new Persister(reg, dir);
  assert.equal(saver.load(), 0, 'nothing saved yet');
  assert.equal(saver.save(), false, 'nothing to save yet');

  const { room } = busyEvent(reg);
  assert.equal(saver.save(), true);
  const file = join(dir, SNAPSHOT_FILE);
  assert.equal(statSync(file).mode & 0o077, 0, 'only the owner can read it (it holds resume tokens)');
  assert.equal(saver.save(), false, 'unchanged, so no write');
  assert.deepEqual(readdirSync(dir), [SNAPSHOT_FILE], 'no temp file left behind');

  t.tick(60_000);
  const next = new RoomRegistry({ now: t.now });
  assert.equal(new Persister(next, dir).load(), 1);
  assert.equal(next.get(room.id)?.plans.size, 1);

  // A change shows up on the next save.
  reg.renameRoom(room, [...room.members.keys()][0], 'Renamed');
  assert.equal(saver.save(), true);
  assert.match(readFileSync(file, 'utf8'), /Renamed/);
});

test('a damaged file starts empty and is set aside; a stale one is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'groupz-persist-'));
  const t = clock();
  writeFileSync(join(dir, SNAPSHOT_FILE), '{"v":1,"savedAt":');
  const reg = new RoomRegistry({ now: t.now });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(new Persister(reg, dir).load(), 0);
  } finally {
    console.error = quiet;
  }
  assert.ok(existsSync(join(dir, `${SNAPSHOT_FILE}.bad`)), 'the broken file is kept for a look');

  const old = new RoomRegistry({ now: t.now });
  busyEvent(old);
  new Persister(old, dir).save();
  t.tick(4 * 60 * 60_000); // four hours: every event in it would have expired
  const fresh = new RoomRegistry({ now: t.now });
  assert.equal(new Persister(fresh, dir).load(), 0);
  assert.equal(fresh.rooms.size, 0);
});
