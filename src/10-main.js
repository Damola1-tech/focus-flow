'use strict';
/* ---------- helpers ---------- */
var LS_KEY = 'focusflow.v1';
var LS_LOCAL = 'focusflow.v1';
/* cloud state: filled in by the cloud module when the page runs inside a signed-in viewer */
var CL = { on: false, uid: null, dir: {}, dirReady: false, sharedReady: false, personalReady: false, dirty: false, writeError: '', status: '' };
var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); };
var pad = function (n) { return String(n).padStart(2, '0'); };
var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var parseYmd = function (s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
var addDays = function (s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
var todayStr = function () { return ymd(new Date()); };
var nowMin = function () { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
var toMin = function (t) { var p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
var fromMin = function (n) { return pad(Math.floor(n / 60)) + ':' + pad(n % 60); };
var weekStart = function (s) { var d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
var fmtDur = function (m) { m = Math.round(m); if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; return r ? h + ' h ' + r + ' min' : h + ' h'; };
var fmtClock = function (sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec % 3600 / 60)) + ':' + pad(sec % 60); };
var fmtDate = function (s, o) { return parseYmd(s).toLocaleDateString(undefined, o || { weekday: 'long', day: 'numeric', month: 'long' }); };
var fmtTime12 = function (t) { var m = toMin(t), h = Math.floor(m / 60); return (h % 12 || 12) + ':' + pad(m % 60) + ' ' + (h < 12 ? 'AM' : 'PM'); };
var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

/* ---------- storage (all data stays in this browser) ---------- */
var storageOk = true;
function loadAll(key) {
  try { var raw = localStorage.getItem(key || LS_KEY); if (raw) { var o = JSON.parse(raw); if (o && o.profiles) return o; } }
  catch (e) { storageOk = false; }
  return null;
}
var S = loadAll() || { v: 1, profiles: [], activeId: null, data: {} };
S.shared = S.shared || [];
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { storageOk = false; }
  if (CL.on) { try { cloudDirty(); } catch (e) { } }
}
var P = function () { return S.profiles.find(function (p) { return p.id === S.activeId; }); };
var D = function () { return S.data[S.activeId]; };
var THEMES = [{ k: 'indigo', c: '#3F5EFB', n: 'Indigo' }, { k: 'forest', c: '#17794C', n: 'Forest' }, { k: 'sunset', c: '#C2570C', n: 'Sunset' }];
var COLORS = THEMES.map(function (t) { return t.c; });
var themeOf = function (c) { return THEMES.find(function (t) { return t.c === c; }) || THEMES[0]; };
function newData() {
  return {
    settings: {
      planFrom: '22:30', planTo: '23:30', hasShift: false, workDays: [1, 2, 3, 4, 5], shiftStart: '08:00', shiftEnd: '18:00',
      message: 'motivation', appNotify: false, emailNotify: false, theme: 'system',
      shifts: null, rotaWeeks: 1, rotaAnchor: '', shiftOverrides: {},
      remindStart: 10, checkinEvery: 0, quietFrom: '22:00', quietTo: '07:00', ai: true
    },
    goals: [], tasks: [], active: null, checkins: {}, rewards: {}, msgSeen: {}, plans: {}, reminders: [], evening: {},
    travel: [], chat: []
  };
}
var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function shiftsFromLegacy(s) {
  var w = {}; for (var i = 0; i < 7; i++) w[i] = { on: !!(s.hasShift && (s.workDays || []).indexOf(i) >= 0), a: s.shiftStart || '08:00', b: s.shiftEnd || '18:00' };
  return { A: w, B: JSON.parse(JSON.stringify(w)) };
}
/* fill anything missing so older saves and other devices' data always have every field */
function ensureData(d) {
  var base = newData();
  Object.keys(base).forEach(function (k) { if (d[k] === undefined || d[k] === null && k !== 'active') d[k] = base[k]; });
  Object.keys(base.settings).forEach(function (k) { if (d.settings[k] === undefined) d.settings[k] = base.settings[k]; });
  var s = d.settings;
  if (!s.shifts) s.shifts = shiftsFromLegacy(s);
  if (!s.rotaAnchor) s.rotaAnchor = weekStart(todayStr());
  s.hasShift = anyShift(s);
  return d;
}
function anyShift(s) { var r = false; ['A', 'B'].forEach(function (k) { for (var i = 0; i < 7; i++) if (s.shifts && s.shifts[k] && s.shifts[k][i] && s.shifts[k][i].on) r = true; }); return r; }
/* the shift on one date: rota weeks, per-day overrides, overnight spill, travel */
function shiftFor(date) {
  var d = D(), s = d.settings; if (!s.shifts) return null;
  var trip = travelOn(date), dow = parseYmd(date).getDay();
  var pick = function (dt) {
    var ov = s.shiftOverrides && s.shiftOverrides[dt];
    if (ov) return ov.off ? null : { a: toMin(ov.a), b: toMin(ov.b) };
    var idx = s.rotaWeeks === 2 ? (Math.round((parseYmd(weekStart(dt)) - parseYmd(weekStart(s.rotaAnchor))) / 604800000) % 2 + 2) % 2 : 0;
    var e = s.shifts[idx ? 'B' : 'A'][parseYmd(dt).getDay()];
    return e && e.on ? { a: toMin(e.a), b: toMin(e.b) } : null;
  };
  var today = pick(date), prev = pick(addDays(date, -1)), out = null;
  if (today) out = today.b > today.a ? { a: today.a, b: today.b } : { a: today.a, b: 1440 };
  if (prev && prev.b <= prev.a && prev.b > 0 && !out) out = { a: 0, b: prev.b };
  if (trip && !trip.keepShift) return null;
  return out;
}
function travelOn(date) {
  var L = (D() && D().travel) || [];
  return L.filter(function (t) { return t.from <= date && date <= t.to; })[0] || null;
}

/* ---------- UI state (not saved) ---------- */
var U = { view: 'home', tab: 'today', range: 'week', overlay: null, wiz: null, picker: false, notice: null, plan: null, flow: null, pauseOpt: { mins: 15, reason: '' } };

/* ---------- daily messages ---------- */
var MOTIV = [
  { t: 'Small steps, repeated daily, build a life you can be proud of.' },
  { t: 'Start with the next small thing. The rest gets easier once you have begun.', g: 1 },
  { t: 'A plan only matters when you follow through. Today is your chance.' },
  { t: 'Progress counts even when it is slow. Keep going.' },
  { t: 'Rest is part of the work. Plan it like any other task.', g: 1 },
  { t: 'You do not have to do everything today. Do the important things well.', g: 1 },
  { t: 'Show up for the task, not for the mood. The mood often follows.' },
  { t: 'Finish what you start, then choose what to start next.' },
  { t: 'Be honest about your time, and your time will start working for you.' },
  { t: 'One focused hour beats a distracted day.' },
  { t: 'Missed a day? Begin again today. That is all discipline really is.', g: 1 },
  { t: 'Your big goals are built from the tasks you finish today.' }
];
var VERSES = [
  { t: 'Commit thy works unto the LORD, and thy thoughts shall be established.', r: 'Proverbs 16:3', g: 1 },
  { t: 'I can do all things through Christ which strengtheneth me.', r: 'Philippians 4:13' },
  { t: 'Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.', r: 'Joshua 1:9', g: 1 },
  { t: 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.', r: 'Isaiah 40:31', g: 1 },
  { t: 'And whatsoever ye do, do it heartily, as to the Lord, and not unto men.', r: 'Colossians 3:23' },
  { t: 'So teach us to number our days, that we may apply our hearts unto wisdom.', r: 'Psalm 90:12' },
  { t: 'And let us not be weary in well doing: for in due season we shall reap, if we faint not.', r: 'Galatians 6:9' },
  { t: 'The thoughts of the diligent tend only to plenteousness.', r: 'Proverbs 21:5' },
  { t: 'To every thing there is a season, and a time to every purpose under the heaven.', r: 'Ecclesiastes 3:1', g: 1 },
  { t: 'This is the day which the LORD hath made; we will rejoice and be glad in it.', r: 'Psalm 118:24' },
  { t: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.', r: 'Isaiah 41:10', g: 1 },
  { t: 'In all labour there is profit.', r: 'Proverbs 14:23' },
  { t: 'Be ye stedfast, unmoveable, always abounding in the work of the Lord, forasmuch as ye know that your labour is not in vain in the Lord.', r: '1 Corinthians 15:58' }
];
function dailyMessage() {
  var d = D(), pref = d.settings.message;
  if (pref === 'none') return null;
  var L = pref === 'bible' ? VERSES : MOTIV, date = todayStr();
  var rec = d.msgSeen[pref] = d.msgSeen[pref] || { used: [], byDate: {} };
  if (rec.byDate[date] !== undefined && L[rec.byDate[date]]) return L[rec.byDate[date]];
  var pool = L.map(function (_, i) { return i; }).filter(function (i) { return rec.used.indexOf(i) < 0; });
  if (!pool.length) { rec.used = []; pool = L.map(function (_, i) { return i; }); }
  var ci = d.checkins[date];
  if (ci && ci.energy === 'low') { var g = pool.filter(function (i) { return L[i].g; }); if (g.length) pool = g; }
  var i = pool[Math.floor(Math.random() * pool.length)];
  rec.used.push(i); rec.byDate[date] = i; save();
  return L[i];
}
/* ---------- tasks ---------- */
var tasks = function () { return D().tasks; };
var taskById = function (id) { return tasks().find(function (t) { return t.id === id; }); };
function addTask(o) {
  var t = { id: uid(), title: String(o.title || '').trim(), date: o.date || null, time: o.time || '', fixed: !!(o.time && o.fixed !== false), est: Math.max(5, +o.est || 30), priority: o.priority || 'med', status: 'todo', progress: 0, goalId: o.goalId || '', actual: 0, postponed: 0, emergency: false, createdAt: Date.now(), doneAt: null };
  if (!t.title) return null;
  tasks().push(t); save(); return t;
}
function moveTask(id, date) {
  var t = taskById(id); if (!t) return;
  if (t.date && date !== t.date) t.postponed++;
  t.date = date; t.time = ''; t.fixed = false; save();
}
function completeTask(id) {
  var t = taskById(id); if (!t) return;
  if (D().active && D().active.taskId === id) return endSession(true);
  t.status = 'done'; t.progress = 100; t.doneAt = Date.now(); if (!t.date) t.date = todayStr(); save(); syncShared(t);
  return { task: t, sec: 0 };
}
function reopenTask(id) { var t = taskById(id); if (t) { t.status = 'todo'; t.doneAt = null; if (t.progress === 100) t.progress = 0; save(); syncShared(t); } }
function removeTask(id) {
  var d = D(); if (d.active && d.active.taskId === id) d.active = null;
  d.tasks = d.tasks.filter(function (t) { return t.id !== id; });
  d.reminders = d.reminders.filter(function (r) { return r.taskId !== id; }); save();
}

/* ---------- running a task (timer) ---------- */
function activeElapsed(a) { return a.accSec + (a.state === 'running' ? (Date.now() - a.lastTick) / 1000 : 0); }
function startTask(id) {
  var d = D(), t = taskById(id); if (!t) return;
  if (d.active && d.active.taskId !== id) endSession(false);
  if (d.active && d.active.taskId === id) return;
  if (!t.date) t.date = todayStr();
  d.active = { taskId: id, state: 'running', accSec: 0, lastTick: Date.now(), startedAt: Date.now(), pauses: 0, noticed: false };
  t.status = 'doing'; save();
}
function pauseTask(mins, reason) {
  var d = D(), a = d.active; if (!a || a.state !== 'running') return;
  a.accSec = activeElapsed(a); a.state = 'paused'; a.pauses++; a.pausedAt = Date.now();
  a.log = a.log || []; a.log.push({ at: Date.now(), reason: reason || '' });
  if (mins) setReturn(mins);
  save();
}
function setReturn(mins, reason) {
  var d = D(), a = d.active; if (!a || a.state !== 'paused') return;
  d.reminders = d.reminders.filter(function (r) { return r.taskId !== a.taskId || r.fired; });
  if (reason !== undefined && a.log && a.log.length) a.log[a.log.length - 1].reason = reason;
  a.returnAt = null;
  if (mins) {
    a.returnAt = Date.now() + mins * 60000;
    d.reminders.push({ id: uid(), at: a.returnAt, text: 'Ready to get back to ' + taskById(a.taskId).title + '?', taskId: a.taskId, fired: false });
  }
  save();
}
function leftText(a, t) {
  var s = t.est * 60 - activeElapsed(a);
  return s >= 0 ? fmtDur(Math.ceil(s / 60)) : 'Over by ' + fmtDur(Math.ceil(-s / 60));
}
function resumeTask() {
  var d = D(), a = d.active; if (!a || a.state !== 'paused') return;
  a.state = 'running'; a.lastTick = Date.now(); a.returnAt = null; a.noticed = true;
  d.reminders = d.reminders.filter(function (r) { return r.taskId !== a.taskId || r.fired; }); save();
}
function endSession(complete) {
  var d = D(), a = d.active; if (!a) return null;
  var t = taskById(a.taskId), sec = Math.round(activeElapsed(a));
  if (t) {
    t.actual += sec; t.status = complete ? 'done' : 'todo';
    if (complete) { t.progress = 100; t.doneAt = Date.now(); if (!t.date) t.date = todayStr(); syncShared(t); }
  }
  d.reminders = d.reminders.filter(function (r) { return r.taskId !== a.taskId || r.fired; });
  d.active = null; save();
  return { task: t, sec: sec };
}

/* ---------- goals ---------- */
var LEVELS = ['year', 'month', 'week', 'day'];
var LEVEL_NAME = { year: 'Yearly', month: 'Monthly', week: 'Weekly', day: 'Daily' };
function goalProgress(g, seen) {
  seen = seen || {}; if (seen[g.id]) return 0; seen[g.id] = 1;
  var parts = [];
  D().goals.filter(function (x) { return x.parentId === g.id; }).forEach(function (k) { parts.push(goalProgress(k, seen)); });
  var linked = tasks().filter(function (t) { return t.goalId === g.id && t.status !== 'cancelled'; });
  if (linked.length) parts.push(Math.round(linked.reduce(function (a, t) { return a + (t.status === 'done' ? 100 : t.progress); }, 0) / linked.length));
  return parts.length ? Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length) : 0;
}

/* ---------- scoring (the formula the app shows) ---------- */
function scoreRange(from, to) {
  var inR = tasks().filter(function (t) { return t.date && t.date >= from && t.date <= to; });
  var removed = inR.filter(function (t) { return t.status === 'cancelled' && t.emergency; }).length;
  var counted = inR.filter(function (t) { return !(t.status === 'cancelled' && t.emergency); });
  var done = counted.filter(function (t) { return t.status === 'done'; }).length;
  return { planned: inR.length, removed: removed, counted: counted.length, done: done, pct: counted.length ? Math.round(done / counted.length * 100) : null };
}
function dayProgress(date) {
  var L = tasks().filter(function (t) { return t.date === date && t.status !== 'cancelled'; });
  if (!L.length) return { n: 0, done: 0, pct: 0 };
  var sum = L.reduce(function (a, t) { return a + (t.status === 'done' ? 100 : t.progress || 0); }, 0);
  return { n: L.length, done: L.filter(function (t) { return t.status === 'done'; }).length, pct: Math.round(sum / L.length) };
}
function rewardFor(wk) {
  var r = D().rewards[wk] || null, to = addDays(wk, 6), sc = scoreRange(wk, to);
  var th = r ? r.threshold : 90, over = todayStr() > to;
  var need = Math.ceil(th / 100 * sc.counted);
  var state = !r ? 'none' : (over ? (sc.pct !== null && sc.pct >= th ? 'unlocked' : 'locked-final') : (sc.pct !== null && sc.pct >= th ? 'on-track' : 'locked'));
  return { r: r, sc: sc, th: th, need: need, state: state, to: to };
}

/* ---------- planning a realistic day ---------- */
function newDraft(date) { return { date: date, ests: {}, removed: [], times: {} }; }
function layout(dr) {
  var d = D(), s = d.settings, date = dr.date;
  var shift = shiftFor(date), trip = travelOn(date), cap = trip ? (trip.maxHours || 4) * 60 : 0, used = 0;
  var ci = d.checkins[date], low = !!(ci && ci.energy === 'low');
  var ts = tasks().filter(function (t) { return t.date === date && (t.status === 'todo' || t.status === 'doing') && dr.removed.indexOf(t.id) < 0; });
  var sug = function (t) { return (low && t.est > 45 && t.priority !== 'high') ? Math.max(20, Math.round(t.est / 2 / 5) * 5) : t.est; };
  var est = function (t) { return dr.ests[t.id] || (isFixed(t) ? t.est : sug(t)); };
  var tm = dr.times || {}, timeOf = function (t) { return tm[t.id] || t.time; };
  var isFixed = function (t) { return !!(tm[t.id] || (t.fixed && t.time)); };
  var fixed = ts.filter(isFixed), flex = ts.filter(function (t) { return !isFixed(t); });
  var pr = { high: 0, med: 1, low: 2 };
  flex.sort(function (a, b) { return (pr[a.priority] - pr[b.priority]) || (est(b) - est(a)); });
  if (low && flex.length > 1) {
    var mi = 0; flex.forEach(function (t, k) { if (est(t) < est(flex[mi])) mi = k; });
    flex.unshift(flex.splice(mi, 1)[0]);
  }
  var start = trip ? 480 : 420, end = trip ? 1200 : 1320;
  if (date === todayStr()) start = Math.max(start, Math.ceil((nowMin() + 5) / 5) * 5);
  var blocks = [];
  if (shift) blocks.push({ a: shift.a, b: shift.b, kind: 'shift' });
  fixed.forEach(function (t) { blocks.push({ a: toMin(timeOf(t)), b: toMin(timeOf(t)) + est(t), kind: 'fixed', t: t }); });
  blocks.sort(function (x, y) { return x.a - y.a; });
  var gaps = [], cur = start;
  blocks.forEach(function (b) { if (b.a > cur) gaps.push([cur, b.a]); cur = Math.max(cur, b.b); });
  if (end > cur) gaps.push([cur, end]);
  var rows = [], unplaced = [];
  blocks.forEach(function (b) { rows.push(b.kind === 'shift' ? { kind: 'shift', start: b.a, end: b.b } : { kind: 'task', t: b.t, start: b.a, est: est(b.t), fixed: true, why: 'Your chosen time' }); });
  flex.forEach(function (t, i) {
    var e = est(t), g = gaps.find(function (x) { return x[1] - x[0] >= e; });
    if (trip && used + e > cap) { unplaced.push({ t: t, est: e, why: 'Travel mode keeps the day light' }); return; }
    var why = (low && i === 0) ? 'A small win to start' : t.priority === 'high' ? 'High priority' : 'Fits your free time';
    if (e < t.est && !dr.ests[t.id]) why += ', shortened from ' + fmtDur(t.est) + ' because your energy is low';
    if (g) { rows.push({ kind: 'task', t: t, start: g[0], est: e, fixed: false, why: why }); g[0] += e + 10; used += e; }
    else unplaced.push({ t: t, est: e });
  });
  rows.sort(function (x, y) { return x.start - y.start; });
  return { rows: rows, unplaced: unplaced, shift: shift, low: low, trip: trip };
}
function confirmDraft(dr) {
  var L = layout(dr);
  L.rows.forEach(function (r) {
    if (r.kind !== 'task') return;
    r.t.est = r.est;
    if (dr.times && dr.times[r.t.id]) { r.t.time = dr.times[r.t.id]; r.t.fixed = true; }
    else if (!r.fixed) { r.t.time = fromMin(r.start); r.t.fixed = false; }
  });
  var off = dr.removed.slice(); L.unplaced.forEach(function (u) { if (off.indexOf(u.t.id) < 0) off.push(u.t.id); });
  off.forEach(function (id) { var t = taskById(id); if (t) { t.date = null; t.time = ''; t.fixed = false; t.postponed++; } });
  D().plans[dr.date] = { confirmedAt: Date.now() }; save();
}

/* ---------- typing a plan in plain words ---------- */
var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function parseCapture(text, defDate) {
  var NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  return String(text || '').split(/[\n;,]+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (line) {
    var t = line.replace(/^(and\s+)?(also\s+)?(remind me to\s+)?(tomorrow[, ]*)?(i\s+)?((need|have|want)\s+to\s+)?/i, '').replace(/^(and|also)\s+/i, '').trim();
    var est = null, time = '', date = defDate, m;
    m = t.match(/\b(?:for\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|half an?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i);
    if (m) {
      var n = /half/i.test(m[1]) ? 0.5 : (NUM[m[1].toLowerCase()] || parseFloat(m[1]));
      est = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n); t = t.replace(m[0], '').trim();
    }
    m = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (m) {
      var h = +m[1], mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      if (h < 24 && mi < 60) { time = pad(h) + ':' + pad(mi); t = t.replace(m[0], '').trim(); }
    }
    m = t.match(new RegExp('\\bon\\s+(' + MONTHS.join('|') + ')\\s+(\\d{1,2})\\b', 'i'));
    if (m) {
      var mo = MONTHS.indexOf(m[1].toLowerCase()), dy = +m[2], now = new Date(), yr = now.getFullYear();
      var cand = new Date(yr, mo, dy); if (ymd(cand) < todayStr()) cand = new Date(yr + 1, mo, dy);
      date = ymd(cand); t = t.replace(m[0], '').trim();
    }
    if (/\btomorrow\b/i.test(t)) { date = addDays(todayStr(), 1); t = t.replace(/\btomorrow\b/i, '').trim(); }
    t = t.replace(/\s{2,}/g, ' ').replace(/(\s+(for|on|at))?[.\s]*$/i, '').trim();
    return { title: cap(t), est: est || 30, time: time, date: date };
  }).filter(function (x) { return x.title; });
}

/* ---------- check-ins ---------- */
function todayCheckin() { return D().checkins[todayStr()] || null; }
function tomorrowPlanned() {
  var tm = addDays(todayStr(), 1);
  return tasks().some(function (t) { return t.date === tm && t.status !== 'cancelled'; });
}
function inPlanWindow() {
  var s = D().settings, n = nowMin(), a = toMin(s.planFrom), b = toMin(s.planTo);
  return a <= b ? (n >= a && n <= b) : (n >= a || n <= b);
}

/* ---------- reminders (work while the app is open) ---------- */
function notify(text) {
  U.notice = text; toast(text, 6000);
  try { if (D().settings.appNotify && !(typeof SB !== 'undefined' && SB.pushState === 'on') && 'Notification' in window && Notification.permission === 'granted') new Notification('Focus Flow', { body: text }); } catch (e) { }
}
function tick() {
  if (!S.activeId || !D()) return;
  var d = D(), a = d.active, changed = false;
  document.querySelectorAll('[data-clock]').forEach(function (el) {
    var x = d.active; if (x) el.textContent = fmtClock(activeElapsed(x));
  });
  document.querySelectorAll('[data-left]').forEach(function (el) {
    var x = d.active; if (x) { var tt = taskById(x.taskId); if (tt) el.textContent = leftText(x, tt); }
  });
  if (a && a.state === 'running') {
    var t = taskById(a.taskId);
    if (t && !a.noticed && activeElapsed(a) >= t.est * 60) {
      a.noticed = true; save(); notify('Your estimated time for ' + t.title + ' is up.');
      openOverlay('status');
    }
  }
  try { sharedTick(); } catch (e) { }
  var now = Date.now();
  d.reminders.forEach(function (r) { if (!r.fired && r.at <= now) { r.fired = true; changed = true; notify(r.text); } });
  if (changed) {
    save();
    var ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if (!U.overlay && !typing) render();
  }
}
var OV = {};
/* ---------- small building blocks ---------- */
var ICONS = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  goals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  insights: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  logo: 'M4 12h6l2-6 3 12 2-6h3',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  coach: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plane: 'M21 3L3 10.5l6.5 2.5L12 20l2.5-5.5L21 3zM9.5 13L21 3'
};
function ic(n, size, color, w) {
  return '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONS[n] + '"></path></svg>';
}
function avatar(p, cls) { return '<span class="av ' + (cls || '') + '" style="background:' + esc(p.color) + '">' + esc((p.name || '?').trim().charAt(0).toUpperCase()) + '</span>'; }
function bar(pct, ok) { return '<div class="bar' + (ok ? ' ok' : '') + '"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>'; }
function chip(label, on, group, val) { return '<button type="button" class="chip" data-a="chip" data-g="' + group + '" data-val="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>'; }
function segBtn(label, on, group, val) { return '<button type="button" data-a="chip" data-g="' + group + '" data-val="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>'; }
function toast(msg, ms) {
  var el = $('#toast'); if (!el) return; el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
}

/* ---------- app shell ---------- */
function navItems() {
  var it = [['home', 'Home'], ['tasks', 'Tasks'], ['calendar', 'Calendar']];
  if (AI.available) it.push(['coach', 'Coach']);
  return it.concat([['shared', 'Shared'], ['goals', 'Goals'], ['insights', 'Insights'], ['settings', 'Settings']]);
}
function shell(inner) {
  var p = P(), items = navItems();
  var btn = function (i) { return '<button data-a="nav" data-v="' + i[0] + '"' + (U.view === i[0] ? ' aria-current="page"' : '') + '>' + ic(i[0], 20) + '<span>' + i[1] + '</span></button>'; };
  var main5 = items.filter(function (i) { return ['home', 'tasks', 'calendar', 'coach'].indexOf(i[0]) >= 0; });
  var inMore = ['shared', 'goals', 'insights', 'settings'].indexOf(U.view) >= 0, inv = myInvites().length;
  var tab = main5.map(btn).join('') + '<button data-a="more"' + (inMore ? ' aria-current="page"' : '') + '>' + ic('more', 20, 'currentColor', 3) + '<span>More' + (inv ? ' (' + inv + ')' : '') + '</span></button>';
  var who = CL.on
    ? '<button class="who" data-a="nav" data-v="settings">' + avatar(p) + '<span><b>' + esc(p.name) + '</b><small>Signed in</small></span></button>'
    : '<button class="who" data-a="picker">' + avatar(p) + '<span><b>' + esc(p.name) + '</b><small>Switch person</small></span></button>';
  return '<div class="shell"><aside class="side"><div class="brand"><span class="logo">' + ic('logo', 20, '#fff') + '</span>Focus Flow</div>' +
    '<nav class="nav" aria-label="Main">' + items.map(btn).join('') + '</nav>' + who + '</aside>' +
    '<main class="main" id="main">' + inner + '</main>' +
    '<nav class="tabbar" aria-label="Main">' + tab + '</nav></div>';
}
OV.more = function () {
  var rows = [['shared', 'Shared plans', 'Plan together with family and friends'], ['goals', 'Goals', 'Yearly to daily goals'], ['insights', 'Insights', 'Weekly reward and monthly report'], ['settings', 'Settings', 'Schedule, reminders, travel mode']];
  return sheet('More', '<h2>More</h2><div class="stack" style="gap:8px">' + rows.map(function (r) {
    return '<button class="planrow" style="text-align:left;width:100%;align-items:center" data-a="nav" data-v="' + r[0] + '">' + ic(r[0], 22) + '<div class="grow"><b>' + r[1] + (r[0] === 'shared' && myInvites().length ? ' <span class="pill warn">' + myInvites().length + ' invite' + (myInvites().length === 1 ? '' : 's') + '</span>' : '') + '</b><div class="small muted">' + r[2] + '</div></div></button>';
  }).join('') + '</div><div class="acts"><button class="btn" data-a="back">Close</button></div>');
};

/* ---------- tasks ---------- */
function taskRow(t, o) {
  o = o || {};
  var d = D(), done = t.status === 'done', canc = t.status === 'cancelled';
  var act = d.active && d.active.taskId === t.id;
  var g = t.goalId ? d.goals.find(function (x) { return x.id === t.goalId; }) : null;
  var meta = [];
  if (o.date && t.date) meta.push(fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' }));
  if (t.time) meta.push(fmtTime12(t.time));
  meta.push(fmtDur(t.est));
  if (t.actual) meta.push('took ' + fmtDur(t.actual / 60));
  if (g) meta.push('Goal: ' + g.title);
  if (t.sharedRef) { var spl = planById(t.sharedRef.planId); if (spl) meta.push('Shared: ' + spl.title); }
  var pill = done ? '<span class="pill ok">Done</span>' : canc ? '<span class="pill">Cancelled</span>' : act ? '<span class="pill acc">' + (d.active.state === 'paused' ? 'Paused' : 'In progress') + '</span>' : t.priority === 'high' ? '<span class="pill warn">High priority</span>' : '';
  var overdue = !done && !canc && t.date && t.date < todayStr();
  var btns = '';
  if (!done && !canc) btns += '<button class="btn sm primary" data-a="start" data-id="' + t.id + '">' + (act ? 'Open timer' : 'Start') + '</button>';
  if (overdue) btns += '<button class="btn sm" data-a="moveToday" data-id="' + t.id + '">Move to today</button>';
  btns += '<button class="btn sm ghost" data-a="editTask" data-id="' + t.id + '">Edit</button>';
  return '<div class="task' + (done ? ' isdone' : '') + '">' +
    '<button class="tick' + (done ? ' done' : '') + '" data-a="toggleDone" data-id="' + t.id + '" aria-label="' + (done ? 'Mark not done: ' : 'Mark done: ') + esc(t.title) + '"' + (canc ? ' disabled' : '') + '>' + (done ? ic('check', 16, '#fff', 3) : '') + '</button>' +
    '<div class="grow" style="display:flex;flex-direction:column;gap:8px">' +
    '<div class="row between"><h3>' + esc(t.title) + '</h3>' + pill + '</div>' +
    '<div class="small muted">' + esc(meta.join(' · ')) + '</div>' +
    bar(done ? 100 : t.progress, done) +
    '<div class="acts">' + btns + '</div></div></div>';
}
function byTime(a, b) { return (a.time || '99:99') < (b.time || '99:99') ? -1 : (a.time || '99:99') > (b.time || '99:99') ? 1 : a.createdAt - b.createdAt; }

/* ---------- Home ---------- */
function activeCard() {
  var d = D(), a = d.active; if (!a) return '';
  var t = taskById(a.taskId); if (!t) return '';
  var paused = a.state === 'paused';
  return '<section class="card night" aria-label="Task in progress"><span class="eyebrow">' + (paused ? 'Paused' : 'Up now') + '</span>' +
    '<div class="row between"><h2>' + esc(t.title) + '</h2><span class="big" data-clock>' + fmtClock(activeElapsed(a)) + '</span></div>' +
    '<span class="small" style="color:var(--night-muted)">Estimated ' + fmtDur(t.est) + ' · ' + t.progress + '% complete</span>' +
    '<div class="acts"><button class="btn night-fill" data-a="start" data-id="' + t.id + '">Open timer</button>' +
    (paused ? '<button class="btn on-night" data-a="resume">Resume</button>' : '<button class="btn on-night" data-a="askPause">Pause</button>') +
    '<button class="btn on-night" data-a="finish">Complete</button></div></section>';
}
function banners() {
  var out = '', d = D(), date = todayStr();
  if (!storageOk) out += '<div class="card warn" role="alert"><b>This browser is not saving your data.</b><span>You may be in a private window. Tasks will be lost when you close the page.</span></div>';
  if (inPlanWindow() && !tomorrowPlanned()) out += '<div class="card soft"><b>Time to plan tomorrow</b><span class="small">Type or speak what you need to do. It takes a minute.</span><div class="acts"><button class="btn primary" data-a="evening">Plan tomorrow</button></div></div>';
  var todays = tasks().filter(function (t) { return t.date === date && t.status === 'todo'; });
  if (todays.length && !d.plans[date]) out += '<div class="card soft"><b>Turn today\'s tasks into a realistic plan</b><span class="small">Focus Flow fits them around your shift and energy. You review before anything changes.</span><div class="acts"><button class="btn primary" data-a="plan" data-date="' + date + '">Plan my day</button></div></div>';
  return out + cloudBanners() + travelBanners() + alertBanner() + sharedBanners();
}
function checkinCard() {
  if (todayCheckin()) {
    var c = todayCheckin();
    return '<section class="card"><div class="row between"><span class="eyebrow">Today\'s mood</span><button class="btn sm ghost" data-a="redoCheckin">Update</button></div><div class="chips">' +
      (c.moods || []).map(function (m) { return '<span class="pill warn">' + esc(m) + '</span>'; }).join('') +
      (c.energy ? '<span class="pill acc">Energy: ' + esc(c.energy) + '</span>' : '') + (c.focus ? '<span class="pill acc">Focus: ' + esc(c.focus) + '</span>' : '') + '</div>' +
      ((c.tonight || []).length ? '<span class="small muted">Aiming to feel ' + esc(c.tonight.join(' and ').toLowerCase()) + ' tonight.</span>' : '') + '</section>';
  }
  return '<section class="card soft"><h2>Start your morning check-in</h2><span class="small">Tell Focus Flow how you feel so it can plan a realistic day.</span><div class="acts"><button class="btn primary" data-a="startCheckin">Start check-in</button></div></section>';
}
function viewHome() {
  var d = D(), p = P(), date = todayStr(), h = new Date().getHours();
  var greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  var list = tasks().filter(function (t) { return t.date === date && t.status !== 'cancelled'; }).sort(byTime);
  var dp = dayProgress(date), msg = dailyMessage();
  var wk = weekStart(date), rw = rewardFor(wk);
  var left = '<section class="card"><div class="row between"><h2>Today\'s plan</h2><div class="acts">' +
    (list.some(function (t) { return t.status === 'todo'; }) ? '<button class="btn sm" data-a="plan" data-date="' + date + '">Plan my day</button>' : '') +
    '<button class="btn sm primary" data-a="newTask" data-date="' + date + '">' + ic('plus', 16) + ' Add</button></div></div>' +
    (list.length ? '<div>' + list.map(function (t) { return taskRow(t); }).join('') + '</div>' : '<p class="muted">Nothing planned for today yet. Add a task, or type everything on your mind in the Tasks tab.</p>') + '</section>';
  var right = '<section class="card" style="flex-direction:row;align-items:center;gap:18px"><div class="ring" style="background:conic-gradient(var(--accent) ' + Math.round(dp.pct * 3.6) + 'deg,var(--line) 0)"><div>' + dp.pct + '%</div></div><div><h3>Today\'s progress</h3><p class="muted small">' + dp.done + ' of ' + dp.n + ' tasks done</p></div></section>';
  if (msg) right += '<section class="card soft"><span class="eyebrow" style="color:var(--accent-ink)">Today\'s message</span><p style="font-size:16px">' + esc(msg.t) + '</p>' + (msg.r ? '<p class="small" style="font-weight:700">' + esc(msg.r) + ' (KJV)</p>' : '') + '</section>';
  right += '<section class="card"><div class="row between"><span class="eyebrow">Weekly reward</span>' + (rw.r ? '<span class="pill ' + (rw.state === 'unlocked' || rw.state === 'on-track' ? 'ok' : '') + '">' + (rw.state === 'unlocked' ? 'Unlocked' : rw.state === 'on-track' ? 'Within reach' : 'Locked') + '</span>' : '') + '</div>' +
    (rw.r ? '<b>' + esc(rw.r.text) + '</b><div class="bar" style="position:relative"><i style="width:' + (rw.sc.pct || 0) + '%"></i><span class="mark" style="left:' + rw.th + '%"></span></div><span class="small muted">' + (rw.sc.pct === null ? 'No tasks counted yet' : rw.sc.pct + '% so far, ' + rw.th + '% needed') + '</span>' : '<p class="muted small">Set a treat for this week and earn it by following through.</p><div class="acts"><button class="btn sm" data-a="nav" data-v="insights">Set a reward</button></div>') + '</section>';
  if (h >= 18 && !d.evening[date]) right += '<section class="card"><b>Evening review</b><span class="small muted">See how the day went and plan tomorrow.</span><div class="acts"><button class="btn" data-a="evening">Start review</button></div></section>';
  var sh = shiftFor(date), trip = travelOn(date);
  var sub = fmtDate(date) + (trip ? ' · Travel mode' : sh ? ' · Shift ' + fmtTime12(fromMin(sh.a)).replace(':00', '') + ' to ' + fmtTime12(fromMin(Math.min(sh.b, 1439))).replace(':00', '') : (d.settings.hasShift ? ' · Day off' : ''));
  var who = CL.on ? '' : '<button class="iconbtn" data-a="picker" aria-label="Switch person">' + avatar(p, 'sm') + '</button>';
  if (AI.available && d.settings.ai) right += '<section class="card"><span class="eyebrow">Coach</span><b>Stuck, tired or unsure what to do next?</b><div class="acts"><button class="btn sm" data-a="coachAsk" data-q="What should I do next?">What should I do next?</button><button class="btn sm" data-a="coachAsk" data-q="I feel overwhelmed. Help me lighten today.">I feel overwhelmed</button></div></section>';
  return '<div class="head"><div><h1>' + greet + ', ' + esc(p.name) + '</h1><small>' + esc(sub) + '</small></div>' + who + '</div>' +
    banners() + activeCard() + checkinCard() + '<div class="grid"><div class="stack">' + left + '</div><div class="stack">' + right + '</div></div>';
}

/* ---------- Tasks ---------- */
function viewTasks() {
  var date = todayStr(), all = tasks(), body = '';
  var tabs = [['today', 'Today'], ['upcoming', 'Upcoming'], ['none', 'Unscheduled'], ['done', 'Done']];
  var tabHtml = '<div class="seg" role="tablist" aria-label="Task views">' + tabs.map(function (t) {
    return '<button role="tab" data-a="tab" data-val="' + t[0] + '" aria-pressed="' + (U.tab === t[0]) + '">' + t[1] + '</button>';
  }).join('') + '</div>';
  if (U.tab === 'today') {
    var od = all.filter(function (t) { return t.date && t.date < date && t.status === 'todo'; }).sort(byTime);
    var td = all.filter(function (t) { return t.date === date && t.status !== 'cancelled'; }).sort(byTime);
    if (od.length) body += '<section class="card warn"><b>Overdue (' + od.length + ')</b><div>' + od.map(function (t) { return taskRow(t, { date: true }); }).join('') + '</div></section>';
    body += '<section class="card">' + (td.length ? '<div>' + td.map(function (t) { return taskRow(t); }).join('') + '</div>' : '<p class="muted">Nothing for today. Add tasks above.</p>') + '</section>';
  } else if (U.tab === 'upcoming') {
    var up = all.filter(function (t) { return t.date && t.date > date && t.status === 'todo'; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : byTime(a, b); });
    body = '<section class="card">' + (up.length ? '<div>' + up.map(function (t) { return taskRow(t, { date: true }); }).join('') + '</div>' : '<p class="muted">No future tasks. Type something like "submit the application on October 20".</p>') + '</section>';
  } else if (U.tab === 'none') {
    var un = all.filter(function (t) { return !t.date && t.status === 'todo'; });
    body = '<section class="card">' + (un.length ? '<div>' + un.map(function (t) { return taskRow(t); }).join('') + '</div>' : '<p class="muted">Nothing waiting for a date.</p>') + '</section>';
  } else {
    var dn = all.filter(function (t) { return t.status === 'done'; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); }).slice(0, 60);
    body = '<section class="card">' + (dn.length ? '<div>' + dn.map(function (t) { return taskRow(t, { date: true }); }).join('') + '</div>' : '<p class="muted">Finished tasks appear here.</p>') + '</section>';
  }
  var quick = '<form class="card" data-f="quickAdd"><div class="field"><label for="quick">Type what you need to do</label>' +
    '<textarea id="quick" rows="2" placeholder="Study Isaiah chapter 1 for 30 minutes, call my contact at 4pm, submit the application on October 20"></textarea></div>' +
    '<div class="row"><div class="field grow"><label for="quickDate">Day for these tasks</label><select id="quickDate"><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="none">No date yet</option></select></div>' +
    micBtn('quick', 'align-self:flex-end') + '<button class="btn primary" type="submit" style="align-self:flex-end">Add tasks</button></div>' +
    '<span class="small muted">Separate tasks with commas or new lines. Durations, times and dates in your words are picked up. Use "Add task" for full control.</span></form>';
  return '<div class="head"><h1>Tasks</h1><button class="btn primary" data-a="newTask">' + ic('plus', 18) + ' Add task</button></div>' + quick + tabHtml + body;
}
/* ---------- Goals ---------- */
function goalCard(g) {
  var d = D(), pr = goalProgress(g), n = tasks().filter(function (t) { return t.goalId === g.id; }).length;
  var parent = g.parentId ? d.goals.find(function (x) { return x.id === g.parentId; }) : null;
  return '<div class="task"><div class="grow" style="display:flex;flex-direction:column;gap:8px"><div class="row between"><h3>' + esc(g.title) + '</h3><span class="pill acc">' + pr + '%</span></div>' +
    bar(pr, pr === 100) + '<div class="small muted">' + n + ' linked task' + (n === 1 ? '' : 's') + (parent ? ' · Part of: ' + esc(parent.title) : '') + '</div>' +
    '<div class="acts"><button class="btn sm ghost danger" data-a="delGoal" data-id="' + g.id + '">Delete goal</button></div></div></div>';
}
function viewGoals() {
  var gs = D().goals;
  var form = '<form class="card" data-f="addGoal"><h2>Add a goal</h2>' +
    '<div class="field"><label for="gTitle">Goal</label><input id="gTitle" type="text" required placeholder="e.g. Become proficient in data analysis"></div>' +
    '<div class="row"><div class="field grow"><label for="gLevel">Level</label><select id="gLevel">' + LEVELS.map(function (l) { return '<option value="' + l + '">' + LEVEL_NAME[l] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field grow"><label for="gParent">Part of</label><select id="gParent"><option value="">Nothing (top level)</option>' + gs.map(function (g) { return '<option value="' + g.id + '">' + esc(LEVEL_NAME[g.level] + ': ' + g.title) + '</option>'; }).join('') + '</select></div></div>' +
    '<button class="btn primary" type="submit">Add goal</button><span class="small muted">Link tasks to a goal when you add or edit them. A goal\'s progress comes from its finished tasks and the goals under it.</span></form>';
  var groups = LEVELS.map(function (lv) {
    var L = gs.filter(function (g) { return g.level === lv; });
    return L.length ? '<section class="card"><h2>' + LEVEL_NAME[lv] + ' goals</h2><div>' + L.map(goalCard).join('') + '</div></section>' : '';
  }).join('');
  return '<div class="head"><h1>Goals</h1></div>' + form + (groups || '<p class="muted">No goals yet. Start with one big goal for the year.</p>');
}

/* ---------- Insights ---------- */
function statTiles(sc) {
  return '<div class="tiles"><div class="tile"><span class="small muted">Planned</span><b>' + sc.planned + '</b></div><div class="tile"><span class="small muted">Removed (emergency)</span><b>' + sc.removed + '</b></div><div class="tile"><span class="small muted">Counted</span><b>' + sc.counted + '</b></div><div class="tile"><span class="small muted">Done</span><b>' + sc.done + '</b></div></div>';
}
function viewWeek() {
  var off = U.wOff || 0, ws = addDays(weekStart(todayStr()), 7 * off), we = addDays(ws, 6), rw = rewardFor(ws), sc = rw.sc;
  var label = fmtDate(ws, { day: 'numeric', month: 'short' }) + ' to ' + fmtDate(we, { day: 'numeric', month: 'short' });
  var navr = '<div class="row between"><button class="btn sm" data-a="wk" data-n="-1">Previous</button><b>' + label + '</b><button class="btn sm" data-a="wk" data-n="1"' + (off >= 1 ? ' disabled' : '') + '>Next</button></div>';
  var reward;
  if (rw.r) {
    var st = rw.state === 'unlocked' ? '<span class="pill ok">Unlocked</span>' : rw.state === 'on-track' ? '<span class="pill ok">Within reach</span>' : '<span class="pill">Locked</span>';
    reward = '<section class="card night"><div class="row between"><span class="eyebrow">Your reward</span>' + st + '</div><h2>' + esc(rw.r.text) + '</h2>' +
      '<div class="bar" style="position:relative;background:var(--night-2)"><i style="width:' + (sc.pct || 0) + '%;background:var(--night-accent)"></i><span class="mark" style="left:' + rw.th + '%;background:#fff"></span></div>' +
      '<div class="row between small"><span>You: ' + (sc.pct === null ? 'no tasks yet' : sc.pct + '%') + '</span><span style="color:var(--night-muted)">Needed: ' + rw.th + '%</span></div>' +
      (sc.counted ? '<span class="small" style="color:var(--night-muted)">' + (rw.state === 'unlocked' ? 'Well done. You finished ' + sc.done + ' of ' + sc.counted + ' counted tasks.' : rw.state === 'locked-final' ? 'This week ended with ' + sc.done + ' of ' + sc.counted + ' done. You needed ' + rw.need + '.' : 'You need ' + rw.need + ' of ' + sc.counted + ' counted tasks. ' + Math.max(0, rw.need - sc.done) + ' to go.') + '</span>' : '') + '</section>';
  } else if (off >= 0) {
    reward = '<form class="card" data-f="reward" data-wk="' + ws + '"><h2>Set this week\'s reward</h2><div class="field"><label for="rwText">What will you treat yourself to?</label><input id="rwText" type="text" required placeholder="e.g. A meal out"></div><div class="field"><label for="rwTh">Percent of planned tasks to finish</label><input id="rwTh" type="number" min="50" max="100" value="90"></div><button class="btn primary" type="submit">Save reward</button></form>';
  } else reward = '<section class="card"><p class="muted">No reward was set for this week.</p></section>';
  var cols = '<section class="card"><h3>Each day</h3><div class="cols">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) {
    var dt = addDays(ws, i), dp = dayProgress(dt);
    return '<div><span class="num">' + (dp.n ? dp.pct + '%' : '') + '</span><i style="height:' + Math.max(3, dp.pct) + '%"></i><span>' + fmtDate(dt, { weekday: 'short' }) + '</span></div>';
  }).join('') + '</div></section>';
  var formula = '<section class="card soft"><b style="color:var(--accent-ink)">How the score works</b><span class="small">Done tasks divided by counted tasks. A task you reschedule counts on its new date. A task you cancel and mark as an emergency is removed from the total. Any other cancelled task counts as not done.</span></section>';
  var inW = tasks().filter(function (t) { return t.date && t.date >= ws && t.date <= we; });
  var happ = [];
  inW.filter(function (t) { return t.postponed >= 1; }).sort(function (x, y) { return y.postponed - x.postponed; }).slice(0, 2).forEach(function (t) { happ.push(esc(t.title) + ' was moved to another day ' + t.postponed + ' time' + (t.postponed === 1 ? '' : 's') + '.'); });
  var topT = inW.filter(function (t) { return t.actual > 0; }).sort(function (x, y) { return y.actual - x.actual; })[0];
  if (topT) happ.push('You spent the most time on ' + esc(topT.title) + ' (' + fmtDur(topT.actual / 60) + ').');
  if (!happ.length) happ.push('Nothing to report yet. Finish some timed tasks and this fills in.');
  var happen = '<section class="card"><h3>What happened</h3>' + happ.map(function (h) { return '<p class="small">' + h + '</p>'; }).join('') + '</section>';
  var nextBtn = (off === 0 && !D().rewards[addDays(ws, 7)]) ? '<button class="btn primary block" data-a="nextReward">Set next week\'s reward</button>' : '';
  var ask = aiOn() ? '<button class="btn block" data-a="coachAsk" data-q="Review my week so far: what went well, what should I change next week?">Ask the coach to review this week</button>' : '';
  return navr + reward + '<section class="card"><h3>This week</h3>' + statTiles(sc) + '</section>' + cols + happen + formula + nextBtn + ask;
}
function viewMonth() {
  var off = U.mOff || 0, b = new Date(), first = new Date(b.getFullYear(), b.getMonth() + off, 1);
  var from = ymd(first), to = ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0)), sc = scoreRange(from, to);
  var navr = '<div class="row between"><button class="btn sm" data-a="mo" data-n="-1">Previous</button><b>' + first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</b><button class="btn sm" data-a="mo" data-n="1"' + (off >= 0 ? ' disabled' : '') + '>Next</button></div>';
  var weeks = '', ws = weekStart(from);
  while (ws <= to) {
    var a = ws < from ? from : ws, z = addDays(ws, 6) > to ? to : addDays(ws, 6), s = scoreRange(a, z);
    weeks += '<div class="kv"><span>' + fmtDate(a, { day: 'numeric', month: 'short' }) + ' to ' + fmtDate(z, { day: 'numeric', month: 'short' }) + '</span><b class="num">' + (s.pct === null ? 'No tasks' : s.pct + '% (' + s.done + ' of ' + s.counted + ')') + '</b></div>';
    ws = addDays(ws, 7);
  }
  var inM = tasks().filter(function (t) { return t.date && t.date >= from && t.date <= to; });
  var post = inM.filter(function (t) { return t.postponed >= 2; }).sort(function (x, y) { return y.postponed - x.postponed; }).slice(0, 5);
  var timed = inM.filter(function (t) { return t.status === 'done' && t.actual > 0; });
  var ratio = timed.length ? Math.round(timed.reduce(function (a, t) { return a + (t.actual / 60) / t.est; }, 0) / timed.length * 100) : null;
  var cis = Object.keys(D().checkins).filter(function (k) { return k >= from && k <= to; });
  var en = { low: 0, medium: 0, high: 0 }; cis.forEach(function (k) { var e = D().checkins[k].energy; if (en[e] !== undefined) en[e]++; });
  var evs = Object.keys(D().evening).filter(function (k) { return k >= from && k <= to; }), better = evs.filter(function (k) { return D().evening[k].better === 'better'; }).length;
  var goals = D().goals.map(function (g) { return '<div class="kv"><span>' + esc(g.title) + '</span><b class="num">' + goalProgress(g) + '%</b></div>'; }).join('') || '<span class="muted small">No goals yet.</span>';
  var tips = [];
  if (sc.pct !== null && sc.pct < 70) tips.push('Plan fewer tasks per day so the plan matches your real capacity.');
  if (post.length) tips.push('Try shorter sessions for "' + post[0].title + '", it was moved ' + post[0].postponed + ' times.');
  if (ratio !== null && ratio > 120) tips.push('Allow more time. Finished tasks took about ' + ratio + '% of your estimates.');
  if (ratio !== null && ratio < 70) tips.push('You can plan more. Finished tasks took about ' + ratio + '% of your estimates.');
  if (evs.length < cis.length) tips.push('Do the evening review more often so tomorrow starts planned.');
  if (!tips.length) tips.push(sc.counted ? 'Keep your current routine. Your numbers look steady.' : 'Add and finish a few tasks. Your first report builds from them.');
  return navr + '<section class="card"><div class="row" style="gap:18px"><div class="ring" style="background:conic-gradient(var(--accent) ' + Math.round((sc.pct || 0) * 3.6) + 'deg,var(--line) 0)"><div>' + (sc.pct === null ? '-' : sc.pct + '%') + '</div></div><div><h3>Planned tasks completed</h3><p class="muted small">' + sc.done + ' of ' + sc.counted + ' counted tasks</p></div></div>' + statTiles(sc) + '</section>' +
    '<section class="card"><h3>Week by week</h3>' + weeks + '</section>' +
    '<section class="card"><span class="eyebrow">Recorded in the app</span>' +
    '<div class="kv"><span>Estimates vs actual</span><b class="num">' + (ratio === null ? 'Not enough timed tasks' : 'Tasks took ' + ratio + '% of the estimate') + '</b></div>' +
    '<div class="kv"><span>Check-ins</span><b class="num">' + cis.length + ' (low energy ' + en.low + ', medium ' + en.medium + ', high ' + en.high + ')</b></div>' +
    '<div class="kv"><span>Evenings feeling better</span><b class="num">' + better + ' of ' + evs.length + '</b></div>' +
    '<div><span class="lbl">Moved more than once</span>' + (post.length ? post.map(function (t) { return '<div class="kv"><span>' + esc(t.title) + '</span><b class="num">' + t.postponed + ' times</b></div>'; }).join('') : '<div class="small muted">None this month.</div>') + '</div></section>' +
    '<section class="card"><span class="eyebrow">Goal progress</span>' + goals + '</section>' +
    '<section class="card soft"><span class="eyebrow" style="color:var(--accent-ink)">Suggestions from your numbers</span>' + tips.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '<span class="small muted">This report only uses what you recorded here. It does not guess how you spent time outside Focus Flow.</span></section>';
}
function viewInsights() {
  var r = U.range;
  return '<div class="head"><h1>Insights</h1></div><div class="seg"><button data-a="range" data-val="week" aria-pressed="' + (r === 'week') + '">Week and reward</button><button data-a="range" data-val="month" aria-pressed="' + (r === 'month') + '">Monthly report</button></div>' + (r === 'week' ? viewWeek() : viewMonth());
}

/* ---------- Settings ---------- */
function timeSel(id, cur) { return '<input id="' + id + '" type="time" value="' + esc(cur) + '" aria-label="' + id + '">'; }
function shiftRows(key, s) {
  return DAYS.map(function (n, i) {
    var e = s.shifts[key][i];
    return '<div class="shiftrow"><label class="check"><input id="sh' + key + i + 'on" type="checkbox"' + (e.on ? ' checked' : '') + '> <b style="min-width:34px">' + n + '</b></label>' +
      '<input id="sh' + key + i + 'a" type="time" value="' + esc(e.a) + '" aria-label="' + n + ' shift starts"><span class="muted">to</span><input id="sh' + key + i + 'b" type="time" value="' + esc(e.b) + '" aria-label="' + n + ' shift ends"></div>';
  }).join('');
}
function rotaWeekIndex(s) { return (Math.round((parseYmd(weekStart(todayStr())) - parseYmd(weekStart(s.rotaAnchor))) / 604800000) % 2 + 2) % 2; }
function notifyState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
function tripCard(t) {
  return '<div class="kv" style="align-items:center"><span><b>' + esc(t.place) + '</b><br><span class="small muted">' + fmtDate(t.from, { day: 'numeric', month: 'short' }) + ' to ' + fmtDate(t.to, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · up to ' + (t.maxHours || 4) + ' h of tasks a day' + (t.keepShift ? ' · shift kept' : '') + '</span></span>' +
    '<button class="btn sm ghost danger" data-a="delTrip" data-id="' + t.id + '">Remove</button></div>';
}
function viewSettings() {
  var p = P(), d = D(), s = d.settings, ns = notifyState();
  var two = s.rotaWeeks === 2;
  var f = '<form class="card" data-f="settings"><h2>Your profile</h2>' +
    '<div class="field"><label for="sName">Name</label><input id="sName" type="text" required value="' + esc(p.name) + '"></div>' +
    '<div class="field"><label for="sEmail2">Email (for reminders later)</label><input id="sEmail2" type="email" value="' + esc(p.email || '') + '"></div>' +
    '<div class="field"><span class="lbl">Choose your look</span><div class="chips" data-single>' + THEMES.map(swatchHtml(p.color)).join('') + '</div></div>' +
    '<div class="field"><span class="lbl">Appearance</span><div class="seg" data-single>' + [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(function (m) { return segBtn(m[1], s.theme === m[0], 'theme', m[0]); }).join('') + '</div></div>' +
    '<div class="field"><span class="lbl">Daily message</span><div class="seg" data-single>' + [['motivation', 'Motivation'], ['bible', 'Bible verse'], ['none', 'None']].map(function (m) { return segBtn(m[1], s.message === m[0], 'msg', m[0]); }).join('') + '</div></div>' +
    '<h2 style="margin-top:8px">Work schedule</h2><span class="small muted">Tick the days you work and set the hours. Focus Flow never plans tasks inside a shift. Overnight shifts work too: set the end earlier than the start.</span>' +
    '<div class="field"><span class="lbl">Pattern</span><div class="seg" data-single><button type="button" data-a="rotaPick" data-g="rota" data-val="1" aria-pressed="' + !two + '">Same every week</button><button type="button" data-a="rotaPick" data-g="rota" data-val="2" aria-pressed="' + two + '">Two-week rota</button></div></div>' +
    '<div class="stack" style="gap:6px"><b>' + (two ? 'Week A' : 'Every week') + '</b>' + shiftRows('A', s) + '</div>' +
    '<div id="rotaB" class="stack" style="gap:6px"' + (two ? '' : ' hidden') + '><b>Week B</b>' + shiftRows('B', s) +
    '<div class="field"><span class="lbl">This week is</span><div class="seg" data-single>' + segBtn('Week A', rotaWeekIndex(s) === 0, 'thisweek', 'A') + segBtn('Week B', rotaWeekIndex(s) === 1, 'thisweek', 'B') + '</div></div></div>' +
    '<span class="small muted">For a single odd day, open it in the Calendar and use Change shift.</span>' +
    '<h2 style="margin-top:8px">Reminders</h2>' +
    '<div class="row"><div class="field grow"><label for="sFrom">Evening planning reminder from</label><input id="sFrom" type="time" value="' + s.planFrom + '"></div><div class="field grow"><label for="sTo">until</label><input id="sTo" type="time" value="' + s.planTo + '"></div></div>' +
    '<label class="check"><input id="sApp" type="checkbox"' + (s.appNotify ? ' checked' : '') + '> App notifications (while Focus Flow is open)</label>' +
    '<label class="check"><input id="sSound" type="checkbox"' + (s.sound !== false ? ' checked' : '') + '> Play a sound with reminders</label>' +
    '<label class="check"><input id="sVib" type="checkbox"' + (s.vibrate !== false ? ' checked' : '') + '> Vibrate on phones</label>' +
    '<div class="row"><button type="button" class="btn sm" data-a="testSound">Test sound</button></div>' +
    '<div class="row"><div class="field grow"><label for="sRs">Remind me before a task starts</label><select id="sRs">' + [[0, 'Off'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before']].map(function (o) { return '<option value="' + o[0] + '"' + (s.remindStart === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field grow"><label for="sCe">Check in on my day</label><select id="sCe">' + [[0, 'Off'], [60, 'Every hour'], [120, 'Every 2 hours'], [180, 'Every 3 hours']].map(function (o) { return '<option value="' + o[0] + '"' + (s.checkinEvery === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
    '<div class="row"><div class="field grow"><label for="sQf">Quiet hours from</label><input id="sQf" type="time" value="' + s.quietFrom + '"></div><div class="field grow"><label for="sQt">until</label><input id="sQt" type="time" value="' + s.quietTo + '"></div></div>' +
    '<label class="check"><input id="sEmail" type="checkbox"' + (s.emailNotify ? ' checked' : '') + '> Email reminders</label>' +
    (typeof SB !== 'undefined' && SB.on ? '<span class="small muted">Reminders are also sent by the server, so they reach you when Focus Flow is closed: phone alerts (turn them on under Your account below) and email to ' + esc((SB.session && SB.session.user && SB.session.user.email) || 'your sign-in email') + '.</span>' : '<span class="small muted">Email reminders are saved as a preference only. Nothing is emailed in this copy. App reminders only fire while this page is open.</span>') +
    '<div class="row"><span class="small">Browser notifications: <b>' + (ns === 'granted' ? 'allowed' : ns === 'denied' ? 'blocked in this browser' : ns === 'unsupported' ? 'not supported here' : 'not allowed yet') + '</b></span>' + (ns === 'default' ? '<button type="button" class="btn sm" data-a="askNotifyNow">Allow notifications</button>' : '') + '</div>' +
    (AI.available ? '<h2 style="margin-top:8px">AI helper</h2><label class="check"><input id="sAi" type="checkbox"' + (s.ai ? ' checked' : '') + '> Use the AI helper (Coach and "Ask AI to change")</label><span class="small muted">When you ask it something, your tasks for the day, goals and mood check-in are sent to Claude to answer, using your own Claude account. Nothing is sent unless you press a button to ask.</span>' : '') +
    '<button class="btn primary" type="submit">Save settings</button></form>';
  var trips = (d.travel || []).slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  var travel = '<form class="card" data-f="travel"><h2>Travel mode</h2><span class="small muted">When you are away, Focus Flow stops planning your shift, plans a shorter day and keeps the load light. It shows on your Calendar.</span>' +
    (trips.length ? '<div>' + trips.map(tripCard).join('') + '</div>' : '') +
    '<div class="field"><label for="trPlace">Where are you going?</label><input id="trPlace" type="text" required placeholder="e.g. Abuja"></div>' +
    '<div class="row"><div class="field grow"><label for="trFrom">From</label><input id="trFrom" type="date" required value="' + todayStr() + '"></div><div class="field grow"><label for="trTo">To</label><input id="trTo" type="date" required value="' + addDays(todayStr(), 3) + '"></div></div>' +
    '<div class="row"><div class="field grow"><label for="trMax">Most hours of tasks a day</label><select id="trMax">' + [2, 3, 4, 6].map(function (h) { return '<option value="' + h + '"' + (h === 4 ? ' selected' : '') + '>' + h + ' hours</option>'; }).join('') + '</select></div></div>' +
    '<label class="check"><input id="trKeep" type="checkbox"> I still work my shifts while away</label>' +
    '<button class="btn" type="submit">Add trip</button></form>';
  var install = '<section class="card"><h2>Use it like an app</h2><p class="small muted">On a phone, open this page in your browser, then use the browser menu: Share then Add to Home Screen on iPhone, or the three dots then Install app on Android. It then opens full screen from your home screen.</p>' +
    (U.installPrompt ? '<div class="acts"><button class="btn primary" data-a="installApp">Install Focus Flow</button></div>' : '') + '</section>';
  var account;
  if (typeof SB !== 'undefined' && SB.on) { account = sbAccountCard(); if (!SB.pushAsked) { SB.pushAsked = true; sbPushRefresh(); } }
  else if (CL.on) {
    account = '<section class="card"><h2>Your account</h2><p class="small">You are signed in through Claude. Your tasks, goals and settings are saved online and follow you to every phone or computer where you open this page.</p>' +
      '<div class="kv small"><span class="muted">Status</span><b>' + esc(CL.status || 'Connected') + '</b></div>' +
      '<div class="acts"><button class="btn" data-a="showBackup">' + (U.backup ? 'Hide backup' : 'Show backup text') + '</button><button class="btn danger" data-a="askDelProfile">Delete my data</button></div>' +
      (U.backup ? '<pre class="box" id="backupText">' + esc(JSON.stringify({ profile: p, data: d })) + '</pre><div class="acts"><button class="btn sm" data-a="copyBackup">Copy</button></div>' : '') +
      '<div class="field"><label for="importBox">Restore from a backup</label><textarea id="importBox" placeholder="Paste backup text here"></textarea></div><div class="acts"><button class="btn" data-a="importBackup">Restore</button></div></section>';
  } else {
    account = '<section class="card"><h2>Your data</h2><p class="small muted">This copy keeps everything in this browser, separately for each person. Open Focus Flow from its Claude link to sign in and sync across devices. Use a backup to move data by hand.</p>' +
      '<div class="acts"><button class="btn" data-a="showBackup">' + (U.backup ? 'Hide backup' : 'Show backup text') + '</button></div>' +
      (U.backup ? '<pre class="box" id="backupText">' + esc(JSON.stringify({ profile: p, data: d })) + '</pre><div class="acts"><button class="btn sm" data-a="copyBackup">Copy</button></div>' : '') +
      '<div class="field"><label for="importBox">Restore from a backup</label><textarea id="importBox" placeholder="Paste backup text here"></textarea></div><div class="acts"><button class="btn" data-a="importBackup">Restore</button></div>' +
      '<h3>People on this device</h3><div class="acts"><button class="btn" data-a="picker">Switch person</button><button class="btn danger" data-a="askDelProfile">Remove ' + esc(p.name) + '</button></div></section>';
  }
  return '<div class="head"><h1>Settings</h1></div>' + f + travel + install + account;
}

/* ---------- overlays: forms, plan review, timer ---------- */
function sheet(label, inner) { return '<div class="ov"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + inner + '</div></div>'; }
function openOverlay(type, props) { U.overlay = { type: type, props: props || {} }; renderOverlay(); }
function closeOverlay() { U.overlay = null; renderOverlay(); render(); }
function renderOverlay() {
  var el = $('#overlay'), o = U.overlay;
  if (!o || !OV[o.type]) { el.innerHTML = ''; document.body.style.overflow = ''; return; }
  var html = OV[o.type](o.props);
  if (!html) { U.overlay = null; el.innerHTML = ''; document.body.style.overflow = ''; return; }
  el.innerHTML = html; document.body.style.overflow = 'hidden';
  var dlg = el.querySelector('[role=dialog]'); if (dlg) { dlg.setAttribute('tabindex', '-1'); try { dlg.focus({ preventScroll: true }); } catch (e) { } }
}
function nextTask() {
  var date = todayStr();
  return tasks().filter(function (t) { return t.date === date && t.status === 'todo'; }).sort(byTime)[0] || null;
}

OV.task = function (p) {
  var t = p.id ? taskById(p.id) : null, d = D();
  var goalOpts = '<option value="">No goal</option>' + d.goals.map(function (g) { return '<option value="' + g.id + '"' + (t && t.goalId === g.id ? ' selected' : '') + '>' + esc(LEVEL_NAME[g.level] + ': ' + g.title) + '</option>'; }).join('');
  var pri = [['high', 'High'], ['med', 'Medium'], ['low', 'Low']].map(function (x) { return '<option value="' + x[0] + '"' + ((t ? t.priority : 'med') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('');
  var extra = t ? '<div class="acts">' +
    (t.status === 'cancelled' ? '<button type="button" class="btn sm" data-a="reopen" data-id="' + t.id + '">Bring back</button>' : '<button type="button" class="btn sm" data-a="moveTomorrow" data-id="' + t.id + '">Move to tomorrow</button><button type="button" class="btn sm" data-a="cancelTask" data-id="' + t.id + '" data-em="1">Cancel (emergency, not counted)</button><button type="button" class="btn sm" data-a="cancelTask" data-id="' + t.id + '" data-em="0">Cancel (counts as not done)</button>') +
    '<button type="button" class="btn sm danger" data-a="delTask" data-id="' + t.id + '">Delete</button></div>' : '';
  return sheet(t ? 'Edit task' : 'New task', '<h2>' + (t ? 'Edit task' : 'New task') + '</h2>' +
    '<form data-f="task" data-id="' + (t ? t.id : '') + '" class="stack">' +
    '<div class="field"><label for="tfTitle">What needs doing?</label><input id="tfTitle" type="text" required value="' + esc(t ? t.title : '') + '"></div>' +
    '<div class="row"><div class="field grow"><label for="tfDate">Date</label><input id="tfDate" type="date" value="' + esc(t ? (t.date || '') : (p.date || '')) + '"></div><div class="field grow"><label for="tfTime">Start time (optional)</label><input id="tfTime" type="time" value="' + esc(t ? t.time : '') + '"></div></div>' +
    '<div class="row"><div class="field grow"><label for="tfEst">Estimated minutes</label><input id="tfEst" type="number" min="5" step="5" value="' + (t ? t.est : 30) + '"></div><div class="field grow"><label for="tfPri">Priority</label><select id="tfPri">' + pri + '</select></div></div>' +
    '<div class="field"><label for="tfGoal">Part of goal</label><select id="tfGoal">' + goalOpts + '</select></div>' +
    '<div class="acts"><button class="btn primary" type="submit">Save</button><button type="button" class="btn" data-a="back">Close</button></div></form>' + extra);
};

OV.status = function () {
  var a = D().active; if (!a) return '';
  var t = taskById(a.taskId);
  return sheet('Time check', '<span class="eyebrow">Estimated time reached</span><h2>Are you still working on ' + esc(t.title) + '?</h2><p class="muted">Your ' + fmtDur(t.est) + ' are up. The real time spent is recorded so your next estimate improves.</p>' +
    '<button class="btn primary block" data-a="statusContinue">Continue working</button><button class="btn block" data-a="statusPause">Pause</button><button class="btn ok block" data-a="finish">I am done, mark complete</button>');
};
OV.confirm = function (p) {
  return sheet('Please confirm', '<h2>' + esc(p.text) + '</h2><div class="acts"><button class="btn danger" data-a="' + p.yes + '" data-id="' + (p.id || '') + '">Yes, continue</button><button class="btn" data-a="back">Keep it</button></div>');
};
/* ---------- voice: type or speak ---------- */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
ICONS.mic = 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3';
function micBtn(target, style) {
  if (!SR) return '';
  return '<button type="button" class="iconbtn" data-a="mic" data-target="' + target + '" aria-label="Speak instead of typing" style="' + (style || '') + '">' + ic('mic', 20) + '</button>';
}
function swatchHtml(cur) {
  return function (t) {
    return '<button type="button" class="sw" data-a="swatch" data-g="color" data-val="' + t.c + '" aria-label="' + t.n + ' look" aria-pressed="' + (cur === t.c) + '" style="background:' + t.c + '"></button>';
  };
}
function pageWrap(label, inner) { return '<div class="page" role="dialog" aria-modal="true" aria-label="' + esc(label) + '"><div class="inner">' + inner + '</div></div>'; }
function heroBlock(center) {
  return '<div class="hero"' + (center ? ' style="align-items:center;text-align:center"' : '') + '><span class="logo" style="width:56px;height:56px;border-radius:16px">' + ic('logo', 30, '#fff') + '</span><h1 style="font-size:32px">Focus Flow</h1><p style="font-size:16px;color:var(--muted)">Plan. Prioritise. Progress.</p></div>';
}

/* ---------- screens A and B: profile and setup ---------- */
function newWiz() { return { step: 1, name: CL.on ? (CL.meName || '') : '', email: '', color: THEMES[0].c }; }
function viewPicker() {
  if (CL.on && !S.profiles.length && U.importAsk && !U.wiz) return viewImport();
  if (!S.profiles.length && !U.wiz) U.wiz = newWiz();
  if (U.wiz) return viewWizard();
  return '<div class="main" style="min-height:100%;justify-content:center;max-width:640px">' + heroBlock(true) +
    '<h2 class="center">Who is using Focus Flow?</h2><p class="muted center">Each person has a private list of tasks, goals and check-ins.</p>' +
    '<div class="pick">' + S.profiles.map(function (p) { return '<button data-a="pickProfile" data-id="' + p.id + '">' + avatar(p) + '<span>' + esc(p.name) + '</span></button>'; }).join('') +
    '<button data-a="addPerson"><span class="av" style="background:var(--accent-soft);color:var(--accent-ink)">' + ic('plus', 24) + '</span><span>Add person</span></button></div></div>';
}
function viewWizard() {
  var w = U.wiz, wrap = '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(false);
  if (w.step === 1) return wrap +
    '<form class="card" data-f="wiz1"><div class="row between"><h2>' + (CL.on ? 'Set up your profile' : 'Create your profile') + '</h2><span class="small muted" style="font-weight:600">Step 1 of 2</span></div>' +
    '<div class="field"><label for="wName">Full name</label><input id="wName" type="text" required value="' + esc(w.name) + '" autocomplete="off" placeholder="Your name"></div>' +
    '<div class="field"><label for="wEmail">Email (optional, for reminders later)</label><input id="wEmail" type="email" value="' + esc(w.email) + '" placeholder="you@example.com"></div>' +
    '<div class="field"><span class="lbl">Choose your look</span><div class="chips" data-single>' + THEMES.map(swatchHtml(w.color)).join('') + '</div></div>' +
    '<button class="btn primary block" type="submit">Continue</button>' + (S.profiles.length ? '<button type="button" class="btn ghost" data-a="cancelWiz">Back</button>' : '') +
    '<span class="small muted center">' + (CL.on ? (typeof SB !== 'undefined' && SB.on ? 'You are signed in. Your tasks are saved online and follow you to your other devices.' : 'You are signed in through Claude. Your tasks are saved online and follow you to your other devices.') : 'No password needed. Your tasks stay in this browser.') + '</span></form></div>';
  var s = newData().settings, days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return wrap +
    '<form class="card" data-f="wiz2"><div class="row between"><h2>Set up your day</h2><span class="small muted" style="font-weight:600">Step 2 of 2</span></div>' +
    '<div class="field"><label for="wGoal">Your biggest goal this year</label><input id="wGoal" type="text" placeholder="e.g. Become proficient in data analysis"></div>' +
    '<div class="row"><div class="field grow"><label for="wFrom">Evening planning reminder from</label><input id="wFrom" type="time" value="' + s.planFrom + '"></div><div class="field grow"><label for="wTo">until</label><input id="wTo" type="time" value="' + s.planTo + '"></div></div>' +
    '<div class="field"><span class="lbl">Work days</span><div class="chips" data-multi>' + days.map(function (n, i) { return chip(n, i >= 1 && i <= 5, 'wd', i); }).join('') + '</div></div>' +
    '<label class="check"><input id="wShift" type="checkbox"> I work a fixed shift</label>' +
    '<div class="row"><div class="field grow"><label for="wSa">Shift starts</label><input id="wSa" type="time" value="08:00"></div><div class="field grow"><label for="wSb">Shift ends</label><input id="wSb" type="time" value="18:00"></div></div>' +
    '<div class="field"><span class="lbl">Remind me by</span><div class="chips" data-multi>' + chip('App notification', true, 'rem', 'app') + chip('Email', false, 'rem', 'email') + '</div><span class="small muted">' + (typeof SB !== 'undefined' && SB.on ? 'Email goes to your sign-in address. You can turn on phone alerts later in Settings.' : 'Email is saved as a preference only. Nothing is emailed yet.') + '</span></div>' +
    '<div class="field"><span class="lbl">Daily message</span><div class="chips" data-single>' + chip('Motivational', true, 'msg', 'motivation') + chip('Bible verse', false, 'msg', 'bible') + chip('None', false, 'msg', 'none') + '</div></div>' +
    '<button class="btn primary block" type="submit">Finish setup</button><button type="button" class="btn ghost" data-a="wizBack">Back</button></form></div>';
}

/* ---------- screen C: morning check-in ---------- */
function viewCheckinPage() {
  var p = P(), h = new Date().getHours(), greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  var moods = ['Tired', 'Frustrated', 'Calm', 'Motivated', 'Anxious'], tonight = ['Productive', 'Peaceful', 'Accomplished', 'Rested'];
  return '<div class="main" style="min-height:100%;max-width:480px;justify-content:center">' +
    '<div class="stack" style="gap:6px"><span class="small muted" style="font-weight:600">' + greet + ', ' + esc(p.name) + '</span><h1>How are you feeling today?</h1></div>' +
    '<form data-f="checkin" class="stack" style="gap:22px">' +
    '<div class="chips" data-multi>' + moods.map(function (m) { return chip(m, false, 'mood', m); }).join('') + '</div>' +
    '<div class="field"><span class="lbl" style="font-size:15px;color:var(--ink);font-weight:700">How much energy do you have?</span><div class="seg" data-single>' + ['Low', 'Medium', 'High'].map(function (m) { return segBtn(m, m === 'Medium', 'energy', m.toLowerCase()); }).join('') + '</div></div>' +
    '<div class="field"><span class="lbl" style="font-size:15px;color:var(--ink);font-weight:700">How focused do you feel?</span><div class="seg" data-single>' + ['Scattered', 'Okay', 'Sharp'].map(function (m) { return segBtn(m, m === 'Okay', 'focus', m.toLowerCase()); }).join('') + '</div></div>' +
    '<div class="field"><span class="lbl" style="font-size:15px;color:var(--ink);font-weight:700">How would you like to feel by tonight?</span><div class="chips" data-multi>' + tonight.map(function (m) { return chip(m, false, 'tonight', m); }).join('') + '</div></div>' +
    '<button class="btn primary block" type="submit">Prepare my day</button><button type="button" class="btn ghost" data-a="skipCheckin">Skip for now</button></form></div>';
}
/* ---------- screens D and E: plan preview, review and confirm ---------- */
function planOff(dr, L) {
  var ids = dr.removed.slice(); L.unplaced.forEach(function (u) { if (ids.indexOf(u.t.id) < 0) ids.push(u.t.id); });
  return ids.map(taskById).filter(Boolean);
}
OV.plan = function (p) {
  var dr = p.draft, L = layout(dr), off = planOff(dr, L), s = D().settings;
  var isToday = dr.date === todayStr(), dayWord = isToday ? 'today' : fmtDate(dr.date, { weekday: 'long' });
  var cnt = L.rows.filter(function (r) { return r.kind === 'task'; }).length;
  var offCard = off.length ? '<div class="card warn"><b>' + (p.step === 'edit' ? 'Not scheduled ' + dayWord : 'Does not fit ' + dayWord) + ' (' + off.length + ')</b><span class="small">' + off.map(function (t) { return esc(t.title); }).join(', ') + '</span>' +
    (p.step === 'edit'
      ? '<div class="acts"><button class="btn sm" data-a="planMoveAll" data-to="tomorrow">Move to ' + (isToday ? 'tomorrow' : 'the next day') + '</button><button class="btn sm" data-a="planPick">Pick a date</button><button class="btn sm" data-a="planMoveAll" data-to="none">Leave unscheduled</button></div>' +
        (p.pick ? '<div class="row" style="flex-wrap:nowrap"><input id="pickDate" type="date" aria-label="Move to date" min="' + addDays(dr.date, 1) + '" value="' + addDays(dr.date, 1) + '"><button class="btn sm primary" data-a="planMoveAll" data-to="date">Move</button></div>' : '') +
        '<span class="small">Anything you do not move goes to your Unscheduled list when you confirm.</span>'
      : '<span class="small">You choose where they go: tomorrow, another date, or unscheduled.</span>') + '</div>' : '';
  if (p.step === 'edit') {
    var cards = L.rows.filter(function (r) { return r.kind === 'task'; }).map(function (r) {
      return '<div class="card" style="gap:10px"><div class="row between"><b style="font-size:16px">' + esc(r.t.title) + '</b><span class="num muted" style="font-weight:600">' + fromMin(r.start) + '</span></div>' +
        '<div class="row" style="gap:8px"><button class="iconbtn" data-a="est" data-id="' + r.t.id + '" data-n="-5" aria-label="5 minutes shorter">-</button><b class="num" style="min-width:64px;text-align:center">' + fmtDur(r.est) + '</b><button class="iconbtn" data-a="est" data-id="' + r.t.id + '" data-n="5" aria-label="5 minutes longer">+</button>' +
        '<button class="btn sm ghost danger" style="margin-left:auto" data-a="dropFromPlan" data-id="' + r.t.id + '">Remove</button></div></div>';
    }).join('');
    var askCard = '';
    if (p.ask && aiOn()) {
      var exs = ['I am tired, make today lighter', 'Put the hardest task first', 'Add a 20 minute walk at 5pm', 'Move everything after the call to the evening'];
      askCard = '<form data-f="aiPlan" class="card soft"><label class="lbl" for="aiText" style="color:var(--accent-ink)">Tell the AI what to change</label><textarea id="aiText" rows="2" maxlength="600" placeholder="e.g. I am tired, make today lighter"' + (p.aiBusy ? ' disabled' : '') + '></textarea>' +
        '<div class="chips">' + exs.map(function (x) { return '<button type="button" class="chip" data-a="aiEx" data-q="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
        '<div class="row">' + micBtn('aiText') + '<button class="btn primary" type="submit"' + (p.aiBusy ? ' disabled' : '') + '>' + (p.aiBusy ? 'Thinking…' : 'Update my plan') + '</button></div>' +
        (p.aiSay ? '<p role="status"><b>AI:</b> ' + esc(p.aiSay) + '</p>' : '') + (p.aiErr ? '<p role="alert" class="small">' + esc(p.aiErr) + '</p>' : '') +
        '<span class="small muted">Your tasks for this day are sent to Claude on your own account. You still review and confirm below.</span></form>';
    }
    return pageWrap('Review your plan', '<div class="row between"><button class="btn sm" data-a="planView">Back</button></div>' +
      '<div class="stack" style="gap:6px"><h1>Review your plan</h1><span class="muted">Change anything. It is your day.</span></div>' + askCard +
      (cards || '<p class="muted">No tasks left in this plan.</p>') + offCard +
      '<div class="foot"><div class="row" style="flex-wrap:nowrap">' + (aiOn() ? '<button class="btn block" style="flex:1" data-a="askAiPlan">' + (p.ask ? 'Hide AI' : 'Ask AI to change') + '</button>' : '<button class="btn block" style="flex:1" disabled title="Needs the Claude version of this page">Ask AI to change</button>') + '<button class="btn primary block" style="flex:1" data-a="confirmPlan"' + (cnt || off.length ? '' : ' disabled') + '>Confirm plan</button></div><span class="small muted center">Nothing is saved until you confirm.</span></div>');
  }
  var ci = D().checkins[dr.date] || D().checkins[todayStr()], bits = [];
  if (ci && ci.moods && ci.moods[0]) bits.push(ci.moods[0].toLowerCase());
  if (ci && ci.energy) bits.push(ci.energy + ' energy');
  if (L.shift) bits.push(fmtTime12(fromMin(L.shift.a)) + ' to ' + fmtTime12(fromMin(Math.min(L.shift.b, 1439))) + ' shift');
  if (L.trip) bits.push('travel mode: ' + L.trip.place);
  var rows = L.rows.map(function (r) {
    if (r.kind === 'shift') return '<div class="planrow shift"><span class="time">' + fromMin(r.start) + '</span><div><b>Work shift</b><div class="small muted">Until ' + fromMin(r.end) + ' · Fixed, never moved</div></div></div>';
    return '<div class="planrow"><span class="time">' + fromMin(r.start) + '</span><div class="grow"><b style="font-size:16px">' + esc(r.t.title) + '</b><div class="small muted">' + fmtDur(r.est) + ' · ' + esc(r.why || '') + '</div></div></div>';
  }).join('');
  return pageWrap('Your plan', '<div class="row between"><button class="btn sm" data-a="back">Close</button></div>' +
    '<div class="stack" style="gap:6px"><h1>' + (isToday ? 'Your plan for today' : 'Your plan for ' + fmtDate(dr.date, { weekday: 'long' })) + '</h1><span class="muted">' + (bits.length ? 'Built around: ' + esc(bits.join(', ')) : 'Built around your tasks and free time') + '</span></div>' +
    (rows || '<p class="muted">No open tasks on this day. Add some in the Tasks tab.</p>') + offCard +
    '<div class="foot"><button class="btn primary block" data-a="planEdit"' + (cnt || off.length ? '' : ' disabled') + '>Review and edit plan</button><span class="small muted center">Nothing is saved until you confirm.</span></div>');
};

/* ---------- screens F and H: timer and pause ---------- */
function clockHM(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function pausedPage(a, t) {
  var o = U.pauseOpt, reasons = ['Interruption', 'Break', 'Something urgent'], mins = [10, 15, 30, 60];
  var at = a.returnAt || (Date.now() + o.mins * 60000);
  return pageWrap('Paused', '<div class="row between"><button class="btn sm" data-a="back">Back to app</button></div>' +
    '<div class="stack" style="gap:6px"><span style="font-size:14px;font-weight:700;color:var(--warn-ink)">Paused</span><h1 style="font-size:26px">' + esc(t.title) + '</h1><span class="muted">' + fmtDur(Math.max(1, activeElapsed(a) / 60)) + ' recorded so far. Your progress is saved.</span></div>' +
    '<div class="stack" style="gap:10px"><b>Why are you pausing? (optional)</b><div class="chips">' + reasons.map(function (r) { return '<button type="button" class="chip" data-a="pauseReason" data-val="' + r + '" aria-pressed="' + (o.reason === r) + '">' + r + '</button>'; }).join('') + '</div></div>' +
    '<div class="stack" style="gap:10px"><b>Remind me to come back in</b><div class="seg">' + mins.map(function (m) { return '<button type="button" data-a="pauseMins" data-val="' + m + '" aria-pressed="' + (o.mins === m) + '">' + (m === 60 ? '1 h' : m + ' min') + '</button>'; }).join('') + '</div><span class="small muted">You get an app notification while Focus Flow is open.</span></div>' +
    '<div class="card"><b>' + (a.returnAt ? 'Reminder set' : 'Return reminder') + '</b><span>At ' + clockHM(at) + ': "Ready to get back to ' + esc(t.title) + '?"</span></div>' +
    '<div class="foot"><button class="btn primary block" data-a="setReturn">' + (a.returnAt ? 'Update reminder' : 'Set reminder') + '</button><button class="btn ghost" data-a="resume">Resume now</button></div>');
}
OV.focus = function () {
  var a = D().active; if (!a) return ''; var t = taskById(a.taskId); if (!t) return '';
  if (a.state === 'paused') return pausedPage(a, t);
  return '<div class="full" role="dialog" aria-modal="true" aria-label="Task timer">' +
    '<div class="row between"><button class="btn on-night sm" data-a="back">Back to app</button><span class="eyebrow">Task in progress</span></div>' +
    '<h1 class="center" style="font-size:26px">' + esc(t.title) + '</h1>' +
    '<div class="dial" id="dialEl" style="background:conic-gradient(var(--night-accent) ' + Math.round(t.progress * 3.6) + 'deg,var(--night-2) 0)"><div><span class="big" style="font-size:40px" data-clock>' + fmtClock(activeElapsed(a)) + '</span><span class="small" style="color:var(--night-muted)" id="progLbl">' + t.progress + '% complete</span></div></div>' +
    '<div class="panel"><div class="kv"><span style="color:var(--night-muted)">Estimated</span><b>' + fmtDur(t.est) + '</b></div><div class="kv"><span style="color:var(--night-muted)">Started</span><b>' + clockHM(a.startedAt) + '</b></div><div class="kv"><span style="color:var(--night-muted)">Time left in estimate</span><b data-left>' + leftText(a, t) + '</b></div><div class="kv"><span style="color:var(--night-muted)">Pauses</span><b>' + a.pauses + '</b></div></div>' +
    '<div class="field"><label for="prog" style="color:var(--night-muted)">Your progress. You set it, the timer does not.</label><input id="prog" type="range" min="0" max="100" step="5" value="' + t.progress + '" data-a="prog"></div>' +
    '<div class="row" style="flex-wrap:nowrap"><button class="btn on-night block" data-a="askPause">Pause</button><button class="btn night-fill block" data-a="finish">Complete</button></div>' +
    '<p class="small center" style="color:var(--night-muted)">The timer never marks a task complete. You do that.</p>' +
    '<button class="btn ghost" style="color:var(--night-muted)" data-a="endSession">End session without completing</button></div>';
};

/* ---------- screen I and J: task completed, more tasks? ---------- */
OV.done = function (p) {
  var nx = nextTask(), dp = dayProgress(todayStr()), g = p.goalId ? D().goals.find(function (x) { return x.id === p.goalId; }) : null;
  return pageWrap('Task completed', '<div class="center stack" style="align-items:center;padding-top:12px"><span class="av" style="width:72px;height:72px;background:var(--ok)">' + ic('check', 38, '#fff', 3) + '</span><h1>Task completed</h1><p class="muted">' + esc(p.title) + '</p></div>' +
    '<div class="card"><b>Recorded</b><div class="kv"><span class="muted">Estimated</span><b>' + fmtDur(p.est) + '</b></div><div class="kv"><span class="muted">Actual time</span><b>' + (p.sec ? fmtDur(Math.max(1, p.sec / 60)) : 'Not timed') + '</b></div><span class="small muted">Your monthly report compares estimates with the real time spent.</span></div>' +
    '<div class="card"><b>Goals updated</b>' + (g ? '<div class="kv"><span>' + esc(g.title) + '</span><b class="num">' + goalProgress(g) + '%</b></div>' + bar(goalProgress(g)) : '') + '<div class="kv"><span>Today</span><b class="num">' + dp.done + ' of ' + dp.n + ' tasks</b></div>' + bar(dp.pct, dp.pct === 100) + '</div>' +
    '<div class="stack" style="gap:8px"><b>More tasks today?</b>' + (nx ? '<div class="card soft"><span class="small" style="font-weight:700;color:var(--accent-ink)">Next' + (nx.time ? ', ' + nx.time : '') + '</span><b style="font-size:16px">' + esc(nx.title) + ' · ' + fmtDur(nx.est) + '</b></div>' : '<p class="muted">That was the last planned task for today.</p>') + '</div>' +
    '<div class="foot">' + (nx ? '<button class="btn primary block" data-a="startNext" data-id="' + nx.id + '">Yes, start next task</button><button class="btn block" data-a="doneForToday">No, I am done for today</button>' : '<button class="btn primary block" data-a="doneForToday">Finish the day</button>') + '</div>');
};

/* ---------- screen K: evening review and tomorrow's planning ---------- */
OV.evening = function () {
  var date = todayStr(), list = tasks().filter(function (t) { return t.date === date && t.status !== 'cancelled'; }).sort(byTime), dp = dayProgress(date);
  return pageWrap('Evening review', '<div class="row between"><button class="btn sm" data-a="back">Close</button></div>' +
    '<div class="stack" style="gap:4px"><span class="small muted" style="font-weight:600">' + fmtTime12(fromMin(nowMin())) + '</span><h1>Evening review</h1></div>' +
    '<div class="card"><div class="row between"><b>Today</b><span class="pill ' + (dp.n && dp.done === dp.n ? 'ok' : 'acc') + '">' + dp.done + ' of ' + dp.n + ' done</span></div>' +
    (list.length ? list.map(function (t) { return '<div class="row"><span class="pill ' + (t.status === 'done' ? 'ok' : 'warn') + '">' + (t.status === 'done' ? 'Done' : 'Not done') + '</span><span>' + esc(t.title) + '</span></div>'; }).join('') : '<span class="muted small">No tasks were planned today.</span>') + '</div>' +
    '<form data-f="evening" class="fill"><div class="field"><span class="lbl" style="font-size:15px;color:var(--ink);font-weight:700">Did your mood improve today?</span><div class="seg" data-single>' + [['better', 'Better'], ['same', 'Same'], ['worse', 'Worse']].map(function (m) { return segBtn(m[1], false, 'mood2', m[0]); }).join('') + '</div></div>' +
    '<div class="field"><label for="evWhy">What made the difference? (optional)</label><input id="evWhy" type="text" placeholder="e.g. Starting with a small task"></div>' +
    '<div class="field"><label for="evTomorrow" style="font-size:15px;color:var(--ink);font-weight:700">Plan tomorrow</label><textarea id="evTomorrow" rows="3" placeholder="Type or speak everything on your mind: study Isaiah chapter 1, work on VettedHands for 2 hours, call my contact at 4pm"></textarea></div>' +
    '<div class="foot"><div class="row" style="flex-wrap:nowrap">' + micBtn('evTomorrow', 'flex:0 0 54px;width:54px;height:54px') + '<button class="btn primary block" type="submit">Build tomorrow\'s plan</button></div></div></form>');
};
/* ---------- shared plans: family and friends on this device ---------- */
ICONS.shared = 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8';
var KINDS = [['trip', 'Trip'], ['book', 'Reading together'], ['event', 'Event'], ['study', 'Study together'], ['other', 'Other']];
var STARTERS = {
  trip: ['Book transport', 'Book accommodation', 'Agree a budget', 'Pack and prepare'],
  book: ['Choose the book', 'Set a reading schedule', 'Share what you learned'],
  event: ['Set the date and venue', 'Make the guest list', 'Plan food and drinks', 'Prepare on the day'],
  study: ['Choose the topics', 'Make a study schedule', 'Practise past questions']
};
var profileById = function (id) {
  var p = S.profiles.find(function (x) { return x.id === id; }); if (p) return p;
  if (CL.on && id) { var e = CL.dir[id]; return { id: id, name: (e && e.name) || 'Family member', color: (e && e.color) || '#6B7699', accent: e && e.accent }; }
  return null;
};
function cloudInviteField(pl) {
  var have = pl ? pl.members.map(function (m) { return m.id; }) : [];
  var L = Object.keys(CL.dir).filter(function (id) { return id !== S.activeId && have.indexOf(id) < 0; });
  if (!L.length) return '<div class="field"><span class="lbl">Invite people</span><p class="small muted">Nobody else has set up Focus Flow yet. Share this page with them from its Share menu as a Contributor, ask them to open it and set up their profile, and they will appear here to invite.</p></div>';
  return '<div class="field"><span class="lbl">Invite people who use Focus Flow</span><div class="chips" data-multi>' + L.map(function (id) { return chip(CL.dir[id].name || 'Family member', false, 'inv', id); }).join('') + '</div><span class="small muted">They see the plan only after they accept.</span></div>';
}
var planById = function (id) { return S.shared.find(function (p) { return p.id === id; }); };
var isJoined = function (pl, id) { return pl.members.some(function (m) { return m.id === id && m.status === 'joined'; }); };
function myPlans() { return S.shared.filter(function (pl) { return isJoined(pl, S.activeId); }); }
function myInvites() { return S.shared.filter(function (pl) { return pl.members.some(function (m) { return m.id === S.activeId && m.status === 'invited'; }); }); }
function planProgress(pl) { var n = pl.tasks.length, d = pl.tasks.filter(function (t) { return t.done; }).length; return { n: n, done: d, pct: n ? Math.round(d / n * 100) : 0 }; }
function memberProgress(pl, id) { var L = pl.tasks.filter(function (t) { return t.assigneeId === id; }); return { n: L.length, done: L.filter(function (t) { return t.done; }).length }; }
function daysLeft(date) { return Math.round((parseYmd(date) - parseYmd(todayStr())) / 86400000); }
function deadlineText(pl) {
  if (!pl.deadline) return 'No deadline';
  var n = daysLeft(pl.deadline), f = fmtDate(pl.deadline, { day: 'numeric', month: 'short' });
  return n < 0 ? 'Was due ' + f : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : 'Due in ' + n + ' days, ' + f;
}
function quickPeople(names, pl) {
  var n = 0;
  String(names || '').split(',').forEach(function (raw) {
    var nm = raw.trim(); if (!nm) return;
    var ex = S.profiles.filter(function (p) { return p.name.toLowerCase() === nm.toLowerCase(); })[0], id;
    if (ex) id = ex.id; else {
      id = uid(); var c = COLORS[S.profiles.length % COLORS.length];
      S.profiles.push({ id: id, name: nm, email: '', color: c, accent: themeOf(c).k, createdAt: Date.now() }); S.data[id] = newData();
    }
    if (!pl.members.some(function (m) { return m.id === id; })) { pl.members.push({ id: id, status: 'invited', at: Date.now() }); n++; }
  });
  return n;
}
function kindName(k) { return (KINDS.filter(function (x) { return x[0] === k; })[0] || KINDS[4])[1]; }
function hasCopy(pl, st) { return D().tasks.some(function (t) { return t.sharedRef && t.sharedRef.planId === pl.id && t.sharedRef.taskId === st.id; }); }

/* keep shared tasks and each person's private copy in step */
function syncShared(t) {
  if (!t.sharedRef) return;
  var pl = planById(t.sharedRef.planId), st = pl && pl.tasks.filter(function (x) { return x.id === t.sharedRef.taskId; })[0];
  if (!st) return;
  var done = t.status === 'done'; if (st.done === done) return;
  st.done = done; st.doneAt = done ? Date.now() : null; st.doneBy = done ? S.activeId : ''; save();
}
function setSharedDone(pl, st, done) {
  st.done = done; st.doneAt = done ? Date.now() : null; st.doneBy = done ? S.activeId : '';
  var aid = st.assigneeId, dd = aid && S.data[aid];
  if (dd) dd.tasks.forEach(function (t) {
    if (t.sharedRef && t.sharedRef.planId === pl.id && t.sharedRef.taskId === st.id && !(dd.active && dd.active.taskId === t.id)) {
      t.status = done ? 'done' : 'todo'; t.doneAt = done ? Date.now() : null; t.progress = done ? 100 : (t.progress === 100 ? 0 : t.progress);
    }
  });
  save();
}
function addToMyDay(pl, st, date) {
  if (hasCopy(pl, st)) return false;
  var t = addTask({ title: st.title, date: date, est: 30 }); if (!t) return false;
  t.sharedRef = { planId: pl.id, taskId: st.id }; if (st.done) { t.status = 'done'; t.progress = 100; } save(); return true;
}
function unlinkShared(planId, taskId, memberId) {
  Object.keys(S.data).forEach(function (pid) {
    if (memberId && pid !== memberId) return;
    S.data[pid].tasks.forEach(function (t) { if (t.sharedRef && t.sharedRef.planId === planId && (!taskId || t.sharedRef.taskId === taskId)) delete t.sharedRef; });
  });
}
function removeMember(pl, id) {
  pl.members = pl.members.filter(function (m) { return m.id !== id; });
  pl.tasks.forEach(function (t) { if (t.assigneeId === id) t.assigneeId = ''; });
  unlinkShared(pl.id, null, id); save();
}
function purgeShared(id) {
  S.shared = S.shared.filter(function (pl) { if (pl.ownerId === id) { unlinkShared(pl.id); return false; } return true; });
  S.shared.forEach(function (pl) { removeMember(pl, id); });
}
function sharedTick() {
  var d = D(), me = S.activeId; if (!d) return; d.sn = d.sn || {};
  myPlans().forEach(function (pl) {
    if (!pl.deadline) return;
    var n = daysLeft(pl.deadline), mine = pl.tasks.filter(function (t) { return t.assigneeId === me && !t.done; }).length, key = pl.id + todayStr();
    if (n > 1 || n < 0 || !mine || d.sn[key]) return;
    d.sn[key] = 1; save(); notify('"' + pl.title + '" is due ' + (n === 0 ? 'today' : 'tomorrow') + '. You have ' + mine + ' open task' + (mine === 1 ? '' : 's') + '.');
  });
}

/* ---------- views ---------- */
function inviteCard(pl) {
  var o = profileById(pl.ownerId);
  return '<section class="card soft"><b>' + esc(o ? o.name : 'Someone') + ' invited you to "' + esc(pl.title) + '"</b><span class="small">You can only see the plan if you accept. Your personal tasks stay private either way.</span>' +
    '<div class="acts"><button class="btn primary sm" data-a="spAccept" data-id="' + pl.id + '">Accept</button><button class="btn sm" data-a="spDecline" data-id="' + pl.id + '">Decline</button></div></section>';
}
function sharedBanners() {
  var out = '';
  myInvites().forEach(function (pl) { out += inviteCard(pl); });
  myPlans().forEach(function (pl) {
    var pr = planProgress(pl); if (!pl.deadline || !(pr.n > pr.done) || daysLeft(pl.deadline) > 3) return;
    var mine = pl.tasks.filter(function (t) { return t.assigneeId === S.activeId && !t.done; }).length;
    out += '<section class="card warn"><b>"' + esc(pl.title) + '": ' + esc(deadlineText(pl).toLowerCase()) + '</b><span class="small">' + (pr.n - pr.done) + ' task' + (pr.n - pr.done === 1 ? '' : 's') + ' left' + (mine ? ', ' + mine + ' of them yours' : '') + '.</span><div class="acts"><button class="btn sm" data-a="spOpen" data-id="' + pl.id + '">Open plan</button></div></section>';
  });
  return out;
}
function planCard(pl) {
  var me = S.activeId, pr = planProgress(pl), mine = pl.tasks.filter(function (t) { return t.assigneeId === me && !t.done; }).length;
  var urgent = pl.deadline && daysLeft(pl.deadline) <= 3 && pr.n > pr.done;
  var people = pl.members.filter(function (m) { return m.status === 'joined' && profileById(m.id); }).map(function (m) { return avatar(profileById(m.id), 'sm'); }).join('');
  return '<section class="card"><div class="row between"><h3>' + esc(pl.title) + '</h3><span class="pill">' + esc(kindName(pl.kind)) + '</span></div>' +
    '<div class="small" style="' + (urgent ? 'color:var(--warn-ink);font-weight:700' : 'color:var(--muted)') + '">' + esc(deadlineText(pl)) + '</div>' +
    '<div class="avs">' + people + '</div>' + bar(pr.pct, pr.n > 0 && pr.done === pr.n) +
    '<div class="row between small muted"><span>' + pr.done + ' of ' + pr.n + ' tasks done</span><span>' + (mine ? 'You have ' + mine + ' open' : 'Nothing open for you') + '</span></div>' +
    '<div class="acts"><button class="btn sm primary" data-a="spOpen" data-id="' + pl.id + '">Open plan</button></div></section>';
}
function viewShared() {
  if (U.plan) { var cur = planById(U.plan); if (cur && isJoined(cur, S.activeId)) return viewPlan(cur); U.plan = null; }
  var inv = myInvites(), mine = myPlans();
  return '<div class="head"><div><h1>Shared plans</h1><small>Plan together with family and friends</small></div><button class="btn primary" data-a="spNew">' + ic('plus', 18) + ' New plan</button></div>' +
    inv.map(inviteCard).join('') +
    (mine.length ? '<div class="grid">' + mine.map(planCard).join('') + '</div>' : '<section class="card"><h3>No shared plans yet</h3><p class="muted">Start one for a trip, a book you read together, an event, or studying for an exam. Each person gets their own tasks, and everyone sees the overall progress.</p><div class="acts"><button class="btn primary" data-a="spNew">Create a shared plan</button></div></section>') +
    '<section class="card soft"><b style="color:var(--accent-ink)">What is shared</b><span class="small">Only the tasks inside a plan are visible to its members. Your personal tasks, goals, mood and reviews stay private. People join only when they accept an invitation.</span></section>';
}
function viewPlan(pl) {
  var me = S.activeId, own = pl.ownerId === me, pr = planProgress(pl);
  var joined = pl.members.filter(function (m) { return m.status === 'joined' && profileById(m.id); });
  var invited = pl.members.filter(function (m) { return m.status === 'invited' && profileById(m.id); });
  var n = pl.deadline ? daysLeft(pl.deadline) : 99, urgent = n <= 3 && pr.n > pr.done;
  var memRows = joined.map(function (m) {
    var p = profileById(m.id), mp = memberProgress(pl, m.id);
    return '<div class="row" style="gap:12px;flex-wrap:nowrap">' + avatar(p) + '<div class="grow stack" style="gap:6px"><div class="row between"><b>' + esc(p.name) + (m.id === pl.ownerId ? ' <span class="pill acc">Owner</span>' : '') + (m.id === me ? ' <span class="pill">You</span>' : '') + '</b><span class="small muted num">' + (mp.n ? mp.done + ' of ' + mp.n + ' done' : 'No tasks yet') + '</span></div>' + (mp.n ? bar(Math.round(mp.done / mp.n * 100), mp.done === mp.n) : '') + '</div></div>';
  }).join('') + invited.map(function (m) { var p = profileById(m.id); return '<div class="row" style="gap:12px;flex-wrap:nowrap">' + avatar(p) + '<div class="grow"><b>' + esc(p.name) + '</b> <span class="pill warn">Invited</span></div></div>'; }).join('');
  var rows = pl.tasks.map(function (st) {
    var asg = st.assigneeId ? profileById(st.assigneeId) : null, can = own || st.assigneeId === me || !st.assigneeId, del = own || st.createdBy === me, copy = hasCopy(pl, st);
    var meta = [asg ? 'For ' + asg.name : 'Anyone can do this']; if (st.due) meta.push('Due ' + fmtDate(st.due, { day: 'numeric', month: 'short' }));
    if (st.done && st.doneBy && profileById(st.doneBy)) meta.push('Done by ' + profileById(st.doneBy).name);
    var btns = '';
    if (st.assigneeId === me && !st.done && !copy) {
      btns += '<button class="btn sm" data-a="spAddMine" data-plan="' + pl.id + '" data-id="' + st.id + '" data-when="today">Add to today</button>';
      if (st.due && st.due > todayStr()) btns += '<button class="btn sm" data-a="spAddMine" data-plan="' + pl.id + '" data-id="' + st.id + '" data-when="due">Add on due date</button>';
    }
    if (copy) btns += '<span class="pill acc">In your day</span>';
    if (del) btns += '<button class="btn sm ghost danger" data-a="spDelTask" data-plan="' + pl.id + '" data-id="' + st.id + '">Delete</button>';
    return '<div class="task' + (st.done ? ' isdone' : '') + '"><button class="tick' + (st.done ? ' done' : '') + '" data-a="spToggle" data-plan="' + pl.id + '" data-id="' + st.id + '" aria-label="' + (st.done ? 'Mark not done: ' : 'Mark done: ') + esc(st.title) + '"' + (can ? '' : ' disabled') + '>' + (st.done ? ic('check', 16, '#fff', 3) : '') + '</button>' +
      '<div class="grow stack" style="gap:6px"><h3>' + esc(st.title) + '</h3><div class="small muted">' + esc(meta.join(' · ')) + '</div>' + (st.note ? '<div class="small">' + esc(st.note) + '</div>' : '') + (btns ? '<div class="acts">' + btns + '</div>' : '') + '</div></div>';
  }).join('');
  return '<div class="row"><button class="btn sm" data-a="spBack">All plans</button></div>' +
    '<div class="head"><div><h1>' + esc(pl.title) + '</h1><small>' + esc(kindName(pl.kind)) + '</small></div><span class="pill ' + (urgent ? 'warn' : '') + '">' + esc(deadlineText(pl)) + '</span></div>' +
    '<section class="card" style="flex-direction:row;align-items:center;gap:18px"><div class="ring" style="background:conic-gradient(var(--accent) ' + Math.round(pr.pct * 3.6) + 'deg,var(--line) 0)"><div>' + pr.pct + '%</div></div><div><h3>Overall progress</h3><p class="muted small">' + pr.done + ' of ' + pr.n + ' tasks done by everyone</p></div></section>' +
    '<div class="grid"><section class="card"><div class="row between"><h2>People</h2>' + (own ? '<button class="btn sm primary" data-a="spEditPlan" data-plan="' + pl.id + '">' + ic('plus', 16) + ' Invite</button>' : '') + '</div>' + memRows + (own && !invited.length && joined.length < 2 ? '<p class="small muted">Nobody else is in this plan yet. Tap Invite to add family or friends.</p>' : '') + (own && typeof SB !== 'undefined' && SB.on ? sbInviteBox(pl) : '') + (own && invited.length ? '<p class="small muted">' + (CL.on ? 'Invited people accept when they next open Focus Flow. They get a notice on Home and in Shared.' : 'Invited people accept from their own profile: tap your picture on Home, choose their name, then open Shared.') + '</p>' : '') + '</section>' +
    '<section class="card"><div class="row between"><h2>Tasks</h2><button class="btn sm primary" data-a="spTaskNew" data-plan="' + pl.id + '">' + ic('plus', 16) + ' Add task</button></div>' + (rows ? '<div>' + rows + '</div>' : '<p class="muted">No tasks yet. Add the first one and give it to someone.</p>') + '<span class="small muted">Add a task to your day to plan it with your own tasks. It then counts toward your weekly score like any other task.</span></section></div>' +
    '<section class="card soft"><span class="small">Only this plan\'s tasks are shared with its members. Your personal tasks, goals and check-ins stay private.</span></section>' +
    '<div class="acts">' + (own ? '<button class="btn" data-a="spEditPlan" data-plan="' + pl.id + '">Edit plan and people</button><button class="btn danger" data-a="spDelPlan" data-id="' + pl.id + '">Delete plan</button>' : '<button class="btn danger" data-a="spLeave" data-id="' + pl.id + '">Leave plan</button>') + '</div>';
}

/* ---------- sheets ---------- */
OV.spNew = function () {
  var others = S.profiles.filter(function (p) { return p.id !== S.activeId; });
  var inv = CL.on ? cloudInviteField(null) : (others.length ? '<div class="field"><span class="lbl">Invite people already on this device</span><div class="chips" data-multi>' + others.map(function (p) { return chip(p.name, false, 'inv', p.id); }).join('') + '</div></div>' : '') + '<div class="field"><label for="spPeople">Add someone new (optional)</label><input id="spPeople" type="text" placeholder="e.g. Aunty Bisi, Tunde"><span class="small muted">Separate names with commas. They see the plan only after they accept.</span></div>';
  return sheet('New shared plan', '<h2>New shared plan</h2><form data-f="spNew" class="stack">' +
    '<div class="field"><label for="spTitle">Plan name</label><input id="spTitle" type="text" required placeholder="e.g. Road trip to Abuja"></div>' +
    '<div class="row"><div class="field grow"><label for="spKind">Kind of plan</label><select id="spKind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select></div><div class="field grow"><label for="spDeadline">Deadline (optional)</label><input id="spDeadline" type="date"></div></div>' +
    '<label class="check"><input id="spStarters" type="checkbox" checked> Add starter tasks (trip, reading, event and study plans)</label>' + inv +
    '<div class="acts"><button class="btn primary" type="submit">Create plan</button><button type="button" class="btn" data-a="back">Cancel</button></div></form>');
};
OV.spTask = function (p) {
  var pl = planById(p.planId); if (!pl) return '';
  var opts = '<option value="">Anyone</option>' + pl.members.filter(function (m) { return m.status === 'joined' && profileById(m.id); }).map(function (m) { return '<option value="' + m.id + '"' + (m.id === S.activeId ? ' selected' : '') + '>' + esc(profileById(m.id).name) + '</option>'; }).join('');
  return sheet('Add task', '<h2>Add a task to "' + esc(pl.title) + '"</h2><form data-f="spTask" data-plan="' + pl.id + '" class="stack">' +
    '<div class="field"><label for="stTitle">What needs doing?</label><input id="stTitle" type="text" required></div>' +
    '<div class="row"><div class="field grow"><label for="stWho">Who does it?</label><select id="stWho">' + opts + '</select></div><div class="field grow"><label for="stDue">Due (optional)</label><input id="stDue" type="date"></div></div>' +
    '<div class="field"><label for="stNote">Note (optional)</label><input id="stNote" type="text"></div>' +
    '<div class="acts"><button class="btn primary" type="submit">Add task</button><button type="button" class="btn" data-a="back">Cancel</button></div></form>');
};
OV.spEdit = function (p) {
  var pl = planById(p.planId); if (!pl) return '';
  var out = S.profiles.filter(function (x) { return !pl.members.some(function (m) { return m.id === x.id; }); });
  var rows = pl.members.filter(function (m) { return m.id !== pl.ownerId && profileById(m.id); }).map(function (m) {
    return '<div class="row between"><span>' + esc(profileById(m.id).name) + ' <span class="pill ' + (m.status === 'joined' ? 'ok' : 'warn') + '">' + (m.status === 'joined' ? 'Joined' : 'Invited') + '</span></span><button type="button" class="btn sm ghost danger" data-a="spRemove" data-plan="' + pl.id + '" data-id="' + m.id + '">' + (m.status === 'joined' ? 'Remove' : 'Withdraw') + '</button></div>';
  }).join('');
  return sheet('Edit plan', '<h2>Edit plan</h2><form data-f="spEdit" data-plan="' + pl.id + '" class="stack">' +
    '<div class="field"><label for="seTitle">Plan name</label><input id="seTitle" type="text" required value="' + esc(pl.title) + '"></div>' +
    '<div class="field"><label for="seDeadline">Deadline (optional)</label><input id="seDeadline" type="date" value="' + esc(pl.deadline || '') + '"></div>' +
    (rows ? '<div class="stack" style="gap:8px"><span class="lbl">People</span>' + rows + '</div>' : '') +
    (CL.on ? cloudInviteField(pl) : '') + (CL.on ? '' : '') +
    (!CL.on && out.length ? '<div class="field"><span class="lbl">Invite people already on this device</span><div class="chips" data-multi>' + out.map(function (x) { return chip(x.name, false, 'inv', x.id); }).join('') + '</div></div>' : '') +
    (CL.on ? '' : '<div class="field"><label for="sePeople">Add someone new</label><input id="sePeople" type="text" placeholder="e.g. Aunty Bisi, Tunde"><span class="small muted">Separate names with commas. They see the plan only after they accept.</span></div>') +
    '<div class="acts"><button class="btn primary" type="submit">Save</button><button type="button" class="btn" data-a="back">Close</button></div></form>');
};
/* ---------- render ---------- */
function applyTheme() {
  var r = document.documentElement, pr = (S.activeId && P()) ? P() : null, th = (pr && D()) ? D().settings.theme : 'system';
  if (th === 'light' || th === 'dark') r.setAttribute('data-theme', th); else r.removeAttribute('data-theme');
  var k = pr ? themeOf(pr.color).k : 'indigo';
  if (U.wiz && U.wiz.color) k = themeOf(U.wiz.color).k;
  if (k === 'indigo') r.removeAttribute('data-accent'); else r.setAttribute('data-accent', k);
}
function render() {
  var app = $('#app'), html;
  if (CL.on && CL.phase === 'loading') html = viewSplash();
  else if (CL.on && CL.phase === 'error') html = viewCloudError();
  else if (!S.activeId || !P() || (U.picker && !CL.on) || U.wiz || (CL.on && U.importAsk && !S.profiles.length)) html = viewPicker();
  else if (U.flow === 'checkin') html = viewCheckinPage();
  else {
    var v = { home: viewHome, tasks: viewTasks, calendar: viewCalendar, coach: viewCoach, goals: viewGoals, shared: viewShared, insights: viewInsights, settings: viewSettings }[U.view] || viewHome;
    html = shell(v());
  }
  app.innerHTML = html;
}
function maybeCheckin() { U.flow = (S.activeId && P() && D() && !todayCheckin() && new Date().getHours() < 17) ? 'checkin' : null; }
var pressed = function (root, g) {
  return Array.prototype.map.call(root.querySelectorAll('[data-g="' + g + '"][aria-pressed="true"]'), function (b) { return b.dataset.val; });
};
var val = function (root, id) { var e = root.querySelector('#' + id); return e ? e.value : ''; };
var checked = function (root, id) { var e = root.querySelector('#' + id); return !!(e && e.checked); };
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { } }
function finishActive() {
  var a = D().active; if (!a) return;
  var t = taskById(a.taskId), est = t.est, title = t.title, gid = t.goalId, r = endSession(true);
  openOverlay('done', { title: title, est: est, sec: r ? r.sec : 0, goalId: gid }); render();
}
function selectBackup() {
  var el = $('#backupText'); if (!el) return;
  try { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { }
  toast('Press and hold to copy the selected text');
}

/* ---------- clicks ---------- */
var A = {
  nav: function (el) { U.view = el.dataset.v; U.backup = false; U.plan = null; if (U.overlay) { U.overlay = null; renderOverlay(); } applyTheme(); render(); window.scrollTo(0, 0); },
  more: function () { openOverlay('more'); },
  picker: function () { if (CL.on) { A.nav({ dataset: { v: 'settings' } }); return; } U.picker = true; render(); window.scrollTo(0, 0); },
  rotaPick: function (el) {
    Array.prototype.forEach.call(el.parentElement.querySelectorAll('[data-a="rotaPick"]'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    el.setAttribute('aria-pressed', 'true'); var b = $('#rotaB'); if (b) b.hidden = el.dataset.val !== '2';
  },
  delTrip: function (el) { D().travel = D().travel.filter(function (t) { return t.id !== el.dataset.id; }); save(); render(); },
  testSound: function () { chime(true); toast('Reminder sound test'); },
  askNotifyNow: function () { try { Notification.requestPermission().then(function () { render(); }); } catch (e) { toast('Notifications are not available here'); } },
  installApp: function () { var e = U.installPrompt; if (!e) return; U.installPrompt = null; try { e.prompt(); } catch (x) { } render(); },
  pickProfile: function (el) { S.activeId = el.dataset.id; U.picker = false; U.view = 'home'; U.plan = null; save(); applyTheme(); maybeCheckin(); render(); },
  addPerson: function () { U.wiz = newWiz(); U.picker = true; applyTheme(); render(); },
  cancelWiz: function () { U.wiz = null; applyTheme(); render(); },
  wizBack: function () { U.wiz.step = 1; render(); },
  chip: function (el) {
    var par = el.parentElement;
    if (par && par.hasAttribute('data-single')) {
      Array.prototype.forEach.call(par.querySelectorAll('[data-a="chip"]'), function (b) { b.setAttribute('aria-pressed', 'false'); });
      el.setAttribute('aria-pressed', 'true');
    } else el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  },
  swatch: function (el) {
    Array.prototype.forEach.call(el.parentElement.querySelectorAll('[data-a="swatch"]'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    el.setAttribute('aria-pressed', 'true');
    var k = themeOf(el.dataset.val).k; if (k === 'indigo') document.documentElement.removeAttribute('data-accent'); else document.documentElement.setAttribute('data-accent', k);
  },
  tab: function (el) { U.tab = el.dataset.val; render(); },
  range: function (el) { U.range = el.dataset.val; render(); },
  wk: function (el) { U.wOff = Math.min(1, (U.wOff || 0) + (+el.dataset.n)); render(); },
  mo: function (el) { U.mOff = Math.min(0, (U.mOff || 0) + (+el.dataset.n)); render(); },
  nextReward: function () { U.wOff = 1; U.range = 'week'; render(); window.scrollTo(0, 0); },
  newTask: function (el) { openOverlay('task', { date: el.dataset.date || '' }); },
  editTask: function (el) { openOverlay('task', { id: el.dataset.id }); },
  toggleDone: function (el) {
    var t = taskById(el.dataset.id); if (!t) return;
    if (t.status === 'done') { reopenTask(t.id); render(); return; }
    if (D().active && D().active.taskId === t.id) { finishActive(); return; }
    completeTask(t.id); toast('Done: ' + t.title); render();
  },
  start: function (el) { startTask(el.dataset.id); render(); openOverlay('focus'); },
  resume: function () { resumeTask(); render(); if (U.overlay) renderOverlay(); },
  askPause: function () { pauseTask(0, ''); U.pauseOpt = { mins: 15, reason: '' }; render(); openOverlay('focus'); },
  statusPause: function () { A.askPause(); },
  pauseReason: function (el) {
    U.pauseOpt.reason = U.pauseOpt.reason === el.dataset.val ? '' : el.dataset.val;
    var a = D().active; if (a && a.log && a.log.length) { a.log[a.log.length - 1].reason = U.pauseOpt.reason; save(); }
    renderOverlay();
  },
  pauseMins: function (el) { U.pauseOpt.mins = +el.dataset.val; renderOverlay(); },
  setReturn: function () { setReturn(U.pauseOpt.mins, U.pauseOpt.reason); toast('Reminder set'); renderOverlay(); render(); },
  statusContinue: function () { openOverlay('focus'); },
  finish: function () { finishActive(); },
  moveToday: function (el) { moveTask(el.dataset.id, todayStr()); toast('Moved to today'); render(); },
  moveTomorrow: function (el) { moveTask(el.dataset.id, addDays(todayStr(), 1)); toast('Moved to tomorrow'); closeOverlay(); },
  delTask: function (el) { openOverlay('confirm', { text: 'Delete this task?', yes: 'delTaskYes', id: el.dataset.id }); },
  delTaskYes: function (el) { removeTask(el.dataset.id); closeOverlay(); },
  cancelTask: function (el) { var t = taskById(el.dataset.id); if (t) { t.status = 'cancelled'; t.emergency = el.dataset.em === '1'; if (D().active && D().active.taskId === t.id) D().active = null; save(); } closeOverlay(); },
  reopen: function (el) { var t = taskById(el.dataset.id); if (t) { t.status = 'todo'; t.emergency = false; save(); } closeOverlay(); },
  plan: function (el) { openOverlay('plan', { draft: newDraft(el.dataset.date), step: 'view' }); },
  planEdit: function () { U.overlay.props.step = 'edit'; renderOverlay(); },
  planView: function () { U.overlay.props.step = 'view'; renderOverlay(); },
  planPick: function () { U.overlay.props.pick = !U.overlay.props.pick; renderOverlay(); },
  est: function (el) { var dr = U.overlay.props.draft, t = taskById(el.dataset.id); dr.ests[t.id] = Math.max(5, (dr.ests[t.id] || layoutEst(dr, t)) + (+el.dataset.n)); renderOverlay(); },
  dropFromPlan: function (el) { var dr = U.overlay.props.draft; if (dr.removed.indexOf(el.dataset.id) < 0) dr.removed.push(el.dataset.id); renderOverlay(); },
  planMoveAll: function (el) {
    var dr = U.overlay.props.draft, L = layout(dr), ids = planOff(dr, L).map(function (t) { return t.id; }), to = el.dataset.to, picked = val($('#overlay'), 'pickDate');
    if (to === 'date' && !picked) { toast('Choose a date first'); return; }
    ids.forEach(function (id) {
      var t = taskById(id); if (!t) return;
      if (to === 'tomorrow') moveTask(id, addDays(dr.date, 1));
      else if (to === 'date') moveTask(id, picked);
      else { t.date = null; t.time = ''; t.fixed = false; t.postponed++; }
    });
    dr.removed = []; U.overlay.props.pick = false; save(); toast(ids.length + ' task' + (ids.length === 1 ? '' : 's') + ' moved'); renderOverlay();
  },
  confirmPlan: function () { confirmDraft(U.overlay.props.draft); toast('Plan confirmed'); closeOverlay(); },
  evening: function () { openOverlay('evening'); },
  back: function () { closeOverlay(); },
  prog: function (el) {
    var a = D().active; if (!a) return; var t = taskById(a.taskId); t.progress = +el.value; save();
    var l = $('#progLbl'), dl = $('#dialEl'); if (l) l.textContent = t.progress + '% complete';
    if (dl) dl.style.background = 'conic-gradient(var(--night-accent) ' + Math.round(t.progress * 3.6) + 'deg,var(--night-2) 0)';
  },
  endSession: function () { endSession(false); toast('Session saved'); closeOverlay(); },
  startNext: function (el) { U.overlay = null; startTask(el.dataset.id); render(); openOverlay('focus'); },
  doneForToday: function () {
    closeOverlay();
    if (new Date().getHours() >= 17 && !D().evening[todayStr()]) openOverlay('evening');
  },
  startCheckin: function () { U.flow = 'checkin'; render(); window.scrollTo(0, 0); },
  redoCheckin: function () { U.flow = 'checkin'; render(); window.scrollTo(0, 0); },
  skipCheckin: function () { U.flow = null; render(); },
  delGoal: function (el) {
    var id = el.dataset.id, d = D();
    d.goals = d.goals.filter(function (g) { return g.id !== id; });
    d.goals.forEach(function (g) { if (g.parentId === id) g.parentId = ''; });
    d.tasks.forEach(function (t) { if (t.goalId === id) t.goalId = ''; });
    save(); render();
  },
  mic: function (el) {
    if (!SR) { toast('Voice input is not available in this browser'); return; }
    var ta = $('#' + el.dataset.target); if (!ta) return;
    try {
      var r = new SR(); r.lang = navigator.language || 'en-US'; r.interimResults = false;
      r.onresult = function (e) {
        var txt = Array.prototype.map.call(e.results, function (x) { return x[0].transcript; }).join(' ').trim();
        if (txt) ta.value = ta.value ? ta.value.replace(/[,\s]+$/, '') + ', ' + txt : txt;
      };
      r.onerror = function () { toast('The microphone is not available here. Please type instead.'); };
      r.start(); toast('Listening');
    } catch (e) { toast('The microphone is not available here. Please type instead.'); }
  },
  showBackup: function () { U.backup = !U.backup; render(); },
  copyBackup: function () {
    var txt = JSON.stringify({ profile: P(), data: D() }), ok = false;
    try { navigator.clipboard.writeText(txt).then(function () { toast('Backup copied'); }, function () { selectBackup(); }); ok = true; } catch (e) { }
    if (!ok) selectBackup();
  },
  importBackup: function () {
    var raw = ($('#importBox') || {}).value || '';
    try {
      var o = JSON.parse(raw);
      if (!o || !o.data || !Array.isArray(o.data.tasks)) throw new Error('bad');
      var base = newData(); Object.keys(base).forEach(function (k) { if (o.data[k] === undefined) o.data[k] = base[k]; });
      S.data[S.activeId] = ensureData(o.data); save(); applyTheme(); toast('Backup restored'); render();
    } catch (e) { toast('That does not look like a Focus Flow backup'); }
  },
  askDelProfile: function () { openOverlay('confirm', { text: (typeof SB !== 'undefined' && SB.on) ? 'Delete your Focus Flow account, your tasks and everything you shared? Plans you own are deleted for everyone in them. This cannot be undone.' : 'Remove ' + P().name + ' and all of their data? This cannot be undone.', yes: 'delProfileYes' }); },
  delProfileYes: function () {
    if (CL.on) { cloudDeleteMine(); return; }
    var id = S.activeId; S.profiles = S.profiles.filter(function (p) { return p.id !== id; }); delete S.data[id]; purgeShared(id);
    S.activeId = null; U.picker = true; U.overlay = null; U.flow = null; save(); renderOverlay(); applyTheme(); render();
  }
};
function layoutEst(dr, t) {
  var r = layout(dr).rows.filter(function (x) { return x.kind === 'task' && x.t.id === t.id; })[0];
  return r ? r.est : t.est;
}

/* ---------- forms ---------- */
var F = {
  wiz1: function (f) {
    var name = val(f, 'wName').trim(); if (!name) return;
    U.wiz.name = name; U.wiz.email = val(f, 'wEmail').trim(); U.wiz.color = pressed(f, 'color')[0] || U.wiz.color; U.wiz.step = 2;
    applyTheme(); render(); window.scrollTo(0, 0);
  },
  wiz2: function (f) {
    var id = CL.on ? CL.uid : uid(), w = U.wiz, d = newData(), s = d.settings, rem = pressed(f, 'rem');
    s.planFrom = val(f, 'wFrom') || s.planFrom; s.planTo = val(f, 'wTo') || s.planTo;
    s.hasShift = checked(f, 'wShift'); s.workDays = pressed(f, 'wd').map(Number);
    s.shiftStart = val(f, 'wSa') || s.shiftStart; s.shiftEnd = val(f, 'wSb') || s.shiftEnd;
    s.shifts = shiftsFromLegacy(s); s.rotaAnchor = weekStart(todayStr()); s.hasShift = anyShift(s);
    s.message = pressed(f, 'msg')[0] || 'motivation'; s.appNotify = rem.indexOf('app') >= 0; s.emailNotify = rem.indexOf('email') >= 0;
    var goal = val(f, 'wGoal').trim(); if (goal) d.goals.push({ id: uid(), title: goal, level: 'year', parentId: '' });
    var prof = { id: id, name: w.name, email: w.email, color: w.color, accent: themeOf(w.color).k, createdAt: Date.now() };
    d.profile = prof; S.profiles = CL.on ? [prof] : S.profiles.concat([prof]); S.data[id] = ensureData(d); S.activeId = id;
    U.wiz = null; U.picker = false; U.view = 'home'; save(); applyTheme(); maybeCheckin(); if (s.appNotify) askNotify(); render(); window.scrollTo(0, 0);
  },
  quickAdd: function (f) {
    var sel = val(f, 'quickDate'), def = sel === 'today' ? todayStr() : sel === 'tomorrow' ? addDays(todayStr(), 1) : null;
    var items = parseCapture(val(f, 'quick'), def), n = 0;
    items.forEach(function (it) { if (addTask({ title: it.title, est: it.est, time: it.time, date: it.date })) n++; });
    toast(n ? (n + ' task' + (n === 1 ? '' : 's') + ' added') : 'Type at least one task'); if (n) render();
  },
  task: function (f) {
    var id = f.dataset.id, o = { title: val(f, 'tfTitle'), date: val(f, 'tfDate') || null, time: val(f, 'tfTime'), est: val(f, 'tfEst'), priority: val(f, 'tfPri'), goalId: val(f, 'tfGoal') };
    if (id) {
      var t = taskById(id); if (!t) return;
      if (o.date !== t.date && t.date) t.postponed++;
      t.title = o.title.trim() || t.title; t.date = o.date; t.time = o.time; t.fixed = !!o.time; t.est = Math.max(5, +o.est || t.est); t.priority = o.priority; t.goalId = o.goalId; save();
    } else addTask(o);
    toast('Saved'); closeOverlay();
  },
  checkin: function (f) {
    D().checkins[todayStr()] = { moods: pressed(f, 'mood'), energy: pressed(f, 'energy')[0] || 'medium', focus: pressed(f, 'focus')[0] || 'okay', tonight: pressed(f, 'tonight'), at: Date.now() };
    U.flow = null; U.view = 'home'; save();
    var open = tasks().filter(function (t) { return t.date === todayStr() && t.status === 'todo'; });
    render(); window.scrollTo(0, 0);
    if (open.length) openOverlay('plan', { draft: newDraft(todayStr()), step: 'view' });
    else { U.view = 'tasks'; U.tab = 'today'; render(); toast('Add what you need to do today and Focus Flow will plan it.', 5000); }
  },
  addGoal: function (f) {
    var title = val(f, 'gTitle').trim(); if (!title) return;
    D().goals.push({ id: uid(), title: title, level: val(f, 'gLevel'), parentId: val(f, 'gParent') }); save(); toast('Goal added'); render();
  },
  reward: function (f) {
    var text = val(f, 'rwText').trim(); if (!text) return;
    D().rewards[f.dataset.wk] = { text: text, threshold: Math.min(100, Math.max(50, +val(f, 'rwTh') || 90)) }; save(); toast('Reward saved'); render();
  },
  settings: function (f) {
    var p = P(), s = D().settings, c = pressed(f, 'color')[0], i;
    p.name = val(f, 'sName').trim() || p.name; p.email = val(f, 'sEmail2').trim();
    if (c) { p.color = themeOf(c).c; p.accent = themeOf(c).k; }
    s.planFrom = val(f, 'sFrom') || s.planFrom; s.planTo = val(f, 'sTo') || s.planTo;
    s.message = pressed(f, 'msg')[0] || s.message; s.theme = pressed(f, 'theme')[0] || s.theme;
    s.rotaWeeks = (pressed(f, 'rota')[0] === '2') ? 2 : 1;
    ['A', 'B'].forEach(function (k) {
      for (i = 0; i < 7; i++) s.shifts[k][i] = { on: checked(f, 'sh' + k + i + 'on'), a: val(f, 'sh' + k + i + 'a') || '08:00', b: val(f, 'sh' + k + i + 'b') || '18:00' };
    });
    if (s.rotaWeeks === 2) { var tw = pressed(f, 'thisweek')[0] || 'A'; s.rotaAnchor = tw === 'A' ? weekStart(todayStr()) : addDays(weekStart(todayStr()), -7); }
    else s.rotaAnchor = weekStart(todayStr());
    s.hasShift = anyShift(s);
    s.appNotify = checked(f, 'sApp'); s.sound = checked(f, 'sSound'); s.vibrate = checked(f, 'sVib'); s.emailNotify = checked(f, 'sEmail');
    s.remindStart = +val(f, 'sRs') || 0; s.checkinEvery = +val(f, 'sCe') || 0; s.quietFrom = val(f, 'sQf') || s.quietFrom; s.quietTo = val(f, 'sQt') || s.quietTo;
    if (f.querySelector('#sAi')) s.ai = checked(f, 'sAi');
    save(); applyTheme(); if (s.appNotify) askNotify(); toast('Settings saved'); render();
  },
  travel: function (f) {
    var place = val(f, 'trPlace').trim(), from = val(f, 'trFrom'), to = val(f, 'trTo'); if (!place || !from || !to) return;
    if (to < from) { toast('The end date is before the start date'); return; }
    D().travel.push({ id: uid(), place: place, from: from, to: to, maxHours: +val(f, 'trMax') || 4, keepShift: checked(f, 'trKeep') }); save(); toast('Trip added'); if (U.overlay) closeOverlay(); else render();
  },
  evening: function (f) {
    var date = todayStr(), tm = addDays(date, 1), now = new Date();
    D().evening[date] = { better: pressed(f, 'mood2')[0] || '', why: val(f, 'evWhy').trim(), at: Date.now() };
    parseCapture(val(f, 'evTomorrow'), tm).forEach(function (it) { addTask({ title: it.title, est: it.est, time: it.time, date: it.date }); });
    var lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() === now.getDate();
    if (lastOfMonth) { U.view = 'insights'; U.range = 'month'; U.mOff = 0; }
    else if (now.getDay() === 0) { U.view = 'insights'; U.range = 'week'; U.wOff = 0; }
    save(); render();
    var has = tasks().some(function (t) { return t.date === tm && t.status === 'todo'; });
    if (has) openOverlay('plan', { draft: newDraft(tm), step: 'view' }); else { toast('Evening review saved'); closeOverlay(); }
  }
};

