// WebSocket connection to a room: keeps the player list in sync and
// reconnects (resuming the same player via a session token) after drops.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, Player, ServerMsg } from '../shared/protocol.ts';

export type RoomStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'no_room' | 'room_full' | 'replaced' | 'left';

export interface Profile {
  name: string;
  avatar: string;
  color: string;
}

const tokenKey = (roomId: string) => `gms-token:${roomId}`;

export function useRoom(roomId: string, profile: Profile | null) {
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [me, setMe] = useState<string | null>(null);
  /** Local clock minus server clock, to turn server timestamps into "x s ago". */
  const [clockOffset, setClockOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const meRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const joined = profile !== null;

  useEffect(() => {
    if (!joined) return;
    stoppedRef.current = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus((s) => (s === 'live' || s === 'reconnecting' ? 'reconnecting' : 'connecting'));
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const p = profileRef.current!;
        const token = sessionStorage.getItem(tokenKey(roomId)) ?? undefined;
        ws.send(JSON.stringify({ t: 'hello', ...p, token } satisfies ClientMsg));
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        switch (msg.t) {
          case 'welcome':
            retry = 0;
            sessionStorage.setItem(tokenKey(roomId), msg.token);
            setClockOffset(Date.now() - msg.now);
            meRef.current = msg.you;
            setMe(msg.you);
            setPlayers(Object.fromEntries(msg.players.map((p) => [p.id, p])));
            setStatus('live');
            break;
          case 'player':
            setPlayers((ps) => ({ ...ps, [msg.player.id]: msg.player }));
            break;
          case 'left':
            setPlayers((ps) => {
              const { [msg.id]: _gone, ...rest } = ps;
              return rest;
            });
            if (msg.id === meRef.current) {
              // Our own player was taken over: this room was opened in a newer tab.
              stoppedRef.current = true;
              setStatus('replaced');
            }
            break;
          case 'error':
            if (msg.code === 'no_room' || msg.code === 'room_full') {
              stoppedRef.current = true;
              setStatus(msg.code);
            }
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws || stoppedRef.current) return;
        setStatus('reconnecting');
        retry++;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry));
      };
    };

    connect();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, joined]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const leave = useCallback(() => {
    stoppedRef.current = true;
    send({ t: 'leave' });
    sessionStorage.removeItem(tokenKey(roomId));
    setStatus('left');
    setPlayers({});
    meRef.current = null;
    setMe(null);
  }, [roomId, send]);

  return { status, players, me, clockOffset, send, leave };
}
