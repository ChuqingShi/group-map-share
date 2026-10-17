// Wire protocol shared by the browser client and the Node server.

export const AVATARS = ['🦊', '🐸', '🐼', '🐧', '🦄', '🐙', '🐯', '🐨', '🐵', '🦁', '🐰', '🐲'] as const;
export const COLORS = ['#ff5d73', '#ffb020', '#3ddc84', '#2fb8ff', '#a66cff', '#ff7ad9', '#00c2a8', '#ff8a3d'] as const;

export const NAME_MAX = 24;
export const MAX_PLAYERS_PER_ROOM = 50;

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
}

export type ClientMsg =
  | { t: 'hello'; name: string; avatar: string; color: string; token?: string }
  | { t: 'pos'; lat: number; lng: number; acc?: number | null }
  | { t: 'sharing'; on: boolean }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; players: Player[]; expiresIdleMs: number; now: number }
  | { t: 'player'; player: Player }
  | { t: 'left'; id: string }
  | { t: 'error'; code: 'no_room' | 'room_full' | 'bad_message' };
