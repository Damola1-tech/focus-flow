-- Focus Flow: privacy rules, email invites and safer sign-up.
-- Run this AFTER schema.sql (Supabase -> SQL Editor -> New query -> paste -> Run). It is safe to run again.

-- ---------- helpers (they look rows up with full rights so the rules below can use them) ----------
create or replace function public.plan_owner(pid text) returns text
language sql security definer stable set search_path = public as $$
  select data->>'ownerId' from public.docs where path = 'plans/' || pid $$;

create or replace function public.is_plan_member(pid text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.docs where path = 'plan_members/' || pid || '_' || auth.uid()::text) $$;

create or replace function public.is_plan_joined(pid text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.docs
                 where path = 'plan_members/' || pid || '_' || auth.uid()::text and data->>'status' = 'joined') $$;

create or replace function public.doc_exists(p text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.docs where path = p) $$;

-- ---------- who can see and change what ----------
-- Your own data: only you.  Names: every signed-in person.
-- A plan: only people who are in it (invited people see the plan title and who invited them, not its tasks).
-- Plan tasks: only people who have joined.  Only the plan's owner can change the plan or add and remove people.
drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

create policy docs_read on public.docs for select to authenticated using (
     path like 'data/users/' || auth.uid()::text || '/%'
  or parent = 'people'
  or (parent = 'plans'        and (data->>'ownerId' = auth.uid()::text or public.is_plan_member(split_part(path, '/', 2))))
  or (parent = 'plan_members' and (data->>'uid' = auth.uid()::text or public.plan_owner(data->>'planId') = auth.uid()::text
                                   or public.is_plan_joined(data->>'planId')))
  or (parent = 'plan_tasks'   and public.is_plan_joined(data->>'planId')));
-- (Postgres also applies these read rules to the row being written by an "upsert", which is why the owner of a
--  plan can read it before their own member row exists.)

create policy docs_insert on public.docs for insert to authenticated with check (
     path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or (parent = 'plans' and data->>'ownerId' = auth.uid()::text and path = 'plans/' || (data->>'id'))
  or (parent = 'plan_members' and path = 'plan_members/' || (data->>'planId') || '_' || (data->>'uid')
        and (public.plan_owner(data->>'planId') = auth.uid()::text
             or (data->>'uid' = auth.uid()::text and public.doc_exists(path))))
  or (parent = 'plan_tasks' and public.is_plan_joined(data->>'planId')));

create policy docs_update on public.docs for update to authenticated using (
     path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or (parent = 'plans' and data->>'ownerId' = auth.uid()::text)
  or (parent = 'plan_members' and (data->>'uid' = auth.uid()::text or public.plan_owner(data->>'planId') = auth.uid()::text))
  or (parent = 'plan_tasks' and public.is_plan_joined(data->>'planId'))
) with check (
     path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or (parent = 'plans' and data->>'ownerId' = auth.uid()::text and path = 'plans/' || (data->>'id'))
  or (parent = 'plan_members' and path = 'plan_members/' || (data->>'planId') || '_' || (data->>'uid')
        and (public.plan_owner(data->>'planId') = auth.uid()::text
             or (data->>'uid' = auth.uid()::text and public.doc_exists(path))))
  or (parent = 'plan_tasks' and public.is_plan_joined(data->>'planId')));

create policy docs_delete on public.docs for delete to authenticated using (
     path like 'data/users/' || auth.uid()::text || '/%'
  or path = 'people/' || auth.uid()::text
  or (parent = 'plans' and data->>'ownerId' = auth.uid()::text)
  or (parent = 'plan_members' and (data->>'uid' = auth.uid()::text or public.plan_owner(data->>'planId') = auth.uid()::text))
  or (parent = 'plan_tasks' and public.is_plan_joined(data->>'planId')));

-- ---------- email invites ----------
create table if not exists public.invites (
  token       text primary key,
  email       text not null,
  plan_id     text,
  inviter     uuid,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  revoked     boolean not null default false
);
alter table public.invites enable row level security;
drop policy if exists invites_mine on public.invites;
create policy invites_mine on public.invites for select to authenticated using (inviter = auth.uid());
grant select on public.invites to authenticated;
grant all on public.invites to service_role;

-- Anyone holding an invite link can ask which email it is for (and nothing else).
create or replace function public.invite_lookup(t text) returns text
language sql security definer stable set search_path = public as $$
  select email from public.invites
  where token = t and used_at is null and not revoked and created_at > now() - interval '14 days' $$;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- The server job uses this to find out whether an email already has an account.
create or replace function public.find_user_by_email(e text) returns uuid
language sql security definer stable set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(e) limit 1 $$;
revoke all on function public.find_user_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_by_email(text) to service_role;

-- ---------- who may create an account ----------
-- Either: the family code (if one is set), or a valid invite link for exactly that email address.
-- To switch the family code off and allow invited people only:  update public.app_config set value = '' where key = 'family_code';
create or replace function public.check_family_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  code text := lower(trim(coalesce((select value from public.app_config where key = 'family_code'), '')));
  given text := lower(trim(coalesce(new.raw_user_meta_data->>'family_code', '')));
  tok text := coalesce(new.raw_user_meta_data->>'invite', '');
begin
  if code <> '' and given = code then return new; end if;
  if tok <> '' and exists (select 1 from public.invites
        where token = tok and used_at is null and not revoked and created_at > now() - interval '14 days'
          and lower(email) = lower(new.email)) then return new; end if;
  raise exception 'Invalid family code';
end $$;
drop trigger if exists focusflow_family_code on auth.users;
create trigger focusflow_family_code before insert on auth.users
  for each row execute function public.check_family_code();

-- After the account exists: put the person into the plan they were invited to, and close the invite.
create or replace function public.accept_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare tok text := coalesce(new.raw_user_meta_data->>'invite', ''); inv public.invites;
begin
  if tok = '' then return new; end if;
  select * into inv from public.invites
    where token = tok and used_at is null and not revoked and lower(email) = lower(new.email);
  if found then
    update public.invites set used_at = now() where token = tok;
    if inv.plan_id is not null and exists (select 1 from public.docs where path = 'plans/' || inv.plan_id) then
      insert into public.docs (path, parent, data)
      values ('plan_members/' || inv.plan_id || '_' || new.id::text, 'plan_members',
              jsonb_build_object('planId', inv.plan_id, 'uid', new.id::text, 'status', 'invited', 'at', (extract(epoch from now()) * 1000)::bigint))
      on conflict (path) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists focusflow_accept_invite on auth.users;
create trigger focusflow_accept_invite after insert on auth.users
  for each row execute function public.accept_invite();
