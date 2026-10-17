// Scenario 10: the settings window holds the notify, keep-awake and voice toggles (and the legend), and nothing else does.
import assert from 'node:assert/strict';
import { SPOTS, closeSheet, eventually, openPlans, openSettings, setToggle, setup, toggleState, waitForCrew } from './harness.ts';

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
