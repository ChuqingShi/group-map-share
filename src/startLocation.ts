// Where the map should open. We ask for the user's location up front (before
// any map is shown) so the map starts where they are, not on a world view.
import type { LatLng } from './geo.ts';
import { simStart, type GeoError } from './useGeolocation.ts';

import { store } from './safeStorage.ts';

const KEY = 'gms-start';
/** Only picks where the map first opens, so a few hours old is fine. Kept on this device only (never sent to the server), rounded to about 1 km. */
const TTL_MS = 12 * 60 * 60_000;

/** Result of the location prompt for this tab: a position, 'declined', or null if we haven't asked yet. */
export function savedStart(): LatLng | 'declined' | null {
  try {
    const o = JSON.parse(store.get(KEY) ?? 'null');
    if (!o || Date.now() - Number(o.at) > TTL_MS) return null;
    const v = o.v;
    return v === 'declined' || (v && typeof v.lat === 'number' && typeof v.lng === 'number') ? v : null;
  } catch {
    return null;
  }
}

export function saveStart(v: LatLng | 'declined') {
  const r = (n: number) => Math.round(n * 100) / 100;
  store.set(KEY, JSON.stringify({ v: v === 'declined' ? v : { lat: r(v.lat), lng: r(v.lng) }, at: Date.now() }));
}

/** Current permission state, if the browser will tell us without prompting. */
export async function locationPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

/** Triggers the browser's permission prompt and resolves with a single fix. */
export function requestLocation(): Promise<LatLng> {
  const sim = simStart();
  if (sim) return Promise.resolve(sim);
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject('insecure' satisfies GeoError);
    if (!('geolocation' in navigator)) return reject('unsupported' satisfies GeoError);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject((e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable') satisfies GeoError),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
    );
  });
}

/**
 * Without a location, guess a sensible world view from the device's time zone:
 * 15° of longitude per hour of UTC offset puts the user's part of the world in view.
 */
export function fallbackView(): { center: [number, number]; zoom: number } {
  const lng = Math.max(-170, Math.min(170, -new Date().getTimezoneOffset() / 4));
  return { center: [lng, 25], zoom: 2 };
}
