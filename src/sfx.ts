// Cute sound effects. Web Audio, lazily fetched and cached, never throws, silent when off or locked.
import { store } from './safeStorage.ts';

export type SfxName = 'join' | 'ping' | 'bubble' | 'plant' | 'mood' | 'imin' | 'talk' | 'decline' | 'leave';

const KEY = 'gms-sfx';
const GAIN = 0.5;
export const SFX_MIN_GAP_MS = 150;

export const sfxOn = (): boolean => store.get(KEY) !== 'off';
export const setSfxOn = (on: boolean) => store.set(KEY, on ? 'on' : 'off');

/** Pure throttle: may a sound that last started at `last` (or undefined) start at `now`? */
export const sfxAllowed = (last: number | undefined, now: number, gap = SFX_MIN_GAP_MS): boolean =>
  last === undefined || now - last >= gap;

let ctx: AudioContext | null = null;
const buffers = new Map<SfxName, Promise<AudioBuffer | null>>();
const lastPlay = new Map<SfxName, number>();

const Ctor = (): typeof AudioContext | undefined => {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return g.AudioContext ?? g.webkitAudioContext;
};

/** Call from a user gesture: browsers only let audio start after one. */
export function unlockSfx() {
  try {
    if (!ctx) {
      const C = Ctor();
      if (!C) return;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    /* no sound, no problem */
  }
}

function load(name: SfxName, c: AudioContext): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    p = fetch(`/sfx/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((b) => c.decodeAudioData(b))
      .catch(() => {
        buffers.delete(name); // try again next time
        return null;
      });
    buffers.set(name, p);
  }
  return p;
}

export function playSfx(name: SfxName) {
  try {
    if (!sfxOn() || !ctx || ctx.state !== 'running') return;
    const now = Date.now();
    if (!sfxAllowed(lastPlay.get(name), now)) return;
    lastPlay.set(name, now);
    const c = ctx;
    void load(name, c).then((buf) => {
      try {
        if (!buf || c.state !== 'running') return;
        const src = c.createBufferSource();
        const gain = c.createGain();
        gain.gain.value = GAIN;
        src.buffer = buf;
        src.connect(gain).connect(c.destination);
        src.start();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* never throws */
  }
}
