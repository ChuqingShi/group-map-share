// Scenarios 9 and 11: events are remembered on the device, and closing a page does not remove you.
import assert from 'node:assert/strict';
import {
  SPOTS,
  avatarOffline,
  createPlan,
  crewIds,
  eventCardIds,
  eventCards,
  eventually,
  landingCreateButton,
  leaveRoom,
  setup,
  waitForCrew,
  type Player,
} from './harness.ts';

const { scenario } = setup();

const eventTitle = async (p: Player) => ((await p.tid('event-title').allInnerTexts())[0] ?? '').replace(/\s+/g, ' ').trim();
const joinFormVisible = (p: Player) => p.page.locator('[data-testid="join-form"], input[placeholder="e.g. Sam"]').first().isVisible();

scenario('9a. event: the title shows name and count, and a reload resumes the same player with no join form', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Beach day' });
  await waitForCrew(ann, 1);
  await eventually(async () => assert.match(await eventTitle(ann), /^Beach day\s*·\s*1$/i), { message: 'event title with one person' });

  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await eventually(async () => assert.match(await eventTitle(ann), /^Beach day\s*·\s*2$/i), { message: 'event title with two people' });
  await createPlan(ann, { kind: 'lunch', place: "Joe's Tacos", ping: false });
  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 1), { message: 'Bob sees the plan' });

  const idBefore = ann.id;
  const formsBefore = ann.stats.joinFormsFilled;
  await ann.reload();

  assert.equal(ann.stats.joinFormsFilled, formsBefore, 'a reload must not show the join form again');
  assert.equal(await joinFormVisible(ann), false);
  assert.equal(ann.id, idBefore, 'same player after the reload');
  await waitForCrew(ann, 2);
  assert.ok((await crewIds(ann)).includes(idBefore), 'my crew avatar carries the same data-player-id');
  await eventually(async () => assert.equal(await ann.tid('plan-x').count(), 1), { message: 'the plan is still there' });
  await eventually(async () => assert.match(await eventTitle(ann), /^Beach day\s*·\s*2$/i), { message: 'event title after reload' });
  await waitForCrew(bob, 2); // Bob still sees exactly two people, not a ghost of the old tab
  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('9b. event: a new page auto-resumes the latest event, the list shows up via the event button', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Beach day' });
  await waitForCrew(ann, 1);

  // A brand new tab in the same browser: straight back into the event, not the landing page.
  const page2 = await ann.context.newPage();
  try {
    await page2.goto(`${s.baseUrl}/?sim=${SPOTS.ann[0]},${SPOTS.ann[1]}`, { waitUntil: 'domcontentloaded' });
    await eventually(() => assert.match(page2.url(), new RegExp(`/r/${ann.roomId}`)), { message: 'new page resumes the latest event' });
    assert.equal(await page2.locator('[data-testid="events-list"]').count(), 0, 'no list on auto-resume');

    // From inside the event, the event button leads to the list without leaving the event.
    await page2.locator('[data-testid="btn-events"]').click();
    await eventually(() => page2.locator(`[data-testid="event-card"][data-room-id="${ann.roomId}"]`).waitFor({ timeout: 500 }), {
      message: 'the event is listed',
    });
    assert.match(await page2.locator(`[data-testid="event-card"][data-room-id="${ann.roomId}"]`).innerText(), /Beach day/i);
    // Tapping the card opens that event again.
    await page2.locator(`[data-testid="event-card"][data-room-id="${ann.roomId}"]`).click();
    await eventually(() => assert.match(page2.url(), new RegExp(`/r/${ann.roomId}`)), { message: 'card opens the room' });
  } finally {
    await page2.close().catch(() => {});
  }
});

scenario('9c. event: leaving (two taps) removes me and my plans for others, forgets the event and the old player', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Leave test' });
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await createPlan(ann, { kind: 'coffee', place: 'Blue Bottle', ping: false });
  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 1), { message: 'Bob sees the plan' });

  // The first tap only arms the button.
  const leave = ann.tid('btn-leave');
  await leave.click();
  assert.match(((await leave.getAttribute('aria-label')) ?? '') + ((await leave.textContent()) ?? ''), /sure|again/i, 'first tap arms the button');
  assert.ok(!ann.sent.some((m) => m.t === 'leave'), 'one tap does not leave');
  await leave.click();

  await eventually(() => assert.ok(bob.received.some((m) => m.t === 'left' && m.id === ann.id)), { message: 'Bob is told Ann left' });
  await waitForCrew(bob, 1);
  await eventually(async () => assert.equal(await bob.tid('plan-x').count(), 0), { message: "Ann's plan vanishes for Bob" });

  // Her room link no longer resumes her: returning devices may skip the form, but she joins as a NEW player.
  const oldId = ann.id;
  await ann.joinNext(() => ann.page.goto(`${ann.roomUrl}?sim=${SPOTS.ann[0]},${SPOTS.ann[1]}`, { waitUntil: 'domcontentloaded' }).then(() => {}));
  assert.notEqual(ann.id, oldId, 'leaving forgot my player: the link starts a new one');
  await waitForCrew(bob, 2);
  // Leave once more, then check the landing page no longer lists the event.
  await leaveRoom(ann);
  await ann.page.goto(`${s.baseUrl}/?sim=${SPOTS.ann[0]},${SPOTS.ann[1]}`, { waitUntil: 'domcontentloaded' });
  await eventually(async () => assert.ok(await landingCreateButton(ann.page).isVisible()), { message: 'landing page' });
  assert.ok(!(await eventCardIds(ann)).includes(ann.roomId), 'the event is forgotten');
  bob.assertNoErrors();
});

scenario('9d. event: two events are listed at once and each opens its own room', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Beach day' });
  await waitForCrew(ann, 1);
  const roomA = ann.roomId;

  // Back to the list without leaving, then start a second event.
  await ann.tid('btn-events').click();
  await eventually(async () => assert.equal(await eventCards(ann).count(), 1), { message: 'first event listed' });
  await ann.joinNext(async () => {
    await ann.tid('event-name').fill('Dinner crew');
    await landingCreateButton(ann.page).click();
  });
  const roomB = ann.currentRoomId();
  assert.ok(roomB && roomB !== roomA, 'a second room was created');
  await waitForCrew(ann, 1);
  await eventually(async () => assert.match(await eventTitle(ann), /^Dinner crew\s*·\s*1$/i), { message: 'title of the second event' });

  await ann.tid('btn-events').click();
  await eventually(async () => assert.deepEqual((await eventCardIds(ann)).sort(), [roomA, roomB].sort()), { message: 'both events listed' });
  const cardA = ann.page.locator(`[data-testid="event-card"][data-room-id="${roomA}"]`);
  const cardB = ann.page.locator(`[data-testid="event-card"][data-room-id="${roomB}"]`);
  assert.match(await cardA.innerText(), /Beach day/i);
  assert.match(await cardB.innerText(), /Dinner crew/i);

  await ann.joinNext(() => cardA.click());
  assert.equal(ann.currentRoomId(), roomA);
  await eventually(async () => assert.match(await eventTitle(ann), /^Beach day/i), { message: 'back in the first event' });

  await ann.tid('btn-events').click();
  await ann.joinNext(() => ann.page.locator(`[data-testid="event-card"][data-room-id="${roomB}"]`).click());
  assert.equal(ann.currentRoomId(), roomB);
  await eventually(async () => assert.match(await eventTitle(ann), /^Dinner crew/i), { message: 'and in the second event' });
  ann.assertNoErrors();
});

scenario('9e. event: an event the server no longer has is dropped from the list', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { eventName: 'Short lived' });
  await waitForCrew(ann, 1);
  const roomId = ann.roomId;
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${roomId}`)).status, 200);

  await s.server.restart(); // like a redeploy: every room is gone
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${roomId}`)).status, 404, 'the restarted server has no rooms');

  // Same tab, back to the root: the list is checked against the server.
  await ann.page.goto(`${s.baseUrl}/?sim=${SPOTS.ann[0]},${SPOTS.ann[1]}`, { waitUntil: 'domcontentloaded' });
  await eventually(async () => assert.ok(await landingCreateButton(ann.page).isVisible()), { message: 'landing page after restart' });
  await eventually(async () => assert.ok(!(await eventCardIds(ann)).includes(roomId)), { message: 'dead event dropped from the list' });
});

scenario('11. closing a page keeps the player in the event, greyed out for everyone else', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  const bobId = bob.id;

  await bob.page.close();

  await eventually(async () => assert.ok(await avatarOffline(ann, bobId)), { message: "Bob's avatar is greyed out for Ann" });
  assert.ok(ann.received.some((m) => m.t === 'player' && m.player.id === bobId && !m.player.online), 'the server marked Bob offline');
  assert.ok(!ann.received.some((m) => m.t === 'left' && m.id === bobId), 'Bob was not removed');
  await waitForCrew(ann, 2);
  ann.assertNoErrors();
});
