-- Focus Flow: run AFTER you have deployed the "focusflow" function. Edit the two values marked CHANGE ME.
-- It asks the function to check for due reminders and plan news every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('focusflow-reminders') where exists (select 1 from cron.job where jobname = 'focusflow-reminders');
select cron.schedule('focusflow-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/focusflow',   -- CHANGE ME
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),  -- CHANGE ME
    body    := '{}'::jsonb
  );
$$);
