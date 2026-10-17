import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetEvent, getEvent, loadEvents, saveEvent, touchEvent, type SavedEvent, type Store } from '../src/events.ts';

function memory(initial: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}
const ev = (id: string, lastSeen: number, over: Partial<SavedEvent> = {}): SavedEvent => ({
  id, name: `Event ${id}`, token: null, profile: { name: 'Eric', avatar: '🦊', color: '#ff5d73' }, joinedAt: lastSeen, lastSeen, ...over,
});

test('events are remembered, newest first, and found by id', () => {
  const s = memory();
  saveEvent(ev('a', 100), s);
  saveEvent(ev('b', 300), s);
  saveEvent(ev('c', 200), s);
  assert.deepEqual(loadEvents(s).map((e) => e.id), ['b', 'c', 'a']);
  assert.equal(getEvent('c', s)?.name, 'Event c');
  assert.equal(getEvent('zzz', s), undefined);
});

test('saving the same event again replaces it instead of duplicating', () => {
  const s = memory();
  saveEvent(ev('a', 100), s);
  saveEvent(ev('a', 500, { token: 'tok' }), s);
  assert.equal(loadEvents(s).length, 1);
  assert.equal(getEvent('a', s)?.token, 'tok');
});

test('touch updates token, name and last seen, and ignores events we do not remember', () => {
  const s = memory();
  saveEvent(ev('a', 100), s);
  touchEvent('a', { token: 'T', name: 'Team lunch' }, s, 999);
  const a = getEvent('a', s)!;
  assert.equal(a.token, 'T');
  assert.equal(a.name, 'Team lunch');
  assert.equal(a.lastSeen, 999);
  touchEvent('nope', { token: 'x' }, s, 1);
  assert.equal(loadEvents(s).length, 1);
});

test('leaving forgets only that event, so several events can coexist', () => {
  const s = memory();
  saveEvent(ev('a', 1), s);
  saveEvent(ev('b', 2), s);
  forgetEvent('a', s);
  assert.deepEqual(loadEvents(s).map((e) => e.id), ['b']);
  forgetEvent('b', s);
  assert.deepEqual(loadEvents(s), []);
});

test('corrupt or hostile storage never throws and never yields bad entries', () => {
  for (const raw of ['not json', '{}', '"x"', 'null', '[1,2,3]', '[{"id":"../x","lastSeen":1}]', '[{"id":"ok","lastSeen":1}]']) {
    assert.deepEqual(loadEvents(memory({ 'gms-events': raw })), [], raw);
  }
  assert.deepEqual(loadEvents(null), []);
  saveEvent(ev('a', 1), null); // no storage at all: silently nothing
});

test('only the most recent 20 events are kept', () => {
  const s = memory();
  for (let i = 0; i < 25; i++) saveEvent(ev(`e${i}`, i), s);
  const ids = loadEvents(s).map((e) => e.id);
  assert.equal(ids.length, 20);
  assert.equal(ids[0], 'e24');
  assert.equal(ids.includes('e0'), false);
});

test('a storage that throws on write does not break the app', () => {
  const s: Store = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.doesNotThrow(() => saveEvent(ev('a', 1), s));
});
