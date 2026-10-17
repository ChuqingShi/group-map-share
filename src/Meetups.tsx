// Sheets for moods, meetup plans and the Talk button. All state lives in App.tsx; these only render and report.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MOODS,
  MOOD_EMOJI,
  MOOD_TEXT_MAX,
  NOTE_MAX,
  PLACE_MAX,
  PLAN_EMOJI,
  PLAN_KINDS,
  QUICK_EMOJI,
  BUBBLE_MAX,
  type MoodId,
  type Plan,
  type PlanKind,
  type Player,
} from '../shared/protocol.ts';
import { formatDistance, type LatLng } from './geo.ts';
import { KIND_LABEL, MOOD_LABEL, metresTo, walkPhrase } from './meetup.ts';
import { summarize, type Feeling } from './bubble.ts';
import type { FoundPlace } from './places.ts';
import { useSpeechInput } from './useSpeech.ts';
import { store } from './safeStorage.ts';

function Panel({ title, testid, onClose, children }: { title: string; testid: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="sheet panel" data-testid={testid}>
      <header className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      {children}
    </section>
  );
}

// --- mood ---------------------------------------------------------------------

export interface MoodChoice {
  mood: MoodId | 'custom';
  emoji?: string;
  text?: string;
}

const RECENT_KEY = 'gms-recent-moods';
interface RecentMood { emoji: string; text: string }
const loadRecent = (): RecentMood[] => {
  try {
    const raw: unknown = JSON.parse(store.get(RECENT_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((r): r is RecentMood => !!r && typeof r.emoji === 'string' && typeof r.text === 'string').slice(0, 5)
      : [];
  } catch {
    return [];
  }
};

/** Tap a common mood and you are done. Or type your own, with any emoji or none. */
export function MoodSheet({ current, onShare, onClear, onClose }: {
  current: Player['mood'];
  onShare: (choice: MoodChoice) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [emoji, setEmoji] = useState(current?.id === 'custom' ? current.emoji : '😋');
  const [text, setText] = useState(current?.id === 'custom' ? current.label : '');
  const [recent] = useState(loadRecent);
  const canShare = text.trim().length > 0 || emoji.length > 0;
  const shareCustom = (e: string, t: string) => {
    const clean = { emoji: e, text: t.trim().slice(0, MOOD_TEXT_MAX) };
    if (!clean.emoji && !clean.text) return;
    store.set(RECENT_KEY, JSON.stringify([clean, ...recent.filter((r) => r.emoji !== clean.emoji || r.text !== clean.text)].slice(0, 5)));
    onShare({ mood: 'custom', ...clean });
  };
  return (
    <Panel title="How are you feeling?" testid="mood-sheet" onClose={onClose}>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <button key={m} type="button" data-testid={`mood-${m}`} className={`mood ${current?.id === m ? 'on' : ''}`} aria-pressed={current?.id === m} onClick={() => onShare({ mood: m })}>
            <span className="mood-emoji">{MOOD_EMOJI[m]}</span>
            <span className="mood-label">{MOOD_LABEL[m]}</span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mood-recent" aria-label="Your recent moods">
          {recent.map((r) => (
            <button key={`${r.emoji}|${r.text}`} type="button" className="chip-pill" data-testid="mood-recent" onClick={() => shareCustom(r.emoji, r.text)}>
              {r.emoji || '💬'} {r.text}
            </button>
          ))}
        </div>
      )}
      <div className="mood-custom">
        <span className="mood-custom-title">Or type your own</span>
        <div className="emoji-strip" role="radiogroup" aria-label="Pick an emoji, or none">
          <button type="button" role="radio" aria-checked={emoji === ''} data-testid="mood-emoji-none" className={`emoji-pick ${emoji === '' ? 'on' : ''}`} onClick={() => setEmoji('')} title="No emoji">💬</button>
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={emoji === e} data-testid="mood-emoji" className={`emoji-pick ${emoji === e ? 'on' : ''}`} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <div className="mood-custom-row">
          <input
            data-testid="mood-custom-text"
            aria-label="Your mood"
            value={text}
            maxLength={MOOD_TEXT_MAX}
            enterKeyHint="send"
            autoComplete="off"
            placeholder="e.g. Dreaming of tacos"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canShare) shareCustom(emoji, text);
            }}
          />
          <button type="button" className="btn" data-testid="btn-mood-share" disabled={!canShare} onClick={() => shareCustom(emoji, text)}>Share</button>
        </div>
        <p className="fineprint">Tip: your phone keyboard has its own emoji key if the one you want is not here.</p>
      </div>
      <div className="controls">
        <button type="button" className="btn btn-ghost" data-testid="btn-mood-clear" disabled={!current} onClick={onClear}>Clear my mood</button>
      </div>
    </Panel>
  );
}

// --- plans --------------------------------------------------------------------

export function PlansPanel({ plans, players, me, mePos, selected, canPlant, onNew, onJoin, onLeave, onDecline, onSuggest, onShow, onPing, onCancel, onClose }: {
  plans: Plan[];
  players: Player[];
  me: string | null;
  mePos: LatLng | null;
  selected: string | null;
  /** False when the event has an organizer and I am not one. */
  canPlant: boolean;
  onNew: (seed?: { kind: PlanKind; place?: string }) => void;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onDecline: (id: string) => void;
  onSuggest: (id: string) => void;
  onShow: (id: string) => void;
  onPing: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const hungry = players.filter((p) => p.mood?.id === 'hungry' && p.id !== me);
  const sorted = plans.slice().sort((a, b) => b.createdAt - a.createdAt);
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <Panel title="Plans" testid="plans-panel" onClose={onClose}>
      {canPlant ? (
        <button type="button" className="btn btn-big" data-testid="btn-new-plan" onClick={() => onNew()}>🚩 Plant a flag</button>
      ) : (
        <p className="suggest" data-testid="organizers-only">⭐ This event has an organizer, so only organizers plant flags. You can still say I'm in.</p>
      )}
      {canPlant && hungry.length > 0 && (
        <p className="suggest">
          🍔 {hungry.map((p) => p.name).join(', ')} {hungry.length === 1 ? 'is' : 'are'} hungry.{' '}
          <button type="button" className="btn-link-inline" onClick={() => onNew({ kind: 'lunch' })}>Plan lunch?</button>
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="empty">No plans yet. Plant a flag where you want everyone to go.</p>
      ) : (
        <ul className="plan-list">
          {sorted.map((p) => {
            const mine = p.by === me;
            const going = p.joined.includes(me ?? '');
            const away = metresTo(mePos, p);
            return (
              <li key={p.id} className={`plan-card ${selected === p.id ? 'is-selected' : ''}`} data-testid="plan-card" data-plan-id={p.id}>
                <div className="plan-title">
                  <span className="plan-emoji">{PLAN_EMOJI[p.kind]}</span>
                  <span className="plan-place">{p.place}</span>
                </div>
                <div className="plan-meta">
                  {KIND_LABEL[p.kind]} · by {mine ? 'you' : p.byName} · {p.joined.length} going
                  {away !== null && ` · ${formatDistance(away)} (${walkPhrase(away)})`}
                </div>
                {p.note && <div className="plan-note">“{p.note}”</div>}
                {p.declined.length > 0 && <div className="plan-meta" data-testid="plan-declined">{p.declined.length} said no thanks{p.declined.includes(me ?? '') ? ' (you)' : ''}</div>}
                {p.suggestions.length > 0 && (
                  <ul className="suggestions" aria-label="Other ideas">
                    {p.suggestions.map((sg) => (
                      <li key={sg.id} className="suggestion" data-testid="plan-suggestion">
                        <span>💡 <b>{sg.byName}</b> suggests <b>{sg.place}</b>{sg.note ? ` (${sg.note})` : ''}</span>
                        {mine && canPlant && <button type="button" className="btn btn-small" data-testid="btn-plan-adopt" onClick={() => onNew({ kind: p.kind, place: sg.place })}>Plan it</button>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="plan-going" aria-label="Who is going">
                  {p.joined.map((id) => {
                    const pl = byId.get(id);
                    return pl ? <span key={id} className="going-face" style={{ '--c': pl.color } as CSSProperties} title={pl.name}>{pl.avatar}</span> : null;
                  })}
                </div>
                <div className="controls">
                  {going ? (
                    mine ? null : <button type="button" className="btn btn-small btn-ghost" data-testid="btn-plan-leave" onClick={() => onLeave(p.id)}>Not going</button>
                  ) : (
                    <button type="button" className="btn btn-small" data-testid="btn-plan-join" onClick={() => onJoin(p.id)}>I&apos;m in</button>
                  )}
                  {!mine && !p.declined.includes(me ?? '') && <button type="button" className="btn btn-small btn-ghost" data-testid="btn-plan-decline" onClick={() => onDecline(p.id)}>No thanks</button>}
                  {!mine && <button type="button" className="btn btn-small btn-ghost" data-testid="btn-plan-suggest" onClick={() => onSuggest(p.id)}>💡 Suggest</button>}
                  <button type="button" className="btn btn-small btn-ghost" data-testid="btn-plan-show" onClick={() => onShow(p.id)}>🗺️ Show</button>
                  {mine && <button type="button" className="btn btn-small btn-ghost" data-testid="btn-plan-ping" onClick={() => onPing(p.id)}>🔔 Ping</button>}
                  {mine && (
                    <button type="button" className="btn btn-small btn-danger" data-testid="btn-plan-cancel" onClick={() => (armed === p.id ? (setArmed(null), onCancel(p.id)) : setArmed(p.id))}>
                      {armed === p.id ? 'Sure?' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// --- suggesting somewhere else ---------------------------------------------------

/** "No, but how about...": a different place for the same plan. Open to everyone, organizers or not. */
export function SuggestSheet({ plan, onSend, onClose }: { plan: Plan; onSend: (place: string, note: string) => void; onClose: () => void }) {
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const ok = place.trim().length > 0;
  return (
    <Panel title="How about…?" testid="suggest-sheet" onClose={onClose}>
      <p className="suggest">Instead of <b>{plan.place}</b> ({KIND_LABEL[plan.kind]}), where would you rather go? Only the name is needed. This also counts as a no thanks.</p>
      <label className="field">
        <span>Somewhere else</span>
        <input data-testid="suggest-place" autoFocus value={place} maxLength={PLACE_MAX} enterKeyHint="next" autoComplete="off" placeholder="e.g. Blue Bottle" onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label className="field">
        <span>Why (optional)</span>
        <input data-testid="suggest-note" value={note} maxLength={NOTE_MAX} enterKeyHint="send" autoComplete="off" placeholder="e.g. shorter line" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onSend(place.trim(), note.trim()); }} />
      </label>
      <div className="controls">
        <button type="button" className="btn" data-testid="btn-suggest-send" disabled={!ok} onClick={() => onSend(place.trim(), note.trim())}>Send idea</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Panel>
  );
}

// --- settings ---------------------------------------------------------------------

export function SettingsSheet({ notif, onNotif, awake, awakeSupported, onAwake, voice, onVoice, sfx, onSfx, onLegend, onQuest, organizer, onOrganizer, leaveArmed, onLeave, onClose }: {
  notif: 'on' | 'off' | 'blocked' | 'unsupported';
  onNotif: (on: boolean) => void;
  awake: boolean;
  awakeSupported: boolean;
  onAwake: (on: boolean) => void;
  voice: boolean;
  onVoice: (on: boolean) => void;
  sfx: boolean;
  onSfx: (on: boolean) => void;
  onLegend: () => void;
  onQuest: () => void;
  organizer: boolean;
  onOrganizer: (on: boolean) => void;
  leaveArmed: boolean;
  onLeave: () => void;
  onClose: () => void;
}) {
  return (
    <Panel title="Settings" testid="settings-sheet" onClose={onClose}>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="btn-organizer" checked={organizer} onChange={(e) => onOrganizer(e.target.checked)} />
        <span>⭐ I'm an organizer <em>(while anyone is, only organizers plant flags)</em></span>
      </label>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="btn-notify" checked={notif === 'on'} disabled={notif === 'blocked' || notif === 'unsupported'} onChange={(e) => onNotif(e.target.checked)} />
        <span>
          🔔 Notify me when the app is in the background{' '}
          <em>
            {notif === 'blocked' && '(blocked in browser settings)'}
            {notif === 'unsupported' && '(on iPhone, add this to your Home Screen first)'}
            {(notif === 'on' || notif === 'off') && '(only for events you are in)'}
          </em>
        </span>
      </label>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="btn-awake" checked={awake && awakeSupported} disabled={!awakeSupported} onChange={(e) => onAwake(e.target.checked)} />
        <span>🔆 Keep my screen on so my pin stays fresh <em>{awakeSupported ? '(uses battery)' : '(not supported here)'}</em></span>
      </label>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="btn-voice" checked={voice} onChange={(e) => onVoice(e.target.checked)} />
        <span>🔊 Speak pings out loud <em>(off keeps it to toasts and bubbles)</em></span>
      </label>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="btn-sfx" checked={sfx} onChange={(e) => onSfx(e.target.checked)} />
        <span>🎵 Sound effects</span>
      </label>
      <button type="button" className="btn btn-ghost btn-big" data-testid="btn-legend" onClick={onLegend}>🗺️ Show the map legend</button>
      <button type="button" className="btn btn-ghost btn-big quest-replay" data-testid="btn-quest-replay" onClick={onQuest}>🧪 Replay the test mission</button>
      <button type="button" className="btn btn-danger btn-big leave" data-testid="btn-leave" onClick={onLeave}>
        {leaveArmed ? '🚪 Tap again to leave for good' : '🚪 Leave this event'}
      </button>
      <p className="fineprint">Alerts and location only work while the app is open. Close it and your pin greys out, and your location is forgotten after 5 minutes. Pause sharing any time from the toolbar.</p>
    </Panel>
  );
}

// --- planting a flag ------------------------------------------------------------

export function DropBanner({ canUseMe, onUseMe, onCancel }: { canUseMe: boolean; onUseMe: () => void; onCancel: () => void }) {
  return (
    <section className="sheet drop-banner" data-testid="drop-banner">
      <p><b>🚩 Tap the map</b> where the flag should go.</p>
      <div className="controls">
        <button type="button" className="btn btn-small" data-testid="btn-drop-here" disabled={!canUseMe} onClick={onUseMe}>📍 Where I am</button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

export interface PlanInput {
  kind: PlanKind;
  place: string;
  note: string;
  ping: boolean;
}

export function PlanForm({ seed, onCreate, onMove, onCancel }: {
  seed: { kind?: PlanKind; place?: string } | null;
  onCreate: (input: PlanInput) => void;
  onMove: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PlanKind>(seed?.kind ?? 'lunch');
  const [place, setPlace] = useState(seed?.place ?? '');
  const [note, setNote] = useState('');
  const [ping, setPing] = useState(true);
  const ok = place.trim().length > 0;
  return (
    <form
      className="sheet panel"
      data-testid="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onCreate({ kind, place: place.trim(), note: note.trim(), ping });
      }}
    >
      <header className="panel-head">
        <h2>Plant a flag</h2>
        <button type="button" className="btn-icon" aria-label="Cancel" onClick={onCancel}>✕</button>
      </header>
      <div className="kinds" role="radiogroup" aria-label="What kind of plan">
        {PLAN_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`kind-${k}`} className={`kind ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            <span>{PLAN_EMOJI[k]}</span>
            <span className="kind-label">{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Where?</span>
        <input data-testid="plan-place" autoFocus={!seed?.place} value={place} maxLength={PLACE_MAX} enterKeyHint="next" autoComplete="off" placeholder="e.g. Joe's Tacos" onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <input data-testid="plan-note" value={note} maxLength={NOTE_MAX} enterKeyHint="done" autoComplete="off" placeholder="e.g. my treat" onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="voice-toggle">
        <input type="checkbox" data-testid="plan-ping" checked={ping} onChange={(e) => setPing(e.target.checked)} />
        <span>🔔 Let everyone know now</span>
      </label>
      <div className="controls">
        <button className="btn" data-testid="btn-plan-create" disabled={!ok}>Plant it</button>
        <button type="button" className="btn btn-ghost" onClick={onMove}>Move flag</button>
      </div>
    </form>
  );
}

// --- talk -----------------------------------------------------------------------

/** After you finish speaking, the app does what you said unless you cancel in this many seconds. */
const COUNTDOWN_S = 3;

export interface TalkPlant {
  kind: PlanKind;
  place: string;
  lat: number;
  lng: number;
}

/**
 * Talk opens listening. Say "let's go eat at Joe's Tacos": the words become a short thought bubble, your mood
 * follows what you said, and if Joe's Tacos is on the map nearby the flag is planted and the crew pinged, all
 * after a three second "cancel?" window. Typing works too, with an explicit button instead of the countdown.
 */
export function TalkSheet({ canPlant, findPlace, onSend, onPlant, onDropIt, onClose }: {
  /** False when the event has an organizer and I am not one: talking still sets bubbles and moods, but never plants. */
  canPlant: boolean;
  findPlace: (said: string) => FoundPlace | null;
  onSend: (bubble: { emoji: string; text: string }, feeling: Feeling | undefined) => void;
  onPlant: (plant: TalkPlant, feeling: Feeling | undefined) => void;
  /** The place was named but is not on the map nearby: open the flag card ready for a drag or a tap. */
  onDropIt: (seed: { kind: PlanKind; place: string }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const speech = useSpeechInput((final) => {
    setText(final);
    setCountdown(COUNTDOWN_S);
  });
  const heard = useMemo(() => summarize(text), [text]);
  // Without the right to plant, a place name is just words in the bubble.
  const summary = useMemo(() => (canPlant ? heard : { ...heard, plan: undefined }), [heard, canPlant]);
  const found = useMemo(() => (summary.plan ? findPlace(summary.plan.place) : null), [summary, findPlace]);
  const canSend = summary.text.length > 0;
  const unresolved = !!summary.plan && !found;

  const send = () => onSend({ emoji: summary.emoji, text: summary.text }, summary.feeling);
  const plant = () => {
    if (!summary.plan || !found) return;
    onPlant({ kind: summary.plan.kind, place: found.name, lat: found.lat, lng: found.lng }, summary.feeling);
  };
  const act = () => (found ? plant() : unresolved ? setCountdown(null) : send());

  // Listening starts as soon as the sheet opens, so Talk then speak is the whole gesture.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !speech.supported) return;
    started.current = true;
    speech.start();
  }, [speech]);

  // The countdown only runs when the app knows what to do (send a bubble, or plant a flag it found).
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      act();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 900);
    return () => clearTimeout(t);
  }, [countdown]);
  useEffect(() => {
    if (unresolved || !canSend) setCountdown(null);
  }, [unresolved, canSend]);

  const errorText: Record<NonNullable<typeof speech.error>, string> = {
    denied: 'Microphone is blocked for this site. Type it instead, your keyboard mic works too.',
    'no-speech': 'Did not catch anything. Tap the mic or type it.',
    network: 'Speech needs a connection right now. Type it instead.',
    unsupported: 'This browser cannot listen. Type it, your keyboard mic works too.',
    other: 'Could not listen. Tap the mic or type it.',
  };
  return (
    <Panel title="Say something" testid="talk-sheet" onClose={onClose}>
      <button type="button" className={`btn btn-big mic ${speech.listening ? 'is-listening' : ''}`} data-testid="btn-talk-mic" disabled={!speech.supported} onClick={() => (speech.listening ? speech.stop() : (setText(''), setCountdown(null), speech.start()))}>
        {speech.listening ? '🎙 Listening… tap to stop' : '🎙 Tap and talk'}
      </button>
      {speech.error && <p className="error">{errorText[speech.error]}</p>}
      <label className="field">
        <span>{speech.listening && speech.interim ? 'Hearing…' : 'Or type it'}</span>
        <input
          data-testid="talk-input"
          value={speech.listening && speech.interim ? speech.interim : text}
          maxLength={140}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="e.g. let's go eat at Joe's Tacos"
          onChange={(e) => {
            setText(e.target.value);
            setCountdown(null); // you are editing: nothing happens until you say so
          }}
        />
      </label>
      <div className="preview" aria-live="polite">
        <span className="preview-label">Your crew will see</span>
        <div className="thought-preview" data-testid="talk-preview">{canSend ? `${summary.emoji} ${summary.text.slice(0, BUBBLE_MAX)}` : '💭 …'}</div>
        {found && <span className="preview-note" data-testid="talk-found">🚩 Found {found.name} on the map. I will plant a flag there</span>}
        {unresolved && <span className="preview-note" data-testid="talk-notfound">I could not find {summary.plan!.place} on the map near you. Drop the flag yourself?</span>}
        {summary.feeling && <span className="preview-note">Also sets your mood: {summary.feeling.emoji} {summary.feeling.text}</span>}
      </div>
      {countdown !== null && countdown > 0 && (
        <p className="countdown" data-testid="talk-countdown" role="status">
          {found ? `Planting in ${countdown}…` : `Sending in ${countdown}…`}
        </p>
      )}
      <div className="controls">
        {countdown !== null ? (
          <>
            <button type="button" className="btn" data-testid="btn-talk-now" onClick={() => { setCountdown(null); act(); }}>Do it now</button>
            <button type="button" className="btn btn-ghost" data-testid="btn-talk-cancel" onClick={() => setCountdown(null)}>Cancel</button>
          </>
        ) : (
          <>
            {found && <button type="button" className="btn" data-testid="btn-talk-plant" onClick={plant}>🚩 Plant &amp; ping</button>}
            {unresolved && (
              <button type="button" className="btn" data-testid="btn-talk-plan" onClick={() => onDropIt(summary.plan!)}>🚩 Drop it on the map</button>
            )}
            <button type="button" className={`btn ${found || unresolved ? 'btn-ghost' : ''}`} data-testid="btn-talk-send" disabled={!canSend} onClick={send}>Send</button>
          </>
        )}
      </div>
    </Panel>
  );
}
