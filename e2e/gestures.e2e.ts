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
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  // Dropping it back on the toolbar means never mind.
  const bar = await breeca.tid('btn-mood').boundingBox();
  await dragFlagTo(breeca, bar!.x + 10, bar!.y + 10);
  assert.equal(await breeca.tid('plan-form').isVisible(), false, 'dropped on the toolbar: cancelled');
  assert.equal(await breeca.tid('flag-ghost').count(), 0, 'the ghost is gone');

  // A tap still opens the list of flags.
  await breeca.tid('btn-plans').click();
  await breeca.tid('plans-panel').waitFor({ state: 'visible' });
  await closeSheet(breeca, 'plans-panel');

  // Drag onto the map: the flag card opens already filled in. One tap plants it.
  const vp = breeca.page.viewportSize()!;
  await dragFlagTo(breeca, vp.width / 2, vp.height / 3);
  await breeca.tid('plan-form').waitFor({ state: 'visible' });
  assert.equal(await breeca.tid('plan-place').inputValue(), 'Meet here', 'no named place under the drop, so a sensible default');
  assert.equal(await breeca.tid('plan-draft').count(), 1, 'a ghost flag shows where it will go');
  await breeca.tid('btn-plan-create').click();

  await eventually(async () => assert.equal(await eric.tid('plan-x').count(), 1), { message: 'Eric sees the flag' });
  await eventually(async () => assert.equal(await breeca.tid('plan-x').count(), 1), { message: 'Breeca sees the flag' });
  const created = breeca.sent.filter((m) => m.t === 'plan');
  assert.equal(created.length, 1);
  assert.equal(created[0].t === 'plan' && created[0].place, 'Meet here');
  assert.equal(created[0].t === 'plan' && created[0].ping, true, 'the crew is pinged by default');

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('13. type your own mood: any short text, any emoji or none, and the recent ones come back as one-tap chips', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  await openSheet(breeca, 'btn-mood', 'mood-sheet');
  assert.equal(await breeca.tid('mood-sheet').locator('[data-testid^="mood-"]').count() > 8, true, 'common moods plus the custom controls');
  await breeca.tid('mood-custom-text').fill('Dreaming of tacos');
  await breeca.tid('mood-emoji').nth(1).click(); // the second quick emoji
  await breeca.tid('btn-mood-share').click();
  const msg = await eric.waitForMessage<Extract<ServerMsg, { t: 'player' }>>((m) => m.t === 'player' && m.player.id === breeca.id && m.player.mood?.id === 'custom');
  assert.equal(msg.player.mood?.label, 'Dreaming of tacos');
  assert.ok((msg.player.mood?.emoji ?? '').length > 0);
  await eventually(async () => assert.ok(await avatarMood(eric, breeca.id, msg.player.mood!.emoji)), { message: "Breeca's own emoji on Breeca's avatar (Eric's screen)" });

  // No emoji at all: the avatar shows a speech bubble instead.
  await openSheet(breeca, 'btn-mood', 'mood-sheet');
  await breeca.tid('mood-emoji-none').click();
  await breeca.tid('mood-custom-text').fill('Just here');
  await breeca.tid('btn-mood-share').click();
  await eventually(async () => assert.ok(await avatarMood(eric, breeca.id, '💬')), { message: 'blank emoji shows a speech bubble' });

  // Recents: one tap re-applies an earlier custom mood.
  await openSheet(breeca, 'btn-mood', 'mood-sheet');
  const chips = breeca.tid('mood-recent');
  await eventually(async () => assert.ok((await chips.count()) >= 2), { message: 'recent moods are offered' });
  await chips.filter({ hasText: 'Dreaming of tacos' }).first().click();
  await eventually(async () => assert.equal((await breeca.sent.filter((m) => m.t === 'mood').at(-1)) !== undefined, true));
  await eventually(async () => assert.ok(await avatarMood(eric, breeca.id, msg.player.mood!.emoji)), { message: 'the recent mood is back' });

  // Presets still carry their emoji.
  await openSheet(breeca, 'btn-mood', 'mood-sheet');
  await breeca.tid('mood-tired').click();
  await eventually(async () => assert.ok(await avatarMood(eric, breeca.id, MOOD_EMOJI.tired)), { message: 'preset mood' });

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('14. organizers: with none everyone plants flags; with one, only organizers do (server enforced)', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  // Nobody is an organizer: Eric has the whole flag feature.
  await openPlans(eric);
  assert.equal(await eric.tid('btn-new-plan').count(), 1, 'no organizer: everyone plants');
  assert.equal(await eric.tid('organizers-only').count(), 0);
  await closeSheet(eric, 'plans-panel');

  // Breeca ticks "I'm an organizer" in settings.
  await openSettings(breeca);
  await setToggle(breeca.tid('btn-organizer'), true);
  await closeSheet(breeca, 'settings-sheet');
  await eventually(async () => assert.equal(await eric.tid('crew-organizer').count(), 1), { message: "a star on Breeca's avatar (Eric's screen)" });

  // Eric now sees the notice instead of the button, and the drag does nothing.
  await openPlans(eric);
  await eventually(async () => assert.equal(await eric.tid('btn-new-plan').count(), 0), { message: "Eric's plant button is gone" });
  assert.equal(await eric.tid('organizers-only').count(), 1);
  await closeSheet(eric, 'plans-panel');
  const vp = eric.page.viewportSize()!;
  await dragFlagTo(eric, vp.width / 2, vp.height / 3).catch(() => {}); // the drag never starts, so no ghost: that is the point
  assert.equal(await eric.tid('plan-form').isVisible(), false, 'no flag card for a non-organizer');

  // The server enforces it, so a script that skips the UI gets nowhere.
  const carl = await s.raw(breeca.roomId);
  await carl.hello('Carl', SPOTS.cat);
  carl.send({ t: 'plan', kind: 'coffee', place: 'Blue Bottle', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: false });
  const err = await carl.waitFor<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error' && m.code === 'organizers_only');
  assert.equal(err.code, 'organizers_only');
  assert.equal(await breeca.tid('plan-x').count(), 0, 'nothing was planted');

  // The organizer can plant.
  const planted = breeca.sent.length;
  await breeca.page.evaluate(() => undefined);
  await openPlans(breeca);
  assert.equal(await breeca.tid('btn-new-plan').count(), 1, 'organizers keep the button');
  await closeSheet(breeca, 'plans-panel');

  // Eric becomes an organizer too (it is self-declared), and can plant again.
  await openSettings(eric);
  await setToggle(eric.tid('btn-organizer'), true);
  await closeSheet(eric, 'settings-sheet');
  await eventually(async () => assert.equal(await breeca.tid('crew-organizer').count(), 2), { message: 'two stars' });
  await openPlans(eric);
  await eventually(async () => assert.equal(await eric.tid('btn-new-plan').count(), 1), { message: 'Eric can plant now' });

  // When the last organizers step down it opens up for everyone again.
  await closeSheet(eric, 'plans-panel');
  for (const p of [breeca, eric]) {
    await openSettings(p);
    await setToggle(p.tid('btn-organizer'), false);
    await closeSheet(p, 'settings-sheet');
  }
  await eventually(async () => assert.equal(await breeca.tid('crew-organizer').count(), 0), { message: 'no stars left' });
  carl.send({ t: 'plan', kind: 'coffee', place: 'Open again', lat: SPOTS.cat[0], lng: SPOTS.cat[1], ping: false });
  await eventually(async () => assert.equal(await breeca.tid('plan-x').count(), 1), { message: 'with no organizer everyone plants again' });
  void planted;

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('14b. the join form has an organizer checkbox that is off by default and is sent with hello', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { join: false });
  const form = breeca.tid('join-form');
  await form.waitFor({ state: 'visible' });
  assert.equal(await breeca.tid('join-organizer').isChecked(), false, 'off by default');
  await breeca.page.locator('input[placeholder="e.g. Sam"]').fill('Breeca');
  await breeca.tid('join-organizer').check();
  await form.locator('button', { hasText: 'Join' }).first().click();
  await eventually(() => assert.ok(breeca.sent.some((m) => m.t === 'hello' && m.organizer === true)), { message: 'hello carries organizer: true' });
  await eventually(async () => assert.equal(await breeca.tid('crew-organizer').count(), 1), { message: 'Breeca shows a star' });
  breeca.assertNoErrors();
});
