// The Animal Crossing style crew strip (round profile pics along the top, names hidden so the
// map stays visible) and the little toasts that announce pings and thought bubbles.
import type { CSSProperties } from 'react';
import { MOOD_EMOJI, type Player } from '../shared/protocol.ts';

export function CrewStrip({ players, me, onPick }: { players: Player[]; me: string | null; onPick: (id: string) => void }) {
  const sorted = players.slice().sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  return (
    <nav className="crew" data-testid="crew" aria-label="People in this room">
      {sorted.map((p) => (
        <button
          key={p.id}
          type="button"
          data-testid="crew-avatar"
          data-player-id={p.id}
          className={`crew-avatar${p.id === me ? ' is-me' : ''}${p.online ? '' : ' is-offline'}${p.sharing ? '' : ' is-paused'}`}
          style={{ '--c': p.color } as CSSProperties}
          aria-label={`${p.name}${p.id === me ? ' (you)' : ''}${p.mood ? `, feeling ${p.mood.id}` : ''}${p.online ? '' : ', offline'}${p.sharing ? '' : ', not sharing'}`}
          onClick={() => onPick(p.id)}
        >
          <span className="crew-face">{p.avatar}</span>
          {p.mood && <span className="crew-mood">{MOOD_EMOJI[p.mood.id]}</span>}
        </button>
      ))}
    </nav>
  );
}

export interface ToastItem {
  id: number;
  kind: 'ping' | 'bubble' | 'info';
  emoji: string;
  text: string;
  who?: Pick<Player, 'avatar' | 'color' | 'name'>;
  planId?: string;
  /** Date.now() after which the toast goes away. */
  until: number;
}

export function Toasts({ items, isJoined, onDismiss, onJoin, onShow }: {
  items: ToastItem[];
  isJoined: (planId: string) => boolean;
  onDismiss: (id: number) => void;
  onJoin: (planId: string, toastId: number) => void;
  onShow: (planId: string, toastId: number) => void;
}) {
  return (
    <>
      {items.map((t) => (
        <div key={t.id} className={`toast-card is-${t.kind}`} data-testid="toast" data-kind={t.kind} style={{ '--c': t.who?.color ?? 'var(--gold)' } as CSSProperties}>
          <span className="toast-face" aria-hidden="true">{t.who?.avatar ?? t.emoji}</span>
          <span className="toast-body">
            <span className="toast-text">{t.who && t.kind !== 'ping' ? <b>{t.who.name}: </b> : null}{t.emoji} {t.text}</span>
            {t.kind === 'ping' && t.planId && (
              <span className="toast-actions">
                {!isJoined(t.planId) && <button type="button" className="btn btn-small" data-testid="btn-toast-join" onClick={() => onJoin(t.planId!, t.id)}>I&apos;m in</button>}
                <button type="button" className="btn btn-small btn-ghost" data-testid="btn-toast-show" onClick={() => onShow(t.planId!, t.id)}>Show me</button>
              </span>
            )}
          </span>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </>
  );
}
