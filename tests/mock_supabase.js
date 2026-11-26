// A tiny pretend Supabase for tests: sign-up with a family code, password sign-in, the docs table with the
// same access rules as schema.sql, push_subs, and a stub reminders function. Also serves ../pwa as the app.
const http = require('http'), fs = require('fs'), path = require('path');
const PWA = path.join(__dirname, '..', 'pwa');
const state = { users: {}, docs: {}, subs: {}, tests: 0, FAMILY: 'ABC123', invites: { goodtok: { email: 'invitee@x.com', plan: 'pl9' } }, fn: [], deleted: [] };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
const SHARED = ['plans', 'plan_members', 'plan_tasks'];
const parent = (p) => p.slice(0, p.lastIndexOf('/'));
const mine = (uid, p) => p.startsWith(`data/users/${uid}/`);
const canRead = (uid, p) => mine(uid, p) || ['people', ...SHARED].includes(parent(p));
const canWrite = (uid, p) => mine(uid, p) || p === `people/${uid}` || SHARED.includes(parent(p));
const session = (u) => ({ access_token: 'tok.' + u.id, refresh_token: 'ref.' + u.id, expires_in: 3600, user: { id: u.id, email: u.email, user_metadata: { name: u.name } } });
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    let j = null; try { j = body ? JSON.parse(body) : null; } catch (e) { }
    const tok = (req.headers.authorization || '').replace('Bearer ', ''), uid = tok.startsWith('tok.') ? tok.slice(4) : null;
    const p = url.pathname;
    if ((req.headers.authorization || '').startsWith('Bearer sb_')) return send(res, 401, { message: 'Invalid JWT' });
    if (p === '/__db') return send(res, 200, { docs: state.docs, subs: state.subs, users: state.users, tests: state.tests, fn: state.fn, deleted: state.deleted });
    if (p === '/auth/v1/signup') {
      const code = ((j.data && j.data.family_code) || '').trim().toLowerCase();
      const inv = state.invites[(j.data && j.data.invite) || ''];
      if (!(inv && inv.email === j.email) && code !== state.FAMILY.toLowerCase()) return send(res, 500, { msg: 'Database error saving new user' });
      if (Object.values(state.users).some((u) => u.email === j.email)) return send(res, 422, { msg: 'User already registered' });
      const u = { id: 'u' + (Object.keys(state.users).length + 1), email: j.email, pw: j.password, name: (j.data && j.data.name) || '' };
      state.users[u.id] = u; return send(res, 200, session(u));
    }
    if (p === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') { const u = state.users[(j.refresh_token || '').slice(4)]; return u ? send(res, 200, session(u)) : send(res, 400, { msg: 'bad refresh' }); }
      const u = Object.values(state.users).find((x) => x.email === j.email && x.pw === j.password);
      return u ? send(res, 200, session(u)) : send(res, 400, { error_description: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/logout') return send(res, 204);
    if (p === '/auth/v1/user') {
      const u = state.users[uid]; if (!u) return send(res, 401, { msg: 'bad jwt' });
      if (req.method === 'PUT') { u.pw = j.password; return send(res, 200, { id: u.id, email: u.email }); }
      return send(res, 200, { id: u.id, email: u.email, user_metadata: { name: u.name } });
    }
    if (p === '/rest/v1/rpc/invite_lookup') { const i = state.invites[j.t]; return send(res, 200, i ? i.email : null); }
    if (p === '/auth/v1/recover') return send(res, 200, {});
    if (p === '/functions/v1/focusflow') {
      if (!uid) return send(res, 401, { error: 'not signed in' }); state.fn.push(j);
      if (j.action === 'test') { state.tests++; return send(res, 200, { sent: 1 }); }
      if (j.action === 'invite') return send(res, 200, { results: j.emails.map((e) => ({ email: e, status: 'emailed' })) });
      if (j.action === 'coachStatus') return send(res, 200, { enabled: !state.noAi, daily: 60 });
      if (j.action === 'coach') {
        state.coachCalls = (state.coachCalls || 0) + 1;
        if (state.coachCalls > (state.coachMax || 99)) return send(res, 429, { error: 'daily_limit' });
        const last = j.messages[j.messages.length - 1], tr = Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result';
        if (tr) return send(res, 200, { content: [{ type: 'text', text: 'Done, I added it.' }], stop_reason: 'end_turn' });
        if (/walk/.test(String(last.content))) return send(res, 200, { content: [{ type: 'text', text: 'Adding it.' }, { type: 'tool_use', id: 'tu1', name: 'add_task', input: { title: 'Evening walk', minutes: 20, time: '17:00' } }], stop_reason: 'tool_use' });
        if (/JSON object/.test(String(j.messages[0].content))) return send(res, 200, { content: [{ type: 'text', text: 'Sure: {"say":"Kept it light.","changes":[],"add":[]}' }], stop_reason: 'end_turn' });
        return send(res, 200, { content: [{ type: 'text', text: 'Start with the most important task.' }], stop_reason: 'end_turn' });
      }
      if (j.action === 'deleteAccount') { state.deleted.push(uid); delete state.users[uid]; return send(res, 200, { ok: true }); }
      return send(res, 400, {});
    }
    if (p === '/rest/v1/push_subs') {
      if (!uid) return send(res, 401, { message: 'JWT' });
      if (req.method === 'POST') { state.subs[j.endpoint] = j; return send(res, 201); }
      if (req.method === 'DELETE') { delete state.subs[(url.searchParams.get('endpoint') || '').replace('eq.', '')]; return send(res, 204); }
    }
    if (p === '/rest/v1/docs') {
      if (!uid) return send(res, 401, { message: 'JWT expired or missing' });
      const f = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
      if (req.method === 'GET') {
        const rows = Object.keys(state.docs).sort().filter((k) => canRead(uid, k) && (f('parent') === null || parent(k) === f('parent')) && (f('path') === null || k === f('path'))).map((k) => ({ path: k, data: state.docs[k] }));
        return send(res, 200, rows);
      }
      if (req.method === 'POST') { if (!canWrite(uid, j.path) || parent(j.path) !== j.parent) return send(res, 403, { message: 'row-level security' }); state.docs[j.path] = j.data; return send(res, 201); }
      if (req.method === 'DELETE') { const k = f('path'); if (!canWrite(uid, k)) return send(res, 403, { message: 'row-level security' }); delete state.docs[k]; return send(res, 204); }
    }
    if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end("window.FF_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'sb_publishable_test',vapidPublicKey:'" + (process.env.VAPID || '') + "'};"); }
    let f = path.join(PWA, p === '/' ? 'index.html' : p);
    if (!f.startsWith(PWA) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
}).listen(+process.env.PORT || 8799, () => console.log('mock up'));
