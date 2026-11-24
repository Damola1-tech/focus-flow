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
