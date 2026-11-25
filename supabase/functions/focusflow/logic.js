// Which reminders are due right now for one person. Plain JavaScript so it can be tested anywhere.
const toMin = (t) => { const p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };

export function localNow(ms, tz) {
  const opt = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { ...opt, timeZone: tz || 'UTC' }); } catch (e) { f = new Intl.DateTimeFormat('en-CA', { ...opt, timeZone: 'UTC' }); }
  const p = {};
  f.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + (+p.minute) };
}

export function inQuiet(s, nm) {
  const a = toMin(s.quietFrom || '22:00'), b = toMin(s.quietTo || '07:00');
  if (a === b) return false;
  return a < b ? (nm >= a && nm < b) : (nm >= a || nm < b);
}

export function fmt12(t) {
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// core: the person's core document. tasks: all their task objects. Returns [{key, title, body}].
export function dueReminders({ core, tasks, nowMs }) {
  const out = [];
  const s = (core && core.settings) || {};
  const { date, min } = localNow(nowMs, s.tz);
  if (inQuiet(s, min)) return out;
  const remindStart = s.remindStart === undefined ? 10 : +s.remindStart;
  const active = core && core.active && core.active.taskId;
  if (remindStart > 0) {
    (tasks || []).forEach((t) => {
      if (!t || t.date !== date || t.status !== 'todo' || !t.time) return;
      const st = toMin(t.time), base = `${t.id}:${date}:${t.time}`;
      if (min >= st - remindStart && min < st) out.push({ key: `s:${base}`, title: 'Starting soon', body: `${t.title} at ${fmt12(t.time)}.` });
      else if (min >= st + 10 && min < st + 45 && active !== t.id) out.push({ key: `l:${base}`, title: 'Still to start', body: `${t.title} was planned for ${fmt12(t.time)}. Start it now, or move it?` });
    });
  }
  ((core && core.reminders) || []).forEach((r) => {
    if (r && !r.fired && r.at <= nowMs && nowMs - r.at < 6 * 3600 * 1000) out.push({ key: `r:${r.id}`, title: 'Focus Flow', body: r.text });
  });
  return out;
}

// Daily and periodic nudges: morning plan, evening review, weekly report (Sunday), monthly report (1st of the month).
// Settings: morningAt ('' = off, default 08:00), eveningAt ('' = off, default 20:00), weekly (default on).
const addDay = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const WINDOW = 10;
export function dueNudges({ core, tasks, nowMs }) {
  const out = [], s = (core && core.settings) || {};
  const { date, min } = localNow(nowMs, s.tz);
  if (inQuiet(s, min)) return out;
  const list = (tasks || []).filter((t) => t && t.date);
  const inWin = (hhmm) => { const a = toMin(hhmm); return min >= a && min < a + WINDOW; };
  const morning = s.morningAt === undefined ? '08:00' : s.morningAt;
  const evening = s.eveningAt === undefined ? '20:00' : s.eveningAt;
  if (morning && inWin(morning)) {
    const td = list.filter((t) => t.date === date && (t.status === 'todo' || t.status === 'doing')).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    const first = td.find((t) => t.time);
    out.push({ key: `n:am:${date}`, title: 'Good morning', body: td.length
      ? `${td.length} task${td.length > 1 ? 's' : ''} planned today${first ? `, the first at ${fmt12(first.time)}` : ''}. Open Focus Flow to check in on your energy.`
      : 'Nothing is planned for today yet. Take a minute to add your most important task.' });
  }
  if (evening && inWin(evening)) {
    const today = list.filter((t) => t.date === date && t.status !== 'cancelled'), done = today.filter((t) => t.status === 'done').length;
    const tmr = list.filter((t) => t.date === addDay(date, 1) && t.status === 'todo').length;
    out.push({ key: `n:pm:${date}`, title: 'Evening review', body: (today.length ? `You finished ${done} of ${today.length} tasks today. ` : 'No tasks were planned today. ')
      + (tmr ? `${tmr} planned for tomorrow.` : 'Tomorrow is empty: plan it now so the morning is easy.') });
  }
  if (s.weekly !== false) {
    const dow = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
    if (dow === 0 && inWin('19:00')) {
      const from = addDay(date, -6), wk = list.filter((t) => t.date >= from && t.date <= date && t.status !== 'cancelled'), done = wk.filter((t) => t.status === 'done').length;
      out.push({ key: `n:wk:${date}`, title: 'Your week in Focus Flow', body: wk.length ? `You finished ${done} of ${wk.length} tasks this week (${Math.round(100 * done / wk.length)}%). Open Insights for your reward and tips.` : 'No tasks were recorded this week. A fresh week starts tomorrow.' });
    }
    if (date.slice(8) === '01' && inWin('09:00')) {
      const pm = addDay(date, -1).slice(0, 7), mo = list.filter((t) => t.date.slice(0, 7) === pm && t.status !== 'cancelled'), done = mo.filter((t) => t.status === 'done').length;
      out.push({ key: `n:mo:${pm}`, title: 'Your monthly report', body: mo.length ? `Last month you finished ${done} of ${mo.length} tasks (${Math.round(100 * done / mo.length)}%). Open Insights, Monthly report, to see estimates against real time.` : 'No tasks were recorded last month. Open Focus Flow to start this one well.' });
    }
  }
  return out;
}

// Things that happened in shared plans in the last few minutes, and who should hear about them.
// rows: [{ path, parent, data, updatedAt(ms) }] from plan_tasks and plan_members. plans: { planId: {title, ownerId} }. names: { uid: name }.
export function planEvents({ rows, plans, names, nowMs, windowMs = 10 * 60 * 1000 }) {
  const out = [], nm = (u) => (names && names[u]) || 'Someone';
  for (const r of rows || []) {
    if (!r || nowMs - r.updatedAt > windowMs) continue;
    const d = r.data || {}, pl = (plans && plans[d.planId]) || null;
    if (!pl) continue;
    const q = `"${pl.title || 'a plan'}"`;
    if (r.parent === 'plan_members') {
      if (d.status === 'invited' && d.uid !== pl.ownerId)
        out.push({ to: d.uid, key: `inv:${d.planId}:${d.uid}`, title: 'New invitation', body: `${nm(pl.ownerId)} invited you to ${q}. Open Focus Flow, then Shared, to accept.`, always: true });
      if (d.status === 'joined' && d.uid !== pl.ownerId)
        out.push({ to: pl.ownerId, key: `join:${d.planId}:${d.uid}`, title: 'Someone joined your plan', body: `${nm(d.uid)} joined ${q}.` });
    } else if (r.parent === 'plan_tasks') {
      if (d.assigneeId && d.assigneeId !== d.createdBy && !d.done)
        out.push({ to: d.assigneeId, key: `asg:${d.id}:${d.assigneeId}`, title: 'A task for you', body: `${nm(d.createdBy)} gave you "${d.title}" in ${q}.` });
      if (d.done && d.doneBy) {
        const to = new Set([pl.ownerId, d.assigneeId].filter((x) => x && x !== d.doneBy));
        for (const u of to) out.push({ to: u, key: `done:${d.id}:${d.doneAt || 0}:${u}`, title: 'Task finished', body: `${nm(d.doneBy)} finished "${d.title}" in ${q}.` });
      }
    }
  }
  return out;
}
