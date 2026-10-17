// Pure geometry for the treasure-map layer: which trails exist, and where the marching dots sit.
// No DOM and no maplibre imports, so it runs (and is tested) under plain node.
import { distanceM, type LatLng } from './geo.ts';
import { treasureArc } from './meetup.ts';
import type { Plan, Player } from '../shared/protocol.ts';

/** Closer than this to the X counts as having arrived; no trail is drawn for them. */
export const ARRIVED_M = 8;

export interface TrailProps {
  planId: string;
  playerId: string;
  color: string;
  /** True for the "if I joined" trail from me to the selected plan. */
  preview: boolean;
}

export interface TrailFeature {
  type: 'Feature';
  properties: TrailProps;
  /** Runs from the player to the X, so "forward" along it means "toward the treasure". */
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface TrailCollection {
  type: 'FeatureCollection';
  features: TrailFeature[];
}

/** Where a player is, but only if they are online, sharing and have a usable fix. */
function livePos(p: Player | undefined): LatLng | null {
  const pos = p?.pos;
  if (!p || !p.online || !p.sharing || !pos) return null;
  return Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? { lat: pos.lat, lng: pos.lng } : null;
}

/**
 * One trail per (joined, live player) pair, plus at most one preview trail from me to the selected plan
 * when I have not joined it. Order is deterministic: plans in input order, `joined` in order, preview last.
 */
export function treasureTrails(
  players: Player[],
  plans: Plan[],
  me: string | null,
  selectedPlan: string | null,
): TrailCollection {
  const byId = new Map<string, Player>();
  for (const p of players) if (!byId.has(p.id)) byId.set(p.id, p);

  const features: TrailFeature[] = [];
  const add = (plan: Plan, player: Player, from: LatLng, preview: boolean) => {
    const to = { lat: plan.lat, lng: plan.lng };
    if (distanceM(from, to) < ARRIVED_M) return;
    features.push({
      type: 'Feature',
      properties: { planId: plan.id, playerId: player.id, color: player.color, preview },
      geometry: { type: 'LineString', coordinates: treasureArc(from, to) },
    });
  };

  for (const plan of plans) {
    if (!Number.isFinite(plan.lat) || !Number.isFinite(plan.lng)) continue; // a broken flag must not poison the trail layer
    const done = new Set<string>();
    for (const id of plan.joined) {
      if (done.has(id)) continue;
      done.add(id);
      const player = byId.get(id);
      const from = livePos(player);
      if (player && from) add(plan, player, from, false);
    }
  }

  const selected = selectedPlan === null ? undefined : plans.find((p) => p.id === selectedPlan);
  const mine = me === null ? undefined : byId.get(me);
  const from = livePos(mine);
  if (selected && mine && from && !selected.joined.includes(mine.id)) add(selected, mine, from, true);

  return { type: 'FeatureCollection', features };
}

// --- marching dots ---------------------------------------------------------
// MapLibre draws a round cap on every zero-length dash, so a dasharray that is shifted with a leading 0
// ([0, s, 0.1, ...]) leaves a stationary dot at each period start next to the moving one. The dots are
// therefore placed explicitly along the trail and shifted by a phase, which gives a single clean train.

/** [zoom, radius in px] stops for the red core of a dot. The map style interpolates the same table. */
export const DOT_RADIUS_STOPS: [number, number][] = [[12, 2.4], [16, 3.6], [19, 4.6]];
/** Width in px of the ink ring drawn outside the red core. */
export const DOT_RING_PX = 2;
/** Centre-to-centre distance as a multiple of the dot's outer radius. */
const DOT_PITCH = 3.2;

/** Linear interpolation through DOT_RADIUS_STOPS, clamped at both ends (matches the style's `interpolate`). */
export function dotRadius(zoom: number): number {
  const stops = DOT_RADIUS_STOPS;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, r1] = stops[i];
    if (zoom <= z1) {
      const [z0, r0] = stops[i - 1];
      return r0 + ((r1 - r0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return stops[stops.length - 1][1];
}

/** Screen distance between neighbouring dots at this zoom. */
export const dotSpacingPx = (zoom: number): number => (dotRadius(zoom) + DOT_RING_PX) * DOT_PITCH;

/** Ground metres covered by one CSS pixel at this latitude (MapLibre uses a 512px world at zoom 0). */
export const metresPerPixel = (zoom: number, lat: number): number =>
  (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/**
 * Points every `spacingM` metres along a trail, starting `phase * spacingM` from its first point
 * (phase is wrapped into [0, 1)). Growing the phase slides every dot toward the end of the line, and
 * wrapping from just under 1 to 0 lands on an identical picture. Trails that would need more than
 * `maxDots` dots get a wider spacing instead.
 */
export function dotsAlong(coords: [number, number][], spacingM: number, phase: number, maxDots = 400): [number, number][] {
  if (coords.length < 2 || !(spacingM > 0) || !Number.isFinite(spacingM)) return [];
  const cap = Math.max(1, Math.floor(maxDots));
  // Same flat local frame as treasureArc; fine at city scale.
  const kx = Math.cos((coords[0][1] * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * kx;
    const dy = (coords[i][1] - coords[i - 1][1]) * ky;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];

  const step = Math.max(spacingM, total / cap);
  const f = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const out: [number, number][] = [];
  let seg = 1;
  for (let k = 0; k <= cap; k++) {
    const d = (f + k) * step;
    if (d > total) break;
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const span = cum[seg] - cum[seg - 1];
    const t = span > 0 ? (d - cum[seg - 1]) / span : 0;
    const a = coords[seg - 1];
    const b = coords[seg];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
