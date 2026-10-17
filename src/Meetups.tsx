// Sheets for moods, meetup plans and the Talk button. All state lives in App.tsx; these only render and report.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MOODS,
  MOOD_EMOJI,
  NOTE_MAX,
  PLACE_MAX,
  PLAN_EMOJI,
  PLAN_KINDS,
  BUBBLE_MAX,
  type MoodId,
  type Plan,
  type PlanKind,
  type Player,
} from '../shared/protocol.ts';
import { formatDistance, type LatLng } from './geo.ts';
import { KIND_LABEL, MOOD_LABEL, metresTo, walkPhrase } from './meetup.ts';
import { summarize } from './bubble.ts';
import { useSpeechInput } from './useSpeech.ts';

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

export function MoodSheet({ current, onShare, onClear, onClose }: {
  current: Player['mood'];
  onShare: (mood: MoodId, note: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<MoodId | null>(current?.id ?? null);
  const [note, setNote] = useState(current?.note ?? '');
  return (
    <Panel title="How are you feeling?" testid="mood-sheet" onClose={onClose}>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <button key={m} type="button" data-testid={`mood-${m}`} className={`mood ${sel === m ? 'on' : ''}`} aria-pressed={sel === m} onClick={() => setSel(m)}>
            <span className="mood-emoji">{MOOD_EMOJI[m]}</span>
            <span className="mood-label">{MOOD_LABEL[m]}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Tell the crew (optional)</span>
        <input data-testid="mood-note" value={note} maxLength={NOTE_MAX} enterKeyHint="done" autoComplete="off" placeholder="e.g. tacos?" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="controls">
        <button type="button" className="btn" data-testid="btn-mood-share" disabled={!sel} onClick={() => sel && onShare(sel, note)}>Share mood</button>
        <button type="button" className="btn btn-ghost" data-testid="btn-mood-clear" disabled={!current} onClick={onClear}>Clear</button>
      </div>
    </Panel>
  );
}

// --- plans --------------------------------------------------------------------

export function PlansPanel({ plans, players, me, mePos, selected, onNew, onJoin, onLeave, onShow, onPing, onCancel, onClose }: {
  plans: Plan[];
  players: Player[];
  me: string | null;
  mePos: LatLng | null;
  selected: string | null;
  onNew: (seed?: { kind: PlanKind }) => void;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
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
      <button type="button" className="btn btn-big" data-testid="btn-new-plan" onClick={() => onNew()}>🚩 Plant a flag</button>
      {hungry.length > 0 && (
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

// --- settings ---------------------------------------------------------------------

export function SettingsSheet({ notif, onNotif, awake, awakeSupported, onAwake, voice, onVoice, onLegend, onQuest, onClose }: {
  notif: 'on' | 'off' | 'blocked' | 'unsupported';
  onNotif: (on: boolean) => void;
  awake: boolean;
  awakeSupported: boolean;
  onAwake: (on: boolean) => void;
  voice: boolean;
  onVoice: (on: boolean) => void;
  onLegend: () => void;
  onQuest: () => void;
  onClose: () => void;
}) {
  return (
    <Panel title="Settings" testid="settings-sheet" onClose={onClose}>
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
      <button type="button" className="btn btn-ghost btn-big" data-testid="btn-legend" onClick={onLegend}>🗺️ Show the map legend</button>
      <button type="button" className="btn btn-ghost btn-big quest-replay" data-testid="btn-quest-replay" onClick={onQuest}>🧪 Replay the test mission</button>
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
        <input data-testid="plan-place" autoFocus value={place} maxLength={PLACE_MAX} enterKeyHint="next" autoComplete="off" placeholder="e.g. Joe's Tacos" onChange={(e) => setPlace(e.target.value)} />
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

export function TalkSheet({ onSend, onPlan, onClose }: {
  onSend: (bubble: { emoji: string; text: string }, mood: MoodId | undefined) => void;
  onPlan: (seed: { kind: PlanKind; place: string }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const speech = useSpeechInput((final) => setText(final));
  const summary = useMemo(() => summarize(text), [text]);
  const canSend = summary.text.length > 0;
  const errorText: Record<NonNullable<typeof speech.error>, string> = {
    denied: 'Microphone is blocked for this site. Type it instead, your keyboard mic works too.',
    'no-speech': 'Did not catch anything. Try again or type it.',
    network: 'Speech needs a connection right now. Type it instead.',
    unsupported: 'This browser cannot listen. Type it, your keyboard mic works too.',
    other: 'Could not listen. Type it instead.',
  };
  return (
    <Panel title="Say something" testid="talk-sheet" onClose={onClose}>
      <button type="button" className={`btn btn-big mic ${speech.listening ? 'is-listening' : ''}`} data-testid="btn-talk-mic" disabled={!speech.supported} onClick={() => (speech.listening ? speech.stop() : (setText(''), speech.start()))}>
        {speech.listening ? '🎙 Listening… tap to stop' : '🎙 Tap and talk'}
      </button>
      {speech.error && <p className="error">{errorText[speech.error]}</p>}
      <p className="fineprint">Voice typing uses your browser's speech service (Chrome may send the audio to Google). Typing below stays on your phone.</p>
      <label className="field">
        <span>{speech.listening && speech.interim ? 'Hearing…' : 'Or type it'}</span>
        <input data-testid="talk-input" value={speech.listening && speech.interim ? speech.interim : text} maxLength={140} enterKeyHint="send" autoComplete="off" placeholder="e.g. let's go eat at Joe's Tacos" onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="preview" aria-live="polite">
        <span className="preview-label">Your crew will see</span>
        <div className="thought-preview" data-testid="talk-preview">{canSend ? `${summary.emoji} ${summary.text.slice(0, BUBBLE_MAX)}` : '💭 …'}</div>
        {summary.mood && <span className="preview-note">Also sets your mood: {MOOD_EMOJI[summary.mood]} {MOOD_LABEL[summary.mood]}</span>}
      </div>
      <div className="controls">
        <button type="button" className="btn" data-testid="btn-talk-send" disabled={!canSend} onClick={() => onSend({ emoji: summary.emoji, text: summary.text }, summary.mood)}>Send</button>
        {summary.plan && (
          <button type="button" className="btn btn-ghost" data-testid="btn-talk-plan" onClick={() => onPlan(summary.plan!)}>🚩 Make it a plan</button>
        )}
      </div>
    </Panel>
  );
}
