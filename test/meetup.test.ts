import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announcement, contactLink, directionsLink, mapsLink, treasureArc, walkMinutes } from '../src/meetup.ts';
import { distanceM } from '../src/geo.ts';
import type { Plan } from '../shared/protocol.ts';

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', by: 'a', byName: 'Eric', kind: 'lunch', place: "Joe's Tacos", note: '', lat: 34.01, lng: -118.49, joined: ['a'], declined: [], suggestions: [], createdAt: 0, ...over,
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

test('a contact line becomes a link only when it is plainly a phone number or an email', () => {
  assert.deepEqual(contactLink('breeca@example.com'), { href: 'mailto:breeca@example.com', label: 'Email' });
  assert.deepEqual(contactLink('  +1 (310) 555-0100 '), { href: 'tel:+13105550100', label: 'Call' });
  assert.deepEqual(contactLink('310.555.0100'), { href: 'tel:3105550100', label: 'Call' });
  for (const text of ['find me by the fountain', 'javascript:alert(1)', 'call me at 5', '123', 'a@b', '<a@b.co>', 'breeca@example.com please', 'tel:123456789', 'x'.repeat(30), '', '+', '1234567890123456789012']) {
    assert.equal(contactLink(text), null, JSON.stringify(text));
  }
});

test('map links are https Google Maps URLs built from the name and coordinates only', () => {
  const url = new URL(mapsLink({ place: "Joe's Tacos & Tequila", lat: 34.0123456789, lng: -118.49 }));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/search/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('query'), "Joe's Tacos & Tequila 34.012346,-118.49");
  // Without a name it is just a pin on the spot.
  assert.equal(new URL(mapsLink({ lat: 1, lng: 2 })).searchParams.get('query'), '1,2');
  assert.equal(new URL(mapsLink({ place: '   ', lat: 1, lng: 2 })).searchParams.get('query'), '1,2');
});

test('whatever a person typed as the place name cannot change the link beyond the query', () => {
  const nasty = 'x&destination=evil.example/#"><script>alert(1)</script>\n  y';
  const url = new URL(mapsLink({ place: nasty, lat: 1, lng: 2 }));
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/search/');
  assert.deepEqual([...url.searchParams.keys()], ['api', 'query']);
  assert.equal(url.hash, '');
  assert.ok(!url.search.includes('<') && !url.search.includes('"'));
});

test('directions link goes to the exact coordinates on foot', () => {
  const url = new URL(directionsLink({ lat: 34.01, lng: -118.49 }));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('destination'), '34.01,-118.49');
  assert.equal(url.searchParams.get('travelmode'), 'walking');
});
