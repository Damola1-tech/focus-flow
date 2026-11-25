"""Tests the privacy rules (supabase/schema.sql + hardening.sql) on a real Postgres. Needs a server: see PGHOST/PGPORT."""
import os, subprocess, sys, json
H = ['-h', os.environ.get('PGHOST', '/tmp'), '-p', os.environ.get('PGPORT', '5499'), '-U', 'postgres']
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = []
def ok(n, c, extra=''): R.append(('PASS ' if c else 'FAIL ') + n + (' ' + str(extra) if (extra and not c) else ''))
def psql(sql, db='ffrls', uid=None, role=None):
    pre = ''
    if role: pre += f"set role {role};"
    if uid: pre += f"select set_config('request.jwt.claim.sub','{uid}',false);"
    r = subprocess.run(['psql', *H, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', pre + sql], capture_output=True, text=True)
    lines = r.stdout.strip().split('\n') if r.stdout.strip() else []
    skip = (1 if role else 0) + (1 if uid else 0)
    return '\n'.join(lines[skip:]), r.stderr.strip()
def file(path, db='ffrls'):
    r = subprocess.run(['psql', *H, '-d', db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path], capture_output=True, text=True)
    if r.returncode: raise SystemExit('SQL failed: ' + path + '\n' + r.stderr)
subprocess.run(['psql', *H, '-d', 'postgres', '-c', 'drop database if exists ffrls'], capture_output=True)
subprocess.run(['psql', *H, '-d', 'postgres', '-c', 'create database ffrls'], capture_output=True)
subprocess.run(['psql', *H, '-d', 'postgres', '-c', 'drop role if exists anon, authenticated, service_role'], capture_output=True)
file(os.path.join(ROOT, 'tests/rls/stub.sql'))
file(os.path.join(ROOT, 'supabase/schema.sql'))
file(os.path.join(ROOT, 'supabase/hardening.sql'))
file(os.path.join(ROOT, 'supabase/hardening.sql'))   # must be safe to run twice
psql("update public.app_config set value='fam2026' where key='family_code'")
def mkuser(email, meta):
    out, err = psql(f"insert into auth.users (email, raw_user_meta_data) values ('{email}', '{json.dumps(meta)}') returning id")
    return out.split('\n')[0] if out and not err else None, err
U1, _ = mkuser('u1@x.com', {'family_code': ' FAM2026 '}); U2, _ = mkuser('u2@x.com', {'family_code': 'fam2026'}); U3, _ = mkuser('u3@x.com', {'family_code': 'fam2026'})
ok('a1 correct family code creates an account (any case, spaces ignored)', all([U1, U2, U3]))
_, e = mkuser('bad@x.com', {'family_code': 'nope'}); ok('a2 wrong family code is refused', 'Invalid family code' in e, e)
_, e = mkuser('bad2@x.com', {}); ok('a3 no code at all is refused', 'Invalid family code' in e, e)
def up(path, data, uid):
    parent = path.rsplit('/', 1)[0]
    d = json.dumps(data).replace("'", "''")
    return psql(f"insert into public.docs (path,parent,data) values ('{path}','{parent}','{d}') on conflict (path) do update set parent=excluded.parent, data=excluded.data", uid=uid, role='authenticated')
def get(path_like, uid):
    out, err = psql(f"select path from public.docs where path like '{path_like}' order by path", uid=uid, role='authenticated')
    return [x for x in out.split('\n') if x.startswith(path_like.rstrip('%'))] , err
def rm(path, uid):
    out, err = psql(f"with d as (delete from public.docs where path='{path}' returning 1) select count(*) from d", uid=uid, role='authenticated'); return out.split('\n')[-1], err
P = 'p1'
plan = {'id': P, 'title': 'Family trip', 'kind': 'family', 'ownerId': U1}
mem = lambda uid, st: {'planId': P, 'uid': uid, 'status': st, 'at': 1}
task = lambda i, extra={}: {'id': i, 'planId': P, 'title': 'Book flights', 'done': False, **extra}
# --- your own data
_, e = up(f'data/users/{U1}/core', {'x': 1}, U1); ok('b1 write own core', not e, e)
_, e = up(f'data/users/{U1}/core', {'x': 2}, U2); ok('b2 cannot overwrite someone else\'s core', 'row-level security' in e, e)
ok('b3 cannot read someone else\'s personal data', get(f'data/users/{U1}/%', U2)[0] == [])
ok('b4 can read own personal data', len(get(f'data/users/{U1}/%', U1)[0]) == 1)
_, e = up(f'people/{U1}', {'name': 'D'}, U1); ok('b5 write own name card', not e, e)
_, e = up(f'people/{U1}', {'name': 'Hacked'}, U2); ok('b6 cannot write another person\'s name card', 'row-level security' in e, e)
ok('b7 everyone can read name cards', get('people/%', U2)[0] == [f'people/{U1}'])
# --- creating a plan the way the app does: plan, member, tasks
_, e = up(f'plans/{P}', plan, U1); ok('c1 owner creates plan', not e, e)
_, e = up(f'plan_members/{P}_{U1}', mem(U1, 'joined'), U1); ok('c2 owner adds self as joined', not e, e)
_, e = up(f'plan_tasks/t1', task('t1'), U1); ok('c3 owner adds task', not e, e)
_, e = up('plans/fake', {**plan, 'id': 'fake', 'ownerId': U1}, U2); ok('c4 cannot create a plan owned by someone else', 'row-level security' in e, e)
_, e = up(f'plans/{P}', {**plan, 'ownerId': U2, 'title': 'Mine now'}, U2); ok('c5 cannot take over an existing plan', 'row-level security' in e, e)
# --- outsiders see nothing
ok('d1 outsider cannot see the plan', get('plans/%', U2)[0] == [])
ok('d2 outsider cannot see members', get('plan_members/%', U2)[0] == [])
ok('d3 outsider cannot see tasks', get('plan_tasks/%', U2)[0] == [])
_, e = up(f'plan_members/{P}_{U2}', mem(U2, 'joined'), U2); ok('d4 outsider cannot add themselves to a plan', 'row-level security' in e, e)
_, e = up('plan_tasks/t9', task('t9'), U2); ok('d5 outsider cannot add a task', 'row-level security' in e, e)
_, e = up('plan_tasks/t1', task('t1', {'title': 'Changed'}), U2); ok('d6 outsider cannot edit a task', 'row-level security' in e, e)
out, _ = rm('plan_tasks/t1', U2); ok('d7 outsider cannot delete a task', out == '0', out)
# --- invited person: sees the plan title, not the tasks
_, e = up(f'plan_members/{P}_{U2}', mem(U2, 'invited'), U1); ok('e1 owner invites someone', not e, e)
ok('e2 invited person sees the plan', get('plans/%', U2)[0] == [f'plans/{P}'])
ok('e3 invited person sees only their own member row', get('plan_members/%', U2)[0] == [f'plan_members/{P}_{U2}'])
ok('e4 invited person cannot see tasks yet', get('plan_tasks/%', U2)[0] == [])
_, e = up('plan_tasks/t9', task('t9'), U2); ok('e5 invited person cannot add tasks yet', 'row-level security' in e, e)
_, e = up(f'plan_members/{P}_{U3}', mem(U3, 'invited'), U2); ok('e6 invited person cannot invite others', 'row-level security' in e, e)
_, e = up(f'plan_members/{P}_{U2}', mem(U2, 'joined'), U2); ok('e7 invited person can accept (join)', not e, e)
# --- joined member
ok('f1 member sees tasks', get('plan_tasks/%', U2)[0] == ['plan_tasks/t1'])
ok('f2 member sees all members', len(get('plan_members/%', U2)[0]) == 2)
_, e = up('plan_tasks/t1', task('t1', {'done': True, 'doneBy': U2}), U2); ok('f3 member ticks a task', not e, e)
_, e = up('plan_tasks/t2', task('t2'), U2); ok('f4 member adds a task', not e, e)
_, e = up(f'plans/{P}', {**plan, 'title': 'Renamed'}, U2); ok('f5 member cannot rename the plan', 'row-level security' in e, e)
out, _ = rm(f'plans/{P}', U2); ok('f6 member cannot delete the plan', out == '0', out)
_, e = up(f'plan_members/{P}_{U3}', mem(U3, 'joined'), U2); ok('f7 member cannot add another person', 'row-level security' in e, e)
_, e = up(f'plan_members/{P}_{U2}', {**mem(U2, 'joined'), 'planId': 'other'}, U2); ok('f8 member cannot move own row to another plan', 'row-level security' in e, e)
_, e = up(f'plan_members/{P}_{U1}', mem(U1, 'invited'), U2); ok('f9 member cannot edit the owner\'s row', 'row-level security' in e, e)
ok('f10 third person still sees nothing', get('plans/%', U3)[0] == [] and get('plan_tasks/%', U3)[0] == [])
# --- leaving and removing
out, _ = rm(f'plan_members/{P}_{U2}', U2); ok('g1 member can leave', out == '1', out)
ok('g2 after leaving they see nothing', get('plan_tasks/%', U2)[0] == [] and get('plans/%', U2)[0] == [])
up(f'plan_members/{P}_{U2}', mem(U2, 'joined'), U1)
out, _ = rm(f'plan_members/{P}_{U2}', U1); ok('g3 owner can remove a member', out == '1', out)
# --- owner deletes everything in the app's order: tasks, members, plan
res = [rm('plan_tasks/t1', U1)[0], rm('plan_tasks/t2', U1)[0], rm(f'plan_members/{P}_{U1}', U1)[0], rm(f'plans/{P}', U1)[0]]
ok('g4 owner deletes tasks, then members, then plan', res == ['1', '1', '1', '1'], res)
# --- email invites
psql("insert into public.invites (token,email,plan_id,inviter) values ('tokA','new@x.com','p2',null)")
up('plans/p2', {'id': 'p2', 'title': 'Plan two', 'kind': 'family', 'ownerId': U1}, U1); up(f'plan_members/p2_{U1}', {'planId': 'p2', 'uid': U1, 'status': 'joined', 'at': 1}, U1)
out, _ = psql("select public.invite_lookup('tokA')", role='anon'); ok('h1 an invite link reveals only its email', out == 'new@x.com', out)
out, _ = psql("select coalesce(public.invite_lookup('nope'),'null')", role='anon'); ok('h2 unknown invite reveals nothing', out == 'null', out)
_, e = mkuser('other@x.com', {'invite': 'tokA'}); ok('h3 invite does not work for a different email', 'Invalid family code' in e, e)
NEW, e = mkuser('new@x.com', {'invite': 'tokA'}); ok('h4 invite creates the account without any family code', bool(NEW), e)
ok('h5 the new person lands in the plan as invited', get('plan_members/p2_%', NEW)[0] == [f'plan_members/p2_{NEW}'])
ok('h6 and can see the plan', get('plans/%', NEW)[0] == ['plans/p2'])
out, _ = psql("select coalesce(public.invite_lookup('tokA'),'null')", role='anon'); ok('h7 a used invite stops working', out == 'null', out)
_, e = mkuser('again@x.com', {'invite': 'tokA'}); ok('h8 and cannot be reused for another email', 'Invalid family code' in e, e)
psql("insert into public.invites (token,email,created_at) values ('old','late@x.com', now() - interval '15 days')")
_, e = mkuser('late@x.com', {'invite': 'old'}); ok('h9 invites expire after 14 days', 'Invalid family code' in e, e)
psql("insert into public.invites (token,email,revoked) values ('rev','rev@x.com', true)")
_, e = mkuser('rev@x.com', {'invite': 'rev'}); ok('h10 cancelled invites stop working', 'Invalid family code' in e, e)
psql("update public.app_config set value='' where key='family_code'")
_, e = mkuser('blank@x.com', {'family_code': ''}); ok('h11 blank family code switches the code route off', 'Invalid family code' in e, e)
psql("insert into public.invites (token,email) values ('tokB','inv@x.com')")
x, e = mkuser('inv@x.com', {'invite': 'tokB'}); ok('h12 invite still works when the code is off', bool(x), e)
# --- other tables
out, err = psql("select count(*) from public.app_config", role='authenticated', uid=U1); ok('i1 signed-in people cannot read the family code', 'permission denied' in err, (out, err))
out, err = psql("select count(*) from public.sent_reminders", role='authenticated', uid=U1); ok('i2 or the sent-reminders table', 'permission denied' in err, (out, err))
out, err = psql("select count(*) from public.invites", role='authenticated', uid=U2); ok('i3 people see only invites they sent', out == '0', (out, err))
out, err = psql("select public.find_user_by_email('u1@x.com')", role='authenticated', uid=U1); ok('i4 signed-in people cannot look up accounts by email', 'permission denied' in err, (out, err))
out, err = psql("select public.find_user_by_email('u1@x.com')", role='service_role'); ok('i5 the server job can', out == U1, (out, err))
out, err = psql("select private.plan_owner('p2')", role='anon'); ok('j1 helper functions are not reachable by signed-out visitors', 'permission denied' in err, (out, err))
out, err = psql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('plan_owner','is_plan_member','is_plan_joined','doc_exists')"); ok('j2 no helper functions left in the public API schema', out == '0', out)
out, err = psql("select public.take_backup()"); out, err = psql("select row_count > 0 from public.backups order by id desc limit 1"); ok('j3 backup captures the documents', out == 't', (out, err))
out, err = psql("select count(*) from public.backups", role='authenticated', uid=U1); ok('j4 signed-in people cannot read backups', 'permission denied' in err, (out, err))
out, err = psql("insert into public.client_errors (user_id, message) values ('%s', 'boom')" % U1, role='authenticated', uid=U1); ok('j5 a person can report their own error', 'ERROR' not in err, err)
out, err = psql("insert into public.client_errors (user_id, message) values ('%s', 'fake')" % U2, role='authenticated', uid=U1); ok('j6 but not in someone else\'s name', 'row-level security' in err, err)
out, err = psql("select count(*) from public.client_errors", role='authenticated', uid=U1); ok('j7 and cannot read the log', 'permission denied' in err, (out, err))
out, err = psql("select public.check_family_code()", role='authenticated', uid=U1); ok('j8 sign-up trigger functions are not callable from the API', 'permission denied' in err, (out, err))
print('\n'.join(R)); print('FAILS:', sum(1 for r in R if r.startswith('FAIL')))
