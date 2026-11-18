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

## Notes

- You stay signed in on each device, so you'll rarely type the password.
- Netlify scheduled functions run once a minute, so alerts land within about a minute of their time.
- After updating files, fully close and reopen the Home Screen app to pick up changes.
