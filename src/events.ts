// "My events": the events this device is in, remembered across closing the app so that reopening
// drops you straight back into the same event as the same player. Lives in localStorage only.
// Leaving an event (or the event ending) forgets it here, and the server forgets you.
import type { Profile } from './useRoom.ts';

export interface SavedEvent {
  id: string;
  name: string;
  /** Session token the server gave us, so reconnecting resumes the same player (and their flags). */
  token: string | null;
  profile: Profile;
  joinedAt: number;
  lastSeen: number;
}

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'gms-events';
const MAX_EVENTS = 20;

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

const isEvent = (v: unknown): v is SavedEvent => {
  const e = v as SavedEvent | null;
  return (
    !!e && typeof e === 'object' && typeof e.id === 'string' && /^[\w-]{1,64}$/.test(e.id) && typeof e.lastSeen === 'number' &&
    !!e.profile && typeof e.profile.name === 'string' && typeof e.profile.avatar === 'string' && typeof e.profile.color === 'string'
  );
};

/** Most recently used first. Corrupt storage reads as empty. */
export function loadEvents(s: Store | null = defaultStore()): SavedEvent[] {
  try {
    const raw: unknown = JSON.parse(s?.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isEvent)
      .map((e) => ({ ...e, name: typeof e.name === 'string' ? e.name : '', token: typeof e.token === 'string' ? e.token : null, joinedAt: Number(e.joinedAt) || e.lastSeen }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  } catch {
    return [];
  }
}

function write(events: SavedEvent[], s: Store | null) {
  try {
    s?.setItem(KEY, JSON.stringify(events.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_EVENTS)));
  } catch {
    /* storage full or blocked: we just will not remember */
  }
}

export const getEvent = (id: string, s: Store | null = defaultStore()) => loadEvents(s).find((e) => e.id === id);

export function saveEvent(ev: SavedEvent, s: Store | null = defaultStore()) {
  write([...loadEvents(s).filter((e) => e.id !== ev.id), ev], s);
}

/** Update a remembered event in place (no-op if we are not remembering it). */
export function touchEvent(
  id: string,
  patch: Partial<Pick<SavedEvent, 'name' | 'token' | 'profile'>> = {},
  s: Store | null = defaultStore(),
  now = Date.now(),
) {
  const events = loadEvents(s);
  const e = events.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch, { lastSeen: now });
  write(events, s);
}

export function forgetEvent(id: string, s: Store | null = defaultStore()) {
  write(loadEvents(s).filter((e) => e.id !== id), s);
}
