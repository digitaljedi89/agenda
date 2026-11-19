// Runs every minute on Netlify and pushes any reminder that has come due
// to every device subscribed to that record.
import { getStore } from '@netlify/blobs';
import * as webpush from 'web-push';

const GRACE_MS = 15 * 60 * 1000; // still deliver if up to 15 min late (e.g. a missed run)

export default async () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:hello@darkmatterlabs.ca' } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) { console.log('VAPID keys missing'); return; }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const store = getStore('agenda-reminders');
  const { blobs } = await store.list();
  const now = Date.now();
  let sentCount = 0;

  for (const { key } of blobs) {
    const data = await store.get(key, { type: 'json' });
    if (!data) continue;
    let subs = data.subs || (data.subscription ? [data.subscription] : []); // older records had one subscription
    const sent = new Set(data.sent || []);
    const due = [...(data.reminders || []), ...(data.feedReminders || [])].filter(r => r.at <= now + 20000 && r.at > now - GRACE_MS && !sent.has(r.id));

    if (due.length && subs.length) {
      const dead = new Set();
      for (const r of due) {
        const payload = JSON.stringify({ title: r.title, body: r.body, tag: r.item, item: r.item, at: r.at, url: `/?item=${encodeURIComponent(r.item)}` });
        for (const sub of subs) {
          if (dead.has(sub.endpoint)) continue;
          try { await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' }); sentCount++; }
          catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) dead.add(sub.endpoint); // device unsubscribed / app deleted
            else console.log('push error', e.statusCode, e.body || e.message);
          }
        }
        sent.add(r.id);
      }
      subs = subs.filter(s => !dead.has(s.endpoint));
    }
    if (!key.startsWith('u_') && !subs.length) { await store.delete(key); continue; }
    if (!due.length && data.subs) continue; // nothing changed
    const keep = (data.reminders || []).filter(r => r.at > now - 864e5);
    const keepFeed = (data.feedReminders || []).filter(r => r.at > now - 864e5);
    const keepIds = new Set([...keep, ...keepFeed].map(r => r.id));
    await store.setJSON(key, { ...data, subs, reminders: keep, feedReminders: keepFeed, sent: [...sent].filter(id => keepIds.has(id)), updated: data.updated || now });
  }
  if (sentCount) console.log(`sent ${sentCount} push(es)`);
};

export const config = { schedule: '* * * * *' };
