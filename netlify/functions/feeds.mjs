// Calendars shown read-only in Agenda: public .ics links, or private iCloud calendars via the Apple connection.
//   GET  /api/feeds  (Authorization: Bearer <supabase token>)  -> { feeds, events }   ?refresh=1 to skip the cache
//   POST /api/feeds  { action:"add", url, name?, color, alert }       public link
//                    { action:"addApple", cal, name?, color, alert }  private iCloud calendar
//                    { action:"update", id, name?, color?, alert? } | { action:"remove", id }
import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { normaliseUrl } from '../lib/feeds-lib.mjs';
import { loadFeed, publicFeed } from '../lib/feeds-core.mjs';
import { userIdFromToken, bearer } from '../lib/auth.mjs';

async function respond(store, uid, feeds, force) {
  const caches = await Promise.all(feeds.map(f => loadFeed(store, uid, f, force)));
  return Response.json({ feeds: feeds.map((f, i) => publicFeed(f, caches[i])), events: caches.flatMap(c => c.events) }, { headers: { 'cache-control': 'no-store' } });
}

export default async (req) => {
  const store = getStore('agenda-feeds');
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); } }
  const uid = await userIdFromToken(bearer(req) || body.token);
  if (!uid) return new Response('Not signed in', { status: 401 });
  const key = 'u_' + uid;
  const rec = (await store.get(key, { type: 'json' })) || { feeds: [] };

  if (req.method === 'GET') return respond(store, uid, rec.feeds, new URL(req.url).searchParams.get('refresh') === '1');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#ff9f0a';
  const alert = body.alert === null || body.alert === 'none' || body.alert === undefined ? null : Math.max(0, Math.min(10080, Number(body.alert) || 0));

  if (body.action === 'add' || body.action === 'addApple') {
    if (rec.feeds.length >= 12) return new Response('You can show up to 12 calendars.', { status: 400 });
    const feed = { id: randomUUID().slice(0, 8), name: String(body.name || '').trim().slice(0, 40), color, alert };
    if (body.action === 'add') {
      try { feed.url = normaliseUrl(body.url); } catch (e) { return new Response(e.message, { status: 400 }); }
      if (rec.feeds.some(f => f.url === feed.url)) return new Response('That calendar is already added.', { status: 400 });
    } else {
      const apple = await getStore('agenda-apple').get(key, { type: 'json' });
      const cal = apple && apple.calendars.find(c => c.id === body.cal);
      if (!cal) return new Response('Connect Apple Calendar first.', { status: 400 });
      if (rec.feeds.some(f => f.kind === 'caldav' && f.cal === cal.id)) return new Response('That calendar is already shown.', { status: 400 });
      Object.assign(feed, { kind: 'caldav', cal: cal.id, name: feed.name || cal.name });
    }
    const firstLoad = await loadFeed(store, uid, feed, true);
    if (firstLoad.error) return new Response(firstLoad.error, { status: 400 });
    if (!feed.name) feed.name = (firstLoad.calName || 'Shared calendar').slice(0, 40);
    rec.feeds.push(feed);
    await store.setJSON(key, rec);
    return respond(store, uid, rec.feeds, false);
  }
  const feed = rec.feeds.find(f => f.id === body.id);
  if (!feed) return new Response('Calendar not found', { status: 404 });
  if (body.action === 'update') {
    if (body.name !== undefined) feed.name = String(body.name).trim().slice(0, 40) || feed.name;
    if (body.color !== undefined) feed.color = color;
    if (body.alert !== undefined) feed.alert = alert;
    await store.setJSON(key, rec);
    return respond(store, uid, rec.feeds, false);
  }
  if (body.action === 'remove') {
    rec.feeds = rec.feeds.filter(f => f.id !== feed.id);
    await store.setJSON(key, rec); await store.delete(`cache_${uid}_${feed.id}`); await store.delete(`seen_${uid}_${feed.id}`);
    return respond(store, uid, rec.feeds, false);
  }
  return new Response('Unknown action', { status: 400 });
};

export const config = { path: '/api/feeds' };
