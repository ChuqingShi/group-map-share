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

/** Eric's (or Breeca's) screen shows the sent bubble as a thought bubble and as a "bubble" toast. */
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
  const breeca = await s.player('Breeca', SPOTS.breeca);
  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  // --- typed ---
  const typed = "let's go eat at joe's tacos";
  await openSheet(breeca, 'btn-talk', 'talk-sheet');
  await breeca.tid('talk-input').fill(typed);
  let preview!: string;
  await eventually(async () => (preview = await previewText(breeca)), { message: 'talk preview for typed words' });
  assert.notEqual(normalise(preview), normalise(typed), 'the preview is boiled down, not the exact words');
  assert.ok([...preview].length <= BUBBLE_MAX + 8, `short enough for a bubble: "${preview}"`);
  assert.match(preview, /joe/i, 'the place survives the boiling down');
  await breeca.tid('btn-talk-send').click();
  const sent = await expectBubbleSeen(eric, breeca, preview);
  assert.notEqual(normalise(sent.text), normalise(typed));

  // --- spoken, through the stubbed recogniser (Eric speaks, so Breeca's 3 s bubble cooldown is not in the way) ---
  await eric.setTranscript('meet me at the pier in ten minutes');
  await openSheet(eric, 'btn-talk', 'talk-sheet');
  await eric.tid('btn-talk-mic').click();
  await eventually(
    async () => assert.ok(((await eric.page.evaluate(() => (window as unknown as { __recognitionStarts: number }).__recognitionStarts)) ?? 0) >= 1),
    { message: 'speech recognition started' },
  );
  let spokenPreview!: string;
  await eventually(async () => (spokenPreview = await previewText(eric)), { message: 'talk preview for speech' });
  assert.notEqual(normalise(spokenPreview), normalise('meet me at the pier in ten minutes'));
  await eric.tid('btn-talk-send').click();
  await expectBubbleSeen(breeca, eric, spokenPreview);

  breeca.assertNoErrors();
  eric.assertNoErrors();
});

scenario('6b. talk: a place name offers to turn the words into a plan', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  await waitForCrew(breeca, 1);
  await openSheet(breeca, 'btn-talk', 'talk-sheet');
  await breeca.tid('talk-input').fill("let's go eat at joe's tacos");
  await eventually(async () => assert.ok(await breeca.tid('btn-talk-plan').isVisible()), { message: '"make it a plan" button' });
  await breeca.tid('btn-talk-plan').click();
  // Next comes the flag-drop step or the plan form itself.
  await eventually(async () => assert.ok((await breeca.tid('drop-banner').isVisible()) || (await breeca.tid('plan-form').isVisible())), {
    message: 'drop banner or plan form after "make it a plan"',
  });
  breeca.assertNoErrors();
});
