// Sends one payload to many push subscriptions; returns the endpoints that are gone for good.
import * as webpush from 'web-push';
let ready = null;
export function pushReady() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:hello@darkmatterlabs.ca' } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!ready) { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); ready = true; }
  return true;
}
export async function sendToSubs(subs, payload, opts = { TTL: 3600, urgency: 'high' }) {
  const dead = new Set(); let sent = 0;
  if (!pushReady() || !subs || !subs.length) return { dead, sent };
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  await Promise.all(subs.map(async sub => {
    try { await webpush.sendNotification(sub, body, opts); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.add(sub.endpoint);
      else console.log('push error', e.statusCode, e.body || e.message);
    }
  }));
  return { dead, sent };
}
