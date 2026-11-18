// Runs every minute on Netlify and pushes any reminder that has come due.
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
    if (!data || !data.subscription) continue;
    const sent = new Set(data.sent || []);
    const due = (data.reminders || []).filter(r => r.at <= now + 20000 && r.at > now - GRACE_MS && !sent.has(r.id));
    if (!due.length) continue;

    let gone = false;
    for (const r of due) {
      try {
        await webpush.sendNotification(data.subscription, JSON.stringify({
          title: r.title, body: r.body, tag: r.item, item: r.item, at: r.at, url: `/?item=${encodeURIComponent(r.item)}`
        }), { TTL: 3600, urgency: 'high' });
        sent.add(r.id); sentCount++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { gone = true; break; } // subscription expired
        console.log('push error', e.statusCode, e.body || e.message);
      }
    }
    if (gone) { await store.delete(key); continue; }
    // drop reminders more than a day old so the blob stays small
    const keep = (data.reminders || []).filter(r => r.at > now - 864e5);
    const keepIds = new Set(keep.map(r => r.id));
    await store.setJSON(key, { ...data, reminders: keep, sent: [...sent].filter(id => keepIds.has(id)) });
  }
  if (sentCount) console.log(`sent ${sentCount} reminder(s)`);
};

export const config = { schedule: '* * * * *' };
