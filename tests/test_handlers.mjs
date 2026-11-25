import { runCron, handleInvite, handleDelete, handleTest } from '../supabase/functions/focusflow/handlers.js';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const NOW = Date.UTC(2026, 10, 25, 8, 51);   // 09:51 in Lagos
function world() {
  const w = { docs: {}, updated: {}, subs: {}, emails: { u1: 'owner@x.com', u2: 'bola@x.com', u3: 'chi@x.com' }, claimed: new Set(), invites: [], deleted: [], sentPush: [], sentMail: [], dead: new Set() };
  const put = (p, d, at = NOW - 1000) => { w.docs[p] = d; w.updated[p] = at; };
  w.put = put;
  w.store = {
    cores: async () => Object.keys(w.docs).filter((p) => /^data\/users\/[^/]+\/core$/.test(p)).map((p) => ({ uid: p.split('/')[2], data: w.docs[p] })),
    tasksFor: async () => { const o = {}; Object.keys(w.docs).filter((p) => /\/tasks-/.test(p)).forEach((p) => (o[p.split('/')[2]] ||= []).push(...w.docs[p].tasks)); return o; },
    recent: async (parents, since) => Object.keys(w.docs).filter((p) => parents.includes(p.split('/')[0]) && w.updated[p] > Date.parse(since)).map((p) => ({ path: p, parent: p.split('/')[0], data: w.docs[p], updatedAt: w.updated[p] })),
    getDocs: async (paths) => Object.fromEntries(paths.filter((p) => w.docs[p]).map((p) => [p, w.docs[p]])),
    insertDocIfMissing: async (p, parent, d) => { if (w.docs[p]) return false; put(p, d, NOW); return true; },
    deleteDocs: async (ps) => ps.forEach((p) => { delete w.docs[p]; w.deleted.push(p); }),
    paths: async (parent, pid) => Object.keys(w.docs).filter((p) => p.startsWith(parent + '/') && w.docs[p].planId === pid),
    plansOwnedBy: async (u) => Object.keys(w.docs).filter((p) => p.startsWith('plans/') && w.docs[p].ownerId === u).map((p) => p.split('/')[1]),
    memberPaths: async (u) => Object.keys(w.docs).filter((p) => p.startsWith('plan_members/') && w.docs[p].uid === u),
    personalPaths: async (u) => Object.keys(w.docs).filter((p) => p.startsWith(`data/users/${u}/`)),
    claim: async (k) => (w.claimed.has(k) ? false : (w.claimed.add(k), true)), cleanup: async () => { },
    subs: async (u) => w.subs[u] || [], dropSub: async (e) => { for (const u in w.subs) w.subs[u] = w.subs[u].filter((s) => s.endpoint !== e); },
    userEmail: async (u) => w.emails[u] || '', findUser: async (e) => Object.keys(w.emails).find((u) => w.emails[u] === e) || null,
    deleteUser: async (u) => w.deleted.push('USER:' + u), inviteCount: async () => w.invites.length,
    createInvite: async (i) => w.invites.push(i), revokeInvite: async (t) => { w.invites = w.invites.filter((i) => i.token !== t); },
  };
  w.mail = { enabled: true, send: async (m) => { w.sentMail.push(m); } };
  w.push = { send: async (sub, payload) => { if (w.dead.has(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; } w.sentPush.push({ endpoint: sub.endpoint, ...payload }); } };
  w.deps = { store: w.store, mail: w.mail, push: w.push };
  return w;
}
const core = (o = {}) => ({ settings: { tz: 'Africa/Lagos', remindStart: 10, quietFrom: '22:00', quietTo: '07:00', ...o }, reminders: [] });
// ---- reminders
let w = world();
w.put('data/users/u1/core', core()); w.put('data/users/u1/tasks-2026-11', { tasks: [{ id: 't1', title: 'Write report', date: '2026-11-25', time: '10:00', status: 'todo' }] });
w.subs.u1 = [{ endpoint: 'e1', sub: { endpoint: 'e1' } }];
let r = await runCron(w.deps, NOW);
ok('k1 start-soon alert goes to the phone', w.sentPush.length === 1 && /Write report/.test(w.sentPush[0].body), w.sentPush);
ok('k2 no email when email reminders are off', w.sentMail.length === 0);
await runCron(w.deps, NOW + 60000);
ok('k3 the same reminder is not sent twice', w.sentPush.length === 1, w.sentPush.length);
w.put('data/users/u1/core', core({ emailNotify: true })); w.claimed.clear(); w.sentPush = []; await runCron(w.deps, NOW);
ok('k4 email goes out when switched on, together with the phone alert', w.sentMail.length === 1 && w.sentMail[0].to === 'owner@x.com' && w.sentPush.length === 1, [w.sentMail, w.sentPush.length]);
w = world(); w.put('data/users/u1/core', core()); w.put('data/users/u1/tasks-2026-11', { tasks: [{ id: 't1', title: 'X', date: '2026-11-25', time: '10:00', status: 'todo' }] });
w.subs.u1 = [{ endpoint: 'dead', sub: { endpoint: 'dead' } }, { endpoint: 'live', sub: { endpoint: 'live' } }]; w.dead.add('dead');
await runCron(w.deps, NOW);
ok('k5 a phone that unsubscribed is forgotten, the other still gets it', w.subs.u1.length === 1 && w.sentPush.length === 1, [w.subs, w.sentPush]);
// ---- plan news
w = world();
w.put('people/u1', { name: 'Damola' }); w.put('people/u2', { name: 'Aunty Bisi' }); w.put('people/u3', { name: 'Chi' });
w.put('data/users/u1/core', core()); w.put('data/users/u2/core', core()); w.put('data/users/u3/core', core({ emailNotify: true }));
w.subs.u1 = [{ endpoint: 'p1', sub: { endpoint: 'p1' } }]; w.subs.u2 = [{ endpoint: 'p2', sub: { endpoint: 'p2' } }];
w.put('plans/pl', { id: 'pl', title: 'Family trip', ownerId: 'u1' });
w.put('plan_members/pl_u1', { planId: 'pl', uid: 'u1', status: 'joined' }, NOW - 3600000);
w.put('plan_members/pl_u2', { planId: 'pl', uid: 'u2', status: 'invited' });
await runCron(w.deps, NOW);
ok('n1 invited person is told by phone alert and by email even with email reminders off', w.sentPush.some((p) => p.endpoint === 'p2' && /invited you to "Family trip"/.test(p.body)) && w.sentMail.length === 0 || w.sentMail.some((m) => m.to === 'bola@x.com'), [w.sentPush, w.sentMail]);
ok('n1b ...and it names who invited them', w.sentMail.some((m) => m.to === 'bola@x.com' && /Damola invited you/.test(m.text)), w.sentMail);
w.sentPush = []; w.sentMail = [];
w.put('plan_members/pl_u2', { planId: 'pl', uid: 'u2', status: 'joined' }, NOW);
w.put('plan_tasks/t1', { id: 't1', planId: 'pl', title: 'Book flights', assigneeId: 'u2', createdBy: 'u1', done: false }, NOW);
await runCron(w.deps, NOW);
ok('n2 owner hears someone joined', w.sentPush.some((p) => p.endpoint === 'p1' && /Aunty Bisi joined/.test(p.body)), w.sentPush);
ok('n3 assignee hears about a task given to them', w.sentPush.some((p) => p.endpoint === 'p2' && /Damola gave you "Book flights"/.test(p.body)), w.sentPush);
w.sentPush = [];
w.put('plan_tasks/t1', { id: 't1', planId: 'pl', title: 'Book flights', assigneeId: 'u2', createdBy: 'u1', done: true, doneBy: 'u2', doneAt: 5 }, NOW + 60000);
await runCron(w.deps, NOW + 60000);
ok('n4 owner hears a task was finished by someone else', w.sentPush.length === 1 && w.sentPush[0].endpoint === 'p1' && /Aunty Bisi finished/.test(w.sentPush[0].body), w.sentPush);
w.sentPush = []; await runCron(w.deps, NOW + 120000);
ok('n5 nothing repeats on the next minute', w.sentPush.length === 0, w.sentPush);
w = world(); w.put('plans/pl', { id: 'pl', title: 'T', ownerId: 'u1' }); w.put('plan_tasks/t1', { id: 't1', planId: 'pl', title: 'Old', assigneeId: 'u2', createdBy: 'u1' }, NOW - 3 * 3600000);
w.put('data/users/u2/core', core()); w.subs.u2 = [{ endpoint: 'p2', sub: { endpoint: 'p2' } }]; await runCron(w.deps, NOW);
ok('n6 old plan changes do not alert (no flood after setup)', w.sentPush.length === 0, w.sentPush);
// ---- invites
w = world(); w.put('plans/pl', { id: 'pl', title: 'Family trip', ownerId: 'u1' }); w.put('people/u1', { name: 'Damola' });
let x = await handleInvite(w.deps, 'u2', { planId: 'pl', emails: ['a@x.com'], siteUrl: 'https://s.io/app/' });
ok('m1 only the owner can invite', x.status === 403, x);
x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['New@X.com', 'bola@x.com', 'owner@x.com', 'bad', 'new@x.com'], siteUrl: 'https://damola1-tech.github.io/focus-flow/?x=1#h' });
const st = Object.fromEntries(x.body.results.map((r) => [r.email, r.status]));
ok('m2 new address is emailed (once, lower-cased)', st['new@x.com'] === 'emailed' && w.sentMail.length === 1 && w.invites.length === 1, [st, w.sentMail.length]);
ok('m3 the email carries a personal link and the plan name', /focus-flow\/\?invite=[a-z0-9]{30,}/.test(w.sentMail[0].text) && /Family trip/.test(w.sentMail[0].text) && !/\?x=1/.test(w.sentMail[0].text), w.sentMail[0].text);
ok('m4 existing user is added straight to the plan as invited', st['bola@x.com'] === 'added' && w.docs['plan_members/pl_u2'].status === 'invited', [st, w.docs]);
ok('m5 inviting yourself or a bad address does nothing', st['owner@x.com'] === 'self' && !('bad' in st));
x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['bola@x.com'], siteUrl: 'https://s.io/' }); ok('m6 re-inviting an existing member does not reset them', x.body.results[0].status === 'already');
w.mail.enabled = false; x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['zed@x.com'], siteUrl: 'https://s.io/' });
ok('m7 without email set up it says so and keeps no dangling invite', x.body.results[0].status === 'failed' && !w.invites.some((i) => i.email === 'zed@x.com'), x);
w.mail.enabled = true; w.mail.send = async () => { throw new Error('smtp down'); }; x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['yo@x.com'], siteUrl: 'https://s.io/' });
ok('m8 a mail failure cancels that invite', x.body.results[0].status === 'failed' && !w.invites.some((i) => i.email === 'yo@x.com'), [x, w.invites]);
w.mail.send = async (m) => w.sentMail.push(m); x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['q@x.com'], siteUrl: 'http://insecure.io/' });
ok('m9 refuses a non-https link address', x.status === 400, x);
x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['q@x.com'] }, { SITE_URL: 'https://fixed.io/app' }); ok('m10 the server\'s own address wins over the browser\'s', /fixed\.io\/app\?invite=/.test(w.sentMail.at(-1).text), w.sentMail.at(-1));
w.invites = new Array(30).fill({}); x = await handleInvite(w.deps, 'u1', { planId: 'pl', emails: ['r@x.com'], siteUrl: 'https://s.io/' }); ok('m11 daily invite limit', x.status === 429, x);
// ---- delete account
w = world(); w.put('plans/pl', { id: 'pl', title: 'Mine', ownerId: 'u1' }); w.put('plans/other', { id: 'other', title: 'Theirs', ownerId: 'u2' });
w.put('plan_members/pl_u1', { planId: 'pl', uid: 'u1' }); w.put('plan_members/pl_u2', { planId: 'pl', uid: 'u2' }); w.put('plan_members/other_u1', { planId: 'other', uid: 'u1' }); w.put('plan_members/other_u2', { planId: 'other', uid: 'u2' });
w.put('plan_tasks/t1', { id: 't1', planId: 'pl' }); w.put('plan_tasks/t2', { id: 't2', planId: 'other' });
w.put('data/users/u1/core', {}); w.put('data/users/u1/tasks-2026-11', {}); w.put('data/users/u2/core', {}); w.put('people/u1', { name: 'D' }); w.put('people/u2', { name: 'B' });
await handleDelete(w.deps, 'u1');
const left = Object.keys(w.docs).sort();
ok('d1 everything of theirs is gone, including the plan they own and its tasks', !left.some((p) => /u1|^plans\/pl$|plan_tasks\/t1/.test(p)), left);
ok('d2 other people\'s data and plans survive (they just lose this member)', ['data/users/u2/core', 'people/u2', 'plans/other', 'plan_members/other_u2', 'plan_tasks/t2'].every((p) => left.includes(p)), left);
ok('d3 the sign-in is deleted last', w.deleted.at(-1) === 'USER:u1', w.deleted);
// ---- test button
w = world(); w.subs.u1 = [{ endpoint: 'e', sub: { endpoint: 'e' } }]; x = await handleTest(w.deps, 'u1');
ok('t1 test alert reaches phone and email', x.sent === 2 && w.sentMail.length === 1, x);
console.log('FAILS:', fails); process.exit(fails ? 1 : 0);
