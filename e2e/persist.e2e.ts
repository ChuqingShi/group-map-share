// Scenario 19: the host saves events to disk, so a redeploy (or a crash) does not end the event.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MOOD_EMOJI } from '../shared/protocol.ts';
import { SPOTS, avatarOffline, closeSheet, createPlan, eventually, openPlans, setup, waitForCrew, type Player, type Scenario } from './harness.ts';

const { scenario } = setup({ persist: true });

/** Breeca (hungry, with a flag, an organizer) and Eric (in on the flag) in a named event. */
async function liveEvent(s: Scenario) {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Dinner crew' });
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  await breeca.tid('btn-mood').click();
  await breeca.tid('mood-hungry').click();
  await createPlan(breeca, { kind: 'dinner', place: "Joe's Tacos", ping: false });
  await openPlans(eric);
  await eric.tid('btn-plan-join').click();
  await eventually(async () => assert.match(await eric.tid('plan-card').first().innerText(), /2 going/), { message: 'Eric is in' });
  await closeSheet(eric, 'plans-panel');
  return { breeca, eric, breecaId: breeca.id, ericId: eric.id };
}

/** Everything is as it was: same people, same ids, the flag with both RSVPs, Breeca's mood, the event name. */
async function assertEventIntact(s: Scenario, breeca: Player, eric: Player, breecaId: string, ericId: string) {
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${breeca.roomId}`)).status, 200, 'the restarted server still has the event');
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  for (const viewer of [breeca, eric]) {
    await eventually(async () => {
      assert.equal(await avatarOffline(viewer, breecaId), false, 'Breeca is back online');
      assert.equal(await avatarOffline(viewer, ericId), false, 'Eric is back online');
    }, { message: `${viewer.name}: everyone reconnected on their own` });
  }
  assert.equal(breeca.id, breecaId, 'Breeca is the same player');
  assert.equal(eric.id, ericId, 'Eric is the same player');

  await openPlans(eric);
  await eventually(async () => assert.equal(await eric.tid('plan-card').count(), 1), { message: 'the flag survived' });
  assert.match(await eric.tid('plan-card').first().innerText(), /Joe's Tacos/i);
  assert.match(await eric.tid('plan-card').first().innerText(), /2 going/, 'both RSVPs survived');
  await closeSheet(eric, 'plans-panel');

  await eric.page.locator(`[data-testid="crew-avatar"][data-player-id="${breecaId}"]`).click();
  await eventually(async () => assert.match(await eric.tid('card-mood').innerText(), new RegExp(`${MOOD_EMOJI.hungry}.*Hungry`)), { message: "Breeca's mood survived" });
  await closeSheet(eric, 'person-card');
  breeca.assertNoErrors();
  eric.assertNoErrors();
}

scenario('19. a redeploy does not end the event: everyone is back, flags and RSVPs included', async (s) => {
  const { breeca, eric, breecaId, ericId } = await liveEvent(s);
  await s.server.restart(); // SIGTERM, like Render stopping the old version
  await assertEventIntact(s, breeca, eric, breecaId, ericId);
}, { timeout: 90_000 });

scenario('19b. a crash does not end it either (at most the last few seconds are lost)', async (s) => {
  const { breeca, eric, breecaId, ericId } = await liveEvent(s);
  await sleep(3_500); // the saver runs every few seconds
  await s.server.restart({ hard: true }); // SIGKILL: no chance to say goodbye
  await assertEventIntact(s, breeca, eric, breecaId, ericId);
}, { timeout: 90_000 });
