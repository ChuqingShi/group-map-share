// Scenarios 18 and 20: map links for a dinner flag (ping, plans list, person card), and the compass.
import assert from 'node:assert/strict';
import { SPOTS, createPlan, eventually, openPlans, closeSheet, setup, toast, waitForCrew } from './harness.ts';

const { scenario } = setup();

/** A Google Maps search link for the named place, or a walking route to its coordinates. */
const isSearchFor = (href: string | null, place: string) => {
  const url = new URL(href ?? 'about:blank');
  return url.origin === 'https://www.google.com' && url.pathname === '/maps/search/' && (url.searchParams.get('query') ?? '').startsWith(`${place} `);
};

scenario('18. a flag has a Google Maps link in the ping, the plans list and the person card', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  const toGoogle: string[] = [];
  bob.page.on('request', (r) => { if (/google\./.test(new URL(r.url()).hostname)) toGoogle.push(r.url()); });

  await createPlan(ann, { kind: 'dinner', place: "Joe's Tacos", ping: true });

  // The ping toast on Bob's phone.
  await eventually(async () => assert.equal(await toast(bob, 'ping').count(), 1), { message: 'ping toast reached Bob' });
  const toastLink = bob.tid('link-toast-maps');
  assert.ok(isSearchFor(await toastLink.getAttribute('href'), "Joe's Tacos"), 'toast link searches for the restaurant');
  assert.equal(await toastLink.getAttribute('target'), '_blank', 'opens in its own tab so the app stays open');
  assert.match((await toastLink.getAttribute('rel')) ?? '', /noopener/);

  // The plans list: Google Maps and walking directions.
  await openPlans(bob);
  const card = bob.tid('plan-card').first();
  assert.ok(isSearchFor(await card.locator('[data-testid="link-plan-maps"]').getAttribute('href'), "Joe's Tacos"));
  const dir = new URL((await card.locator('[data-testid="link-plan-directions"]').getAttribute('href')) ?? 'about:blank');
  assert.equal(dir.pathname, '/maps/dir/');
  assert.match(dir.searchParams.get('destination') ?? '', /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  assert.equal(dir.searchParams.get('travelmode'), 'walking');
  await closeSheet(bob, 'plans-panel');

  // Ann's person card lists her flag with the same link.
  await bob.page.locator(`[data-testid="crew-avatar"][data-player-id="${ann.id}"]`).click();
  await bob.tid('person-card').waitFor({ state: 'visible' });
  assert.ok(isSearchFor(await bob.tid('link-card-maps').first().getAttribute('href'), "Joe's Tacos"));
  await closeSheet(bob, 'person-card');

  // Nothing went to Google on its own: links only load when tapped.
  assert.deepEqual(toGoogle, []);
});

scenario('20. the compass shows where north is, and a tap turns the map north, then flattens and tilts it', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  await waitForCrew(ann, 1);
  const north = ann.tid('btn-north');
  const read = async () => ({ bearing: Number(await north.getAttribute('data-bearing')), pitch: Number(await north.getAttribute('data-pitch')) });
  await eventually(async () => assert.equal((await read()).pitch, 45), { message: 'the map starts tilted and north-up' });
  assert.equal((await read()).bearing, 0);
  assert.doesNotMatch((await north.getAttribute('class')) ?? '', /is-turned/);

  // Twist the map like a stray two-finger gesture would (shift+arrow is MapLibre's keyboard rotate).
  await ann.page.locator('.maplibregl-canvas').focus();
  await ann.page.keyboard.press('Shift+ArrowLeft');
  for (let i = 0; i < 12; i++) await ann.page.keyboard.press('Shift+ArrowLeft');
  await eventually(async () => assert.notEqual((await read()).bearing, 0), { message: 'the map turned' });
  assert.match((await north.getAttribute('class')) ?? '', /is-turned/, 'the compass lights up while the map is turned');
  assert.equal(await north.getAttribute('aria-label'), 'Point the map north');

  await north.click();
  await eventually(async () => assert.equal((await read()).bearing, 0), { message: 'facing north again' });
  assert.equal((await read()).pitch, 45, 'tilt is kept');
  assert.doesNotMatch((await north.getAttribute('class')) ?? '', /is-turned/);

  await north.click(); // already north: flatten
  await eventually(async () => assert.equal((await read()).pitch, 0), { message: 'flat top-down view' });
  await north.click(); // and back to the tilted one
  await eventually(async () => assert.equal((await read()).pitch, 45), { message: 'tilted again' });
  ann.assertNoErrors();
});
