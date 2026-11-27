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
  // Quiet hours hold back the automatic nags ("still to start"). Things the person set up themselves still arrive:
  // a task with a start time they chose, and the "get back to it" reminder after a pause.
  const quiet = inQuiet(s, min);
  const remindStart = s.remindStart === undefined ? 10 : +s.remindStart;
  const active = core && core.active && core.active.taskId;
  if (remindStart > 0) {
    (tasks || []).forEach((t) => {
      if (!t || t.date !== date || t.status !== 'todo' || !t.time) return;
      const st = toMin(t.time), base = `${t.id}:${date}:${t.time}`;
      if (min >= st - remindStart && min < st) out.push({ key: `s:${base}`, title: 'Starting soon', body: `${t.title} at ${fmt12(t.time)}.` });
      else if (!quiet && min >= st + 10 && min < st + 45 && active !== t.id) out.push({ key: `l:${base}`, title: 'Still to start', body: `${t.title} was planned for ${fmt12(t.time)}. Start it now, or move it?` });
    });
  }
  ((core && core.reminders) || []).forEach((r) => {
    // The app marks a reminder as "fired" the moment it shows its own on-screen alert, which used to stop the server
    // from ever sending the phone alert. So: unsent ones are caught up for 6 hours, shown ones for the last 10 minutes
    // (the server remembers what it already sent, and the phone stays quiet while the app is open on screen).
    if (r && r.at <= nowMs && nowMs - r.at < (r.fired ? 10 * 60 * 1000 : 6 * 3600 * 1000)) out.push({ key: `r:${r.id}`, title: 'Focus Flow', body: r.text });
  });
  return out;
}

// Daily and periodic nudges: morning plan, evening review, weekly report (Sunday), monthly report (1st of the month).
// Settings: morningAt ('' = off, default 08:00), eveningAt ('' = off, default 20:00), weekly (default on).
const addDay = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const WINDOW = 10;
export const MOTIV = [
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
export const VERSES = [
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

export const dayNo = (date) => Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
// Same pick as the app: one message per day, the gentle ones on a low-energy day.
export function messageFor(core, date) {
  const pref = ((core && core.settings) || {}).message || 'motivation';
  if (pref === 'none') return null;
  const L = pref === 'bible' ? VERSES : MOTIV, seen = core && core.msgSeen && core.msgSeen[pref] && core.msgSeen[pref].byDate;
  if (seen && seen[date] !== undefined && L[seen[date]]) return L[seen[date]];
  let pool = L.map((_, i) => i);
  const ci = core && core.checkins && core.checkins[date];
  if (ci && ci.energy === 'low') { const g = pool.filter((i) => L[i].g); if (g.length) pool = g; }
  return L[pool[dayNo(date) % pool.length]];
}
const msgText = (m) => m.t + (m.r ? ` (${m.r}, KJV)` : '');

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
    const dm = messageFor(core, date);
    out.push({ key: `n:am:${date}`, title: 'Good morning', body: (td.length
      ? `${td.length} task${td.length > 1 ? 's' : ''} planned today${first ? `, the first at ${fmt12(first.time)}` : ''}. Open Focus Flow to check in on your energy.`
      : 'Nothing is planned for today yet. Take a minute to add your most important task.') + (dm ? `\n\n${msgText(dm)}` : '') });
  } else if (!morning && s.message !== 'none') {
    const at = '08:00', dm = messageFor(core, date);
    if (dm && inWin(at)) out.push({ key: `n:msg:${date}`, title: 'Today\'s message', body: msgText(dm) });
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

// Hourly (or every 2-3 h) check-in on the day. Mirrors the in-app one: from 08:00, first 5 minutes of each slot.
export function dueCheckins({ core, tasks, nowMs }) {
  const s = (core && core.settings) || {}, every = +s.checkinEvery || 0;
  if (!(every > 0)) return [];
  const { date, min } = localNow(nowMs, s.tz);
  if (min < 480 || inQuiet(s, min)) return [];
  const slot = Math.floor(min / every);
  if (min - slot * every >= 5) return [];
  const a = core && core.active, list = tasks || [];
  const cur = a && list.find((t) => t && t.id === a.taskId);
  const key = `c:${date}:${slot}`;
  if (a && cur) {
    const sec = (a.accSec || 0) + (a.state === 'running' && a.lastTick ? Math.max(0, (nowMs - a.lastTick) / 1000) : 0), m = Math.max(1, Math.round(sec / 60));
    const so = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    return [{ key, title: 'Check-in', body: `How is "${cur.title}" going? ${so} so far.` }];
  }
  const nxt = list.filter((t) => t && t.date === date && t.status === 'todo').sort((x, y) => String(x.time || '99').localeCompare(String(y.time || '99')))[0];
  return nxt ? [{ key, title: 'Check-in', body: `Next on your list is "${nxt.title}". Ready to start?` }] : [];
}
