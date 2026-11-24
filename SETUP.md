# Turning on sign-in, sharing and reminders (Supabase)

Without this, Focus Flow works on one phone only. With it, every family member signs in with their own
email and password, plans are shared between phones, and reminders arrive on the phone (and by email)
even when the app is closed.

You need: a free Supabase account, about 45 minutes, and a Gmail address to send reminder emails from.
Everything below is point-and-click except two small commands.

> Costs: Supabase free plan, GitHub Pages and Gmail are all free for a family. A free Supabase project
> pauses after a week with no use, so have someone open the app at least weekly.

## 1. Create the project

1. Go to https://supabase.com, sign in with GitHub, click **New project**.
2. Name it `focus-flow`, choose a strong database password (save it somewhere), pick the region closest to you (for Nigeria, a Europe region is usually fastest), click **Create**. Wait about two minutes.

## 2. Create the tables and the family code

1. Left menu **SQL Editor**, **New query**.
2. Open `supabase/schema.sql` from this repo, copy everything, paste it in.
3. Find the line ending `-- <<< CHANGE ME` and replace `CHANGE-ME` with your own family code, for example `Adeyemi2026`. Anyone who wants an account must type this code.
4. Click **Run**. You should see "Success".

## 3. Make sign-up simple

1. Left menu **Authentication**, then **Sign In / Providers** (or **Providers**), open **Email**.
2. Turn **Confirm email** **off**, and save. (Otherwise every new person waits for a confirmation email, and Supabase's free mail service only sends a couple an hour.)

## 4. Copy your three public values

1. Left menu **Project Settings**, then **API** (called **Data API** or **API Keys** in newer versions).
2. Copy the **Project URL** (looks like `https://abcdxyz.supabase.co`).
3. Copy the **anon public** key (a long text starting `eyJ`; in newer versions it can be called the **publishable** key). Do **not** copy the `service_role` / secret key anywhere in the app.

## 5. Make the keys for phone alerts

On any computer with Node installed, from the repo folder:

```
node supabase/make-vapid-keys.mjs
```

It prints three values: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `CRON_SECRET`. Keep that window open or copy them into a note.

## 6. Tell the app about the server

Open `docs/config.js` (and `pwa/config.js`) and replace its contents with:

```js
window.FF_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
  vapidPublicKey: 'YOUR-VAPID_PUBLIC_KEY'
};
```

These three are safe to publish. Commit and push. When GitHub Pages updates (about a minute) the app shows a sign-in screen.

## 7. Add the reminder job

1. Left menu **Edge Functions**, **Deploy a new function**, **Via Editor**. Name it exactly `reminders`.
2. Delete the sample code and paste the whole of `supabase/reminders-single-file.ts`. Click **Deploy**.
3. Open the function's settings and switch **Enforce JWT verification** (Verify JWT) **off**. The job protects itself with the secret below.
4. Left menu **Edge Functions**, **Secrets** (or Project Settings, Edge Functions). Add these:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | from step 5 |
| `VAPID_PRIVATE_KEY` | from step 5 |
| `VAPID_SUBJECT` | `mailto:your-email@gmail.com` |
| `CRON_SECRET` | from step 5 |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | a Gmail **App password** (see below) |
| `MAIL_FROM` | `Focus Flow <your-gmail-address>` |

**Gmail App password:** Google Account, Security, turn on 2-Step Verification, then search "App passwords", create one called Focus Flow, copy the 16 letters. (Skip the `SMTP_*` rows if you only want phone alerts, not email.)

## 8. Start the one-minute schedule

1. **SQL Editor**, **New query**, paste `supabase/cron.sql`.
2. Replace `YOUR-PROJECT-REF` with your project ref (the `abcdxyz` part of your URL) and `YOUR-CRON-SECRET` with the `CRON_SECRET` from step 5.
3. Click **Run**.

## 9. Try it

1. Open your GitHub Pages link, **Create an account** with the family code.
2. On your phone: Android (Chrome) just open it; iPhone needs iOS 16.4 or newer: Share, **Add to Home Screen**, then open from the home-screen icon.
3. Settings, **Your account**, **Turn on phone alerts**, then **Send a test alert**. A notification should arrive within seconds.
4. Add a task starting 12 minutes from now. Close the app. A "Starting soon" alert should arrive.

## Sharing with family

Send them the link and the family code. They create their own account, then you can invite them to plans from the Shared tab.

## If something does not work

- **"That family code is not right"**: the code in step 2 does not match what they typed. Run this in the SQL editor to change it: `update public.app_config set value = 'NewCode' where key = 'family_code';`
- **Test alert says "server not set up"**: step 7 (function not deployed, or Verify JWT still on).
- **Alert works but no email**: the `SMTP_*` secrets, or the person has not ticked **Email reminders** in Settings.
- **Scheduled reminders never arrive but the test does**: step 8 (check that you replaced both placeholders). Look at Edge Functions, `reminders`, Logs.
- **Nothing on iPhone**: it must be added to the Home Screen and opened from the icon.

## How it works and what it does not do

- Everyone's tasks live in their own private area; only plans, plan tasks and names are visible to other signed-in family members. Nobody can sign up without the family code.
- The app polls for changes every few seconds while it is open, so shared plans update within about 6 seconds.
- Reminders sent by the server: task starting soon, task not started, and return-from-pause reminders. They respect the person's quiet hours and time zone. Hourly check-ins and the evening planning prompt still only appear inside the open app.
- The AI Coach only works when Focus Flow is opened through its Claude link; adding it here needs an Anthropic API key and another server function.
