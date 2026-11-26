/* ---------- AI helper: the Coach and "Ask AI to change" (uses the viewer's own Claude account) ---------- */
var AI = { available: false, fn: null, limits: null, ctl: null };
async function aiInit() {
  try {
    if (typeof window.claude === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return;
    var fn = await withTimeout(window.claude.use('sample'), 6000);
    if (!fn) return;
    AI.fn = fn; AI.available = true;
    try { AI.limits = await fn.limits(); } catch (e) { AI.limits = null; }
  } catch (e) { }
}
function aiOn() { return !!(AI.available && AI.fn && D() && D().settings.ai !== false); }
function aiErr(e) {
  var c = e && e.code;
  if (c === 'cancelled') return '';
  if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'capability_removed') { AI.available = false; return 'The AI helper is not available for your account on this page.'; }
  if (c === 'rate_limited') return e.reason === 'usage_limit' ? 'You have used the AI helper\'s allowance for today. It resets tomorrow.' : 'That was too quick. Wait a moment and try again.';
  if (c === 'session_expired') return 'Please sign in to Claude again, then retry.';
  if (c === 'invalid_json') return 'The AI answered in a way I could not use. Try rephrasing.';
  return 'The AI helper could not answer just now. Please try again.';
}
function aiState() {
  var d = D(), date = todayStr(), tm = addDays(date, 1), ci = d.checkins[date], sh = shiftFor(date), trip = travelOn(date), wk = weekStart(date), sc = scoreRange(wk, addDays(wk, 6));
  return {
    now: date + ' ' + fromMin(nowMin()), weekday: fmtDate(date, { weekday: 'long' }),
    checkin: ci ? { mood: ci.moods, energy: ci.energy, focus: ci.focus } : null,
    shift_today: sh ? fromMin(sh.a) + '-' + fromMin(Math.min(sh.b, 1439)) : null,
    travel: trip ? { place: trip.place, until: trip.to, max_task_hours: trip.maxHours || 4 } : null,
    tasks: tasks().filter(function (t) { return (t.date === date || t.date === tm) && t.status !== 'cancelled'; }).slice(0, 40).map(function (t) { return { id: t.id, title: t.title, date: t.date, start: t.time || null, minutes: t.est, priority: t.priority, status: t.status, progress: t.progress }; }),
    unscheduled_count: tasks().filter(function (t) { return !t.date && t.status === 'todo'; }).length,
    goals: d.goals.slice(0, 10).map(function (g) { return { title: g.title, level: g.level, progress_pct: goalProgress(g) }; }),
    week_score: sc.pct === null ? null : { done: sc.done, counted: sc.counted, pct: sc.pct }
  };
}
function coachRules() {
  var d = D(), p = P(), low = (d.checkins[todayStr()] || {}).energy === 'low';
  return 'You are the coach inside Focus Flow, a personal planner used by ' + p.name + '. Speak in short, plain, kind sentences, usually under 120 words, and give one clear next step. ' +
    'Use only the facts in STATE below. If something is not there, say you do not know it. Never invent tasks, numbers, dates or progress. No medical, legal or financial advice. ' +
    'You may add or move tasks with your tools, but only when the person asks or clearly agrees, and then say plainly what you changed. Never delete anything. ' +
    (d.settings.message === 'bible' ? 'The person likes Bible encouragement: a short fitting verse (KJV) is welcome when it truly helps, not in every reply. ' : '') +
    (low ? 'Their energy is low today, so keep suggestions small and gentle. ' : '') +
    '\n\nSTATE (read only):\n' + JSON.stringify(aiState());
}
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s).getTime()); }
function validTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function coachTools() {
  return [
    {
      name: 'add_task', description: 'Add one task to the planner. Returns ok and the new task id. Use only when the person asked for it or agreed.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, minutes: { type: 'number', description: 'estimated minutes, 5 to 480' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, time: { type: 'string', description: 'optional fixed start, HH:MM 24 hour' } }, required: ['title'] },
      execute: function (i) {
        var title = String(i.title || '').trim().slice(0, 140); if (!title) throw new Error('title is required');
        var date = validDate(i.date) ? i.date : todayStr(), est = Math.min(480, Math.max(5, Math.round(+i.minutes || 30)));
        var t = addTask({ title: title, est: est, date: date, time: validTime(i.time) ? i.time : '' });
        U.coachDid = (U.coachDid || []).concat(['Added: ' + title]); return { ok: true, id: t.id, date: date };
      }
    },
    {
      name: 'move_task', description: 'Move an existing task (by id from STATE) to another date and clear its fixed time. Returns ok.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['id', 'date'] },
      execute: function (i) {
        var t = taskById(String(i.id)); if (!t) throw new Error('no task with that id');
        if (!validDate(i.date)) throw new Error('date must be YYYY-MM-DD');
        moveTask(t.id, i.date); U.coachDid = (U.coachDid || []).concat(['Moved: ' + t.title + ' to ' + fmtDate(i.date, { day: 'numeric', month: 'short' })]); return { ok: true };
      }
    }
  ];
}
async function sendCoach(text) {
  text = String(text || '').trim(); if (!text || U.coachBusy || !aiOn()) return;
  var d = D(); d.chat.push({ role: 'user', content: text.slice(0, 1500) }); U.coachBusy = true; U.coachErr = ''; U.coachLive = ''; U.coachDid = []; save();
  if (U.view === 'coach') { render(); coachScroll(); }
  var ctl = new AbortController(); AI.ctl = ctl;
  var input = [{ role: 'user', content: coachRules() }].concat(d.chat.slice(-10).map(function (m) { return { role: m.role, content: m.content }; }));
  var opts = { cache: false, signal: ctl.signal, onText: function (u) { U.coachLive = u.text; var el = $('#coachLive'); if (el) { el.textContent = u.text; coachScroll(); } } };
  if (AI.limits && AI.limits.tools) opts.tools = coachTools();
  try {
    var r = await AI.fn(input, opts);
    d.chat.push({ role: 'assistant', content: r.text + (U.coachDid.length ? '\n\n' + U.coachDid.map(function (x) { return '• ' + x; }).join('\n') : '') });
  } catch (e) {
    if (e && e.text) d.chat.push({ role: 'assistant', content: e.text + ' (cut short)' });
    U.coachErr = aiErr(e);
  }
  U.coachBusy = false; U.coachLive = ''; AI.ctl = null; save();
  if (U.view === 'coach' || U.coachDid.length) render();
  if (U.view === 'coach') coachScroll();
}
function coachScroll() { var el = $('#coachEnd'); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'end' }); } catch (e) { } } }
function viewCoach() {
  var d = D(), L = d.chat || [], on = aiOn();
  var bub = function (m) {
    var me = m.role === 'user';
    return '<div class="bub ' + (me ? 'me' : 'ai') + '"><span class="sr">' + (me ? 'You' : 'Coach') + ':</span>' + esc(m.content) + '</div>';
  };
  var live = U.coachBusy ? '<div class="bub ai" id="coachLive" aria-live="polite">' + esc(U.coachLive || 'Thinking…') + '</div>' : '';
  var chips = [['Plan my day', 'Look at my tasks for today and suggest the order I should do them in. Do not change anything yet.'], ['What should I do next?', 'What should I do next?'], ['I feel overwhelmed', 'I feel overwhelmed. Help me lighten today.'], ['Review my week', 'Review my week so far: what is going well and what should I change?']];
  return '<div class="head"><div><h1>Coach</h1><small>A calm helper that knows your day</small></div>' + (L.length && !U.coachBusy ? '<button class="btn sm ghost" data-a="coachClear">Clear chat</button>' : '') + '</div>' +
    (on ? '' : '<section class="card warn"><b>The AI helper is off</b><span class="small">' + (AI.available ? 'You turned it off in Settings.' : 'It is not switched on for this copy of Focus Flow yet.') + '</span></section>') +
    '<section class="card chat" aria-label="Conversation">' + (L.length || U.coachBusy ? L.map(bub).join('') + live : '<p class="muted">Ask anything about your day, or tap a suggestion. The coach can add or move tasks if you ask it to.</p>') + '<span id="coachEnd"></span></section>' +
    (U.coachErr ? '<section class="card warn" role="alert"><span>' + esc(U.coachErr) + '</span></section>' : '') +
    (on ? '<div class="chips">' + chips.map(function (c) { return '<button class="chip" ' + (U.coachBusy ? 'disabled ' : '') + 'data-a="coachAsk" data-q="' + esc(c[1]) + '">' + esc(c[0]) + '</button>'; }).join('') + '</div>' +
      '<form data-f="coach" class="card"><div class="field"><label for="coachBox">Message</label><textarea id="coachBox" rows="2" maxlength="1500" placeholder="e.g. Add a 20 minute walk at 5pm today"' + (U.coachBusy ? ' disabled' : '') + '></textarea></div>' +
      '<div class="row">' + micBtn('coachBox') + (U.coachBusy ? '<button type="button" class="btn" data-a="coachStop">Stop</button>' : '<button class="btn primary" type="submit">Send</button>') + '</div>' +
      '<span class="small muted">When you send a message, your tasks for today and tomorrow, goals and mood check-in are sent to Claude (made by Anthropic) so it can answer. Nothing is sent otherwise.</span></form>' : '');
}
Object.assign(A, {
  coachAsk: function (el) { U.view = 'coach'; if (U.overlay) { U.overlay = null; renderOverlay(); } render(); window.scrollTo(0, 0); sendCoach(el.dataset.q); },
  coachStop: function () { if (AI.ctl) AI.ctl.abort(); },
  coachClear: function () { D().chat = []; U.coachErr = ''; save(); render(); },
  askAiPlan: function () { var p = U.overlay.props; p.ask = !p.ask; p.aiSay = ''; p.aiErr = ''; renderOverlay(); },
  aiEx: function (el) { var t = $('#aiText'); if (t) { t.value = el.dataset.q; t.focus(); } }
});
Object.assign(F, { coach: function (f) { var t = val(f, 'coachBox'); if (t.trim()) sendCoach(t); } });

/* "Ask AI to change": the model proposes small edits; you still review and confirm */
async function aiAdjust(text) {
  var p = U.overlay && U.overlay.props; if (!p || !p.draft || !aiOn()) return;
  text = String(text || '').trim(); if (!text) return;
  var dr = p.draft; if (!dr.times) dr.times = {};
  var L = layout(dr), rows = L.rows.filter(function (r) { return r.kind === 'task'; }).map(function (r) { return { id: r.t.id, title: r.t.title, start: fromMin(r.start), minutes: r.est, fixed_time: !!r.fixed, priority: r.t.priority }; });
  var off = planOff(dr, L).map(function (t) { return { id: t.id, title: t.title, minutes: t.est }; });
  var prompt = 'You adjust one day in a personal planner. Reply with ONLY a JSON object: {"say": string (one or two plain sentences telling the person what you did or why you could not), ' +
    '"changes": [{"id": string, "minutes": number (optional, 5-480), "time": "HH:MM" (optional fixed start), "remove": true (optional, takes it off this day)}], ' +
    '"add": [{"title": string, "minutes": number, "time": "HH:MM" (optional)}]}.\n' +
    'Change only what the person asked. Use ids from PLAN only. Never touch the work shift. If low energy, shorter and fewer tasks are kinder. If the request cannot be done, return empty arrays and explain in "say".\n\n' +
    'DATE: ' + dr.date + ', NOW: ' + fromMin(nowMin()) + '\nPLAN: ' + JSON.stringify(rows) + '\nOFF THE DAY: ' + JSON.stringify(off) + '\nSHIFT: ' + (L.shift ? fromMin(L.shift.a) + '-' + fromMin(Math.min(L.shift.b, 1439)) : 'none') +
    '\nENERGY: ' + ((D().checkins[dr.date] || D().checkins[todayStr()] || {}).energy || 'unknown') + (L.trip ? '\nTRAVEL MODE: ' + L.trip.place : '') + '\n\nREQUEST: ' + text.slice(0, 600);
  p.aiBusy = true; p.aiErr = ''; p.aiSay = ''; renderOverlay();
  try {
    var r = await AI.fn.json(prompt, { cache: false });
    var ids = {}; rows.concat(off).forEach(function (x) { ids[x.id] = 1; }); var n = 0;
    (Array.isArray(r && r.changes) ? r.changes : []).slice(0, 20).forEach(function (c) {
      if (!c || !ids[c.id]) return; var t = taskById(c.id); if (!t) return;
      if (c.remove) { if (dr.removed.indexOf(t.id) < 0) dr.removed.push(t.id); n++; return; }
      if (+c.minutes) { dr.ests[t.id] = Math.min(480, Math.max(5, Math.round(+c.minutes / 5) * 5)); n++; }
      if (validTime(c.time) && toMin(c.time) >= 300) { dr.times[t.id] = c.time; n++; }
    });
    (Array.isArray(r && r.add) ? r.add : []).slice(0, 5).forEach(function (a) {
      var title = a && String(a.title || '').trim().slice(0, 140); if (!title) return;
      addTask({ title: title, est: Math.min(480, Math.max(5, Math.round(+a.minutes || 30))), date: dr.date, time: validTime(a.time) ? a.time : '' }); n++;
    });
    p.aiSay = String((r && r.say) || (n ? 'Updated your plan.' : 'I did not change anything.')).slice(0, 400);
  } catch (e) { p.aiErr = aiErr(e); }
  p.aiBusy = false; if (U.overlay && U.overlay.props === p) renderOverlay();
}
Object.assign(F, { aiPlan: function (f) { aiAdjust(val(f, 'aiText')); } });
