import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { gameStyle } from '../src/mapStyle.ts';

test('map style passes the MapLibre style-spec validator', () => {
  assert.deepEqual(validateStyleMin(gameStyle() as never).map((e) => e.message), []);
});
