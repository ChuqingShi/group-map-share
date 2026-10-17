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
