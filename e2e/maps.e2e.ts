// Scenario 18: everybody going to dinner can open the restaurant in Google Maps, from the ping, the plans list and the person card.
import assert from 'node:assert/strict';
import { SPOTS, createPlan, eventually, openPlans, closeSheet, setup, toast, waitForCrew } from './harness.ts';

const { scenario } = setup();

/** A Google Maps search link for the named place, or a walking route to its coordinates. */
const isSearchFor = (href: string | null, place: string) => {
  const url = new URL(href ?? 'about:blank');
  return url.origin === 'https://www.google.com' && url.pathname === '/maps/search/' && (url.searchParams.get('query') ?? '').startsWith(`${place} `);
};

scenario('18. a flag has a Google Maps link in the ping, the plans list and the person card', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  const toGoogle: string[] = [];
  eric.page.on('request', (r) => { if (/google\./.test(new URL(r.url()).hostname)) toGoogle.push(r.url()); });

  await createPlan(breeca, { kind: 'dinner', place: "Joe's Tacos", ping: true });

  // The ping toast on Eric's phone.
  await eventually(async () => assert.equal(await toast(eric, 'ping').count(), 1), { message: 'ping toast reached Eric' });
  const toastLink = eric.tid('link-toast-maps');
  assert.ok(isSearchFor(await toastLink.getAttribute('href'), "Joe's Tacos"), 'toast link searches for the restaurant');
  assert.equal(await toastLink.getAttribute('target'), '_blank', 'opens in its own tab so the app stays open');
  assert.match((await toastLink.getAttribute('rel')) ?? '', /noopener/);

  // The plans list: Google Maps and walking directions.
  await openPlans(eric);
  const card = eric.tid('plan-card').first();
  assert.ok(isSearchFor(await card.locator('[data-testid="link-plan-maps"]').getAttribute('href'), "Joe's Tacos"));
  const dir = new URL((await card.locator('[data-testid="link-plan-directions"]').getAttribute('href')) ?? 'about:blank');
  assert.equal(dir.pathname, '/maps/dir/');
  assert.match(dir.searchParams.get('destination') ?? '', /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  assert.equal(dir.searchParams.get('travelmode'), 'walking');
  await closeSheet(eric, 'plans-panel');

  // Breeca's person card lists the flag with the same link.
  await eric.page.locator(`[data-testid="crew-avatar"][data-player-id="${breeca.id}"]`).click();
  await eric.tid('person-card').waitFor({ state: 'visible' });
  assert.ok(isSearchFor(await eric.tid('link-card-maps').first().getAttribute('href'), "Joe's Tacos"));
  await closeSheet(eric, 'person-card');

  // Nothing went to Google on its own: links only load when tapped.
  assert.deepEqual(toGoogle, []);
});
