// Every 5 minutes: re-read each account's shared calendars, push "new / moved" notices,
// and compute alerts for shared events so they fire even if no device has opened Agenda.
import { getStore } from '@netlify/blobs';
import { loadFeed } from '../lib/feeds-core.mjs';
import { sendToSubs } from '../lib/push.mjs';
import { MAX_NOTICES, feedReminders, changes, when } from '../lib/poll-lib.mjs';

export default async () => {
  const feeds = getStore('agenda-feeds'), rem = getStore('agenda-reminders');
  const { blobs } = await feeds.list({ prefix: 'u_' });
  const now = Date.now();
  for (const { key } of blobs) {
    const uid = key.slice(2);
    const rec = await feeds.get(key, { type: 'json' });
    if (!rec || !rec.feeds || !rec.feeds.length) continue;
    const rrec = (await rem.get(key, { type: 'json' })) || { subs: [], reminders: [], sent: [] };
    const tz = rrec.tz || 'UTC';
    const reminders = [], notices = [];
    for (const feed of rec.feeds) {
      const c = await loadFeed(feeds, uid, feed, true);
      reminders.push(...feedReminders(feed, c.events, tz, now));
      if (c.error) continue;
      // compare with what the poller itself saw last time (independent of the app's cache)
      const seenKey = `seen_${uid}_${feed.id}`;
      const seen = await feeds.get(seenKey, { type: 'json' });
      const slim = c.events.map(e => ({ uid: e.uid, id: e.id, title: e.title, start: e.start || null, date: e.date || null, allDay: e.allDay }));
      if (seen && feed.notify !== false) notices.push(...changes(seen.events || [], slim, now, tz).map(n => ({ ...n, feed })));
      await feeds.setJSON(seenKey, { at: now, events: slim });
    }
    const dead = new Set();
    let subs = rrec.subs || [];
    if (notices.length && subs.length) {
      const send = notices.length > MAX_NOTICES
        ? [{ title: notices[0].feed.name, body: `${notices.length} new or changed events`, tag: 'feed-' + notices[0].feed.id, url: '/' }]
        : notices.map(n => ({ title: n.e.title, body: `${n.kind === 'new' ? 'New on' : 'Moved on'} ${n.feed.name} · ${when(n.e, tz)}${n.repeats ? ' · repeats' : ''}`, tag: 'feed:' + n.e.id, item: 'feed:' + n.e.id, url: `/?item=${encodeURIComponent('feed:' + n.e.id)}` }));
      for (const p of send) { const r = await sendToSubs(subs.filter(s => !dead.has(s.endpoint)), p, { TTL: 86400, urgency: 'normal' }); r.dead.forEach(d => dead.add(d)); }
    }
    const fresh = (await rem.get(key, { type: 'json' })) || rrec; // re-read: a device may have saved meanwhile
    await rem.setJSON(key, { ...fresh, subs: (fresh.subs || []).filter(s => !dead.has(s.endpoint)), feedReminders: reminders.slice(0, 600), feedsAt: now });
  }
};

export const config = { schedule: '*/5 * * * *' };
