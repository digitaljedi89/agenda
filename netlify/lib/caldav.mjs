// Minimal iCloud CalDAV client: discover calendars, read a date range, create/update/delete events.
import { createHash } from 'node:crypto';

export const ICLOUD_ROOT = process.env.CALDAV_ROOT || 'https://caldav.icloud.com/';
const HOST_OK = u => { try { const h = new URL(u); if (process.env.CALDAV_ROOT && h.origin === new URL(process.env.CALDAV_ROOT).origin) return true; return h.protocol === 'https:' && /(^|\.)icloud\.com$/i.test(h.hostname); } catch { return false; } };

export const basicAuth = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
export const calId = href => createHash('sha1').update(href).digest('hex').slice(0, 10);

export class AuthError extends Error {}

async function dav(method, url, auth, { depth, body, headers = {} } = {}) {
  for (let hop = 0; hop < 4; hop++) {
    if (!HOST_OK(url)) throw new Error('Unexpected calendar server address.');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    let r;
    try {
      r = await fetch(url, {
        method, redirect: 'manual', signal: ctrl.signal, body,
        headers: { Authorization: auth, ...(depth != null ? { Depth: String(depth) } : {}), ...(body && !headers['Content-Type'] ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}), ...headers }
      });
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'iCloud took too long to respond.' : 'Couldn’t reach iCloud.'); }
    finally { clearTimeout(t); }
    if ([301, 302, 307, 308].includes(r.status) && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    if (r.status === 401 || r.status === 403 && method === 'PROPFIND') throw new AuthError('Apple ID or app-specific password was rejected.');
    return { status: r.status, text: await r.text(), url };
  }
  throw new Error('Too many redirects from iCloud.');
}

// --- tiny namespace-agnostic XML helpers (CalDAV responses are simple and predictable) ---
const tagRe = name => new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'gi');
const first = (xml, name) => { if (xml == null) return null; const m = tagRe(name).exec(xml); return m ? (m[1] ?? '') : null; };
const all = (xml, name) => [...String(xml || '').matchAll(tagRe(name))].map(m => m[1] ?? '');
const has = (xml, name) => tagRe(name).test(String(xml || ''));
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();

const PROP = inner => `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${inner}</d:prop></d:propfind>`;

export async function discover(auth) {
  const r1 = await dav('PROPFIND', ICLOUD_ROOT, auth, { depth: 0, body: PROP('<d:current-user-principal/>') });
  const p = first(first(r1.text, 'current-user-principal'), 'href');
  if (r1.status !== 207 || !p) throw new Error('iCloud didn’t return your calendar account.');
  const principal = new URL(unxml(p), r1.url).toString();
  const r2 = await dav('PROPFIND', principal, auth, { depth: 0, body: PROP('<c:calendar-home-set/>') });
  const h = first(first(r2.text, 'calendar-home-set'), 'href');
  if (!h) throw new Error('iCloud didn’t return a calendar home.');
  return { principal, home: new URL(unxml(h), r2.url).toString() };
}

export async function listCalendars(auth, home) {
  const r = await dav('PROPFIND', home, auth, { depth: 1, body: PROP('<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/><a:calendar-color/>') });
  if (r.status !== 207) throw new Error(`iCloud calendar list failed (${r.status}).`);
  const out = [];
  for (const resp of all(r.text, 'response')) {
    const href = first(resp, 'href'); const rt = first(resp, 'resourcetype') || '';
    if (!href || !has(rt, 'calendar')) continue;
    const comps = first(resp, 'supported-calendar-component-set');
    if (comps && !/name\s*=\s*["']VEVENT["']/i.test(comps)) continue; // reminders lists etc.
    const priv = first(resp, 'current-user-privilege-set') || '';
    const abs = new URL(unxml(href), r.url).toString();
    const color = (unxml(first(resp, 'calendar-color') || '').match(/#[0-9a-f]{6}/i) || [null])[0];
    out.push({ id: calId(abs), href: abs, name: unxml(first(resp, 'displayname') || '') || 'Calendar', color, canWrite: /<(?:[\w-]+:)?(write|write-content|all)(?=[\s/>])/i.test(priv), shared: has(rt, 'shared') || /\/[^/]*\.?shared/i.test(abs) });
  }
  return out;
}

const icsTime = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export async function fetchRange(auth, href, from, to) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${icsTime(from)}" end="${icsTime(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav('REPORT', href, auth, { depth: 1, body });
  if (r.status === 404) throw new Error('That calendar no longer exists or isn’t shared with you.');
  if (r.status !== 207) throw new Error(`iCloud calendar read failed (${r.status}).`);
  const blocks = all(r.text, 'calendar-data').map(unxml);
  const tz = new Map(), ev = [];
  for (const b of blocks) {
    for (const m of b.matchAll(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n?/g)) { const id = (m[0].match(/TZID:(.*)/) || [])[1]; if (id && !tz.has(id.trim())) tz.set(id.trim(), m[0]); }
    for (const m of b.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n?/g)) ev.push(m[0]);
  }
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Dark Matter Labs//Agenda//EN\r\n${[...tz.values()].join('')}${ev.join('')}END:VCALENDAR\r\n`;
}

export async function putEvent(auth, calHref, uid, ics) {
  const url = calHref.replace(/\/?$/, '/') + encodeURIComponent(uid) + '.ics';
  const r = await dav('PUT', url, auth, { body: ics, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  if (![200, 201, 204].includes(r.status)) throw new Error(r.status === 403 ? 'You don’t have permission to edit that calendar — ask its owner to allow editing.' : `iCloud rejected the event (${r.status}).`);
}
export async function deleteEvent(auth, calHref, uid) {
  const url = calHref.replace(/\/?$/, '/') + encodeURIComponent(uid) + '.ics';
  const r = await dav('DELETE', url, auth);
  if (![200, 204, 404, 410].includes(r.status)) throw new Error(`iCloud couldn’t delete the event (${r.status}).`);
}

// --- iCalendar writer ---
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch; }
  out.push(cur); return out.join('\r\n');
}
const dateOnly = k => k.replace(/-/g, '');
const nextDay = k => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export const agendaUid = id => `agenda-${id}@darkmatterlabs.ca`;
export function buildICS(e) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dark Matter Labs//Agenda//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${agendaUid(e.id)}`, `DTSTAMP:${icsTime(new Date())}`, `LAST-MODIFIED:${icsTime(new Date())}`];
  if (e.allDay) { L.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${dateOnly(e.endDate || nextDay(e.date))}`); }
  else { L.push(`DTSTART:${icsTime(new Date(e.startUtc))}`, `DTEND:${icsTime(new Date(e.endUtc || e.startUtc))}`); }
  L.push(`SUMMARY:${esc(e.title)}`);
  if (e.notes) L.push(`DESCRIPTION:${esc(e.notes)}`);
  L.push('X-DML-AGENDA:1', 'END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
