-- Focus Flow: run this once in Supabase -> SQL Editor -> New query -> Run.
-- 1) EDIT the family code on the line marked CHANGE ME before you run it.

-- Every piece of app data is one small document in this table.
create table if not exists public.docs (
  path        text primary key,
  parent      text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists docs_parent_idx on public.docs (parent);

create or replace function public.docs_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.docs_touch();

alter table public.docs enable row level security;

-- Personal data (data/users/<your id>/...) is readable and writable only by you.
-- People, plans, plan members and plan tasks are shared between signed-in family members.
drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_read on public.docs for select to authenticated using (
  path like 'data/users/' || auth.uid()::text || '/%'
  or parent in ('people','plans','plan_members','plan_tasks'));
create policy docs_insert on public.docs for insert to authenticated with check (
  path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or parent in ('plans','plan_members','plan_tasks'));
create policy docs_update on public.docs for update to authenticated using (
  path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or parent in ('plans','plan_members','plan_tasks')) with check (
  path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or parent in ('plans','plan_members','plan_tasks'));
create policy docs_delete on public.docs for delete to authenticated using (
  path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or parent in ('plans','plan_members','plan_tasks'));

-- Phones that asked for alerts.
create table if not exists public.push_subs (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  sub         jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists push_own on public.push_subs;
create policy push_own on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Remembers which reminders were already sent, so nobody gets the same one twice.
create table if not exists public.sent_reminders (
  key text primary key,
  at  timestamptz not null default now()
);
alter table public.sent_reminders enable row level security;   -- no policies: only the server job can use it

-- Family code: only people who know it can create an account.
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;       -- no policies: private
insert into public.app_config (key, value) values ('family_code', 'CHANGE-ME')   -- <<< CHANGE ME
  on conflict (key) do update set value = excluded.value;

create or replace function public.check_family_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(trim(coalesce(new.raw_user_meta_data->>'family_code',''))) <>
     lower(trim((select value from public.app_config where key = 'family_code'))) then
    raise exception 'Invalid family code';
  end if;
  return new;
end $$;
drop trigger if exists focusflow_family_code on auth.users;
create trigger focusflow_family_code before insert on auth.users
  for each row execute function public.check_family_code();
