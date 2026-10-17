import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announcement, treasureArc, walkMinutes } from '../src/meetup.ts';
import { distanceM } from '../src/geo.ts';
import type { Plan } from '../shared/protocol.ts';

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', by: 'a', byName: 'Eric', kind: 'lunch', place: "Joe's Tacos", note: '', lat: 34.01, lng: -118.49, joined: ['a'], createdAt: 0, ...over,
});

test('announcements read like the invitation, with distance and note when known', () => {
  assert.equal(announcement(plan(), null), "Eric is inviting you for lunch at Joe's Tacos.");
  assert.equal(announcement(plan({ kind: 'meetup', place: 'The Bar' }), 400), "Eric is inviting you to meet up at The Bar. It's about 5 minutes on foot.");
  assert.equal(announcement(plan({ kind: 'drinks' }), 10), "Eric is inviting you for drinks at Joe's Tacos. You're already right there.");
  assert.equal(announcement(plan({ note: 'my treat' }), null), "Eric is inviting you for lunch at Joe's Tacos. Eric says: my treat.");
  assert.equal(announcement(plan({ note: 'hurry!' }), null).endsWith('hurry!'), true);
});

test('walking time is at least a minute and scales with distance', () => {
  assert.equal(walkMinutes(5), 1);
  assert.equal(walkMinutes(800), 10);
});

test('treasure arc starts and ends exactly at the endpoints and bows to the left', () => {
  const from = { lat: 34.0, lng: -118.5 };
  const to = { lat: 34.0, lng: -118.49 }; // due east, so left of travel is north
  const arc = treasureArc(from, to, 20);
  assert.equal(arc.length, 21);
  assert.deepEqual(arc[0], [from.lng, from.lat]);
  assert.deepEqual(arc[20], [to.lng, to.lat]);
  const mid = arc[10];
  assert.ok(mid[1] > from.lat, 'midpoint is north of the straight line');
  // Longer than straight, but not wildly so.
  let len = 0;
  for (let i = 1; i < arc.length; i++) len += distanceM({ lng: arc[i - 1][0], lat: arc[i - 1][1] }, { lng: arc[i][0], lat: arc[i][1] });
  const straight = distanceM(from, to);
  assert.ok(len > straight && len < straight * 1.2, `${len} vs ${straight}`);
});

test('a trail to somewhere you are already standing is just a short line', () => {
  const p = { lat: 34.0, lng: -118.5 };
  assert.equal(treasureArc(p, { lat: 34.00003, lng: -118.5 }).length, 2);
});
