// Helpers for the shared-calendar poller (time zones, alerts, change detection).
export const MAX_NOTICES = 4;

function offsetMs(utcMs, tz) { // tz offset at an instant, e.g. -6h for Winnipeg in winter
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
export function zoned(dateKey, h, m, tz) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, h, m);
  t -= offsetMs(t, tz); t = Date.UTC(y, mo - 1, d, h, m) - offsetMs(t, tz);
  return t;
}
export const startMs = (e, tz) => e.allDay ? zoned(e.date, 0, 0, tz) : Date.parse(e.start);
export function when(e, tz) {
  const o = { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' };
  if (e.allDay) return new Date(zoned(e.date, 12, 0, tz)).toLocaleDateString('en-CA', o) + ' · all-day';
  return new Date(e.start).toLocaleString('en-CA', { ...o, hour: 'numeric', minute: '2-digit' });
}

export function feedReminders(feed, events, tz, now = Date.now()) {
  if (feed.alert == null) return [];
  const out = [];
  for (const e of events) {
    let at;
    if (e.allDay) at = zoned(e.date, 9, 0, tz) - (feed.alert >= 1440 ? 864e5 : 0);
    else at = Date.parse(e.start) - feed.alert * 60000;
    if (at < now - 60000 || at > now + 45 * 864e5) continue;
    const body = e.allDay ? `${feed.name} · ${feed.alert >= 1440 ? 'tomorrow' : 'today'} · all-day` : `${feed.name} · ${feed.alert === 0 ? 'starting now' : feed.alert >= 1440 ? 'tomorrow' : 'in ' + (feed.alert < 60 ? feed.alert + ' min' : feed.alert / 60 + ' h')} · ${new Date(e.start).toLocaleTimeString('en-CA', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`;
    out.push({ id: `feed:${e.id}@${at}`, item: 'feed:' + e.id, at, title: e.title, body });
  }
  return out;
}

export function changes(prev, next, now, tz) {
  // events grouped by calendar UID; ignore anything Agenda itself wrote (UID agenda-…)
  const group = list => { const m = new Map(); for (const e of list) { if (e.uid.startsWith('agenda-')) continue; (m.get(e.uid) || m.set(e.uid, []).get(e.uid)).push(e); } return m; };
  const before = group(prev), after = group(next), notices = [];
  for (const [uid, evs] of after) {
    const upcoming = evs.filter(e => startMs(e, tz) >= now - 3600e3).sort((a, b) => startMs(a, tz) - startMs(b, tz));
    if (!upcoming.length) continue;
    const old = before.get(uid);
    if (!old) notices.push({ kind: 'new', e: upcoming[0], repeats: evs.length > 1 });
    else if (old.length === 1 && evs.length === 1 && (old[0].start !== evs[0].start || old[0].date !== evs[0].date)) notices.push({ kind: 'moved', e: evs[0] });
  }
  return notices;
}

