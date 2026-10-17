// Scenario 7: limits and resilience. Pings are rate limited, a reload keeps you in the plan,
// and a server that is sent garbage keeps serving everyone.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  SPOTS,
  createPlan,
  crewIds,
  eventually,
  openPlans,
  planCards,
  rawClient,
  setup,
  toast,
  waitForCrew,
} from './harness.ts';

const { scenario } = setup();

scenario('7a. two pings in a row: the second shows a "slow down" info toast and Bob is only pinged once', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  await createPlan(ann, { kind: 'coffee', place: 'Blue Bottle', ping: true }); // ping number one
  await eventually(async () => assert.ok((await toast(bob, 'ping').count()) > 0), { message: 'Bob gets the first ping' });

  const [card] = await (await planCards(ann, 'Blue Bottle')).all();
  await card.locator('[data-testid="btn-plan-ping"]').click(); // ping number two, well inside the cooldown
  await eventually(async () => assert.match((await toast(ann, 'info').allInnerTexts()).join(' '), /slow|easy|wait|few seconds|too fast/i), {
    message: 'info toast about slowing down',
  });
  assert.ok(ann.received.some((m) => m.t === 'error' && m.code === 'slow_down'), 'the server said slow_down');
  await sleep(500);
  assert.equal(bob.received.filter((m) => m.t === 'ping').length, 1, 'the second ping never reached Bob');

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('7b. reload during a plan: Ann is the same player, the plan is still there, nobody is duplicated', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await createPlan(ann, { kind: 'dinner', place: 'Pier Burger', ping: false });
  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 1), { message: 'Bob sees the plan before the reload' });

  const idBefore = ann.id;
  await ann.reload();

  assert.equal(ann.id, idBefore, 'a reload resumes the same player');
  await waitForCrew(ann, 2);
  await waitForCrew(bob, 2);
  assert.deepEqual((await crewIds(bob)).sort(), [ann.id, bob.id].sort(), 'no ghost copy of Ann');
  await eventually(async () => assert.equal(await ann.tid('plan-x').count(), 1), { message: 'plan X is back on Ann' });
  await openPlans(ann);
  await eventually(async () => assert.equal(await ann.tid('plan-card').filter({ hasText: 'Pier Burger' }).count(), 1), {
    message: 'plan card is back on Ann',
  });
  assert.equal(await bob.tid('plan-x').count(), 1, 'Bob still has the plan');
  ann.assertNoErrors();
});

scenario('7c. hostile input: raw sockets send garbage, the server survives and the browsers keep working', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // A socket that never says hello: valid JSON that is not an object, and things that are not JSON.
  const stranger = await s.raw(ann.roomId);
  for (const text of ['null', '7', '[]', '"x"', 'true', '{', '', '{"t":null}', '{"t":"nope"}', '{"__proto__":{"t":"leave"}}', '{"t":"pos","lat":1,"lng":2}']) {
    stranger.sendText(text);
  }
  await stranger.waitFor((m) => m.t === 'error' && m.code === 'bad_message');

  // A socket that joined and then misbehaves: wrong types, huge numbers, a prototype key, then leaves.
  const mallory = await s.raw(ann.roomId);
  await mallory.hello('Mallory', SPOTS.cat);
  for (const msg of [
    { t: 'pos', lat: 'x', lng: null },
    { t: 'pos', lat: 91, lng: 0 },
    { t: 'sharing', on: 'yes' },
    { t: 'mood', mood: { a: 1 }, note: [] },
    { t: 'plan', kind: {}, place: [], lat: 'a', lng: {} },
    { t: 'plan', kind: 'lunch', place: 'Nowhere', lat: 1e999, lng: 0 },
    { t: 'plan_join', id: {} },
    { t: 'plan_cancel', id: 7 },
    { t: 'plan_ping', id: null },
    { t: 'bubble', emoji: {}, text: { a: 1 } },
    { t: 'hello', name: { a: 1 } },
    { t: 'constructor' },
  ]) {
    mallory.send(msg);
  }
  mallory.sendText('{"t":"pos","lat":1e999,"lng":0}'); // JSON.parse turns this into Infinity
  assert.equal(await s.server.healthy(), true, 'server still answers');
  assert.ok(s.server.alive(), `server process still running:\n${s.server.log()}`);

  mallory.send({ t: 'leave' });
  await bob.waitForMessage((m) => m.t === 'left' && m.id === mallory.id);

  // The browsers still work: they show the same two people, and a newcomer shows up live and leaves again.
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  const carl = await rawClient(s.baseUrl, ann.roomId);
  try {
    await carl.hello('Carl', SPOTS.cat);
    await Promise.all([waitForCrew(ann, 3), waitForCrew(bob, 3)]);
    carl.send({ t: 'leave' });
    await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  } finally {
    carl.close();
  }
  // And a fresh browser can still join.
  const dee = await s.player('Dee', SPOTS.cat, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(dee, 3), waitForCrew(ann, 3)]);

  ann.assertNoErrors();
  bob.assertNoErrors();
  dee.assertNoErrors();
});

scenario('7d. an oversized websocket frame only drops that socket, the server and the room carry on', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  await waitForCrew(ann, 1);
  // Too big for the server's 2 KB frame limit: only the offending socket may be cut.
  const oversized = await s.raw(ann.roomId);
  oversized.sendText(JSON.stringify({ t: 'hello', name: 'x'.repeat(5000) }));
  await eventually(() => assert.ok(oversized.closed, 'oversized frame closes that socket'));
  assert.ok(s.server.alive(), `server process died on an oversized frame:\n${s.server.log().split('\n').slice(0, 6).join('\n')}`);
  assert.equal(await s.server.healthy(), true, 'server still answers');
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  ann.assertNoErrors();
});
