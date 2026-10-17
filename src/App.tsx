import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { AVATARS, COLORS, NAME_MAX, type Player } from '../shared/protocol.ts';
import MapView, { type MapHandle } from './MapView.tsx';
import { LEGEND, drawTerrain } from './mapStyle.ts';
import { distanceM, formatAgo, formatDistance } from './geo.ts';
import { useRoom, type Profile } from './useRoom.ts';
import { useGeolocation, type GeoError } from './useGeolocation.ts';

const roomIdFromPath = () => location.pathname.match(/^\/r\/([\w-]+)/)?.[1] ?? null;

export default function App() {
  const [roomId, setRoomId] = useState(roomIdFromPath);
  useEffect(() => {
    const onPop = () => setRoomId(roomIdFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const go = (id: string | null, state?: unknown) => {
    history.pushState(state ?? null, '', id ? `/r/${id}${location.search}` : `/${location.search}`);
    setRoomId(id);
  };
  return roomId ? <RoomPage key={roomId} roomId={roomId} onExit={() => go(null)} /> : <Landing onCreated={(id) => go(id, { host: true })} />;
}

// --- landing ------------------------------------------------------------

function Landing({ onCreated }: { onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not create a room');
      onCreated(body.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="landing">
      <div className="landing-card">
        <div className="logo">📍</div>
        <h1>Group Map Share</h1>
        <p className="tagline">See where your crew is, live. No app, no account, no phone numbers.</p>
        <ol className="steps">
          <li><b>1</b> Create a room</li>
          <li><b>2</b> Friends scan the QR code</li>
          <li><b>3</b> Everyone pops up on the map</li>
        </ol>
        <button className="btn btn-big" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : '🎮 Create a room'}
        </button>
        {err && <p className="error">{err}</p>}
        <p className="fineprint">Locations are only shared while the page is open and are never stored. Rooms vanish after 30 minutes of inactivity.</p>
      </div>
    </div>
  );
}

// --- room -------------------------------------------------------------

const PROFILE_KEY = 'gms-profile';
const loadProfile = (): Profile => {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '');
    if (p && typeof p.name === 'string') return p;
  } catch { /* first visit */ }
  return {
    name: '',
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
};

function RoomPage({ roomId, onExit }: { roomId: string; onExit: () => void }) {
  const [exists, setExists] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sharing, setSharing] = useState(true);
  const [showInvite, setShowInvite] = useState(() => (history.state as { host?: boolean } | null)?.host === true);
  const [showLegend, setShowLegend] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  useEffect(() => {
    fetch(`/api/rooms/${encodeURIComponent(roomId)}`).then((r) => setExists(r.ok), () => setExists(false));
  }, [roomId]);

  const room = useRoom(roomId, profile);
  const live = room.status === 'live';
  const geo = useGeolocation(profile !== null && sharing);

  // Push my position (and sharing state) to the room.
  useEffect(() => {
    if (live && sharing && geo.fix) room.send({ t: 'pos', ...geo.fix });
  }, [live, sharing, geo.fix, room.send]);
  useEffect(() => {
    if (live && !sharing) room.send({ t: 'sharing', on: false });
  }, [live, sharing, room.send]);

  const players = useMemo(() => Object.values(room.players), [room.players]);
  const now = useNow();

  if (exists === false || room.status === 'no_room') return <Gone onExit={onExit} />;
  if (room.status === 'left') return <Message title="You left the room" body="Your pin was removed for everyone." onExit={onExit} />;
  if (room.status === 'replaced') return <Message title="Opened somewhere else" body="This room is now open in another tab or window." onExit={onExit} />;
  if (room.status === 'room_full') return <Message title="Room is full" body="This room has reached its player limit." onExit={onExit} />;

  const meP = room.me ? room.players[room.me] : undefined;

  return (
    <div className="room">
      <MapView ref={mapRef} players={players} me={room.me} />

      <header className="hud-top">
        <div className="chip">
          <span className="chip-dot" data-status={room.status} />
          {live ? `${players.length} in room` : room.status === 'reconnecting' ? 'Reconnecting…' : profile ? 'Connecting…' : 'Room'}
        </div>
        <div className="hud-actions">
          <button className="btn-icon" title="Map legend" onClick={() => setShowLegend((v) => !v)}>🗺️</button>
          <button className="btn-icon" title="Show everyone" onClick={() => mapRef.current?.fitAll()}>🔭</button>
          <button className="btn btn-small" onClick={() => setShowInvite(true)}>➕ Invite</button>
        </div>
      </header>

      {showLegend && <Legend onClose={() => setShowLegend(false)} />}

      {profile && <GeoBanner error={geo.error} sharing={sharing} />}

      {profile ? (
        <section className="hud-bottom">
          <ul className="players">
            {players
              .slice()
              .sort((a, b) => (a.id === room.me ? -1 : b.id === room.me ? 1 : a.name.localeCompare(b.name)))
              .map((p) => (
                <PlayerRow key={p.id} p={p} isMe={p.id === room.me} me={meP} now={now} clockOffset={room.clockOffset} onClick={() => mapRef.current?.focus(p.id)} />
              ))}
          </ul>
          <div className="controls">
            <button className={`btn ${sharing ? 'btn-ghost' : ''}`} onClick={() => setSharing((s) => !s)}>
              {sharing ? '⏸ Pause sharing' : '▶ Share my location'}
            </button>
            <button className="btn btn-danger" onClick={room.leave}>🚪 Leave</button>
          </div>
        </section>
      ) : (
        exists && <JoinCard onJoin={(p) => { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); setProfile(p); }} />
      )}

      {showInvite && <Invite roomId={roomId} onClose={() => setShowInvite(false)} />}
    </div>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function PlayerRow({ p, isMe, me, now, clockOffset, onClick }: {
  p: Player; isMe: boolean; me?: Player; now: number; clockOffset: number; onClick: () => void;
}) {
  let detail: string;
  if (!p.online) detail = 'offline';
  else if (!p.sharing || !p.pos) detail = isMe ? 'not sharing' : 'location hidden';
  else if (isMe) detail = p.pos.acc ? `±${Math.round(p.pos.acc)} m` : 'sharing';
  else if (me?.pos) detail = `${formatDistance(distanceM(me.pos, p.pos))} away`;
  else detail = 'on the map';
  const ago = p.pos ? formatAgo(now - (p.pos.at + clockOffset)) : '';
  return (
    <li className={`player ${p.online ? '' : 'is-offline'}`} style={{ '--c': p.color } as CSSProperties} onClick={onClick}>
      <span className="player-avatar">{p.avatar}</span>
      <span className="player-text">
        <span className="player-name">{p.name}{isMe && <em> (you)</em>}</span>
        <span className="player-detail">{detail}{ago && p.online && p.sharing ? ` · ${ago}` : ''}</span>
      </span>
    </li>
  );
}

function JoinCard({ onJoin }: { onJoin: (p: Profile) => void }) {
  const [p, setP] = useState(loadProfile);
  const ok = p.name.trim().length > 0;
  return (
    <form className="sheet join" onSubmit={(e) => { e.preventDefault(); if (ok) onJoin({ ...p, name: p.name.trim() }); }}>
      <h2>Join the map</h2>
      <label className="field">
        <span>Your name</span>
        <input autoFocus maxLength={NAME_MAX} value={p.name} placeholder="e.g. Sam" onChange={(e) => setP({ ...p, name: e.target.value })} />
      </label>
      <div className="field">
        <span>Pick a character</span>
        <div className="picker">
          {AVATARS.map((a) => (
            <button type="button" key={a} className={`pick ${a === p.avatar ? 'on' : ''}`} style={{ '--c': p.color } as CSSProperties} onClick={() => setP({ ...p, avatar: a })}>{a}</button>
          ))}
        </div>
        <div className="picker colors">
          {COLORS.map((c) => (
            <button type="button" key={c} aria-label={`colour ${c}`} className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} onClick={() => setP({ ...p, color: c })} />
          ))}
        </div>
      </div>
      <button className="btn btn-big" disabled={!ok}>📍 Join &amp; share my location</button>
      <p className="fineprint">Your location is shared with people in this room only while this page is open. Nothing is saved.</p>
    </form>
  );
}

function GeoBanner({ error, sharing }: { error: GeoError; sharing: boolean }) {
  if (!sharing || !error) return null;
  const text = {
    denied: 'Location permission is blocked. Allow it in your browser settings, then reload.',
    unavailable: 'Can’t get your location right now. Still trying…',
    insecure: 'Location needs a secure (https) connection. Open this room over https.',
    unsupported: 'This browser can’t share location.',
  }[error];
  return <div className="toast">⚠️ {text}</div>;
}

function Invite({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const url = `${location.origin}/r/${roomId}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 560, color: { dark: '#2b2350', light: '#ffffff' } }).then(setQr);
  }, [url]);
  const copy = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Join my map', url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch { /* user cancelled */ }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet invite" onClick={(e) => e.stopPropagation()}>
        <h2>Invite your crew</h2>
        <p>Scan to join. No app or account needed.</p>
        {qr ? <img className="qr" src={qr} alt="QR code for the room link" /> : <div className="qr" />}
        <code className="link">{url}</code>
        <div className="controls">
          <button className="btn" onClick={copy}>{copied ? '✅ Copied' : '🔗 Share link'}</button>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Legend({ onClose }: { onClose: () => void }) {
  const swatches = useMemo(() => LEGEND.map((t) => ({ ...t, src: drawTerrain(t, 56).toDataURL() })), []);
  return (
    <aside className="legend" onClick={onClose}>
      {swatches.map((t) => (
        <div key={t.id} className="legend-row">
          <img src={t.src} alt="" />
          {t.label}
        </div>
      ))}
    </aside>
  );
}

function Gone({ onExit }: { onExit: () => void }) {
  return <Message title="Room not found" body="This room has expired or the link is wrong. Rooms disappear after 30 minutes with nobody in them." onExit={onExit} />;
}

function Message({ title, body, onExit }: { title: string; body: string; onExit: () => void }) {
  return (
    <div className="landing">
      <div className="landing-card">
        <div className="logo">🗺️</div>
        <h1>{title}</h1>
        <p className="tagline">{body}</p>
        <button className="btn btn-big" onClick={onExit}>Back to start</button>
      </div>
    </div>
  );
}
