// Wire protocol shared by the browser client and the Node server.

export const AVATARS = ['🦊', '🐸', '🐼', '🐧', '🦄', '🐙', '🐯', '🐨', '🐵', '🦁', '🐰', '🐲'] as const;
export const COLORS = ['#ff5d73', '#ffb020', '#3ddc84', '#2fb8ff', '#a66cff', '#ff7ad9', '#00c2a8', '#ff8a3d'] as const;

export const NAME_MAX = 24;
/** A line of contact info on someone's card: a phone number, an email, "find me by the fountain". */
export const CONTACT_MAX = 80;
export const EVENT_NAME_MAX = 40;
export const MAX_PLAYERS_PER_ROOM = 50;

// --- moods and meetup plans ------------------------------------------------

/** How a player is feeling right now. Shown on their pin so a split-up crew can see who wants what. */
export const MOODS = ['hungry', 'thirsty', 'coffee', 'tired', 'bored', 'hyped', 'chill', 'lost'] as const;
export type MoodId = (typeof MOODS)[number];
export const MOOD_EMOJI: Record<MoodId, string> = {
  hungry: '🍔',
  thirsty: '🥤',
  coffee: '☕',
  tired: '😴',
  bored: '🥱',
  hyped: '🎉',
  chill: '😎',
  lost: '🧭',
};
export const MOOD_LABEL: Record<MoodId, string> = {
  hungry: 'Hungry',
  thirsty: 'Thirsty',
  coffee: 'Need coffee',
  tired: 'Tired',
  bored: 'Bored',
  hyped: 'Hyped',
  chill: 'Chill',
  lost: 'Lost',
};
/** Typed moods ("Dreaming of tacos") are short, like everything else people read on a map. */
export const MOOD_TEXT_MAX = 24;
/** A handful of common emoji for typed moods. The empty string is the blank choice (a speech bubble is shown). */
export const QUICK_EMOJI = ['😋', '🍔', '☕', '🍻', '😴', '🥱', '🎉', '😎', '🤒', '🥵', '🥶', '🤩', '😅', '🧭', '🚶', '🏃', '🛍️', '🎶', '🤝', '🙌', '💤', '😬', '🥳', '😤'] as const;

/** What a plan is for. Drives the emoji on the X and the sentence that gets spoken. */
export const PLAN_KINDS = ['lunch', 'coffee', 'drinks', 'dinner', 'meetup'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_EMOJI: Record<PlanKind, string> = {
  lunch: '🍔',
  coffee: '☕',
  drinks: '🍻',
  dinner: '🍽️',
  meetup: '📍',
};

export const PLACE_MAX = 40;
export const NOTE_MAX = 80;
export const MAX_PLANS_PER_ROOM = 20;
export const MAX_PLANS_PER_PLAYER = 3;
/** Suggestions ("how about somewhere else?") on one plan, one per person. */
export const MAX_SUGGESTIONS_PER_PLAN = 8;
/** Thought bubbles are short on purpose: a glance, not a chat. */
export const BUBBLE_MAX = 60;
export const BUBBLE_EMOJI_MAX = 8;

/** The short thought-bubble line for a plan ping, shown over the creator's pin and in the toast. */
export function planBubble(plan: Pick<Plan, 'kind' | 'place'>): { emoji: string; text: string } {
  const emoji = PLAN_EMOJI[plan.kind];
  const text =
    plan.kind === 'meetup' ? `Meet at ${plan.place}?` : `${plan.kind[0].toUpperCase()}${plan.kind.slice(1)} at ${plan.place}?`;
  return { emoji, text };
}

export interface Mood {
  /** A preset, or 'custom' when the person typed their own. */
  id: MoodId | 'custom';
  /** Shown on the pin and profile pic. Empty means the person chose no emoji (clients show a speech bubble). */
  emoji: string;
  /** "Hungry", or whatever they typed. */
  label: string;
  note: string;
  /** Server time (ms since epoch) the mood was set. */
  at: number;
}

/** "How about this instead?": a different place proposed by someone who does not want to go to the plan's. */
export interface Suggestion {
  id: string;
  by: string;
  byName: string;
  place: string;
  note: string;
  at: number;
}

/** A place somebody wants the crew to go to. People opt in with `joined`; their treasure path points at it. */
export interface Plan {
  id: string;
  /** Player id of the creator (also always in `joined` until they cancel). */
  by: string;
  /** The creator's name when the plan was made, so announcements survive them leaving. */
  byName: string;
  kind: PlanKind;
  place: string;
  note: string;
  lat: number;
  lng: number;
  /** Player ids who said "I'm in". */
  joined: string[];
  /** Player ids who said "no thanks". */
  declined: string[];
  /** Other places people proposed instead, newest last. */
  suggestions: Suggestion[];
  createdAt: number;
}

// --- players -----------------------------------------------------------------

export interface Position {
  lat: number;
  lng: number;
  /** Accuracy radius in metres, if the device reported one. */
  acc: number | null;
  /** Server receive time (ms since epoch). */
  at: number;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: string;
  pos: Position | null;
  /** False while the player's socket is disconnected (e.g. phone screen locked). */
  online: boolean;
  /** True while the player is actively sharing their location. */
  sharing: boolean;
  mood: Mood | null;
  /** Ticked "I'm an organizer". While anyone in the event is one, only organizers can plant flags; with none, everyone can. */
  organizer: boolean;
  /** Whatever contact info they chose to put on their card. Empty when they have not. Only people in the event see it. */
  contact: string;
}

export type ClientMsg =
  | { t: 'hello'; name: string; avatar: string; color: string; token?: string; organizer?: boolean; contact?: string }
  /** Set or clear the contact line on my card. */
  | { t: 'contact'; text: string }
  /** Say whether I am an organizer (the join form asks too; this is for changing your mind later). */
  | { t: 'organizer'; on: boolean }
  | { t: 'pos'; lat: number; lng: number; acc?: number | null }
  | { t: 'sharing'; on: boolean }
  | { t: 'leave' }
  /** A preset (`mood` is its id), a typed one (`mood: 'custom'` with `emoji` and `text`), or null to clear. */
  | { t: 'mood'; mood: MoodId | 'custom' | null; note?: string; emoji?: string; text?: string }
  /** Create a plan. With `ping`, everyone else in the room gets a spoken invitation. */
  | { t: 'plan'; kind: PlanKind; place: string; note?: string; lat: number; lng: number; ping?: boolean }
  | { t: 'plan_join'; id: string }
  | { t: 'plan_leave'; id: string }
  /** "No thanks": not coming to this plan. */
  | { t: 'plan_decline'; id: string }
  /** "How about somewhere else?" Open to everyone, including non organizers. */
  | { t: 'plan_suggest'; id: string; place: string; note?: string }
  /** Creator only. */
  | { t: 'plan_cancel'; id: string }
  /** Creator only: send the invitation again. */
  | { t: 'plan_ping'; id: string }
  /** A short thought bubble over my pin, already boiled down by the client from what I said or typed. */
  | { t: 'bubble'; emoji: string; text: string };

export type ErrorCode = 'no_room' | 'room_full' | 'bad_message' | 'slow_down' | 'plan_limit' | 'bad_plan' | 'organizers_only';

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; roomName: string; players: Player[]; plans: Plan[]; expiresIdleMs: number; now: number }
  | { t: 'player'; player: Player }
  | { t: 'left'; id: string }
  /** Create or update a plan. */
  | { t: 'plan'; plan: Plan }
  | { t: 'plan_gone'; id: string }
  /** The creator pinged the room: toast it, bubble it, optionally speak it. Never sent back to the creator. */
  | { t: 'ping'; plan: Plan }
  /** Somebody's thought bubble. Sent to everyone, including the sender. */
  | { t: 'bubble'; from: string; emoji: string; text: string; at: number }
  | { t: 'error'; code: ErrorCode };
