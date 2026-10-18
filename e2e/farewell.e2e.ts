// Scenario 21: leaving the event. A farewell sheet offers a star rating and a parting message; both stay with the event.
import assert from 'node:assert/strict';
import { SPOTS, closeSheet, eventually, leaveRoom, openSettings, setup, toast, waitForCrew, type Player } from './harness.ts';

const { scenario } = setup();

const summary = (p: Player) => p.tid('farewell-summary');

scenario('21. leaving: rate the event and leave a parting message, and the crew sees it', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Beach day' });
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // Backing out of the sheet changes nothing, and nothing is shown before anyone has left a farewell.
  await openSettings(ann);
  assert.equal(await summary(ann).count(), 0, 'no farewells yet');
  await closeSheet(ann, 'settings-sheet');

  // The farewell sheet: stars toggle, the message counts down, and Leave sends both.
  await openSettings(bob);
  await bob.tid('btn-leave').click();
  await bob.tid('farewell-sheet').waitFor({ state: 'visible' });
  assert.match(await bob.tid('btn-farewell-leave').innerText(), /leave for good/i, 'with nothing filled in it just leaves');
  await bob.tid('star-4').click();
  assert.equal(await bob.tid('star-4').getAttribute('aria-pressed'), 'true');
  assert.equal(await bob.tid('star-5').getAttribute('aria-pressed'), 'false');
  await bob.tid('farewell-text').fill('Thanks for a great day!');
  assert.match(await bob.tid('btn-farewell-leave').innerText(), /leave with this/i);
  await bob.tid('btn-farewell-leave').click();

  await eventually(() => assert.ok(bob.sent.some((m) => m.t === 'leave' && m.rating === 4 && m.text === 'Thanks for a great day!')), { message: 'Bob sent his farewell with the leave' });
  await eventually(async () => assert.equal(await toast(ann, 'info').count() > 0, true), { message: 'Ann got a toast' });
  const toastText = await toast(ann, 'info').first().innerText();
  assert.match(toastText, /Bob/);
  assert.match(toastText, /★★★★☆/, 'the stars');
  assert.match(toastText, /Thanks for a great day!/);
  await waitForCrew(ann, 1);

  // Ann can read it, and the average, from her settings.
  await openSettings(ann);
  await summary(ann).waitFor({ state: 'visible' });
  assert.match(await ann.tid('farewell-average').innerText(), /4\.0 from 1 rating\b/);
  assert.equal(await ann.tid('farewell-item').count(), 1);
  assert.match(await ann.tid('farewell-item').first().innerText(), /Bob.*Thanks for a great day!/s);
  await closeSheet(ann, 'settings-sheet');

  // Someone who arrives later sees it too.
  const cy = await s.player('Cy', SPOTS.bob, { roomUrl: ann.roomUrl });
  await waitForCrew(cy, 2);
  await openSettings(cy);
  await summary(cy).waitFor({ state: 'visible' });
  assert.match(await cy.tid('farewell-average').innerText(), /4\.0/);
  await closeSheet(cy, 'settings-sheet');

  // A second goodbye with only a rating moves the average and adds no message.
  await leaveRoom(cy, { rating: 5 });
  await openSettings(ann);
  await eventually(async () => assert.match(await ann.tid('farewell-average').innerText(), /4\.5 from 2 ratings/), { message: 'average of 4 and 5' });
  assert.equal(await ann.tid('farewell-item').count(), 1, 'a rating alone adds no note');
  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('21b. leaving with nothing filled in leaves nothing behind, and long messages are capped', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await leaveRoom(bob);
  await eventually(() => assert.ok(bob.sent.some((m) => m.t === 'leave')), { message: 'Bob left' });
  const leave = bob.sent.find((m) => m.t === 'leave');
  assert.ok(leave && !('rating' in leave) && !('text' in leave), 'a plain leave carries no farewell');
  await waitForCrew(ann, 1);
  assert.equal(await toast(ann, 'info').count(), 0, 'no toast for a plain goodbye');
  await openSettings(ann);
  assert.equal(await summary(ann).count(), 0, 'nothing to show');
  await closeSheet(ann, 'settings-sheet');

  const cy = await s.player('Cy', SPOTS.bob, { roomUrl: ann.roomUrl });
  await waitForCrew(cy, 2);
  await openSettings(cy);
  await cy.tid('btn-leave').click();
  await cy.tid('farewell-text').fill('x'.repeat(400));
  assert.equal((await cy.tid('farewell-text').inputValue()).length, 140, 'the box stops at 140');
  await cy.tid('btn-farewell-leave').click();
  await eventually(async () => assert.equal(await toast(ann, 'info').count() > 0, true), { message: 'Ann hears it' });
  ann.assertNoErrors();
});
