# Agenda — agenda.darkmatterlabs.ca

Single-page agenda app + push-notification backend on Netlify.

```
index.html               the app
sw.js                    service worker (receives pushes, opens the tapped item)
manifest.webmanifest     makes it a proper Home Screen web app
icons/                   leather app icons
netlify/functions/
  reminders.mjs          /api/reminders — saves each device's subscription + upcoming alerts
  send-reminders.mjs     runs every minute, sends any alert that's due
netlify.toml, package.json
```

## Deploy (one time)

Push notifications need the functions, so deploy from **GitHub** (or `netlify deploy --prod`), not drag-and-drop.

1. Put this folder in a GitHub repo and connect it to your Netlify site (publish dir `.`; no build command needed).
2. Generate push keys on your computer:
   ```
   npx web-push generate-vapid-keys
   ```
3. In Netlify → Site configuration → Environment variables, add:
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key (keep this secret, never in the repo)
   - `VAPID_SUBJECT` = `mailto:you@yourdomain` (any contact email)
4. Redeploy. Reminders are stored in Netlify Blobs automatically — no database to set up.

## Turn it on (iPhone)

1. Open agenda.darkmatterlabs.ca in Safari → Share → **Add to Home Screen**.
2. Open Agenda **from the Home Screen icon** (iOS only allows web push there).
3. Tap the bell → **Enable notifications** → Allow → **Send a test notification**.

Each event/task has an **Alert** setting (none, at time, 5/10/15/30 min, 1–2 h, 1 day). Untimed tasks/all-day events alert at 9:00 AM. The bell panel lists what's scheduled and sets the default alert for new events.

## Notes

- Your events still live on each device (localStorage). The server only receives the reminder titles and times for this device's next 45 days. Syncing events across devices (Supabase login) is a separate step.
- Netlify scheduled functions run once a minute, so alerts land within about a minute of their time.
- If you delete the Home Screen app or revoke permission, the server drops that subscription automatically on the next send.
- After updating `index.html`, fully close and reopen the Home Screen app to pick up changes.
