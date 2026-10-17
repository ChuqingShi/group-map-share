// Scenario 3: a mood shows on the pin and on the avatar for everyone, and clearing removes it.
import assert from 'node:assert/strict';
import { MOOD_EMOJI, type ServerMsg } from '../shared/protocol.ts';
import { SPOTS, avatarMood, eventually, openSheet, pinFor, setup, waitForCrew } from './harness.ts';

const { scenario } = setup();

scenario('3. mood: Ann is hungry, Bob sees a badge on her pin and avatar, clearing removes it', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // No mood to begin with.
  assert.equal(await pinFor(bob, ann.id).locator('[data-testid="pin-mood"]').count(), 0);

  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-hungry').click();
  await ann.tid('mood-note').fill('starving for tacos');
  await ann.tid('btn-mood-share').click();

  // On the wire first, so a failure says whether the server or the UI is at fault.
  const moodMsg = await bob.waitForMessage<Extract<ServerMsg, { t: 'player' }>>(
    (m) => m.t === 'player' && m.player.id === ann.id && m.player.mood?.id === 'hungry',
  );
  assert.equal(moodMsg.player.mood?.note, 'starving for tacos');

  // Bob: a badge on Ann's pin and on Ann's avatar. Ann sees her own avatar badge too.
  await eventually(async () => assert.ok((await pinFor(bob, ann.id).locator('[data-testid="pin-mood"]').count()) > 0), {
    message: "mood badge on Ann's pin (Bob's screen)",
  });
  await eventually(async () => assert.ok(await avatarMood(bob, ann.id, MOOD_EMOJI.hungry)), { message: "mood on Ann's avatar (Bob's screen)" });
  await eventually(async () => assert.ok(await avatarMood(ann, ann.id, MOOD_EMOJI.hungry)), { message: "mood on Ann's own avatar" });

  // Clear it again.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('btn-mood-clear').click();
  await eventually(async () => assert.equal(await pinFor(bob, ann.id).locator('[data-testid="pin-mood"]').count(), 0), {
    message: "mood badge gone from Ann's pin",
  });
  await eventually(async () => assert.equal(await avatarMood(bob, ann.id, MOOD_EMOJI.hungry), false), { message: "mood gone from Ann's avatar" });
  await eventually(async () => assert.equal(await avatarMood(ann, ann.id, MOOD_EMOJI.hungry), false), { message: "mood gone from Ann's own avatar" });

  ann.assertNoErrors();
  bob.assertNoErrors();
});
