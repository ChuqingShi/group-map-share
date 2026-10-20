// Scenarios 12 to 14: dragging a flag onto the map, typing your own mood, and organizers.
import assert from 'node:assert/strict';
import { MOOD_EMOJI, type ServerMsg } from '../shared/protocol.ts';
import {
  SPOTS,
  avatarMood,
  eventually,
  openPlans,
  openSettings,
  openSheet,
  closeSheet,
  setToggle,
  setup,
  waitForCrew,
  type Player,
} from './harness.ts';

const { scenario } = setup();

/** Press the flag button and drag it to a point over the map, like a thumb would. */
async function dragFlagTo(p: Player, x: number, y: number) {
  const box = await p.tid('btn-plans').boundingBox();
  assert.ok(box, 'the flag button is on screen');
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await p.page.mouse.move(box.x + box.width / 2 + 20, box.y - 60, { steps: 4 });
  assert.equal(await p.tid('flag-ghost').count(), 1, 'a flag follows the finger while dragging');
  await p.page.mouse.move(x, y, { steps: 8 });
  await p.page.mouse.up();
}

scenario('12. drag the flag onto the map: one gesture and one tap plant it, and everyone sees it', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // Dropping it back on the toolbar means never mind.
  const bar = await ann.tid('btn-mood').boundingBox();
  await dragFlagTo(ann, bar!.x + 10, bar!.y + 10);
  assert.equal(await ann.tid('plan-form').isVisible(), false, 'dropped on the toolbar: cancelled');
  assert.equal(await ann.tid('flag-ghost').count(), 0, 'the ghost is gone');

  // A tap still opens the list of flags.
  await ann.tid('btn-plans').click();
  await ann.tid('plans-panel').waitFor({ state: 'visible' });
  await closeSheet(ann, 'plans-panel');

  // Drag onto the map: the flag card opens already filled in. One tap plants it.
  const vp = ann.page.viewportSize()!;
  await dragFlagTo(ann, vp.width / 2, vp.height / 3);
  await ann.tid('plan-form').waitFor({ state: 'visible' });
  assert.equal(await ann.tid('plan-place').inputValue(), 'Meet here', 'no named place under the drop, so a sensible default');
  assert.equal(await ann.tid('plan-draft').count(), 1, 'a ghost flag shows where it will go');
  await ann.tid('btn-plan-create').click();

  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 1), { message: 'Bob sees the flag' });
  await eventually(async () => assert.equal(await ann.tid('plan-x').count(), 1), { message: 'Ann sees her flag' });
  const created = ann.sent.filter((m) => m.t === 'plan');
  assert.equal(created.length, 1);
  assert.equal(created[0].t === 'plan' && created[0].place, 'Meet here');
  assert.equal(created[0].t === 'plan' && created[0].ping, true, 'the crew is pinged by default');

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('13. type your own mood: any short text, any emoji or none, and the recent ones come back as one-tap chips', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  await openSheet(ann, 'btn-mood', 'mood-sheet');
  assert.equal(await ann.tid('mood-sheet').locator('[data-testid^="mood-"]').count() > 8, true, 'common moods plus the custom controls');
  await ann.tid('mood-custom-text').fill('Dreaming of tacos');
  await ann.tid('mood-emoji').nth(1).click(); // the second quick emoji
  await ann.tid('btn-mood-share').click();
  const msg = await bob.waitForMessage<Extract<ServerMsg, { t: 'player' }>>((m) => m.t === 'player' && m.player.id === ann.id && m.player.mood?.id === 'custom');
  assert.equal(msg.player.mood?.label, 'Dreaming of tacos');
  assert.ok((msg.player.mood?.emoji ?? '').length > 0);
  await eventually(async () => assert.ok(await avatarMood(bob, ann.id, msg.player.mood!.emoji)), { message: "Ann's own emoji on her avatar (Bob's screen)" });

  // No emoji at all: the avatar shows a speech bubble instead.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-emoji-none').click();
  await ann.tid('mood-custom-text').fill('Just here');
  await ann.tid('btn-mood-share').click();
  await eventually(async () => assert.ok(await avatarMood(bob, ann.id, '💬')), { message: 'blank emoji shows a speech bubble' });

  // Recents: one tap re-applies an earlier custom mood.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  const chips = ann.tid('mood-recent');
  await eventually(async () => assert.ok((await chips.count()) >= 2), { message: 'recent moods are offered' });
  await chips.filter({ hasText: 'Dreaming of tacos' }).first().click();
  await eventually(async () => assert.equal((await ann.sent.filter((m) => m.t === 'mood').at(-1)) !== undefined, true));
  await eventually(async () => assert.ok(await avatarMood(bob, ann.id, msg.player.mood!.emoji)), { message: 'the recent mood is back' });

  // Presets still carry their emoji.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-tired').click();
  await eventually(async () => assert.ok(await avatarMood(bob, ann.id, MOOD_EMOJI.tired)), { message: 'preset mood' });

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('14. organizers: with none everyone plants flags; with one, only organizers do (server enforced)', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // Nobody is an organizer: Bob has the whole flag feature.
  await openPlans(bob);
  assert.equal(await bob.tid('btn-new-plan').count(), 1, 'no organizer: everyone plants');
  assert.equal(await bob.tid('organizers-only').count(), 0);
  await closeSheet(bob, 'plans-panel');

  // Ann ticks "I'm an organizer" in settings.
  await openSettings(ann);
  await setToggle(ann.tid('btn-organizer'), true);
  await closeSheet(ann, 'settings-sheet');
  await eventually(async () => assert.equal(await bob.tid('crew-organizer').count(), 1), { message: "a star on Ann's avatar (Bob's screen)" });

  // Bob now sees the notice instead of the button, and the drag does nothing.
  await openPlans(bob);
  await eventually(async () => assert.equal(await bob.tid('btn-new-plan').count(), 0), { message: "Bob's plant button is gone" });
  assert.equal(await bob.tid('organizers-only').count(), 1);
  await closeSheet(bob, 'plans-panel');
  const vp = bob.page.viewportSize()!;
  await dragFlagTo(bob, vp.width / 2, vp.height / 3).catch(() => {}); // the drag never starts, so no ghost: that is the point
  assert.equal(await bob.tid('plan-form').isVisible(), false, 'no flag card for a non-organizer');

  // The server enforces it, so a script that skips the UI gets nowhere.
  const carl = await s.raw(ann.roomId);
  await carl.hello('Carl', SPOTS.cat);
  carl.send({ t: 'plan', kind: 'coffee', place: 'Blue Bottle', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: false });
  const err = await carl.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error' && m.code === 'organizers_only');
  assert.equal(err.code, 'organizers_only');
  assert.equal(await ann.tid('plan-x').count(), 0, 'nothing was planted');

  // The organizer can plant.
  const planted = ann.sent.length;
  await ann.page.evaluate(() => undefined);
  await openPlans(ann);
  assert.equal(await ann.tid('btn-new-plan').count(), 1, 'organizers keep the button');
  await closeSheet(ann, 'plans-panel');

  // Bob makes himself an organizer too (it is self-declared), and can plant again.
  await openSettings(bob);
  await setToggle(bob.tid('btn-organizer'), true);
  await closeSheet(bob, 'settings-sheet');
  await eventually(async () => assert.equal(await ann.tid('crew-organizer').count(), 2), { message: 'two stars' });
  await openPlans(bob);
  await eventually(async () => assert.equal(await bob.tid('btn-new-plan').count(), 1), { message: 'Bob can plant now' });

  // When the last organizers step down it opens up for everyone again.
  await closeSheet(bob, 'plans-panel');
  for (const p of [ann, bob]) {
    await openSettings(p);
    await setToggle(p.tid('btn-organizer'), false);
    await closeSheet(p, 'settings-sheet');
  }
  await eventually(async () => assert.equal(await ann.tid('crew-organizer').count(), 0), { message: 'no stars left' });
  carl.send({ t: 'plan', kind: 'coffee', place: 'Open again', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: false });
  await eventually(async () => assert.equal(await ann.tid('plan-x').count(), 1), { message: 'with no organizer everyone plants again' });
  void planted;

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('14b. the join form has an organizer checkbox that is off by default and is sent with hello', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { join: false });
  const form = ann.tid('join-form');
  await form.waitFor({ state: 'visible' });
  assert.equal(await ann.tid('join-organizer').isChecked(), false, 'off by default');
  await ann.page.locator('input[placeholder="e.g. Sam"]').fill('Ann');
  await ann.tid('join-organizer').check();
  await form.locator('button', { hasText: 'Join' }).first().click();
  await eventually(() => assert.ok(ann.sent.some((m) => m.t === 'hello' && m.organizer === true)), { message: 'hello carries organizer: true' });
  await eventually(async () => assert.equal(await ann.tid('crew-organizer').count(), 1), { message: 'Ann shows a star' });
  ann.assertNoErrors();
});
