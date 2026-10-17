// Keeps the screen on while you are sharing in an event, so the browser keeps sending your
// location (phones stop it when the screen locks). It only works while the app is on screen;
// background location needs a native app. On by default, switchable per device.
import { useEffect } from 'react';

const KEY = 'gms-awake';

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export const keepAwakeOn = () => localStorage.getItem(KEY) !== 'off';
export const setKeepAwake = (on: boolean) => localStorage.setItem(KEY, on ? 'on' : 'off');

export function useKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active || !wakeLockSupported()) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (lock || document.visibilityState !== 'visible') return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) return void l.release().catch(() => {});
        lock = l;
        l.addEventListener('release', () => {
          if (lock === l) lock = null;
        });
      } catch { /* denied (low battery saver, hidden tab): we simply do not hold the screen */ }
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
