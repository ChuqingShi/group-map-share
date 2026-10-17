import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, STEP_IDS, loadQuest, markDone, progress, resultsText, saveQuest, shouldShowIntro, type QuestState, type Store } from '../src/quest.ts';

const memory = (initial: Record<string, string> = {}): Store => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};
const q = (over: Partial<QuestState> = {}): QuestState => ({ build: 'abc1234', started: true, done: [], ...over });
const open = { forced: false, suppressed: false, automated: false };

test('the intro shows once per build, not again for the same one', () => {
  assert.equal(shouldShowIntro(null, 'abc', open), true, 'first ever launch');
  assert.equal(shouldShowIntro(q({ build: 'abc' }), 'abc', open), false, 'already seen this build');
  assert.equal(shouldShowIntro(q({ build: 'abc' }), 'def', open), true, 'new build, show again');
});

test('?quest forces it, ?noquest hides it, automated browsers never see it unless forced', () => {
  assert.equal(shouldShowIntro(q({ build: 'abc' }), 'abc', { ...open, forced: true }), true);
  assert.equal(shouldShowIntro(null, 'abc', { ...open, suppressed: true }), false);
  assert.equal(shouldShowIntro(null, 'abc', { ...open, forced: true, suppressed: true }), false, 'noquest wins');
  assert.equal(shouldShowIntro(null, 'abc', { ...open, automated: true }), false);
  assert.equal(shouldShowIntro(null, 'abc', { ...open, automated: true, forced: true }), true);
});

test('steps are ticked once, in any order, and progress counts them', () => {
  let s = q();
  s = markDone(s, 'flag');
  s = markDone(s, 'flag');
  s = markDone(s, 'mood');
  assert.deepEqual(s.done, ['flag', 'mood']);
  assert.deepEqual(progress(s), { done: 2, total: STEP_IDS.length, complete: false });
  for (const id of STEP_IDS) s = markDone(s, id);
  assert.equal(progress(s).complete, true);
  assert.deepEqual(progress(null), { done: 0, total: STEP_IDS.length, complete: false });
});

test('every step has an icon, a title and a hint', () => {
  assert.equal(STEPS.length, STEP_IDS.length);
  for (const s of STEPS) assert.ok(s.icon && s.title && s.hint, s.id);
});

test('saved state round trips, and corrupt storage is ignored without throwing', () => {
  const s = memory();
  saveQuest(q({ done: ['mood', 'talk'] }), s);
  assert.deepEqual(loadQuest(s)?.done, ['mood', 'talk']);
  for (const raw of ['nope', '{}', '[]', 'null', '{"build":5}']) assert.equal(loadQuest(memory({ 'gms-quest': raw })), null, raw);
  const dirty = loadQuest(memory({ 'gms-quest': JSON.stringify({ build: 'x', started: true, done: ['mood', 'mood', 'hack', 7] }) }));
  assert.deepEqual(dirty?.done, ['mood'], 'unknown and duplicate steps dropped');
  assert.equal(loadQuest(null), null);
  assert.doesNotThrow(() => saveQuest(q(), { getItem: () => null, setItem: () => { throw new Error('quota'); } }));
});

test('the results email lists every step with its state and the build id', () => {
  const text = resultsText(q({ done: ['mood'] }));
  assert.match(text, /build abc1234/);
  assert.match(text, /\[x\] Set your mood/);
  assert.match(text, /\[ \] Leave the event/);
  assert.equal(text.split('\n').filter((l) => l.startsWith('[')).length, STEPS.length);
});
