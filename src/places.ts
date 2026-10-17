// Finding a named place (a restaurant, a bar) among the points of interest the map has already
// loaded, so dropping a flag on a restaurant names it, and saying "let's eat at Joe's Tacos" can find it.
// Pure functions: the map code feeds in the points. Nothing leaves the device.
import { distanceM, type LatLng } from './geo.ts';
import type { PlanKind } from '../shared/protocol.ts';

export interface Poi extends LatLng {
  name: string;
  /** OpenMapTiles `class` and `subclass` of the point of interest, e.g. restaurant / fast_food. */
  cls: string;
  subclass?: string;
}

export interface FoundPlace extends LatLng {
  name: string;
  kind: PlanKind;
}

const DRINKS = new Set(['bar', 'pub', 'biergarten', 'nightclub', 'cocktail', 'beer', 'wine_bar', 'brewery']);
const COFFEE = new Set(['cafe', 'coffee_shop', 'tea']);
const FOOD = new Set(['restaurant', 'fast_food', 'food_court', 'bakery', 'ice_cream', 'deli']);

/** What kind of plan a place suggests. Food before 4 pm is lunch, after is dinner. */
export function poiKind(cls: string, subclass: string | undefined, hour: number): PlanKind {
  const keys = [cls, subclass ?? ''].map((k) => k.toLowerCase());
  if (keys.some((k) => DRINKS.has(k))) return 'drinks';
  if (keys.some((k) => COFFEE.has(k))) return 'coffee';
  if (keys.some((k) => FOOD.has(k))) return hour < 16 ? 'lunch' : 'dinner';
  return 'meetup';
}

const STOP = new Set(['the', 'a', 'an', 'at', 'of', 'and', 'restaurant', 'cafe', 'bar', 'grill', 'kitchen', 'house']);

/** "Joe's Tacos & Tequila" becomes ["joes", "tacos", "tequila"]: no accents, apostrophes or punctuation, and no filler words. */
export function nameTokens(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !STOP.has(t));
}

function edits(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * Same word, allowing for how speech recognition mangles names: a missing or extra "s" ("joe" ~ "joes"),
 * one slip on a word of 5+ letters, or two neighbouring letters swapped ("jose" ~ "joes").
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long === `${short}s`) return true;
  if (Math.min(a.length, b.length) >= 5 && edits(a, b) <= 1) return true;
  if (a.length === b.length && a.length >= 4 && [...a].sort().join('') === [...b].sort().join('') && edits(a, b) <= 2) return true;
  return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/** Every word the person said appears (loosely) in the place's name. */
export function nameMatches(said: string, name: string): boolean {
  const want = nameTokens(said);
  const have = nameTokens(name);
  return want.length > 0 && have.length > 0 && want.every((w) => have.some((h) => sameWord(w, h)));
}

/** The closest named place within `radiusM` of a point, or null. Several tiles can repeat the same place; that is fine. */
export function nearestPoi(pois: readonly Poi[], p: LatLng, radiusM = 40): Poi | null {
  let best: Poi | null = null;
  let bestD = radiusM;
  for (const poi of pois) {
    if (!poi.name) continue;
    const d = distanceM(p, poi);
    if (d <= bestD) {
      best = poi;
      bestD = d;
    }
  }
  return best;
}

/** The place whose name matches what was said, nearest to `near`, within `maxM`. Null when nothing matches. */
export function findByName(pois: readonly Poi[], said: string, near: LatLng, maxM = 3000): Poi | null {
  let best: Poi | null = null;
  let bestD = maxM;
  for (const poi of pois) {
    if (!poi.name || !nameMatches(said, poi.name)) continue;
    const d = distanceM(near, poi);
    if (d <= bestD) {
      best = poi;
      bestD = d;
    }
  }
  return best;
}

export function toFound(poi: Poi, hour: number): FoundPlace {
  return { name: poi.name, lat: poi.lat, lng: poi.lng, kind: poiKind(poi.cls, poi.subclass, hour) };
}
