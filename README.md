# Agenda — agenda.darkmatterlabs.ca

Agenda app with cross-device sync (Supabase) and push notifications (Netlify).

```
index.html               the app
sw.js                    service worker (receives pushes, opens the tapped item)
manifest.webmanifest     Home Screen web-app settings
icons/                   leather app icons
supabase.sql             database table + security rules (run once in Supabase)
netlify/functions/
  config.mjs             /api/config — hands the browser your public Supabase URL + key
  reminders.mjs          /api/reminders — stores alerts per account (or per device if signed out)
  send-reminders.mjs     runs every minute, sends any alert that's due to every device
  feeds.mjs              /api/feeds — calendars shown in Agenda (public links or private iCloud calendars)
  apple.mjs              /api/apple — iCloud connection; adds/updates/removes Agenda events in Apple calendars
  poll-feeds.mjs         every 5 min — re-reads shared calendars, notifies new/moved events, schedules their alerts
netlify/lib/             shared code (CalDAV client, calendar parsing, push, encryption)
netlify.toml, package.json
```

## Netlify environment variables

| Key | Value | Secret? |
|---|---|---|
| `VAPID_PUBLIC_KEY` | from `npx web-push generate-vapid-keys` | no |
| `VAPID_PRIVATE_KEY` | from the same command | **yes** |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` | no |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | no |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / publishable key | no |
| `AGENDA_SECRET` | output of `openssl rand -base64 32` (encrypts your Apple app-specific password) | **yes** |

Never use the Supabase `service_role` / secret key here; the app doesn't need it.

## Supabase setup (one time)

1. Create a project at supabase.com (or reuse an existing one).
2. **SQL Editor → New query** → paste all of `supabase.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email** → turn **off "Confirm email"**, so a new account works immediately with no email at all.
   (Sign-in is email + password, so no email templates or custom SMTP are needed. iCloud Keychain will offer to save the password.)
4. **Authentication → URL Configuration → Site URL** = `https://agenda.darkmatterlabs.ca`.
5. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify, then redeploy.
6. Optional, after you've signed in once: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**, so nobody else can create accounts on your project.

## Using it

- Tap the round account button (top right) → enter your email and a password → **Create account** the first time, **Sign in** on every other device.
- The first device you sign in on uploads its events. Other devices drop their sample events and download yours.
- Changes appear on your other devices within a second or two while they're open. Edits made offline are saved and sync when you're back online.
- Turn on notifications on each device you want alerts on (same panel). Alerts belong to your account, so an event added on your Mac alerts your phone.

## Apple Calendar (add events to your wife's shared calendar)

One time:
1. In Supabase → SQL Editor, run this once (adds the column that remembers which Apple calendar an event belongs to):
   ```sql
   alter table public.agenda_items add column if not exists cal text;
   ```
2. In Terminal: `openssl rand -base64 32` → add the output in Netlify as `AGENDA_SECRET` (mark it secret) → push / redeploy.
3. Make sure the shared calendar is shared **with your Apple ID with editing allowed**: on your wife's iPhone, Calendar → Calendars → ⓘ next to it → your name → **Allow Editing** on.
4. Create an app-specific password: account.apple.com → Sign-In and Security → **App-Specific Passwords** → + → "Agenda" → copy.
5. In Agenda: account button → **Apple Calendar → Connect** → your Apple ID email + that password.

Then:
- **Show** a calendar (switch next to it) to see its events in Agenda — privately, no public link needed.
- When adding an event, pick it under **Calendar** (Agenda remembers your last choice). It's saved in Agenda *and* on that Apple
  calendar, so it shows up in your wife's Calendar app and Apple notifies her as it does for any shared-calendar change.
  Editing or deleting it in Agenda updates Apple Calendar too. Changes made while offline are sent when you're back online.
- Agenda checks shared calendars every 5 minutes on the server and notifies your devices when something new is added or moved,
  and sends the alerts you set for that calendar — even if Agenda hasn't been opened.

Limits: events Agenda creates are owned by Agenda — if your wife edits one in Apple Calendar, Agenda won't pick up her change.
Tasks stay in Agenda only. To revoke access, delete the app-specific password at account.apple.com (or tap Disconnect).

## Shared calendars by public link (alternative, read-only)

If you'd rather not connect an Apple ID: the calendar owner turns on **Public Calendar** → **Share Link** in Calendar → ⓘ,
and you paste it under **Calendars shown in Agenda → Add by public link**. Anyone with that link can view the calendar.

## Notes

- You stay signed in on each device, so you'll rarely type the password.
- Netlify scheduled functions run once a minute, so alerts land within about a minute of their time.
- After updating files, fully close and reopen the Home Screen app to pick up changes.
