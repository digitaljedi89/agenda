// Shared calendar-feed helpers (kept outside netlify/functions so Netlify doesn't deploy it as its own function).
import ical from 'node-ical';

const PAST_DAYS = 60, FUTURE_DAYS = 400;
export const ALLOWED = /(^|\.)(icloud\.com|calendar\.google\.com|google\.com|outlook\.office365\.com|outlook\.live\.com|office365\.com)$/i;

export function normaliseUrl(raw) {
  let s = String(raw || '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  let u; try { u = new URL(s); } catch { throw new Error('That doesn’t look like a calendar link.'); }
  if (u.protocol !== 'https:') throw new Error('Calendar links must start with webcal:// or https://');
  if (!ALLOWED.test(u.hostname)) throw new Error('Only iCloud, Google and Outlook calendar links are supported.');
  return u.toString();
}

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function rangeWindow(now = Date.now()) { return { from: new Date(now - PAST_DAYS * 864e5), to: new Date(now + FUTURE_DAYS * 864e5) }; }
export function parseEvents(text, feedId) {
  const data = ical.sync.parseICS(text);
  const { from, to } = rangeWindow();
  let calName = null;
  for (const v of Object.values(data)) if (v && v.type === 'VCALENDAR' && v['WR-CALNAME']) calName = String(v['WR-CALNAME']);
  const out = [];
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    if (ev.recurrenceid && !ev.rrule) continue; // overrides are applied by expandRecurringEvent on the master
    let instances = [];
    try { instances = ical.expandRecurringEvent(ev, { from, to, maxIterations: 2000 }); } catch { continue; }
    for (const inst of instances) {
      const s = inst.start, e = inst.end || inst.start;
      const title = String((inst.summary && (inst.summary.val || inst.summary)) || 'Busy').slice(0, 140);
      const base = { feed: feedId, uid: String(ev.uid || '').slice(0, 120), title, location: ev.location ? String(ev.location.val || ev.location).slice(0, 140) : '', notes: ev.description ? String(ev.description.val || ev.description).slice(0, 400) : '' };
      if (inst.isFullDay) {
        // all-day dates are floating; node-ical gives local-midnight Dates (UTC on Netlify)
        const sd = new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));
        const ed = new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate()));
        out.push({ ...base, id: `${feedId}:${base.uid}:${dayKey(sd)}`, allDay: true, date: dayKey(sd), endDate: dayKey(ed > sd ? ed : new Date(+sd + 864e5)) });
      } else {
        out.push({ ...base, id: `${feedId}:${base.uid}:${s.toISOString()}`, allDay: false, start: s.toISOString(), end: e.toISOString() });
      }
    }
  }
  return { events: out.slice(0, 3000), calName };
}

