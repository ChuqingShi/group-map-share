import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARRIVED_M, dotRadius, dotSpacingPx, dotsAlong, metresPerPixel, treasureTrails } from '../src/treasure.ts';
import { distanceM } from '../src/geo.ts';
import type { Plan, Player } from '../shared/protocol.ts';

const player = (id: string, lat: number, lng: number, over: Partial<Player> = {}): Player => ({
  id,
  name: id.toUpperCase(),
  avatar: '🦊',
  color: `#${id.padEnd(6, '0').slice(0, 6)}`,
  pos: { lat, lng, acc: 5, at: 0 },
  online: true,
  sharing: true,
  mood: null,
  organizer: false,
  contact: '',
  ...over,
});

// The X, and spots a known distance west of it (1 degree of longitude here is about 92 km).
const X = { lat: 34.0, lng: -118.5 };
const west = (metres: number) => X.lng - metres / (111_320 * Math.cos((X.lat * Math.PI) / 180));
const at = (id: string, metres: number, over: Partial<Player> = {}) => player(id, X.lat, west(metres), over);

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', by: 'a', byName: 'Eric', kind: 'lunch', place: "Joe's Tacos", note: '', lat: X.lat, lng: X.lng, joined: ['a'], declined: [], suggestions: [], createdAt: 0, ...over,
});

const ids = (c: ReturnType<typeof treasureTrails>) => c.features.map((f) => `${f.properties.planId}:${f.properties.playerId}${f.properties.preview ? '*' : ''}`);

test('empty inputs give an empty collection', () => {
  assert.deepEqual(treasureTrails([], [], null, null), { type: 'FeatureCollection', features: [] });
  assert.equal(treasureTrails([at('a', 200)], [], 'a', null).features.length, 0);
  assert.equal(treasureTrails([], [plan()], 'a', 'p1').features.length, 0);
  assert.equal(treasureTrails([at('a', 200)], [plan({ joined: [] })], null, null).features.length, 0);
});

test('every live joined player gets a trail in their own colour that runs from them to the X', () => {
  const a = at('a', 300);
  const b = at('b', 150);
  const out = treasureTrails([a, b], [plan({ joined: ['a', 'b'] })], null, null);
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 2);
  out.features.forEach((f, i) => {
    const p = i === 0 ? a : b;
    assert.equal(f.type, 'Feature');
    assert.equal(f.geometry.type, 'LineString');
    assert.deepEqual(f.properties, { planId: 'p1', playerId: p.id, color: p.color, preview: false });
    const c = f.geometry.coordinates;
    assert.ok(c.length > 2, 'a curve, not a straight hop');
    assert.deepEqual(c[0], [p.pos!.lng, p.pos!.lat]);
    assert.deepEqual(c[c.length - 1], [X.lng, X.lat]);
  });
});

test('offline players, non-sharing players and players without a fix are skipped', () => {
  const players = [
    at('a', 300),
    at('b', 300, { online: false }),
    at('c', 300, { sharing: false }),
    at('d', 300, { pos: null }),
    at('e', 300, { online: false, sharing: false, pos: null }),
  ];
  const out = treasureTrails(players, [plan({ joined: ['a', 'b', 'c', 'd', 'e'] })], null, null);
  assert.deepEqual(ids(out), ['p1:a']);
});

test('ids in joined that are not in the room are skipped, and duplicates only draw once', () => {
  const out = treasureTrails([at('a', 300)], [plan({ joined: ['ghost', 'a', 'a', 'ghost'] })], null, null);
  assert.deepEqual(ids(out), ['p1:a']);
});

test('a player who is not in joined gets no trail, even if they are the plan creator', () => {
  const out = treasureTrails([at('a', 300), at('b', 300)], [plan({ by: 'a', joined: ['b'] })], null, null);
  assert.deepEqual(ids(out), ['p1:b']);
});

test('players who have arrived (within 8 m) are skipped, players just outside are not', () => {
  assert.equal(ARRIVED_M, 8);
  const players = [at('a', 0), at('b', 3), at('c', 7), at('d', 12), at('e', 40)];
  const out = treasureTrails(players, [plan({ joined: ['a', 'b', 'c', 'd', 'e'] })], null, null);
  assert.deepEqual(ids(out), ['p1:d', 'p1:e']);
  for (const f of out.features) {
    const c = f.geometry.coordinates;
    assert.ok(distanceM({ lng: c[0][0], lat: c[0][1] }, X) >= ARRIVED_M);
  }
});

test('the preview trail shows for me only when I have not joined the selected plan', () => {
  const me = at('me', 250);
  const other = at('b', 100);
  const p = plan({ joined: ['b'] });

  const out = treasureTrails([me, other], [p], 'me', 'p1');
  assert.deepEqual(ids(out), ['p1:b', 'p1:me*']);
  const preview = out.features[1];
  assert.equal(preview.properties.preview, true);
  assert.equal(preview.properties.color, me.color);
  assert.deepEqual(preview.geometry.coordinates[0], [me.pos!.lng, me.pos!.lat]);
  assert.deepEqual(preview.geometry.coordinates.at(-1), [X.lng, X.lat]);

  // Already in: just my real trail, no preview on top of it.
  const joined = treasureTrails([me, other], [plan({ joined: ['b', 'me'] })], 'me', 'p1');
  assert.deepEqual(ids(joined), ['p1:b', 'p1:me']);
  assert.equal(joined.features.every((f) => !f.properties.preview), true);
});

test('no preview without a selection, with an unknown plan id, or when I am null or unknown', () => {
  const me = at('me', 250);
  const p = plan({ joined: ['b'] });
  assert.equal(treasureTrails([me], [p], 'me', null).features.length, 0);
  assert.equal(treasureTrails([me], [p], 'me', 'nope').features.length, 0);
  assert.equal(treasureTrails([me], [p], null, 'p1').features.length, 0);
  assert.equal(treasureTrails([me], [p], 'someone-else', 'p1').features.length, 0);
});

test('no preview when I am offline, not sharing, have no fix, or have arrived', () => {
  const p = plan({ joined: [] });
  assert.equal(treasureTrails([at('me', 250, { online: false })], [p], 'me', 'p1').features.length, 0);
  assert.equal(treasureTrails([at('me', 250, { sharing: false })], [p], 'me', 'p1').features.length, 0);
  assert.equal(treasureTrails([at('me', 250, { pos: null })], [p], 'me', 'p1').features.length, 0);
  assert.equal(treasureTrails([at('me', 2)], [p], 'me', 'p1').features.length, 0);
  assert.equal(treasureTrails([at('me', 250)], [p], 'me', 'p1').features.length, 1);
});

test('the preview aims at the selected plan, not at any other', () => {
  const me = at('me', 250);
  const p1 = plan({ id: 'p1', joined: ['b'] });
  const p2 = plan({ id: 'p2', lat: 34.002, lng: X.lng + 0.001, joined: ['b'] });
  const out = treasureTrails([me, at('b', 100)], [p1, p2], 'me', 'p2');
  const preview = out.features.filter((f) => f.properties.preview);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].properties.planId, 'p2');
  assert.deepEqual(preview[0].geometry.coordinates.at(-1), [p2.lng, p2.lat]);
});

test('ordering is stable: plans in input order, joined in order, preview last', () => {
  const players = [at('a', 100), at('b', 200), at('c', 300), at('me', 400)];
  const plans = [
    plan({ id: 'p2', joined: ['c', 'a'] }),
    plan({ id: 'p1', joined: ['b', 'c', 'a'] }),
    plan({ id: 'p3', joined: ['a'] }),
  ];
  const expected = ['p2:c', 'p2:a', 'p1:b', 'p1:c', 'p1:a', 'p3:a', 'p1:me*'];
  assert.deepEqual(ids(treasureTrails(players, plans, 'me', 'p1')), expected);
  // Same inputs, same output, regardless of how the players array is ordered.
  assert.deepEqual(ids(treasureTrails([...players].reverse(), plans, 'me', 'p1')), expected);
  assert.deepEqual(treasureTrails(players, plans, 'me', 'p1'), treasureTrails(players, plans, 'me', 'p1'));
});

test('the same player on two plans gets two trails', () => {
  const out = treasureTrails([at('a', 100)], [plan({ id: 'p1' }), plan({ id: 'p2', lat: 34.003, joined: ['a'] })], null, null);
  assert.deepEqual(ids(out), ['p1:a', 'p2:a']);
});

test('inputs are not mutated', () => {
  const players = [at('a', 100), at('me', 300)];
  const plans = [plan({ joined: ['a'] })];
  const before = JSON.stringify([players, plans]);
  treasureTrails(players, plans, 'me', 'p1');
  assert.equal(JSON.stringify([players, plans]), before);
});

// --- marching dots ---------------------------------------------------------

const line: [number, number][] = [[X.lng - 0.01, X.lat], [X.lng, X.lat]]; // about 920 m, due east
const gap = (a: [number, number], b: [number, number]) => distanceM({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
const lineLen = gap(line[0], line[1]);

test('dots sit evenly spaced along the trail, starting at the phase offset', () => {
  const dots = dotsAlong(line, 100, 0);
  assert.equal(dots.length, Math.floor(lineLen / 100) + 1);
  assert.deepEqual(dots[0], line[0]);
  for (let i = 1; i < dots.length; i++) assert.ok(Math.abs(gap(dots[i - 1], dots[i]) - 100) < 0.5, `gap ${i}`);
  const shifted = dotsAlong(line, 100, 0.25);
  assert.ok(Math.abs(gap(line[0], shifted[0]) - 25) < 0.5);
});

test('a growing phase marches every dot toward the end of the trail, and wrapping repeats the picture', () => {
  const d0 = dotsAlong(line, 100, 0.1);
  const d1 = dotsAlong(line, 100, 0.2);
  for (let i = 0; i < Math.min(d0.length, d1.length); i++) {
    assert.ok(d1[i][0] > d0[i][0], 'dot moved east, toward the X');
    assert.ok(Math.abs(gap(d0[i], d1[i]) - 10) < 0.5);
  }
  assert.deepEqual(dotsAlong(line, 100, 1.25), dotsAlong(line, 100, 0.25));
  assert.deepEqual(dotsAlong(line, 100, -0.75), dotsAlong(line, 100, 0.25));
});

test('dots never run past the end and follow a curved trail', () => {
  const [{ geometry }] = treasureTrails([at('a', 300)], [plan()], null, null).features;
  const curve = geometry.coordinates;
  const dots = dotsAlong(curve, 20, 0.5);
  assert.ok(dots.length > 10);
  // Every dot is within a hair of some segment of the curve.
  const near = (p: [number, number]) => Math.min(...curve.map((c) => gap(p, c)));
  for (const d of dots) assert.ok(near(d) < 12, 'dot hugs the curve');
  assert.ok(gap(dots.at(-1)!, curve.at(-1)!) < 20);
});

test('the dot count is capped by widening the spacing', () => {
  const dots = dotsAlong(line, 1, 0, 50);
  assert.ok(dots.length <= 51 && dots.length >= 49, `${dots.length}`);
  assert.ok(gap(dots.at(-1)!, line[1]) < lineLen / 50 + 0.5);
});

test('degenerate input gives no dots instead of hanging', () => {
  assert.deepEqual(dotsAlong([], 10, 0), []);
  assert.deepEqual(dotsAlong([[1, 1]], 10, 0), []);
  assert.deepEqual(dotsAlong([[1, 1], [1, 1]], 10, 0), []);
  assert.deepEqual(dotsAlong(line, 0, 0), []);
  assert.deepEqual(dotsAlong(line, -5, 0), []);
  assert.deepEqual(dotsAlong(line, Infinity, 0), []);
  assert.deepEqual(dotsAlong(line, NaN, 0), []);
  assert.ok(dotsAlong(line, 100, NaN).length > 0);
  assert.ok(dotsAlong(line, 100, 0, 0).length <= 2);
});

test('dot size and spacing grow with zoom, and a pixel is smaller on the ground when zoomed in', () => {
  assert.equal(dotRadius(5), dotRadius(12));
  assert.equal(dotRadius(25), dotRadius(19));
  assert.ok(dotRadius(14) > dotRadius(12) && dotRadius(14) < dotRadius(16));
  assert.ok(dotSpacingPx(18) > dotSpacingPx(13));
  assert.ok(dotSpacingPx(16) > 2 * (dotRadius(16) + 2), 'neighbouring dots do not touch');
  assert.ok(Math.abs(metresPerPixel(0, 0) - 78271.5) < 1);
  assert.ok(Math.abs(metresPerPixel(17, 0) * 2 ** 17 - metresPerPixel(0, 0)) < 1e-6);
  assert.ok(metresPerPixel(16, 60) < metresPerPixel(16, 0));
});
