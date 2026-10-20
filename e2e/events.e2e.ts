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
  openSettings,
  setup,
  waitForCrew,
  type Player,
} from './harness.ts';

const { scenario } = setup();

const eventTitle = async (p: Player) => ((await p.tid('event-title').allInnerTexts())[0] ?? '').replace(/\s+/g, ' ').trim();
const joinFormVisible = (p: Player) => p.page.locator('[data-testid="join-form"], input[placeholder="e.g. Sam"]').first().isVisible();

scenario('9a. event: the title shows name and count, and a reload resumes the same player with no join form', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Beach day' });
  await waitForCrew(breeca, 1);
  await eventually(async () => assert.match(await eventTitle(breeca), /^Beach day\s*·\s*1$/i), { message: 'event title with one person' });

  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  await eventually(async () => assert.match(await eventTitle(breeca), /^Beach day\s*·\s*2$/i), { message: 'event title with two people' });
  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos", ping: false });
  await eventually(async () => assert.equal(await eric.tid('plan-x').count(), 1), { message: 'Eric sees the plan' });

  const idBefore = breeca.id;
  const formsBefore = breeca.stats.joinFormsFilled;
  await breeca.reload();

  assert.equal(breeca.stats.joinFormsFilled, formsBefore, 'a reload must not show the join form again');
  assert.equal(await joinFormVisible(breeca), false);
  assert.equal(breeca.id, idBefore, 'same player after the reload');
  await waitForCrew(breeca, 2);
  assert.ok((await crewIds(breeca)).includes(idBefore), 'my crew avatar carries the same data-player-id');
  await eventually(async () => assert.equal(await breeca.tid('plan-x').count(), 1), { message: 'the plan is still there' });
  await eventually(async () => assert.match(await eventTitle(breeca), /^Beach day\s*·\s*2$/i), { message: 'event title after reload' });
  await waitForCrew(eric, 2); // Eric still sees exactly two people, not a ghost of the old tab
  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('9b. event: a new page auto-resumes the latest event, the list shows up via the event button', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Beach day' });
  await waitForCrew(breeca, 1);

  // A brand new tab in the same browser: straight back into the event, not the landing page.
  const page2 = await breeca.context.newPage();
  try {
    await page2.goto(`${s.baseUrl}/?sim=${SPOTS.breeca[0]},${SPOTS.breeca[1]}`, { waitUntil: 'domcontentloaded' });
    await eventually(() => assert.match(page2.url(), new RegExp(`/r/${breeca.roomId}`)), { message: 'new page resumes the latest event' });
    assert.equal(await page2.locator('[data-testid="events-list"]').count(), 0, 'no list on auto-resume');

    // From inside the event, the event button leads to the list without leaving the event.
    await page2.locator('[data-testid="btn-events"]').click();
    await eventually(() => page2.locator(`[data-testid="event-card"][data-room-id="${breeca.roomId}"]`).waitFor({ timeout: 500 }), {
      message: 'the event is listed',
    });
    assert.match(await page2.locator(`[data-testid="event-card"][data-room-id="${breeca.roomId}"]`).innerText(), /Beach day/i);
    // Tapping the card opens that event again.
    await page2.locator(`[data-testid="event-card"][data-room-id="${breeca.roomId}"]`).click();
    await eventually(() => assert.match(page2.url(), new RegExp(`/r/${breeca.roomId}`)), { message: 'card opens the room' });
  } finally {
    await page2.close().catch(() => {});
  }
});

scenario('9c. event: leaving (two taps) removes me and my plans for others, forgets the event and the old player', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Leave test' });
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  await createPlan(breeca, { kind: 'coffee', place: 'Blue Bottle', ping: false });
  await eventually(async () => assert.equal(await eric.tid('plan-x').count(), 1), { message: 'Eric sees the plan' });

  // The first tap only arms the button.
  await openSettings(breeca);
  const leave = breeca.tid('btn-leave');
  await leave.click();
  assert.match(((await leave.getAttribute('aria-label')) ?? '') + ((await leave.textContent()) ?? ''), /sure|again/i, 'first tap arms the button');
  assert.ok(!breeca.sent.some((m) => m.t === 'leave'), 'one tap does not leave');
  await leave.click();

  await eventually(() => assert.ok(eric.received.some((m) => m.t === 'left' && m.id === breeca.id)), { message: 'Eric is told Breeca left' });
  await waitForCrew(eric, 1);
  await eventually(async () => assert.equal(await eric.tid('plan-x').count(), 0), { message: "Breeca's plan vanishes for Eric" });

  // The room link no longer resumes Breeca: returning devices may skip the form, but Breeca joins as a NEW player.
  const oldId = breeca.id;
  await breeca.joinNext(() => breeca.page.goto(`${breeca.roomUrl}?sim=${SPOTS.breeca[0]},${SPOTS.breeca[1]}`, { waitUntil: 'domcontentloaded' }).then(() => {}));
  assert.notEqual(breeca.id, oldId, 'leaving forgot my player: the link starts a new one');
  await waitForCrew(eric, 2);
  // Leave once more, then check the landing page no longer lists the event.
  await leaveRoom(breeca);
  await breeca.page.goto(`${s.baseUrl}/?sim=${SPOTS.breeca[0]},${SPOTS.breeca[1]}`, { waitUntil: 'domcontentloaded' });
  await eventually(async () => assert.ok(await landingCreateButton(breeca.page).isVisible()), { message: 'landing page' });
  assert.ok(!(await eventCardIds(breeca)).includes(breeca.roomId), 'the event is forgotten');
  eric.assertNoErrors();
});

scenario('9d. event: two events are listed at once and each opens its own room', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Beach day' });
  await waitForCrew(breeca, 1);
  const roomA = breeca.roomId;

  // Back to the list without leaving, then start a second event.
  await breeca.tid('btn-events').click();
  await eventually(async () => assert.equal(await eventCards(breeca).count(), 1), { message: 'first event listed' });
  await breeca.joinNext(async () => {
    await breeca.tid('event-name').fill('Dinner crew');
    await landingCreateButton(breeca.page).click();
  });
  const roomB = breeca.currentRoomId();
  assert.ok(roomB && roomB !== roomA, 'a second room was created');
  await waitForCrew(breeca, 1);
  await eventually(async () => assert.match(await eventTitle(breeca), /^Dinner crew\s*·\s*1$/i), { message: 'title of the second event' });

  await breeca.tid('btn-events').click();
  await eventually(async () => assert.deepEqual((await eventCardIds(breeca)).sort(), [roomA, roomB].sort()), { message: 'both events listed' });
  const cardA = breeca.page.locator(`[data-testid="event-card"][data-room-id="${roomA}"]`);
  const cardB = breeca.page.locator(`[data-testid="event-card"][data-room-id="${roomB}"]`);
  assert.match(await cardA.innerText(), /Beach day/i);
  assert.match(await cardB.innerText(), /Dinner crew/i);

  await breeca.joinNext(() => cardA.click());
  assert.equal(breeca.currentRoomId(), roomA);
  await eventually(async () => assert.match(await eventTitle(breeca), /^Beach day/i), { message: 'back in the first event' });

  await breeca.tid('btn-events').click();
  await breeca.joinNext(() => breeca.page.locator(`[data-testid="event-card"][data-room-id="${roomB}"]`).click());
  assert.equal(breeca.currentRoomId(), roomB);
  await eventually(async () => assert.match(await eventTitle(breeca), /^Dinner crew/i), { message: 'and in the second event' });
  breeca.assertNoErrors();
});

scenario('9e. event: an event the server no longer has is dropped from the list', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca, { eventName: 'Short lived' });
  await waitForCrew(breeca, 1);
  const roomId = breeca.roomId;
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${roomId}`)).status, 200);

  await s.server.restart(); // like a redeploy: every room is gone
  assert.equal((await fetch(`${s.baseUrl}/api/rooms/${roomId}`)).status, 404, 'the restarted server has no rooms');

  // Same tab, back to the root: the list is checked against the server.
  await breeca.page.goto(`${s.baseUrl}/?sim=${SPOTS.breeca[0]},${SPOTS.breeca[1]}`, { waitUntil: 'domcontentloaded' });
  await eventually(async () => assert.ok(await landingCreateButton(breeca.page).isVisible()), { message: 'landing page after restart' });
  await eventually(async () => assert.ok(!(await eventCardIds(breeca)).includes(roomId)), { message: 'dead event dropped from the list' });
});

scenario('11. closing a page keeps the player in the event, greyed out for everyone else', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  const ericId = eric.id;

  await eric.page.close();

  await eventually(async () => assert.ok(await avatarOffline(breeca, ericId)), { message: "Eric's avatar is greyed out for Breeca" });
  assert.ok(breeca.received.some((m) => m.t === 'player' && m.player.id === ericId && !m.player.online), 'the server marked Eric offline');
  assert.ok(!breeca.received.some((m) => m.t === 'left' && m.id === ericId), 'Eric was not removed');
  await waitForCrew(breeca, 2);
  breeca.assertNoErrors();
});
