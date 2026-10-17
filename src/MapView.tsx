import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Player } from '../shared/protocol.ts';
import { gameStyle, installPatterns } from './mapStyle.ts';

export interface MapHandle {
  fitAll(): void;
  focus(id: string): void;
}

interface Props {
  players: Player[];
  me: string | null;
  ref?: Ref<MapHandle>;
}

interface Tracked {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  from: [number, number];
  to: [number, number];
  start: number;
}

// MapLibre 6 looks for its worker next to its own module; once bundled that
// path no longer exists, so point it at the copy Vite emits.
maplibregl.setWorkerUrl(workerUrl);

const GLIDE_MS = 900;
const ease = (t: number) => 1 - (1 - t) ** 3;

function pinElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML =
    '<div class="pin-label"><span class="pin-you">YOU</span><span class="pin-name"></span></div>' +
    '<div class="pin-body"><span class="pin-avatar"></span></div>' +
    '<div class="pin-shadow"></div>';
  return el;
}

function renderPin(el: HTMLDivElement, p: Player, isMe: boolean) {
  el.style.setProperty('--c', p.color);
  el.classList.toggle('is-me', isMe);
  el.classList.toggle('is-offline', !p.online);
  // textContent, never innerHTML: names are untrusted input.
  el.querySelector('.pin-name')!.textContent = p.name;
  el.querySelector('.pin-avatar')!.textContent = p.avatar;
  el.style.zIndex = isMe ? '2' : '1';
}

export default function MapView({ players, me, ref }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tracked = useRef(new Map<string, Tracked>());
  const centred = useRef(false);
  const playersRef = useRef(players);
  playersRef.current = players;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: gameStyle(),
      center: [0, 20],
      zoom: 1.5,
      pitch: 0,
      maxPitch: 60,
      attributionControl: { compact: true },
    });
    installPatterns(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    mapRef.current = map;
    // Compact attribution starts expanded; fold it so it doesn't cover the HUD on phones.
    map.once('load', () => containerRef.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

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
      tracked.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers with players.
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
        const el = pinElement();
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(target).addTo(map);
        t = { marker, el, from: target, to: target, start: 0 };
        tracked.current.set(p.id, t);
      } else if (t.to[0] !== target[0] || t.to[1] !== target[1]) {
        const cur = t.marker.getLngLat();
        t.from = [cur.lng, cur.lat];
        t.to = target;
        t.start = performance.now();
      }
      renderPin(t.el, p, p.id === me);
    }
    for (const [id, t] of tracked.current) {
      if (!seen.has(id)) {
        t.marker.remove();
        tracked.current.delete(id);
      }
    }

    // First time anybody (preferably me) has a position, swoop in.
    if (!centred.current) {
      const target = players.find((p) => p.id === me && p.pos) ?? players.find((p) => p.pos);
      if (target?.pos) {
        centred.current = true;
        map.flyTo({ center: [target.pos.lng, target.pos.lat], zoom: 16.5, pitch: 45, duration: 2200 });
      }
    }
  }, [players, me]);

  useImperativeHandle(ref, () => ({
    fitAll() {
      const map = mapRef.current;
      const pts = playersRef.current.filter((p) => p.pos).map((p) => [p.pos!.lng, p.pos!.lat] as [number, number]);
      if (!map || pts.length === 0) return;
      if (pts.length === 1) return void map.flyTo({ center: pts[0], zoom: 16.5 });
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((pt) => b.extend(pt));
      map.fitBounds(b, { padding: { top: 120, bottom: 220, left: 60, right: 60 }, maxZoom: 17.5, duration: 1200 });
    },
    focus(id) {
      const p = playersRef.current.find((x) => x.id === id);
      if (p?.pos) mapRef.current?.flyTo({ center: [p.pos.lng, p.pos.lat], zoom: Math.max(mapRef.current.getZoom(), 17), duration: 1200 });
    },
  }), []);

  return <div ref={containerRef} className="map" />;
}
