// WebSocket connection to a room: keeps the player list in sync and
// reconnects (resuming the same player via a session token) after drops.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ErrorCode, Plan, Player, ServerMsg } from '../shared/protocol.ts';

export type RoomStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'no_room' | 'room_full' | 'replaced' | 'left';

export interface Profile {
  name: string;
  avatar: string;
  color: string;
}

import { forgetEvent, getEvent, touchEvent } from './events.ts';

const NOTICE: Partial<Record<ErrorCode, string>> = {
  slow_down: 'Easy there. Wait a few seconds before the next ping.',
  plan_limit: 'Too many plans already. Cancel one first.',
  bad_plan: 'That plan could not be saved. Check the place name.',
};

/** The creator of a plan pinged the room. `seq` changes on every ping so effects re-run for repeats. */
export interface PingEvent {
  plan: Plan;
  seq: number;
}

/** Somebody's thought bubble (already short). `seq` changes on every bubble. */
export interface BubbleEvent {
  from: string;
  emoji: string;
  text: string;
  at: number;
  seq: number;
}

export function useRoom(roomId: string, profile: Profile | null) {
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [roomName, setRoomName] = useState('');
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [ping, setPing] = useState<PingEvent | null>(null);
  const [bubble, setBubble] = useState<BubbleEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pingSeq = useRef(0);
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
        // The token lives with the remembered event, so reopening the app resumes the same player.
        const token = getEvent(roomId)?.token ?? undefined;
        ws.send(JSON.stringify({ t: 'hello', ...p, token } satisfies ClientMsg));
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        switch (msg.t) {
          case 'welcome':
            retry = 0;
            touchEvent(roomId, { token: msg.token, name: msg.roomName });
            setRoomName(msg.roomName);
            setClockOffset(Date.now() - msg.now);
            meRef.current = msg.you;
            setMe(msg.you);
            setPlayers(Object.fromEntries(msg.players.map((p) => [p.id, p])));
            setPlans(Object.fromEntries(msg.plans.map((p) => [p.id, p])));
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
          case 'plan':
            setPlans((ps) => ({ ...ps, [msg.plan.id]: msg.plan }));
            break;
          case 'plan_gone':
            setPlans((ps) => {
              const { [msg.id]: _gone, ...rest } = ps;
              return rest;
            });
            break;
          case 'ping':
            setPing({ plan: msg.plan, seq: ++pingSeq.current });
            break;
          case 'bubble':
            setBubble({ from: msg.from, emoji: msg.emoji, text: msg.text, at: msg.at, seq: ++pingSeq.current });
            break;
          case 'error':
            if (msg.code === 'no_room' || msg.code === 'room_full') {
              stoppedRef.current = true;
              if (msg.code === 'no_room') forgetEvent(roomId); // the event is gone: stop remembering it (a full room still exists)
              setStatus(msg.code);
            } else {
              setNotice(NOTICE[msg.code] ?? null);
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

  /** Returns false (and changes nothing) when we are not connected, because then the server would never hear it. */
  const leave = useCallback((): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    stoppedRef.current = true;
    send({ t: 'leave' });
    forgetEvent(roomId); // leaving erases the event here; the server drops our pin and flags
    setStatus('left');
    setPlayers({});
    setPlans({});
    meRef.current = null;
    setMe(null);
    return true;
  }, [roomId, send]);

  const clearNotice = useCallback(() => setNotice(null), []);

  return { status, roomName, players, plans, ping, bubble, notice, clearNotice, me, clockOffset, send, leave };
}
