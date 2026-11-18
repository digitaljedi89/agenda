// Stores each device's push subscription + upcoming reminders in Netlify Blobs.
//   GET    /api/reminders  -> { publicKey }
//   POST   /api/reminders  -> { subscription, reminders }  (save)  |  { action:"test", subscription }
//   DELETE /api/reminders  -> { endpoint }                   (unsubscribe)
import { getStore } from '@netlify/blobs';
import * as webpush from 'web-push';
import { createHash } from 'node:crypto';

const keyFor = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
const ALLOWED_PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chromium\.org)$/;

function validSub(sub) {
  try {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && ALLOWED_PUSH_HOSTS.test(u.hostname);
  } catch { return false; }
}

export default async (req) => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:hello@darkmatterlabs.ca' } = process.env;
  if (req.method === 'GET') return Response.json({ publicKey: VAPID_PUBLIC_KEY || null });

  const store = getStore('agenda-reminders');
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  if (req.method === 'DELETE') {
    if (body.endpoint) await store.delete(keyFor(body.endpoint));
    return Response.json({ ok: true });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!validSub(body.subscription)) return new Response('Invalid subscription', { status: 400 });
  const key = keyFor(body.subscription.endpoint);

  if (body.action === 'test') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return new Response('VAPID keys not configured', { status: 500 });
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    try {
      await webpush.sendNotification(body.subscription, JSON.stringify({ title: 'Agenda', body: 'Notifications are working ✓', tag: 'test', url: '/' }), { TTL: 60 });
      return Response.json({ ok: true });
    } catch (e) { return new Response(`Push failed (${e.statusCode || ''}) ${e.body || e.message}`, { status: 502 }); }
  }

  const reminders = (Array.isArray(body.reminders) ? body.reminders : []).slice(0, 400).map(r => ({
    id: String(r.id).slice(0, 80), item: String(r.item).slice(0, 40), at: Number(r.at),
    title: String(r.title || '').slice(0, 120), body: String(r.body || '').slice(0, 200)
  })).filter(r => Number.isFinite(r.at));
  const prev = (await store.get(key, { type: 'json' })) || {};
  const ids = new Set(reminders.map(r => r.id));
  await store.setJSON(key, {
    subscription: body.subscription,
    reminders,
    sent: (prev.sent || []).filter(id => ids.has(id)),
    updated: Date.now()
  });
  return Response.json({ ok: true, count: reminders.length });
};

export const config = { path: '/api/reminders' };
