// Pure helpers for moods and meetup plans: the sentence that gets spoken, walking time,
// and the curved "treasure map" trail from a person to the X.
import { distanceM, type LatLng } from './geo.ts';
import { MOOD_LABEL, type Mood, type Plan, type PlanKind } from '../shared/protocol.ts';

export { MOOD_LABEL };

/** What to show for someone's mood on a pin or avatar: their emoji, or a speech bubble if they chose none. */
export const moodEmoji = (m: Pick<Mood, 'emoji'>) => m.emoji || '💬';
/** What to say for it: the preset name or whatever they typed. */
export const moodText = (m: Pick<Mood, 'label' | 'emoji'>) => m.label || 'Feeling something';

export const KIND_LABEL: Record<PlanKind, string> = {
  lunch: 'Lunch',
  coffee: 'Coffee',
  drinks: 'Drinks',
  dinner: 'Dinner',
  meetup: 'Meet up',
};


const PHRASE: Record<PlanKind, (place: string) => string> = {
  lunch: (p) => `for lunch at ${p}`,
  coffee: (p) => `for coffee at ${p}`,
  drinks: (p) => `for drinks at ${p}`,
  dinner: (p) => `for dinner at ${p}`,
  meetup: (p) => `to meet up at ${p}`,
};

/** Roughly 4.8 km/h. */
export const walkMinutes = (metres: number) => Math.max(1, Math.round(metres / 80));

/** "about 4 minutes on foot", or null when we do not know where the listener is. */
export function walkPhrase(metres: number | null): string | null {
  if (metres === null) return null;
  if (metres < 40) return "you're already right there";
  const n = walkMinutes(metres);
  return `about ${n} minute${n === 1 ? '' : 's'} on foot`;
}

/** What the phone says out loud when someone pings the room. */
export function announcement(plan: Plan, metresAway: number | null): string {
  const parts = [`${plan.byName} is inviting you ${PHRASE[plan.kind](plan.place)}.`];
  const walk = walkPhrase(metresAway);
  if (walk) parts.push(walk.startsWith("you're") ? `${walk[0].toUpperCase()}${walk.slice(1)}.` : `It's ${walk}.`);
  if (plan.note) parts.push(`${plan.byName} says: ${plan.note}${/[.!?]$/.test(plan.note) ? '' : '.'}`);
  return parts.join(' ');
}

export function metresTo(from: LatLng | null | undefined, plan: Pick<Plan, 'lat' | 'lng'>): number | null {
  return from ? distanceM(from, plan) : null;
}

/**
 * A hand-drawn looking trail from `from` to `to`: a quadratic curve that always bows to the left
 * of the direction of travel, so several trails into the same X fan out instead of overlapping.
 * Returns [lng, lat] pairs that start exactly at `from` and end exactly at `to`.
 */
export function treasureArc(from: LatLng, to: LatLng, steps = 32, bend = 0.18): [number, number][] {
  const metres = distanceM(from, to);
  if (metres < 8) return [[from.lng, from.lat], [to.lng, to.lat]];
  // Work in a flat local frame (metres) around the start; fine at city scale.
  const kx = Math.cos((from.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const dx = (to.lng - from.lng) * kx;
  const dy = (to.lat - from.lat) * ky;
  // Left of travel is (-dy, dx).
  const cx = dx / 2 - dy * bend;
  const cy = dy / 2 + dx * bend;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = 2 * u * t * cx + t * t * dx;
    const y = 2 * u * t * cy + t * t * dy;
    pts.push([from.lng + x / kx, from.lat + y / ky]);
  }
  pts[0] = [from.lng, from.lat];
  pts[steps] = [to.lng, to.lat];
  return pts;
}
