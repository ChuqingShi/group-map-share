// In-memory, ephemeral room registry. Nothing here is ever written to disk.
import { randomBytes } from 'node:crypto';
import { AVATARS, COLORS, MAX_PLAYERS_PER_ROOM, NAME_MAX } from '../shared/protocol.ts';
import type { Player, ServerMsg } from '../shared/protocol.ts';

export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Member {
  player: Player;
  token: string;
  conn: Conn | null;
  lastPosAt: number;
  /** When the member went offline; used to drop them after OFFLINE_GRACE_MS. */
  offlineSince: number | null;
}

export interface Room {
  id: string;
  createdAt: number;
  lastActive: number;
  members: Map<string, Member>;
}

export interface RoomOptions {
  /** Delete a room after this long with nobody connected. */
  idleMs: number;
  /** Drop a disconnected player (and their position) after this long. */
  offlineGraceMs: number;
  /** Ignore position updates arriving faster than this. */
  minPosIntervalMs: number;
  maxRooms: number;
  now: () => number;
}

export const DEFAULT_OPTIONS: RoomOptions = {
  idleMs: 30 * 60_000,
  offlineGraceMs: 5 * 60_000,
  minPosIntervalMs: 400,
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

export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  readonly opts: RoomOptions;

  constructor(opts: Partial<RoomOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  create(): Room | null {
    if (this.rooms.size >= this.opts.maxRooms) return null;
    const now = this.opts.now();
    // 128 bits: unguessable, so the link itself is the only key to the room.
    const room: Room = { id: randomId(16), createdAt: now, lastActive: now, members: new Map() };
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
        offlineSince: null,
        player: {
          id: randomId(6),
          name: 'Player',
          avatar: AVATARS[0],
          color: COLORS[room.members.size % COLORS.length],
          pos: null,
          online: true,
          sharing: false,
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
      players: [...room.members.values()].map((m) => m.player),
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
