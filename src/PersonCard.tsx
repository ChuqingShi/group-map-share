// The little card that opens when you tap someone's picture or name: who they are, how they feel,
// how to reach them, and what they are planning. Everything shown is what the person chose to share
// with this event.
import { useState, type CSSProperties } from 'react';
import { CONTACT_MAX, PLAN_EMOJI, type Plan, type Player } from '../shared/protocol.ts';
import { formatAgo, formatDistance, distanceM, type LatLng } from './geo.ts';
import { KIND_LABEL, contactLink, moodEmoji, moodText } from './meetup.ts';

export function PersonCard({ player, isMe, plans, mePlayerId, mePos, now, clockOffset, onClose, onShowOnMap, onShowPlan, onJoin, onLeave, onSaveContact }: {
  player: Player;
  isMe: boolean;
  plans: Plan[];
  mePlayerId: string | null;
  mePos: LatLng | null;
  now: number;
  clockOffset: number;
  onClose: () => void;
  onShowOnMap: () => void;
  onShowPlan: (id: string) => void;
  onJoin: (planId: string) => void;
  onLeave: (planId: string) => void;
  onSaveContact: (text: string) => void;
}) {
  const [draft, setDraft] = useState(player.contact);
  const made = plans.filter((p) => p.by === player.id);
  const going = plans.filter((p) => p.by !== player.id && p.joined.includes(player.id));
  const link = player.contact ? contactLink(player.contact) : null;

  let where: string;
  if (!player.online) where = 'Offline right now';
  else if (!player.sharing || !player.pos) where = isMe ? 'Not sharing your location' : 'Location hidden';
  else if (isMe) where = player.pos.acc ? `Sharing · ±${Math.round(player.pos.acc)} m` : 'Sharing';
  else if (mePos) where = `${formatDistance(distanceM(mePos, player.pos))} away · ${formatAgo(now - (player.pos.at + clockOffset))}`;
  else where = 'On the map';

  const planRow = (p: Plan) => {
    const inIt = !!mePlayerId && p.joined.includes(mePlayerId);
    return (
      <li key={p.id} className="card-plan" data-testid="card-plan" data-plan-id={p.id}>
        <span className="plan-emoji">{PLAN_EMOJI[p.kind]}</span>
        <span className="card-plan-text">
          <b>{p.place}</b>
          <span>{KIND_LABEL[p.kind]} · {p.joined.length} going</span>
        </span>
        <span className="card-plan-actions">
          <button type="button" className="btn btn-small btn-ghost" onClick={() => onShowPlan(p.id)}>Show</button>
          {!inIt ? (
            <button type="button" className="btn btn-small" onClick={() => onJoin(p.id)}>I&apos;m in</button>
          ) : p.by !== mePlayerId ? (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => onLeave(p.id)}>Not going</button>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <section className="sheet panel person-card" data-testid="person-card" data-player-id={player.id} style={{ '--c': player.color } as CSSProperties}>
      <header className="panel-head">
        <div className="card-head">
          <span className="card-avatar" aria-hidden="true">{player.avatar}</span>
          <span className="card-who">
            <span className="card-name" data-testid="card-name">{player.name}{isMe ? ' (you)' : ''}</span>
            <span className="card-where">{where}</span>
          </span>
        </div>
        <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </header>

      {player.organizer && <p className="card-tag" data-testid="card-organizer">⭐ Organizer</p>}

      {player.mood && (
        <div className="card-block" data-testid="card-mood">
          <span className="card-label">Feeling</span>
          <span className="card-mood">{moodEmoji(player.mood)} {moodText(player.mood)}{player.mood.note ? ` · “${player.mood.note}”` : ''}</span>
        </div>
      )}

      <div className="card-block" data-testid="card-contact">
        <span className="card-label">Contact</span>
        {isMe ? (
          <div className="mood-custom-row">
            <input
              data-testid="card-contact-input"
              aria-label="Your contact info"
              value={draft}
              maxLength={CONTACT_MAX}
              enterKeyHint="done"
              autoComplete="off"
              placeholder="Phone, email, or where to find you"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveContact(draft);
              }}
            />
            <button type="button" className="btn btn-small" data-testid="btn-card-save" disabled={draft.trim() === player.contact} onClick={() => onSaveContact(draft)}>Save</button>
          </div>
        ) : player.contact ? (
          <span className="card-contact-text">
            {link ? <a className="card-link" href={link.href} data-testid="card-contact-link">{player.contact}</a> : player.contact}
          </span>
        ) : (
          <span className="card-empty">{player.name} has not added contact info.</span>
        )}
        {isMe && <span className="fineprint">Only people in this event see it, and it goes when you leave.</span>}
      </div>

      {made.length > 0 && (
        <div className="card-block">
          <span className="card-label">{isMe ? 'Your flags' : `Flags by ${player.name}`}</span>
          <ul className="card-plans">{made.map(planRow)}</ul>
        </div>
      )}
      {going.length > 0 && (
        <div className="card-block">
          <span className="card-label">Going to</span>
          <ul className="card-plans">{going.map(planRow)}</ul>
        </div>
      )}
      {made.length === 0 && going.length === 0 && <p className="card-empty">No plans yet.</p>}

      <div className="controls">
        <button type="button" className="btn" data-testid="btn-card-show" disabled={!player.pos || !player.online} onClick={onShowOnMap}>📍 Show on map</button>
      </div>
    </section>
  );
}
