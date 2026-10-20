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

scenario("4. plan and ping: Eric gets the ping, joins from the toast, trails appear, leaving removes Eric's trail", async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos", ping: true });

  // Eric: a ping toast that names the place, a thought bubble, and the X on the map.
  const ericPing = toast(eric, 'ping');
  await eventually(async () => assert.match((await ericPing.allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Eric' });
  await eventually(async () => assert.match((await eric.tid('thought').allInnerTexts()).join(' '), /Joe's Tacos/), {
    message: "thought bubble over Breeca's pin on Eric",
  });
  await eventually(async () => assert.equal(await eric.tid('plan-x').count(), 1), { message: 'plan X on Eric' });
  const planIds = await eric.tid('plan-x').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-id')));
  assert.ok(planIds[0], 'the X carries data-plan-id');
  await eventually(async () => assert.equal(await breeca.tid('plan-x').count(), 1), { message: 'plan X on Breeca' });

  // Breeca never hears their own ping.
  await staysTrue(async () => {
    assert.equal(await toast(breeca, 'ping').count(), 0, 'Breeca got a ping toast');
    assert.equal(breeca.received.filter((m) => m.t === 'ping').length, 0, 'Breeca was sent a ping');
  });
  assert.equal(eric.received.filter((m) => m.t === 'ping').length, 1, 'Eric gets exactly one ping');

  // Eric taps "I'm in" in the toast: one trail each.
  await ericPing.locator('[data-testid="btn-toast-join"]').first().click();
  await waitForPaths(eric, 2);
  await waitForPaths(breeca, 2);

  // Eric changes plans from the plans panel: back to Breeca's trail only.
  await (await planCards(eric, "Joe's Tacos")).locator('[data-testid="btn-plan-leave"]').click();
  await eventually(() => assert.ok(eric.sent.some((m) => m.t === 'plan_leave')), { message: 'Eric sent plan_leave' });
  await waitForPaths(breeca, 1); // the server's truth, as Breeca sees it
  await waitForPaths(eric, 1);

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('5. voice is passive by default: silent until Eric ticks it in settings, then the next ping is spoken once', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  assert.deepEqual(await eric.spoken(), [], 'nothing spoken on join');

  // First ping: Eric sees it but nothing is said out loud.
  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos", ping: true });
  await eventually(async () => assert.match((await toast(eric, 'ping').allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Eric' });
  await staysTrue(async () => assert.deepEqual(await eric.spoken(), [], 'spoken before voice was switched on'), 1000);

  // Voice lives only in the settings window.
  await openSettings(eric);
  assert.equal(await eric.tid('plans-panel').isVisible(), false, 'only one sheet at a time');
  await setToggle(eric.tid('btn-voice'), true);
  await closeSheet(eric, 'settings-sheet');
  assert.deepEqual(await eric.spoken(), [], 'switching voice on does not speak by itself');

  // Breeca's ping cooldown is 15 s per person and 4 s for the whole room, so a third person waits out the room's.
  await sleep(4300);
  const carl = await s.raw(breeca.roomId);
  await carl.hello('Carl', SPOTS.cat);
  carl.send({ t: 'plan', kind: 'coffee', place: 'Blue Bottle', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: true });

  await eventually(async () => assert.equal((await eric.spoken()).length, 1), { message: 'Eric hears the next ping' });
  const [line] = await eric.spoken();
  assert.match(line, /Blue Bottle/);
  assert.match(line, /Carl/);
  await sleep(1000);
  assert.equal((await eric.spoken()).length, 1, 'spoken exactly once');
  assert.deepEqual(await breeca.spoken(), [], "Breeca never turned voice on");

  breeca.assertNoErrors();
  eric.assertNoErrors();
});
