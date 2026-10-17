// Keeps the screen on while you are sharing in an event, so the browser keeps sending your
// location (phones stop it when the screen locks). It only works while the app is on screen;
// background location needs a native app. On by default, switchable per device.
import { useEffect } from 'react';
import { store } from './safeStorage.ts';

const KEY = 'gms-awake';

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export const keepAwakeOn = () => store.get(KEY) !== 'off';
export const setKeepAwake = (on: boolean) => store.set(KEY, on ? 'on' : 'off');

export function useKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active || !wakeLockSupported()) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    let pending = false; // a request is in flight: do not start a second one and lose the first lock
    const acquire = async () => {
      if (lock || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const l = await navigator.wakeLock.request('screen');
        pending = false;
        if (cancelled) return void l.release().catch(() => {});
        lock = l;
        l.addEventListener('release', () => {
          if (lock === l) lock = null;
        });
      } catch {
        pending = false; /* denied (battery saver, hidden tab): we simply do not hold the screen */
      }
    };
    // The browser drops the lock whenever the page is hidden, so take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}
