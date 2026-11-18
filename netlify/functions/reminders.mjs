// Stores push subscriptions + upcoming reminders in Netlify Blobs.
// Signed-in devices share one record per account ("u_<user id>"), so an event added
// on any device alerts every subscribed device. Signed-out devices keep their own record.
//   GET    /api/reminders  -> { publicKey }
//   POST   /api/reminders  -> { reminders, subscription?, token? }   save
//                             { action:"test", subscription }        test push
//   DELETE /api/reminders  -> { endpoint, token? }                   unsubscribe
import { getStore } from '@netlify/blobs';
import * as webpush from 'web-push';
import { createHash } from 'node:crypto';

const deviceKey = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
const ALLOWED_PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chromium\.org)$/;

function validSub(sub) {
  try {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && ALLOWED_PUSH_HOSTS.test(u.hostname);
  } catch { return false; }
}
async function userIdFromToken(token) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? String(u.id) : null;
}
const cleanReminders = list => (Array.isArray(list) ? list : []).slice(0, 400).map(r => ({
  id: String(r.id).slice(0, 80), item: String(r.item).slice(0, 40), at: Number(r.at),
  title: String(r.title || '').slice(0, 120), body: String(r.body || '').slice(0, 200)
})).filter(r => Number.isFinite(r.at));

export default async (req) => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:hello@darkmatterlabs.ca' } = process.env;
  if (req.method === 'GET') return Response.json({ publicKey: VAPID_PUBLIC_KEY || null });

  const store = getStore('agenda-reminders');
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  if (req.method === 'DELETE') {
    if (!body.endpoint) return Response.json({ ok: true });
    await store.delete(deviceKey(body.endpoint));
    const uid = await userIdFromToken(body.token);
    if (uid) {
      const data = await store.get('u_' + uid, { type: 'json' });
      if (data) await store.setJSON('u_' + uid, { ...data, subs: (data.subs || []).filter(s => s.endpoint !== body.endpoint) });
    }
    return Response.json({ ok: true });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (body.action === 'test') {
    if (!validSub(body.subscription)) return new Response('Invalid subscription', { status: 400 });
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return new Response('VAPID keys not configured', { status: 500 });
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    try {
      await webpush.sendNotification(body.subscription, JSON.stringify({ title: 'Agenda', body: 'Notifications are working ✓', tag: 'test', url: '/' }), { TTL: 60 });
      return Response.json({ ok: true });
    } catch (e) { return new Response(`Push failed (${e.statusCode || ''}) ${e.body || e.message}`, { status: 502 }); }
  }

  const reminders = cleanReminders(body.reminders);
  const ids = new Set(reminders.map(r => r.id));
  const sub = body.subscription && validSub(body.subscription) ? body.subscription : null;
  if (body.subscription && !sub) return new Response('Invalid subscription', { status: 400 });

  if (body.token) {
    const uid = await userIdFromToken(body.token);
    if (!uid) return new Response('Not signed in', { status: 401 });
    const key = 'u_' + uid;
    const prev = (await store.get(key, { type: 'json' })) || {};
    let subs = prev.subs || [];
    if (sub) {
      subs = subs.filter(s => s.endpoint !== sub.endpoint).concat(sub).slice(-12);
      await store.delete(deviceKey(sub.endpoint)); // this device now gets account alerts instead
    }
    await store.setJSON(key, { subs, reminders, sent: (prev.sent || []).filter(id => ids.has(id)), updated: Date.now() });
    return Response.json({ ok: true, count: reminders.length, devices: subs.length });
  }

  if (!sub) return new Response('Missing subscription', { status: 400 });
  const key = deviceKey(sub.endpoint);
  const prev = (await store.get(key, { type: 'json' })) || {};
  await store.setJSON(key, { subs: [sub], reminders, sent: (prev.sent || []).filter(id => ids.has(id)), updated: Date.now() });
  return Response.json({ ok: true, count: reminders.length });
};

export const config = { path: '/api/reminders' };
