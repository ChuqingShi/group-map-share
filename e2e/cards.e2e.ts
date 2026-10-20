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
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  // Breeca is hungry, has a flag out, and puts an email on their own card.
  await openSheet(breeca, 'btn-mood', 'mood-sheet');
  await breeca.tid('mood-hungry').click();
  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos", ping: false });
  await openCard(breeca, breeca.id);
  assert.match(await breeca.tid('card-name').innerText(), /Breeca.*you/i, 'my own card says (you)');
  assert.equal(await breeca.tid('card-contact-input').inputValue(), '', 'no contact yet');
  await breeca.tid('card-contact-input').fill('breeca@example.com');
  await breeca.tid('btn-card-save').click();
  await eventually(() => assert.ok(breeca.sent.some((m) => m.t === 'contact' && m.text === 'breeca@example.com')), { message: 'contact sent' });
  await closeSheet(breeca, 'person-card');

  // Eric taps Breeca's picture.
  await openCard(eric, breeca.id);
  await eventually(async () => assert.match(await eric.tid('card-name').innerText(), /^Breeca$/i), { message: "Breeca's name" });
  await eventually(async () => assert.match(await eric.tid('card-mood').innerText(), new RegExp(`${MOOD_EMOJI.hungry}.*Hungry`)), { message: "Breeca's mood" });
  await eventually(async () => assert.equal(await eric.tid('card-contact-link').getAttribute('href'), 'mailto:breeca@example.com'), { message: "the email is a tap to email link" });
  await eventually(async () => assert.equal(await eric.tid('card-plan').count(), 1), { message: "Breeca's flag is on Breeca's card" });
  assert.match(await eric.tid('card-plan').first().innerText(), /Joe's Tacos/);
  assert.equal(await eric.tid('btn-card-show').isEnabled(), true);
  // From the card Eric can join Breeca's flag.
  await eric.tid('card-plan').first().locator('button', { hasText: "I'm in" }).click();
  await eventually(async () => assert.equal(await breeca.tid('card-plan').count(), 0), { message: 'sanity: Breeca has no card open' }).catch(() => {});
  await eventually(() => assert.ok(eric.sent.some((m) => m.t === 'plan_join')), { message: 'joined from the card' });
  await closeSheet(eric, 'person-card');

  // Somebody with no contact info says so, kindly. Tapping a name in the list opens the card too.
  await eric.tid('btn-names').click();
  await eric.page.locator('.player', { hasText: 'Breeca' }).first().click();
  await card(eric).waitFor({ state: 'visible' });
  await closeSheet(eric, 'person-card');
  await openCard(breeca, eric.id);
  assert.match(await breeca.tid('card-contact').innerText(), /has not added contact info/i);
  await eventually(async () => assert.match(await breeca.tid('card-plan').first().innerText(), /Joe's Tacos/), { message: "Eric's card lists the flag Eric joined" });

  // A pin on the map opens the card as well.
  await closeSheet(breeca, 'person-card');
  await breeca.page.locator(`.pin[data-player-id="${eric.id}"]`).dispatchEvent('click');
  await card(breeca).waitFor({ state: 'visible' });
  assert.match(await breeca.tid('card-name').innerText(), /^Eric$/i);

  // The contact line is plain text only: markup stays markup.
  await closeSheet(breeca, 'person-card');
  await openCard(eric, eric.id);
  await eric.tid('card-contact-input').fill('<img src=x onerror=alert(1)> javascript:alert(1)');
  await eric.tid('btn-card-save').click();
  await closeSheet(eric, 'person-card');
  await openCard(breeca, eric.id);
  await eventually(async () => assert.match(await breeca.tid('card-contact').innerText(), /<img/), { message: 'shown as text' });
  assert.equal(await breeca.tid('card-contact').locator('img').count(), 0, 'no element was created from it');
  assert.equal(await breeca.tid('card-contact-link').count(), 0, 'and it is not turned into a link');

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('16. no thanks and suggest somewhere else: Eric says no and proposes, Breeca is told and can plan it', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos", ping: true });
  await eventually(async () => assert.match((await toast(eric, 'ping').allInnerTexts()).join(' '), /Joe's Tacos/), { message: 'ping toast on Eric' });

  // The toast has all the answers.
  for (const id of ['btn-toast-join', 'btn-toast-decline', 'btn-toast-suggest', 'btn-toast-show']) {
    assert.equal(await eric.tid(id).count(), 1, id);
  }
  await eric.tid('btn-toast-decline').click();
  await eventually(async () => {
    await openPlans(breeca);
    assert.match(await breeca.tid('plan-declined').first().innerText(), /1 said no thanks/);
  }, { message: 'Breeca sees one no thanks' });

  // Eric suggests somewhere else from the plan card.
  await openPlans(eric);
  assert.equal(await eric.tid('btn-plan-decline').count(), 0, 'already said no thanks');
  await eric.tid('btn-plan-suggest').click();
  await eric.tid('suggest-sheet').waitFor({ state: 'visible' });
  await eric.tid('suggest-place').fill('Blue Bottle');
  await eric.tid('suggest-note').fill('shorter line');
  await eric.tid('btn-suggest-send').click();

  // Breeca is told, with a button to plan it.
  await eventually(async () => assert.match((await breeca.tid('toast').allInnerTexts()).join(' '), /Eric suggests Blue Bottle/), { message: 'Breeca is told about the idea' });
  await breeca.tid('btn-toast-action').click();
  await eventually(async () => assert.ok((await breeca.tid('drop-banner').isVisible()) || (await breeca.tid('plan-form').isVisible())), { message: 'the flag step opens' });
  if (await breeca.tid('drop-banner').isVisible()) await breeca.tid('btn-drop-here').click();
  await breeca.tid('plan-form').waitFor({ state: 'visible' });
  assert.equal(await breeca.tid('plan-place').inputValue(), 'Blue Bottle', 'prefilled with the idea');

  // The idea also shows on the card for everyone.
  await breeca.page.keyboard.press('Escape').catch(() => {});
  await openPlans(eric).catch(() => {});
  await eventually(async () => {
    await openSheet(eric, 'btn-plans', 'plans-panel');
    assert.match(await eric.tid('plan-suggestion').first().innerText(), /Eric.*Blue Bottle.*shorter line/);
  }, { message: 'the idea is listed on the plan' });

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('15b. edit my own name and contact on my card; everyone sees the new name, and a reload keeps it', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  await openCard(breeca, breeca.id);
  assert.equal(await breeca.tid('card-name-input').inputValue(), 'Breeca');
  assert.equal(await breeca.tid('btn-card-save').isDisabled(), true, 'nothing to save yet');
  await breeca.tid('card-name-input').fill('Bree');
  await breeca.tid('card-contact-input').fill('+1 310 555 0100');
  assert.equal(await breeca.tid('btn-card-save').isDisabled(), false);
  await breeca.tid('card-name-input').fill('   ');
  assert.equal(await breeca.tid('btn-card-save').isDisabled(), true, 'an empty name cannot be saved');
  await breeca.tid('card-name-input').fill('Bree');
  await breeca.tid('btn-card-save').click();
  await eventually(() => assert.ok(breeca.sent.some((m) => m.t === 'profile' && m.name === 'Bree')), { message: 'rename sent' });
  await eventually(() => assert.ok(breeca.sent.some((m) => m.t === 'contact' && m.text === '+1 310 555 0100')), { message: 'contact sent' });
  await closeSheet(breeca, 'person-card');

  // Eric sees the new name on Breeca's avatar and card, and the number is a call link.
  await eventually(async () => {
    const label = await eric.page.locator(`[data-testid="crew-avatar"][data-player-id="${breeca.id}"]`).getAttribute('aria-label');
    assert.match(label ?? '', /Bree/);
  }, { message: "Breeca's avatar label is Bree" });
  await openCard(eric, breeca.id);
  await eventually(async () => assert.match(await eric.tid('card-name').innerText(), /^bree$/i), { message: 'new name on the card' });
  await eventually(async () => assert.equal(await eric.tid('card-contact-link').getAttribute('href'), 'tel:+13105550100'), { message: 'tap to call' });
  await closeSheet(eric, 'person-card');

  // A reload resumes the same player with the new name and contact line.
  await breeca.page.reload();
  await waitForCrew(breeca, 2);
  await openCard(breeca, breeca.id);
  assert.equal(await breeca.tid('card-name-input').inputValue(), 'Bree', 'the name survived the reload');
  assert.equal(await breeca.tid('card-contact-input').inputValue(), '+1 310 555 0100', 'and so did the contact line');

  breeca.assertNoErrors();
  eric.assertNoErrors();
});
