// Scenario 6: Talk. What you say or type is boiled down to a short bubble before it is sent.
import assert from 'node:assert/strict';
import { BUBBLE_MAX, type ServerMsg } from '../shared/protocol.ts';
import { SPOTS, eventually, openSheet, setup, toast, waitForCrew, type Player } from './harness.ts';

const { scenario } = setup();

type BubbleMsg = Extract<ServerMsg, { t: 'bubble' }>;
const normalise = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The text in the preview, once the app has understood something (not the "…" placeholder). */
async function previewText(p: Player): Promise<string> {
  const text = ((await p.tid('talk-preview').allInnerTexts())[0] ?? '').trim();
  assert.ok(normalise(text).length > 0, `preview is still empty: "${text}"`);
  return text;
}

/** Bob's (or Ann's) screen shows the sent bubble as a thought bubble and as a "bubble" toast. */
async function expectBubbleSeen(viewer: Player, sender: Player, previewed: string): Promise<BubbleMsg> {
  const msg = await viewer.waitForMessage<BubbleMsg>((m) => m.t === 'bubble' && m.from === sender.id);
  assert.ok(msg.text.length > 0 && [...msg.text].length <= BUBBLE_MAX, `bubble text fits ${BUBBLE_MAX} characters: "${msg.text}"`);
  await eventually(
    async () => {
      const texts = (await viewer.tid('thought').allInnerTexts()).map(normalise);
      assert.ok(texts.some((t) => t.includes(normalise(msg.text))), `no thought bubble with "${msg.text}" in ${JSON.stringify(texts)}`);
    },
    { message: `thought bubble on ${viewer.name}` },
  );
  await eventually(async () => assert.ok((await toast(viewer, 'bubble').count()) > 0), { message: `bubble toast on ${viewer.name}` });
  // The preview is what gets sent.
  assert.ok(normalise(previewed).includes(normalise(msg.text)), `sent "${msg.text}" but previewed "${previewed}"`);
  return msg;
}

scenario('6. talk: typed words become a short bubble on the other screen, and so does speech', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // --- typed ---
  const typed = "let's go eat at joe's tacos";
  await openSheet(ann, 'btn-talk', 'talk-sheet');
  await ann.tid('talk-input').fill(typed);
  let preview!: string;
  await eventually(async () => (preview = await previewText(ann)), { message: 'talk preview for typed words' });
  assert.notEqual(normalise(preview), normalise(typed), 'the preview is boiled down, not the exact words');
  assert.ok([...preview].length <= BUBBLE_MAX + 8, `short enough for a bubble: "${preview}"`);
  assert.match(preview, /joe/i, 'the place survives the boiling down');
  await ann.tid('btn-talk-send').click();
  const sent = await expectBubbleSeen(bob, ann, preview);
  assert.notEqual(normalise(sent.text), normalise(typed));

  // --- spoken, through the stubbed recogniser (Bob speaks, so Ann's 3 s bubble cooldown is not in the way) ---
  await bob.setTranscript('meet me at the pier in ten minutes');
  await openSheet(bob, 'btn-talk', 'talk-sheet');
  await bob.tid('btn-talk-mic').click();
  await eventually(
    async () => assert.ok(((await bob.page.evaluate(() => (window as unknown as { __recognitionStarts: number }).__recognitionStarts)) ?? 0) >= 1),
    { message: 'speech recognition started' },
  );
  let spokenPreview!: string;
  await eventually(async () => (spokenPreview = await previewText(bob)), { message: 'talk preview for speech' });
  assert.notEqual(normalise(spokenPreview), normalise('meet me at the pier in ten minutes'));
  await bob.tid('btn-talk-send').click();
  await expectBubbleSeen(ann, bob, spokenPreview);

  ann.assertNoErrors();
  bob.assertNoErrors();
});

scenario('6b. talk: a place name offers to turn the words into a plan', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  await waitForCrew(ann, 1);
  await openSheet(ann, 'btn-talk', 'talk-sheet');
  await ann.tid('talk-input').fill("let's go eat at joe's tacos");
  await eventually(async () => assert.ok(await ann.tid('btn-talk-plan').isVisible()), { message: '"make it a plan" button' });
  await ann.tid('btn-talk-plan').click();
  // Next comes the flag-drop step or the plan form itself.
  await eventually(async () => assert.ok((await ann.tid('drop-banner').isVisible()) || (await ann.tid('plan-form').isVisible())), {
    message: 'drop banner or plan form after "make it a plan"',
  });
  ann.assertNoErrors();
});
