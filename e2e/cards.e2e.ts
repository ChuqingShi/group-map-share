// Scenarios 15 and 16: the person card (mood, contact, plans) and saying no thanks or suggesting somewhere else.
import assert from 'node:assert/strict';
import { MOOD_EMOJI } from '../shared/protocol.ts';
import { SPOTS, createPlan, eventually, openPlans, openSheet, closeSheet, setup, toast, waitForCrew, type Player } from './harness.ts';

const { scenario } = setup();

const card = (p: Player) => p.tid('person-card');
const openCard = async (viewer: Player, whoId: string) => {
  await viewer.page.locator(`[data-testid="crew-avatar"][data-player-id="${whoId}"]`).click();
  await card(viewer).waitFor({ state: 'visible' });
};

scenario('15. person card: tap a picture, a name or a pin for their mood, contact info and plans', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // Ann is hungry, has a flag out, and puts her email on her own card.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-hungry').click();
  await createPlan(ann, { kind: 'lunch', place: "Joe's Tacos", ping: false });
  await openCard(ann, ann.id);
  assert.match(await ann.tid('card-name').innerText(), /Ann.*you/i, 'my own card says (you)');
  assert.equal(await ann.tid('card-contact-input').inputValue(), '', 'no contact yet');
  await ann.tid('card-contact-input').fill('ann@example.com');
  await ann.tid('btn-card-save').click();
  await eventually(() => assert.ok(ann.sent.some((m) => m.t === 'contact' && m.text === 'ann@example.com')), { message: 'contact sent' });
  await closeSheet(ann, 'person-card');

  // Bob taps Ann's picture.
  await openCard(bob, ann.id);
  await eventually(async () => assert.match(await bob.tid('card-name').innerText(), /^Ann$/i), { message: "Ann's name" });
  await eventually(async () => assert.match(await bob.tid('card-mood').innerText(), new RegExp(`${MOOD_EMOJI.hungry}.*Hungry`)), { message: "Ann's mood" });
  await eventually(async () => assert.equal(await bob.tid('card-contact-link').getAttribute('href'), 'mailto:ann@example.com'), { message: "her email is a tap to email link" });
  await eventually(async () => assert.equal(await bob.tid('card-plan').count(), 1), { message: "Ann's flag is on her card" });
  assert.match(await bob.tid('card-plan').first().innerText(), /Joe's Tacos/);
  assert.equal(await bob.tid('btn-card-show').isEnabled(), true);
  // From the card Bob can join her flag.
  await bob.tid('card-plan').first().locator('button', { hasText: "I'm in" }).click();
  await eventually(async () => assert.equal(await ann.tid('card-plan').count(), 0), { message: 'sanity: Ann has no card open' }).catch(() => {});
  await eventually(() => assert.ok(bob.sent.some((m) => m.t === 'plan_join')), { message: 'joined from the card' });
  await closeSheet(bob, 'person-card');

  // Somebody with no contact info says so, kindly. Tapping a name in the list opens the card too.
  await bob.tid('btn-names').click();
  await bob.page.locator('.player', { hasText: 'Ann' }).first().click();
  await card(bob).waitFor({ state: 'visible' });
  await closeSheet(bob, 'person-card');
  await openCard(ann, bob.id);
  assert.match(await ann.tid('card-contact').innerText(), /has not added contact info/i);
  await eventually(async () => assert.match(await ann.tid('card-plan').first().innerText(), /Joe's Tacos/), { message: "Bob's card lists the flag he joined" });

  // A pin on the map opens the card as well.
  await closeSheet(ann, 'person-card');
  await ann.page.locator(`.pin[data-player-id="${bob.id}"]`).dispatchEvent('click');
  await card(ann).waitFor({ state: 'visible' });
  assert.match(await ann.tid('card-name').innerText(), /^Bob$/i);

  // The contact line is plain text only: markup stays markup.
  await closeSheet(ann, 'person-card');
  await openCard(bob, bob.id);
  await bob.tid('card-contact-input').fill('<img src=x onerror=alert(1)> javascript:alert(1)');
  await bob.tid('btn-card-save').click();
  await closeSheet(bob, 'person-card');
  await openCard(ann, bob.id);
  await eventually(async () => assert.match(await ann.tid('card-contact').innerText(), /<img/), { message: 'shown as text' });
  assert.equal(await ann.tid('card-contact').locator('img').count(), 0, 'no element was created from it');
  assert.equal(await ann.tid('card-contact-link').count(), 0, 'and it is not turned into a link');

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('16. no thanks and suggest somewhere else: Bob says no and proposes, Ann is told and can plan it', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await createPlan(ann, { kind: 'lunch', place: "Joe's Tacos", ping: true });
  await eventually(async () => assert.match((await toast(bob, 'ping').allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Bob' });

  // The toast has all the answers.
  for (const id of ['btn-toast-join', 'btn-toast-decline', 'btn-toast-suggest', 'btn-toast-show']) {
    assert.equal(await bob.tid(id).count(), 1, id);
  }
  await bob.tid('btn-toast-decline').click();
  await eventually(async () => {
    await openPlans(ann);
    assert.match(await ann.tid('plan-declined').first().innerText(), /1 said no thanks/);
  }, { message: 'Ann sees one no thanks' });

  // Bob suggests somewhere else from the plan card.
  await openPlans(bob);
  assert.equal(await bob.tid('btn-plan-decline').count(), 0, 'already said no thanks');
  await bob.tid('btn-plan-suggest').click();
  await bob.tid('suggest-sheet').waitFor({ state: 'visible' });
  await bob.tid('suggest-place').fill('Blue Bottle');
  await bob.tid('suggest-note').fill('shorter line');
  await bob.tid('btn-suggest-send').click();

  // Ann is told, with a button to plan it.
  await eventually(async () => assert.match((await ann.tid('toast').allInnerTexts()).join(' '), /Bob suggests Blue Bottle/), { message: 'Ann is told about the idea' });
  await ann.tid('btn-toast-action').click();
  await eventually(async () => assert.ok((await ann.tid('drop-banner').isVisible()) || (await ann.tid('plan-form').isVisible())), { message: 'the flag step opens' });
  if (await ann.tid('drop-banner').isVisible()) await ann.tid('btn-drop-here').click();
  await ann.tid('plan-form').waitFor({ state: 'visible' });
  assert.equal(await ann.tid('plan-place').inputValue(), 'Blue Bottle', 'prefilled with the idea');

  // The idea also shows on the card for everyone.
  await ann.page.keyboard.press('Escape').catch(() => {});
  await openPlans(bob).catch(() => {});
  await eventually(async () => {
    await openSheet(bob, 'btn-plans', 'plans-panel');
    assert.match(await bob.tid('plan-suggestion').first().innerText(), /Bob.*Blue Bottle.*shorter line/);
  }, { message: 'the idea is listed on the plan' });

  ann.assertNoErrors();
  bob.assertNoErrors();
});
