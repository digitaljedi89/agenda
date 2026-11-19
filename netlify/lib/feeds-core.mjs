// Loading calendar feeds (public .ics links or private iCloud calendars) with a short cache.
import { getStore } from '@netlify/blobs';
import { ALLOWED, parseEvents, rangeWindow } from './feeds-lib.mjs';
import { basicAuth, fetchRange } from './caldav.mjs';
import { unseal } from './secure.mjs';

export const CACHE_MS = 5 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export async function download(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'DarkMatterAgenda/1.0', accept: 'text/calendar,*/*' } });
    if (r.status === 404 || r.status === 403) throw new Error('The link no longer works — is Public Calendar still on?');
    if (!r.ok) throw new Error(`Calendar server replied ${r.status}`);
    if (!ALLOWED.test(new URL(r.url).hostname)) throw new Error('Calendar link redirected somewhere unexpected.');
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error('Calendar is too large.');
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That link didn’t return a calendar.');
    return text;
  } catch (e) { throw e.name === 'AbortError' ? new Error('Calendar server took too long.') : e; }
  finally { clearTimeout(t); }
}

export async function appleAuthFor(uid) {
  const rec = await getStore('agenda-apple').get('u_' + uid, { type: 'json' });
  if (!rec) return null;
  return { rec, auth: basicAuth(rec.appleId, unseal(rec.pw)) };
}

async function feedText(uid, feed) {
  if (feed.kind === 'caldav') {
    const a = await appleAuthFor(uid);
    if (!a) throw new Error('Apple Calendar is disconnected.');
    const cal = a.rec.calendars.find(c => c.id === feed.cal);
    if (!cal) throw new Error('That Apple calendar is no longer available.');
    const { from, to } = rangeWindow();
    return fetchRange(a.auth, cal.href, from, to);
  }
  return download(feed.url);
}

// Returns { at, events, calName, error, prev } — prev is the previous cached copy (for change detection).
export async function loadFeed(store, uid, feed, force) {
  const ck = `cache_${uid}_${feed.id}`;
  const cached = await store.get(ck, { type: 'json' });
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return { ...cached, prev: null };
  try {
    const { events, calName } = parseEvents(await feedText(uid, feed), feed.id);
    const fresh = { at: Date.now(), events, calName, error: null };
    await store.setJSON(ck, fresh);
    return { ...fresh, prev: cached };
  } catch (e) {
    return cached ? { ...cached, error: e.message, prev: null } : { at: 0, events: [], error: e.message, prev: null };
  }
}

export const publicFeed = (f, c) => ({
  id: f.id, name: f.name, color: f.color, alert: f.alert ?? null, kind: f.kind || 'ics', cal: f.cal || null,
  count: c ? c.events.length : 0, updated: c ? c.at : 0, error: c ? c.error : null,
  host: f.kind === 'caldav' ? 'iCloud (private)' : (() => { try { return new URL(f.url).hostname; } catch { return ''; } })()
});
