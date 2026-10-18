// Scenario 19: the host saves events to disk, so a redeploy (or a crash) does not end the event.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { MOOD_EMOJI } from '../shared/protocol.ts';
import { SPOTS, avatarOffline, closeSheet, createPlan, eventually, openPlans, setup, waitForCrew, type Player, type Scenario } from './harness.ts';

const { scenario } = setup({ persist: true });

/** Ann (hungry, with a flag, an organizer) and Bob (in on the flag) in a named event. */
async function liveEvent(s: Scenario) {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Dinner crew' });
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await ann.tid('btn-mood').click();
  await ann.tid('mood-hungry').click();
  await createPlan(ann, { kind: 'dinner', place: "Joe's Tacos", ping: false });
  await openPlans(bob);
  await bob.tid('btn-plan-join').click();
  await eventually(async () => assert.match(await bob.tid('plan-card').first().innerText(), /2 going/), { message: 'Bob is in' });
  await closeSheet(bob, 'plans-panel');
  return { ann, bob, annId: ann.id, bobId: bob.id };
}

/** Everything is as it was: same people, same ids, the flag with both RSVPs, Ann's mood, the event name. */
async function assertEventIntact(s: Scenario, ann: Player, bob: Player, annId: string, bobId: string) {
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${ann.roomId}`)).status, 200, 'the restarted server still has the event');
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  for (const viewer of [ann, bob]) {
    await eventually(async () => {
      assert.equal(await avatarOffline(viewer, annId), false, 'Ann is back online');
      assert.equal(await avatarOffline(viewer, bobId), false, 'Bob is back online');
    }, { message: `${viewer.name}: everyone reconnected on their own` });
  }
  assert.equal(ann.id, annId, 'Ann is the same player');
  assert.equal(bob.id, bobId, 'Bob is the same player');

  await openPlans(bob);
  await eventually(async () => assert.equal(await bob.tid('plan-card').count(), 1), { message: 'the flag survived' });
  assert.match(await bob.tid('plan-card').first().innerText(), /Joe's Tacos/i);
  assert.match(await bob.tid('plan-card').first().innerText(), /2 going/, 'both RSVPs survived');
  await closeSheet(bob, 'plans-panel');

  await bob.page.locator(`[data-testid="crew-avatar"][data-player-id="${annId}"]`).click();
  await eventually(async () => assert.match(await bob.tid('card-mood').innerText(), new RegExp(`${MOOD_EMOJI.hungry}.*Hungry`)), { message: "Ann's mood survived" });
  await closeSheet(bob, 'person-card');
  ann.assertNoErrors();
  bob.assertNoErrors();
}

scenario('19. a redeploy does not end the event: everyone is back, flags and RSVPs included', async (s) => {
  const { ann, bob, annId, bobId } = await liveEvent(s);
  await s.server.restart(); // SIGTERM, like Render stopping the old version
  await assertEventIntact(s, ann, bob, annId, bobId);
}, { timeout: 90_000 });

scenario('19b. a crash does not end it either (at most the last few seconds are lost)', async (s) => {
  const { ann, bob, annId, bobId } = await liveEvent(s);
  await sleep(3_500); // the saver runs every few seconds
  await s.server.restart({ hard: true }); // SIGKILL: no chance to say goodbye
  await assertEventIntact(s, ann, bob, annId, bobId);
}, { timeout: 90_000 });
