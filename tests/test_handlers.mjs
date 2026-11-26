import { runCron, handleInvite, handleDelete, handleTest, handleCoach, handleCoachStatus, cleanMessages, toOpenAI, fromOpenAI } from '../supabase/functions/focusflow/handlers.js';
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
// ---- nudges through the cron job
{
  const w2 = world(); const AM = Date.UTC(2026, 10, 25, 7, 2);   // 08:02 Lagos
  w2.put('data/users/u1/core', core()); w2.put('data/users/u1/tasks-2026-11', { tasks: [{ id: 'a', title: 'A', date: '2026-11-25', time: '10:00', status: 'todo' }] });
  w2.subs.u1 = [{ endpoint: 'e1', sub: { endpoint: 'e1' } }];
  await runCron(w2.deps, AM); await runCron(w2.deps, AM + 60000); await runCron(w2.deps, AM + 120000);
  ok('k20 morning message is sent exactly once across the window', w2.sentPush.filter((x) => x.title === 'Good morning').length === 1, w2.sentPush);
  const w3 = world(); w3.put('data/users/u1/core', core({ morningAt: '' })); w3.subs.u1 = [{ endpoint: 'e1', sub: { endpoint: 'e1' } }];
  await runCron(w3.deps, AM);
  ok('k21 nothing is sent when the morning message is off', w3.sentPush.length === 0, w3.sentPush);
}
// ---- AI coach
{
  const w4 = world(); const calls = []; let used = 0;
  w4.store.aiUse = async () => ++used;
  w4.deps.ai = { enabled: true, complete: async (a) => { calls.push(a); return { content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' }; } };
  let r2 = await handleCoach(w4.deps, 'u1', { messages: [{ role: 'user', content: 'plan my day' }] }, { COACH_DAILY: 3 });
  ok('c1 coach answers and passes the messages to the model', r2.status === 200 && r2.body.content[0].text === 'Hi' && calls.length === 1 && calls[0].messages.length === 1, r2);
  ok('c2 junk is refused', (await handleCoach(w4.deps, 'u1', { messages: 'x' }, {})).status === 400 && (await handleCoach(w4.deps, 'u1', { messages: [{ role: 'system', content: 'x' }] }, {})).status === 400);
  ok('c3 must start with the person', (await handleCoach(w4.deps, 'u1', { messages: [{ role: 'assistant', content: 'x' }] }, {})).status === 400);
  ok('c4 oversized input is refused', cleanMessages([{ role: 'user', content: 'a'.repeat(12000) }, { role: 'assistant', content: 'a'.repeat(12000) }, { role: 'user', content: 'a'.repeat(12000) }, { role: 'assistant', content: 'a'.repeat(12000) }]) === null);
  used = 2; r2 = await handleCoach(w4.deps, 'u1', { messages: [{ role: 'user', content: 'x' }] }, { COACH_DAILY: 3 });
  ok('c5 third call of three is allowed', r2.status === 200 && r2.body.left === 0, r2);
  r2 = await handleCoach(w4.deps, 'u1', { messages: [{ role: 'user', content: 'x' }] }, { COACH_DAILY: 3 });
  ok('c6 over the daily allowance gets 429 and no model call', r2.status === 429 && calls.length === 2, r2);
  w4.deps.ai = { enabled: false };
  ok('c7 no key set on the server', (await handleCoach(w4.deps, 'u1', { messages: [{ role: 'user', content: 'x' }] }, {})).status === 503 && (await handleCoachStatus(w4.deps, 'u1', {})).enabled === false);
  w4.deps.ai = { enabled: true, complete: async () => { throw new Error('boom'); } }; used = 0;
  ok('c8 model failure is a clean 502', (await handleCoach(w4.deps, 'u1', { messages: [{ role: 'user', content: 'x' }] }, {})).status === 502);
  const tm = cleanMessages([{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'add_task', input: { title: 'a' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] }]);
  ok('c9 tool-use turns are accepted', tm && tm.length === 3 && tm[1].content[0].type === 'tool_use', tm);
  ok('c10 unknown block types are refused', cleanMessages([{ role: 'user', content: [{ type: 'image', source: {} }] }]) === null);
}
// ---- OpenAI-compatible translation (Gemini, Groq, ...)
{
  const t = toOpenAI('SYS', [{ role: 'user', content: 'plan' }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'c1', name: 'add_task', input: { title: 'a' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] }],
    [{ name: 'add_task', description: 'd', input_schema: { type: 'object', properties: {} } }]);
  ok('o1 system first, then turns in order', t.messages[0].role === 'system' && t.messages[1].content === 'plan' && t.messages.length === 4, t.messages);
  ok('o2 tool call is translated with JSON arguments', t.messages[2].tool_calls[0].function.arguments === '{"title":"a"}' && t.messages[2].tool_calls[0].id === 'c1', t.messages[2]);
  ok('o3 tool result becomes a tool message', t.messages[3].role === 'tool' && t.messages[3].tool_call_id === 'c1', t.messages[3]);
  ok('o4 tools become functions', t.tools[0].type === 'function' && t.tools[0].function.name === 'add_task' && t.tools[0].function.parameters.type === 'object', t.tools);
  ok('o5 no tools key when none', !('tools' in toOpenAI('', [{ role: 'user', content: 'x' }], [])));
  let f = fromOpenAI({ choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] });
  ok('o6 plain answer', f.stop_reason === 'end_turn' && f.content[0].text === 'Hello', f);
  f = fromOpenAI({ choices: [{ message: { content: null, tool_calls: [{ id: 'z', function: { name: 'add_task', arguments: '{"title":"w","minutes":20}' } }] }, finish_reason: 'tool_calls' }] });
  ok('o7 tool call answer', f.stop_reason === 'tool_use' && f.content[0].type === 'tool_use' && f.content[0].input.minutes === 20, f);
  f = fromOpenAI({ choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: 'not json' } }] } }] });
  ok('o8 broken arguments do not crash', f.content[0].input && Object.keys(f.content[0].input).length === 0, f);
  ok('o9 cut-off answers are flagged', fromOpenAI({ choices: [{ message: { content: 'a' }, finish_reason: 'length' }] }).stop_reason === 'max_tokens');
  ok('o10 empty reply does not crash', fromOpenAI({}).content.length === 0);
}
console.log('FAILS:', fails); process.exit(fails ? 1 : 0);
