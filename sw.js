/* Agenda service worker — receives push alerts and opens the right item when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Agenda', body: event.data && event.data.text() }; }
  const title = data.title || 'Agenda';
  const opts = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    timestamp: data.at || Date.now(),
    data: { url: data.url || '/', item: data.item || null }
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    typeof data.badge === 'number' && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(data.badge).catch(() => {}) : null
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { url, item } = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if (item) c.postMessage({ type: 'open', item }); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url || '/');
  })());
});
