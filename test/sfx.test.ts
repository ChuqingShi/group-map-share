import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
};
const { playSfx, setSfxOn, sfxAllowed, sfxOn, unlockSfx } = await import('../src/sfx.ts');

test('sound effects are on by default', () => {
  mem.clear();
  assert.equal(sfxOn(), true);
});

test('the off switch is remembered and can be flipped back', () => {
  setSfxOn(false);
  assert.equal(sfxOn(), false);
  assert.equal(mem.get('gms-sfx'), 'off');
  setSfxOn(true);
  assert.equal(sfxOn(), true);
});

test('throttle ignores a repeat under 150 ms and allows it after', () => {
  assert.equal(sfxAllowed(undefined, 1000), true);
  assert.equal(sfxAllowed(1000, 1100), false);
  assert.equal(sfxAllowed(1000, 1150), true);
});

test('nothing throws without an AudioContext', () => {
  assert.doesNotThrow(() => unlockSfx());
  assert.doesNotThrow(() => playSfx('join'));
  setSfxOn(false);
  assert.doesNotThrow(() => playSfx('ping'));
});
