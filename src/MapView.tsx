import { useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore, type Ref } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map-extras.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PLAN_EMOJI, type Plan, type Player } from '../shared/protocol.ts';
import { gameStyle, installPatterns } from './mapStyle.ts';
import { fallbackView } from './startLocation.ts';
import { KIND_LABEL, moodEmoji, moodText } from './meetup.ts';
import { findByName, nearestPoi, poiKind, toFound, type FoundPlace, type Poi } from './places.ts';
import {
  DOT_RADIUS_STOPS,
  DOT_RING_PX,
  dotSpacingPx,
  dotsAlong,
  metresPerPixel,
  treasureTrails,
  type TrailCollection,
} from './treasure.ts';
import type { LatLng } from './geo.ts';

/** A short thought bubble over a player's pin. The caller decides when it expires; this just draws what it is given. */
export interface Bubble {
  emoji: string;
  text: string;
  at: number;
}

export interface MapHandle {
  fitAll(): void;
  focus(id: string): void;
  /** Fly to a plan. If I have a position, frame both of us so my trail is in view. */
  focusPlan(id: string): void;
  focusPoint(p: LatLng): void;
  /** Where the map is looking right now. */
  center(): LatLng;
  /** The map position under a screen point (for dragging a flag onto the map), or null if the point is not over the map. */
  unprojectClient(clientX: number, clientY: number): LatLng | null;
  /** The named place (restaurant, bar...) within `radiusM` of a point, from the map data already on screen. */
  nearestPlace(p: LatLng, radiusM?: number): FoundPlace | null;
  /** A place whose name matches what was said, nearest to `near`, from the map data already on screen. */
  findPlace(said: string, near: LatLng, maxM?: number): FoundPlace | null;
}

/** Named points of interest in the vector tiles the map has loaded around the view (no network, nothing sent anywhere). */
function loadedPois(map: maplibregl.Map): Poi[] {
  if (!map.getSource('omt')) return [];
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const f of map.querySourceFeatures('omt', { sourceLayer: 'poi' })) {
    const name = String(f.properties?.['name:en'] ?? f.properties?.name ?? '').trim();
    const g = f.geometry;
    if (!name || g.type !== 'Point') continue;
    const [lng, lat] = g.coordinates;
    const key = `${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`; // the same place shows up once per tile it touches
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat, lng, cls: String(f.properties?.class ?? ''), subclass: f.properties?.subclass ? String(f.properties.subclass) : undefined });
  }
  return out;
}

interface Props {
  players: Player[];
  me: string | null;
  /** Where to open the map (the user's location); null falls back to a time-zone-based world view. */
  start: LatLng | null;
  ref?: Ref<MapHandle>;
  plans: Plan[];
  /** Plan whose preview trail from me should show. */
  selectedPlan: string | null;
  /** Ghost X while the user is choosing a spot. */
  draft: LatLng | null;
  /** While true, the next tap on the map calls onDrop. */
  dropping: boolean;
  onDrop(p: LatLng): void;
  onPlanClick(id: string): void;
  /** Someone tapped a person's pin. */
  onPinClick(playerId: string): void;
  /** Someone tapped a restaurant, cafe or bar on the map (not while choosing a spot for a flag). */
  onPlaceTap(place: FoundPlace): void;
  /** Keyed by player id. */
  bubbles: Record<string, Bubble>;
}

interface Tracked {
  marker: maplibregl.Marker;
  pin: PinParts;
  from: [number, number];
  to: [number, number];
  start: number;
}

// MapLibre 6 looks for its worker next to its own module; once bundled that
// path no longer exists, so point it at the copy Vite emits.
maplibregl.setWorkerUrl(workerUrl);

const GLIDE_MS = 900;
const ease = (t: number) => 1 - (1 - t) ** 3;

/** Space the HUD takes at the top and bottom of the map, so framed things stay clear of it. */
const HUD_TOP = 150;
const HUD_BOTTOM = 190;
/** A finger or mouse that moved further than this between down and up was panning, not tapping. */
const TAP_SLOP_PX = 6;

const INK = '#1d2433';
const RED = '#c8452d';

/** Only touch the DOM when the text really changed. */
function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// --- player pins -------------------------------------------------------------

interface PinParts {
  el: HTMLDivElement;
  body: HTMLElement;
  name: HTMLElement;
  avatar: HTMLElement;
  thought: { el: HTMLElement; emoji: HTMLElement; text: HTMLElement; at: number } | null;
  mood: HTMLElement | null;
}

function createPin(playerId: string): PinParts {
  const el = document.createElement('div');
  el.className = 'pin';
  el.dataset.playerId = playerId;
  el.innerHTML =
    '<div class="pin-label"><span class="pin-you">YOU</span><span class="pin-name"></span></div>' +
    '<div class="pin-body"><span class="pin-avatar"></span></div>' +
    '<div class="pin-shadow"></div>';
  return {
    el,
    body: el.querySelector<HTMLElement>('.pin-body')!,
    name: el.querySelector<HTMLElement>('.pin-name')!,
    avatar: el.querySelector<HTMLElement>('.pin-avatar')!,
    thought: null,
    mood: null,
  };
}

function createThought(at: number): NonNullable<PinParts['thought']> {
  const el = document.createElement('div');
  el.className = 'pin-thought';
  el.dataset.testid = 'thought';
  el.innerHTML = '<span class="pin-thought-emoji"></span><span class="pin-thought-text"></span>';
  return { el, emoji: el.querySelector<HTMLElement>('.pin-thought-emoji')!, text: el.querySelector<HTMLElement>('.pin-thought-text')!, at };
}

function renderPin(pin: PinParts, p: Player, isMe: boolean, bubble: Bubble | undefined) {
  const { el } = pin;
  el.style.setProperty('--c', p.color);
  el.classList.toggle('is-me', isMe);
  el.classList.toggle('is-offline', !p.online);
  // textContent, never innerHTML: names, moods and bubbles are untrusted input.
  setText(pin.name, p.name);
  setText(pin.avatar, p.avatar);
  // Anyone with a bubble floats above the crowd so the cloud is never hidden under another pin.
  el.style.zIndex = bubble ? '6' : isMe ? '4' : '1';

  const badge = p.mood ? moodEmoji(p.mood) : undefined;
  if (p.mood && badge) {
    if (!pin.mood) {
      pin.mood = document.createElement('span');
      pin.mood.className = 'pin-mood';
      pin.mood.dataset.testid = 'pin-mood';
      pin.mood.setAttribute('role', 'img');
      pin.body.append(pin.mood);
    }
    setText(pin.mood, badge);
    setAttr(pin.mood, 'aria-label', `${moodText(p.mood)}${p.mood.note ? `: ${p.mood.note}` : ''}`);
  } else if (pin.mood) {
    pin.mood.remove();
    pin.mood = null;
  }

  if (bubble) {
    // A new bubble (new `at`) gets a fresh element so the pop-in plays again; an edit just updates the text.
    if (!pin.thought || pin.thought.at !== bubble.at) {
      pin.thought?.el.remove();
      pin.thought = createThought(bubble.at);
      el.prepend(pin.thought.el);
    }
    setText(pin.thought.emoji, bubble.emoji);
    setText(pin.thought.text, bubble.text);
  } else if (pin.thought) {
    pin.thought.el.remove();
    pin.thought = null;
  }
}

// --- X marks -----------------------------------------------------------------

// Two crossed bars: an ink outline pass, the red pass on top, and a cream highlight along the upper edge of the top arms.
const X_SVG =
  '<svg class="xmark-svg" viewBox="0 0 40 40" aria-hidden="true" focusable="false">' +
  '<path class="xmark-ink" d="M8 8L32 32M32 8L8 32"/>' +
  '<path class="xmark-fill" d="M8 8L32 32M32 8L8 32"/>' +
  '<path class="xmark-shine" d="M12.7 9.3L18.7 15.3M27.3 9.3L21.3 15.3"/>' +
  '</svg>';

function xmarkElement(draft: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = draft ? 'xmark is-draft' : 'xmark';
  el.innerHTML = draft
    ? `<div class="xmark-cross">${X_SVG}</div>`
    : '<div class="xmark-tag"><span class="xmark-emoji"></span><span class="xmark-name"></span></div>' +
      `<div class="xmark-cross">${X_SVG}</div>` +
      '<span class="xmark-count" data-testid="plan-count"></span>';
  return el;
}

interface PlanMark {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  emoji: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
  dispose(): void;
}

function createPlanMark(planId: string, onActivate: (id: string) => void): PlanMark {
  const el = xmarkElement(false);
  el.dataset.planId = planId;
  el.dataset.testid = 'plan-x';
  el.setAttribute('role', 'button');
  el.tabIndex = 0;

  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onClick = (e: MouseEvent) => {
    // The X sits on top of the map: a tap on it must not also be a tap on the map (drop mode).
    e.stopPropagation();
    // A pan that happens to start and end on the X is not a tap. Synthetic clicks (detail 0) always count.
    const panned = e.detail > 0 && down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX;
    down = null;
    if (!panned) onActivate(planId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onActivate(planId);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' });
  return {
    marker,
    el,
    emoji: el.querySelector<HTMLElement>('.xmark-emoji')!,
    name: el.querySelector<HTMLElement>('.xmark-name')!,
    count: el.querySelector<HTMLElement>('.xmark-count')!,
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKey);
      marker.remove();
    },
  };
}

function renderPlanMark(x: PlanMark, plan: Plan, selected: boolean, joined: boolean) {
  setText(x.emoji, PLAN_EMOJI[plan.kind] ?? PLAN_EMOJI.meetup);
  setText(x.name, plan.place);
  setText(x.count, String(plan.joined.length));
  setAttr(x.el, 'aria-label', `${KIND_LABEL[plan.kind] ?? KIND_LABEL.meetup} at ${plan.place}, ${plan.joined.length} going`);
  x.el.classList.toggle('is-selected', selected);
  x.el.classList.toggle('is-joined', joined);
}

// --- treasure trails ---------------------------------------------------------

const TRAIL_SRC = 'treasure';
const DOT_SRC = 'treasure-dots';
const RAIL_LAYER = 'treasure-casing';
const DOT_LAYER = 'treasure-dots';
const NO_TRAILS: TrailCollection = { type: 'FeatureCollection', features: [] };

/** The marching dots cycle through this many positions, one every DOT_STEP_MS. */
const DOT_STEPS = 12;
const DOT_STEP_MS = 90;
/** All trails together share this many dots, so 30 people heading for 5 flags stay cheap on a mid-range phone. */
const TOTAL_DOT_BUDGET = 1_200;
/** Past this many trails the dots stop marching (they still show) rather than hammer the map. */
const MAX_ANIMATED_TRAILS = 40;

const previewOpacity = ['case', ['get', 'preview'], 0.55, 1] as never;
const dotRadiusExpr = ['interpolate', ['linear'], ['zoom'], ...DOT_RADIUS_STOPS.flat()] as never;

interface TrailLayer {
  setTrails(t: TrailCollection): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

/**
 * Owns the `treasure` source (the curved lines), the faint ink rail drawn along them, and the red dots
 * that march from each person toward the X. The dots live in their own source because they are laid out
 * in JS: zero-length round-cap dashes always leave a stationary dot behind, so an animated dasharray cannot
 * give a single clean train (see treasure.ts). Everything is re-added if the style is ever reloaded.
 */
function createTrailLayer(map: maplibregl.Map): TrailLayer {
  let trails = NO_TRAILS;
  let key = '';
  let reduced = false;
  let step = 0;
  let raf = 0;
  let ready = false;

  const source = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  const dotData = () => {
    const zoom = map.getZoom();
    const phase = reduced ? 0 : step / DOT_STEPS;
    const px = dotSpacingPx(zoom);
    const budget = Math.max(24, Math.floor(TOTAL_DOT_BUDGET / Math.max(1, trails.features.length)));
    return {
      type: 'FeatureCollection' as const,
      features: trails.features.flatMap((f) => {
        const spacingM = px * metresPerPixel(zoom, f.geometry.coordinates[0][1]);
        return dotsAlong(f.geometry.coordinates, spacingM, phase, budget).map((coordinates) => ({
          type: 'Feature' as const,
          properties: { preview: f.properties.preview },
          geometry: { type: 'Point' as const, coordinates },
        }));
      }),
    };
  };

  const paintDots = () => source(DOT_SRC)?.setData(dotData());

  const ensure = () => {
    if (!source(TRAIL_SRC)) map.addSource(TRAIL_SRC, { type: 'geojson', data: trails });
    if (!source(DOT_SRC)) map.addSource(DOT_SRC, { type: 'geojson', data: dotData() });
    if (map.getLayer(RAIL_LAYER) && map.getLayer(DOT_LAYER)) return;
    // Under the labels if the style has any, so street names stay readable; otherwise on top.
    const before = map.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
    if (!map.getLayer(RAIL_LAYER)) {
      map.addLayer(
        {
          id: RAIL_LAYER,
          type: 'line',
          source: TRAIL_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': INK,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 3.2, 19, 4.4],
            'line-opacity': ['case', ['get', 'preview'], 0.12, 0.3],
          },
        },
        before,
      );
    }
    if (!map.getLayer(DOT_LAYER)) {
      map.addLayer(
        {
          id: DOT_LAYER,
          type: 'circle',
          source: DOT_SRC,
          paint: {
            'circle-color': RED,
            'circle-radius': dotRadiusExpr,
            'circle-stroke-color': INK,
            'circle-stroke-width': DOT_RING_PX,
            'circle-opacity': previewOpacity,
            'circle-stroke-opacity': previewOpacity,
          },
        },
        before,
      );
    }
  };

  // Only touch the map when the step actually changed (about 11 times a second, and only with trails on screen).
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Crowded maps march at half speed: fewer updates sent to the map worker.
    const stepMs = trails.features.length > 10 ? DOT_STEP_MS * 2 : DOT_STEP_MS;
    const next = Math.floor(now / stepMs) % DOT_STEPS;
    if (next === step) return;
    step = next;
    paintDots();
  };
  const syncMotion = () => {
    const run = !reduced && trails.features.length > 0 && trails.features.length <= MAX_ANIMATED_TRAILS;
    if (run && !raf) raf = requestAnimationFrame(frame);
    else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  // `style.load` fires as soon as the style itself is parsed; `load` only after the first tiles arrive, which
  // never happens while offline. Either is enough, and ensure() is safe to run twice.
  const onReady = () => {
    ready = true;
    ensure();
  };
  const onStyleData = () => {
    if (ready && !map.getLayer(DOT_LAYER)) ensure();
  };
  // Dot spacing is in screen pixels, so it has to be re-laid when the zoom settles.
  const onZoomEnd = () => paintDots();
  map.on('style.load', onReady);
  map.on('load', onReady);
  map.on('styledata', onStyleData);
  map.on('zoomend', onZoomEnd);
  if (map.isStyleLoaded()) onReady();

  return {
    setTrails(next) {
      const nextKey = JSON.stringify(next);
      if (nextKey === key) return;
      key = nextKey;
      trails = next;
      source(TRAIL_SRC)?.setData(next);
      paintDots();
      syncMotion();
    },
    setReducedMotion(next) {
      if (next === reduced) return;
      reduced = next;
      step = 0;
      paintDots();
      syncMotion();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      map.off('style.load', onReady);
      map.off('load', onReady);
      map.off('styledata', onStyleData);
      map.off('zoomend', onZoomEnd);
    },
  };
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

// --- camera helpers ----------------------------------------------------------

/** HUD padding, shrunk on very short screens (landscape phones) so fitBounds still has room to work. */
function hudPadding(map: maplibregl.Map): maplibregl.PaddingOptions {
  const k = Math.min(1, (map.getContainer().clientHeight * 0.6) / (HUD_TOP + HUD_BOTTOM));
  return { top: HUD_TOP * k, bottom: HUD_BOTTOM * k, left: 60, right: 60 };
}

/** Fly to a point, then keep it in the clear middle between the HUD bars. */
function flyToClear(map: maplibregl.Map, lngLat: [number, number]) {
  map.flyTo({
    center: lngLat,
    zoom: Math.min(17.5, Math.max(map.getZoom(), 16.5)),
    offset: [0, (HUD_TOP - HUD_BOTTOM) / 2],
    duration: 1200,
  });
}

// --- the map -----------------------------------------------------------------

export default function MapView({ players, me, start, ref, plans, selectedPlan, draft, dropping, onDrop, onPlanClick, onPinClick, onPlaceTap, bubbles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tracked = useRef(new Map<string, Tracked>());
  const planMarks = useRef(new Map<string, PlanMark>());
  const draftMark = useRef<maplibregl.Marker | null>(null);
  const trailLayer = useRef<TrailLayer | null>(null);
  const centred = useRef(false);
  // Latest props for handlers that are registered only once.
  const playersRef = useRef(players);
  playersRef.current = players;
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const meRef = useRef(me);
  meRef.current = me;
  const startRef = useRef(start);
  startRef.current = start;
  const droppingRef = useRef(dropping);
  droppingRef.current = dropping;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onPlanClickRef = useRef(onPlanClick);
  onPlanClickRef.current = onPlanClick;
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const onPlaceTapRef = useRef(onPlaceTap);
  onPlaceTapRef.current = onPlaceTap;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: gameStyle(),
      ...(start ? { center: [start.lng, start.lat] as [number, number], zoom: 16, pitch: 45 } : { ...fallbackView(), pitch: 0 }),
      maxPitch: 60,
      attributionControl: { compact: true },
    });
    installPatterns(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    mapRef.current = map;
    // Compact attribution starts expanded; fold it so it doesn't cover the HUD on phones.
    map.once('load', () => containerRef.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

    // One click handler for the life of the map; it reads the latest dropping/onDrop from refs.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!droppingRef.current) {
        // Not choosing a spot: a tap on an eat-or-drink dot opens that place's card. About a thumb's width of slack.
        if ((e.originalEvent.target as Element | null)?.closest?.('.maplibregl-marker, .maplibregl-ctrl')) return;
        const mPerPx = (78_271.5 * Math.cos((e.lngLat.lat * Math.PI) / 180)) / 2 ** map.getZoom();
        const eats = loadedPois(map).filter((p) => poiKind(p.cls, p.subclass, 12) !== 'meetup');
        const poi = nearestPoi(eats, { lat: e.lngLat.lat, lng: e.lngLat.lng }, Math.min(60, Math.max(12, 36 * mPerPx)));
        if (poi) onPlaceTapRef.current(toFound(poi, new Date().getHours()));
        return;
      }
      // Belt and braces: the X also stops its own click from bubbling here.
      if ((e.originalEvent.target as Element | null)?.closest?.('.xmark')) return;
      onDropRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on('click', onMapClick);

    trailLayer.current = createTrailLayer(map);

    let raf = 0;
    const tick = (now: number) => {
      for (const t of tracked.current.values()) {
        const k = Math.min(1, (now - t.start) / GLIDE_MS);
        if (k >= 1 && t.from === t.to) continue;
        const e = ease(k);
        t.marker.setLngLat([t.from[0] + (t.to[0] - t.from[0]) * e, t.from[1] + (t.to[1] - t.from[1]) * e]);
        if (k >= 1) t.from = t.to;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.off('click', onMapClick);
      trailLayer.current?.dispose();
      trailLayer.current = null;
      for (const t of tracked.current.values()) t.marker.remove();
      tracked.current.clear();
      for (const x of planMarks.current.values()) x.dispose();
      planMarks.current.clear();
      draftMark.current?.remove();
      draftMark.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync pins with players: position, look, mood badge and thought bubble.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const p of players) {
      if (!p.pos) continue;
      seen.add(p.id);
      const target: [number, number] = [p.pos.lng, p.pos.lat];
      let t = tracked.current.get(p.id);
      if (!t) {
        const pin = createPin(p.id);
        const pinOf = p.id;
        pin.el.addEventListener('click', (e) => {
          e.stopPropagation(); // a tap on a person is not a tap on the map
          onPinClickRef.current(pinOf);
        });
        const marker = new maplibregl.Marker({ element: pin.el, anchor: 'bottom' }).setLngLat(target).addTo(map);
        t = { marker, pin, from: target, to: target, start: 0 };
        tracked.current.set(p.id, t);
      } else if (t.to[0] !== target[0] || t.to[1] !== target[1]) {
        const cur = t.marker.getLngLat();
        t.from = [cur.lng, cur.lat];
        t.to = target;
        t.start = performance.now();
      }
      renderPin(t.pin, p, p.id === me, Object.hasOwn(bubbles, p.id) ? bubbles[p.id] : undefined);
    }
    for (const [id, t] of tracked.current) {
      if (!seen.has(id)) {
        t.marker.remove();
        tracked.current.delete(id);
      }
    }

    // Swoop to my first live fix. Without a start location, settle for whoever shows up first.
    if (!centred.current) {
      const target = players.find((p) => p.id === me && p.pos) ?? (start ? undefined : players.find((p) => p.pos));
      if (target?.pos) {
        centred.current = true;
        map.flyTo({ center: [target.pos.lng, target.pos.lat], zoom: 16.5, pitch: 45, duration: 2200 });
      }
    }
  }, [players, me, start, bubbles]);

  // One X per plan; add, update in place and remove as plans come and go.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const marks = planMarks.current;
    const seen = new Set<string>();
    for (const plan of plans) {
      seen.add(plan.id);
      let x = marks.get(plan.id);
      if (!x) {
        x = createPlanMark(plan.id, (id) => onPlanClickRef.current(id));
        x.marker.setLngLat([plan.lng, plan.lat]).addTo(map);
        marks.set(plan.id, x);
      } else {
        const at = x.marker.getLngLat();
        if (at.lng !== plan.lng || at.lat !== plan.lat) x.marker.setLngLat([plan.lng, plan.lat]);
      }
      renderPlanMark(x, plan, plan.id === selectedPlan, me !== null && plan.joined.includes(me));
    }
    for (const [id, x] of marks) {
      if (!seen.has(id)) {
        x.dispose();
        marks.delete(id);
      }
    }
  }, [plans, me, selectedPlan]);

  // The ghost X while someone is choosing a spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!draft) {
      draftMark.current?.remove();
      draftMark.current = null;
      return;
    }
    if (!draftMark.current) {
      const el = xmarkElement(true);
      el.dataset.testid = 'plan-draft';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Spot you are choosing');
      draftMark.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([draft.lng, draft.lat]).addTo(map);
    } else {
      draftMark.current.setLngLat([draft.lng, draft.lat]);
    }
  }, [draft]);

  // Drop mode: crosshair cursor (the click handler itself is registered once, above).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.classList.toggle('is-dropping', dropping);
    return () => el.classList.remove('is-dropping');
  }, [dropping]);

  // Treasure trails. Declared in this order so motion is settled before the first trails arrive.
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    trailLayer.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  const trails = useMemo(() => treasureTrails(players, plans, me, selectedPlan), [players, plans, me, selectedPlan]);
  useEffect(() => {
    containerRef.current?.setAttribute('data-paths', String(trails.features.length));
    trailLayer.current?.setTrails(trails);
  }, [trails]);

  useImperativeHandle(ref, () => ({
    unprojectClient(x, y) {
      const map = mapRef.current;
      const box = containerRef.current?.getBoundingClientRect();
      if (!map || !box || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      const ll = map.unproject([x - box.left, y - box.top]);
      return { lat: ll.lat, lng: ll.lng };
    },
    nearestPlace(p, radiusM = 40) {
      const map = mapRef.current;
      const poi = map && nearestPoi(loadedPois(map), p, radiusM);
      return poi ? toFound(poi, new Date().getHours()) : null;
    },
    findPlace(said, near, maxM = 3000) {
      const map = mapRef.current;
      const poi = map && findByName(loadedPois(map), said, near, maxM);
      return poi ? toFound(poi, new Date().getHours()) : null;
    },
    fitAll() {
      const map = mapRef.current;
      // Everyone and every flag, so all the treasure trails fit on screen with their X.
      const pts = [
        ...playersRef.current.filter((p) => p.pos).map((p) => [p.pos!.lng, p.pos!.lat] as [number, number]),
        ...plansRef.current.map((p) => [p.lng, p.lat] as [number, number]),
      ];
      if (!map || pts.length === 0) return;
      if (pts.length === 1) return void map.flyTo({ center: pts[0], zoom: 16.5 });
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((pt) => b.extend(pt));
      map.fitBounds(b, { padding: { top: 150, bottom: 190, left: 60, right: 60 }, maxZoom: 17.5, duration: 1200 });
    },
    focus(id) {
      const p = playersRef.current.find((x) => x.id === id);
      if (p?.pos) mapRef.current?.flyTo({ center: [p.pos.lng, p.pos.lat], zoom: Math.max(mapRef.current.getZoom(), 17), duration: 1200 });
    },
    focusPlan(id) {
      const map = mapRef.current;
      const plan = plansRef.current.find((x) => x.id === id);
      if (!map || !plan) return;
      const target: [number, number] = [plan.lng, plan.lat];
      const mine = playersRef.current.find((x) => x.id === meRef.current)?.pos;
      if (!mine) return flyToClear(map, target);
      const b = new maplibregl.LngLatBounds(target, target);
      b.extend([mine.lng, mine.lat]);
      map.fitBounds(b, { padding: hudPadding(map), maxZoom: 17.5, duration: 1200 });
    },
    focusPoint(p) {
      const map = mapRef.current;
      if (map) flyToClear(map, [p.lng, p.lat]);
    },
    center() {
      const c = mapRef.current?.getCenter();
      return c ? { lat: c.lat, lng: c.lng } : (startRef.current ?? { lat: 0, lng: 0 });
    },
  }), []);

  return <div ref={containerRef} className="map" />;
}
