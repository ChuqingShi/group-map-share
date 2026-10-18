import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry, type Conn } from '../server/rooms.ts';
import { FAREWELL_MAX, MAX_FAREWELLS_PER_ROOM, type ServerMsg } from '../shared/protocol.ts';

function fakeConn() {
  const inbox: ServerMsg[] = [];
  const conn: Conn & { inbox: ServerMsg[] } = { inbox, send: (m) => inbox.push(m), close: () => {} };
  return conn;
}

function twoPeople() {
  let now = 9_000_000;
  const reg = new RoomRegistry({ now: () => now, offlineGraceMs: 500, ghostGraceMs: 100 });
  const room = reg.create('Beach day')!;
  const ca = fakeConn();
  const cb = fakeConn();
  const a = reg.join(room, ca, { name: 'Ann', avatar: '🦊', color: '#ff5d73' });
  const b = reg.join(room, cb, { name: 'Bob', avatar: '🐸', color: '#3ddc84' });
  assert.ok('id' in a && 'id' in b);
  return { reg, room, ca, cb, a: a.id, b: b.id, tick: (ms: number) => (now += ms) };
}

test('a rating and a parting message are kept and shown to everyone who is still there', () => {
  const { reg, room, ca, b, a } = twoPeople();
  reg.leave(room, b, { rating: 4, text: 'Thanks for a great day!' });
  assert.equal(room.members.has(b), false, 'Bob is gone');
  assert.equal(room.farewells.length, 1);
  assert.deepEqual({ name: room.farewells[0].name, avatar: room.farewells[0].avatar, rating: room.farewells[0].rating, text: room.farewells[0].text }, { name: 'Bob', avatar: '🐸', rating: 4, text: 'Thanks for a great day!' });
  const told = ca.inbox.find((m) => m.t === 'farewell');
  assert.ok(told && told.t === 'farewell' && told.farewell.text === 'Thanks for a great day!' && told.farewell.rating === 4, 'Ann hears it');
  assert.ok(room.members.has(a));
});

test('a rating alone or a message alone is fine; nothing at all leaves nothing behind', () => {
  const { reg, room, b, a } = twoPeople();
  reg.leave(room, b, { rating: 5 });
  assert.deepEqual(room.farewells.map((f) => [f.rating, f.text]), [[5, '']]);
  const c = reg.join(room, fakeConn(), { name: 'Cy', avatar: '🐙', color: '#4da3ff' });
  assert.ok('id' in c);
  reg.leave(room, c.id, { text: 'See you next time' });
  assert.deepEqual(room.farewells.map((f) => [f.rating, f.text]), [[5, ''], [null, 'See you next time']]);
  reg.leave(room, a, {});
  reg.leave(room, 'nobody', { rating: 5 });
  assert.equal(room.farewells.length, 2, 'an empty farewell is not stored');
});

test('only whole stars from 1 to 5 count, and messages are cleaned and capped', () => {
  for (const bad of [0, 6, 3.5, -1, NaN, Infinity, '5', null, undefined, {}, [5]]) {
    const { reg, room, b } = twoPeople();
    reg.leave(room, b, { rating: bad as unknown });
    assert.equal(room.farewells.length, 0, `rating ${String(bad)} alone leaves nothing`);
  }
  const { reg, room, b } = twoPeople();
  reg.leave(room, b, { rating: 9, text: `  Hi\u0000 ‮ there   ${'x'.repeat(500)}` });
  const f = room.farewells[0];
  assert.equal(f.rating, null, 'a bad rating is dropped but the message stays');
  assert.ok(!/[\u0000‮]/.test(f.text));
  assert.ok([...f.text].length <= FAREWELL_MAX);
  assert.ok(f.text.startsWith('Hi there'));
});

test('someone who joins later gets the farewells in their welcome', () => {
  const { reg, room, b } = twoPeople();
  reg.leave(room, b, { rating: 3, text: 'Fun!' });
  const late = fakeConn();
  reg.join(room, late, { name: 'Cy', avatar: '🐙', color: '#4da3ff' });
  const welcome = late.inbox[0];
  assert.ok(welcome.t === 'welcome' && welcome.farewells.length === 1 && welcome.farewells[0].text === 'Fun!');
});

test('an event keeps its newest hundred farewells', () => {
  const { reg, room } = twoPeople();
  for (let i = 0; i < MAX_FAREWELLS_PER_ROOM + 5; i++) {
    const p = reg.join(room, fakeConn(), { name: `P${i}`, avatar: '🦊', color: '#ff5d73' });
    assert.ok('id' in p);
    reg.leave(room, p.id, { text: `n${i}` });
  }
  assert.equal(room.farewells.length, MAX_FAREWELLS_PER_ROOM);
  assert.equal(room.farewells[0].text, 'n5');
  assert.equal(room.farewells.at(-1)!.text, `n${MAX_FAREWELLS_PER_ROOM + 4}`);
});

test('dropping a quiet player after a long absence is not a farewell', () => {
  const { reg, room, tick, b, cb } = twoPeople();
  reg.disconnect(room, b, cb);
  tick(10_000);
  reg.sweep();
  assert.equal(room.members.has(b), false);
  assert.equal(room.farewells.length, 0);
});

test('farewells survive a restart through the snapshot, and tampered ones are skipped', () => {
  const { reg, room, b } = twoPeople();
  reg.leave(room, b, { rating: 5, text: 'Loved it' });
  const snap = JSON.parse(JSON.stringify(reg.toSnapshot()));
  const back = new RoomRegistry();
  assert.equal(back.restore(snap), 1);
  assert.deepEqual(back.get(room.id)!.farewells.map((f) => [f.name, f.rating, f.text]), [['Bob', 5, 'Loved it']]);

  snap.rooms[0].farewells = [null, 7, { id: 'f1', rating: 99, text: '' }, { id: '../x', rating: 3, text: 'bad id' }, { id: 'f2', name: 'Eve', avatar: 'nope', rating: 2, text: 'ok\u0000' }, 'x'];
  const other = new RoomRegistry();
  other.restore(snap);
  const kept = other.get(room.id)!.farewells;
  assert.equal(kept.length, 1);
  assert.deepEqual([kept[0].name, kept[0].rating, kept[0].text], ['Eve', 2, 'ok']);

  snap.rooms[0].farewells = 'not a list';
  const third = new RoomRegistry();
  third.restore(snap);
  assert.deepEqual(third.get(room.id)!.farewells, []);
});
