/* ---------- own sign-in and online store (Supabase), used when the page is NOT running inside Claude ----------
   Turned on by config.js (window.FF_CONFIG). It plugs in as the same "user" and "db" the Claude version uses,
   so every screen, plan and sync rule works the same. No library needed: plain fetch. */
var SB = { cfg: null, on: false, session: null, ui: { mode: 'in', msg: '', busy: false }, gate: null, colls: {}, seq: 0, writing: 0, timer: null, pushState: null, pushAsked: false, refreshing: null };
var SB_KEY = 'focusflow.sb.session';
function sbCfg() { var c = window.FF_CONFIG; return c && c.supabaseUrl && c.supabaseAnonKey ? c : null; }
function sbBase() { return SB.cfg.supabaseUrl.replace(/\/+$/, ''); }
function sbLoad() { try { return JSON.parse(localStorage.getItem(SB_KEY) || 'null'); } catch (e) { return null; } }
function sbStore(s) { SB.session = s; try { if (s) localStorage.setItem(SB_KEY, JSON.stringify(s)); else localStorage.removeItem(SB_KEY); } catch (e) { } }
function sbSession(j) {
  if (!j || !j.access_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)), user: j.user || (SB.session && SB.session.user) || {} };
}
function sbMsg(j, status) { return (j && (j.msg || j.error_description || j.message || j.error)) || ('Something went wrong (' + status + ')'); }

async function sbFresh() {
  var s = SB.session; if (!s || !s.refresh_token) return;
  if (s.expires_at - Math.floor(Date.now() / 1000) > 60) return;
  if (!SB.refreshing) {
    SB.refreshing = (async function () {
      try {
        var r = await fetch(sbBase() + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: SB.cfg.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
        var j = await r.json().catch(function () { return null; });
        if (r.ok && j && j.access_token) sbStore(sbSession(j));
        else if (r.status === 400 || r.status === 401) { sbStore(null); location.reload(); }
      } catch (e) { }
      SB.refreshing = null;
    })();
  }
  await SB.refreshing;
}
async function sbReq(path, o) {
  o = o || {};
  var h = { apikey: SB.cfg.supabaseAnonKey, 'Content-Type': 'application/json' };
  if (!o.anon) await sbFresh();
  /* new-style publishable keys (sb_publishable_...) are not JWTs: send them only as apikey, never as a Bearer token */
  if (!o.anon && SB.session) h.Authorization = 'Bearer ' + SB.session.access_token;
  else if (String(SB.cfg.supabaseAnonKey).indexOf('sb_') !== 0) h.Authorization = 'Bearer ' + SB.cfg.supabaseAnonKey;
  if (o.headers) Object.keys(o.headers).forEach(function (k) { h[k] = o.headers[k]; });
  var r = await fetch(sbBase() + path, { method: o.method || 'GET', headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  var txt = await r.text(), j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
  if (!r.ok) { var er = new Error(sbMsg(j, r.status)); er.status = r.status; er.body = j; throw er; }
  return j;
}

/* ---- the server function (invites, test alerts, account deletion) ---- */
function sbFn(action, body) { return sbReq('/functions/v1/focusflow', { method: 'POST', body: Object.assign({ action: action }, body || {}) }); }
function sbWaitSynced() {
  return new Promise(function (res) { var n = 0, t = setInterval(function () { if ((!CL.dirty && !CLX.flushing) || ++n > 30) { clearInterval(t); res(); } }, 200); });
}

/* ---- sign in, create account, reset password, sign out ---- */
async function sbSignIn(email, pw) {
  var j = await sbReq('/auth/v1/token?grant_type=password', { method: 'POST', anon: true, body: { email: email, password: pw } });
  sbStore(sbSession(j));
}
async function sbSignUp(email, pw, name, code, invite) {
  var j = await sbReq('/auth/v1/signup', { method: 'POST', anon: true, body: { email: email, password: pw, data: { name: name, family_code: code || '', invite: invite || '' } } });
  if (j && j.access_token) { sbStore(sbSession(j)); return true; }
  return false; /* the project asks for email confirmation first */
}
async function sbSignOut() {
  try { if (SB.session) await sbReq('/auth/v1/logout', { method: 'POST' }); } catch (e) { }
  sbStore(null);
}

/* ---- the "db" the rest of the app already speaks: documents in one table, kept fresh by polling ---- */
function sbParent(path) { return path.slice(0, path.lastIndexOf('/')); }
function sbWrite(fn) {
  SB.seq++; SB.writing++;
  return fn().then(function (x) { SB.writing--; SB.seq++; return x; }, function (e) { SB.writing--; SB.seq++; throw e; });
}
function sbDocRef(path) {
  return {
    get: async function () {
      var rows = await sbReq('/rest/v1/docs?select=data&path=eq.' + encodeURIComponent(path));
      var r = rows && rows[0];
      return { id: path.split('/').pop(), exists: !!r, data: function () { return r ? r.data : undefined; } };
    },
    set: function (obj) {
      return sbWrite(function () { return sbReq('/rest/v1/docs?on_conflict=path', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { path: path, parent: sbParent(path), data: obj } }); });
    },
    update: async function (obj) { var cur = await this.get(); return this.set(Object.assign({}, cur.exists ? cur.data() : {}, obj)); },
    delete: function () { return sbWrite(function () { return sbReq('/rest/v1/docs?path=eq.' + encodeURIComponent(path), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); }); }
  };
}
async function sbPull(e) {
  var seq = SB.seq;
  try {
    var rows = await sbReq('/rest/v1/docs?select=path,data&order=path&parent=eq.' + encodeURIComponent(e.path));
    if (seq !== SB.seq || SB.writing) { setTimeout(function () { sbPull(e); }, 400); return; } /* a save happened meanwhile: ask again */
    var str = JSON.stringify(rows);
    if (str === e.last) return;
    e.last = str; e.ok = true;
    var cut = e.path.length + 1;
    var snap = { metadata: { fromCache: false }, docs: (rows || []).map(function (r) { return { id: r.path.slice(cut), data: function () { return r.data; } }; }) };
    e.subs.forEach(function (s) { try { s.cb(snap); } catch (x) { } });
  } catch (er) {
    e.subs.forEach(function (s) { if (s.err) try { s.err({ code: er.status === 401 || er.status === 403 ? 'revoked' : 'unavailable' }); } catch (x) { } });
  }
}
function sbPullAll() { Object.keys(SB.colls).forEach(function (k) { sbPull(SB.colls[k]); }); }
function sbDb() {
  return {
    collection: function (path) {
      return {
        onSnapshot: function (cb, err) {
          var e = SB.colls[path] || (SB.colls[path] = { path: path, subs: [], last: null });
          e.subs.push({ cb: cb, err: err }); e.last = null; sbPull(e);
          if (!SB.timer) {
            SB.timer = setInterval(function () { if (!document.hidden) sbPullAll(); }, 6000);
            document.addEventListener('visibilitychange', function () { if (!document.hidden) sbPullAll(); });
            window.addEventListener('online', sbPullAll);
          }
          return function () { e.subs = e.subs.filter(function (s) { return s.cb !== cb; }); };
        },
        doc: function (id) { return sbDocRef(path + '/' + id); }
      };
    },
    doc: function (path) { return sbDocRef(path); }
  };
}
function sbInstall() {
  var db = sbDb();
  var user = {
    id: async function () { return SB.session.user.id; },
    me: async function () { return { name: (SB.session.user.user_metadata || {}).name || '' }; },
    can: async function () { return true; }, isOwner: async function () { return false; }, canEdit: async function () { return true; },
    profiles: async function () { return {}; }, search: async function () { return []; }
  };
  window.claude = { use: async function (n) { return n === 'user' ? user : n === 'db' ? db : null; } };
  SB.on = true;
}

/* ---- the sign-in screen ---- */
function sbGateHtml() {
  var m = SB.ui.mode, up = m === 'up', rs = m === 'reset', np = m === 'newpw', inv = !!SB.ui.invite;
  if (np) return '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(true) +
    '<form class="card" data-f="sbAuth"><h2>Choose a new password</h2>' +
    '<div class="field"><label for="sbPass">New password</label><input id="sbPass" type="password" required minlength="6" autocomplete="new-password"></div>' +
    '<div class="field"><label for="sbPass2">Type it again</label><input id="sbPass2" type="password" required minlength="6" autocomplete="new-password"></div>' +
    (SB.ui.msg ? '<p class="small" role="status" style="color:var(--danger,#c0392b)">' + esc(SB.ui.msg) + '</p>' : '') +
    '<button class="btn primary" type="submit"' + (SB.ui.busy ? ' disabled' : '') + '>' + (SB.ui.busy ? 'Please wait…' : 'Save new password') + '</button></form></div>';
  return '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(true) +
    '<form class="card" data-f="sbAuth"><h2>' + (rs ? 'Reset your password' : up ? 'Create your account' : 'Sign in') + '</h2>' +
    (up ? '<div class="field"><label for="sbName">Your name</label><input id="sbName" type="text" required autocomplete="name" value="' + esc(SB.ui.name || '') + '"></div>' : '') +
    (up && inv ? '<p class="small">You were invited to join Focus Flow. Create your account with the email the invite was sent to.</p>' : '') +
    '<div class="field"><label for="sbEmail">Email</label><input id="sbEmail" type="email" required autocomplete="email" value="' + esc(SB.ui.email || '') + '"' + (up && inv ? ' readonly' : '') + '></div>' +
    (rs ? '' : '<div class="field"><label for="sbPass">Password</label><input id="sbPass" type="password" required minlength="6" autocomplete="' + (up ? 'new-password' : 'current-password') + '"></div>') +
    (up && !inv ? '<div class="field"><label for="sbCode">Family code</label><input id="sbCode" type="text" required autocomplete="off" value="' + esc(SB.ui.code || '') + '" placeholder="Ask the person who invited you"></div>' : '') +
    (SB.ui.msg ? '<p class="small" role="status" style="color:' + (SB.ui.ok ? 'var(--ok,#1a7f4b)' : 'var(--danger,#c0392b)') + '">' + esc(SB.ui.msg) + '</p>' : '') +
    '<button class="btn primary" type="submit"' + (SB.ui.busy ? ' disabled' : '') + '>' + (SB.ui.busy ? 'Please wait…' : rs ? 'Send reset email' : up ? 'Create account' : 'Sign in') + '</button>' +
    '<div class="acts">' + (up || rs ? '<button type="button" class="btn sm ghost" data-a="sbMode" data-m="in">I already have an account</button>' : '<button type="button" class="btn sm ghost" data-a="sbMode" data-m="up">Create an account</button><button type="button" class="btn sm ghost" data-a="sbMode" data-m="reset">Forgot password</button>') + '</div></form></div>';
}
function sbGateShow() { $('#app').innerHTML = sbGateHtml(); }
A.sbMode = function (el) { SB.ui.mode = el.dataset.m; SB.ui.msg = ''; var e = $('#sbEmail'); if (e) SB.ui.email = e.value; sbGateShow(); };
F.sbAuth = async function (f) {
  if (SB.ui.busy) return;
  var email = (val(f, 'sbEmail') || '').trim(), m = SB.ui.mode;
  if (m === 'newpw') {
    if (val(f, 'sbPass') !== val(f, 'sbPass2')) { SB.ui.msg = 'The two passwords are not the same.'; sbGateShow(); return; }
    SB.ui.busy = true; SB.ui.msg = ''; sbGateShow();
    try { await sbReq('/auth/v1/user', { method: 'PUT', body: { password: val(f, 'sbPass') } }); SB.ui.busy = false; SB.ui.mode = 'in'; if (SB.gate) SB.gate(); return; }
    catch (e) { SB.ui.busy = false; SB.ui.msg = String(e.message || 'Could not save the new password.'); sbGateShow(); return; }
  } SB.ui.email = email; SB.ui.name = val(f, 'sbName') || SB.ui.name; SB.ui.code = val(f, 'sbCode') || SB.ui.code; SB.ui.busy = true; SB.ui.msg = ''; SB.ui.ok = false; sbGateShow();
  try {
    if (m === 'reset') { await sbReq('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { method: 'POST', anon: true, body: { email: email } }); SB.ui.msg = 'If that email has an account, a reset link is on its way.'; SB.ui.ok = true; }
    else if (m === 'up') {
      var started = await sbSignUp(email, val(f, 'sbPass'), (val(f, 'sbName') || '').trim(), (val(f, 'sbCode') || '').trim(), SB.ui.invite);
      if (!started) { SB.ui.msg = 'Almost done. Open the email we sent you to confirm, then sign in.'; SB.ui.ok = true; SB.ui.mode = 'in'; }
    } else await sbSignIn(email, val(f, 'sbPass'));
  } catch (e) {
    var t = String(e.message || '');
    SB.ui.msg = /database error|family|code/i.test(t) ? 'That family code is not right.' : /invalid login/i.test(t) ? 'Wrong email or password.' : /already|registered/i.test(t) ? 'That email already has an account. Try signing in.' : t;
  }
  SB.ui.busy = false;
  if (SB.session) { if (SB.gate) SB.gate(); } else sbGateShow();
};
/* called by boot: returns once somebody is signed in */
async function sbBoot() {
  SB.cfg = sbCfg(); if (!SB.cfg) return false;
  sbStore(sbLoad());
  try { var q = new URLSearchParams(location.search), c = q.get('code'); if (c) { SB.ui.mode = 'up'; SB.ui.code = c.trim(); } } catch (e) { }
  /* a link from an email lands here with the sign-in details after the # (password reset, or confirming an email) */
  try {
    var hp = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hp.get('error_description')) { SB.ui.msg = /expired|invalid/i.test(hp.get('error_description')) ? 'That link has expired or was already used. Ask for a new one.' : hp.get('error_description'); SB.ui.ok = false; history.replaceState(null, '', location.pathname + location.search); }
    else if (hp.get('access_token')) {
      var ns = { access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token'), expires_at: +hp.get('expires_at') || (Math.floor(Date.now() / 1000) + (+hp.get('expires_in') || 3600)), user: {} };
      history.replaceState(null, '', location.pathname + location.search);
      sbStore(ns);
      try { var uj = await sbReq('/auth/v1/user'); ns.user = uj; sbStore(ns); } catch (e) { sbStore(null); }
      if (SB.session && hp.get('type') === 'recovery') SB.ui.mode = 'newpw';
    }
  } catch (e) { }
  /* an invite link: ?invite=TOKEN. The server says which email it is for. */
  try {
    var itok = new URLSearchParams(location.search).get('invite');
    if (itok && !SB.session) {
      var em = await sbReq('/rest/v1/rpc/invite_lookup', { method: 'POST', anon: true, body: { t: itok } });
      if (em) { SB.ui.mode = 'up'; SB.ui.invite = itok; SB.ui.email = em; }
      else { SB.ui.mode = 'in'; SB.ui.msg = 'That invite link is no longer valid. Ask for a new one, or sign in if you already have an account.'; SB.ui.ok = false; }
    }
  } catch (e) { }
  if (SB.session) { await sbFresh(); if (!SB.session) { location.reload(); return false; } }
  if (SB.session && SB.ui.mode === 'newpw') { await new Promise(function (res) { SB.gate = res; sbGateShow(); }); }
  else if (!SB.session) { await new Promise(function (res) { SB.gate = res; sbGateShow(); }); }
  sbInstall(); sbPushRefresh();
  return true;
}

/* ---- phone alerts (web push) ---- */
function sbB64(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(b), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
async function sbPushRefresh() {
  var st;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) st = 'unsupported';
  else if (!SB.cfg.vapidPublicKey) st = 'noserver';
  else if (Notification.permission === 'denied') st = 'denied';
  else { try { var reg = await navigator.serviceWorker.getRegistration(); var sub = reg && await reg.pushManager.getSubscription(); st = sub ? 'on' : 'off'; } catch (e) { st = 'off'; } }
  if (st !== SB.pushState) { SB.pushState = st; if (U.view === 'settings' && !U.overlay) rerender(); }
}
A.sbPushOn = async function () {
  try {
    var reg = await navigator.serviceWorker.ready;
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications were not allowed on this phone'); sbPushRefresh(); return; }
    var sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: sbB64(SB.cfg.vapidPublicKey) });
    await sbReq('/rest/v1/push_subs?on_conflict=endpoint', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { endpoint: sub.endpoint, user_id: SB.session.user.id, sub: sub.toJSON() } });
    SB.pushState = 'on'; toast('Phone alerts are on'); render();
  } catch (e) { toast('Could not turn on phone alerts: ' + (e.message || 'try again')); }
};
A.sbPushOff = async function () {
  try {
    var reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sbReq('/rest/v1/push_subs?endpoint=eq.' + encodeURIComponent(sub.endpoint), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(function () { }); await sub.unsubscribe(); }
    SB.pushState = 'off'; toast('Phone alerts are off'); render();
  } catch (e) { toast('Could not turn off phone alerts'); }
};
A.sbPushTest = async function () {
  try {
    var r = await sbFn('test');
    toast(r && r.sent ? 'Test sent. It should arrive in a few seconds.' : 'Nothing was sent. Turn on phone alerts or email reminders first.');
  } catch (e) { toast('Test failed: ' + (e.message || 'server not set up yet')); }
};
A.sbSignOut = async function () { await sbSignOut(); location.reload(); };
function sbAccountCard() {
  var p = P(), d = D(), em = (SB.session && SB.session.user && SB.session.user.email) || '', st = SB.pushState;
  var push = st === 'on' ? '<p class="small">Phone alerts are <b>on</b> for this device. You get reminders even when Focus Flow is closed.</p><div class="acts"><button class="btn" data-a="sbPushTest">Send a test alert</button><button class="btn ghost" data-a="sbPushOff">Turn off on this device</button></div>'
    : st === 'off' ? '<p class="small">Get reminders on this phone even when Focus Flow is closed.</p><div class="acts"><button class="btn primary" data-a="sbPushOn">Turn on phone alerts</button></div>'
    : st === 'denied' ? '<p class="small">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>'
    : st === 'noserver' ? '<p class="small muted">Phone alerts are not set up on the server yet.</p>'
    : st === 'unsupported' ? '<p class="small muted">This browser cannot receive phone alerts. On an iPhone, first use Share then Add to Home Screen, and open Focus Flow from the home screen icon.</p>'
    : '<p class="small muted">Checking…</p>';
  return '<section class="card"><h2>Your account</h2><p class="small">Signed in as <b>' + esc(em) + '</b>. Your tasks, goals and settings are saved online and follow you to every phone or computer.</p>' +
    '<div class="kv small"><span class="muted">Status</span><b>' + esc(CL.status || 'Connected') + '</b></div>' +
    '<h3>Phone alerts</h3>' + push +
    '<div class="acts"><button class="btn" data-a="showBackup">' + (U.backup ? 'Hide backup' : 'Show backup text') + '</button><button class="btn" data-a="sbSignOut">Sign out</button><button class="btn danger" data-a="askDelProfile">Delete my account</button></div>' +
    (U.backup ? '<pre class="box" id="backupText">' + esc(JSON.stringify({ profile: p, data: d })) + '</pre><div class="acts"><button class="btn sm" data-a="copyBackup">Copy</button></div>' : '') +
    '<div class="field"><label for="importBox">Restore from a backup</label><textarea id="importBox" placeholder="Paste backup text here"></textarea></div><div class="acts"><button class="btn" data-a="importBackup">Restore</button></div></section>';
}

/* ---- invite by email (shown to the plan's owner) ---- */
function sbInviteBox(pl) {
  return '<div class="field" style="margin-top:8px"><label for="invEmails">Invite by email</label>' +
    '<textarea id="invEmails" rows="2" placeholder="name@example.com, another@example.com"></textarea>' +
    '<span class="small muted">People who already use Focus Flow get a notice. New people get an email with their own link to join.</span></div>' +
    '<div class="acts"><button class="btn sm" data-a="sbInviteEmail" data-plan="' + pl.id + '">Send invites</button></div>';
}
A.sbInviteEmail = async function (el) {
  var box = $('#invEmails'); if (!box) return;
  var list = (box.value || '').split(/[\s,;]+/).filter(function (x) { return /^\S+@\S+\.\S+$/.test(x); });
  if (!list.length) { toast('Type one or more email addresses'); return; }
  toast('Sending invites…');
  try {
    await sbWaitSynced();
    var r = await sbFn('invite', { planId: el.dataset.plan, emails: list, siteUrl: location.origin + location.pathname });
    var res = (r && r.results) || [], sent = res.filter(function (x) { return x.status === 'emailed' || x.status === 'added'; }).length, bad = res.filter(function (x) { return x.status === 'failed'; });
    box.value = '';
    toast(sent + ' invite' + (sent === 1 ? '' : 's') + ' sent' + (bad.length ? '. Could not email: ' + bad.map(function (x) { return x.email; }).join(', ') : ''), 7000);
  } catch (e) { toast('Could not send invites: ' + (e.message || 'server not set up yet'), 7000); }
};
/* ---- delete the whole account ---- */
async function sbDeleteAccount() {
  try { await sbFn('deleteAccount'); } catch (e) { toast('Your data is deleted, but the sign-in could not be removed. Please tell the person who runs Focus Flow.', 8000); }
  sbStore(null);
  try { localStorage.removeItem(LS_KEY); } catch (e) { }
  location.reload();
}
