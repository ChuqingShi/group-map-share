// Service worker for Group Map Share. Its only job is notifications: it never caches anything,
// so a new deploy is never served stale. Tapping a notification brings the event back up.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = windows.find((c) => new URL(c.url).pathname === target.pathname);
      if (same) return same.focus();
      if (windows[0]) {
        try {
          await windows[0].focus();
          return await windows[0].navigate(target.href);
        } catch { /* fall through to a new window */ }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
