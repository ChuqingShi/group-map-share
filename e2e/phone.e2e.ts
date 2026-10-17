// Scenario 8: a small phone (360x640) must not scroll sideways, and every action-bar button fits on screen.
import assert from 'node:assert/strict';
import {
  SPOTS,
  createPlan,
  eventually,
  openPlans,
  setup,
  waitForCrew,
  type Player,
} from './harness.ts';

const { scenario } = setup();

const ACTION_BAR = ['btn-mood', 'btn-plans', 'btn-talk', 'btn-share', 'btn-leave', 'btn-names'];
const LONG_PLACE = 'Taqueria Super Long Name Number One'; // 40 characters is the limit
const LONG_NOTE = 'Bring a jacket, it gets windy by the pier and the line is long';

interface Overflow {
  scrollWidth: number;
  innerWidth: number;
}

const overflow = (p: Player): Promise<Overflow> =>
  p.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

async function assertNoHorizontalOverflow(p: Player, where: string) {
  const o = await overflow(p);
  assert.ok(o.scrollWidth <= o.innerWidth, `${where}: page scrolls sideways (scrollWidth ${o.scrollWidth} > innerWidth ${o.innerWidth})`);
}

/** Every given element is visible and its box lies inside the viewport. */
async function assertInsideViewport(p: Player, testids: string[], where: string, optional = false) {
  const boxes = await p.page.evaluate((ids) => {
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return { id, found: false as const };
      const r = el.getBoundingClientRect();
      return { id, found: true as const, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
  }, testids);
  for (const b of boxes) {
    if (!b.found) {
      assert.ok(optional, `${where}: ${b.id} is missing`);
      continue;
    }
    assert.ok(b.right > b.left && b.bottom > b.top, `${where}: ${b.id} has no size`);
    // Half a pixel of slack for sub-pixel layout.
    assert.ok(b.left >= -0.5 && b.right <= b.w + 0.5, `${where}: ${b.id} sticks out sideways (${b.left.toFixed(1)}..${b.right.toFixed(1)} of ${b.w})`);
    assert.ok(b.top >= -0.5 && b.bottom <= b.h + 0.5, `${where}: ${b.id} sticks out vertically (${b.top.toFixed(1)}..${b.bottom.toFixed(1)} of ${b.h})`);
  }
}

scenario('8. phone 360x640: no sideways scroll, action bar buttons fully on screen, crew strip and plans panel fit', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { viewport: { width: 360, height: 640 } });
  await waitForCrew(ann, 1);

  // A crowded room with long names makes the crew strip and names list as wide as they will ever be.
  const crowd = [];
  for (let i = 1; i <= 8; i++) {
    const c = await s.raw(ann.roomId);
    await c.hello(`Wanderer number ${i} with a long name`.slice(0, 24), SPOTS.bob);
    crowd.push(c);
  }
  await waitForCrew(ann, 9);

  await assertNoHorizontalOverflow(ann, 'room with 9 people');
  await assertInsideViewport(ann, ACTION_BAR, 'action bar');
  await assertInsideViewport(ann, ['crew'], 'crew strip');

  // The names list.
  await ann.tid('btn-names').click();
  await assertNoHorizontalOverflow(ann, 'names list open');
  await assertInsideViewport(ann, ACTION_BAR, 'action bar with names list', true);
  await ann.tid('btn-names').click();

  // The plans panel, with a plan card full of long text.
  await createPlan(ann, { kind: 'lunch', place: LONG_PLACE, note: LONG_NOTE, ping: false });
  await openPlans(ann);
  await eventually(async () => assert.equal(await ann.tid('plan-card').count(), 1), { message: 'plan card' });
  await assertNoHorizontalOverflow(ann, 'plans panel with a plan');
  await assertInsideViewport(ann, ['plans-panel'], 'plans panel');
  await assertInsideViewport(ann, ACTION_BAR, 'action bar with plans panel', true); // the bar may hide while a sheet is open
  // The buttons inside the card must fit too.
  const cardButtons = await ann.page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="plan-card"] button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { label: (b.getAttribute('data-testid') ?? b.textContent ?? '').trim(), left: r.left, right: r.right, w: innerWidth };
    }),
  );
  for (const b of cardButtons) assert.ok(b.left >= -0.5 && b.right <= b.w + 0.5, `plan card button ${b.label} sticks out (${b.left}..${b.right} of ${b.w})`);

  for (const c of crowd) c.close();
  ann.assertNoErrors();
});

scenario('8b. phone 360x640: a long event name shrinks to fit, the top bar buttons never get pushed off screen', async (s) => {
  const made = await fetch(`${s.baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'The very long name of our team lunch event' }),
  });
  const { id } = (await made.json()) as { id: string };
  const ann = await s.player('Ann', SPOTS.ann, { viewport: { width: 360, height: 640 }, roomUrl: `${s.baseUrl}/r/${id}` });
  await waitForCrew(ann, 1);
  await eventually(async () => assert.match(await ann.tid('event-title').innerText(), /\S/), { message: 'event title shown' });
  await assertNoHorizontalOverflow(ann, 'top bar with a long event name');
  await assertInsideViewport(ann, ['btn-events', 'btn-settings', 'btn-invite'], 'top bar');
  ann.assertNoErrors();
});
