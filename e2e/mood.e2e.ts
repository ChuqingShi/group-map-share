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

  // One tap on a common mood and it is shared: no second button.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-hungry').click();
  await eventually(async () => assert.equal(await ann.tid('mood-sheet').isVisible(), false), { message: 'the sheet closes by itself' });

  // On the wire first, so a failure says whether the server or the UI is at fault.
  const moodMsg = await bob.waitForMessage<Extract<ServerMsg, { t: 'player' }>>(
    (m) => m.t === 'player' && m.player.id === ann.id && m.player.mood?.id === 'hungry',
  );
  assert.equal(moodMsg.player.mood?.label, 'Hungry');
  assert.equal(moodMsg.player.mood?.emoji, MOOD_EMOJI.hungry);

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

/** Records the name of every sound effect that starts playing (window.__sfx), by following each /sfx/<name>.mp3 through decoding. */
function recordSfx() {
  const w = window as any;
  w.__sfx = [] as string[];
  const names = new WeakMap<object, string>();
  const fetch0 = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const r = await fetch0(...args);
    const name = /\/sfx\/(\w+)\.mp3$/.exec(String(args[0]))?.[1];
    if (name) {
      const read = r.arrayBuffer.bind(r);
      r.arrayBuffer = async () => {
        const b = await read();
        names.set(b, name);
        return b;
      };
    }
    return r;
  };
  const decode0 = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = async function (this: BaseAudioContext, b: ArrayBuffer) {
    const name = names.get(b);
    const buf = await decode0.call(this, b);
    if (name) names.set(buf, name);
    return buf;
  } as any;
  const start0 = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: any[]) {
    const name = this.buffer && names.get(this.buffer);
    if (name) w.__sfx.push(name);
    return start0.apply(this, a as any);
  };
}

scenario('3b. mood sound: one ding per mood change, not one per location update', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  await ann.context.addInitScript(recordSfx);
  await ann.reload();
  const moodDings = async () => ((await ann.page.evaluate(() => (window as any).__sfx)) as string[]).filter((n) => n === 'mood').length;
  const moodEchoes = () => ann.received.filter((m) => m.t === 'player' && m.player.id === ann.id && m.player.mood?.id === 'hungry').length;

  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('mood-hungry').click();
  await eventually(async () => assert.equal(await moodDings(), 1), { message: 'setting a mood dings once' });

  // Ann keeps walking (?sim), so the server keeps re-sending her player record with the same mood in it.
  const before = moodEchoes();
  await eventually(() => assert.ok(moodEchoes() >= before + 3), { message: 'a few location updates arrive with the mood unchanged' });
  assert.equal(await moodDings(), 1, 'location updates must not ding again');

  // Clearing is a real change: one more ding.
  await openSheet(ann, 'btn-mood', 'mood-sheet');
  await ann.tid('btn-mood-clear').click();
  await eventually(async () => assert.equal(await moodDings(), 2), { message: 'clearing the mood dings once' });

  ann.assertNoErrors();
});
