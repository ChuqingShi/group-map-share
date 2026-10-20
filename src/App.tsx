import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LatLng } from './geo.ts';
import QRCode from 'qrcode';
import { AVATARS, COLORS, NAME_MAX, planBubble, type PlanKind, type Player } from '../shared/protocol.ts';
import MapView, { type MapHandle } from './MapView.tsx';
import { LEGEND, drawTerrain } from './mapStyle.ts';
import { distanceM, formatAgo, formatDistance } from './geo.ts';
import { useRoom, type Profile } from './useRoom.ts';
import { useGeolocation, type GeoError } from './useGeolocation.ts';
import { requestLocation, saveStart, savedStart } from './startLocation.ts';
import { store } from './safeStorage.ts';
import { CrewStrip, Toasts, type ToastItem } from './Crew.tsx';
import { DropBanner, MoodSheet, PlanForm, PlansPanel, SettingsSheet, SuggestSheet, TalkSheet, type PlanInput, type TalkPlant } from './Meetups.tsx';
import { PersonCard } from './PersonCard.tsx';
import { PlaceCard } from './PlaceCard.tsx';
import type { FoundPlace } from './places.ts';
import { FlagButton } from './FlagDrag.tsx';
import type { Feeling } from './bubble.ts';
import { QuestChip, QuestIntro, QuestPanel, useQuest, type QuestApi } from './Quest.tsx';
import { announcement, mapsLink, metresTo, moodEmoji, moodText } from './meetup.ts';
import { playSfx, setSfxOn, sfxOn, unlockSfx } from './sfx.ts';
import { buzz, setVoiceOn, speak, unlockVoice, voiceOn } from './voice.ts';
import { clearNotifications, disableNotifications, enableNotifications, notifyEnabled, notifyPermission, showLocal } from './notify.ts';
import { keepAwakeOn, setKeepAwake, useKeepAwake, wakeLockSupported } from './keepAwake.ts';
import { forgetEvent, getEvent, loadEvents, saveEvent, touchEvent, type SavedEvent } from './events.ts';

const HOST_KEY_STORE = 'gms-host-key';
/** Only a real "no" is remembered. A timeout or a missing GPS signal is not a refusal. */
function rememberDenial(e: unknown) {
  if (e === 'denied') saveStart('declined');
}

const roomIdFromPath = () => location.pathname.match(/^\/r\/([\w-]+)/)?.[1] ?? null;

export default function App() {
  const [roomId, setRoomId] = useState(roomIdFromPath);
  const autoResume = useRef<boolean | null>(null);
  if (autoResume.current === null) autoResume.current = consumeAutoResume(roomIdFromPath() === null);
  // Spent after the first render: coming back to the list later (event chip, Back) must show the list, not bounce into the room.
  useEffect(() => {
    autoResume.current = false;
  }, []);
  // Which build is the server running? A new build shows the first mission once.
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/version').then((r) => r.json()).then((b: { build?: string }) => setBuild(b.build ?? null), () => {});
  }, []);
  const quest = useQuest(build);
  useEffect(() => {
    const onPop = () => setRoomId(roomIdFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  // The host link (/?host=KEY) lets this device start events. Keep the key, then take it out of the address bar.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const key = params.get('host');
    if (!key) return;
    store.set(HOST_KEY_STORE, key);
    params.delete('host');
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : ''));
  }, []);
  // Speech needs one user gesture per page load; the first tap anywhere provides it.
  useEffect(() => {
    const unlock = () => { unlockVoice(); unlockSfx(); };
    // Touch screens grant "user activation" on release, not on press.
    addEventListener('pointerup', unlock, { once: true });
    return () => removeEventListener('pointerup', unlock);
  }, []);
  const go = (id: string | null, state?: unknown) => {
    history.pushState(state ?? null, '', id ? `/r/${id}${location.search}` : `/${location.search}`);
    setRoomId(id);
  };
  return (
    <>
      {roomId ? <RoomPage key={roomId} roomId={roomId} onExit={() => go(null)} quest={quest} /> : <Landing onCreated={(id) => go(id, { host: true })} onOpen={(id) => go(id)} autoResume={autoResume.current} />}
      {quest.intro && build && <QuestIntro build={build} onStart={quest.start} onSkip={quest.skip} />}
    </>
  );
}

// --- landing ------------------------------------------------------------

/**
 * Opening the app at / for the first time in a browser session lands you straight back in your latest event.
 * Any other load (a room link, or coming back to the list via the event chip) shows the list instead.
 * Called once, by App, so the flag is always set by the first load, wherever it landed.
 */
function consumeAutoResume(atHome: boolean): boolean {
  try {
    if (sessionStorage.getItem('gms-landed')) return false;
    sessionStorage.setItem('gms-landed', '1');
  } catch {
    return false;
  }
  return atHome && loadEvents().length > 0;
}

type ListedEvent = SavedEvent & { here: number | null };

function Landing({ onCreated, onOpen, autoResume: resumeFirst }: { onCreated: (id: string) => void; onOpen: (id: string) => void; autoResume: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [events, setEvents] = useState<ListedEvent[]>(() => loadEvents().map((e) => ({ ...e, here: null })));
  const autoResume = useRef(resumeFirst);
  const [resuming, setResuming] = useState(resumeFirst);

  // Check which remembered events still exist; forget the ones that ended. Then resume the latest.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const checked = await Promise.all(
        loadEvents().map(async (e): Promise<ListedEvent | null> => {
          try {
            const r = await fetch(`/api/rooms/${encodeURIComponent(e.id)}`, { signal: AbortSignal.timeout(4_000) });
            if (r.status === 404) {
              forgetEvent(e.id);
              return null;
            }
            if (!r.ok) return { ...e, here: null };
            const b = (await r.json()) as { name?: string; players?: number };
            return { ...e, name: b.name || e.name, here: typeof b.players === 'number' ? b.players : null };
          } catch {
            return { ...e, here: null }; // offline: keep it, we will find out when we open it
          }
        }),
      );
      if (cancelled) return;
      const alive = checked.filter((e): e is ListedEvent => e !== null);
      setEvents(alive);
      if (autoResume.current && alive[0]) onOpen(alive[0].id);
      else setResuming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setErr(null);
    // Ask for location inside this tap (no separate screen). Not awaited: the room is created meanwhile.
    if (!savedStart()) void requestLocation().then(saveStart, rememberDenial);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-host-key': store.get(HOST_KEY_STORE) ?? '' },
        body: JSON.stringify({ name: eventName.trim() }),
      });
      const body = await res.json();
      if (res.status === 403) throw new Error('Only the host can start events here. Scan the host’s QR code or open their invite link to join.');
      if (!res.ok) throw new Error(body.error ?? 'Could not create a room');
      onCreated(body.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  if (resuming) return <Message title="Welcome back" body="Taking you to your event…" />;
  return (
    <div className="landing">
      <div className="landing-card">
        <div className="logo">📍</div>
        <h1>Groupz</h1>
        <p className="tagline">See where your crew is, live. <br />No app, no account, no phone numbers.</p>
        {events.length > 0 ? (
          <section className="events" data-testid="events-list" aria-label="Your events">
            <h2>Your events</h2>
            <ul>
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="event-card" data-testid="event-card" data-room-id={e.id} onClick={() => onOpen(e.id)}>
                    <span className="event-avatar">{e.profile.avatar}</span>
                    <span className="event-text">
                      <span className="event-name">{e.name || 'Event'}</span>
                      <span className="event-meta">{e.here !== null ? `${e.here} here · ` : ''}{formatAgo(Date.now() - e.lastSeen)}</span>
                    </span>
                    <span className="event-go">Open ▸</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <ol className="steps">
            <li><b>1</b> Create a room</li>
            <li><b>2</b> Friends scan the QR code</li>
            <li><b>3</b> Everyone pops up on the map</li>
          </ol>
        )}
        <label className="field event-field">
          <span>{events.length > 0 ? 'Start another event' : 'Name your event (optional)'}</span>
          <input data-testid="event-name" value={eventName} maxLength={40} enterKeyHint="go" autoComplete="off" placeholder="e.g. Team lunch" onChange={(e) => setEventName(e.target.value)} />
        </label>
        <button className="btn btn-big" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : '🎮 Create a room'}
        </button>
        {err && <p className="error">{err}</p>}
        <p className="fineprint">Your location is only shared while the app is open. It is never saved to disk, is forgotten 5 minutes after you close the app, and you are erased when you leave. Events vanish after 3 hours with nobody in them.</p>
      </div>
    </div>
  );
}

// --- room -------------------------------------------------------------

const PROFILE_KEY = 'gms-profile';
const loadProfile = (): Profile => {
  try {
    const p = JSON.parse(store.get(PROFILE_KEY) ?? '');
    if (p && typeof p.name === 'string') return p;
  } catch { /* first visit */ }
  return {
    name: '',
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
};

type Panel = null | 'mood' | 'plans' | 'talk' | 'settings' | 'quest' | 'card' | 'suggest' | 'place';
type PlanStep = null | 'drop' | 'form';
interface Bubble { emoji: string; text: string; at: number }

const BUBBLE_MS = 9_000;

function RoomPage({ roomId, onExit, quest }: { roomId: string; onExit: () => void; quest: QuestApi }) {
  const [exists, setExists] = useState<boolean | null>(null);
  // Already in this event on this device: rejoin as the same player without asking again.
  const [profile, setProfile] = useState<Profile | null>(() => {
    const saved = getEvent(roomId)?.profile;
    if (saved) return saved;
    // The host who just created this event is joining their own event: no form needed if we know them.
    const me = (history.state as { host?: boolean } | null)?.host === true ? loadProfile() : null;
    return me && me.name.trim() ? me : null;
  });
  const [eventTitle, setEventTitle] = useState('');
  // Pausing is remembered per event, so reopening the app never quietly switches sharing back on.
  const [sharing, setSharingState] = useState(() => getEvent(roomId)?.sharing !== false);
  const setSharing = (on: boolean) => {
    setSharingState(on);
    touchEvent(roomId, { sharing: on });
  };
  const [showInvite, setShowInvite] = useState(() => (history.state as { host?: boolean } | null)?.host === true);
  const [showLegend, setShowLegend] = useState(false);
  const [start, setStart] = useState(savedStart);
  const [namesOpen, setNamesOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [planStep, setPlanStep] = useState<PlanStep>(null);
  const [planSeed, setPlanSeed] = useState<{ kind?: PlanKind; place?: string } | null>(null);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [placeCard, setPlaceCard] = useState<FoundPlace | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [cardId, setCardId] = useState<string | null>(null);
  const [suggestId, setSuggestId] = useState<string | null>(null);
  const [voice, setVoice] = useState(voiceOn);
  const [sfx, setSfx] = useState(sfxOn);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [notifOn, setNotifOn] = useState(notifyEnabled);
  const [awake, setAwake] = useState(keepAwakeOn);
  const mapRef = useRef<MapHandle>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    fetch(`/api/rooms/${encodeURIComponent(roomId)}`).then(
      (r) => {
        setExists(r.ok);
        if (r.status === 404) forgetEvent(roomId);
        else if (r.ok) void r.json().then((b: { name?: string }) => setEventTitle(b.name ?? ''), () => {});
      },
      () => setExists(true), // cannot reach the server right now: do not call the event gone, the socket will tell us
    );
  }, [roomId]);

  const room = useRoom(roomId, profile);
  const live = room.status === 'live';
  const geo = useGeolocation(profile !== null && sharing && room.status !== 'left');
  useKeepAwake(live && sharing && awake);
  const joinedSfx = useRef(false);
  useEffect(() => {
    if (live && !joinedSfx.current) { joinedSfx.current = true; playSfx('join'); }
  }, [live]);

  // Push my position (and sharing state) to the room.
  // Tell the room whether I am sharing (also after every reconnect), before any position goes out.
  useEffect(() => {
    if (live) room.send({ t: 'sharing', on: sharing });
  }, [live, sharing, room.send]);
  useEffect(() => {
    if (live && sharing && geo.fix) room.send({ t: 'pos', ...geo.fix });
  }, [live, sharing, geo.fix, room.send]);

  useEffect(() => {
    if (!live) return;
    touchEvent(roomId, {});
    // The host flag only exists to skip the form once. Drop it, so Back after leaving cannot rejoin silently.
    if ((history.state as { host?: boolean } | null)?.host) history.replaceState({ ...(history.state as object), host: false }, '');
  }, [live, roomId]);

  // Joined without the form (host, or resumed): make sure the event is remembered on this device.
  useEffect(() => {
    if (profile && !getEvent(roomId)) rememberEvent(roomId, profile);
  }, [profile, roomId]);

  // Resumed without tapping Join, so the permission question waits for the first tap inside the event.
  useEffect(() => {
    if (!live || notifyPermission() !== 'default') return;
    const ask = () => void enableNotifications().then(setNotifOn);
    addEventListener('pointerup', ask, { once: true });
    return () => removeEventListener('pointerup', ask);
  }, [live]);

  const players = useMemo(() => Object.values(room.players), [room.players]);
  const plans = useMemo(() => Object.values(room.plans), [room.plans]);
  const now = useNow();
  const meP = room.me ? room.players[room.me] : undefined;
  const mePos = meP?.pos ?? null;
  // Flags: everyone plants, unless somebody in the event ticked organizer; then only organizers do.
  const canPlant = !players.some((p) => p.organizer) || !!meP?.organizer;

  // First mission: each step ticks itself off when we see it happen (ignored until the mission is started).
  // These also re-run when the mission starts, so a step done before tapping Start still counts.
  const [nameChanged, setNameChanged] = useState(false); // a new name saved from my card: half of the profile step
  useEffect(() => {
    if (live && meP?.pos) quest.done('setup'); // the server has my location, so location access was allowed
    if (nameChanged && meP?.organizer) quest.done('profile');
    if (players.length >= 2) quest.done('invite');
    if (room.me && plans.some((p) => p.by === room.me)) quest.done('flag');
    if (room.me && plans.some((p) => p.by === room.me && p.joined.some((id) => id !== room.me))) quest.done('imin');
  }, [live, Boolean(meP?.pos), nameChanged, meP?.organizer, players.length, plans, room.me, quest.state]);
  // Compare when the mood was set, not the mood object: every location update re-sends my player as a new object.
  const moodAt = meP?.mood?.at ?? null;
  const lastMoodAt = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (lastMoodAt.current !== undefined && lastMoodAt.current !== moodAt) playSfx('mood');
    if (live) lastMoodAt.current = moodAt;
  }, [moodAt, live]);

  // --- toasts and thought bubbles ------------------------------------------------
  const pushToast = useCallback((t: Omit<ToastItem, 'id' | 'until'>, ms = 6_000) => {
    const id = ++toastSeq.current;
    setToasts((ts) => [...ts.slice(-2), { ...t, id, until: Date.now() + ms }]);
  }, []);
  const showBubble = useCallback((playerId: string, emoji: string, text: string) => {
    setBubbles((b) => ({ ...b, [playerId]: { emoji, text, at: Date.now() } }));
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  // One 1 s sweep expires bubbles, toasts and the crew tip without a timer per item.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setBubbles((b) => {
        const keep = Object.entries(b).filter(([, v]) => t - v.at < BUBBLE_MS);
        return keep.length === Object.keys(b).length ? b : Object.fromEntries(keep);
      });
      setToasts((ts) => {
        const keep = ts.filter((x) => x.until > t);
        return keep.length === ts.length ? ts : keep;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // A ping from someone else: toast, thought bubble over their pin, a buzz, and (opt-in) a spoken line.
  const lastPing = useRef(0);
  useEffect(() => {
    const ev = room.ping;
    if (!ev || ev.seq === lastPing.current) return;
    lastPing.current = ev.seq;
    const { plan } = ev;
    const b = planBubble(plan);
    showBubble(plan.by, b.emoji, b.text);
    pushToast({ kind: 'ping', emoji: b.emoji, text: `${plan.byName}: ${b.text}`, who: room.players[plan.by], planId: plan.id, mapHref: mapsLink(plan) }, 10_000);
    setSelectedPlan(plan.id); // shows the dotted trail from me to the flag
    if (plan.by !== room.me) playSfx('ping');
    buzz();
    speak(announcement(plan, metresTo(mePos, plan)));
    void showLocal(`${plan.byName} · ${room.roomName}`, `${b.emoji} ${b.text}`, { tag: plan.id, url: location.pathname });
  }, [room.ping]);

  // Somebody said something.
  const lastBubble = useRef(0);
  useEffect(() => {
    const ev = room.bubble;
    if (!ev || ev.seq === lastBubble.current) return;
    lastBubble.current = ev.seq;
    showBubble(ev.from, ev.emoji, ev.text);
    if (ev.from !== room.me) {
      playSfx('bubble');
      pushToast({ kind: 'bubble', emoji: ev.emoji, text: ev.text, who: room.players[ev.from] });
      void showLocal(`${room.players[ev.from]?.name ?? 'Someone'} · ${room.roomName}`, `${ev.emoji} ${ev.text}`, { tag: `bubble-${ev.from}`, url: location.pathname });
    }
  }, [room.bubble]);

  // Server notices (rate limits and so on).
  useEffect(() => {
    if (!room.notice) return;
    pushToast({ kind: 'info', emoji: '⚠️', text: room.notice });
    room.clearNotice();
  }, [room.notice]);

  // When I plant a flag, select it and fly there. Plans that were already there when I arrived do not count.
  const seenPlans = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!live) return;
    if (seenPlans.current === null) {
      seenPlans.current = new Set(Object.keys(room.plans));
      return;
    }
    for (const p of Object.values(room.plans)) {
      if (seenPlans.current.has(p.id)) continue;
      seenPlans.current.add(p.id);
      if (p.by === room.me) {
        playSfx('plant');
        setSelectedPlan(p.id);
        mapRef.current?.focusPlan(p.id);
        if (voicePlanted.current) {
          voicePlanted.current = false;
          pushToast({ kind: 'info', emoji: '🚩', text: `Planted ${p.place} and pinged the crew.`, action: { label: 'Undo', run: () => room.send({ t: 'plan_cancel', id: p.id }) } }, 8_000);
        }
      }
    }
    setSelectedPlan((id) => (id && !room.plans[id] ? null : id));
  }, [room.plans, live, room.me]);

  // Somebody suggested somewhere else for a plan I made: say so, and offer to plan it.
  const seenIdeas = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!live) return;
    const all = Object.values(room.plans).flatMap((p) => p.suggestions.map((sg) => ({ plan: p, sg })));
    if (seenIdeas.current === null) {
      seenIdeas.current = new Set(all.map((x) => x.sg.id)); // ideas that were already there when I arrived are not news
      return;
    }
    for (const { plan, sg } of all) {
      if (seenIdeas.current.has(sg.id)) continue;
      seenIdeas.current.add(sg.id);
      if (plan.by !== room.me || sg.by === room.me) continue;
      pushToast(
        {
          kind: 'info',
          emoji: '💡',
          text: `${sg.byName} suggests ${sg.place}${sg.note ? ` (${sg.note})` : ''} instead of ${plan.place}.`,
          action: canPlant ? { label: 'Plan it', run: () => startPlan({ kind: plan.kind, place: sg.place }) } : undefined,
        },
        12_000,
      );
    }
  }, [room.plans, live, room.me]);

  // --- actions ---------------------------------------------------------------------
  const isJoined = (planId: string) => !!room.me && !!room.plans[planId]?.joined.includes(room.me);
  const showPlan = (id: string) => {
    setSelectedPlan(id);
    mapRef.current?.focusPlan(id);
  };
  const startPlan = (seed: { kind?: PlanKind; place?: string } | null = null) => {
    setPlanSeed(seed);
    setDraft(null);
    setPanel(null);
    setPlanStep('drop');
  };
  /** The flag button was dragged and let go over the map: put the flag there, snapping to a named place under it. */
  const dropFlagAt = (clientX: number, clientY: number) => {
    const map = mapRef.current;
    const at = map?.unprojectClient(clientX, clientY);
    if (!map || !at) return;
    const place = map.nearestPlace(at);
    setDraft(place ? { lat: place.lat, lng: place.lng } : at);
    setPlanSeed({ kind: place?.kind ?? 'meetup', place: place?.name ?? 'Meet here' });
    setPanel(null);
    setPlanStep('form');
  };
  /** What you said sets your mood and emoji. */
  const feel = (f: Feeling | undefined) => {
    if (f) room.send({ t: 'mood', mood: f.mood, emoji: f.emoji, text: f.text });
  };
  /** The settings toggle: tell the room, and remember it for this event so a reconnect does not undo it. */
  const changeOrganizer = (on: boolean) => {
    room.send({ t: 'organizer', on });
    setProfile((p) => {
      if (!p) return p;
      const next = { ...p, organizer: on };
      touchEvent(roomId, { profile: next });
      return next;
    });
  };
  const voicePlanted = useRef(false);
  const endPlan = () => {
    setPlanStep(null);
    setPlanSeed(null);
    setDraft(null);
  };
  const createPlan = (input: PlanInput) => {
    if (!draft) return;
    room.send({ t: 'plan', kind: input.kind, place: input.place, note: input.note, lat: draft.lat, lng: draft.lng, ping: input.ping });
    endPlan();
  };
  /** Tap a picture, a name or a pin: that person's card. */
  const openCard = (id: string) => {
    setCardId(id);
    setPanel('card');
  };
  const declinePlan = (id: string) => {
    room.send({ t: 'plan_decline', id });
    playSfx('decline');
    setSelectedPlan((cur) => (cur === id ? null : cur));
  };
  /** My name and contact line: tell the room, and remember them on this device (and for this event's reconnects). */
  const saveMyCard = ({ name, contact }: { name: string; contact: string }) => {
    if (meP && name !== meP.name) {
      room.send({ t: 'profile', name });
      setNameChanged(true);
    }
    if (meP && contact !== meP.contact) room.send({ t: 'contact', text: contact });
    setProfile((p) => {
      if (!p) return p;
      const next = { ...p, name, contact };
      touchEvent(roomId, { profile: next });
      return next;
    });
    store.set(PROFILE_KEY, JSON.stringify({ ...loadProfile(), name, contact }));
  };
  const cardPlayer = cardId ? room.players[cardId] : undefined;
  const leaveTap = () => {
    if (leaveArmed) {
      // Leaving needs the server to hear it, or your pin and flags would stay behind for hours.
      if (!room.leave()) {
        pushToast({ kind: 'info', emoji: '📶', text: 'You are offline right now. Reconnect, then tap Leave again so you are really removed.' });
        setLeaveArmed(false);
        return;
      }
      playSfx('leave');
      quest.done('leave');
      void clearNotifications();
      return;
    }
    setLeaveArmed(true);
    setTimeout(() => setLeaveArmed(false), 3_000);
  };

  /** One tap: remember the event, ask for permissions, ask for location, show the map. */
  const join = async (p: Profile) => {
    const { organizer: _thisEventOnly, ...rest } = p;
    store.set(PROFILE_KEY, JSON.stringify(rest));
    unlockVoice();
    rememberEvent(roomId, p);
    if (notifyPermission() === 'default') void enableNotifications().then(setNotifOn);
    const found = savedStart();
    const loc =
      found ??
      (await Promise.race([
        requestLocation().then(
          (v) => (saveStart(v), v),
          (e) => (rememberDenial(e), 'declined' as const),
        ),
        new Promise<'declined'>((r) => setTimeout(() => r('declined'), 8_000)), // never keep someone waiting on GPS
      ]));
    setStart(loc);
    setProfile(p);
  };

  if (exists === false || room.status === 'no_room') return <Gone onExit={onExit} />;
  if (room.status === 'left') return <Message title="You left the room" body="Your pin and your flags were removed for everyone." onExit={onExit} />;
  if (room.status === 'replaced') return <Message title="Opened somewhere else" body="This room is now open in another tab or window." onExit={onExit} />;
  if (room.status === 'room_full') return <Message title="Room is full" body="This room has reached its player limit." onExit={onExit} />;
  if (!profile) return exists ? <JoinScreen eventName={eventTitle} onJoin={join} /> : null;

  return (
    <div className={`room ${namesOpen ? 'names-open' : ''}`}>
      <MapView
        ref={mapRef}
        players={players}
        me={room.me}
        start={start === 'declined' || start === null ? null : start}
        plans={plans}
        selectedPlan={selectedPlan}
        draft={draft}
        dropping={planStep === 'drop'}
        onDrop={(p) => { setDraft(p); setPlanStep('form'); }}
        onPlanClick={(id) => { setSelectedPlan(id); setPanel('plans'); }}
        onPinClick={openCard}
        onPlaceTap={(p) => { if (planStep !== null) return; setPlaceCard(p); setPanel('place'); }}
        bubbles={bubbles}
      />

      <header className="hud-top">
        <button type="button" className="chip" data-testid="btn-events" aria-label="Your events" onClick={onExit}>
          <span className="chip-dot" data-status={room.status} />
          <span className="chip-text" data-testid="event-title">
            {live ? `${room.roomName || 'Event'} · ${players.length}` : room.status === 'reconnecting' ? 'Reconnecting…' : profile ? 'Connecting…' : 'Room'}
          </span>
        </button>
        <div className="hud-actions">
          <button className="btn-icon" title="Show everyone" aria-label="Show everyone" onClick={() => mapRef.current?.fitAll()}>🔭</button>
          <button className="btn-icon" title="Settings" aria-label="Settings" data-testid="btn-settings" onClick={() => setPanel('settings')}>⚙️</button>
          <button className="btn btn-small" data-testid="btn-invite" onClick={() => setShowInvite(true)}>➕ Invite</button>
        </div>
      </header>

      {profile && <CrewStrip players={players} me={room.me} onPick={openCard} />}

      {showLegend && <Legend onClose={() => setShowLegend(false)} />}

      <div className="toasts" role="status" aria-live="polite">
        {profile && <GeoBanner error={geo.error} sharing={sharing} />}
        <Toasts
          items={toasts}
          isJoined={isJoined}
          onDismiss={dismissToast}
          onJoin={(planId, toastId) => { room.send({ t: 'plan_join', id: planId }); playSfx('imin'); setSelectedPlan(planId); dismissToast(toastId); }}
          onDecline={(planId, toastId) => { declinePlan(planId); dismissToast(toastId); }}
          onSuggest={(planId, toastId) => { setSuggestId(planId); setPanel('suggest'); dismissToast(toastId); }}
          onShow={(planId, toastId) => { showPlan(planId); dismissToast(toastId); }}
        />
      </div>

      {planStep === 'drop' ? (
        <DropBanner
          canUseMe={mePos !== null}
          onUseMe={() => { if (mePos) { setDraft({ lat: mePos.lat, lng: mePos.lng }); setPlanStep('form'); } }}
          onCancel={endPlan}
        />
      ) : planStep === 'form' ? (
        <PlanForm seed={planSeed} onCreate={createPlan} onMove={() => setPlanStep('drop')} onCancel={endPlan} />
      ) : panel === 'mood' ? (
        <MoodSheet
          current={meP?.mood ?? null}
          onShare={(c) => { room.send({ t: 'mood', mood: c.mood, emoji: c.emoji, text: c.text }); setPanel(null); }}
          onClear={() => { room.send({ t: 'mood', mood: null }); setPanel(null); }}
          onClose={() => setPanel(null)}
        />
      ) : panel === 'plans' ? (
        <PlansPanel
          plans={plans}
          players={players}
          me={room.me}
          mePos={mePos}
          selected={selectedPlan}
          canPlant={canPlant}
          onNew={startPlan}
          onJoin={(id) => { room.send({ t: 'plan_join', id }); playSfx('imin'); setSelectedPlan(id); }}
          onLeave={(id) => {
            room.send({ t: 'plan_leave', id });
            setSelectedPlan((cur) => (cur === id ? null : cur)); // no longer interested: no preview trail either
          }}
          onDecline={declinePlan}
          onSuggest={(id) => { setSuggestId(id); setPanel('suggest'); }}
          onShow={(id) => { showPlan(id); setPanel(null); }}
          onPing={(id) => room.send({ t: 'plan_ping', id })}
          onCancel={(id) => room.send({ t: 'plan_cancel', id })}
          onClose={() => setPanel(null)}
        />
      ) : panel === 'card' && cardPlayer ? (
        <PersonCard
          player={cardPlayer}
          isMe={cardPlayer.id === room.me}
          plans={plans}
          mePlayerId={room.me}
          mePos={mePos}
          now={now}
          clockOffset={room.clockOffset}
          onClose={() => setPanel(null)}
          onShowOnMap={() => { mapRef.current?.focus(cardPlayer.id); setPanel(null); }}
          onShowPlan={(id) => { showPlan(id); setPanel(null); }}
          onJoin={(id) => { room.send({ t: 'plan_join', id }); playSfx('imin'); setSelectedPlan(id); }}
          onLeave={(id) => room.send({ t: 'plan_leave', id })}
          onSave={saveMyCard}
        />
      ) : panel === 'place' && placeCard ? (
        <PlaceCard
          place={placeCard}
          mePos={mePos}
          canPlant={canPlant}
          onPlant={() => {
            setDraft({ lat: placeCard.lat, lng: placeCard.lng });
            setPlanSeed({ kind: placeCard.kind, place: placeCard.name });
            setPanel(null);
            setPlanStep('form');
          }}
          onClose={() => setPanel(null)}
        />
      ) : panel === 'suggest' && suggestId && room.plans[suggestId] ? (
        <SuggestSheet
          plan={room.plans[suggestId]}
          onSend={(place, note) => {
            room.send({ t: 'plan_suggest', id: suggestId, place, note });
            setSelectedPlan((cur) => (cur === suggestId ? null : cur));
            pushToast({ kind: 'info', emoji: '💡', text: `Idea sent: ${place}.` });
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : panel === 'settings' ? (
        <SettingsSheet
          eventName={room.roomName}
          canRename={canPlant}
          onRename={(name) => room.send({ t: 'room_name', name })}
          voice={voice}
          sfx={sfx}
          onSfx={(on) => { setSfxOn(on); setSfx(on); if (on) unlockSfx(); }}
          onVoice={(on) => { setVoiceOn(on); setVoice(on); if (on) unlockVoice(); }}
          notif={notifPhase(notifOn)}
          notifCanAsk={notifyPermission() === 'default'}
          onNotif={(on) => {
            if (!on) return void (disableNotifications(), setNotifOn(false));
            void enableNotifications().then(setNotifOn);
          }}
          awake={awake}
          awakeSupported={wakeLockSupported()}
          onAwake={(on) => { setKeepAwake(on); setAwake(on); }}
          onLegend={() => { setShowLegend(true); setPanel(null); }}
          onQuest={() => { quest.start(); setPanel('quest'); }}
          organizer={!!meP?.organizer}
          onOrganizer={changeOrganizer}
          leaveArmed={leaveArmed}
          onLeave={leaveTap}
          onClose={() => setPanel(null)}
        />
      ) : panel === 'quest' && quest.state ? (
        <QuestPanel state={quest.state} onClose={() => setPanel(null)} onRestart={quest.start} />
      ) : panel === 'talk' ? (
        <TalkSheet
          canPlant={canPlant}
          findPlace={(said) => mapRef.current?.findPlace(said, mePos ?? mapRef.current.center()) ?? null}
          onSend={(b, feeling) => {
            room.send({ t: 'bubble', emoji: b.emoji, text: b.text });
            quest.done('talk');
            feel(feeling);
            setPanel(null);
          }}
          onPlant={(p: TalkPlant, feeling) => {
            voicePlanted.current = true;
            room.send({ t: 'plan', kind: p.kind, place: p.place, note: '', lat: p.lat, lng: p.lng, ping: true });
            quest.done('talk');
            feel(feeling);
            setPanel(null);
          }}
          onDropIt={(seed) => startPlan(seed)}
          onClose={() => setPanel(null)}
        />
      ) : (
        <>
        {quest.state?.started && <QuestChip state={quest.state} onClick={() => setPanel('quest')} />}
        <section className="hud-bottom">
          {namesOpen && (
            <ul className="players">
              {players
                .slice()
                .sort((a, b) => (a.id === room.me ? -1 : b.id === room.me ? 1 : a.name.localeCompare(b.name)))
                .map((p) => (
                  <PlayerRow key={p.id} p={p} isMe={p.id === room.me} me={meP} now={now} clockOffset={room.clockOffset} onClick={() => openCard(p.id)} />
                ))}
            </ul>
          )}
          <div className="toolbar" role="toolbar" aria-label="Actions">
            <button type="button" className="tool" data-testid="btn-mood" aria-label="Mood" onClick={() => setPanel('mood')}>
              <span className="tool-icon">{meP?.mood ? moodEmoji(meP.mood) : '😋'}</span><span className="tool-label">Mood</span>
            </button>
            <FlagButton count={plans.length} canPlant={canPlant} onTap={() => setPanel('plans')} onDrop={dropFlagAt} />
            <button type="button" className="tool tool-talk" data-testid="btn-talk" aria-label="Talk to the crew" onClick={() => { setPanel('talk'); playSfx('talk'); }}>
              <span className="tool-icon">🎙</span><span className="tool-label">Talk</span>
            </button>
            <button type="button" className="tool" data-testid="btn-names" aria-label="Names" aria-pressed={namesOpen} onClick={() => setNamesOpen((v) => !v)}>
              <span className="tool-icon">👥</span><span className="tool-label">Names</span>
            </button>
            <button type="button" className="tool" data-testid="btn-share" aria-label={sharing ? 'Pause sharing' : 'Share my location'} onClick={() => setSharing(!sharing)}>
              <span className="tool-icon">{sharing ? '⏸' : '▶'}</span><span className="tool-label">{sharing ? 'Pause' : 'Share'}</span>
            </button>
          </div>
        </section>
        </>
      )}

      {showInvite && <Invite roomId={roomId} onClose={() => setShowInvite(false)} />}
    </div>
  );
}

/** What the notifications switch should say: on, off (we could, they chose not to), blocked (browser says no) or unsupported. */
function notifPhase(on: boolean): 'on' | 'off' | 'blocked' | 'unsupported' {
  const p = notifyPermission();
  if (p === 'unsupported') return 'unsupported';
  if (p === 'denied') return 'blocked';
  return on ? 'on' : 'off';
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
        <span className="player-name">{p.name}{isMe && <em> (you)</em>}{p.mood && <span className="player-mood" title={moodText(p.mood)}> {moodEmoji(p.mood)}</span>}</span>
        <span className="player-detail">{p.organizer ? 'organizer · ' : ''}{detail}{ago && p.online && p.sharing ? ` · ${ago}` : ''}{p.mood?.note ? ` · “${p.mood.note}”` : ''}</span>
      </span>
    </li>
  );
}

function rememberEvent(roomId: string, p: Profile) {
  const prev = getEvent(roomId);
  saveEvent({ id: roomId, name: prev?.name ?? '', token: prev?.token ?? null, profile: p, joinedAt: prev?.joinedAt ?? Date.now(), lastSeen: Date.now() });
}

/** Full-screen, one-tap join. Returning people just tap; new people type a name. Character is pre-picked and optional to change. */
function JoinScreen({ eventName, onJoin }: { eventName: string; onJoin: (p: Profile) => Promise<void> }) {
  const [p, setP] = useState(loadProfile);
  const [editing, setEditing] = useState(() => loadProfile().name.trim().length === 0);
  const [organizer, setOrganizer] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = p.name.trim().length > 0 && !busy;
  return (
    <div className="landing">
      <form
        className="landing-card join-screen"
        data-testid="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) {
            setBusy(true);
            void onJoin({ ...p, name: p.name.trim(), organizer });
          }
        }}
      >
        <button type="button" className="join-avatar" style={{ '--c': p.color } as CSSProperties} aria-label="Shuffle my character" title="Tap to shuffle"
          onClick={() => setP({ ...p, avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] })}>
          {p.avatar}
        </button>
        <h1>{eventName || 'Join the map'}</h1>
        <p className="tagline">Choose a name and avatar to join your crew.</p>
        {editing ? (
          <label className="field">
            <span>Your name</span>
            <input autoFocus maxLength={NAME_MAX} value={p.name} placeholder="e.g. Sam" enterKeyHint="go" autoComplete="given-name" onChange={(e) => setP({ ...p, name: e.target.value })} />
          </label>
        ) : (
          <p className="joining-as">Joining as <b>{p.name}</b> <button type="button" className="btn-link-inline" onClick={() => setEditing(true)}>change</button></p>
        )}
        <details className="customize">
          <summary>🎨 Pick a different character</summary>
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
        </details>
        <label className="organizer-check">
          <input type="checkbox" data-testid="join-organizer" checked={organizer} onChange={(e) => setOrganizer(e.target.checked)} />
          <span>⭐ I'm an organizer <em>(if anyone is, only organizers can plant flags)</em></span>
        </label>
        <button className="btn btn-big" disabled={!ok}>{busy ? 'Joining…' : '📍 Join & share my location'}</button>
        <p className="fineprint">Only people in this event see where you are, and only while the app is open. Close the app and your location is forgotten after 5 minutes. Leave and you are erased.</p>
      </form>
    </div>
  );
}

const GEO_ERROR_TEXT: Record<NonNullable<GeoError>, string> = {
  denied: 'Location permission is blocked. Allow it in your browser settings, then reload.',
  unavailable: 'Can’t get your location right now. Still trying…',
  insecure: 'Location needs a secure (https) connection. Open this room over https.',
  unsupported: 'This browser can’t share location.',
};

function GeoBanner({ error, sharing }: { error: GeoError; sharing: boolean }) {
  if (!sharing || !error) return null;
  return <div className="toast">⚠️ {GEO_ERROR_TEXT[error]}</div>;
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
  return <Message title="Room not found" body="This event has ended or the link is wrong. Events disappear after 3 hours with nobody in them." onExit={onExit} />;
}

function Message({ title, body, onExit }: { title: string; body: string; onExit?: () => void }) {
  return (
    <div className="landing">
      <div className="landing-card">
        <div className="logo">🗺️</div>
        <h1>{title}</h1>
        <p className="tagline">{body}</p>
        {onExit && <button className="btn btn-big" onClick={onExit}>Back to start</button>}
      </div>
    </div>
  );
}
