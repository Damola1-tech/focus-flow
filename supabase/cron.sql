-- Focus Flow: starts the one-minute check for due reminders and plan news.
-- Run after the "focusflow" function is deployed. Replace YOUR-PROJECT-REF (the part of your project URL before .supabase.co).
-- The secret the schedule uses is created inside the database, so you never have to copy or paste it.
create extension if not exists pg_cron;
create extension if not exists pg_net;
insert into public.app_config (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;
select cron.unschedule(jobid) from cron.job where jobname = 'focusflow-reminders';
select cron.schedule('focusflow-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/focusflow',   -- CHANGE ME
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_config where key = 'cron_secret')),
    body    := '{}'::jsonb
  );
$$);
