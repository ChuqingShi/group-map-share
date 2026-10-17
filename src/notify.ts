// Notifications for the event you are in. Browsers cannot time-limit a permission, so the app
// only ever uses it while you are inside an event: leaving clears what is on screen, and the
// switch below turns it off for good. These are local notifications (the page is still alive,
// just in the background); alerts with the app fully closed would need a push service.
import { store } from './safeStorage.ts';

const KEY = 'gms-notify';

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

export const notifyPermission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported');

/** Permission granted and not switched off by the person. */
export const notifyEnabled = () => notifyPermission() === 'granted' && store.get(KEY) !== 'off';

/** Ask for permission (call from a tap) and switch notifications on. Resolves true when they are on. */
export async function enableNotifications(): Promise<boolean> {
  if (!notifySupported()) return false;
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p === 'granted') store.set(KEY, 'on');
  return p === 'granted';
}

export const disableNotifications = () => store.set(KEY, 'off');

/** Show a notification, but only when the app is in the background; in the foreground the toast does the job. */
export async function showLocal(title: string, body: string, opts: { tag?: string; url: string }): Promise<boolean> {
  if (!notifyEnabled() || document.visibilityState === 'visible') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag: opts.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: opts.url } });
    return true;
  } catch {
    return false;
  }
}

/** Remove anything still showing, for example when you leave the event. */
export async function clearNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    (await reg?.getNotifications())?.forEach((n) => n.close());
  } catch { /* nothing to clear */ }
}
