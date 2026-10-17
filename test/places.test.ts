import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByName, nameMatches, nameTokens, nearestPoi, poiKind, toFound, type Poi } from '../src/places.ts';

const joes: Poi = { name: "Joe's Tacos & Tequila", cls: 'restaurant', subclass: 'mexican', lat: 34.0108, lng: -118.4985 };
const blue: Poi = { name: 'Blue Bottle Coffee', cls: 'cafe', lat: 34.0112, lng: -118.4979 };
const rooftop: Poi = { name: 'The Rooftop Bar', cls: 'bar', lat: 34.0101, lng: -118.4991 };
const far: Poi = { name: "Joe's Tacos", cls: 'fast_food', lat: 34.2, lng: -118.2 };
const all = [joes, blue, rooftop, far];

test('names are compared without accents, apostrophes, punctuation or filler words', () => {
  assert.deepEqual(nameTokens("Joe's Tacos & Tequila"), ['joes', 'tacos', 'tequila']);
  assert.deepEqual(nameTokens('Café  Müller!'), ['cafe', 'muller'].filter((t) => t !== 'cafe'));
  assert.deepEqual(nameTokens('The Rooftop Bar'), ['rooftop']);
  assert.deepEqual(nameTokens(''), []);
});

test('what you said matches a place when every word you said is in its name, loosely', () => {
  assert.ok(nameMatches("joe's tacos", "Joe's Tacos & Tequila"));
  assert.ok(nameMatches('joes tacos', "Joe's Tacos & Tequila"), 'no apostrophe');
  assert.ok(nameMatches('jose tacos', "Joe's Tacos"), 'one slip on a long word');
  assert.ok(nameMatches('blue bottle', 'Blue Bottle Coffee'));
  assert.ok(nameMatches('rooftop', 'The Rooftop Bar'));
  assert.equal(nameMatches('blue bottle', 'Blue Moon Diner'), false);
  assert.equal(nameMatches('tacos', ''), false);
  assert.equal(nameMatches('', 'Joe'), false);
  assert.equal(nameMatches('pizza', "Joe's Tacos"), false);
});

test('dropping a flag snaps to the closest named place within 40 m, otherwise to nothing', () => {
  assert.equal(nearestPoi(all, { lat: 34.01081, lng: -118.49851 })?.name, "Joe's Tacos & Tequila");
  assert.equal(nearestPoi(all, { lat: 34.0108, lng: -118.499 }), null, 'about 45 m away: not close enough');
  assert.equal(nearestPoi([], { lat: 0, lng: 0 }), null);
  assert.equal(nearestPoi([{ ...joes, name: '' }], { lat: 34.0108, lng: -118.4985 }), null, 'unnamed points are ignored');
});

test('saying a name finds the nearest matching place, and ignores ones too far away', () => {
  const here = { lat: 34.0105, lng: -118.4988 };
  assert.equal(findByName(all, "joe's tacos", here)?.lat, joes.lat, 'the nearby Joe, not the one 30 km away');
  assert.equal(findByName([far], "joe's tacos", here), null, 'too far');
  assert.equal(findByName([far], "joe's tacos", here, 100_000)?.name, "Joe's Tacos", 'unless we allow it');
  assert.equal(findByName(all, 'sushi', here), null);
});

test('the kind of place suggests the kind of plan', () => {
  assert.equal(poiKind('restaurant', undefined, 12), 'lunch');
  assert.equal(poiKind('restaurant', undefined, 19), 'dinner');
  assert.equal(poiKind('fast_food', undefined, 11), 'lunch');
  assert.equal(poiKind('cafe', undefined, 9), 'coffee');
  assert.equal(poiKind('bar', undefined, 21), 'drinks');
  assert.equal(poiKind('restaurant', 'pub', 21), 'drinks', 'subclass counts too');
  assert.equal(poiKind('park', undefined, 12), 'meetup');
  assert.deepEqual(toFound(blue, 10), { name: 'Blue Bottle Coffee', lat: blue.lat, lng: blue.lng, kind: 'coffee' });
});
