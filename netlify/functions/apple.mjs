// iCloud Calendar connection for one Agenda account.
//   GET  /api/apple                                   -> { connected, appleId, calendars:[{id,name,color,canWrite}] }
//   POST /api/apple { action:"connect", appleId, password }   (app-specific password; stored encrypted)
//                   { action:"refresh" }                      re-list calendars
//                   { action:"upsert", cal, item }            create/update an Agenda event in that calendar
//                   { action:"delete", cal, id }              remove it again
//                   { action:"disconnect" }
import { getStore } from '@netlify/blobs';
import { userIdFromToken, bearer } from '../lib/auth.mjs';
import { seal, unseal } from '../lib/secure.mjs';
import { basicAuth, discover, listCalendars, putEvent, deleteEvent, buildICS, agendaUid, AuthError } from '../lib/caldav.mjs';

const view = rec => rec ? { connected: true, appleId: rec.appleId, calendars: rec.calendars.map(({ id, name, color, canWrite, shared }) => ({ id, name, color, canWrite, shared })) } : { connected: false, calendars: [] };
const fail = (msg, status = 400) => new Response(msg, { status });

export default async (req) => {
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { return fail('Bad JSON'); } }
  const uid = await userIdFromToken(bearer(req) || body.token);
  if (!uid) return fail('Not signed in', 401);
  const store = getStore('agenda-apple'), key = 'u_' + uid;
  const rec = await store.get(key, { type: 'json' });
  if (req.method === 'GET') return Response.json(view(rec));
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  try {
    if (body.action === 'connect') {
      const appleId = String(body.appleId || '').trim().toLowerCase();
      const password = String(body.password || '').replace(/\s/g, '');
      if (!/^\S+@\S+$/.test(appleId)) return fail('Enter the email of your Apple ID.');
      if (!/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i.test(password)) return fail('Use an app-specific password (looks like abcd-efgh-ijkl-mnop), not your normal Apple ID password.');
      const auth = basicAuth(appleId, password);
      const { home } = await discover(auth);
      const calendars = await listCalendars(auth, home);
      const next = { appleId, pw: seal(password), home, calendars, at: Date.now() };
      await store.setJSON(key, next);
      return Response.json(view(next));
    }
    if (!rec) return fail('Apple Calendar isn’t connected.');
    const auth = basicAuth(rec.appleId, unseal(rec.pw));
    if (body.action === 'refresh') {
      rec.calendars = await listCalendars(auth, rec.home); rec.at = Date.now();
      await store.setJSON(key, rec);
      return Response.json(view(rec));
    }
    if (body.action === 'upsert' || body.action === 'delete') {
      const cal = rec.calendars.find(c => c.id === body.cal);
      if (!cal) return fail('That Apple calendar is no longer available — refresh the list.');
      if (body.action === 'delete') { await deleteEvent(auth, cal.href, agendaUid(String(body.id).slice(0, 40))); return Response.json({ ok: true }); }
      if (!cal.canWrite) return fail(`You can’t edit “${cal.name}”. Ask its owner to allow editing.`, 403);
      const it = body.item || {};
      if (!it.id || !it.title || !it.date) return fail('Event is missing a title or date.');
      const ev = { id: String(it.id).slice(0, 40), title: String(it.title).slice(0, 200), notes: String(it.notes || '').slice(0, 2000), allDay: !!it.allDay, date: String(it.date).slice(0, 10), endDate: it.endDate ? String(it.endDate).slice(0, 10) : null, startUtc: it.startUtc, endUtc: it.endUtc };
      if (!ev.allDay && (isNaN(Date.parse(ev.startUtc)) || isNaN(Date.parse(ev.endUtc || ev.startUtc)))) return fail('Event time is invalid.');
      await putEvent(auth, cal.href, agendaUid(ev.id), buildICS(ev));
      return Response.json({ ok: true });
    }
    if (body.action === 'disconnect') {
      await store.delete(key);
      const feeds = getStore('agenda-feeds'), frec = await feeds.get(key, { type: 'json' });
      if (frec) { frec.feeds = frec.feeds.filter(f => f.kind !== 'caldav'); await feeds.setJSON(key, frec); }
      return Response.json(view(null));
    }
    return fail('Unknown action');
  } catch (e) {
    return fail(e instanceof AuthError ? 'Apple rejected the sign-in. Check the Apple ID email and create a fresh app-specific password.' : e.message, e instanceof AuthError ? 401 : 502);
  }
};

export const config = { path: '/api/apple' };
