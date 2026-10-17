// Scenarios 4 and 5: plans, pings, trails, and the opt-in voice.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  SPOTS,
  closeSheet,
  createPlan,
  eventually,
  openSettings,
  planCards,
  setToggle,
  setup,
  staysTrue,
  toast,
  waitForCrew,
  waitForPaths,
} from './harness.ts';

const { scenario } = setup();

scenario('4. plan and ping: Bob gets the ping, joins from the toast, trails appear, leaving removes his', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  await createPlan(ann, { kind: 'lunch', place: "Joe's Tacos", ping: true });

  // Bob: a ping toast that names the place, a thought bubble, and the X on the map.
  const bobPing = toast(bob, 'ping');
  await eventually(async () => assert.match((await bobPing.allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Bob' });
  await eventually(async () => assert.match((await bob.tid('thought').allInnerTexts()).join(' '), /Joe's Tacos/), {
    message: "thought bubble over Ann's pin on Bob",
  });
  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 1), { message: 'plan X on Bob' });
  const planIds = await bob.tid('plan-x').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-id')));
  assert.ok(planIds[0], 'the X carries data-plan-id');
  await eventually(async () => assert.equal(await ann.tid('plan-x').count(), 1), { message: 'plan X on Ann' });

  // Ann never hears her own ping.
  await staysTrue(async () => {
    assert.equal(await toast(ann, 'ping').count(), 0, 'Ann got a ping toast');
    assert.equal(ann.received.filter((m) => m.t === 'ping').length, 0, 'Ann was sent a ping');
  });
  assert.equal(bob.received.filter((m) => m.t === 'ping').length, 1, 'Bob gets exactly one ping');

  // Bob taps "I'm in" in the toast: one trail each.
  await bobPing.locator('[data-testid="btn-toast-join"]').first().click();
  await waitForPaths(bob, 2);
  await waitForPaths(ann, 2);

  // Bob changes his mind from the plans panel: back to Ann's trail only.
  await (await planCards(bob, "Joe's Tacos")).locator('[data-testid="btn-plan-leave"]').click();
  await eventually(() => assert.ok(bob.sent.some((m) => m.t === 'plan_leave')), { message: 'Bob sent plan_leave' });
  await waitForPaths(ann, 1); // the server's truth, as Ann sees it
  await waitForPaths(bob, 1);

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('5. voice is passive by default: silent until Bob ticks it in settings, then the next ping is spoken once', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  assert.deepEqual(await bob.spoken(), [], 'nothing spoken on join');

  // First ping: Bob sees it but nothing is said out loud.
  await createPlan(ann, { kind: 'lunch', place: "Joe's Tacos", ping: true });
  await eventually(async () => assert.match((await toast(bob, 'ping').allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Bob' });
  await staysTrue(async () => assert.deepEqual(await bob.spoken(), [], 'spoken before voice was switched on'), 1000);

  // Voice lives only in the settings window.
  await openSettings(bob);
  assert.equal(await bob.tid('plans-panel').isVisible(), false, 'only one sheet at a time');
  await setToggle(bob.tid('btn-voice'), true);
  await closeSheet(bob, 'settings-sheet');
  assert.deepEqual(await bob.spoken(), [], 'switching voice on does not speak by itself');

  // Ann's ping cooldown is 15 s per person and 4 s for the whole room, so a third person waits out the room's.
  await sleep(4300);
  const carl = await s.raw(ann.roomId);
  await carl.hello('Carl', SPOTS.cat);
  carl.send({ t: 'plan', kind: 'coffee', place: 'Blue Bottle', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: true });

  await eventually(async () => assert.equal((await bob.spoken()).length, 1), { message: 'Bob hears the next ping' });
  const [line] = await bob.spoken();
  assert.match(line, /Blue Bottle/);
  assert.match(line, /Carl/);
  await sleep(1000);
  assert.equal((await bob.spoken()).length, 1, 'spoken exactly once');
  assert.deepEqual(await ann.spoken(), [], "Ann never turned voice on");

  ann.assertNoErrors();
  bob.assertNoErrors();
});
