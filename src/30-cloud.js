/* ---------- cloud: sign-in through Claude, data on every device, shared plans across phones ---------- */
var CLX = { db: null, user: null, lastP: {}, lastShared: {}, lastPeople: '', raw: { people: {}, plans: {}, members: {}, tasks: {} }, first: {}, flushT: null, flushing: false, again: false, reapply: false, restale: false, applying: false, legacy: [], loadT: null };
CL.phase = 'ready';

function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]); }
var jclone = function (o) { return JSON.parse(JSON.stringify(o)); };

/* true when the page runs inside a signed-in Claude viewer and the cloud store answers */
async function cloudInit() {
  if (typeof window.claude === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return false;
  try {
    var user = await withTimeout(window.claude.use('user'), 6000);
    var db = await withTimeout(window.claude.use('db'), 6000);
    if (!user || !db) return false;
    var uid = await withTimeout(user.id(), 6000);
    if (!uid) return false;
    var me = await withTimeout(user.me(), 4000);
    CLX.db = db; CLX.user = user;
    CL.on = true; CL.uid = uid; CL.meName = (me && me.name) || '';
    CLX.legacy = (S.profiles || []).map(function (p) { return { profile: p, data: S.data[p.id] }; }).filter(function (x) { return x.data; });
    LS_KEY = 'focusflow.cloud.' + uid;
    S = loadAll(LS_KEY) || { v: 1, profiles: [], activeId: null, data: {}, shared: [] };
    S.shared = S.shared || [];
    if (S.data[uid] && S.profiles.length) { S.activeId = uid; ensureData(S.data[uid]); CL.phase = 'ready'; } else { S.profiles = []; S.activeId = null; S.data = {}; CL.phase = 'loading'; }
    try { CL.canWrite = await withTimeout(user.can('data.write'), 3000); } catch (e) { CL.canWrite = null; }
    cloudSubscribe();
    return true;
  } catch (e) { return false; }
}

function cloudErr(e) {
  var code = (e && e.code) || 'error';
  if (code === 'revoked') { CL.status = 'Access to saved data was withdrawn'; CL.writeError = 'revoked'; }
  else if (code !== 'unavailable') CL.status = 'Online storage problem (' + code + ')';
  rerender();
}
function rerender(force) {
  var ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  if (force || (!U.overlay && !typing)) render();
}

function cloudSubscribe() {
  var db = CLX.db, uid = CL.uid;
  CLX.loadT = setTimeout(function () {
    if (CL.phase === 'loading') { CL.phase = 'error'; render(); }
  }, 12000);
  db.collection('data/users/' + uid).onSnapshot(onPersonal, cloudErr);
  db.collection('people').onSnapshot(function (snap) {
    var m = {}; snap.docs.forEach(function (d) { m[d.id] = jclone(d.data()); });
    CL.dir = m; CL.dirReady = true; registerMe(); if (U.view === 'shared') rerender();
  }, cloudErr);
  ['plans', 'plan_members', 'plan_tasks'].forEach(function (name) {
    var key = name === 'plans' ? 'plans' : name === 'plan_members' ? 'members' : 'tasks';
    db.collection(name).onSnapshot(function (snap) {
      var m = {}; snap.docs.forEach(function (d) { m[d.id] = jclone(d.data()); });
      CLX.raw[key] = m; CLX.first[key] = true;
      if (CLX.first.plans && CLX.first.members && CLX.first.tasks) { CL.sharedReady = true; rebuildShared(); }
    }, cloudErr);
  });
}

/* ---- your own data: one "core" document plus tasks grouped by month ---- */
function taskChunk(t) { return 'tasks-' + (t.date ? t.date.slice(0, 7) : 'none'); }
function splitData(d) {
  var docs = {}, core = {};
  Object.keys(d).forEach(function (k) { if (k !== 'tasks') core[k] = d[k]; });
  var cut = Date.now() - 2 * 86400000;
  core.reminders = (core.reminders || []).filter(function (r) { return !r.fired || r.at > cut; });
  core.chat = (core.chat || []).slice(-20).map(function (m) { return { role: m.role, content: String(m.content || '').slice(0, 3000) }; });
  docs.core = core;
  d.tasks.forEach(function (t) { var k = taskChunk(t); (docs[k] = docs[k] || { tasks: [] }).tasks.push(t); });
  return docs;
}
function mergeData(docs) {
  var d = jclone(docs.core), seen = {};
  Object.keys(docs).forEach(function (id) {
    if (id.indexOf('tasks-') !== 0) return;
    (docs[id].tasks || []).forEach(function (t) {
      var ok = taskChunk(t) === id;
      if (!seen[t.id] || (ok && !seen[t.id].ok)) seen[t.id] = { t: t, ok: ok };
    });
  });
  d.tasks = Object.keys(seen).map(function (k) { return jclone(seen[k].t); });
  return ensureData(d);
}
function onPersonal(snap) {
  var docs = {}; snap.docs.forEach(function (d) { docs[d.id] = jclone(d.data()); });
  CLX.remoteP = docs; CLX.personalMeta = snap.metadata;
  if (!docs.core) {
    if (snap.metadata && snap.metadata.fromCache === false && !S.data[CL.uid]) { clearTimeout(CLX.loadT); CL.phase = 'ready'; CL.isNew = true; CL.personalReady = true; startNew(); }
    else if (S.data[CL.uid]) { CL.personalReady = true; if (snap.metadata && snap.metadata.fromCache === false) cloudDirty(); }
    return;
  }
  CL.isNew = false;
  if (S.pendingSync && !CLX.pulledOnce) { CLX.pulledOnce = true; CLX.lastP = {}; Object.keys(docs).forEach(function (k) { CLX.lastP[k] = JSON.stringify(docs[k]); }); cloudDirty(); CL.personalReady = true; return; }
  CLX.pulledOnce = true;
  applyPersonal();
}
function applyPersonal() {
  if (CL.dirty || CLX.flushing) { CLX.reapply = true; return; }
  var docs = CLX.remoteP; if (!docs || !docs.core) return;
  var strs = {}, same = true, k;
  Object.keys(docs).forEach(function (id) { strs[id] = JSON.stringify(docs[id]); if (CLX.lastP[id] !== strs[id]) same = false; });
  Object.keys(CLX.lastP).forEach(function (id) { if (strs[id] === undefined) same = false; });
  var first = !CL.personalReady;
  if (same && !first) return;
  var d = mergeData(docs), prof = d.profile || { name: CL.meName || 'Me', color: THEMES[0].c, accent: 'indigo' };
  CLX.applying = true;
  S.profiles = [Object.assign({ id: CL.uid, email: '', createdAt: Date.now() }, prof, { id: CL.uid })];
  S.data = {}; S.data[CL.uid] = d; S.activeId = CL.uid;
  CLX.lastP = strs; CL.personalReady = true; clearTimeout(CLX.loadT); CL.phase = 'ready'; CL.status = 'Saved online';
  save(); CLX.applying = false;
  if (first) maybeCheckin();
  applyTheme(); registerMe(); reconcileShared();
  if (!U.wiz && !U.picker) rerender(first);
}
function startNew() {
  CL.status = 'New account';
  if (CLX.legacy.length) { U.importAsk = true; }
  else { U.wiz = newWiz(); }
  U.picker = true; render();
}

function cloudDirty() {
  if (CLX.applying || !CL.on) return;
  CL.dirty = true; S.pendingSync = true;
  clearTimeout(CLX.flushT); CLX.flushT = setTimeout(cloudFlush, 700);
}
async function cloudFlush() {
  if (!CL.on) return;
  if (CLX.flushing) { CLX.again = true; return; }
  CLX.flushing = true;
  try {
    do {
      CLX.again = false;
      await flushPersonal(); await flushShared(); await registerMe();
    } while (CLX.again);
    CL.dirty = false; S.pendingSync = false; CL.writeError = ''; CL.status = 'Saved online';
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
  } catch (e) {
    CL.writeError = (e && e.code) || 'error'; CL.status = CL.writeError === 'invalid_argument' ? 'Not allowed to save' : 'Could not save yet';
    clearTimeout(CLX.flushT); if (CL.writeError !== 'invalid_argument') CLX.flushT = setTimeout(cloudFlush, 15000); else CL.dirty = false;
    rerender();
  }
  CLX.flushing = false;
  if (CLX.reapply) { CLX.reapply = false; applyPersonal(); }
  if (CLX.restale) { CLX.restale = false; rebuildShared(); }
}
async function flushPersonal() {
  var uid = CL.uid, d = S.data[uid]; if (!d) return;
  var p = S.profiles[0]; if (p) d.profile = { name: p.name, email: p.email || '', color: p.color, accent: p.accent || themeOf(p.color).k };
  var docs = splitData(d), base = 'data/users/' + uid + '/', id;
  for (id in docs) {
    var str = JSON.stringify(docs[id]);
    if (CLX.lastP[id] !== str) { await CLX.db.doc(base + id).set(JSON.parse(str)); CLX.lastP[id] = str; }
  }
  for (id in CLX.lastP) if (!docs[id]) { await CLX.db.doc(base + id).delete(); delete CLX.lastP[id]; }
}
async function registerMe() {
  var p = S.profiles[0]; if (!CL.on || !p || CL.writeError === 'invalid_argument') return;
  var o = { name: p.name, color: p.color, accent: p.accent || themeOf(p.color).k }, str = JSON.stringify(o);
  if (CLX.lastPeople === str) return;
  CLX.lastPeople = str;
  try { await CLX.db.doc('people/' + CL.uid).set(Object.assign({ at: Date.now() }, o)); } catch (e) { CLX.lastPeople = ''; }
}
async function cloudDeleteMine() {
  var uid = CL.uid;
  try {
    purgeShared(uid); await flushShared();
    for (var id in CLX.lastP) await CLX.db.doc('data/users/' + uid + '/' + id).delete();
    CLX.lastP = {}; await CLX.db.doc('people/' + uid).delete(); CLX.lastPeople = '';
  } catch (e) { toast('Could not delete everything. Try again.'); return; }
  S.profiles = []; S.data = {}; S.activeId = null; S.shared = []; S.pendingSync = false; CLX.applying = true; save(); CLX.applying = false; CL.dirty = false;
  U.overlay = null; renderOverlay(); U.wiz = newWiz(); U.picker = true; applyTheme(); render();
}

/* ---- shared plans: three collections, one small document per member and per task ---- */
function sharedDocs(list) {
  var out = {};
  list.forEach(function (pl) {
    out['plans/' + pl.id] = { id: pl.id, title: pl.title, kind: pl.kind, deadline: pl.deadline || '', ownerId: pl.ownerId, createdAt: pl.createdAt || 0 };
    pl.members.forEach(function (m) { out['plan_members/' + pl.id + '_' + m.id] = { planId: pl.id, uid: m.id, status: m.status, at: m.at || 0 }; });
    pl.tasks.forEach(function (t, i) {
      out['plan_tasks/' + t.id] = { id: t.id, planId: pl.id, title: t.title, assigneeId: t.assigneeId || '', due: t.due || '', note: t.note || '', done: !!t.done, doneAt: t.doneAt || null, doneBy: t.doneBy || '', createdBy: t.createdBy || '', ord: t.ord || (pl.createdAt || 0) + i };
    });
  });
  return out;
}
async function flushShared() {
  var cur = sharedDocs(S.shared), path;
  for (path in cur) {
    var str = JSON.stringify(cur[path]);
    if (CLX.lastShared[path] !== str) { await CLX.db.doc(path).set(JSON.parse(str)); CLX.lastShared[path] = str; }
  }
  for (path in CLX.lastShared) if (!cur[path]) { await CLX.db.doc(path).delete(); delete CLX.lastShared[path]; }
}
function rebuildShared() {
  if (!CL.on || !CL.sharedReady) return;
  if (CL.dirty || CLX.flushing) { CLX.restale = true; return; }
  var raw = CLX.raw, mem = {}, tk = {}, me = CL.uid;
  Object.keys(raw.members).forEach(function (k) { var m = raw.members[k]; (mem[m.planId] = mem[m.planId] || []).push({ id: m.uid, status: m.status, at: m.at || 0 }); });
  Object.keys(raw.tasks).forEach(function (k) { var t = raw.tasks[k]; (tk[t.planId] = tk[t.planId] || []).push(t); });
  var list = [];
  Object.keys(raw.plans).forEach(function (id) {
    var p = raw.plans[id], ms = mem[id] || [];
    if (!ms.some(function (m) { return m.id === me; })) return;
    var ts = (tk[id] || []).sort(function (a, b) { return (a.ord || 0) - (b.ord || 0); }).map(function (t) { return { id: t.id, title: t.title, assigneeId: t.assigneeId || '', due: t.due || '', note: t.note || '', done: !!t.done, doneAt: t.doneAt || null, doneBy: t.doneBy || '', createdBy: t.createdBy || '', ord: t.ord }; });
    list.push({ id: id, title: p.title, kind: p.kind, deadline: p.deadline || '', ownerId: p.ownerId, createdAt: p.createdAt || 0, members: ms.sort(function (a, b) { return a.at - b.at; }), tasks: ts });
  });
  list.sort(function (a, b) { return b.createdAt - a.createdAt; });
  S.shared = list; CLX.lastShared = sharedDocs(list);
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
  reconcileShared(); inviteAlerts();
  rerender();
}
/* keep your own copies of shared tasks in step with the plan */
function reconcileShared() {
  if (!CL.on || !CL.sharedReady || !CL.personalReady || !D()) return;
  var changed = false, d = D();
  d.tasks.forEach(function (t) {
    if (!t.sharedRef) return;
    var pl = planById(t.sharedRef.planId), st = pl && pl.tasks.filter(function (x) { return x.id === t.sharedRef.taskId; })[0];
    if (!st) { delete t.sharedRef; changed = true; return; }
    var isDone = t.status === 'done';
    if (st.done !== isDone && !(d.active && d.active.taskId === t.id)) { t.status = st.done ? 'done' : 'todo'; t.doneAt = st.done ? Date.now() : null; t.progress = st.done ? 100 : (t.progress === 100 ? 0 : t.progress); changed = true; }
  });
  if (changed) save();
}
function inviteAlerts() {
  var d = D(); if (!d) return; d.sn = d.sn || {};
  myInvites().forEach(function (pl) {
    var k = 'inv' + pl.id; if (d.sn[k]) return; d.sn[k] = 1; save();
    var o = profileById(pl.ownerId); notify((o ? o.name : 'Someone') + ' invited you to "' + pl.title + '". Open Shared to accept.');
  });
}

/* ---- screens and banners that belong to cloud mode ---- */
function viewSplash() {
  return '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(true) + '<p class="center muted" role="status">Loading your data…</p></div>';
}
function viewCloudError() {
  return '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(true) +
    '<section class="card"><h2>Could not reach your saved data</h2><p class="muted">This can happen on a weak connection. Nothing has been lost.</p><div class="acts"><button class="btn primary" data-a="cloudRetry">Try again</button></div></section></div>';
}
function viewImport() {
  return '<div class="main" style="min-height:100%;justify-content:center;max-width:520px">' + heroBlock(true) +
    '<section class="card"><h2>Bring over what you saved on this device?</h2><p class="muted small">You are now signed in, so your data can live online and follow you to other devices. Pick a profile to move across, or start fresh.</p>' +
    '<div class="pick">' + CLX.legacy.map(function (x, i) { return '<button data-a="importLocal" data-i="' + i + '">' + avatar(x.profile) + '<span>' + esc(x.profile.name) + '</span></button>'; }).join('') + '</div>' +
    '<div class="acts"><button class="btn" data-a="skipImport">Start fresh</button></div></section></div>';
}
function cloudBanners() {
  if (!CL.on) return '';
  if (CL.writeError === 'invalid_argument' || CL.canWrite === false) return '<section class="card warn" role="alert"><b>Your changes are not being saved online</b><span class="small">This page is shared with you as view-only. Ask its owner to share it with you as a Contributor, then reopen the page.</span></section>';
  if (CL.writeError && CL.writeError !== 'invalid_argument') return '<section class="card warn" role="alert"><b>Could not save online yet</b><span class="small">Your changes are kept on this device and will be sent when the connection returns.</span></section>';
  return '';
}
Object.assign(A, {
  cloudRetry: function () { location.reload(); },
  skipImport: function () { U.importAsk = false; U.wiz = newWiz(); render(); },
  importLocal: function (el) {
    var x = CLX.legacy[+el.dataset.i]; if (!x) return;
    var d = ensureData(jclone(x.data)); d.tasks.forEach(function (t) { delete t.sharedRef; }); d.active = null;
    var prof = Object.assign({}, x.profile, { id: CL.uid }); d.profile = prof;
    S.profiles = [prof]; S.data = {}; S.data[CL.uid] = d; S.activeId = CL.uid; U.importAsk = false; U.picker = false; U.wiz = null; CL.personalReady = true;
    save(); applyTheme(); maybeCheckin(); toast('Your saved profile is now online'); render();
  }
});
document.addEventListener('visibilitychange', function () { if (document.hidden && CL.on && CL.dirty) cloudFlush(); });
