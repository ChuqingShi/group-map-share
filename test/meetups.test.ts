// Moods, meetup plans and spoken pings: room logic plus one real WebSocket session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { RoomRegistry, cleanText, type Conn } from '../server/rooms.ts';
import { MAX_PLANS_PER_PLAYER, PLACE_MAX, type Plan, type ServerMsg } from '../shared/protocol.ts';

function fakeConn() {
  const inbox: ServerMsg[] = [];
  const conn: Conn & { inbox: ServerMsg[] } = { inbox, send: (m) => inbox.push(m), close: () => {} };
  return conn;
}

function setup() {
  let now = 1_000_000;
  const reg = new RoomRegistry({
    now: () => now,
    minPlanIntervalMs: 100,
    pingCooldownMs: 1000,
    bubbleCooldownMs: 500,
    moodTtlMs: 5000,
    planTtlMs: 5000,
    idleMs: 60_000,
  });
  const room = reg.create()!;
  const join = (name: string) => {
    const conn = fakeConn();
    const r = reg.join(room, conn, { name, avatar: '🦊', color: '#ff5d73' }) as { id: string };
    return { id: r.id, conn };
  };
  return { reg, room, join, tick: (ms: number) => (now += ms) };
}

const lunch = { kind: 'lunch', place: "Joe's Tacos", lat: 34.01, lng: -118.49 } as const;
const pingsIn = (c: { inbox: ServerMsg[] }) => c.inbox.filter((m) => m.t === 'ping');
const errorsIn = (c: { inbox: ServerMsg[] }) => c.inbox.flatMap((m) => (m.t === 'error' ? [m.code] : []));

test('moods are set, cleared, validated and go stale', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  const b = join('Bob');
  reg.setMood(room, a.id, 'hungry', '  tacos?\n ');
  assert.deepEqual(room.members.get(a.id)!.player.mood?.id, 'hungry');
  assert.equal(room.members.get(a.id)!.player.mood?.note, 'tacos?');
  const seen = b.conn.inbox.findLast((m) => m.t === 'player' && m.player.id === a.id);
  assert.equal(seen?.t === 'player' && seen.player.mood?.id, 'hungry');

  reg.setMood(room, a.id, 'not-a-mood', '');
  assert.equal(room.members.get(a.id)!.player.mood?.id, 'hungry', 'unknown mood is ignored');
  reg.setMood(room, a.id, null, '');
  assert.equal(room.members.get(a.id)!.player.mood, null);

  reg.setMood(room, a.id, 'tired', '');
  tick(5100);
  reg.sweep();
  assert.equal(room.members.get(a.id)!.player.mood, null, 'stale mood cleared by sweep');
});

test('a plan starts with its creator joined and is broadcast with the name frozen in', () => {
  const { reg, room, join } = setup();
  const a = join('Eric');
  const b = join('Bob');
  const plan = reg.createPlan(room, a.id, { ...lunch, note: 'my treat' })!;
  assert.deepEqual(plan.joined, [a.id]);
  assert.equal(plan.byName, 'Eric');
  assert.equal(plan.note, 'my treat');
  assert.ok(b.conn.inbox.some((m) => m.t === 'plan' && m.plan.id === plan.id));
  assert.equal(pingsIn(b.conn).length, 0, 'no ping unless asked');

  const late = join('Late');
  const welcome = late.conn.inbox[0] as Extract<ServerMsg, { t: 'welcome' }>;
  assert.deepEqual(welcome.plans.map((p) => p.id), [plan.id], 'late joiners get existing plans');
});

test('bad plans are refused with an error to the sender only', () => {
  const { reg, room, join } = setup();
  const a = join('Ann');
  const b = join('Bob');
  assert.equal(reg.createPlan(room, a.id, { ...lunch, kind: 'brunch' }), null);
  assert.equal(reg.createPlan(room, a.id, { ...lunch, place: '   ' }), null);
  assert.equal(reg.createPlan(room, a.id, { ...lunch, lat: 123 }), null);
  assert.equal(reg.createPlan(room, a.id, { ...lunch, lng: Number.NaN }), null);
  assert.equal(reg.createPlan(room, a.id, { ...lunch, lat: '34' }), null);
  assert.deepEqual(errorsIn(a.conn), ['bad_plan', 'bad_plan', 'bad_plan', 'bad_plan', 'bad_plan']);
  assert.equal(errorsIn(b.conn).length, 0);
  assert.equal(room.plans.size, 0);
});

test('place text is cleaned and capped', () => {
  assert.equal(cleanText('  Joe\u0000​’s \n Tacos ', 40), 'Joe’s Tacos');
  assert.equal(cleanText(42, 40), '');
  const { reg, room, join } = setup();
  const a = join('Ann');
  const plan = reg.createPlan(room, a.id, { ...lunch, place: 'x'.repeat(500) })!;
  assert.equal([...plan.place].length, PLACE_MAX);
});

test('plans are limited per player and per room, and creation is throttled', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  for (let i = 0; i < MAX_PLANS_PER_PLAYER; i++) {
    tick(150);
    assert.ok(reg.createPlan(room, a.id, lunch), `plan ${i + 1}`);
  }
  tick(150);
  assert.equal(reg.createPlan(room, a.id, lunch), null);
  assert.equal(errorsIn(a.conn).at(-1), 'plan_limit');

  const b = join('Bob');
  tick(150);
  assert.ok(reg.createPlan(room, b.id, lunch));
  assert.equal(reg.createPlan(room, b.id, lunch), null, 'second plan inside the throttle window');
  assert.equal(errorsIn(b.conn).at(-1), 'slow_down');
});

test('people opt in and out of a plan; only the creator can cancel it', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  const b = join('Bob');
  tick(150);
  const plan = reg.createPlan(room, a.id, lunch)!;
  reg.joinPlan(room, b.id, plan.id);
  reg.joinPlan(room, b.id, plan.id); // idempotent
  assert.deepEqual(room.plans.get(plan.id)!.joined, [a.id, b.id]);
  reg.leavePlan(room, b.id, plan.id);
  assert.deepEqual(room.plans.get(plan.id)!.joined, [a.id]);
  reg.joinPlan(room, b.id, 'nope'); // unknown plan: ignored

  reg.cancelPlan(room, b.id, plan.id);
  assert.ok(room.plans.has(plan.id), 'non-creator cannot cancel');
  reg.cancelPlan(room, a.id, plan.id);
  assert.equal(room.plans.size, 0);
  assert.ok(b.conn.inbox.some((m) => m.t === 'plan_gone' && m.id === plan.id));
});

test('when a player leaves, their plans vanish and they drop out of others', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  const b = join('Bob');
  tick(150);
  const mine = reg.createPlan(room, a.id, lunch)!;
  tick(150);
  const bobs = reg.createPlan(room, b.id, { ...lunch, place: 'Bar' })!;
  reg.joinPlan(room, a.id, bobs.id);
  reg.leave(room, a.id);
  assert.equal(room.plans.has(mine.id), false);
  assert.deepEqual(room.plans.get(bobs.id)!.joined, [b.id]);
});

test('plans expire', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  tick(150);
  reg.createPlan(room, a.id, lunch);
  tick(5100);
  reg.sweep();
  assert.equal(room.plans.size, 0);
});

test('a ping reaches everyone except the creator, only the creator can send it, and it is rate limited', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Eric');
  const b = join('Bob');
  const c = join('Cy');
  tick(150);
  const plan = reg.createPlan(room, a.id, { ...lunch, ping: true })!;
  assert.equal(pingsIn(b.conn).length, 1);
  assert.equal(pingsIn(c.conn).length, 1);
  assert.equal(pingsIn(a.conn).length, 0, 'creator is not pinged');
  const ping = pingsIn(b.conn)[0] as Extract<ServerMsg, { t: 'ping' }>;
  assert.equal((ping.plan as Plan).byName, 'Eric');

  assert.equal(reg.pingPlan(room, b.id, plan.id), false, 'not the creator');
  tick(500);
  assert.equal(reg.pingPlan(room, a.id, plan.id), false, 'inside the cooldown');
  assert.equal(errorsIn(a.conn).at(-1), 'slow_down');
  assert.equal(pingsIn(b.conn).length, 1);
  tick(600);
  assert.equal(reg.pingPlan(room, a.id, plan.id), true);
  assert.equal(pingsIn(b.conn).length, 2);
});

test('a plan created during the ping cooldown still exists but is not announced', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Eric');
  const b = join('Bob');
  tick(150);
  reg.createPlan(room, a.id, { ...lunch, ping: true });
  tick(150);
  const second = reg.createPlan(room, a.id, { ...lunch, place: 'Bar', ping: true })!;
  assert.ok(room.plans.has(second.id));
  assert.equal(pingsIn(b.conn).length, 1);
  assert.equal(errorsIn(a.conn).at(-1), 'slow_down');
});

test('thought bubbles are cleaned, capped, rate limited and sent to everyone including the sender', () => {
  const { reg, room, join, tick } = setup();
  const a = join('Ann');
  const b = join('Bob');
  const bubbles = (c: { inbox: ServerMsg[] }) => c.inbox.filter((m) => m.t === 'bubble') as Extract<ServerMsg, { t: 'bubble' }>[];
  reg.say(room, a.id, '🍔', '  Lunch\u0000 time!  ');
  assert.equal(bubbles(a.conn).length, 1, 'sender sees their own bubble too');
  assert.equal(bubbles(b.conn)[0].text, 'Lunch time!');
  assert.equal(bubbles(b.conn)[0].from, a.id);

  reg.say(room, a.id, '🍔', 'again right away');
  assert.equal(bubbles(b.conn).length, 1, 'inside the cooldown');
  assert.equal(errorsIn(a.conn).at(-1), 'slow_down');

  tick(600);
  reg.say(room, a.id, 'x'.repeat(50), 'y'.repeat(500));
  const last = bubbles(b.conn).at(-1)!;
  assert.equal([...last.text].length, 60);
  assert.equal([...last.emoji].length, 8);
  tick(600);
  reg.say(room, a.id, '🍔', '   ');
  assert.equal(bubbles(b.conn).length, 2, 'blank text is dropped');
  tick(600);
  reg.say(room, a.id, '', 'no emoji given');
  assert.equal(bubbles(b.conn).at(-1)!.emoji, '💭');
});

test('events have a cleaned name with a default, and the welcome carries it', () => {
  const reg = new RoomRegistry();
  assert.equal(reg.create()!.name, 'Our event');
  assert.equal(reg.create('   ')!.name, 'Our event');
  assert.equal(reg.create(42)!.name, 'Our event');
  const room = reg.create('  Team\u0000 lunch \n ')!;
  assert.equal(room.name, 'Team lunch');
  assert.equal([...reg.create('x'.repeat(200))!.name].length, 40);
  const c = fakeConn();
  reg.join(room, c, { name: 'A', avatar: '🦊', color: '#ff5d73' });
  const w = c.inbox[0] as Extract<ServerMsg, { t: 'welcome' }>;
  assert.equal(w.roomName, 'Team lunch');
});

test('closing the app keeps you in the event for hours but forgets your location in minutes', () => {
  let now = 1_000_000;
  const reg = new RoomRegistry({ now: () => now, locationTtlMs: 5 * 60_000, offlineGraceMs: 3 * 60 * 60_000, idleMs: 3 * 60 * 60_000, minPosIntervalMs: 0 });
  const room = reg.create('Lunch')!;
  const ca = fakeConn();
  const cb = fakeConn();
  const a = reg.join(room, ca, { name: 'Ann', avatar: '🦊', color: '#ff5d73' }) as { id: string };
  reg.join(room, cb, { name: 'Bob', avatar: '🐸', color: '#3ddc84' });
  const token = (ca.inbox[0] as Extract<ServerMsg, { t: 'welcome' }>).token;
  now += 100;
  reg.updatePosition(room, a.id, 34, -118, 5);
  const plan = reg.createPlan(room, a.id, { kind: 'lunch', place: 'Joe', lat: 34, lng: -118 })!;
  reg.disconnect(room, a.id, ca); // app closed

  now += 4 * 60_000;
  reg.sweep();
  assert.ok(room.members.get(a.id)!.player.pos, 'still visible (greyed) for a few minutes');

  now += 2 * 60_000; // 6 minutes offline
  reg.sweep();
  const ann = room.members.get(a.id)!.player;
  assert.equal(ann.pos, null, 'location forgotten');
  assert.equal(ann.sharing, false);
  assert.ok(room.plans.has(plan.id), 'her plan survives');
  const told = cb.inbox.findLast((m) => m.t === 'player' && m.player.id === a.id);
  assert.equal(told?.t === 'player' && told.player.pos, null, 'others were told');

  now += 2 * 60 * 60_000; // two hours later she reopens the app
  const cn = fakeConn();
  const again = reg.join(room, cn, { name: 'Ann', avatar: '🦊', color: '#ff5d73', token }) as { id: string };
  assert.equal(again.id, a.id, 'same player resumed with the saved token');
  assert.deepEqual(room.plans.get(plan.id)!.joined, [a.id], 'still going to her own plan');

  const cm = fakeConn();
  reg.disconnect(room, a.id, cn);
  now += 3 * 60 * 60_000 + 1;
  reg.sweep();
  assert.equal(room.members.has(a.id), false, 'gone after the grace window');
  assert.equal(room.plans.has(plan.id), false);
  void cm;
});

// --- one real socket session -------------------------------------------------

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

test('over a real socket: a ping arrives, and non-object JSON cannot kill the server', async () => {
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, GMS_PORT: String(port), GMS_HOST: '127.0.0.1' },
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

    const { id } = (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { id: string };
    const open = async (name: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}`);
      sockets.push(ws);
      const inbox: ServerMsg[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMsg));
      await once(ws, 'open');
      ws.send(JSON.stringify({ t: 'hello', name, avatar: '🦊', color: '#ff5d73' }));
      const until = async (pred: (m: ServerMsg) => boolean) => {
        for (let i = 0; i < 50; i++) {
          const hit = inbox.find(pred);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`timed out; got ${JSON.stringify(inbox.map((m) => m.t))}`);
      };
      await until((m) => m.t === 'welcome');
      return { ws, inbox, until };
    };

    const eric = await open('Eric');
    const bob = await open('Bob');

    // Garbage that is valid JSON but not an object used to throw inside the message handler.
    for (const junk of ['null', '7', '"hi"', '[]', 'true']) eric.ws.send(junk);
    eric.ws.send(JSON.stringify({ t: 'plan', kind: 'lunch', place: "Joe's Tacos", lat: 34.01, lng: -118.49, ping: true }));

    const ping = (await bob.until((m) => m.t === 'ping')) as Extract<ServerMsg, { t: 'ping' }>;
    assert.equal(ping.plan.place, "Joe's Tacos");
    assert.equal(ping.plan.byName, 'Eric');
    assert.equal(eric.inbox.some((m) => m.t === 'ping'), false);

    bob.ws.send(JSON.stringify({ t: 'plan_join', id: ping.plan.id }));
    const joined = (await eric.until((m) => m.t === 'plan' && m.plan.joined.length === 2)) as Extract<ServerMsg, { t: 'plan' }>;
    assert.equal(joined.plan.joined.length, 2);
    assert.equal(server.exitCode, null, `server died: ${stderr}`);
  } finally {
    for (const ws of sockets) ws.close();
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
  }
});
