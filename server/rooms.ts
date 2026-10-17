// In-memory, ephemeral room registry. Nothing here is ever written to disk.
import { randomBytes } from 'node:crypto';
import {
  AVATARS,
  COLORS,
  BUBBLE_EMOJI_MAX,
  BUBBLE_MAX,
  EVENT_NAME_MAX,
  MAX_PLANS_PER_PLAYER,
  MAX_PLANS_PER_ROOM,
  MAX_PLAYERS_PER_ROOM,
  MOODS,
  NAME_MAX,
  NOTE_MAX,
  PLACE_MAX,
  PLAN_KINDS,
} from '../shared/protocol.ts';
import type { ErrorCode, MoodId, Plan, PlanKind, Player, ServerMsg } from '../shared/protocol.ts';

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
  const name = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  return [...name].slice(0, NAME_MAX).join('') || 'Player';
}

/** Free text from a client (place names, notes): no control characters, collapsed whitespace, length capped. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
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
    const room: Room = { id: randomId(16), name: cleanText(name, EVENT_NAME_MAX) || 'Our event', createdAt: now, lastActive: now, members: new Map(), plans: new Map() };
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
    hello: { name: unknown; avatar: unknown; color: unknown; token?: unknown },
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
        },
      };
      room.members.set(member.player.id, member);
    }

    const p = member.player;
    p.name = cleanName(hello.name);
    p.avatar = (AVATARS as readonly string[]).includes(hello.avatar as string) ? (hello.avatar as string) : p.avatar;
    p.color = (COLORS as readonly string[]).includes(hello.color as string) ? (hello.color as string) : p.color;
    p.online = true;

    conn.send({
      t: 'welcome',
      you: p.id,
      token: member.token,
      roomName: room.name,
      players: [...room.members.values()].map((m) => m.player),
      plans: [...room.plans.values()],
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
    const now = this.opts.now();
    if (now - m.lastPosAt < this.opts.minPosIntervalMs) return true; // silently throttle
    m.lastPosAt = now;
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
    // Stopping sharing also forgets the last position so nobody keeps seeing it.
    if (!on) m.player.pos = null;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'player', player: m.player });
  }

  /** Explicit leave: forget the player immediately. */
  leave(room: Room, id: string) {
    if (!room.members.delete(id)) return;
    room.lastActive = this.opts.now();
    this.broadcast(room, { t: 'left', id });
    // Their plans go with them, and they drop out of everyone else's.
    for (const plan of [...room.plans.values()]) {
      if (plan.by === id) {
        room.plans.delete(plan.id);
        this.broadcast(room, { t: 'plan_gone', id: plan.id });
      } else if (plan.joined.includes(id)) {
        plan.joined = plan.joined.filter((j) => j !== id);
        this.broadcast(room, { t: 'plan', plan });
      }
    }
  }

  // --- moods -----------------------------------------------------------------

  setMood(room: Room, id: string, mood: unknown, note: unknown) {
    const m = room.members.get(id);
    if (!m) return;
    const now = this.opts.now();
    if ((MOODS as readonly unknown[]).includes(mood)) {
      m.player.mood = { id: mood as MoodId, note: cleanText(note, NOTE_MAX), at: now };
    } else if (mood === null) {
      m.player.mood = null;
    } else {
      return;
    }
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
    room.lastActive = this.opts.now();
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
    if (m.lastPingAt && now - m.lastPingAt < this.opts.pingCooldownMs) {
      this.tell(room, id, 'slow_down');
      return false;
    }
    m.lastPingAt = now;
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

  /** Drop stale players and idle rooms. Call periodically. */
  sweep() {
    const now = this.opts.now();
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) {
        if (m.offlineSince !== null && now - m.offlineSince > this.opts.offlineGraceMs) {
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

  broadcast(room: Room, msg: ServerMsg, exceptId?: string) {
    for (const m of room.members.values()) {
      if (m.conn && m.player.id !== exceptId) m.conn.send(msg);
    }
  }
}
