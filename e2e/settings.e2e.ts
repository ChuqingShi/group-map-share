// Scenario 10: the settings window holds the notify, keep-awake and voice toggles (and the legend), and nothing else does.
import assert from 'node:assert/strict';
import { SPOTS, closeSheet, createPlan, eventually, leaveRoom, openPlans, openSettings, openSheet, setToggle, setup, toggleState, waitForCrew } from './harness.ts';

const { scenario } = setup();

const TOGGLES = ['btn-notify', 'btn-awake', 'btn-voice', 'btn-sfx', 'btn-legend'];

scenario('10. settings: the gear opens a window with notify, awake, voice and legend; voice is off by default', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { permissions: ['notifications'] });
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl }); // no notification permission
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // The plans panel no longer carries the toggles.
  await openPlans(ann);
  for (const id of TOGGLES) assert.equal(await ann.tid('plans-panel').locator(`[data-testid="${id}"]`).count(), 0, `${id} must not be in the plans panel`);

  await openSettings(ann);
  const sheet = ann.tid('settings-sheet');
  for (const id of TOGGLES) assert.equal(await sheet.locator(`[data-testid="${id}"]`).count(), 1, `${id} is in the settings sheet`);
  assert.equal(await toggleState(ann.tid('btn-voice')), false, 'voice is off by default');

  // Notify can be flipped when the browser permission is granted ...
  assert.equal(await ann.tid('btn-notify').isDisabled(), false, 'notify is enabled with permission');
  await setToggle(ann.tid('btn-notify'), true);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-notify')), true), { message: 'notify switched on' });
  await setToggle(ann.tid('btn-notify'), false);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-notify')), false), { message: 'notify switched off' });
  // ... voice can be flipped on and off ...
  await setToggle(ann.tid('btn-voice'), true);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-voice')), true), { message: 'voice switched on' });
  await setToggle(ann.tid('btn-voice'), false);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-voice')), false), { message: 'voice switched off' });
  // ... sound effects are on by default and can be switched off and on ...
  assert.equal(await toggleState(ann.tid('btn-sfx')), true, 'sound effects are on by default');
  await setToggle(ann.tid('btn-sfx'), false);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-sfx')), false), { message: 'sfx switched off' });
  await setToggle(ann.tid('btn-sfx'), true);
  await eventually(async () => assert.equal(await toggleState(ann.tid('btn-sfx')), true), { message: 'sfx switched on' });
  // ... and keep-awake can be tapped without breaking the page (headless Chrome may not grant a wake lock).
  await ann.tid('btn-awake').click();
  await closeSheet(ann, 'settings-sheet');

  // Without permission the notify toggle is disabled.
  await openSettings(bob);
  assert.equal(await bob.tid('btn-notify').isDisabled(), true, 'notify is disabled without permission');

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('17. rename the event: anyone can, everyone sees the new name, and once there is an organizer only organizers can', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  await openSettings(bob);
  await bob.tid('event-rename-input').fill('Team lunch');
  await bob.tid('btn-event-rename').click();
  await eventually(async () => assert.match(await ann.tid('event-title').innerText(), /team lunch/i), { message: "Ann's title shows the new name" });
  await closeSheet(bob, 'settings-sheet');

  // Ann becomes an organizer: now Bob cannot rename.
  await openSettings(ann);
  await setToggle(ann.tid('btn-organizer'), true);
  await closeSheet(ann, 'settings-sheet');
  await eventually(async () => {
    await openSettings(bob);
    assert.equal(await bob.tid('event-rename-input').count(), 0);
    assert.equal(await bob.tid('rename-locked').count(), 1);
  }, { message: 'Bob is locked out of renaming' });
  await closeSheet(bob, 'settings-sheet');

  // The organizer can, and it sticks across a reload.
  await openSettings(ann);
  await ann.tid('event-rename-input').fill('Demo day');
  await ann.tid('btn-event-rename').click();
  await closeSheet(ann, 'settings-sheet');
  await eventually(async () => assert.match(await bob.tid('event-title').innerText(), /demo day/i), { message: "Bob's title shows Demo day" });
  await ann.page.reload();
  await waitForCrew(ann, 2);
  await eventually(async () => assert.match(await ann.tid('event-title').innerText(), /demo day/i), { message: 'the name survives a reload' });

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('17b. an explicit Allow notifications button shows only while the browser has not been asked', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann, { permissions: ['notifications'] }); // already allowed
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl }); // never asked
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);
  await openSettings(ann);
  assert.equal(await ann.tid('btn-allow-notifications').count(), 0, 'already allowed: no button');
  await closeSheet(ann, 'settings-sheet');
  // Headless Chrome answers the join-time prompt by itself; make Bob look like a browser that has not been asked.
  await bob.page.evaluate(() => Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }));
  await openSettings(bob);
  assert.equal(await bob.tid('btn-allow-notifications').count(), 1, 'never asked: the button is there');
  assert.equal(await bob.tid('btn-allow-notifications').isEnabled(), true);
  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('10b. test mission: replaying it from settings shows the progress chip on screen, just above the toolbar', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.ann);
  await openSettings(breeca);
  await breeca.tid('btn-quest-replay').click();
  await closeSheet(breeca, 'quest-panel');

  const chip = breeca.tid('btn-quest');
  await eventually(async () => assert.equal(await chip.isVisible(), true), { message: 'the chip is shown once the mission has started' });
  const box = (await chip.boundingBox())!;
  const bar = (await breeca.page.locator('.hud-bottom').boundingBox())!;
  const viewport = breeca.page.viewportSize()!;
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `the chip is inside the screen (top ${box.y}, height ${box.height})`);
  assert.ok(box.y + box.height <= bar.y, `the chip sits above the toolbar (chip bottom ${box.y + box.height}, toolbar top ${bar.y})`);
  // Breeca was already on the map with location shared, so "set up" counts as soon as the mission starts.
  await eventually(async () => assert.match((await chip.textContent()) ?? '', /1\/7/), { message: 'the chip counts the set up step' });

  breeca.assertNoErrors();
});

scenario('10c. test mission: each of the seven steps ticks itself off when it is done, in mission order', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.ann);
  const done = async () => ((await breeca.page.evaluate(() => JSON.parse(localStorage.getItem('gms-quest') ?? 'null')?.done ?? [])) as string[]).sort();
  const expectDone = (ids: string[], message: string) => eventually(async () => assert.deepEqual(await done(), [...ids].sort()), { message });

  // 1. Set up: Breeca is already on the map with location shared.
  await openSettings(breeca);
  await breeca.tid('btn-quest-replay').click();
  await closeSheet(breeca, 'quest-panel');
  await expectDone(['setup'], 'set up counts once you are on the map');

  // 2. Profile needs both halves: organizer alone is not enough, a new name on the card completes it.
  await openSettings(breeca);
  await setToggle(breeca.tid('btn-organizer'), true);
  await breeca.waitForMessage((m) => m.t === 'player' && m.player.id === breeca.id && m.player.organizer === true);
  await closeSheet(breeca, 'settings-sheet');
  assert.deepEqual(await done(), ['setup'], 'organizer without a name change does not finish the profile step');
  await breeca.page.locator(`[data-testid="crew-avatar"][data-player-id="${breeca.id}"]`).click();
  await breeca.tid('card-name-input').fill('Bree');
  await breeca.tid('btn-card-save').click();
  await closeSheet(breeca, 'person-card');
  await expectDone(['setup', 'profile'], 'name change plus organizer finishes the profile step');

  // 3. Invite: a friend joins.
  const eric = await s.player('Eric', SPOTS.bob, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);
  await expectDone(['setup', 'profile', 'invite'], 'a second person in the event counts as invited');

  // 4. Talk.
  await openSheet(breeca, 'btn-talk', 'talk-sheet');
  await breeca.tid('talk-input').fill("I'm starving, let's get tacos");
  await breeca.tid('talk-preview').waitFor({ state: 'visible' });
  await breeca.tid('btn-talk-send').click();
  await expectDone(['setup', 'profile', 'invite', 'talk'], 'sending something with Talk');

  // 5. A flag of Breeca's (planting by drag is covered in scenario 12).
  await createPlan(breeca, { kind: 'lunch', place: "Joe's Tacos" });
  await expectDone(['setup', 'profile', 'invite', 'talk', 'flag'], 'planting a flag');

  // 6. Eric says I'm in to Breeca's flag (Eric cannot plant one: Breeca is the only organizer).
  await openPlans(eric);
  await eric.tid('btn-plan-join').first().click();
  await expectDone(['setup', 'profile', 'invite', 'talk', 'flag', 'imin'], "a friend saying I'm in to my flag");

  // 7. Leave. The page moves on, but the mission is saved on the device.
  await leaveRoom(breeca);
  await expectDone(['setup', 'profile', 'invite', 'talk', 'flag', 'imin', 'leave'], 'leaving completes the mission');

  breeca.assertNoErrors();
  eric.assertNoErrors();
});
