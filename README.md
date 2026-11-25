# Focus Flow

A personal productivity and accountability web app for a family. Plan the day around energy and shifts,
track tasks with a timer, work toward goals, review the week and month, and share plans with family and friends.

It is a single HTML file with plain JavaScript and CSS. No framework, no build tools beyond Python and Node.

## Two ways it runs

| Mode | Where | What works |
|---|---|---|
| **Claude-hosted** (`dist/page.html`) | Published as a Claude Artifact | Sign-in through Claude, data saved online and synced across devices, shared plans across phones, AI Coach (uses each person's own Claude account) |
| **Standalone** (`dist/FocusFlow.html`, `pwa/`) | Any static host, or opened as a file | Everything except sign-in, sync, cross-phone sharing and AI. Data stays in this browser (localStorage). Several profiles per device. |

The app detects which mode it is in at start-up (`window.claude` present or not).

## Build

Requires Python 3 and Node (only for a syntax check).

    python3 build.py

Writes `dist/page.html`, `dist/FocusFlow.html` and `pwa/index.html`.

## Layout

    src/10-main.js            core: state, helpers, planner, timer, scoring, all screens, actions
    src/20-shared-actions.js  shared plan actions (local mode behaviour)
    src/30-cloud.js           sign-in, online saving, shared plans across devices (db + user capabilities)
    src/40-ai.js              Coach and "Ask AI to change" (sample capability)
    src/50-calendar.js        Calendar tab, shift changes, trips
    src/60-remind.js          start reminders, check-ins, quiet hours
    src/90-start.js           events and boot sequence
    src/style.css             all styles, light and dark, three accent looks
    pwa/                      installable copy: manifest, service worker, icons (host over https)
    tests/                    browser tests (Playwright)

Files are joined in filename order, so load order matters.

## How data is stored

Local mode keeps everything under `localStorage` key `focusflow.v1`.

Cloud mode (Claude-hosted) writes to the artifact database:

- `data/users/<id>/core` plus `data/users/<id>/tasks-YYYY-MM`: one person's private data
- `people/<id>`: display name and colour, so others can be invited
- `plans/<id>`, `plan_members/<planId>_<id>`, `plan_tasks/<id>`: shared plans (one small document per member and per task, so two people editing different tasks never overwrite each other)

Plans are readable by anyone who has access to the page. Keep that in mind before putting anything private in one.

## Publishing the hosted version

Publish `dist/page.html` as a Claude Artifact with these capabilities: `db`, `user` (scope `profile`), `sample`.
Then share the page with each family member as a **Contributor**, otherwise they cannot save.

## Publishing the installable version

Upload the `pwa/` folder to any https static host (Netlify Drop, GitHub Pages, Cloudflare Pages).
See `pwa/README.txt`. This copy works on one device only.

## Tests

    pip install playwright && playwright install chromium
    python3 tests/test_signup.py
    python3 tests/test_shared_plans.py
    python3 tests/test_features.py
    python3 tests/test_mobile_local.py

The tests run the real built page in Chromium with a small simulated Claude (`tests/harness.py`:
in-memory database, user, and AI), including two people sharing one plan.

## Not built yet

- Email reminders (the preference is saved, nothing is sent)
- Reminders when the page is closed (needs a server and push notifications)
- Calendar sync with Google, Apple or Outlook
- Sign-in without Claude (needs a backend such as Supabase)
- Checked only in desktop Chromium with a simulated Claude. Not yet tried on real phones or with the real AI.

## Sign-in, shared plans and reminders without Claude (Supabase)

Follow [SETUP.md](SETUP.md). It adds email sign-in with a family code, plans shared between phones, and
reminders by phone alert and email even when the app is closed. Code: `src/35-supabase.js` (client),
`supabase/schema.sql`, `supabase/hardening.sql`, `supabase/cron.sql` and `supabase/functions/focusflow/` (server).
Tests: `python3 tests/test_supabase.py` (runs the app against a pretend server) and
`node tests/test_reminder_logic.mjs`, `node tests/test_handlers.mjs` and `python3 tests/test_rls.py` (privacy rules, needs a local Postgres).
