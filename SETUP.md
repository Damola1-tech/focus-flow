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
5. **New query again.** Open `supabase/hardening.sql`, paste all of it, click **Run**. This adds the privacy rules (only people in a plan can see it), email invites and invite-only sign-up. If you ran `schema.sql` earlier, you only need this second file now. It is safe to run twice.

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

It prints the `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (ignore the third value it prints). Keep that window open or copy them into a note.

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

1. Left menu **Edge Functions**, **Deploy a new function**, **Via Editor**. Name it exactly `focusflow`.
2. Delete the sample code and paste the whole of `supabase/focusflow-single-file.ts`. Click **Deploy**.
3. Open the function's settings and switch **Enforce JWT verification** (Verify JWT) **off**. The function checks sign-in and the secret itself.
4. Left menu **Edge Functions**, **Secrets**. Add just these three (everything else has a built-in default; change them in `supabase/functions/focusflow/index.ts` if you use another site or mail provider):

| Name | Value |
|---|---|
| `VAPID_PRIVATE_KEY` | from step 5 |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | a Gmail **App password** (see below) |

Gmail sends about 500 emails a day, far more than a family needs.

**Gmail App password:** Google Account, Security, turn on 2-Step Verification, then search "App passwords", create one called Focus Flow, copy the 16 letters. (Skip the `SMTP_*` rows if you only want phone alerts, not email.)

## 8. Start the one-minute schedule

1. **SQL Editor**, **New query**, paste `supabase/cron.sql`.
2. Replace `YOUR-PROJECT-REF` with your project ref (the `abcdxyz` part of your URL). The schedule's secret is made inside the database for you.
3. Click **Run**.

## 8b. Sign-in links in emails

Authentication, **URL Configuration**: set **Site URL** to your app address (for example `https://damola1-tech.github.io/focus-flow/`) and add the same address under **Redirect URLs**. This makes "forgot password" emails come back to the app's new-password screen.

## 9. Try it

1. Open your GitHub Pages link, **Create an account** with the family code.
2. On your phone: Android (Chrome) just open it; iPhone needs iOS 16.4 or newer: Share, **Add to Home Screen**, then open from the home-screen icon.
3. Settings, **Your account**, **Turn on phone alerts**, then **Send a test alert**. A notification should arrive within seconds.
4. Add a task starting 12 minutes from now. Close the app. A "Starting soon" alert should arrive.

## Sharing with family and friends

Three ways, from simplest:
1. **Invite link with the code:** `https://damola1-tech.github.io/focus-flow/?code=YourCode` opens "Create an account" with the code filled in.
2. **Invite from a plan (best):** open a plan you own, type their email in **Invite by email**, press **Send invites**. A new person gets an email with a personal link that only works for their address for 14 days. Someone who already has an account gets a notice and an email, and the plan appears under Shared for them to accept.
3. **Invited people only:** to stop anyone using the family code, run this in the SQL editor: `update public.app_config set value = '' where key = 'family_code';` From then on people can only join through an invite.

## If something does not work

- **"That family code is not right"**: the code in step 2 does not match what they typed. Run this in the SQL editor to change it: `update public.app_config set value = 'NewCode' where key = 'family_code';`
- **Test alert says "server not set up"**: step 7 (function not deployed with the name `focusflow`, or Verify JWT still on).
- **Invites say "email is not set up on the server"**: the `SMTP_*` secrets in step 7.
- **Invitation link in the email goes to the wrong place**: the `SITE_URL` secret.
- **Alert works but no email**: the `SMTP_*` secrets, or the person has not ticked **Email reminders** in Settings.
- **Scheduled reminders never arrive but the test does**: step 8 (check that you replaced both placeholders). Look at Edge Functions, `reminders`, Logs.
- **Nothing on iPhone**: it must be added to the Home Screen and opened from the icon.

## Turning on the AI Coach (optional, costs a little)

1. Create an account at https://console.anthropic.com, add a few dollars of credit, and under **Limits** set a small monthly spend limit (for example $5) so the bill can never surprise you.
2. **API Keys**, create a key called Focus Flow, copy it.
3. Supabase, Edge Functions, **Secrets**, add `ANTHROPIC_API_KEY` with that key. Never paste it into the app, GitHub or a chat.
4. Reload Focus Flow: a **Coach** entry appears. Optional secrets: `COACH_MODEL` (default `claude-sonnet-5-5`) and `COACH_DAILY` (calls per person per day, default 60).

## Looking after it

- **Crash reports:** Supabase, Table Editor, `client_errors` (newest first) shows errors from people's phones.
- **Backups:** a copy of all data is taken each night (kept 14 days) in the `backups` table. How to restore one document is written at the bottom of `supabase/hardening.sql`.
- **Privacy notice:** `privacy.html` is linked from the sign-up screen and Settings. Edit it if you change how things work.
- **Optional:** Authentication, Providers/Passwords, switch on **leaked password protection**.

## How it works and what it does not do

- Everyone's tasks live in their own private area. A plan, its people and its tasks are visible only to the people in it (invited people see the plan's title until they accept). Names are visible to every signed-in person. Nobody can sign up without the family code or an invite.
- Plan news by phone alert and email: someone invited you, someone joined your plan, a task was given to you, a task was finished by someone else. Invitations are always emailed; the rest follow each person's **Email reminders** setting.
- Delete my account removes the person's data, the plans they own, their place in other plans and their sign-in.
- The app polls for changes every few seconds while it is open, so shared plans update within about 6 seconds.
- Phone alerts are not shown a second time while the app is open on screen (the app shows its own). Emails are sent either way.
- Reminders sent by the server: task starting soon, task not started, return-from-pause reminders, a morning message (default 8:00), an evening review (default 20:00), a weekly summary (Sunday 19:00) and a monthly report (1st, 09:00). Each person can change or switch these off in Settings. They respect quiet hours and the person's time zone. Hourly check-ins still only appear inside the open app.
- The AI Coach (and "Ask AI to change") works through the same server function. It stays hidden until you add the `ANTHROPIC_API_KEY` secret (see below). Each person gets 60 AI calls a day (`COACH_DAILY` secret changes it).
