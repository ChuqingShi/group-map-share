// Room registry. State lives in memory; the registry can hand out a snapshot and take one back (see persist.ts),
// which only happens when the host sets GMS_DATA_DIR. Locations are never part of a snapshot.
import { randomBytes } from 'node:crypto';
import {
  AVATARS,
  COLORS,
  BUBBLE_EMOJI_MAX,
  BUBBLE_MAX,
  CONTACT_MAX,
  EVENT_NAME_MAX,
  FAREWELL_MAX,
  MAX_FAREWELLS_PER_ROOM,
  MAX_PLANS_PER_PLAYER,
  MOOD_EMOJI,
  MOOD_LABEL,
  MOOD_TEXT_MAX,
  MAX_PLANS_PER_ROOM,
  MAX_SUGGESTIONS_PER_PLAN,
  MAX_PLAYERS_PER_ROOM,
  MOODS,
  NAME_MAX,
  NOTE_MAX,
  PLACE_MAX,
  PLAN_KINDS,
} from '../shared/protocol.ts';
import type { ErrorCode, Farewell, MoodId, Plan, PlanKind, Player, ServerMsg } from '../shared/protocol.ts';

export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Member {
  player: Player;
  token: string;
  conn: Conn | null;
  lastPosAt: number;
  lastPlanAt: number;
  lastPingAt: number;
  lastBubbleAt: number;
  /** True once they have done anything beyond joining (shared a position, a mood, a flag...). Silent joiners are not kept for hours. */
  active: boolean;
  /** They chose to pause: late position updates must not switch sharing back on. */
  paused: boolean;
  /** When the member went offline; used to drop them after OFFLINE_GRACE_MS. */
  offlineSince: number | null;
}

export interface Room {
  id: string;
  /** What the people in it call it ("Team lunch"). */
  name: string;
  createdAt: number;
  lastActive: number;
  members: Map<string, Member>;
  plans: Map<string, Plan>;
  /** What people left on their way out, oldest first. */
  farewells: Farewell[];
  /** Last ping from anyone, so re-joining as a new person does not reset the cooldown. */
  lastPingAt: number;
}

export interface RoomOptions {
  /** Delete a room after this long with nobody connected. */
  idleMs: number;
  /** Drop a disconnected player (identity, plans and RSVPs) after this long. They can resume with their token until then. */
  offlineGraceMs: number;
  /** Forget a disconnected player's position after this long, even though they stay in the event. */
  locationTtlMs: number;
  /** Ignore position updates arriving faster than this. */
  minPosIntervalMs: number;
  /** Minimum gap between plans created by one player. */
  minPlanIntervalMs: number;
  /** Minimum gap between spoken pings from one player, so nobody can spam the room. */
  pingCooldownMs: number;
  /** Minimum gap between pings from anybody in the room. */
  roomPingCooldownMs: number;
  /** A joiner who never does anything is dropped after this long offline. */
  ghostGraceMs: number;
  /** Minimum gap between thought bubbles from one player. */
  bubbleCooldownMs: number;
  /** A mood goes stale (and is cleared) after this long. */
  moodTtlMs: number;
  /** A plan disappears after this long. */
  planTtlMs: number;
  maxRooms: number;
  now: () => number;
}

export const DEFAULT_OPTIONS: RoomOptions = {
  idleMs: 3 * 60 * 60_000,
  offlineGraceMs: 3 * 60 * 60_000,
  locationTtlMs: 5 * 60_000,
  minPosIntervalMs: 400,
  minPlanIntervalMs: 2_000,
  pingCooldownMs: 15_000,
  roomPingCooldownMs: 4_000,
  ghostGraceMs: 60_000,
  bubbleCooldownMs: 3_000,
  moodTtlMs: 2 * 60 * 60_000,
  planTtlMs: 3 * 60 * 60_000,
  maxRooms: 10_000,
  now: () => Date.now(),
};

const randomId = (bytes: number) => randomBytes(bytes).toString('base64url');

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  // Strip control characters and collapse whitespace.
  const name = raw.replace(/[\p{Cc}\p{Cf}\u3164\u2800\u115F\u1160]/gu, '').replace(/\s+/g, ' ').trim();
  return [...name].slice(0, NAME_MAX).join('') || 'Player';
}

/** Only emoji (and their joiners and skin tones): no letters, digits or markup smuggled in as an "emoji". '' when it is not one. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200D\uFE0F\u20E3])+$/u;
export function cleanEmoji(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = [...raw.trim()].slice(0, 8).join('');
  return EMOJI_ONLY.test(s) ? s : '';
}

/** Free text from a client (place names, notes): no control characters, collapsed whitespace, length capped. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/[\p{Cc}\p{Cf}\u3164\u2800\u115F\u1160]/gu, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, max).join('');
}

const validLatLng = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  readonly opts: RoomOptions;

  constructor(opts: Partial<RoomOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  create(name?: unknown): Room | null {
    if (this.rooms.size >= this.opts.maxRooms) return null;
    const now = this.opts.now();
    // 128 bits: unguessable, so the link itself is the only key to the room.
    const room: Room = { id: randomId(16), name: cleanText(name, EVENT_NAME_MAX) || 'Our event', createdAt: now, lastActive: now, members: new Map(), plans: new Map(), farewells: [], lastPingAt: 0 };
    this.rooms.set(room.id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Join (or rejoin with a token) a room. Returns the member id or an error code. */
  join(
    room: Room,
    conn: Conn,
    hello: { name: unknown; avatar: unknown; color: unknown; token?: unknown; organizer?: unknown; contact?: unknown },
  ): { id: string } | { error: 'room_full' } {
    const now = this.opts.now();
    room.lastActive = now;

    const existing =
      typeof hello.token === 'string'
        ? [...room.members.values()].find((m) => m.token === hello.token)
        : undefined;

    let member: Member;
    if (existing) {
      member = existing;
      // Same person reconnecting (or a second tab): the newest connection wins.
      if (member.conn && member.conn !== conn) {
        member.conn.send({ t: 'left', id: member.player.id });
        member.conn.close();
      }
      member.conn = conn;
      member.offlineSince = null;
    } else {
      if (room.members.size >= MAX_PLAYERS_PER_ROOM) return { error: 'room_full' };
      member = {
        token: randomId(18),
        conn,
        lastPosAt: 0,
        lastPlanAt: 0,
        lastPingAt: 0,
        lastBubbleAt: 0,
        active: false,
        paused: false,
        offlineSince: null,
        player: {
          id: randomId(6),
          name: 'Player',
          avatar: AVATARS[0],
          color: COLORS[room.members.size % COLORS.length],
          pos: null,
          online: true,
          sharing: false,
          mood: null,
          organizer: false,
          contact: '',
        },
      };
      room.members.set(member.player.id, member);
    }

    const p = member.player;
    p.name = cleanName(hello.name);
    p.avatar = (AVATARS as readonly string[]).includes(hello.avatar as string) ? (hello.avatar as string) : p.avatar;
    p.color = (COLORS as readonly string[]).includes(hello.color as string) ? (hello.color as string) : p.color;
    if (typeof hello.organizer === 'boolean') p.organizer = hello.organizer; // absent on a resume keeps what they had
    if (typeof hello.contact === 'string') p.contact = cleanText(hello.contact, CONTACT_MAX);
    p.online = true;

    conn.send({
      t: 'welcome',
      you: p.id,
      token: member.token,
      roomName: room.name,
      players: [...room.members.values()].map((m) => m.player),
      plans: [...room.plans.values()],
      farewells: room.farewells,
      expiresIdleMs: this.opts.idleMs,
      now,
    });
    this.broadcast(room, { t: 'player', player: p }, p.id);
    return { id: p.id };
  }

  /** True if `conn` is still the live connection for member `id`. */
  owns(room: Room, id: string, conn: Conn): boolean {
    return room.members.get(id)?.conn === conn;
  }

  updatePosition(room: Room, id: string, lat: unknown, lng: unknown, acc: unknown): boolean {
    const m = room.members.get(id);
    if (!m) return false;
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    if (m.paused) return true; // they paused: a late callback must not turn sharing back on
    const now = this.opts.now();
    if (now - m.lastPosAt < this.opts.minPosIntervalMs) return true; // silently throttle
    m.lastPosAt = now;
    m.active = true;
    room.lastActive = now;
    const accuracy = typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? Math.min(acc, 100_000) : null;
    m.player.pos = { lat, lng, acc: accuracy, at: now };
    m.player.sharing = true;
    this.broadcast(room, { t: 'player', player: m.player });
    return true;
  }

  setSharing(room: Room, id: string, on: boolean) {
    const m = room.members.get(id);
    if (!m) return;
    m.player.sharing = on;
    m.paused = !on;
    m.active = true;
    // Stopping sharing also forgets the last position so nobody keeps seeing it.
    if (!on) m.player.pos = null;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  /** Explicit leave: forget the player immediately. A rating or parting message, if given, stays with the event. */
  leave(room: Room, id: string, farewell?: { rating?: unknown; text?: unknown }) {
    const gone = room.members.get(id);
    if (!gone) return;
    const note = farewell ? this.makeFarewell(gone.player, farewell) : null;
    room.members.delete(id);
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'left', id });
    // Their plans go with them, and they drop out of everyone else's.
    for (const plan of [...room.plans.values()]) {
      if (plan.by === id) {
        room.plans.delete(plan.id);
        this.broadcast(room, { t: 'plan_gone', id: plan.id });
      } else if (plan.joined.includes(id) || plan.declined.includes(id) || plan.suggestions.some((s) => s.by === id)) {
        plan.joined = plan.joined.filter((j) => j !== id);
        plan.declined = plan.declined.filter((d) => d !== id);
        plan.suggestions = plan.suggestions.filter((s) => s.by !== id);
        this.broadcast(room, { t: 'plan', plan });
      }
    }
    if (note) {
      room.farewells.push(note);
      if (room.farewells.length > MAX_FAREWELLS_PER_ROOM) room.farewells.shift();
      this.broadcast(room, { t: 'farewell', farewell: note });
    }
  }

  // --- organizers --------------------------------------------------------------

  /** Is anyone in the event an organizer? Then only organizers plant flags. */
  hasOrganizer(room: Room): boolean {
    for (const m of room.members.values()) if (m.player.organizer) return true;
    return false;
  }

  setOrganizer(room: Room, id: string, on: unknown) {
    const m = room.members.get(id);
    if (!m || typeof on !== 'boolean' || m.player.organizer === on) return;
    m.player.organizer = on;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  /** Rename the event: same rule as flags (anyone, unless an organizer exists). Cleaned like a creation name; empty or unchanged is ignored. */
  renameRoom(room: Room, id: string, name: unknown) {
    const m = room.members.get(id);
    if (!m) return;
    if (this.hasOrganizer(room) && !m.player.organizer) return this.tell(room, id, 'organizers_only');
    const clean = cleanText(name, EVENT_NAME_MAX);
    if (!clean || clean === room.name) return;
    room.name = clean;
    m.active = true;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'room', name: clean });
  }

  /** Rename myself. Cleaned like a join name; an empty or unchanged name is ignored. */
  setName(room: Room, id: string, name: unknown) {
    const m = room.members.get(id);
    if (!m || typeof name !== 'string' || name.trim() === '') return;
    const clean = cleanName(name);
    if (clean === m.player.name) return;
    m.player.name = clean;
    m.active = true;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  // --- contact cards -----------------------------------------------------------

  /** The contact line on my card. Plain text, capped; shown only to people in this event, gone when I leave. */
  setContact(room: Room, id: string, text: unknown) {
    const m = room.members.get(id);
    if (!m || typeof text !== 'string') return;
    const contact = cleanText(text, CONTACT_MAX);
    if (m.player.contact === contact) return;
    m.player.contact = contact;
    m.active = true;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  // --- moods -----------------------------------------------------------------

  setMood(room: Room, id: string, mood: unknown, note: unknown, emoji?: unknown, text?: unknown) {
    const m = room.members.get(id);
    if (!m) return;
    const now = this.opts.now();
    if ((MOODS as readonly unknown[]).includes(mood)) {
      const preset = mood as MoodId;
      m.player.mood = { id: preset, emoji: MOOD_EMOJI[preset], label: MOOD_LABEL[preset], note: cleanText(note, NOTE_MAX), at: now };
    } else if (mood === 'custom') {
      const label = cleanText(text, MOOD_TEXT_MAX);
      const e = cleanEmoji(emoji);
      if (!label && !e) return; // nothing to show
      m.player.mood = { id: 'custom', emoji: e, label, note: cleanText(note, NOTE_MAX), at: now };
    } else if (mood === null) {
      m.player.mood = null;
    } else {
      return;
    }
    m.active = true;
    room.lastActive = now;
    this.broadcast(room, { t: 'player', player: m.player });
  }

  // --- thought bubbles ---------------------------------------------------------

  /** A short passive message over a player's pin. Rate limited; sent to everyone including the sender. */
  say(room: Room, id: string, emoji: unknown, text: unknown) {
    const m = room.members.get(id);
    if (!m) return;
    const clean = cleanText(text, BUBBLE_MAX);
    if (!clean) return;
    const now = this.opts.now();
    if (m.lastBubbleAt && now - m.lastBubbleAt < this.opts.bubbleCooldownMs) return this.tell(room, id, 'slow_down');
    m.lastBubbleAt = now;
    m.active = true;
    room.lastActive = now;
    this.broadcast(room, { t: 'bubble', from: id, emoji: cleanText(emoji, BUBBLE_EMOJI_MAX) || '💭', text: clean, at: now });
  }

  // --- meetup plans ------------------------------------------------------------

  private tell(room: Room, id: string, code: ErrorCode) {
    room.members.get(id)?.conn?.send({ t: 'error', code });
  }

  /** Create a plan. With `ping`, everyone else is told to announce it (subject to the ping cooldown). */
  createPlan(
    room: Room,
    id: string,
    input: { kind: unknown; place: unknown; note?: unknown; lat: unknown; lng: unknown; ping?: unknown },
  ): Plan | null {
    const m = room.members.get(id);
    if (!m) return null;
    const now = this.opts.now();
    const place = cleanText(input.place, PLACE_MAX);
    if (!place || !(PLAN_KINDS as readonly unknown[]).includes(input.kind) || !validLatLng(input.lat, input.lng)) {
      this.tell(room, id, 'bad_plan');
      return null;
    }
    if (this.hasOrganizer(room) && !m.player.organizer) {
      this.tell(room, id, 'organizers_only');
      return null;
    }
    const mine = [...room.plans.values()].filter((p) => p.by === id).length;
    if (room.plans.size >= MAX_PLANS_PER_ROOM || mine >= MAX_PLANS_PER_PLAYER) {
      this.tell(room, id, 'plan_limit');
      return null;
    }
    if (now - m.lastPlanAt < this.opts.minPlanIntervalMs) {
      this.tell(room, id, 'slow_down');
      return null;
    }
    m.lastPlanAt = now;
    m.active = true;
    room.lastActive = now;
    const plan: Plan = {
      id: randomId(6),
      by: id,
      byName: m.player.name,
      kind: input.kind as PlanKind,
      place,
      note: cleanText(input.note, NOTE_MAX),
      lat: input.lat,
      lng: input.lng as number,
      joined: [id],
      declined: [],
      suggestions: [],
      createdAt: now,
    };
    room.plans.set(plan.id, plan);
    this.broadcast(room, { t: 'plan', plan });
    if (input.ping === true) this.pingPlan(room, id, plan.id);
    return plan;
  }

  joinPlan(room: Room, id: string, planId: unknown) {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    if (!plan || !room.members.has(id) || plan.joined.includes(id)) return;
    plan.joined = [...plan.joined, id];
    plan.declined = plan.declined.filter((d) => d !== id); // changed their mind
    room.members.get(id)!.active = true;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'plan', plan });
  }

  /** "No thanks". The creator cannot decline their own plan (they can cancel it). Declining drops you from "I'm in". */
  declinePlan(room: Room, id: string, planId: unknown) {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    const m = room.members.get(id);
    if (!plan || !m || plan.by === id || plan.declined.includes(id)) return;
    plan.joined = plan.joined.filter((j) => j !== id);
    plan.declined = [...plan.declined, id];
    m.active = true;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'plan', plan });
  }

  /** "How about this instead?" One suggestion per person per plan (a new one replaces the old), a handful per plan, and not on your own plan. */
  suggestPlan(room: Room, id: string, planId: unknown, place: unknown, note?: unknown) {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    const m = room.members.get(id);
    if (!plan || !m || plan.by === id) return;
    const text = cleanText(place, PLACE_MAX);
    if (!text) return this.tell(room, id, 'bad_plan');
    const now = this.opts.now();
    if (m.lastBubbleAt && now - m.lastBubbleAt < this.opts.bubbleCooldownMs) return this.tell(room, id, 'slow_down');
    const others = plan.suggestions.filter((s) => s.by !== id);
    if (others.length >= MAX_SUGGESTIONS_PER_PLAN) return this.tell(room, id, 'plan_limit');
    m.lastBubbleAt = now;
    m.active = true;
    plan.suggestions = [...others, { id: randomId(6), by: id, byName: m.player.name, place: text, note: cleanText(note, NOTE_MAX), at: now }];
    plan.declined = plan.declined.includes(id) ? plan.declined : [...plan.declined, id]; // suggesting something else means not this one
    plan.joined = plan.joined.filter((j) => j !== id);
    room.lastActive = now;
    this.broadcast(room, { t: 'plan', plan });
  }

  leavePlan(room: Room, id: string, planId: unknown) {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    if (!plan || !plan.joined.includes(id)) return;
    plan.joined = plan.joined.filter((j) => j !== id);
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'plan', plan });
  }

  /** Creator only. */
  cancelPlan(room: Room, id: string, planId: unknown) {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    if (!plan || plan.by !== id) return;
    room.plans.delete(plan.id);
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'plan_gone', id: plan.id });
  }

  /** Creator only: tell everyone else to announce this plan. Rate limited per player. */
  pingPlan(room: Room, id: string, planId: unknown): boolean {
    const plan = typeof planId === 'string' ? room.plans.get(planId) : undefined;
    const m = room.members.get(id);
    if (!plan || !m || plan.by !== id) return false;
    const now = this.opts.now();
    if ((m.lastPingAt && now - m.lastPingAt < this.opts.pingCooldownMs) || (room.lastPingAt && now - room.lastPingAt < this.opts.roomPingCooldownMs)) {
      this.tell(room, id, 'slow_down');
      return false;
    }
    m.lastPingAt = now;
    room.lastPingAt = now;
    room.lastActive = now;
    this.broadcast(room, { t: 'ping', plan }, id);
    return true;
  }

  /** Socket closed without an explicit leave: keep the pin briefly, greyed out, so a reconnect can resume. */
  disconnect(room: Room, id: string, conn: Conn) {
    const m = room.members.get(id);
    if (!m || m.conn !== conn) return;
    m.conn = null;
    m.offlineSince = this.opts.now();
    m.player.online = false;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  /** A farewell worth keeping has a whole star rating from 1 to 5, a message, or both. Anything else is dropped. */
  private makeFarewell(p: Player, f: { rating?: unknown; text?: unknown }): Farewell | null {
    const rating = typeof f.rating === 'number' && Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5 ? f.rating : null;
    const text = cleanText(f.text, FAREWELL_MAX);
    if (rating === null && !text) return null;
    return { id: randomId(6), name: p.name, avatar: p.avatar, rating, text, at: this.opts.now() };
  }

  /** Drop stale players and idle rooms. Call periodically. */
  sweep() {
    const now = this.opts.now();
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) {
        if (m.offlineSince !== null && (now - m.offlineSince > this.opts.offlineGraceMs || (!m.active && now - m.offlineSince > this.opts.ghostGraceMs))) {
          this.leave(room, m.player.id);
        }
      }
      // Closing the app keeps you in the event, but your location is forgotten quickly.
      for (const m of room.members.values()) {
        if (m.offlineSince !== null && m.player.pos && now - m.offlineSince > this.opts.locationTtlMs) {
          m.player.pos = null;
          m.player.sharing = false;
          this.broadcast(room, { t: 'player', player: m.player });
        }
      }
      for (const m of room.members.values()) {
        if (m.player.mood && now - m.player.mood.at > this.opts.moodTtlMs) {
          m.player.mood = null;
          this.broadcast(room, { t: 'player', player: m.player });
        }
      }
      for (const plan of [...room.plans.values()]) {
        if (now - plan.createdAt > this.opts.planTtlMs) {
          room.plans.delete(plan.id);
          this.broadcast(room, { t: 'plan_gone', id: plan.id });
        }
      }
      const anyoneConnected = [...room.members.values()].some((m) => m.conn);
      if (!anyoneConnected && now - room.lastActive > this.opts.idleMs) {
        this.rooms.delete(room.id);
      }
    }
  }

  /**
   * Everything needed to bring the events back after a restart: people, moods, contact lines, flags and RSVPs.
   * Positions are left out on purpose (people send a fresh one the moment they reconnect), and so are sockets.
   * Contains the resume tokens, so the file it ends up in must stay private.
   */
  toSnapshot(): Snapshot {
    const rooms: SavedRoom[] = [];
    for (const room of this.rooms.values()) {
      rooms.push({
        id: room.id,
        name: room.name,
        createdAt: room.createdAt,
        lastActive: room.lastActive,
        lastPingAt: room.lastPingAt,
        members: [...room.members.values()].map((m) => ({
          token: m.token,
          active: m.active,
          paused: m.paused,
          player: { ...m.player, pos: null, online: false },
        })),
        plans: [...room.plans.values()],
        farewells: room.farewells,
      });
    }
    return { v: 1, savedAt: this.opts.now(), rooms };
  }

  /**
   * Load a snapshot into an empty registry. Anything malformed is skipped rather than trusted, and everyone
   * starts offline, with their offline clock running from the moment the snapshot was taken. Returns the number of events restored.
   */
  restore(raw: unknown): number {
    if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.rooms)) return 0;
    const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : this.opts.now();
    let restored = 0;
    for (const r of raw.rooms) {
      if (this.rooms.size >= this.opts.maxRooms) break;
      try {
        const room = restoreRoom(r, savedAt);
        if (room && !this.rooms.has(room.id)) {
          this.rooms.set(room.id, room);
          restored++;
        }
      } catch {
        /* one bad event must not stop the rest */
      }
    }
    return restored;
  }

  broadcast(room: Room, msg: ServerMsg, exceptId?: string) {
    for (const m of room.members.values()) {
      if (m.conn && m.player.id !== exceptId) m.conn.send(msg);
    }
  }
}

// --- snapshots ---------------------------------------------------------------

interface SavedMember {
  token: string;
  active: boolean;
  paused: boolean;
  player: Player;
}

interface SavedRoom {
  id: string;
  name: string;
  createdAt: number;
  lastActive: number;
  lastPingAt: number;
  members: SavedMember[];
  plans: Plan[];
  farewells: Farewell[];
}

export interface Snapshot {
  v: 1;
  savedAt: number;
  rooms: SavedRoom[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const idOf = (v: unknown): string | null => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);

function restoreMood(v: unknown): Player['mood'] {
  if (!isRecord(v)) return null;
  const id = typeof v.id === 'string' && ((MOODS as readonly string[]).includes(v.id) || v.id === 'custom') ? (v.id as MoodId | 'custom') : null;
  if (!id) return null;
  return { id, emoji: cleanEmoji(v.emoji), label: cleanText(v.label, MOOD_TEXT_MAX), note: cleanText(v.note, NOTE_MAX), at: num(v.at, 0) };
}

function restoreFarewells(v: unknown): Farewell[] {
  if (!Array.isArray(v)) return [];
  const out: Farewell[] = [];
  for (const f of v.slice(-MAX_FAREWELLS_PER_ROOM)) {
    if (!isRecord(f)) continue;
    const id = idOf(f.id);
    const rating = typeof f.rating === 'number' && Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5 ? f.rating : null;
    const text = cleanText(f.text, FAREWELL_MAX);
    if (!id || (rating === null && !text)) continue;
    out.push({
      id,
      name: cleanName(f.name),
      avatar: (AVATARS as readonly string[]).includes(f.avatar as string) ? (f.avatar as string) : AVATARS[0],
      rating,
      text,
      at: num(f.at, 0),
    });
  }
  return out;
}

function restoreRoom(r: unknown, savedAt: number): Room | null {
  if (!isRecord(r)) return null;
  const id = typeof r.id === 'string' && /^[\w-]{16,64}$/.test(r.id) ? r.id : null;
  if (!id || !Array.isArray(r.members) || !Array.isArray(r.plans)) return null;
  const room: Room = {
    id,
    name: cleanText(r.name, EVENT_NAME_MAX) || 'Our event',
    createdAt: num(r.createdAt, savedAt),
    lastActive: num(r.lastActive, savedAt),
    lastPingAt: num(r.lastPingAt, 0),
    members: new Map(),
    plans: new Map(),
    farewells: restoreFarewells(r.farewells),
  };
  for (const m of r.members.slice(0, MAX_PLAYERS_PER_ROOM)) {
    if (!isRecord(m) || !isRecord(m.player)) continue;
    const p = m.player;
    const pid = idOf(p.id);
    if (!pid || room.members.has(pid) || typeof m.token !== 'string' || m.token.length < 10 || m.token.length > 80) continue;
    room.members.set(pid, {
      token: m.token,
      conn: null,
      lastPosAt: 0,
      lastPlanAt: 0,
      lastPingAt: 0,
      lastBubbleAt: 0,
      active: m.active === true,
      paused: m.paused === true,
      offlineSince: savedAt,
      player: {
        id: pid,
        name: cleanName(p.name),
        avatar: (AVATARS as readonly string[]).includes(p.avatar as string) ? (p.avatar as string) : AVATARS[0],
        color: (COLORS as readonly string[]).includes(p.color as string) ? (p.color as string) : COLORS[0],
        pos: null,
        online: false,
        sharing: p.sharing === true,
        mood: restoreMood(p.mood),
        organizer: p.organizer === true,
        contact: cleanText(p.contact, CONTACT_MAX),
      },
    });
  }
  const people = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && room.members.has(x)))] : []);
  for (const q of r.plans.slice(0, MAX_PLANS_PER_ROOM)) {
    if (!isRecord(q)) continue;
    const planId = idOf(q.id);
    const by = typeof q.by === 'string' && room.members.has(q.by) ? q.by : null;
    const kind = (PLAN_KINDS as readonly string[]).includes(q.kind as string) ? (q.kind as PlanKind) : null;
    if (!planId || !by || !kind || !validLatLng(q.lat, q.lng) || room.plans.has(planId)) continue;
    const suggestions = (Array.isArray(q.suggestions) ? q.suggestions : []).slice(0, MAX_SUGGESTIONS_PER_PLAN).flatMap((sg) => {
      const sid = isRecord(sg) ? idOf(sg.id) : null;
      if (!isRecord(sg) || !sid || typeof sg.by !== 'string') return [];
      return [{ id: sid, by: sg.by, byName: cleanName(sg.byName), place: cleanText(sg.place, PLACE_MAX), note: cleanText(sg.note, NOTE_MAX), at: num(sg.at, 0) }];
    });
    room.plans.set(planId, {
      id: planId,
      by,
      byName: cleanName(q.byName),
      kind,
      place: cleanText(q.place, PLACE_MAX),
      note: cleanText(q.note, NOTE_MAX),
      lat: q.lat as number,
      lng: q.lng as number,
      joined: people(q.joined),
      declined: people(q.declined),
      suggestions,
      createdAt: num(q.createdAt, savedAt),
    });
  }
  return room;
}
